<template>
	<div
		v-if="accounts.length === 0"
		class="flex flex-col gap-3 bg-button-bg border border-solid border-surface-5 rounded-xl p-3 mt-2"
	>
		<span>{{ formatMessage(messages.notSignedIn) }}</span>
		<ButtonStyled color="brand">
			<button color="primary" :disabled="loginDisabled" @click="login()">
				<LogInIcon v-if="!loginDisabled" />
				<SpinnerIcon v-else class="animate-spin" />
				{{ formatMessage(messages.signInToMinecraft) }}
			</button>
		</ButtonStyled>
		<ButtonStyled color="brand" type="outlined">
			<button color="primary" :disabled="loginDisabled" @click="addOfflineAccount()">
				<PlusIcon v-if="!loginDisabled" />
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
				<Avatar
					size="36px"
					:src="
						selectedAccount
							? avatarUrl
							: 'https://launcher-files.modrinth.com/assets/steve_head.png'
					"
				/>
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
						<Avatar :src="getAccountAvatarUrl(account)" size="24px" />
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
				<ButtonStyled v-if="accounts.length > 0" class="w-full" color="brand" type="outlined">
					<button :disabled="loginDisabled" @click="login()">
						<PlusIcon />
						{{ formatMessage(messages.addAccount) }} (MS)
					</button>
				</ButtonStyled>
				<ButtonStyled v-if="accounts.length > 0" class="w-full" color="brand" type="outlined">
					<button :disabled="loginDisabled" @click="addOfflineAccount()">
						<PlusIcon />
						{{ formatMessage(messages.createOfflineAccount) }}
					</button>
				</ButtonStyled>
				<ButtonStyled v-if="accounts.length > 0" class="w-full" color="brand" type="outlined">
					<button :disabled="loginDisabled" @click="addKLauncherAccount()">
						<PlusIcon />
						Вход KLauncher
					</button>
				</ButtonStyled>
			</div>
		</div>
	</Accordion>
	<AccountsInputModals
		ref="accountsInputModals"
		v-model:offlinePlayerName="offlinePlayerName"
		v-model:kLauncherLoginValue="kLauncherLoginValue"
		v-model:kLauncherPassword="kLauncherPassword"
		:ely-by-login-disabled="false"
		ely-by-login-value=""
		ely-by-password=""
		ely-by-two-factor-code=""
		:offline-login-disabled="offlineLoginDisabled"
		:k-launcher-login-disabled="kLauncherLoginDisabled"
		@submit-offline="addOfflineProfile"
		@submit-klauncher="addKLauncherProfile"
	/>
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
import { computed, onUnmounted, ref } from 'vue'

import AccountsInputModals from './astralrinth/accounts/input/AccountsInputModals.vue'

import { trackEvent } from '@/helpers/analytics'
import {
	get_default_user,
	login as login_flow,
	remove_user,
	set_default_user,
	users,
} from '@/helpers/auth'
import { process_listener } from '@/helpers/events'
import { getPlayerHeadUrl } from '@/helpers/rendering/batch-skin-renderer.ts'
import type { Skin } from '@/helpers/skins'
import { get_available_skins } from '@/helpers/skins'
import { handleSevereError } from '@/store/error.js'

const { formatMessage } = useVIntl()
const { handleError } = injectNotificationManager()

const emit = defineEmits<{
	change: []
}>()

type MinecraftCredential = {
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

const accountsInputModals = ref<InstanceType<typeof AccountsInputModals> | null>(null)
const offlinePlayerName = ref('')
const offlineLoginDisabled = ref(false)
const kLauncherLoginValue = ref('')
const kLauncherPassword = ref('')
const kLauncherLoginDisabled = ref(false)

async function refreshValues() {
	defaultUser.value = await get_default_user().catch(handleError)
	const userList = await users().catch(handleError)
	accounts.value = Array.isArray(userList) ? [...userList] : []
	accounts.value.sort((a, b) => (a.profile?.name ?? '').localeCompare(b.profile?.name ?? ''))

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
})

await refreshValues()

const selectedAccount = computed(() =>
	accounts.value.find((account) => account.profile.id === defaultUser.value),
)

const avatarUrl = computed(() => {
	if (equippedSkin.value?.texture_key) {
		const cachedUrl = headUrlCache.value.get(equippedSkin.value.texture_key)
		if (cachedUrl) {
			return cachedUrl
		}
		return `https://mc-heads.net/avatar/${equippedSkin.value.texture_key}/128`
	}
	if (selectedAccount.value?.profile?.id) {
		return `https://mc-heads.net/avatar/${selectedAccount.value.profile.id}/128`
	}
	return 'https://launcher-files.modrinth.com/assets/steve_head.png'
})

function getAccountAvatarUrl(account: MinecraftCredential) {
	if (
		account.profile.id === selectedAccount.value?.profile?.id &&
		equippedSkin.value?.texture_key
	) {
		const cachedUrl = headUrlCache.value.get(equippedSkin.value.texture_key)
		if (cachedUrl) {
			return cachedUrl
		}
	}
	return `https://mc-heads.net/avatar/${account.profile.id}/128`
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

function getAccountTypeName(account: MinecraftCredential | null | undefined): string {
	if (!account) return ''
	const token = account.access_token || ''
	const refresh = account.refresh_token || ''
	// Офлайн аккаунты имеют токены "null" (строка)
	if (token === 'null' && refresh === 'null') return 'Офлайн'
	// KLauncher аккаунты
	if (refresh === 'kl_refresh' || token === 'kl' || token.startsWith('kl_')) return 'KLauncher'
	// Ely.by
	if (token.includes('elyby') || refresh.includes('elyby')) return 'Ely.by'
	// Microsoft (OAuth)
	return 'Microsoft'
}

function getAccountTypeBadgeClass(account: MinecraftCredential | null | undefined): string {
	if (!account) return ''
	const type = getAccountTypeName(account)
	switch (type) {
		case 'KLauncher':
			return 'bg-red-500/20 text-red-400 border border-red-500/30'
		case 'Офлайн':
			return 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
		case 'Ely.by':
			return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
		default:
			return 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
	}
}

</script>
