import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import {
	list_synced_servers,
	rebuild_synced_options,
	update_synced_server,
	type SyncedServer,
} from '@/helpers/instance'
import { getActiveBedringhUser } from './bedringh-settings-sync'

const API_CANDIDATES = [
	'http://127.0.0.1:3100',
	'http://localhost:3100',
	'http://2.26.87.126:3100',
	'https://oskarlolpo.play2go.cloud',
	'http://oskarlolpo.play2go.cloud:3100',
]

let activeApiBase = API_CANDIDATES[0]

async function safeFetch(url: string, init: any) {
	try {
		return await window.fetch(url, init)
	} catch (nativeErr) {
		console.warn('[Bedringh Servers Sync] Native fetch failed, trying tauriFetch fallback:', nativeErr)
	}

	try {
		return await tauriFetch(url, init)
	} catch (tauriErr) {
		console.error('[Bedringh Servers Sync] Tauri fetch also failed:', tauriErr)
		throw tauriErr
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
		if (res && res.status !== 502 && res.status !== 503) {
			return res
		}
	} catch (e) {
		console.warn(`[Bedringh Servers Sync] Failed to connect to ${activeApiBase}${endpoint}:`, e)
	}

	for (const candidate of API_CANDIDATES) {
		if (candidate === activeApiBase) continue
		try {
			const res = await safeFetch(`${candidate}${endpoint}`, { method, headers, body })
			if (res && res.status !== 502 && res.status !== 503) {
				activeApiBase = candidate
				return res
			}
		} catch (e) {
			console.warn(`[Bedringh Servers Sync] Candidate ${candidate} failed:`, e)
		}
	}

	throw new Error('Не удалось подключиться к серверу авторизации Bedringh')
}

/**
 * Получить список серверов игрока из облака Bedringh ID
 */
export async function fetchRemoteServers(username: string, token?: string): Promise<SyncedServer[] | null> {
	try {
		const headers: Record<string, string> = {}
		if (token) {
			headers['Authorization'] = `Bearer ${token}`
		}

		const res = await requestApi(`/api/user/servers?username=${encodeURIComponent(username)}`, {
			method: 'GET',
			headers,
		})

		if (!res.ok) {
			console.warn(`[Bedringh Servers Sync] HTTP ${res.status} при получении серверов`)
			return null
		}

		const data = await res.json()
		if (data.success && Array.isArray(data.servers)) {
			return data.servers as SyncedServer[]
		}
		return null
	} catch (e) {
		console.warn('[Bedringh Servers Sync] Ошибка загрузки серверов из облака:', e)
		return null
	}
}

/**
 * Отправить список серверов в облако Bedringh ID
 */
export async function pushRemoteServersNow(username: string, token?: string, servers?: SyncedServer[]): Promise<boolean> {
	try {
		const list = servers || await list_synced_servers()
		const headers: Record<string, string> = {}
		if (token) {
			headers['Authorization'] = `Bearer ${token}`
		}

		const res = await requestApi('/api/user/servers', {
			method: 'POST',
			headers,
			body: {
				username,
				authToken: token,
				servers: list,
			},
		})

		const data = await res.json()
		return Boolean(data.success)
	} catch (e) {
		console.warn('[Bedringh Servers Sync] Не удалось отправить серверы в облако:', e)
		return false
	}
}

let pushDebounceTimer: any = null

/**
 * Отправить список серверов в облако с дебаунсом (при изменении в настройках)
 */
export function pushRemoteServersDebounced(servers?: SyncedServer[], delayMs = 1500): void {
	const user = getActiveBedringhUser()
	if (!user || !user.username) return

	if (pushDebounceTimer) {
		clearTimeout(pushDebounceTimer)
	}

	pushDebounceTimer = setTimeout(async () => {
		try {
			await pushRemoteServersNow(user.username, user.token, servers)
		} catch (e) {
			console.warn('[Bedringh Servers Sync] Ошибка фоновой отправки серверов:', e)
		}
	}, delayMs)
}

/**
 * Полный цикл слияния серверов при входе в Bedringh ID:
 * 1. Загружаем удаленные серверы.
 * 2. Получаем локальные серверы.
 * 3. Объединяем их без дубликатов по адресу сервера (ip:port).
 * 4. Записываем недостающие в локальный лаунчер и в облако.
 */
export async function syncServersOnLogin(username: string, token?: string): Promise<void> {
	if (!username) return

	try {
		console.log(`[Bedringh Servers Sync] Синхронизация списка серверов для ${username}...`)
		const remoteServers = await fetchRemoteServers(username, token)
		const localServers = await list_synced_servers().catch(() => [] as SyncedServer[])

		const addressMap = new Map<string, SyncedServer>()

		// Сначала добавляем удаленные серверы
		if (remoteServers) {
			for (const s of remoteServers) {
				const normAddr = s.address.trim().toLowerCase()
				if (normAddr) {
					addressMap.set(normAddr, s)
				}
			}
		}

		// Затем объединяем с локальными серверами
		let localAdded = false
		for (const s of localServers) {
			const normAddr = s.address.trim().toLowerCase()
			if (normAddr && !addressMap.has(normAddr)) {
				addressMap.set(normAddr, s)
				localAdded = true
			}
		}

		const mergedList = Array.from(addressMap.values())

		// Если с сервера пришли серверы, которых не было локально, обновляем локальный лаунчер
		let localUpdated = false
		for (const s of mergedList) {
			const exists = localServers.some(
				(ls) => ls.address.trim().toLowerCase() === s.address.trim().toLowerCase(),
			)
			if (!exists) {
				await update_synced_server(s).catch(console.warn)
				localUpdated = true
			}
		}

		if (localUpdated) {
			await rebuild_synced_options().catch(console.warn)
			console.log('[Bedringh Servers Sync] Локальные серверы обновлены из облака Bedringh ID!')
		}

		// Выгружаем итоговый объединенный список в облако
		if (localAdded || !remoteServers || remoteServers.length === 0) {
			await pushRemoteServersNow(username, token, mergedList)
		}
	} catch (e) {
		console.error('[Bedringh Servers Sync] Ошибка синхронизации серверов:', e)
	}
}

/**
 * Проверка серверов при старте лаунчера
 */
export async function syncServersOnStartup(): Promise<void> {
	const user = getActiveBedringhUser()
	if (!user || !user.username) return
	await syncServersOnLogin(user.username, user.token)
}
