<template>
	<div
		v-if="accounts.length === 0"
		class="flex flex-col gap-3 bg-button-bg border border-solid border-surface-5 rounded-xl p-3 mt-2"
	>
		<span class="text-sm font-medium text-secondary">{{ formatMessage(messages.notSignedIn) }}</span>
		<ButtonStyled color="brand">
			<button color="primary" :disabled="loginDisabled" @click="openBedringhAuth()">
				<LogInIcon />
				Войти через Bedringh ID
			</button>
		</ButtonStyled>
		<ButtonStyled color="brand" type="outlined">
			<button color="primary" :disabled="loginDisabled" @click="login()">
				<LogInIcon v-if="!loginDisabled" />
				<SpinnerIcon v-else class="animate-spin" />
				{{ formatMessage(messages.signInWithMicrosoft) }}
			</button>
		</ButtonStyled>
		<ButtonStyled color="brand" type="outlined">
			<button color="primary" :disabled="loginDisabled || kLauncherLoginDisabled" @click="addKLauncherAccount()">
				<LogInIcon v-if="!kLauncherLoginDisabled" />
				<SpinnerIcon v-else class="animate-spin" />
				{{ formatMessage(messages.signInWithKLauncher) }}
			</button>
		</ButtonStyled>
		<ButtonStyled color="brand" type="outlined">
			<button color="primary" :disabled="loginDisabled || offlineLoginDisabled" @click="addOfflineAccount()">
				<PlusIcon v-if="!offlineLoginDisabled" />
				<SpinnerIcon v-else class="animate-spin" />
				{{ formatMessage(messages.createOfflineAccount) }}
			</button>
		</ButtonStyled>
	</div>
	<Accordion
		v-else
		class="w-full mt-2 bg-button-bg border border-solid border-surface-5 rounded-xl overflow-clip"
		button-class="button-base w-full bg-transparent px-3 py-2 border-0 cursor-pointer"
		:open-by-default="false"
	>
		<template #title>
			<div class="flex gap-2 w-full min-w-0">
				<div class="image-pixelated">
					<Avatar
						size="36px"
						:src="
							selectedAccount
								? avatarUrl
								: (localSteveHeadUrl.value || 'https://launcher-files.modrinth.com/assets/steve_head.png')
						"
					/>
				</div>
				<div class="flex flex-col items-start w-full min-w-0">
					<div class="flex items-center gap-2 w-full min-w-0">
						<span class="truncate text-left">{{
							selectedAccount ? selectedAccount.profile.name : formatMessage(messages.selectAccount)
						}}</span>
						<span
							v-if="selectedAccount"
							class="px-1.5 py-0.5 text-[10px] font-semibold rounded shrink-0"
							:class="getAccountTypeBadgeClass(selectedAccount)"
						>
							{{ getAccountTypeName(selectedAccount) }}
						</span>
					</div>
					<span class="text-secondary text-xs">{{ formatMessage(messages.minecraftAccount) }}</span>
				</div>
			</div>
		</template>
		<div class="bg-button-bg pt-1 pb-2 border border-solid border-surface-5">
			<template v-if="accounts.length > 0">
				<div v-for="account in accounts" :key="account.profile.id" class="flex gap-1 items-center">
					<button
						class="flex items-center flex-shrink flex-grow overflow-clip gap-2 p-2 border-0 bg-transparent cursor-pointer button-base min-w-0"
						@click="setAccount(account)"
					>
						<RadioButtonCheckedIcon
							v-if="selectedAccount && selectedAccount.profile.id === account.profile.id"
							class="w-5 h-5 text-brand shrink-0"
						/>
						<RadioButtonIcon v-else class="w-5 h-5 text-secondary shrink-0" />
						<div class="image-pixelated">
							<Avatar :src="getAccountAvatarUrl(account)" size="24px" />
						</div>
						<div class="flex items-center gap-1.5 min-w-0">
							<p
								class="m-0 truncate min-w-0"
								:class="
									selectedAccount && selectedAccount.profile.id === account.profile.id
										? 'text-contrast font-semibold'
										: 'text-primary'
								"
							>
								{{ account.profile.name }}
							</p>
							<span
								class="px-1.5 py-0.5 text-[10px] font-semibold rounded shrink-0"
								:class="getAccountTypeBadgeClass(account)"
							>
								{{ getAccountTypeName(account) }}
							</span>
						</div>
					</button>
					<ButtonStyled circular color="red" color-fill="none" hover-color-fill="background">
						<button
							v-tooltip="formatMessage(messages.removeAccount)"
							class="mr-2"
							@click="logout(account.profile.id)"
						>
							<TrashIcon />
						</button>
					</ButtonStyled>
				</div>
			</template>
			<div class="flex flex-col gap-2 px-2 pt-2">
				<ButtonStyled class="w-full" color="brand">
					<button :disabled="loginDisabled" @click="openBedringhAuth()">
						<PlusIcon />
						Добавить Bedringh ID
					</button>
				</ButtonStyled>
				<ButtonStyled class="w-full" color="brand" type="outlined">
					<button :disabled="loginDisabled" @click="login()">
						<PlusIcon />
						{{ formatMessage(messages.signInWithMicrosoft) }}
					</button>
				</ButtonStyled>
				<ButtonStyled class="w-full" color="brand" type="outlined">
					<button :disabled="loginDisabled || kLauncherLoginDisabled" @click="addKLauncherAccount()">
						<PlusIcon />
						{{ formatMessage(messages.signInWithKLauncher) }}
					</button>
				</ButtonStyled>
				<ButtonStyled class="w-full" color="brand" type="outlined">
					<button :disabled="loginDisabled || elyByLoginDisabled" @click="addElyByAccount()">
						<PlusIcon />
						{{ formatMessage(messages.signInWithElyBy) }}
					</button>
				</ButtonStyled>
				<ButtonStyled class="w-full" color="brand" type="outlined">
					<button :disabled="loginDisabled || offlineLoginDisabled" @click="addOfflineAccount()">
						<PlusIcon />
						{{ formatMessage(messages.createOfflineAccount) }}
					</button>
				</ButtonStyled>
			</div>
		</div>
	</Accordion>
	<AccountsInputModals
		ref="accountsInputModals"
		v-model:offline-player-name="offlinePlayerName"
		v-model:k-launcher-login-value="kLauncherLoginValue"
		v-model:k-launcher-password="kLauncherPassword"
		v-model:t-launcher-login-value="tLauncherLoginValue"
		v-model:t-launcher-password="tLauncherPassword"
		v-model:ely-by-login-value="elyByLoginValue"
		v-model:ely-by-password="elyByPassword"
		v-model:ely-by-two-factor-code="elyByTwoFactorCode"
		:ely-by-login-disabled="elyByLoginDisabled"
		:offline-login-disabled="offlineLoginDisabled"
		:k-launcher-login-disabled="kLauncherLoginDisabled"
		:t-launcher-login-disabled="tLauncherLoginDisabled"
		@submit-offline="addOfflineProfile"
		@submit-klauncher="addKLauncherProfile"
		@submit-tlauncher="addTLauncherProfile"
		@submit-elyby="addElyByProfile"
	/>
	<BedringhAuthModal ref="bedringhAuthModal" @success="onBedringhAuthSuccess" />
</template>

<script setup lang="ts">
import {
	LogInIcon,
	PlusIcon,
	RadioButtonCheckedIcon,
	RadioButtonIcon,
	SpinnerIcon,
	TrashIcon,
} from '@modrinth/assets'
import {
	Accordion,
	Avatar,
	ButtonStyled,
	defineMessages,
	injectNotificationManager,
	useVIntl,
} from '@modrinth/ui'
import type { Ref } from 'vue'
import { computed, onUnmounted, ref, watch } from 'vue'

import steveHeadImage from '@/assets/skins/steve.png'
import { trackEvent } from '@/helpers/analytics'
import {
	get_default_user,
	login as login_flow,
	remove_user,
	set_default_user,
	users,
} from '@/helpers/auth'
import { process_listener } from '@/helpers/events'
import { fetchExternalImageObjectUrl, fetchExternalJson } from '@/helpers/external-image.ts'
import { generatePlayerHeadBlob, getPlayerHeadUrl } from '@/helpers/rendering/batch-skin-renderer.ts'
import type { Skin } from '@/helpers/skins'
import { get_available_skins } from '@/helpers/skins'
import { handleSevereError } from '@/store/error.js'

import AccountsInputModals from './astralrinth/accounts/input/AccountsInputModals.vue'
import BedringhAuthModal from './astralrinth/accounts/BedringhAuthModal.vue'

const { formatMessage } = useVIntl()
const { handleError } = injectNotificationManager()

const emit = defineEmits<{
	change: []
}>()

type MinecraftCredential = {
	access_token?: string
	refresh_token?: string
	profile: {
		id: string
		name: string
	}
}

const accounts: Ref<MinecraftCredential[]> = ref([])
const loginDisabled = ref(false)
const defaultUser = ref<string | undefined>()
const equippedSkin = ref<Skin | null>(null)
const headUrlCache = ref(new Map<string, string>())
const accountHeadCache = ref(new Map<string, string>())
const localSteveHeadUrl = ref<string | null>(null)

const accountsInputModals = ref<InstanceType<typeof AccountsInputModals> | null>(null)
const bedringhAuthModal = ref<InstanceType<typeof BedringhAuthModal> | null>(null)
const offlinePlayerName = ref('')
const offlineLoginDisabled = ref(false)
const kLauncherLoginValue = ref('')
const kLauncherPassword = ref('')
const kLauncherLoginDisabled = ref(false)
const tLauncherLoginValue = ref('')
const tLauncherPassword = ref('')
const tLauncherLoginDisabled = ref(false)
const elyByLoginValue = ref('')
const elyByPassword = ref('')
const elyByTwoFactorCode = ref('')
const elyByLoginDisabled = ref(false)

async function generateLocalSteveHead() {
	try {
		const headBlob = await generatePlayerHeadBlob(steveHeadImage, 64)
		localSteveHeadUrl.value = URL.createObjectURL(headBlob)
	} catch {
		localSteveHeadUrl.value = null
	}
}

generateLocalSteveHead()

async function fetchAccountHead(account: MinecraftCredential) {
	const name = account.profile?.name
	const profileId = account.profile?.id
	if (!name || !profileId) return

	const accountType = getAccountTypeName(account)
	let skinUrl: string | null = null

	try {
		if (accountType === 'KLauncher') {
			// KLauncher accounts: fetch skin from KLauncher API (routed through the
			// Tauri HTTP plugin to bypass the webview CSP connect-src list).
			try {
				const json = await fetchExternalJson<{
					textures?: { SKIN?: { url?: string } }
				}>(`https://api.klaun.ch/v2/user/skin?nick=${encodeURIComponent(name)}`)
				skinUrl = json?.textures?.SKIN?.url ?? null
			} catch {
				skinUrl = null
			}
			// Fallback to mc-heads if KLauncher API is down or errored
			if (!skinUrl) {
				skinUrl = `https://mc-heads.net/skin/${encodeURIComponent(name)}`
			}
		} else if (accountType === 'TLauncher') {
			// TLauncher accounts: получаем URL скина с рабочего сервиса skins.tl.vg
			try {
				const json = await fetchExternalJson<{
					SKIN?: { url?: string }
					textures?: { SKIN?: { url?: string } }
				}>(`http://skins.tl.vg/skin/profile/texture/login/${encodeURIComponent(name)}`)
				const rawSkin = json?.SKIN?.url || json?.textures?.SKIN?.url
				if (rawSkin) {
					skinUrl = rawSkin
						.replace('https://auth.tlauncher.org', 'http://skins.tl.vg')
						.replace('http://auth.tlauncher.org', 'http://skins.tl.vg')
						.replace('https://auth.tlauncher.ru', 'http://skins.tl.vg')
						.replace('http://auth.tlauncher.ru', 'http://skins.tl.vg')
				}
			} catch (err) {
				console.warn('TLauncher skin profile API error, trying direct file:', err)
			}

			// Fallback: прямое имя файла скина TLauncher
			if (!skinUrl) {
				skinUrl = `http://skins.tl.vg/skin/fileservice/skins/skin_${encodeURIComponent(name)}.png`
			}
		} else if (accountType === 'Microsoft') {
			// Microsoft accounts: use mc-heads.net which resolves by UUID or username
			skinUrl = `https://mc-heads.net/skin/${profileId}`
		} else if (accountType === 'Bedringh ID') {
			// Bedringh ID accounts: mc-heads resolution by username
			skinUrl = `https://mc-heads.net/skin/${encodeURIComponent(name)}`
		} else if (accountType === 'Ely.by') {
			// Ely.by accounts: fetch skin from Ely.by textures API
			skinUrl = `http://skinsystem.ely.by/textures/skins/${encodeURIComponent(name)}.png`
		} else {
			// Offline / unknown: no reliable skin source
			return
		}

		if (skinUrl) {
			let headUrl: string | null = null
			let tempBlobUrl: string | null = null
			try {
				// Скачиваем скин через Tauri HTTP плагин, чтобы Canvas мог читать пиксели без CORS ошибок
				tempBlobUrl = await fetchExternalImageObjectUrl(skinUrl)
				const headBlob = await generatePlayerHeadBlob(tempBlobUrl, 64)
				headUrl = URL.createObjectURL(headBlob)
			} catch (renderError) {
				console.warn('Failed to render head from skin, trying mc-heads fallback:', renderError)
				try {
					const res = await fetchExternalImageObjectUrl(`https://mc-heads.net/avatar/${encodeURIComponent(name)}/64`)
					headUrl = res
				} catch {}
			} finally {
				if (tempBlobUrl) {
					URL.revokeObjectURL(tempBlobUrl)
				}
			}
			if (headUrl) {
				accountHeadCache.value = new Map(accountHeadCache.value).set(profileId, headUrl)
			}
		}
	} catch {
		// ignore
	}
}

	function getAccountTypeWeight(account: MinecraftCredential): number {
		const type = getAccountTypeName(account)
		switch (type) {
			case 'Bedringh ID':
				return -1
			case 'Microsoft':
				return 0
			case 'KLauncher':
				return 1
			case 'TLauncher':
				return 2
			case 'Ely.by':
				return 3
			case 'Офлайн':
				return 4
			default:
				return 5
		}
	}

	async function refreshValues() {
		defaultUser.value = await get_default_user().catch(handleError)
		const userList = await users().catch(handleError)
		accounts.value = Array.isArray(userList) ? [...userList] : []
		accounts.value.sort((a, b) => {
			const weightDiff = getAccountTypeWeight(a) - getAccountTypeWeight(b)
			if (weightDiff !== 0) return weightDiff
			return (a.profile?.name ?? '').localeCompare(b.profile?.name ?? '')
		})

	// Fetch head for each account in background
	for (const account of accounts.value) {
		void fetchAccountHead(account)
	}

	try {
		const skins = await get_available_skins()
		equippedSkin.value = skins.find((skin) => skin.is_equipped) ?? null

		if (equippedSkin.value) {
			try {
				const headUrl = await getPlayerHeadUrl(equippedSkin.value)
				headUrlCache.value = new Map(headUrlCache.value).set(
					equippedSkin.value.texture_key,
					headUrl,
				)
			} catch (error) {
				console.warn('Failed to get head render for equipped skin:', error)
			}
		}
	} catch {
		equippedSkin.value = null
	}
}

async function setEquippedSkin(skin: Skin) {
	equippedSkin.value = skin

	try {
		const headUrl = await getPlayerHeadUrl(skin)
		headUrlCache.value = new Map(headUrlCache.value).set(skin.texture_key, headUrl)
	} catch (error) {
		console.warn('Failed to get head render for equipped skin:', error)
	}
}

function setLoginDisabled(value: boolean) {
	loginDisabled.value = value
}

defineExpose({
	refreshValues,
	setEquippedSkin,
	setLoginDisabled,
	loginDisabled,
	login,
	addOfflineAccount,
	addKLauncherAccount,
	addTLauncherAccount,
	accounts,
})

await refreshValues()

const selectedAccount = computed(() =>
	accounts.value.find((account) => account.profile.id === defaultUser.value),
)

watch(
	selectedAccount,
	async (account) => {
		if (account?.profile?.name) {
			try {
				const { setActiveBedringhUser } = await import('@/services/bedringh-settings-sync')
				setActiveBedringhUser(account.profile.name, account.access_token)
			} catch {}
		}
	},
	{ immediate: true },
)

const STEVE_HEAD_URL = 'https://launcher-files.modrinth.com/assets/steve_head.png'

const avatarUrl = computed(() => {
	if (equippedSkin.value?.texture_key) {
		const cachedUrl = headUrlCache.value.get(equippedSkin.value.texture_key)
		if (cachedUrl) {
			return cachedUrl
		}
	}
	return localSteveHeadUrl.value || STEVE_HEAD_URL
})

function getAccountAvatarUrl(account: MinecraftCredential) {
	const profileId = account.profile?.id
	if (!profileId) return localSteveHeadUrl.value || STEVE_HEAD_URL

	const cachedHead = accountHeadCache.value.get(profileId)
	if (cachedHead) {
		return cachedHead
	}

	if (
		profileId === selectedAccount.value?.profile?.id &&
		equippedSkin.value?.texture_key
	) {
		const cachedUrl = headUrlCache.value.get(equippedSkin.value.texture_key)
		if (cachedUrl) {
			return cachedUrl
		}
	}
	return localSteveHeadUrl.value || STEVE_HEAD_URL
}

async function setAccount(account: MinecraftCredential) {
	defaultUser.value = account.profile.id
	await set_default_user(account.profile.id).catch(handleError)
	await refreshValues()
	emit('change')
}

async function login() {
	loginDisabled.value = true
	const loggedIn = await login_flow().catch(handleSevereError)

	if (loggedIn) {
		await setAccount(loggedIn)
	}

	trackEvent('AccountLogIn')
	loginDisabled.value = false
}

async function logout(id: string) {
	await remove_user(id).catch(handleError)
	await refreshValues()
	if (!selectedAccount.value && accounts.value.length > 0) {
		await setAccount(accounts.value[0])
	} else {
		emit('change')
	}
	trackEvent('AccountLogOut')
}

const unlisten = await process_listener(async (e) => {
	if (e.event === 'launched') {
		await refreshValues()
	}
})

onUnmounted(() => {
	unlisten()
})

const messages = defineMessages({
	notSignedIn: {
		id: 'minecraft-account.not-signed-in',
		defaultMessage: 'Not signed in',
	},
	addAccount: {
		id: 'minecraft-account.add-account',
		defaultMessage: 'Add account',
	},
	createOfflineAccount: {
		id: 'minecraft-account.create-offline-account',
		defaultMessage: 'Create offline account',
	},
	removeAccount: {
		id: 'minecraft-account.remove-account',
		defaultMessage: 'Remove account',
	},
	selectAccount: {
		id: 'minecraft-account.select-account',
		defaultMessage: 'Select account',
	},
	minecraftAccount: {
		id: 'minecraft-account.label',
		defaultMessage: 'Minecraft account',
	},
	signInToMinecraft: {
		id: 'minecraft-account.sign-in',
		defaultMessage: 'Sign in to Minecraft',
	},
	signInWithMicrosoft: {
		id: 'minecraft-account.sign-in-microsoft',
		defaultMessage: 'Sign in with Microsoft',
	},
	signInWithKLauncher: {
		id: 'minecraft-account.sign-in-klauncher',
		defaultMessage: 'Sign in with KLauncher',
	},
	signInWithTLauncher: {
		id: 'minecraft-account.sign-in-tlauncher',
		defaultMessage: 'Sign in with TLauncher',
	},
	signInWithElyBy: {
		id: 'minecraft-account.sign-in-elyby',
		defaultMessage: 'Sign in with Ely.by',
	},
})

function addOfflineAccount() {
	accountsInputModals.value?.showOffline()
}

async function addOfflineProfile() {
	if (!offlinePlayerName.value) return

	const trimmedName = offlinePlayerName.value.trim()
	if (trimmedName.length < 3 || trimmedName.length > 20) {
		handleError('Имя должно быть от 3 до 20 символов.')
		return
	}
	
	try {
		offlineLoginDisabled.value = true
		accountsInputModals.value?.hideOffline()
		const result = await import('@/helpers/auth').then(m => m.offline_login(trimmedName))
		if (result) {
			await setAccount(result)
			await refreshValues()
		}
	} catch (error) {
		handleError(error)
	} finally {
		offlineLoginDisabled.value = false
		offlinePlayerName.value = ''
	}
}

function addKLauncherAccount() {
	accountsInputModals.value?.showKLauncher()
}

async function addKLauncherProfile() {
	if (!kLauncherLoginValue.value) return

	const trimmedName = kLauncherLoginValue.value.trim()
	if (trimmedName.length < 3 || trimmedName.length > 30) {
		handleError('Логин должен быть от 3 до 30 символов.')
		return
	}
	
	try {
		kLauncherLoginDisabled.value = true
		accountsInputModals.value?.hideKLauncher()
		const result = await import('@/helpers/auth').then(m => m.klauncher_login(trimmedName, kLauncherPassword.value || null))
		if (result) {
			await setAccount(result)
			await refreshValues()
		}
	} catch (error) {
		handleError(error)
	} finally {
		kLauncherLoginDisabled.value = false
		kLauncherLoginValue.value = ''
		kLauncherPassword.value = ''
	}
}

function addTLauncherAccount() {
	accountsInputModals.value?.showTLauncher()
}

async function addTLauncherProfile() {
	if (!tLauncherLoginValue.value) return

	const trimmedName = tLauncherLoginValue.value.trim()
	if (trimmedName.length < 3 || trimmedName.length > 50) {
		handleError('Логин должен быть от 3 до 50 символов.')
		return
	}
	
	try {
		tLauncherLoginDisabled.value = true
		accountsInputModals.value?.hideTLauncher()
		const result = await import('@/helpers/auth').then(m => m.tlauncher_login(trimmedName, tLauncherPassword.value || null))
		if (result) {
			await setAccount(result)
			await refreshValues()
		}
	} catch (error) {
		handleError(error)
	} finally {
		tLauncherLoginDisabled.value = false
		tLauncherLoginValue.value = ''
		tLauncherPassword.value = ''
	}
}

function addElyByAccount() {
	accountsInputModals.value?.showElyBy()
}

async function addElyByProfile() {
	if (!elyByLoginValue.value) return

	const trimmedName = elyByLoginValue.value.trim()
	if (trimmedName.length < 3 || trimmedName.length > 50) {
		handleError('Логин должен быть от 3 до 50 символов.')
		return
	}

	try {
		elyByLoginDisabled.value = true
		accountsInputModals.value?.hideElyBy()
		const result = await import('@/helpers/auth').then(m =>
			m.elyby_login(trimmedName, elyByPassword.value || null, elyByTwoFactorCode.value || null)
		)
		if (result) {
			await setAccount(result)
			await refreshValues()
		}
	} catch (error) {
		handleError(error)
	} finally {
		elyByLoginDisabled.value = false
		elyByLoginValue.value = ''
		elyByPassword.value = ''
		elyByTwoFactorCode.value = ''
	}
}

function openBedringhAuth() {
	bedringhAuthModal.value?.show()
}

async function onBedringhAuthSuccess(account: any) {
	if (account) {
		await setAccount(account)
		await refreshValues()
	}
}

function getAccountTypeName(account: MinecraftCredential | null | undefined): string {
	if (!account) return ''
	const token = account.access_token || ''
	const refresh = account.refresh_token || ''
	// Bedringh ID аккаунты
	if (refresh === 'bedringh_refresh' || token === 'bedringh' || token.startsWith('bedringh_')) return 'Bedringh ID'
	// Офлайн аккаунты имеют токены "null" (строка)
	if (token === 'null' && refresh === 'null') return 'Офлайн'
	// KLauncher аккаунты
	if (refresh === 'kl_refresh' || token === 'kl' || token.startsWith('kl_')) return 'KLauncher'
	// TLauncher аккаунты
	if (refresh === 'tl_refresh' || token === 'tl' || token.startsWith('tl_')) return 'TLauncher'
	// Ely.by
	if (token.includes('elyby') || refresh.includes('elyby')) return 'Ely.by'
	// Microsoft (OAuth)
	return 'Microsoft'
}

function getAccountTypeBadgeClass(account: MinecraftCredential | null | undefined): string {
	if (!account) return ''
	const type = getAccountTypeName(account)
	switch (type) {
		case 'Bedringh ID':
			return 'bg-purple-500/25 text-purple-300 border border-purple-500/40 font-bold'
		case 'KLauncher':
			return 'bg-red-500/20 text-red-400 border border-red-500/30'
		case 'TLauncher':
			return 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
		case 'Офлайн':
			return 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
		case 'Ely.by':
			return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
		default:
			return 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
	}
}

</script>

<style scoped lang="scss">
.image-pixelated {
	image-rendering: pixelated;
}
</style>
