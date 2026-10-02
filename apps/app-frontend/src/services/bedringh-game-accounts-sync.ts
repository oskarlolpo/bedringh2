import { fetchRemoteSettings, pushRemoteSettingsNow } from './bedringh-settings-sync'
import { users, klauncher_login, elyby_login, offline_login } from '@/helpers/auth'

export interface StoredGameAccount {
	type: 'klauncher' | 'elyby' | 'offline'
	username: string
	password?: string | null
	twoFactor?: string | null
	createdAt?: number
}

function getAccountTypeName(account: any): 'Microsoft' | 'KLauncher' | 'TLauncher' | 'Ely.by' | 'Офлайн' | 'Bedringh ID' | 'Other' {
	if (!account) return 'Other'
	const token = account.access_token || ''
	const refresh = account.refresh_token || ''
	if (refresh === 'bedringh_refresh' || token === 'bedringh' || token.startsWith('bedringh_')) return 'Bedringh ID'
	if (token === 'null' && refresh === 'null') return 'Офлайн'
	if (refresh === 'kl_refresh' || token === 'kl' || token.startsWith('kl_')) return 'KLauncher'
	if (refresh === 'tl_refresh' || token === 'tl' || token.startsWith('tl_')) return 'TLauncher'
	if (token.includes('elyby') || refresh.includes('elyby')) return 'Ely.by'
	if (account.profile?.id && !token.startsWith('kl') && !token.startsWith('tl') && !token.includes('elyby')) {
		return 'Microsoft'
	}
	return 'Other'
}

/**
 * Синхронизирует сохраненные игровые аккаунты (KLauncher, Ely.by, Офлайн) из облака Bedringh ID
 * в локальную базу данных аккаунтов Theseus. Microsoft исключен из соображений безопасности.
 */
export async function syncGameAccountsOnBedringhLogin(bedringhUsername: string, token?: string): Promise<void> {
	if (!bedringhUsername) return

	try {
		console.log(`[Bedringh Game Sync] Синхронизация способов входа для Bedringh ID «${bedringhUsername}»...`)
		const remote = (await fetchRemoteSettings(bedringhUsername, token)) as any
		const cloudGameAccounts: StoredGameAccount[] = Array.isArray(remote?._bedringhGameAccounts)
			? remote._bedringhGameAccounts
			: []

		if (cloudGameAccounts.length === 0) {
			console.log('[Bedringh Game Sync] В облаке нет сохраненных игровых аккаунтов, выгружаем текущие локальные...')
			await pushLocalGameAccountsToCloud(bedringhUsername, token)
			return
		}

		const localUsers = await users().catch(() => [])

		for (const saved of cloudGameAccounts) {
			if (!saved || !saved.username || !saved.type) continue

			const alreadyExists = localUsers.some((u: any) => {
				const type = getAccountTypeName(u)
				if (saved.type === 'klauncher' && type === 'KLauncher') {
					return u.profile?.name?.toLowerCase() === saved.username.toLowerCase()
				}
				if (saved.type === 'elyby' && type === 'Ely.by') {
					return u.profile?.name?.toLowerCase() === saved.username.toLowerCase()
				}
				if (saved.type === 'offline' && type === 'Офлайн') {
					return u.profile?.name?.toLowerCase() === saved.username.toLowerCase()
				}
				return false
			})

			if (!alreadyExists) {
				try {
					if (saved.type === 'klauncher') {
						console.log(`[Bedringh Game Sync] Восстановление KLauncher профиля: ${saved.username}`)
						await klauncher_login(saved.username, saved.password || null)
					} else if (saved.type === 'elyby') {
						console.log(`[Bedringh Game Sync] Восстановление Ely.by профиля: ${saved.username}`)
						await elyby_login(saved.username, saved.password || null, saved.twoFactor || null)
					} else if (saved.type === 'offline') {
						console.log(`[Bedringh Game Sync] Восстановление Офлайн профиля: ${saved.username}`)
						await offline_login(saved.username)
					}
				} catch (restoreErr) {
					console.warn(`[Bedringh Game Sync] Не удалось восстановить аккаунт ${saved.username}:`, restoreErr)
				}
			}
		}

		// Уведомляем систему об обновлении аккаунтов
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('bedringh:game-accounts-updated'))
		}
	} catch (e) {
		console.warn('[Bedringh Game Sync] Ошибка синхронизации игровых аккаунтов:', e)
	}
}

/**
 * Сохраняет текущие локальные способы входа (KLauncher, Ely.by, Офлайн) в облачный профиль Bedringh ID.
 * Строго исключает Microsoft аккаунты.
 */
export async function pushLocalGameAccountsToCloud(
	bedringhUsername: string,
	token?: string,
	newAccountToAdd?: StoredGameAccount,
): Promise<void> {
	if (!bedringhUsername) return

	try {
		const remote = (await fetchRemoteSettings(bedringhUsername, token)) as any
		const currentCloudAccounts: StoredGameAccount[] = Array.isArray(remote?._bedringhGameAccounts)
			? [...remote._bedringhGameAccounts]
			: []

		const localUsers = await users().catch(() => [])
		const accountsToSave: StoredGameAccount[] = [...currentCloudAccounts]

		for (const u of localUsers) {
			const type = getAccountTypeName(u)
			const name = u.profile?.name
			if (!name) continue

			let targetType: 'klauncher' | 'elyby' | 'offline' | null = null
			if (type === 'KLauncher') targetType = 'klauncher'
			else if (type === 'Ely.by') targetType = 'elyby'
			else if (type === 'Офлайн') targetType = 'offline'

			if (!targetType) continue

			const existingIndex = accountsToSave.findIndex(
				(a) => a.type === targetType && a.username.toLowerCase() === name.toLowerCase(),
			)

			if (existingIndex === -1) {
				accountsToSave.push({
					type: targetType,
					username: name,
					createdAt: Date.now(),
				})
			}
		}

		if (newAccountToAdd) {
			const idx = accountsToSave.findIndex(
				(a) => a.type === newAccountToAdd.type && a.username.toLowerCase() === newAccountToAdd.username.toLowerCase(),
			)
			if (idx >= 0) {
				accountsToSave[idx] = { ...accountsToSave[idx], ...newAccountToAdd }
			} else {
				accountsToSave.push(newAccountToAdd)
			}
		}

		// Обновляем облачный контейнер в настройках
		const payload = {
			...(remote || {}),
			_bedringhGameAccounts: accountsToSave,
		}

		await pushRemoteSettingsNow(bedringhUsername, token, payload)
		console.log(`[Bedringh Game Sync] Игровые аккаунты сохранены в облаке (${accountsToSave.length} шт.)`)
	} catch (e) {
		console.warn('[Bedringh Game Sync] Ошибка сохранения игровых аккаунтов в облако:', e)
	}
}

/**
 * Удаляет способ входа из облачного профиля Bedringh ID при удалении игроком
 */
export async function removeGameAccountFromCloud(
	bedringhUsername: string,
	usernameToRemove: string,
	token?: string,
): Promise<void> {
	if (!bedringhUsername || !usernameToRemove) return

	try {
		const remote = (await fetchRemoteSettings(bedringhUsername, token)) as any
		const currentCloudAccounts: StoredGameAccount[] = Array.isArray(remote?._bedringhGameAccounts)
			? remote._bedringhGameAccounts
			: []

		const filtered = currentCloudAccounts.filter(
			(a) => a.username.toLowerCase() !== usernameToRemove.toLowerCase(),
		)

		const payload = {
			...(remote || {}),
			_bedringhGameAccounts: filtered,
		}

		await pushRemoteSettingsNow(bedringhUsername, token, payload)
		console.log(`[Bedringh Game Sync] Аккаунт «${usernameToRemove}» удален из облачного профиля Bedringh ID`)
	} catch (e) {
		console.warn('[Bedringh Game Sync] Ошибка удаления аккаунта из облака:', e)
	}
}
