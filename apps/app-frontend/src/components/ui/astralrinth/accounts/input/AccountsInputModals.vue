<script setup lang="ts">
import { Button, defineMessages, useVIntl } from '@modrinth/ui'
import { ref } from 'vue'

import ModalWrapper from '@/components/ui/modal/ModalWrapper.vue'

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
const headCanvas = ref<HTMLCanvasElement | null>(null)
const headFallbackUrl = ref('')

async function updateKLauncherHead(nick: string) {
	if (!nick || nick.trim().length < 3) {
		headFallbackUrl.value = ''
		return
	}
	const trimmed = nick.trim()
	try {
		const res = await fetch(`https://api.klaun.ch/v2/user/skin?nick=${encodeURIComponent(trimmed)}`)
		if (res.ok) {
			const data = await res.json()
			const skinUrl = data?.textures?.SKIN?.url
			if (skinUrl) {
				const img = new Image()
				img.crossOrigin = 'Anonymous'
				img.src = skinUrl
				img.onload = () => {
					if (headCanvas.value) {
						const ctx = headCanvas.value.getContext('2d')
						if (ctx) {
							ctx.imageSmoothingEnabled = false
							ctx.clearRect(0, 0, 64, 64)
							ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64)
							ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64)
						}
					}
				}
				headFallbackUrl.value = ''
				return
			}
		}
	} catch (e) {
		// Fallback
	}
	headFallbackUrl.value = `https://mc-heads.net/avatar/${encodeURIComponent(trimmed)}/64`
}

function handleKLauncherNickInput(value: string) {
	emit('update:kLauncherLoginValue', value)
	updateKLauncherHead(value)
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
		defaultMessage: 'Continue',
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
	showKLauncher: () => addKLauncherModal.value?.show(),
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
			<!-- Avatar Preview Header -->
			<div class="flex items-center gap-3 p-3 bg-surface-2 border border-solid border-surface-5 rounded-xl">
				<div class="w-12 h-12 rounded-lg bg-surface-4 overflow-hidden flex items-center justify-center shrink-0">
					<img v-if="headFallbackUrl" :src="headFallbackUrl" class="w-12 h-12 image-pixelated" />
					<canvas v-else ref="headCanvas" width="64" height="64" class="w-12 h-12 image-pixelated"></canvas>
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
				<div class="mt-4">
					<Button
						color="primary"
						class="w-full"
						:disabled="!props.kLauncherLoginValue || props.kLauncherLoginValue.trim().length < 3"
						@click="kLauncherStep = 2"
					>
						{{ formatMessage(messages.continueAction) }}
					</Button>
				</div>
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
				<div class="flex flex-col gap-2 mt-4">
					<Button
						color="primary"
						class="w-full"
						:disabled="props.kLauncherLoginDisabled"
						@click="emit('submit-klauncher')"
					>
						{{ formatMessage(messages.loginAction) }}
					</Button>
					<Button
						color="brand"
						type="outlined"
						class="w-full"
						:disabled="props.kLauncherLoginDisabled"
						@click="emit('submit-klauncher')"
					>
						Войти без пароля
					</Button>
					<button
						class="text-xs text-secondary underline mt-1 bg-transparent border-0 cursor-pointer self-center"
						@click="kLauncherStep = 1"
					>
						← Назад к вводу ника
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
