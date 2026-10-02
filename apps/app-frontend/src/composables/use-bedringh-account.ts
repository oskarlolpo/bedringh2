import { ref, computed } from 'vue'
import {
	getActiveBedringhUser,
	setActiveBedringhUser,
	clearActiveBedringhUser,
	resolveActiveBedringhUser,
} from '@/services/bedringh-settings-sync'

export interface BedringhAccount {
	username: string
	token?: string
	avatarUrl: string
}

const STORAGE_PREFERRED_PROFILE_KEY = 'bedringh_preferred_platform_profile'
const STORAGE_STORED_ACCOUNTS_KEY = 'bedringh_stored_accounts_v1'

const activeBedringhAccount = ref<BedringhAccount | null>(null)
const storedBedringhAccounts = ref<BedringhAccount[]>([])
const preferredProfile = ref<'bedringh' | 'modrinth'>('bedringh')
let isInitialized = false

function getAvatarUrl(username: string): string {
	return `https://mc-heads.net/avatar/${encodeURIComponent(username)}/64`
}

function loadStoredAccountsFromStorage(): BedringhAccount[] {
	if (typeof localStorage === 'undefined') return []
	try {
		const raw = localStorage.getItem(STORAGE_STORED_ACCOUNTS_KEY)
		if (raw) {
			const parsed = JSON.parse(raw)
			if (Array.isArray(parsed)) {
				return parsed.map((item) => ({
					username: item.username,
					token: item.token,
					avatarUrl: item.avatarUrl || getAvatarUrl(item.username),
				}))
			}
		}
	} catch (e) {
		console.warn('[useBedringhAccount] Ошибка чтения сохраненных аккаунтов:', e)
	}
	return []
}

function saveStoredAccountsToStorage(accounts: BedringhAccount[]) {
	if (typeof localStorage === 'undefined') return
	try {
		localStorage.setItem(STORAGE_STORED_ACCOUNTS_KEY, JSON.stringify(accounts))
	} catch (e) {
		console.warn('[useBedringhAccount] Ошибка сохранения аккаунтов:', e)
	}
}

export function useBedringhAccount() {
	async function refreshAccount(): Promise<BedringhAccount | null> {
		const user = await resolveActiveBedringhUser()
		if (user && user.username) {
			const acc: BedringhAccount = {
				username: user.username,
				token: user.token,
				avatarUrl: getAvatarUrl(user.username),
			}
			activeBedringhAccount.value = acc
			addOrUpdateStoredAccount(acc.username, acc.token)
		} else {
			activeBedringhAccount.value = null
		}
		return activeBedringhAccount.value
	}

	function addOrUpdateStoredAccount(username: string, token?: string) {
		if (!username) return
		const existingIndex = storedBedringhAccounts.value.findIndex(
			(a) => a.username.toLowerCase() === username.toLowerCase(),
		)
		const accountObj: BedringhAccount = {
			username,
			token,
			avatarUrl: getAvatarUrl(username),
		}
		if (existingIndex >= 0) {
			storedBedringhAccounts.value[existingIndex] = accountObj
		} else {
			storedBedringhAccounts.value.push(accountObj)
		}
		saveStoredAccountsToStorage(storedBedringhAccounts.value)
	}

	async function activateGameAccount(username: string, token?: string) {
		try {
			const { bedringh_login, set_default_user } = await import('@/helpers/auth')
			const cred = (await bedringh_login(username, token || 'bedringh')) as any
			if (cred?.profile?.id) {
				await set_default_user(cred.profile.id)
			}
		} catch (e) {
			console.warn('[useBedringhAccount] Ошибка активации игрового профиля Theseus:', e)
		}
	}

	function setAccount(username: string, token?: string) {
		if (!username) return
		setActiveBedringhUser(username, token)
		const acc: BedringhAccount = {
			username,
			token,
			avatarUrl: getAvatarUrl(username),
		}
		activeBedringhAccount.value = acc
		addOrUpdateStoredAccount(username, token)
		setPreferredProfile('bedringh')
		void activateGameAccount(username, token)
		if (typeof window !== 'undefined') {
			window.dispatchEvent(
				new CustomEvent('bedringh:account-changed', {
					detail: { username, token },
				}),
			)
		}
	}

	async function switchAccount(username: string) {
		const target = storedBedringhAccounts.value.find(
			(a) => a.username.toLowerCase() === username.toLowerCase(),
		)
		if (!target) return

		setActiveBedringhUser(target.username, target.token)
		activeBedringhAccount.value = {
			username: target.username,
			token: target.token,
			avatarUrl: getAvatarUrl(target.username),
		}
		addOrUpdateStoredAccount(target.username, target.token)
		setPreferredProfile('bedringh')

		// Авторизуем и активируем профиль в Theseus
		await activateGameAccount(target.username, target.token)

		// Оповещаем интерфейс о смене аккаунта (один раз)
		if (typeof window !== 'undefined') {
			window.dispatchEvent(
				new CustomEvent('bedringh:account-changed', {
					detail: { username: target.username, token: target.token },
				}),
			)
		}

		// Фоновая синхронизация без блокировки интерфейса
		void (async () => {
			try {
				const { syncOnLogin } = await import('@/services/bedringh-settings-sync')
				await syncOnLogin(target.username, target.token)
			} catch (e) {
				console.warn('[useBedringhAccount] Ошибка синхронизации настроек при переключении:', e)
			}

			try {
				const { syncGameAccountsOnBedringhLogin } = await import(
					'@/services/bedringh-game-accounts-sync'
				)
				await syncGameAccountsOnBedringhLogin(target.username, target.token)
			} catch (e) {
				console.warn('[useBedringhAccount] Ошибка синхронизации игровых аккаунтов:', e)
			}

			try {
				const { syncServersOnLogin } = await import('@/services/bedringh-servers-sync')
				await syncServersOnLogin(target.username, target.token)
			} catch (e) {
				console.warn('[useBedringhAccount] Ошибка синхронизации серверов при смене аккаунта:', e)
			}
		})()
	}

	function removeStoredAccount(username: string) {
		storedBedringhAccounts.value = storedBedringhAccounts.value.filter(
			(a) => a.username.toLowerCase() !== username.toLowerCase(),
		)
		saveStoredAccountsToStorage(storedBedringhAccounts.value)

		if (activeBedringhAccount.value?.username.toLowerCase() === username.toLowerCase()) {
			if (storedBedringhAccounts.value.length > 0) {
				const next = storedBedringhAccounts.value[0]
				void switchAccount(next.username)
			} else {
				logout()
			}
		}
	}

	function setPreferredProfile(profile: 'bedringh' | 'modrinth') {
		preferredProfile.value = profile
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(STORAGE_PREFERRED_PROFILE_KEY, profile)
		}
		if (typeof window !== 'undefined') {
			window.dispatchEvent(
				new CustomEvent('bedringh:platform-profile-changed', {
					detail: { profile },
				}),
			)
		}
	}

	function logout() {
		clearActiveBedringhUser()
		activeBedringhAccount.value = null
		if (typeof window !== 'undefined') {
			window.dispatchEvent(
				new CustomEvent('bedringh:account-changed', {
					detail: null,
				}),
			)
		}
	}

	if (!isInitialized && typeof window !== 'undefined') {
		isInitialized = true

		// 1. Восстанавливаем сохраненные аккаунты
		storedBedringhAccounts.value = loadStoredAccountsFromStorage()

		// 2. Восстанавливаем предпочитаемый профиль
		const savedPref = localStorage.getItem(STORAGE_PREFERRED_PROFILE_KEY) as
			| 'bedringh'
			| 'modrinth'
			| null
		if (savedPref === 'bedringh' || savedPref === 'modrinth') {
			preferredProfile.value = savedPref
		}

		// 3. Читаем начального пользователя из localStorage
		const initial = getActiveBedringhUser()
		if (initial?.username) {
			activeBedringhAccount.value = {
				username: initial.username,
				token: initial.token,
				avatarUrl: getAvatarUrl(initial.username),
			}
			addOrUpdateStoredAccount(initial.username, initial.token)
		}

		// 4. Асинхронно уточняем пользователя
		void refreshAccount()

		// 5. Слушаем события
		window.addEventListener('bedringh:account-changed', (e: any) => {
			const detail = e.detail
			if (detail?.username) {
				const acc = {
					username: detail.username,
					token: detail.token,
					avatarUrl: getAvatarUrl(detail.username),
				}
				activeBedringhAccount.value = acc
				addOrUpdateStoredAccount(detail.username, detail.token)
			} else if (detail === null) {
				activeBedringhAccount.value = null
			}
		})

		window.addEventListener('bedringh:platform-profile-changed', (e: any) => {
			const profile = e.detail?.profile
			if (profile === 'bedringh' || profile === 'modrinth') {
				preferredProfile.value = profile
			}
		})
	}

	const isBedringhAuthenticated = computed(() => !!activeBedringhAccount.value?.username)

	return {
		bedringhAccount: activeBedringhAccount,
		storedBedringhAccounts,
		preferredProfile,
		isBedringhAuthenticated,
		refreshAccount,
		setAccount,
		switchAccount,
		removeStoredAccount,
		setPreferredProfile,
		logout,
	}
}