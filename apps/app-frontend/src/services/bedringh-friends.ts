import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { reactive, ref, computed } from 'vue'
import { getActiveBedringhUser, resolveActiveBedringhUser } from './bedringh-settings-sync'

const API_CANDIDATES = [
	'http://127.0.0.1:3100',
	'http://localhost:3100',
	'http://2.26.87.126:3100',
	'https://oskarlolpo.play2go.cloud',
	'http://oskarlolpo.play2go.cloud:3100',
]

let activeApiBase = API_CANDIDATES[0]

export type FriendStatus = 'online' | 'in_game' | 'away' | 'offline'

export interface FriendGameInfo {
	instanceName?: string
	loader?: string
	mcVersion?: string
	serverAddress?: string
	startedAt?: number
}

export interface BedringhFriend {
	id: string
	username: string
	status: FriendStatus
	lastSeen?: number
	gameInfo?: FriendGameInfo
	avatarUrl?: string
}

export interface FriendRequest {
	id: string
	username: string
	direction: 'incoming' | 'outgoing'
	createdAt: number
}

export interface FriendsData {
	friends: BedringhFriend[]
	incomingRequests: FriendRequest[]
	outgoingRequests: FriendRequest[]
}

const LOCAL_STORAGE_FRIENDS_KEY = 'bedringh_friends_cache'

// Реактивный глобальный стейт друзей
const state = reactive<{
	friends: BedringhFriend[]
	incomingRequests: FriendRequest[]
	outgoingRequests: FriendRequest[]
	loading: boolean
	lastUpdated: number
	pollingInterval: any
}>({
	friends: [],
	incomingRequests: [],
	outgoingRequests: [],
	loading: false,
	lastUpdated: 0,
	pollingInterval: null,
})

// Загрузка кэша из localStorage
try {
	const cached = localStorage.getItem(LOCAL_STORAGE_FRIENDS_KEY)
	if (cached) {
		const parsed = JSON.parse(cached)
		if (Array.isArray(parsed.friends)) state.friends = parsed.friends
		if (Array.isArray(parsed.incomingRequests)) state.incomingRequests = parsed.incomingRequests
		if (Array.isArray(parsed.outgoingRequests)) state.outgoingRequests = parsed.outgoingRequests
	}
} catch (e) {
	console.warn('[Bedringh Friends] Failed to load local cache:', e)
}

function saveCache() {
	try {
		localStorage.setItem(
			LOCAL_STORAGE_FRIENDS_KEY,
			JSON.stringify({
				friends: state.friends,
				incomingRequests: state.incomingRequests,
				outgoingRequests: state.outgoingRequests,
			})
		)
	} catch (e) {
		console.warn('[Bedringh Friends] Failed to save local cache:', e)
	}
}

let isBackendSupported = true

async function safeFetch(url: string, init: any) {
	try {
		return await tauriFetch(url, init)
	} catch (tauriErr) {
		try {
			return await window.fetch(url, init)
		} catch (e) {
			throw e
		}
	}
}

async function requestApi(endpoint: string, options: { method?: string; body?: any; headers?: Record<string, string> } = {}) {
	const method = options.method || 'GET'
	const headers = {
		'Content-Type': 'application/json',
		...(options.headers || {}),
	}
	const body = options.body ? JSON.stringify(options.body) : undefined

	try {
		const res = await safeFetch(`${activeApiBase}${endpoint}`, { method, headers, body })
		if (res) {
			if (res.status === 404) {
				isBackendSupported = false
				stopFriendsPolling()
			}
			if (res.status !== 502 && res.status !== 503) {
				return res
			}
		}
	} catch (e) {
		// Silent catch
	}

	for (const candidate of API_CANDIDATES) {
		if (candidate === activeApiBase) continue
		try {
			const res = await safeFetch(`${candidate}${endpoint}`, { method, headers, body })
			if (res) {
				if (res.status === 404) {
					isBackendSupported = false
					stopFriendsPolling()
				}
				if (res.status !== 502 && res.status !== 503) {
					activeApiBase = candidate
					return res
				}
			}
		} catch (e) {
			// Silent catch
		}
	}

	throw new Error('Сервер Bedringh ID временно недоступен')
}

/**
 * Получить список друзей и заявок с сервера
 */
export async function refreshFriendsList(force = false): Promise<void> {
	if (!force || !isBackendSupported) return
	isBackendSupported = true

	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) {
		state.friends = []
		state.incomingRequests = []
		state.outgoingRequests = []
		return
	}

	state.loading = true
	try {
		const headers: Record<string, string> = {}
		if (user.token) {
			headers['Authorization'] = `Bearer ${user.token}`
		}

		const res = await requestApi(`/api/friends/list?username=${encodeURIComponent(user.username)}`, {
			method: 'GET',
			headers,
		})

		if (res.ok) {
			const data = await res.json()
			if (data.success) {
				state.friends = Array.isArray(data.friends) ? data.friends : []
				state.incomingRequests = Array.isArray(data.incomingRequests) ? data.incomingRequests : []
				state.outgoingRequests = Array.isArray(data.outgoingRequests) ? data.outgoingRequests : []
				state.lastUpdated = Date.now()
				saveCache()
			}
		}
	} catch (e) {
		console.warn('[Bedringh Friends] Не удалось обновить список друзей с сервера:', e)
	} finally {
		state.loading = false
	}
}

/**
 * Отправить заявку в друзья
 */
export async function sendFriendRequest(targetUsername: string): Promise<{ success: boolean; message?: string }> {
	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) {
		throw new Error('Для добавления друзей войдите в Bedringh ID')
	}

	const trimmed = targetUsername.trim()
	if (trimmed.toLowerCase() === user.username.toLowerCase()) {
		throw new Error('Нельзя добавить в друзья самого себя')
	}

	const headers: Record<string, string> = {}
	if (user.token) {
		headers['Authorization'] = `Bearer ${user.token}`
	}

	try {
		const res = await requestApi('/api/friends/request', {
			method: 'POST',
			headers,
			body: {
				username: user.username,
				targetUsername: trimmed,
			},
		})

		const data = await res.json().catch(() => ({}))
		if (!res.ok || !data.success) {
			throw new Error(data.error || 'Не удалось отправить заявку в друзья')
		}

		// Добавляем в локальный стейт исходящую заявку
		state.outgoingRequests.push({
			id: data.requestId || `req_${Date.now()}`,
			username: trimmed,
			direction: 'outgoing',
			createdAt: Date.now(),
		})
		saveCache()

		return { success: true, message: data.message || 'Заявка отправлена!' }
	} catch (e: any) {
		console.error('[Bedringh Friends] Ошибка отправки заявки:', e)
		throw e
	}
}

/**
 * Ответить на заявку в друзья (принять / отклонить)
 */
export async function respondFriendRequest(requestId: string, action: 'accept' | 'reject'): Promise<boolean> {
	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) return false

	const headers: Record<string, string> = {}
	if (user.token) {
		headers['Authorization'] = `Bearer ${user.token}`
	}

	try {
		const res = await requestApi('/api/friends/respond', {
			method: 'POST',
			headers,
			body: {
				username: user.username,
				requestId,
				action,
			},
		})

		const data = await res.json().catch(() => ({}))
		if (res.ok && data.success) {
			// Удаляем заявку из списка входящих
			const req = state.incomingRequests.find((r) => r.id === requestId)
			state.incomingRequests = state.incomingRequests.filter((r) => r.id !== requestId)

			if (action === 'accept' && req) {
				state.friends.push({
					id: `friend_${Date.now()}`,
					username: req.username,
					status: 'online',
				})
			}
			saveCache()
			return true
		}
		return false
	} catch (e) {
		console.error('[Bedringh Friends] Ошибка ответа на заявку:', e)
		return false
	}
}

/**
 * Отменить отправленную заявку
 */
export async function cancelFriendRequest(requestId: string): Promise<boolean> {
	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) return false

	const headers: Record<string, string> = {}
	if (user.token) {
		headers['Authorization'] = `Bearer ${user.token}`
	}

	try {
		const res = await requestApi('/api/friends/cancel', {
			method: 'POST',
			headers,
			body: {
				username: user.username,
				requestId,
			},
		})

		if (res.ok) {
			state.outgoingRequests = state.outgoingRequests.filter((r) => r.id !== requestId)
			saveCache()
			return true
		}
		return false
	} catch (e) {
		console.error('[Bedringh Friends] Ошибка отмены заявки:', e)
		return false
	}
}

/**
 * Удалить друга
 */
export async function removeFriend(friendUsername: string): Promise<boolean> {
	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) return false

	const headers: Record<string, string> = {}
	if (user.token) {
		headers['Authorization'] = `Bearer ${user.token}`
	}

	try {
		const res = await requestApi('/api/friends/remove', {
			method: 'POST',
			headers,
			body: {
				username: user.username,
				friendUsername,
			},
		})

		if (res.ok) {
			state.friends = state.friends.filter(
				(f) => f.username.toLowerCase() !== friendUsername.toLowerCase()
			)
			saveCache()
			return true
		}
		return false
	} catch (e) {
		console.error('[Bedringh Friends] Ошибка удаления друга:', e)
		return false
	}
}

/**
 * Поиск пользователей Bedringh ID по имени
 */
export async function searchBedringhUsers(query: string): Promise<{ username: string; avatarUrl?: string }[]> {
	if (!query || query.trim().length < 2) return []

	try {
		const res = await requestApi(`/api/friends/search?q=${encodeURIComponent(query.trim())}`)
		if (res.ok) {
			const data = await res.json()
			if (data.success && Array.isArray(data.users)) {
				return data.users
			}
		}
	} catch (e) {
		console.warn('[Bedringh Friends] Поиск пользователей не удался:', e)
	}

	return []
}

/**
 * Обновить статус присутствия игрока (Presence Heartbeat)
 */
export async function updatePresence(_status: FriendStatus, _gameInfo?: FriendGameInfo): Promise<void> {
	// Network presence is paused until friends backend is deployed on VDS
}

/**
 * Запуск фонового обновления списка друзей
 */
export function startFriendsPolling(): void {
	// Network polling is paused until friends backend is deployed on VDS
}

export function stopFriendsPolling(): void {
	if (state.pollingInterval) {
		clearInterval(state.pollingInterval)
		state.pollingInterval = null
	}
}

/**
 * Composable хук для использования в Vue компонентах
 */
export function useBedringhFriends() {
	const totalIncoming = computed(() => state.incomingRequests.length)
	const onlineFriends = computed(() =>
		state.friends.filter((f) => f.status === 'online' || f.status === 'in_game')
	)
	const inGameFriends = computed(() =>
		state.friends.filter((f) => f.status === 'in_game')
	)
	const offlineFriends = computed(() =>
		state.friends.filter((f) => f.status === 'offline' || !f.status)
	)

	return {
		state,
		totalIncoming,
		onlineFriends,
		inGameFriends,
		offlineFriends,
		refreshFriendsList,
		sendFriendRequest,
		respondFriendRequest,
		cancelFriendRequest,
		removeFriend,
		searchBedringhUsers,
		updatePresence,
		startFriendsPolling,
		stopFriendsPolling,
	}
}
