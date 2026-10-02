import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { computed, reactive } from 'vue'
import { getActiveBedringhUser, resolveActiveBedringhUser } from './bedringh-settings-sync'

const API_CANDIDATES = [
	'http://bedringh.duckdns.org:3100',
	'https://oskarlolpo.play2go.cloud',
	'http://oskarlolpo.play2go.cloud:3100',
	'http://127.0.0.1:3100',
	'http://localhost:3100',
]

let activeApiBase = API_CANDIDATES[0]

export type FriendStatus = 'online' | 'in_game' | 'away' | 'offline'

export interface FriendGameInfo {
	instanceName?: string
	loader?: string
	mcVersion?: string
	serverAddress?: string
	serverName?: string
	packCode?: string
	startedAt?: number
}

export interface BedringhFriend {
	id: string
	username: string
	status: FriendStatus
	place?: 'game' | 'launcher' | 'web'
	lastSeen?: number
	totalHours?: number
	gameInfo?: FriendGameInfo
	avatarUrl?: string
	unread?: number
	lastMessage?: string
	lastMessageSender?: string
	lastMessageAt?: number
}

export interface FriendRequest {
	id: string
	username: string
	avatarUrl?: string
	direction: 'incoming' | 'outgoing'
	createdAt: number
}

export interface ChatRoom {
	id: string
	title: string
	owner: string
	members: string[]
	unread: number
	lastMessage?: string
	lastMessageSender?: string
	lastMessageAt?: number
	createdAt: number
}

export interface ChatMessageReply {
	id: string
	sender: string
	preview: string
}

export interface ChatMessage {
	id: string
	localId?: string
	state?: 'sending' | 'sent' | 'failed'
	roomId?: string
	sender: string
	recipient?: string
	content: string
	replyTo?: ChatMessageReply
	attachmentUrl?: string
	attachmentType?: 'image' | 'voice'
	voiceDuration?: number
	voicePeaks?: number[]
	reactions?: Record<string, string[]>
	editedAt?: number
	createdAt: number
}

export interface FriendProfileData {
	username: string
	avatarUrl?: string
	totalHours: number
	lastInstance: string | null
	lastServer: string | null
	lastSeen: number | null
	friendsCount: number
}

export const MC_INVITE_PREFIX = '⟪mc-invite⟫'

export interface McInvitePayload {
	addr: string
	name: string
	version?: string
	loader?: string
	edition?: 'java' | 'bedrock'
	packCode?: string
}

export function encodeMcInvite(payload: McInvitePayload): string {
	return `${MC_INVITE_PREFIX}${JSON.stringify(payload)}`
}

export function parseMcInvite(content?: string): McInvitePayload | null {
	if (!content || !content.startsWith(MC_INVITE_PREFIX)) return null
	try {
		const raw = content.slice(MC_INVITE_PREFIX.length).trim()
		const parsed = JSON.parse(raw)
		if (parsed && typeof parsed.addr === 'string') {
			return {
				addr: parsed.addr,
				name: parsed.name || parsed.addr,
				version: parsed.version,
				loader: parsed.loader,
				edition: parsed.edition || 'java',
				packCode: parsed.packCode,
			}
		}
	} catch {
		// ignore
	}
	return null
}

export interface PendingPlayInviteTarget {
	type: 'dm' | 'room'
	id: string
	title: string
	createdAt: number
}

export interface SocialToastEvent {
	id: string
	kind: 'message' | 'invite' | 'friend_request' | 'friend_online' | 'friend_game'
	title: string
	subtitle: string
	username?: string
	roomId?: string
	invite?: McInvitePayload
	createdAt: number
}

/**
 * Облачный контейнер социальных данных пользователя, хранимый в профиле Bedringh ID
 * (`/api/user/settings` -> `settings._bedringhSocial`), когда на сервере ещё не развёрнуты
 * отдельные роуты `/api/friends/*`.
 */
interface CloudUserSocialBox {
	friends: string[]
	incomingRequests: FriendRequest[]
	outgoingRequests: FriendRequest[]
	rooms: ChatRoom[]
	messagesByKey: Record<string, ChatMessage[]>
	peerReadAtByKey: Record<string, number>
	typingByKey: Record<string, { senders: string[]; expiresAt: number }>
	presence?: {
		status: FriendStatus
		place?: 'game' | 'launcher' | 'web'
		lastSeen: number
		totalHours?: number
		gameInfo?: FriendGameInfo
	}
}

const LOCAL_STORAGE_FRIENDS_KEY = 'bedringh_friends_cache_v2'
const LOCAL_STORAGE_PENDING_INVITE_KEY = 'bedringh_pending_play_invite_v1'

const presenceToastCooldowns = new Map<string, number>()
let initialPresenceSeeded = false

export const state = reactive<{
	activeUsername: string | null
	friends: BedringhFriend[]
	incomingRequests: FriendRequest[]
	outgoingRequests: FriendRequest[]
	rooms: ChatRoom[]
	loading: boolean
	lastUpdated: number
	pollingInterval: ReturnType<typeof setInterval> | null
	presenceInterval: ReturnType<typeof setInterval> | null
	activeChatTarget: { type: 'dm' | 'room'; id: string } | null
	messagesByKey: Record<string, ChatMessage[]>
	peerReadAtByKey: Record<string, number>
	typingByKey: Record<string, { senders: string[]; expiresAt: number }>
	pendingPlayInvite: PendingPlayInviteTarget | null
	recentToasts: SocialToastEvent[]
	currentPresence: {
		status: FriendStatus
		gameInfo?: FriendGameInfo
	}
}>({
	activeUsername: getActiveBedringhUser()?.username || null,
	friends: [],
	incomingRequests: [],
	outgoingRequests: [],
	rooms: [],
	loading: false,
	lastUpdated: 0,
	pollingInterval: null,
	presenceInterval: null,
	activeChatTarget: null,
	messagesByKey: {},
	peerReadAtByKey: {},
	typingByKey: {},
	pendingPlayInvite: null,
	recentToasts: [],
	currentPresence: {
		status: 'online',
		gameInfo: undefined,
	},
})

try {
	if (state.activeUsername) {
		const cached = localStorage.getItem(LOCAL_STORAGE_FRIENDS_KEY)
		if (cached) {
			const parsed = JSON.parse(cached)
			if (Array.isArray(parsed.friends)) state.friends = parsed.friends
			if (Array.isArray(parsed.incomingRequests)) state.incomingRequests = parsed.incomingRequests
			if (Array.isArray(parsed.outgoingRequests)) state.outgoingRequests = parsed.outgoingRequests
			if (Array.isArray(parsed.rooms)) state.rooms = parsed.rooms
			if (parsed.messagesByKey && typeof parsed.messagesByKey === 'object') {
				state.messagesByKey = parsed.messagesByKey
			}
		}
	}
	const pendingRaw = localStorage.getItem(LOCAL_STORAGE_PENDING_INVITE_KEY)
	if (pendingRaw) {
		const parsedInvite = JSON.parse(pendingRaw) as PendingPlayInviteTarget
		if (parsedInvite && Date.now() - parsedInvite.createdAt < 30 * 60 * 1000) {
			state.pendingPlayInvite = parsedInvite
		} else {
			localStorage.removeItem(LOCAL_STORAGE_PENDING_INVITE_KEY)
		}
	}
} catch (e) {
	console.warn('[Bedringh Social] Failed to parse cache:', e)
}

if (typeof window !== 'undefined') {
	window.addEventListener('bedringh:account-changed', (ev: Event) => {
		const custom = ev as CustomEvent<{ username?: string; token?: string } | null>
		const nextUser = custom.detail?.username || null
		const prevUser = state.activeUsername
		if ((nextUser || '').toLowerCase() === (prevUser || '').toLowerCase()) {
			return
		}
		state.activeUsername = nextUser
		initialLoadDoneForUser = null
		state.friends = []
		state.incomingRequests = []
		state.outgoingRequests = []
		state.rooms = []
		state.activeChatTarget = null
		state.messagesByKey = {}
		state.lastUpdated = 0

		if (!nextUser) {
			state.loading = false
			stopFriendsPolling()
		} else {
			void refreshFriendsList(true)
			startFriendsPolling()
		}
	})
}

let nativeSocialRoutesAvailable: boolean | null = null
let initialLoadDoneForUser: string | null = null
let refreshInFlight: Promise<void> | null = null

function saveCache() {
	try {
		localStorage.setItem(
			LOCAL_STORAGE_FRIENDS_KEY,
			JSON.stringify({
				friends: state.friends,
				incomingRequests: state.incomingRequests,
				outgoingRequests: state.outgoingRequests,
				rooms: state.rooms,
				messagesByKey: state.messagesByKey,
			}),
		)
	} catch (e) {
		console.warn('[Bedringh Social] Failed to save cache:', e)
	}
}

export function getChatKey(target?: { type: 'dm' | 'room'; id: string } | null): string {
	if (!target || !target.type || !target.id) return ''
	return target.type === 'room' ? `room:${target.id}` : `dm:${target.id.toLowerCase()}`
}

async function safeFetch(url: string, init: any) {
	try {
		return await window.fetch(url, init)
	} catch {
		return await tauriFetch(url, init)
	}
}

async function requestApi(
	endpoint: string,
	options: { method?: string; body?: any; headers?: Record<string, string> } = {},
) {
	const method = options.method || 'GET'
	const headers = {
		'Content-Type': 'application/json',
		...(options.headers || {}),
	}
	const body = options.body ? JSON.stringify(options.body) : undefined

	try {
		const res = await safeFetch(`${activeApiBase}${endpoint}`, { method, headers, body })
		if (res && res.status !== 502 && res.status !== 503) {
			return res
		}
	} catch {
		// try next candidate
	}

	for (const candidate of API_CANDIDATES) {
		if (candidate === activeApiBase) continue
		try {
			const res = await safeFetch(`${candidate}${endpoint}`, { method, headers, body })
			if (res && res.status !== 502 && res.status !== 503) {
				activeApiBase = candidate
				return res
			}
		} catch {
			// continue
		}
	}

	throw new Error('Сервер социальной сети Bedringh временно недоступен')
}

async function isRouteNotFoundResponse(res: Response): Promise<{ routeMissing: boolean; data: any }> {
	const data = await res.json().catch(() => ({}))
	const isFastifyRoute404 =
		res.status === 404 &&
		typeof data?.message === 'string' &&
		data.message.startsWith('Route ') &&
		data.message.includes(' not found')
	if (isFastifyRoute404) {
		nativeSocialRoutesAvailable = false
	} else if (res.ok) {
		nativeSocialRoutesAvailable = true
	}
	return { routeMissing: isFastifyRoute404, data }
}

// ============================================================================
// ОБЛАЧНЫЙ ДВИЖОК BEDRINGH ID (РАБОТАЕТ ЧЕРЕЗ /api/users/profiles/minecraft И /api/user/settings)
// ============================================================================

function createDefaultSocialBox(): CloudUserSocialBox {
	return {
		friends: [],
		incomingRequests: [],
		outgoingRequests: [],
		rooms: [],
		messagesByKey: {},
		peerReadAtByKey: {},
		typingByKey: {},
	}
}

function normalizeSocialBox(raw: any): CloudUserSocialBox {
	const base = createDefaultSocialBox()
	if (!raw || typeof raw !== 'object') return base
	return {
		friends: Array.isArray(raw.friends) ? raw.friends.filter((x: any) => typeof x === 'string') : [],
		incomingRequests: Array.isArray(raw.incomingRequests) ? raw.incomingRequests : [],
		outgoingRequests: Array.isArray(raw.outgoingRequests) ? raw.outgoingRequests : [],
		rooms: Array.isArray(raw.rooms) ? raw.rooms : [],
		messagesByKey:
			raw.messagesByKey && typeof raw.messagesByKey === 'object' ? raw.messagesByKey : {},
		peerReadAtByKey:
			raw.peerReadAtByKey && typeof raw.peerReadAtByKey === 'object' ? raw.peerReadAtByKey : {},
		typingByKey: raw.typingByKey && typeof raw.typingByKey === 'object' ? raw.typingByKey : {},
		presence: raw.presence && typeof raw.presence === 'object' ? raw.presence : undefined,
	}
}

/**
 * Проверить существование реального аккаунта в базе данных Bedringh ID
 * и вернуть его канонический никнейм (с правильным регистром)
 */
export async function checkBedringhUserExists(
	username: string,
): Promise<{ exists: boolean; username?: string; id?: string }> {
	const trimmed = username.trim()
	if (!trimmed) return { exists: false }

	try {
		const res = await requestApi(`/api/users/profiles/minecraft/${encodeURIComponent(trimmed)}`)
		if (res.status === 200) {
			const data = await res.json().catch(() => null)
			if (data && typeof data.name === 'string') {
				return {
					exists: true,
					username: data.name,
					id: data.id,
				}
			}
		}
		if (res.status === 204) {
			return { exists: false }
		}
	} catch {
		// fallback to skin endpoint check
	}

	try {
		const skinRes = await requestApi(`/api/user/${encodeURIComponent(trimmed)}/skin`)
		if (skinRes.status === 200) {
			const data = await skinRes.json().catch(() => null)
			if (data && typeof data.username === 'string') {
				return {
					exists: true,
					username: data.username,
				}
			}
		}
	} catch {
		// ignore
	}

	return { exists: false }
}

async function readCloudUserSettingsAndSocial(
	username: string,
): Promise<{ fullSettings: Record<string, any>; social: CloudUserSocialBox } | null> {
	try {
		const res = await requestApi(`/api/user/settings?username=${encodeURIComponent(username.trim())}`)
		if (res.status === 404) {
			return { fullSettings: {}, social: createDefaultSocialBox() }
		}
		if (!res.ok) return null
		const data = await res.json().catch(() => null)
		if (!data || !data.success) return { fullSettings: {}, social: createDefaultSocialBox() }
		const fullSettings =
			data.settings && typeof data.settings === 'object' ? { ...data.settings } : {}
		const social = normalizeSocialBox(fullSettings._bedringhSocial)
		return { fullSettings, social }
	} catch {
		return null
	}
}

async function writeCloudUserSocial(
	username: string,
	mutator: (box: CloudUserSocialBox) => CloudUserSocialBox | void,
): Promise<CloudUserSocialBox | null> {
	const current = await readCloudUserSettingsAndSocial(username)
	if (!current) return null

	const boxCopy: CloudUserSocialBox = JSON.parse(JSON.stringify(current.social))
	const maybeNext = mutator(boxCopy)
	const nextSocial = maybeNext || boxCopy

	const updatedSettings = {
		...current.fullSettings,
		_bedringhSocial: nextSocial,
	}

	const res = await requestApi('/api/user/settings', {
		method: 'POST',
		body: {
			username: username.trim(),
			settings: updatedSettings,
		},
	})

	if (!res.ok) return null
	return nextSocial
}

function pushSocialToast(toast: Omit<SocialToastEvent, 'id' | 'createdAt'>) {
	const item: SocialToastEvent = {
		...toast,
		id: `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
		createdAt: Date.now(),
	}
	state.recentToasts.unshift(item)
	if (state.recentToasts.length > 15) {
		state.recentToasts.length = 15
	}
}

export function dismissSocialToast(id: string) {
	state.recentToasts = state.recentToasts.filter((t) => t.id !== id)
}

function applyFriendsUpdateWithToasts(
	nextFriends: BedringhFriend[],
	incomingReqs: FriendRequest[],
	outgoingReqs: FriendRequest[],
	rooms?: ChatRoom[],
) {
	const prevFriendsMap = new Map(state.friends.map((f) => [f.username.toLowerCase(), f]))
	const prevIncomingIds = new Set(state.incomingRequests.map((r) => r.id))

	if (initialPresenceSeeded) {
		const now = Date.now()
		for (const nf of nextFriends) {
			const key = nf.username.toLowerCase()
			const pf = prevFriendsMap.get(key)
			const lastCooldown = presenceToastCooldowns.get(key) || 0
			if (now - lastCooldown >= 120_000) {
				if (nf.status === 'in_game' && pf?.status !== 'in_game') {
					presenceToastCooldowns.set(key, now)
					pushSocialToast({
						kind: 'friend_game',
						title: `${nf.username} сейчас в игре`,
						subtitle: nf.gameInfo?.serverName || nf.gameInfo?.instanceName || 'Minecraft',
						username: nf.username,
					})
				} else if (nf.status === 'online' && (!pf || pf.status === 'offline')) {
					presenceToastCooldowns.set(key, now)
					pushSocialToast({
						kind: 'friend_online',
						title: `${nf.username} в сети`,
						subtitle: 'Зашёл в лаунчер Bedringh',
						username: nf.username,
					})
				}
			}

			// Проверяем новые входящие сообщения от друга
			if (
				nf.lastMessageAt &&
				(!pf?.lastMessageAt || nf.lastMessageAt > pf.lastMessageAt) &&
				nf.lastMessageSender &&
				nf.lastMessageSender.toLowerCase() !== (state.activeUsername || '').toLowerCase()
			) {
				const parsedInvite = parseMcInvite(nf.lastMessage)
				pushSocialToast({
					kind: parsedInvite ? 'invite' : 'message',
					title: parsedInvite
						? `${nf.username} зовёт на сервер!`
						: `Сообщение от ${nf.username}`,
					subtitle: parsedInvite
						? `${parsedInvite.name} (${parsedInvite.addr})`
						: nf.lastMessage || 'Новое сообщение',
					username: nf.username,
					invite: parsedInvite || undefined,
				})
			}
		}

		for (const req of incomingReqs) {
			if (!prevIncomingIds.has(req.id)) {
				pushSocialToast({
					kind: 'friend_request',
					title: 'Новая заявка в друзья',
					subtitle: `${req.username} хочет добавить вас в друзья`,
					username: req.username,
				})
			}
		}
	}
	initialPresenceSeeded = true

	state.friends = nextFriends
	state.incomingRequests = incomingReqs
	state.outgoingRequests = outgoingReqs
	if (Array.isArray(rooms)) {
		state.rooms = rooms
	}
	state.lastUpdated = Date.now()
	saveCache()
}

/**
 * Обновить список друзей, заявок и групповых комнат с сервера
 */
export async function refreshFriendsList(_force = false): Promise<void> {
	if (refreshInFlight) {
		return refreshInFlight
	}

	refreshInFlight = (async () => {
		const user = await resolveActiveBedringhUser()
		if (!user || !user.username) {
			state.activeUsername = null
			state.friends = []
			state.incomingRequests = []
			state.outgoingRequests = []
			state.rooms = []
			state.loading = false
			initialLoadDoneForUser = null
			return
		}

		const userKey = user.username.toLowerCase()
		state.activeUsername = user.username

		// Показываем скелетон загрузки ТОЛЬКО один раз при самой первой инициализации профиля,
		// чтобы фоновый поллинг никогда не вызывал моргание интерфейса
		if (initialLoadDoneForUser !== userKey && state.lastUpdated === 0 && state.friends.length === 0) {
			state.loading = true
		}

		try {
			let useCloudFallback = nativeSocialRoutesAvailable === false

			if (!useCloudFallback) {
				const headers: Record<string, string> = {}
				if (user.token) {
					headers['Authorization'] = `Bearer ${user.token}`
				}

				const res = await requestApi(
					`/api/friends/list?username=${encodeURIComponent(user.username)}`,
					{
						method: 'GET',
						headers,
					},
				)

				if (res.ok) {
					const data = await res.json()
					if (data.success) {
						nativeSocialRoutesAvailable = true
						applyFriendsUpdateWithToasts(
							Array.isArray(data.friends) ? data.friends : [],
							Array.isArray(data.incomingRequests) ? data.incomingRequests : [],
							Array.isArray(data.outgoingRequests) ? data.outgoingRequests : [],
							Array.isArray(data.rooms) ? data.rooms : undefined,
						)
						return
					}
				}

				const { routeMissing } = await isRouteNotFoundResponse(res)
				if (routeMissing) {
					useCloudFallback = true
				}
			}

			if (useCloudFallback) {
				// Фоллбэк: читаем социальный контейнер пользователя из живого облака Bedringh ID
				const myCloud = await readCloudUserSettingsAndSocial(user.username)
				if (!myCloud) return

				const myBox = myCloud.social
				// Синхронизируем истории чатов из облака
				for (const [k, msgs] of Object.entries(myBox.messagesByKey || {})) {
					if (Array.isArray(msgs)) {
						state.messagesByKey[k] = msgs.map((m) => ({ ...m, state: 'sent' }))
					}
				}
				for (const [k, readAt] of Object.entries(myBox.peerReadAtByKey || {})) {
					if (typeof readAt === 'number') {
						state.peerReadAtByKey[k] = readAt
					}
				}
				for (const [k, typing] of Object.entries(myBox.typingByKey || {})) {
					if (typing && typing.expiresAt > Date.now()) {
						state.typingByKey[k] = typing
					}
				}

				// Подгружаем актуальные статусы присутствия каждого друга
				const now = Date.now()
				const friendEntries = await Promise.all(
					myBox.friends.map(async (friendName): Promise<BedringhFriend> => {
						const friendCloud = await readCloudUserSettingsAndSocial(friendName)
						const p = friendCloud?.social?.presence
						const isAlive = p?.lastSeen && now - p.lastSeen < 90_000
						const status: FriendStatus = isAlive ? p?.status || 'online' : 'offline'

						const dmKey = getChatKey({ type: 'dm', id: friendName })
						const dmMessages = myBox.messagesByKey[dmKey] || []
						const lastMsg = dmMessages.length > 0 ? dmMessages[dmMessages.length - 1] : undefined
						const myReadAt = myBox.peerReadAtByKey[`self:${dmKey}`] || 0
						const unreadCount = dmMessages.filter(
							(m) =>
								m.sender.toLowerCase() !== user.username.toLowerCase() && m.createdAt > myReadAt,
						).length

						let previewText = lastMsg?.content
						if (previewText?.startsWith(MC_INVITE_PREFIX)) previewText = 'Приглашение на сервер'
						else if (!previewText && lastMsg?.attachmentType === 'voice')
							previewText = 'Голосовое сообщение'
						else if (!previewText && lastMsg?.attachmentType === 'image')
							previewText = 'Изображение'

						return {
							id: friendName.toLowerCase(),
							username: friendName,
							status,
							place: status === 'in_game' ? 'game' : 'launcher',
							lastSeen: p?.lastSeen,
							totalHours: p?.totalHours,
							gameInfo: status === 'in_game' ? p?.gameInfo : undefined,
							avatarUrl: `https://mc-heads.net/avatar/${encodeURIComponent(friendName)}/64`,
							unread: unreadCount,
							lastMessage: previewText,
							lastMessageSender: lastMsg?.sender,
							lastMessageAt: lastMsg?.createdAt,
						}
					}),
				)

				applyFriendsUpdateWithToasts(
					friendEntries,
					myBox.incomingRequests,
					myBox.outgoingRequests,
					myBox.rooms,
				)
			}
		} catch (e) {
			console.warn('[Bedringh Social] Не удалось обновить список друзей:', e)
		} finally {
			initialLoadDoneForUser = userKey
			if (state.lastUpdated === 0) {
				state.lastUpdated = Date.now()
			}
			state.loading = false
			refreshInFlight = null
		}
	})()

	return refreshInFlight
}

/**
 * Поиск пользователей в системе Bedringh ID
 */
export async function searchBedringhUsers(query: string): Promise<{
	users: { username: string; avatarUrl?: string }[]
	similar: { username: string; avatarUrl?: string }[]
}> {
	const trimmed = query?.trim() || ''
	if (trimmed.length < 2) return { users: [], similar: [] }
	const user = await resolveActiveBedringhUser()
	const meParam = user?.username ? `&username=${encodeURIComponent(user.username)}` : ''

	try {
		const res = await requestApi(
			`/api/friends/search?q=${encodeURIComponent(trimmed)}${meParam}`,
		)
		if (res.ok) {
			const data = await res.json()
			if (data.success) {
				return {
					users: Array.isArray(data.users) ? data.users : [],
					similar: Array.isArray(data.similar) ? data.similar : [],
				}
			}
		}

		const { routeMissing } = await isRouteNotFoundResponse(res)
		if (routeMissing) {
			const found = await checkBedringhUserExists(trimmed)
			if (
				found.exists &&
				found.username &&
				found.username.toLowerCase() !== (user?.username || '').toLowerCase()
			) {
				return {
					users: [
						{
							username: found.username,
							avatarUrl: `https://mc-heads.net/avatar/${encodeURIComponent(found.username)}/64`,
						},
					],
					similar: [],
				}
			}
		}
	} catch (e) {
		console.warn('[Bedringh Social] Поиск пользователей не удался:', e)
	}

	return { users: [], similar: [] }
}

/**
 * Отправить заявку в друзья
 */
export async function sendFriendRequest(
	targetUsername: string,
): Promise<{ success: boolean; message?: string; autoAccepted?: boolean }> {
	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) {
		throw new Error('Войдите в аккаунт Bedringh ID для добавления друзей')
	}

	const trimmed = targetUsername.trim()
	if (!trimmed) {
		throw new Error('Введите никнейм игрока в Bedringh ID')
	}
	if (trimmed.toLowerCase() === user.username.toLowerCase()) {
		throw new Error('Нельзя добавить в друзья самого себя')
	}

	const res = await requestApi('/api/friends/request', {
		method: 'POST',
		body: {
			username: user.username,
			targetUsername: trimmed,
		},
	})

	const { routeMissing, data } = await isRouteNotFoundResponse(res)

	if (!routeMissing) {
		if (!res.ok || !data.success) {
			throw new Error(data.error || 'Не удалось отправить заявку в друзья')
		}

		if (data.autoAccepted) {
			await refreshFriendsList(true)
		} else {
			state.outgoingRequests.push({
				id: data.requestId || `req_${Date.now()}`,
				username: trimmed,
				direction: 'outgoing',
				createdAt: Date.now(),
			})
			saveCache()
		}

		return {
			success: true,
			autoAccepted: data.autoAccepted,
			message: data.message || `Заявка в друзья отправлена игроку ${trimmed}!`,
		}
	}

	// Фоллбэк через живые эндпоинты Bedringh ID (/api/users/profiles/minecraft + /api/user/settings)
	const existsCheck = await checkBedringhUserExists(trimmed)
	if (!existsCheck.exists || !existsCheck.username) {
		throw new Error(`Игрок «${trimmed}» не найден в системе Bedringh ID`)
	}

	const canonicalTarget = existsCheck.username
	if (canonicalTarget.toLowerCase() === user.username.toLowerCase()) {
		throw new Error('Нельзя добавить в друзья самого себя')
	}

	const myCloud = await readCloudUserSettingsAndSocial(user.username)
	if (!myCloud) {
		throw new Error('Не удалось загрузить профиль вашего аккаунта Bedringh ID')
	}

	if (
		myCloud.social.friends.some((f) => f.toLowerCase() === canonicalTarget.toLowerCase())
	) {
		throw new Error(`${canonicalTarget} уже есть в вашем списке друзей`)
	}

	if (
		myCloud.social.outgoingRequests.some(
			(r) => r.username.toLowerCase() === canonicalTarget.toLowerCase(),
		)
	) {
		throw new Error(`Заявка в друзья игроку ${canonicalTarget} уже отправлена`)
	}

	// Проверяем, нет ли уже встречной входящей заявки от этого игрока
	const reverseReq = myCloud.social.incomingRequests.find(
		(r) => r.username.toLowerCase() === canonicalTarget.toLowerCase(),
	)

	const now = Date.now()
	const reqId = `req_${now}_${Math.random().toString(36).slice(2, 7)}`

	if (reverseReq) {
		// Встречная заявка — сразу добавляем друг друга в друзья
		await writeCloudUserSocial(user.username, (box) => {
			box.incomingRequests = box.incomingRequests.filter(
				(r) => r.username.toLowerCase() !== canonicalTarget.toLowerCase(),
			)
			if (!box.friends.some((f) => f.toLowerCase() === canonicalTarget.toLowerCase())) {
				box.friends.push(canonicalTarget)
			}
		})

		await writeCloudUserSocial(canonicalTarget, (box) => {
			box.outgoingRequests = box.outgoingRequests.filter(
				(r) => r.username.toLowerCase() !== user.username.toLowerCase(),
			)
			if (!box.friends.some((f) => f.toLowerCase() === user.username.toLowerCase())) {
				box.friends.push(user.username)
			}
		})

		await refreshFriendsList(true)
		return {
			success: true,
			autoAccepted: true,
			message: `Встречная заявка принята! Вы и ${canonicalTarget} теперь друзья.`,
		}
	}

	// Записываем входящую заявку в облачный профиль получателя
	const targetUpdated = await writeCloudUserSocial(canonicalTarget, (box) => {
		const alreadyIn = box.incomingRequests.some(
			(r) => r.username.toLowerCase() === user.username.toLowerCase(),
		)
		if (!alreadyIn) {
			box.incomingRequests.unshift({
				id: reqId,
				username: user.username,
				avatarUrl: `https://mc-heads.net/avatar/${encodeURIComponent(user.username)}/64`,
				direction: 'incoming',
				createdAt: now,
			})
		}
	})

	if (!targetUpdated) {
		throw new Error(`Не удалось доставить заявку игроку ${canonicalTarget}`)
	}

	// Записываем исходящую заявку себе
	const outgoingItem: FriendRequest = {
		id: reqId,
		username: canonicalTarget,
		avatarUrl: `https://mc-heads.net/avatar/${encodeURIComponent(canonicalTarget)}/64`,
		direction: 'outgoing',
		createdAt: now,
	}

	await writeCloudUserSocial(user.username, (box) => {
		box.outgoingRequests = box.outgoingRequests.filter(
			(r) => r.username.toLowerCase() !== canonicalTarget.toLowerCase(),
		)
		box.outgoingRequests.unshift(outgoingItem)
	})

	state.outgoingRequests.unshift(outgoingItem)
	saveCache()

	return {
		success: true,
		autoAccepted: false,
		message: `Заявка в друзья отправлена игроку ${canonicalTarget}!`,
	}
}

export async function respondFriendRequest(
	requestId: string,
	action: 'accept' | 'reject',
): Promise<boolean> {
	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) return false

	try {
		const res = await requestApi('/api/friends/respond', {
			method: 'POST',
			body: {
				username: user.username,
				requestId,
				action,
			},
		})
		const { routeMissing, data } = await isRouteNotFoundResponse(res)
		if (!routeMissing) {
			if (res.ok && data.success) {
				await refreshFriendsList(true)
				return true
			}
			return false
		}

		// Облачный фоллбэк
		const req = state.incomingRequests.find((r) => r.id === requestId)
		const peerUsername = req?.username
		await writeCloudUserSocial(user.username, (box) => {
			const targetReq = box.incomingRequests.find((r) => r.id === requestId)
			const senderName = targetReq?.username || peerUsername
			box.incomingRequests = box.incomingRequests.filter((r) => r.id !== requestId)
			if (
				action === 'accept' &&
				senderName &&
				!box.friends.some((f) => f.toLowerCase() === senderName.toLowerCase())
			) {
				box.friends.push(senderName)
			}
		})

		if (peerUsername) {
			await writeCloudUserSocial(peerUsername, (box) => {
				box.outgoingRequests = box.outgoingRequests.filter(
					(r) =>
						r.id !== requestId &&
						r.username.toLowerCase() !== user.username.toLowerCase(),
				)
				if (
					action === 'accept' &&
					!box.friends.some((f) => f.toLowerCase() === user.username.toLowerCase())
				) {
					box.friends.push(user.username)
				}
			})
		}

		await refreshFriendsList(true)
		return true
	} catch {
		return false
	}
}

export async function cancelFriendRequest(requestId: string): Promise<boolean> {
	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) return false

	try {
		const res = await requestApi('/api/friends/cancel', {
			method: 'POST',
			body: {
				username: user.username,
				requestId,
			},
		})
		const { routeMissing } = await isRouteNotFoundResponse(res)
		if (!routeMissing) {
			if (res.ok) {
				state.outgoingRequests = state.outgoingRequests.filter((r) => r.id !== requestId)
				saveCache()
				return true
			}
			return false
		}

		const req = state.outgoingRequests.find((r) => r.id === requestId)
		const targetUsername = req?.username

		await writeCloudUserSocial(user.username, (box) => {
			box.outgoingRequests = box.outgoingRequests.filter((r) => r.id !== requestId)
		})

		if (targetUsername) {
			await writeCloudUserSocial(targetUsername, (box) => {
				box.incomingRequests = box.incomingRequests.filter(
					(r) =>
						r.id !== requestId &&
						r.username.toLowerCase() !== user.username.toLowerCase(),
				)
			})
		}

		state.outgoingRequests = state.outgoingRequests.filter((r) => r.id !== requestId)
		saveCache()
		return true
	} catch {
		return false
	}
}

export async function removeFriend(friendUsername: string): Promise<boolean> {
	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) return false

	try {
		const res = await requestApi('/api/friends/remove', {
			method: 'POST',
			body: {
				username: user.username,
				friendUsername,
			},
		})
		const { routeMissing } = await isRouteNotFoundResponse(res)
		if (!routeMissing) {
			if (res.ok) {
				state.friends = state.friends.filter(
					(f) => f.username.toLowerCase() !== friendUsername.toLowerCase(),
				)
				saveCache()
				return true
			}
			return false
		}

		await writeCloudUserSocial(user.username, (box) => {
			box.friends = box.friends.filter(
				(f) => f.toLowerCase() !== friendUsername.toLowerCase(),
			)
		})

		await writeCloudUserSocial(friendUsername, (box) => {
			box.friends = box.friends.filter(
				(f) => f.toLowerCase() !== user.username.toLowerCase(),
			)
		})

		state.friends = state.friends.filter(
			(f) => f.username.toLowerCase() !== friendUsername.toLowerCase(),
		)
		saveCache()
		return true
	} catch {
		return false
	}
}

export async function fetchFriendProfile(username: string): Promise<FriendProfileData | null> {
	try {
		const res = await requestApi(`/api/friends/profile/${encodeURIComponent(username.trim())}`)
		if (res.ok) {
			const data = await res.json()
			if (data.success && data.profile) {
				return data.profile as FriendProfileData
			}
		}

		const { routeMissing } = await isRouteNotFoundResponse(res)
		if (routeMissing) {
			const cloud = await readCloudUserSettingsAndSocial(username.trim())
			if (cloud) {
				const p = cloud.social.presence
				return {
					username: username.trim(),
					avatarUrl: `https://mc-heads.net/avatar/${encodeURIComponent(username.trim())}/64`,
					totalHours: p?.totalHours || 0,
					lastInstance: p?.gameInfo?.instanceName || null,
					lastServer: p?.gameInfo?.serverAddress || null,
					lastSeen: p?.lastSeen || null,
					friendsCount: cloud.social.friends.length,
				}
			}
		}
	} catch {}
	return null
}

/**
 * Живой Presence Heartbeat (синхронизирует статус "В сети" / "В игре", сборку и открытый LAN-туннель/сервер)
 */
export async function updatePresence(
	status?: FriendStatus,
	gameInfo?: FriendGameInfo,
): Promise<void> {
	if (status) {
		state.currentPresence.status = status
	}
	if (gameInfo !== undefined) {
		state.currentPresence.gameInfo = gameInfo
	} else if (status && status !== 'in_game') {
		state.currentPresence.gameInfo = undefined
	}

	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) return

	try {
		if (nativeSocialRoutesAvailable !== false) {
			const res = await requestApi('/api/friends/presence', {
				method: 'POST',
				body: {
					username: user.username,
					status: state.currentPresence.status,
					place: state.currentPresence.status === 'in_game' ? 'game' : 'launcher',
					gameInfo: state.currentPresence.gameInfo,
				},
			})

			const { routeMissing } = await isRouteNotFoundResponse(res)
			if (!routeMissing) {
				return
			}
		}

		await writeCloudUserSocial(user.username, (box) => {
			box.presence = {
				status: state.currentPresence.status,
				place: state.currentPresence.status === 'in_game' ? 'game' : 'launcher',
				lastSeen: Date.now(),
				totalHours: box.presence?.totalHours || 0,
				gameInfo: state.currentPresence.gameInfo,
			}
		})
	} catch {
		// ignore network hiccup
	}
}

// ============================================================================
// ЧАТЫ И ГРУППОВЫЕ КОМНАТЫ (Telegram-style)
// ============================================================================

export async function loadChatHistory(
	target?: { type: 'dm' | 'room'; id: string } | null,
): Promise<void> {
	if (!target || !target.type || !target.id) return
	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) return

	const key = getChatKey(target)
	if (!key) return
	const query =
		target.type === 'room'
			? `username=${encodeURIComponent(user.username)}&roomId=${encodeURIComponent(target.id)}`
			: `username=${encodeURIComponent(user.username)}&peer=${encodeURIComponent(target.id)}`

	try {
		const res = await requestApi(`/api/chat/history?${query}`)
		if (res.ok) {
			const data = await res.json()
			if (data.success && Array.isArray(data.messages)) {
				state.messagesByKey[key] = data.messages.map((m: ChatMessage) => ({
					...m,
					state: 'sent',
				}))
				if (typeof data.peerReadAt === 'number') {
					state.peerReadAtByKey[key] = data.peerReadAt
				}
				if (target.type === 'dm') {
					const fr = state.friends.find(
						(f) => f.username.toLowerCase() === target.id.toLowerCase(),
					)
					if (fr) fr.unread = 0
				} else {
					const rm = state.rooms.find((r) => r.id === target.id)
					if (rm) rm.unread = 0
				}
				saveCache()
				return
			}
		}

		const { routeMissing } = await isRouteNotFoundResponse(res)
		if (routeMissing) {
			const now = Date.now()
			const myCloud = await writeCloudUserSocial(user.username, (box) => {
				box.peerReadAtByKey[`self:${key}`] = now
			})
			if (myCloud) {
				const msgs = myCloud.messagesByKey[key] || []
				state.messagesByKey[key] = msgs.map((m) => ({ ...m, state: 'sent' }))
				if (myCloud.peerReadAtByKey[key]) {
					state.peerReadAtByKey[key] = myCloud.peerReadAtByKey[key]
				}
			}

			if (target.type === 'dm') {
				const peerKeyForMe = getChatKey({ type: 'dm', id: user.username })
				await writeCloudUserSocial(target.id, (peerBox) => {
					peerBox.peerReadAtByKey[peerKeyForMe] = now
				})
				const fr = state.friends.find(
					(f) => f.username.toLowerCase() === target.id.toLowerCase(),
				)
				if (fr) fr.unread = 0
			} else {
				const rm = state.rooms.find((r) => r.id === target.id)
				if (rm) rm.unread = 0
			}
			saveCache()
		}
	} catch (e) {
		console.warn('[Bedringh Chat] Ошибка загрузки истории чата:', e)
	}
}

export async function openChatTarget(target: { type: 'dm' | 'room'; id: string } | null): Promise<void> {
	state.activeChatTarget = target
	if (target && target.type && target.id) {
		await loadChatHistory(target)
	}
}

export async function sendChatMessage(params: {
	target: { type: 'dm' | 'room'; id: string }
	content?: string
	replyTo?: ChatMessageReply
	attachmentDataUrl?: string
	attachmentType?: 'image' | 'voice'
	voiceDuration?: number
	voicePeaks?: number[]
}): Promise<ChatMessage | null> {
	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) {
		throw new Error('Войдите в аккаунт Bedringh ID для отправки сообщений')
	}

	const key = getChatKey(params.target)
	if (!state.messagesByKey[key]) {
		state.messagesByKey[key] = []
	}

	const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
	const optimisticMsg: ChatMessage = {
		id: localId,
		localId,
		state: 'sending',
		roomId: params.target.type === 'room' ? params.target.id : undefined,
		sender: user.username,
		recipient: params.target.type === 'dm' ? params.target.id : undefined,
		content: params.content || '',
		replyTo: params.replyTo,
		attachmentUrl: params.attachmentDataUrl,
		attachmentType: params.attachmentType,
		voiceDuration: params.voiceDuration,
		voicePeaks: params.voicePeaks,
		reactions: {},
		createdAt: Date.now(),
	}

	state.messagesByKey[key].push(optimisticMsg)

	try {
		const res = await requestApi('/api/chat/send', {
			method: 'POST',
			body: {
				sender: user.username,
				recipient: params.target.type === 'dm' ? params.target.id : undefined,
				roomId: params.target.type === 'room' ? params.target.id : undefined,
				content: params.content || '',
				replyToId: params.replyTo?.id,
				attachmentDataUrl: params.attachmentDataUrl,
				attachmentType: params.attachmentType,
				voiceDuration: params.voiceDuration,
				voicePeaks: params.voicePeaks,
			},
		})

		const { routeMissing, data } = await isRouteNotFoundResponse(res)

		let serverMsg: ChatMessage
		if (!routeMissing) {
			if (!res.ok || !data.success || !data.message) {
				throw new Error(data.error || 'Ошибка отправки')
			}
			serverMsg = {
				...data.message,
				state: 'sent',
			}
		} else {
			// Облачный фоллбэк: сохраняем сообщение у отправителя и у получателя(ей)
			const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
			serverMsg = {
				...optimisticMsg,
				id: msgId,
				state: 'sent',
			}

			await writeCloudUserSocial(user.username, (box) => {
				if (!box.messagesByKey[key]) box.messagesByKey[key] = []
				box.messagesByKey[key].push(serverMsg)
				if (box.messagesByKey[key].length > 120) {
					box.messagesByKey[key] = box.messagesByKey[key].slice(-120)
				}
			})

			if (params.target.type === 'dm') {
				const peerKey = getChatKey({ type: 'dm', id: user.username })
				await writeCloudUserSocial(params.target.id, (peerBox) => {
					if (!peerBox.messagesByKey[peerKey]) peerBox.messagesByKey[peerKey] = []
					peerBox.messagesByKey[peerKey].push(serverMsg)
					if (peerBox.messagesByKey[peerKey].length > 120) {
						peerBox.messagesByKey[peerKey] = peerBox.messagesByKey[peerKey].slice(-120)
					}
				})
			} else {
				const room = state.rooms.find((r) => r.id === params.target.id)
				const otherMembers = (room?.members || []).filter(
					(m) => m.toLowerCase() !== user.username.toLowerCase(),
				)
				await Promise.all(
					otherMembers.map((member) =>
						writeCloudUserSocial(member, (memberBox) => {
							if (!memberBox.messagesByKey[key]) memberBox.messagesByKey[key] = []
							memberBox.messagesByKey[key].push(serverMsg)
							if (memberBox.messagesByKey[key].length > 120) {
								memberBox.messagesByKey[key] = memberBox.messagesByKey[key].slice(-120)
							}
						}),
					),
				)
			}
		}

		const list = state.messagesByKey[key]
		const idx = list.findIndex((m) => m.localId === localId || m.id === serverMsg.id)
		if (idx >= 0) {
			list[idx] = serverMsg
		} else {
			list.push(serverMsg)
		}

		updatePreviewAfterMessage(params.target, serverMsg)
		saveCache()
		return serverMsg
	} catch (e) {
		const list = state.messagesByKey[key]
		const item = list.find((m) => m.localId === localId)
		if (item) {
			item.state = 'failed'
		}
		saveCache()
		return null
	}
}

export async function retryFailedMessage(
	target: { type: 'dm' | 'room'; id: string },
	localId: string,
): Promise<void> {
	const key = getChatKey(target)
	const list = state.messagesByKey[key] || []
	const idx = list.findIndex((m) => m.localId === localId)
	if (idx === -1) return

	const failed = list[idx]
	list.splice(idx, 1)
	await sendChatMessage({
		target,
		content: failed.content,
		replyTo: failed.replyTo,
		attachmentDataUrl: failed.attachmentUrl,
		attachmentType: failed.attachmentType,
		voiceDuration: failed.voiceDuration,
		voicePeaks: failed.voicePeaks,
	})
}

export function dropFailedMessage(
	target: { type: 'dm' | 'room'; id: string },
	localId: string,
): void {
	const key = getChatKey(target)
	if (!state.messagesByKey[key]) return
	state.messagesByKey[key] = state.messagesByKey[key].filter((m) => m.localId !== localId)
	saveCache()
}

function updatePreviewAfterMessage(
	target: { type: 'dm' | 'room'; id: string },
	msg: ChatMessage,
) {
	let preview = msg.content
	if (preview.startsWith(MC_INVITE_PREFIX)) preview = 'Приглашение на сервер'
	else if (!preview && msg.attachmentType === 'voice') preview = 'Голосовое сообщение'
	else if (!preview && msg.attachmentType === 'image') preview = 'Изображение'

	if (target.type === 'dm') {
		const fr = state.friends.find(
			(f) => f.username.toLowerCase() === target.id.toLowerCase(),
		)
		if (fr) {
			fr.lastMessage = preview
			fr.lastMessageSender = msg.sender
			fr.lastMessageAt = msg.createdAt
		}
	} else {
		const rm = state.rooms.find((r) => r.id === target.id)
		if (rm) {
			rm.lastMessage = preview
			rm.lastMessageSender = msg.sender
			rm.lastMessageAt = msg.createdAt
		}
	}
}

export async function editChatMessage(
	target: { type: 'dm' | 'room'; id: string },
	messageId: string,
	newContent: string,
): Promise<boolean> {
	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) return false

	const key = getChatKey(target)
	const trimmedContent = newContent.trim()
	const editedAt = Date.now()

	try {
		const res = await requestApi('/api/chat/edit', {
			method: 'POST',
			body: {
				username: user.username,
				messageId,
				content: trimmedContent,
			},
		})
		const { routeMissing, data } = await isRouteNotFoundResponse(res)
		if (!routeMissing) {
			if (res.ok && data.success) {
				const msg = state.messagesByKey[key]?.find((m) => m.id === messageId)
				if (msg) {
					msg.content = trimmedContent
					msg.editedAt = data.message?.editedAt || editedAt
					saveCache()
				}
				return true
			}
			return false
		}

		// Облачный фоллбэк
		const msg = state.messagesByKey[key]?.find((m) => m.id === messageId)
		if (msg) {
			msg.content = trimmedContent
			msg.editedAt = editedAt
			saveCache()
		}

		await writeCloudUserSocial(user.username, (box) => {
			const m = box.messagesByKey[key]?.find((item) => item.id === messageId)
			if (m) {
				m.content = trimmedContent
				m.editedAt = editedAt
			}
		})

		if (target.type === 'dm') {
			const peerKey = getChatKey({ type: 'dm', id: user.username })
			await writeCloudUserSocial(target.id, (peerBox) => {
				const m = peerBox.messagesByKey[peerKey]?.find((item) => item.id === messageId)
				if (m) {
					m.content = trimmedContent
					m.editedAt = editedAt
				}
			})
		}
		return true
	} catch {}
	return false
}

export async function deleteChatMessage(
	target: { type: 'dm' | 'room'; id: string },
	messageId: string,
): Promise<boolean> {
	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) return false

	const key = getChatKey(target)

	try {
		const res = await requestApi('/api/chat/delete', {
			method: 'POST',
			body: {
				username: user.username,
				messageId,
			},
		})
		const { routeMissing } = await isRouteNotFoundResponse(res)
		if (!routeMissing) {
			if (res.ok) {
				if (state.messagesByKey[key]) {
					state.messagesByKey[key] = state.messagesByKey[key].filter((m) => m.id !== messageId)
					saveCache()
				}
				return true
			}
			return false
		}

		if (state.messagesByKey[key]) {
			state.messagesByKey[key] = state.messagesByKey[key].filter((m) => m.id !== messageId)
			saveCache()
		}

		await writeCloudUserSocial(user.username, (box) => {
			if (box.messagesByKey[key]) {
				box.messagesByKey[key] = box.messagesByKey[key].filter((m) => m.id !== messageId)
			}
		})

		if (target.type === 'dm') {
			const peerKey = getChatKey({ type: 'dm', id: user.username })
			await writeCloudUserSocial(target.id, (peerBox) => {
				if (peerBox.messagesByKey[peerKey]) {
					peerBox.messagesByKey[peerKey] = peerBox.messagesByKey[peerKey].filter(
						(m) => m.id !== messageId,
					)
				}
			})
		}
		return true
	} catch {}
	return false
}

export async function toggleMessageReaction(
	target: { type: 'dm' | 'room'; id: string },
	messageId: string,
	reaction: string,
): Promise<void> {
	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) return

	const key = getChatKey(target)
	const msg = state.messagesByKey[key]?.find((m) => m.id === messageId)
	if (msg) {
		if (!msg.reactions) msg.reactions = {}
		const list = msg.reactions[reaction] ? [...msg.reactions[reaction]] : []
		const idx = list.findIndex((u) => u.toLowerCase() === user.username.toLowerCase())
		if (idx >= 0) {
			list.splice(idx, 1)
			if (list.length === 0) delete msg.reactions[reaction]
			else msg.reactions[reaction] = list
		} else {
			msg.reactions[reaction] = [...list, user.username]
		}
	}

	try {
		const res = await requestApi('/api/chat/react', {
			method: 'POST',
			body: {
				username: user.username,
				messageId,
				reaction,
			},
		})
		const { routeMissing, data } = await isRouteNotFoundResponse(res)
		if (!routeMissing) {
			if (res.ok && data.reactions && msg) {
				msg.reactions = data.reactions
				saveCache()
			}
			return
		}

		if (msg) {
			const nextReactions = JSON.parse(JSON.stringify(msg.reactions || {}))
			await writeCloudUserSocial(user.username, (box) => {
				const m = box.messagesByKey[key]?.find((item) => item.id === messageId)
				if (m) m.reactions = nextReactions
			})
			if (target.type === 'dm') {
				const peerKey = getChatKey({ type: 'dm', id: user.username })
				await writeCloudUserSocial(target.id, (peerBox) => {
					const m = peerBox.messagesByKey[peerKey]?.find((item) => item.id === messageId)
					if (m) m.reactions = nextReactions
				})
			}
			saveCache()
		}
	} catch {}
}

let lastTypingSentAt = 0
export async function sendTypingPing(target: { type: 'dm' | 'room'; id: string }): Promise<void> {
	const now = Date.now()
	if (now - lastTypingSentAt < 2500) return
	lastTypingSentAt = now

	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) return

	try {
		await requestApi('/api/chat/typing', {
			method: 'POST',
			body: {
				username: user.username,
				peer: target.type === 'dm' ? target.id : undefined,
				roomId: target.type === 'room' ? target.id : undefined,
			},
		})
	} catch {}
}

export async function createChatRoom(title: string, members: string[]): Promise<ChatRoom | null> {
	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) return null

	try {
		const res = await requestApi('/api/rooms/create', {
			method: 'POST',
			body: {
				owner: user.username,
				title: title.trim(),
				members,
			},
		})
		const { routeMissing, data } = await isRouteNotFoundResponse(res)
		if (!routeMissing) {
			if (res.ok && data.success && data.room) {
				state.rooms.unshift(data.room)
				saveCache()
				return data.room
			}
			return null
		}

		const allMembers = Array.from(new Set([user.username, ...members]))
		const room: ChatRoom = {
			id: `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
			title: title.trim(),
			owner: user.username,
			members: allMembers,
			unread: 0,
			createdAt: Date.now(),
		}

		await Promise.all(
			allMembers.map((member) =>
				writeCloudUserSocial(member, (box) => {
					if (!box.rooms.some((r) => r.id === room.id)) {
						box.rooms.unshift(room)
					}
				}),
			),
		)

		state.rooms.unshift(room)
		saveCache()
		return room
	} catch {}
	return null
}

export async function leaveChatRoom(roomId: string): Promise<boolean> {
	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) return false

	try {
		const res = await requestApi('/api/rooms/leave', {
			method: 'POST',
			body: {
				username: user.username,
				roomId,
			},
		})
		const { routeMissing } = await isRouteNotFoundResponse(res)
		if (!routeMissing) {
			if (res.ok) {
				state.rooms = state.rooms.filter((r) => r.id !== roomId)
				if (state.activeChatTarget?.type === 'room' && state.activeChatTarget.id === roomId) {
					state.activeChatTarget = null
				}
				saveCache()
				return true
			}
			return false
		}

		await writeCloudUserSocial(user.username, (box) => {
			box.rooms = box.rooms.filter((r) => r.id !== roomId)
		})

		state.rooms = state.rooms.filter((r) => r.id !== roomId)
		if (state.activeChatTarget?.type === 'room' && state.activeChatTarget.id === roomId) {
			state.activeChatTarget = null
		}
		saveCache()
		return true
	} catch {}
	return false
}

// ============================================================================
// УМНЫЕ ПРИГЛАШЕНИЯ «ПОЗВАТЬ ИГРАТЬ» (Play Invite & Pending InviteChip)
// ============================================================================

export function setPendingPlayInvite(target: PendingPlayInviteTarget | null) {
	state.pendingPlayInvite = target
	try {
		if (target) {
			localStorage.setItem(LOCAL_STORAGE_PENDING_INVITE_KEY, JSON.stringify(target))
		} else {
			localStorage.removeItem(LOCAL_STORAGE_PENDING_INVITE_KEY)
		}
	} catch {}
}

export async function sendServerInviteToTarget(
	target: { type: 'dm' | 'room'; id: string },
	invite: McInvitePayload,
): Promise<ChatMessage | null> {
	return await sendChatMessage({
		target,
		content: encodeMcInvite(invite),
	})
}

export async function deliverPendingPlayInvite(
	invite: McInvitePayload,
): Promise<{ deliveredTo: string; target: { type: 'dm' | 'room'; id: string } } | null> {
	const pending = state.pendingPlayInvite
	if (!pending) return null

	setPendingPlayInvite(null)
	const target = { type: pending.type, id: pending.id }
	await sendServerInviteToTarget(target, invite)
	return {
		deliveredTo: pending.title,
		target,
	}
}

// ============================================================================
// REALTIME SSE + POLLING
// ============================================================================

let eventSource: EventSource | null = null

async function connectSocialSSE() {
	if (nativeSocialRoutesAvailable === false) return

	const user = await resolveActiveBedringhUser()
	if (!user || !user.username) return

	if (eventSource) {
		try {
			eventSource.close()
		} catch {}
		eventSource = null
	}

	try {
		const url = `${activeApiBase}/api/social/stream?username=${encodeURIComponent(user.username)}`
		const es = new EventSource(url)
		eventSource = es

		es.onerror = () => {
			if (nativeSocialRoutesAvailable === false) {
				try {
					es.close()
				} catch {}
				if (eventSource === es) {
					eventSource = null
				}
			}
		}

		es.addEventListener('chat_message', (ev: MessageEvent) => {
			try {
				const msg = JSON.parse(ev.data) as ChatMessage
				msg.state = 'sent'
				const isRoom = Boolean(msg.roomId)
				const myNameLower = user.username.toLowerCase()
				const peerName =
					msg.sender.toLowerCase() === myNameLower ? msg.recipient || '' : msg.sender
				const target: { type: 'dm' | 'room'; id: string } = isRoom
					? { type: 'room', id: msg.roomId! }
					: { type: 'dm', id: peerName }

				const key = getChatKey(target)
				if (!state.messagesByKey[key]) state.messagesByKey[key] = []
				const list = state.messagesByKey[key]
				if (!list.some((m) => m.id === msg.id)) {
					list.push(msg)
				}

				updatePreviewAfterMessage(target, msg)

				const isCurrentlyOpen =
					state.activeChatTarget && getChatKey(state.activeChatTarget) === key

				if (msg.sender.toLowerCase() !== myNameLower) {
					if (!isCurrentlyOpen) {
						if (target.type === 'dm') {
							const fr = state.friends.find(
								(f) => f.username.toLowerCase() === target.id.toLowerCase(),
							)
							if (fr) fr.unread = (fr.unread || 0) + 1
						} else {
							const rm = state.rooms.find((r) => r.id === target.id)
							if (rm) rm.unread = (rm.unread || 0) + 1
						}
					}

					const parsedInvite = parseMcInvite(msg.content)
					pushSocialToast({
						kind: parsedInvite ? 'invite' : 'message',
						title: parsedInvite
							? `${msg.sender} зовёт на сервер!`
							: `Сообщение от ${msg.sender}`,
						subtitle: parsedInvite
							? `${parsedInvite.name} (${parsedInvite.addr})`
							: msg.content || 'Вложение',
						username: msg.sender,
						roomId: msg.roomId,
						invite: parsedInvite || undefined,
					})
				}
				saveCache()
			} catch {}
		})

		es.addEventListener('chat_edit', (ev: MessageEvent) => {
			try {
				const updated = JSON.parse(ev.data) as ChatMessage
				for (const list of Object.values(state.messagesByKey)) {
					const found = list.find((m) => m.id === updated.id)
					if (found) {
						found.content = updated.content
						found.editedAt = updated.editedAt
					}
				}
				saveCache()
			} catch {}
		})

		es.addEventListener('chat_delete', (ev: MessageEvent) => {
			try {
				const data = JSON.parse(ev.data) as { id: string }
				for (const key of Object.keys(state.messagesByKey)) {
					state.messagesByKey[key] = state.messagesByKey[key].filter((m) => m.id !== data.id)
				}
				saveCache()
			} catch {}
		})

		es.addEventListener('chat_react', (ev: MessageEvent) => {
			try {
				const data = JSON.parse(ev.data) as {
					id: string
					reactions: Record<string, string[]>
				}
				for (const list of Object.values(state.messagesByKey)) {
					const found = list.find((m) => m.id === data.id)
					if (found) {
						found.reactions = data.reactions
					}
				}
				saveCache()
			} catch {}
		})

		es.addEventListener('chat_read', (ev: MessageEvent) => {
			try {
				const data = JSON.parse(ev.data) as { reader: string; readAt: number }
				const key = getChatKey({ type: 'dm', id: data.reader })
				state.peerReadAtByKey[key] = data.readAt
			} catch {}
		})

		es.addEventListener('chat_typing', (ev: MessageEvent) => {
			try {
				const data = JSON.parse(ev.data) as { sender: string; roomId?: string }
				const key = data.roomId
					? getChatKey({ type: 'room', id: data.roomId })
					: getChatKey({ type: 'dm', id: data.sender })
				const existing = state.typingByKey[key]?.senders || []
				const nextSenders = Array.from(new Set([...existing, data.sender]))
				state.typingByKey[key] = {
					senders: nextSenders,
					expiresAt: Date.now() + 4000,
				}
				setTimeout(() => {
					const cur = state.typingByKey[key]
					if (cur && Date.now() >= cur.expiresAt) {
						delete state.typingByKey[key]
					}
				}, 4100)
			} catch {}
		})

		es.addEventListener('friend_request', (ev: MessageEvent) => {
			try {
				const data = JSON.parse(ev.data)
				pushSocialToast({
					kind: 'friend_request',
					title: 'Новая заявка в друзья',
					subtitle: `${data.username} хочет добавить вас в друзья`,
					username: data.username,
				})
				void refreshFriendsList(true)
			} catch {}
		})

		es.addEventListener('friend_accepted', () => {
			void refreshFriendsList(true)
		})

		es.addEventListener('friend_removed', () => {
			void refreshFriendsList(true)
		})

		es.addEventListener('presence_update', () => {
			void refreshFriendsList(true)
		})

		es.addEventListener('room_updated', () => {
			void refreshFriendsList(true)
		})
	} catch {
		// Fallback to polling
	}
}

export function startFriendsPolling(): void {
	if (state.pollingInterval) {
		return
	}

	void (async () => {
		await refreshFriendsList(true)
		await updatePresence()
		if (nativeSocialRoutesAvailable === true) {
			await connectSocialSSE()
		}
	})()

	state.pollingInterval = setInterval(() => {
		void refreshFriendsList(true)
	}, 10_000)

	state.presenceInterval = setInterval(() => {
		void updatePresence()
	}, 25_000)
}

export function stopFriendsPolling(): void {
	if (state.pollingInterval) {
		clearInterval(state.pollingInterval)
		state.pollingInterval = null
	}
	if (state.presenceInterval) {
		clearInterval(state.presenceInterval)
		state.presenceInterval = null
	}
	if (eventSource) {
		try {
			eventSource.close()
		} catch {}
		eventSource = null
	}
}

export function useBedringhFriends() {
	const totalIncoming = computed(() => state.incomingRequests.length)
	const totalUnreadMessages = computed(() => {
		const dmUnread = state.friends.reduce((acc, f) => acc + (f.unread || 0), 0)
		const roomUnread = state.rooms.reduce((acc, r) => acc + (r.unread || 0), 0)
		return dmUnread + roomUnread
	})
	const totalSocialBadge = computed(() => totalIncoming.value + totalUnreadMessages.value)

	const onlineFriendsCount = computed(
		() => state.friends.filter((f) => f.status === 'online' || f.status === 'in_game').length,
	)

	return {
		state,
		totalIncoming,
		totalUnreadMessages,
		totalSocialBadge,
		onlineFriendsCount,
		refreshFriendsList,
		searchBedringhUsers,
		sendFriendRequest,
		respondFriendRequest,
		cancelFriendRequest,
		removeFriend,
		fetchFriendProfile,
		updatePresence,
		loadChatHistory,
		openChatTarget,
		sendChatMessage,
		retryFailedMessage,
		dropFailedMessage,
		editChatMessage,
		deleteChatMessage,
		toggleMessageReaction,
		sendTypingPing,
		createChatRoom,
		leaveChatRoom,
		setPendingPlayInvite,
		sendServerInviteToTarget,
		deliverPendingPlayInvite,
		dismissSocialToast,
		startFriendsPolling,
		stopFriendsPolling,
	}
}

export const initFriendsService = startFriendsPolling
export const updateMyPresence = updatePresence
