import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { get as getLocalSettings, set as setLocalSettings, type AppSettings } from '@/helpers/settings'
import { useAppSettings } from '@/composables/use-app-settings'
import { useTheme } from '@/composables/use-theme'
import i18n from '@/i18n.config'

const API_CANDIDATES = [
	'http://2.26.87.126:3100',
	'https://oskarlolpo.play2go.cloud',
	'http://oskarlolpo.play2go.cloud:3100',
]

let activeApiBase = API_CANDIDATES[0]

const STORAGE_ACTIVE_USER_KEY = 'bedringh_active_username'
const STORAGE_USER_TOKEN_PREFIX = 'bedringh_token_'

async function safeFetch(url: string, init: any) {
	try {
		return await window.fetch(url, init)
	} catch (nativeErr) {
		console.warn('[Bedringh Settings Sync] Native fetch failed, trying tauriFetch fallback:', nativeErr)
	}

	try {
		return await tauriFetch(url, init)
	} catch (tauriErr) {
		console.error('[Bedringh Settings Sync] Tauri fetch also failed:', tauriErr)
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
		console.warn(`[Bedringh Settings Sync] Failed to connect to ${activeApiBase}${endpoint}:`, e)
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
			console.warn(`[Bedringh Settings Sync] Candidate ${candidate} failed:`, e)
		}
	}

	throw new Error('Не удалось подключиться к серверу авторизации Bedringh')
}

export function setActiveBedringhUser(username: string, token?: string): void {
	if (!username) return
	localStorage.setItem(STORAGE_ACTIVE_USER_KEY, username)
	if (token) {
		localStorage.setItem(`${STORAGE_USER_TOKEN_PREFIX}${username.toLowerCase()}`, token)
	}
}

export function getActiveBedringhUser(): { username: string; token?: string } | null {
	const username = localStorage.getItem(STORAGE_ACTIVE_USER_KEY)
	if (!username) return null
	const token = localStorage.getItem(`${STORAGE_USER_TOKEN_PREFIX}${username.toLowerCase()}`) || undefined
	return { username, token }
}

export function clearActiveBedringhUser(): void {
	localStorage.removeItem(STORAGE_ACTIVE_USER_KEY)
}

/**
 * Получить сохраненные настройки пользователя с сервера
 */
export async function fetchRemoteSettings(username: string, token?: string): Promise<Partial<AppSettings> | null> {
	try {
		const headers: Record<string, string> = {}
		if (token) {
			headers['Authorization'] = `Bearer ${token}`
		}

		const res = await requestApi(`/api/user/settings?username=${encodeURIComponent(username)}`, {
			method: 'GET',
			headers,
		})

		if (!res.ok) {
			console.warn(`[Bedringh Settings Sync] HTTP ${res.status} при получении настроек`)
			return null
		}

		const data = await res.json()
		if (data.success && data.settings && typeof data.settings === 'object') {
			console.log('[Bedringh Settings Sync] Настройки успешно получены с сервера:', data.settings)
			return data.settings as Partial<AppSettings>
		}

		return null
	} catch (e) {
		console.warn('[Bedringh Settings Sync] Ошибка загрузки настроек с сервера:', e)
		return null
	}
}

/**
 * Применить настройки из облака в локальную базу данных лаунчера и реактивные модули UI
 */
export async function applyRemoteSettings(remoteSettings: Partial<AppSettings>): Promise<void> {
	try {
		const current = await getLocalSettings()

		// Объединяем настройки, защищая локальный путь к директории инстансов от затирания несуществующим путем
		const merged: AppSettings = {
			...current,
			...remoteSettings,
			custom_dir: current.custom_dir || remoteSettings.custom_dir || null,
			prev_custom_dir: current.prev_custom_dir || remoteSettings.prev_custom_dir || null,
		}

		// Сохраняем в локальную базу данных Theseus
		await setLocalSettings(merged)

		// Применяем реактивное состояние темы
		const appTheme = useTheme()
		if (merged.theme) {
			appTheme.preferred = merged.theme
		}
		if (merged.advanced_rendering !== undefined) {
			appTheme.advancedRendering = merged.advanced_rendering
		}
		if (merged.sync_theme_across_devices !== undefined) {
			appTheme.syncAcrossDevices = merged.sync_theme_across_devices
		}

		// Применяем реактивное состояние приложения
		const appSettings = useAppSettings()
		if (merged.sync_behavior_across_devices !== undefined) {
			appSettings.syncBehaviorAcrossDevices = merged.sync_behavior_across_devices
		}
		if (merged.hide_nametag_skins_page !== undefined) {
			appSettings.hideNametagSkinsPage = merged.hide_nametag_skins_page
		}
		if (merged.toggle_sidebar !== undefined) {
			appSettings.toggleSidebar = merged.toggle_sidebar
		}
		if (merged.developer_mode !== undefined) {
			appSettings.devMode = merged.developer_mode
		}
		if (merged.feature_flags) {
			Object.assign(appSettings.featureFlags, merged.feature_flags)
		}

		// Применяем локаль
		if (merged.locale && i18n?.global) {
			i18n.global.locale.value = merged.locale as any
		}

		console.log('[Bedringh Settings Sync] Облачные настройки успешно применены в лаунчере!')
	} catch (e) {
		console.error('[Bedringh Settings Sync] Ошибка применения облачных настроек:', e)
	}
}

let pushDebounceTimer: any = null

/**
 * Отправить настройки на сервер Bedringh ID (с дебаунсом)
 */
export function pushRemoteSettingsDebounced(username: string, token?: string, settings?: AppSettings, delayMs = 1500): void {
	if (pushDebounceTimer) {
		clearTimeout(pushDebounceTimer)
	}

	pushDebounceTimer = setTimeout(async () => {
		try {
			await pushRemoteSettingsNow(username, token, settings)
		} catch (e) {
			console.warn('[Bedringh Settings Sync] Ошибка фоновой отправки настроек:', e)
		}
	}, delayMs)
}

/**
 * Немедленная отправка настроек на сервер
 */
export async function pushRemoteSettingsNow(username: string, token?: string, settings?: AppSettings): Promise<boolean> {
	try {
		const payload = settings || await getLocalSettings()
		const headers: Record<string, string> = {}
		if (token) {
			headers['Authorization'] = `Bearer ${token}`
		}

		const res = await requestApi('/api/user/settings', {
			method: 'POST',
			headers,
			body: {
				username,
				authToken: token,
				settings: payload,
			},
		})

		const data = await res.json()
		if (data.success) {
			console.log('[Bedringh Settings Sync] Настройки успешно сохранены в профиль Bedringh ID!')
			return true
		}
		return false
	} catch (e) {
		console.warn('[Bedringh Settings Sync] Не удалось отправить настройки на сервер:', e)
		return false
	}
}

/**
 * Полный цикл синхронизации при входе в Bedringh ID:
 * Если на сервере уже есть настройки — загружаем и применяем.
 * Если на сервере еще нет настроек — выгружаем текущие настройки лаунчера в облако.
 */
export async function syncOnLogin(username: string, token?: string): Promise<void> {
	if (!username) return
	setActiveBedringhUser(username, token)

	console.log(`[Bedringh Settings Sync] Запуск синхронизации при входе для ${username}...`)
	const remote = await fetchRemoteSettings(username, token)

	if (remote && Object.keys(remote).length > 0) {
		await applyRemoteSettings(remote)
	} else {
		console.log('[Bedringh Settings Sync] На сервере ещё нет сохраненных настроек, сохраняем текущие...')
		const current = await getLocalSettings()
		await pushRemoteSettingsNow(username, token, current)
	}
}

/**
 * Проверка и мягкая синхронизация при запуске лаунчера
 */
export async function syncOnStartup(): Promise<void> {
	const user = getActiveBedringhUser()
	if (!user || !user.username) {
		return
	}

	console.log(`[Bedringh Settings Sync] Проверка обновлений настроек для ${user.username} при старте лаунчера...`)
	const remote = await fetchRemoteSettings(user.username, user.token)
	if (remote && Object.keys(remote).length > 0) {
		await applyRemoteSettings(remote)
	}
}
