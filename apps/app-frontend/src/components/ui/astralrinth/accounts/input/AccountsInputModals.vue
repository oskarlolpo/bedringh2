<script setup lang="ts">
import { Button, defineMessages, useVIntl } from '@modrinth/ui'
import { openUrl } from '@tauri-apps/plugin-opener'
import { onUnmounted, ref } from 'vue'

import ModalWrapper from '@/components/ui/modal/ModalWrapper.vue'
import { fetchExternalJson } from '@/helpers/external-image.ts'
import { generatePlayerHeadBlob } from '@/helpers/rendering/batch-skin-renderer.ts'

type ModalHandle = {
	hide: () => void
	show: () => void
}

const props = defineProps<{
	elyByLoginDisabled: boolean
	elyByLoginValue: string
	elyByPassword: string
	elyByTwoFactorCode: string
	offlineLoginDisabled: boolean
	offlinePlayerName: string
	kLauncherLoginDisabled?: boolean
	kLauncherLoginValue?: string
	kLauncherPassword?: string
}>()

const emit = defineEmits<{
	(event: 'submit-elyby'): void
	(event: 'submit-offline'): void
	(event: 'submit-klauncher'): void
	(event: 'update:elyByLoginValue', value: string): void
	(event: 'update:elyByPassword', value: string): void
	(event: 'update:elyByTwoFactorCode', value: string): void
	(event: 'update:offlinePlayerName', value: string): void
	(event: 'update:kLauncherLoginValue', value: string): void
	(event: 'update:kLauncherPassword', value: string): void
}>()

const { formatMessage } = useVIntl()

const addOfflineModal = ref<ModalHandle | null>(null)
const addElyByModal = ref<ModalHandle | null>(null)
const addKLauncherModal = ref<ModalHandle | null>(null)
const requestElyByTwoFactorCodeModal = ref<ModalHandle | null>(null)

const kLauncherStep = ref(1)
const kLauncherHeadUrl = ref<string | null>(null)

onUnmounted(() => {
	if (kLauncherHeadUrl.value) {
		URL.revokeObjectURL(kLauncherHeadUrl.value)
	}
})

const KLAUNCHER_REGISTER_URL = 'https://klauncher.gg/register'
const KLAUNCHER_RECOVERY_URL = 'https://klauncher.gg/restore'
const KLAUNCHER_SKIN_API = 'https://api.klaun.ch/v2/user/skin?nick='

let fetchHeadTimeout: ReturnType<typeof setTimeout> | null = null

async function fetchKLauncherHead(nick: string) {
	if (fetchHeadTimeout) {
		clearTimeout(fetchHeadTimeout)
		fetchHeadTimeout = null
	}

	if (!nick || nick.trim().length < 3) {
		kLauncherHeadUrl.value = null
		return
	}

	fetchHeadTimeout = setTimeout(async () => {
		try {
			const json = await fetchExternalJson<{
				textures?: { SKIN?: { url?: string } }
			}>(`${KLAUNCHER_SKIN_API}${encodeURIComponent(nick.trim())}`)
			const skinUrl = json?.textures?.SKIN?.url
			if (skinUrl) {
				const httpsUrl = skinUrl.replace('http://', 'https://')
				try {
					const headBlob = await generatePlayerHeadBlob(httpsUrl, 64)
					if (kLauncherHeadUrl.value) {
						URL.revokeObjectURL(kLauncherHeadUrl.value)
					}
					kLauncherHeadUrl.value = URL.createObjectURL(headBlob)
				} catch (renderError) {
					console.warn('Failed to render KLauncher head:', renderError)
					kLauncherHeadUrl.value = null
				}
			} else {
				kLauncherHeadUrl.value = null
			}
		} catch (fetchError) {
			console.warn('Failed to fetch KLauncher skin:', fetchError)
			kLauncherHeadUrl.value = null
		}
	}, 300)
}

function openKLauncherRegister() {
	void openUrl(KLAUNCHER_REGISTER_URL)
}

function openKLauncherRecovery() {
	void openUrl(KLAUNCHER_RECOVERY_URL)
}

function handleKLauncherNickInput(value: string) {
	emit('update:kLauncherLoginValue', value)
	void fetchKLauncherHead(value)
}

function submitKLauncherWithoutPassword() {
	emit('update:kLauncherPassword', '')
	emit('submit-klauncher')
}

const messages = defineMessages({
	addElyByHeader: {
		id: 'astralrinth.app.minecraft-account.input.elyby.header',
		defaultMessage: 'Authenticate with Ely.by',
	},
	addKLauncherHeader: {
		id: 'astralrinth.app.minecraft-account.input.klauncher.header',
		defaultMessage: 'Авторизация KLauncher',
	},
	kLauncherLoginLabel: {
		id: 'astralrinth.app.minecraft-account.input.klauncher.login.label',
		defaultMessage: 'Никнейм или Логин',
	},
	kLauncherLoginPlaceholder: {
		id: 'astralrinth.app.minecraft-account.input.klauncher.login.placeholder',
		defaultMessage: 'Ваш никнейм в KLauncher...',
	},
	kLauncherPasswordLabel: {
		id: 'astralrinth.app.minecraft-account.input.klauncher.password.label',
		defaultMessage: 'Пароль (необязательно для офлайн-режима)',
	},
	kLauncherPasswordPlaceholder: {
		id: 'astralrinth.app.minecraft-account.input.klauncher.password.placeholder',
		defaultMessage: 'Пароль от аккаунта KLauncher...',
	},
	requestTwoFactorHeader: {
		id: 'astralrinth.app.minecraft-account.input.elyby.two-factor.header',
		defaultMessage: 'Ely.by requested 2FA code for authentication',
	},
	requestTwoFactorLabel: {
		id: 'astralrinth.app.minecraft-account.input.elyby.two-factor.label',
		defaultMessage: 'Enter your 2FA code',
	},
	requestTwoFactorPlaceholder: {
		id: 'astralrinth.app.minecraft-account.input.elyby.two-factor.placeholder',
		defaultMessage: 'Your 2FA code here...',
	},
	continueAction: {
		id: 'astralrinth.app.minecraft-account.input.elyby.two-factor.continue-action',
		defaultMessage: 'Продолжить',
	},
	elyByLoginLabel: {
		id: 'astralrinth.app.minecraft-account.input.elyby.login.label',
		defaultMessage: 'Enter your player name or email (preferred)',
	},
	elyByLoginPlaceholder: {
		id: 'astralrinth.app.minecraft-account.input.elyby.login.placeholder',
		defaultMessage: 'Your player name or email here...',
	},
	elyByPasswordLabel: {
		id: 'astralrinth.app.minecraft-account.input.elyby.password.label',
		defaultMessage: 'Enter your password',
	},
	elyByPasswordPlaceholder: {
		id: 'astralrinth.app.minecraft-account.input.elyby.password.placeholder',
		defaultMessage: 'Your password here...',
	},
	loginAction: {
		id: 'astralrinth.app.minecraft-account.input.login-action',
		defaultMessage: 'Login',
	},
	addOfflineHeader: {
		id: 'astralrinth.app.minecraft-account.input.offline.header',
		defaultMessage: 'Add new offline account',
	},
	offlineNameLabel: {
		id: 'astralrinth.app.minecraft-account.input.offline.name.label',
		defaultMessage: 'Enter your player name',
	},
	offlineNamePlaceholder: {
		id: 'astralrinth.app.minecraft-account.input.offline.name.placeholder',
		defaultMessage: 'Your player name here...',
	},
})

defineExpose({
	hideElyBy: () => addElyByModal.value?.hide(),
	hideElyByTwoFactor: () => requestElyByTwoFactorCodeModal.value?.hide(),
	hideOffline: () => addOfflineModal.value?.hide(),
	hideKLauncher: () => addKLauncherModal.value?.hide(),
	showElyBy: () => addElyByModal.value?.show(),
	showElyByTwoFactor: () => requestElyByTwoFactorCodeModal.value?.show(),
	showOffline: () => addOfflineModal.value?.show(),
	showKLauncher: () => {
		kLauncherStep.value = 1
		kLauncherHeadUrl.value = null
		addKLauncherModal.value?.show()
	},
})
</script>

<template>
	<ModalWrapper ref="addElyByModal" class="modal" :header="formatMessage(messages.addElyByHeader)">
		<ModalWrapper
			ref="requestElyByTwoFactorCodeModal"
			class="modal"
			:header="formatMessage(messages.requestTwoFactorHeader)"
		>
			<div class="flex flex-col gap-4 px-6 py-5">
				<label class="label form-label">{{ formatMessage(messages.requestTwoFactorLabel) }}</label>
				<input
					:value="props.elyByTwoFactorCode"
					type="text"
					:placeholder="formatMessage(messages.requestTwoFactorPlaceholder)"
					class="input soft-input"
					@input="
						emit('update:elyByTwoFactorCode', ($event.target as HTMLInputElement).value)
					"
				/>
				<div class="mt-6 ml-auto">
					<Button color="primary" :disabled="props.elyByLoginDisabled" @click="emit('submit-elyby')">
						{{ formatMessage(messages.continueAction) }}
					</Button>
				</div>
			</div>
		</ModalWrapper>
		<div class="flex flex-col gap-4 px-6 py-5">
			<label class="label form-label">{{ formatMessage(messages.elyByLoginLabel) }}</label>
			<input
				:value="props.elyByLoginValue"
				type="text"
				:placeholder="formatMessage(messages.elyByLoginPlaceholder)"
				class="input soft-input"
				@input="emit('update:elyByLoginValue', ($event.target as HTMLInputElement).value)"
			/>
			<label class="label form-label">{{ formatMessage(messages.elyByPasswordLabel) }}</label>
			<input
				:value="props.elyByPassword"
				type="password"
				:placeholder="formatMessage(messages.elyByPasswordPlaceholder)"
				class="input soft-input"
				@input="emit('update:elyByPassword', ($event.target as HTMLInputElement).value)"
			/>
			<div class="mt-6 ml-auto">
				<Button color="primary" :disabled="props.elyByLoginDisabled" @click="emit('submit-elyby')">
					{{ formatMessage(messages.loginAction) }}
				</Button>
			</div>
		</div>
	</ModalWrapper>
	<ModalWrapper
		ref="addOfflineModal"
		class="modal"
		:header="formatMessage(messages.addOfflineHeader)"
	>
		<div class="flex flex-col gap-4 px-6 py-5">
			<label class="label form-label">{{ formatMessage(messages.offlineNameLabel) }}</label>
			<input
				:value="props.offlinePlayerName"
				type="text"
				:placeholder="formatMessage(messages.offlineNamePlaceholder)"
				class="input soft-input"
				@input="emit('update:offlinePlayerName', ($event.target as HTMLInputElement).value)"
			/>
			<div class="mt-6 ml-auto">
				<Button color="primary" :disabled="props.offlineLoginDisabled" @click="emit('submit-offline')">
					{{ formatMessage(messages.loginAction) }}
				</Button>
			</div>
		</div>
	</ModalWrapper>
	<ModalWrapper
		ref="addKLauncherModal"
		class="modal"
		:header="formatMessage(messages.addKLauncherHeader)"
	>
		<div class="flex flex-col gap-4 px-6 py-5 w-[360px]">
			<!-- Header -->
			<div class="flex items-center gap-3 p-3 bg-surface-2 border border-solid border-surface-5 rounded-xl">
				<img
					v-if="kLauncherHeadUrl"
					:src="kLauncherHeadUrl"
					alt=""
					class="w-10 h-10 rounded-lg object-cover image-pixelated"
				/>
				<div
					v-else
					class="w-10 h-10 rounded-lg bg-surface-3 flex items-center justify-center text-secondary text-lg font-bold"
				>
					?
				</div>
				<div class="flex flex-col min-w-0">
					<span class="font-bold text-contrast truncate text-sm">
						{{ props.kLauncherLoginValue?.trim() || 'Игрок' }}
					</span>
					<span class="text-xs text-secondary">Аккаунт KLauncher</span>
				</div>
			</div>

			<!-- Step 1: Nickname input -->
			<div v-if="kLauncherStep === 1" class="flex flex-col gap-3">
				<label class="label form-label">{{ formatMessage(messages.kLauncherLoginLabel) }}</label>
				<input
					:value="props.kLauncherLoginValue"
					type="text"
					:placeholder="formatMessage(messages.kLauncherLoginPlaceholder)"
					class="input soft-input"
					@input="handleKLauncherNickInput(($event.target as HTMLInputElement).value)"
				/>
			<div class="mt-4 flex justify-end">
				<Button
					color="primary"
					:disabled="!props.kLauncherLoginValue || props.kLauncherLoginValue.trim().length < 3"
					@click="kLauncherStep = 2"
				>
					{{ formatMessage(messages.continueAction) }}
				</Button>
			</div>
				<button
					class="text-xs text-secondary underline bg-transparent border-0 cursor-pointer self-center"
					@click="openKLauncherRegister"
				>
					Нет аккаунта? Зарегистрироваться
				</button>
			</div>

			<!-- Step 2: Password input -->
			<div v-else class="flex flex-col gap-3">
				<label class="label form-label">{{ formatMessage(messages.kLauncherPasswordLabel) }}</label>
				<input
					:value="props.kLauncherPassword"
					type="password"
					:placeholder="formatMessage(messages.kLauncherPasswordPlaceholder)"
					class="input soft-input"
					@input="emit('update:kLauncherPassword', ($event.target as HTMLInputElement).value)"
				/>
				<div class="flex gap-2 mt-4">
					<Button
						color="primary"
						class="flex-1"
						:disabled="props.kLauncherLoginDisabled"
						@click="emit('submit-klauncher')"
					>
						{{ formatMessage(messages.loginAction) }}
					</Button>
					<Button
						color="brand"
						type="outlined"
						class="flex-1"
						:disabled="props.kLauncherLoginDisabled"
						@click="submitKLauncherWithoutPassword"
					>
						Войти без пароля
					</Button>
				</div>
				<div class="flex items-center justify-between mt-1">
					<button
						class="text-xs text-secondary underline bg-transparent border-0 cursor-pointer"
						@click="kLauncherStep = 1"
					>
						← Назад к вводу ника
					</button>
					<button
						class="text-xs text-secondary underline bg-transparent border-0 cursor-pointer"
						@click="openKLauncherRecovery"
					>
						Забыли пароль?
					</button>
				</div>
			</div>
		</div>
	</ModalWrapper>
</template>

<style scoped lang="scss">
@import '../../../../../../../../packages/assets/styles/astralrinth/soft-inputs.scss';

.modal {
	position: absolute;
}

.image-pixelated {
	image-rendering: pixelated;
}
</style>
