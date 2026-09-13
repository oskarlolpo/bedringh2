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

const activeBedringhAccount = ref<BedringhAccount | null>(null)
const preferredProfile = ref<'bedringh' | 'modrinth'>('bedringh')
let isInitialized = false

export function useBedringhAccount() {
	function getAvatarUrl(username: string): string {
		return `https://mc-heads.net/avatar/${encodeURIComponent(username)}/64`
	}

	async function refreshAccount(): Promise<BedringhAccount | null> {
		const user = await resolveActiveBedringhUser()
		if (user && user.username) {
			activeBedringhAccount.value = {
				username: user.username,
				token: user.token,
				avatarUrl: getAvatarUrl(user.username),
			}
		} else {
			activeBedringhAccount.value = null
		}
		return activeBedringhAccount.value
	}

	function setAccount(username: string, token?: string) {
		if (!username) return
		setActiveBedringhUser(username, token)
		activeBedringhAccount.value = {
			username,
			token,
			avatarUrl: getAvatarUrl(username),
		}
		setPreferredProfile('bedringh')
		if (typeof window !== 'undefined') {
			window.dispatchEvent(
				new CustomEvent('bedringh:account-changed', {
					detail: { username, token },
				}),
			)
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

		// 1. Восстанавливаем предпочитаемый профиль
		const savedPref = localStorage.getItem(STORAGE_PREFERRED_PROFILE_KEY) as 'bedringh' | 'modrinth' | null
		if (savedPref === 'bedringh' || savedPref === 'modrinth') {
			preferredProfile.value = savedPref
		}

		// 2. Читаем начального пользователя из localStorage
		const initial = getActiveBedringhUser()
		if (initial?.username) {
			activeBedringhAccount.value = {
				username: initial.username,
				token: initial.token,
				avatarUrl: getAvatarUrl(initial.username),
			}
		}

		// 3. Асинхронно уточняем пользователя
		void refreshAccount()

		// 4. Слушаем события
		window.addEventListener('bedringh:account-changed', (e: any) => {
			const detail = e.detail
			if (detail?.username) {
				activeBedringhAccount.value = {
					username: detail.username,
					token: detail.token,
					avatarUrl: getAvatarUrl(detail.username),
				}
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
		preferredProfile,
		isBedringhAuthenticated,
		refreshAccount,
		setAccount,
		setPreferredProfile,
		logout,
	}
}