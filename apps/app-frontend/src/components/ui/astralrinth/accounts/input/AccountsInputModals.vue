<script setup lang="ts">
import { Button, defineMessages, useVIntl } from '@modrinth/ui'
import { openUrl } from '@tauri-apps/plugin-opener'
import { onUnmounted, ref } from 'vue'

import ModalWrapper from '@/components/ui/modal/ModalWrapper.vue'
import { fetchExternalImageObjectUrl, fetchExternalJson } from '@/helpers/external-image.ts'
import { generatePlayerHeadBlob } from '@/helpers/rendering/batch-skin-renderer.ts'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

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
	tLauncherLoginDisabled?: boolean
	tLauncherLoginValue?: string
	tLauncherPassword?: string
}>()

const emit = defineEmits<{
	(event: 'submit-elyby'): void
	(event: 'submit-offline'): void
	(event: 'submit-klauncher'): void
	(event: 'submit-tlauncher'): void
	(event: 'update:elyByLoginValue', value: string): void
	(event: 'update:elyByPassword', value: string): void
	(event: 'update:elyByTwoFactorCode', value: string): void
	(event: 'update:offlinePlayerName', value: string): void
	(event: 'update:kLauncherLoginValue', value: string): void
	(event: 'update:kLauncherPassword', value: string): void
	(event: 'update:tLauncherLoginValue', value: string): void
	(event: 'update:tLauncherPassword', value: string): void
}>()

const { formatMessage } = useVIntl()

const addOfflineModal = ref<ModalHandle | null>(null)
const addElyByModal = ref<ModalHandle | null>(null)
const addKLauncherModal = ref<ModalHandle | null>(null)
const addTLauncherModal = ref<ModalHandle | null>(null)
const requestElyByTwoFactorCodeModal = ref<ModalHandle | null>(null)

const kLauncherStep = ref(1)
const kLauncherHeadUrl = ref<string | null>(null)
const tLauncherStep = ref(1)
const tLauncherHeadUrl = ref<string | null>(null)
const elyByHeadUrl = ref<string | null>(null)

onUnmounted(() => {
	if (kLauncherHeadUrl.value) {
		URL.revokeObjectURL(kLauncherHeadUrl.value)
	}
	if (tLauncherHeadUrl.value) {
		URL.revokeObjectURL(tLauncherHeadUrl.value)
	}
	if (elyByHeadUrl.value) {
		URL.revokeObjectURL(elyByHeadUrl.value)
	}
})

const ELYBY_REGISTER_URL = 'https://account.ely.by/register'
const ELYBY_RECOVERY_URL = 'https://account.ely.by/login'
const TLAUNCHER_REGISTER_URL = 'https://tlauncher.org/ru/reg/'
const TLAUNCHER_RECOVERY_URL = 'https://tlauncher.org/ru/catalog/user/'
const KLAUNCHER_REGISTER_URL = 'https://klauncher.gg/register'
const KLAUNCHER_RECOVERY_URL = 'https://klauncher.gg/restore'
const KLAUNCHER_SKIN_API = 'https://api.klaun.ch/v2/user/skin?nick='

let fetchHeadTimeout: ReturnType<typeof setTimeout> | null = null
let fetchElyByHeadTimeout: ReturnType<typeof setTimeout> | null = null

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
		const trimmedNick = nick.trim()
		let headUrlFound: string | null = null

		// 1. Пытаемся получить скин из официального API KLauncher
		try {
			const json = await fetchExternalJson<{
				textures?: { SKIN?: { url?: string } }
			}>(`${KLAUNCHER_SKIN_API}${encodeURIComponent(trimmedNick)}`)
			const skinUrl = json?.textures?.SKIN?.url
			if (skinUrl) {
				const httpsUrl = skinUrl.replace('http://', 'https://')
				try {
					const headBlob = await generatePlayerHeadBlob(httpsUrl, 64)
					headUrlFound = URL.createObjectURL(headBlob)
				} catch (renderError) {
					console.warn('Failed to render KLauncher head from skinUrl:', renderError)
				}
			}
		} catch (fetchError) {
			console.warn('KLauncher skin API unreachable or errored, trying fallback:', fetchError)
		}

		// 2. Если KLauncher сервер недоступен (500/502/504) или скина нет — fallback на mc-heads.net
		if (!headUrlFound) {
			try {
				const res = await tauriFetch(`https://mc-heads.net/avatar/${encodeURIComponent(trimmedNick)}/64`)
				if (res.ok) {
					const blob = await res.blob()
					headUrlFound = URL.createObjectURL(blob)
				}
			} catch (fallbackError) {
				console.warn('Failed to fetch fallback head from mc-heads:', fallbackError)
			}
		}

		if (kLauncherHeadUrl.value) {
			URL.revokeObjectURL(kLauncherHeadUrl.value)
		}
		kLauncherHeadUrl.value = headUrlFound
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

function goToKLauncherStep2() {
	kLauncherStep.value = 2
	if (!kLauncherHeadUrl.value && props.kLauncherLoginValue && props.kLauncherLoginValue.trim().length >= 3) {
		void fetchKLauncherHead(props.kLauncherLoginValue)
	}
}

let fetchTLauncherHeadTimeout: ReturnType<typeof setTimeout> | null = null

async function fetchTLauncherHead(nick: string) {
	if (fetchTLauncherHeadTimeout) {
		clearTimeout(fetchTLauncherHeadTimeout)
		fetchTLauncherHeadTimeout = null
	}

	if (!nick || nick.trim().length < 3) {
		tLauncherHeadUrl.value = null
		return
	}

	fetchTLauncherHeadTimeout = setTimeout(async () => {
		const trimmedNick = nick.trim()
		let headUrlFound: string | null = null

		// 1. Получаем URL текстуры скина через TLauncher API на skins.tl.vg
		let skinUrlToLoad: string | null = null
		try {
			const json = await fetchExternalJson<{
				SKIN?: { url?: string }
				textures?: { SKIN?: { url?: string } }
			}>(`http://skins.tl.vg/skin/profile/texture/login/${encodeURIComponent(trimmedNick)}`)
			const rawSkin = json?.SKIN?.url || json?.textures?.SKIN?.url
			if (rawSkin) {
				skinUrlToLoad = rawSkin
					.replace('https://auth.tlauncher.org', 'http://skins.tl.vg')
					.replace('http://auth.tlauncher.org', 'http://skins.tl.vg')
					.replace('https://auth.tlauncher.ru', 'http://skins.tl.vg')
					.replace('http://auth.tlauncher.ru', 'http://skins.tl.vg')
			}
		} catch (fetchError) {
			console.warn('TLauncher skin profile API unreachable, trying direct file:', fetchError)
		}

		// Fallback: прямое имя файла скина TLauncher
		if (!skinUrlToLoad) {
			skinUrlToLoad = `http://skins.tl.vg/skin/fileservice/skins/skin_${encodeURIComponent(trimmedNick)}.png`
		}

		// Скачиваем скин через Tauri HTTP плагин и рендерим голову локально (без CORS ограничений)
		if (skinUrlToLoad) {
			let tempBlobUrl: string | null = null
			try {
				tempBlobUrl = await fetchExternalImageObjectUrl(skinUrlToLoad)
				const headBlob = await generatePlayerHeadBlob(tempBlobUrl, 64)
				headUrlFound = URL.createObjectURL(headBlob)
			} catch (renderError) {
				console.warn('Failed to render TLauncher head:', renderError)
			} finally {
				if (tempBlobUrl) {
					URL.revokeObjectURL(tempBlobUrl)
				}
			}
		}

		// 2. Fallback на mc-heads.net, только если скин на TLauncher не найден
		if (!headUrlFound) {
			try {
				const res = await tauriFetch(`https://mc-heads.net/avatar/${encodeURIComponent(trimmedNick)}/64`)
				if (res.ok) {
					const blob = await res.blob()
					headUrlFound = URL.createObjectURL(blob)
				}
			} catch (fallbackError) {
				console.warn('Failed to fetch fallback head from mc-heads:', fallbackError)
			}
		}

		if (tLauncherHeadUrl.value) {
			URL.revokeObjectURL(tLauncherHeadUrl.value)
		}
		tLauncherHeadUrl.value = headUrlFound
	}, 300)
}


function openTLauncherRegister() {
	void openUrl(TLAUNCHER_REGISTER_URL)
}

function openTLauncherRecovery() {
	void openUrl(TLAUNCHER_RECOVERY_URL)
}

function handleTLauncherNickInput(value: string) {
	emit('update:tLauncherLoginValue', value)
	void fetchTLauncherHead(value)
}

function goToTLauncherStep2() {
	tLauncherStep.value = 2
	if (!tLauncherHeadUrl.value && props.tLauncherLoginValue && props.tLauncherLoginValue.trim().length >= 3) {
		void fetchTLauncherHead(props.tLauncherLoginValue)
	}
}

async function fetchElyByHead(nick: string) {
	if (fetchElyByHeadTimeout) {
		clearTimeout(fetchElyByHeadTimeout)
		fetchElyByHeadTimeout = null
	}

	if (!nick || nick.trim().length < 3) {
		elyByHeadUrl.value = null
		return
	}

	fetchElyByHeadTimeout = setTimeout(async () => {
		const trimmedNick = nick.trim()
		let headUrlFound: string | null = null

		// 1. Пробуем скин напрямую из системы скинов Ely.by
		const skinUrl = `http://skinsystem.ely.by/textures/skins/${encodeURIComponent(trimmedNick)}.png`
		let tempBlobUrl: string | null = null
		try {
			tempBlobUrl = await fetchExternalImageObjectUrl(skinUrl)
			const headBlob = await generatePlayerHeadBlob(tempBlobUrl, 64)
			headUrlFound = URL.createObjectURL(headBlob)
		} catch (e) {
			console.warn('Ely.by skin fetch failed, fallback to mc-heads:', e)
		} finally {
			if (tempBlobUrl) {
				URL.revokeObjectURL(tempBlobUrl)
			}
		}

		// 2. Fallback на mc-heads
		if (!headUrlFound) {
			try {
				const res = await tauriFetch(`https://mc-heads.net/avatar/${encodeURIComponent(trimmedNick)}/64`)
				if (res.ok) {
					const blob = await res.blob()
					headUrlFound = URL.createObjectURL(blob)
				}
			} catch (fallbackError) {
				console.warn('Failed to fetch fallback head for Ely.by:', fallbackError)
			}
		}

		if (elyByHeadUrl.value) {
			URL.revokeObjectURL(elyByHeadUrl.value)
		}
		elyByHeadUrl.value = headUrlFound
	}, 300)
}

function handleElyByNickInput(value: string) {
	emit('update:elyByLoginValue', value)
	void fetchElyByHead(value)
}

function openElyByRegister() {
	void openUrl(ELYBY_REGISTER_URL)
}

function openElyByRecovery() {
	void openUrl(ELYBY_RECOVERY_URL)
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
	addTLauncherHeader: {
		id: 'astralrinth.app.minecraft-account.input.tlauncher.header',
		defaultMessage: 'Авторизация TLauncher',
	},
	tLauncherLoginLabel: {
		id: 'astralrinth.app.minecraft-account.input.tlauncher.login.label',
		defaultMessage: 'Никнейм или Логин',
	},
	tLauncherLoginPlaceholder: {
		id: 'astralrinth.app.minecraft-account.input.tlauncher.login.placeholder',
		defaultMessage: 'Ваш никнейм в TLauncher...',
	},
	tLauncherPasswordLabel: {
		id: 'astralrinth.app.minecraft-account.input.tlauncher.password.label',
		defaultMessage: 'Пароль (необязательно для офлайн-режима)',
	},
	tLauncherPasswordPlaceholder: {
		id: 'astralrinth.app.minecraft-account.input.tlauncher.password.placeholder',
		defaultMessage: 'Пароль от аккаунта TLauncher...',
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
	hideTLauncher: () => addTLauncherModal.value?.hide(),
	showElyBy: () => {
		addElyByModal.value?.show()
		if (props.elyByLoginValue && props.elyByLoginValue.trim().length >= 3) {
			void fetchElyByHead(props.elyByLoginValue)
		} else {
			if (elyByHeadUrl.value) {
				URL.revokeObjectURL(elyByHeadUrl.value)
			}
			elyByHeadUrl.value = null
		}
	},
	showElyByTwoFactor: () => requestElyByTwoFactorCodeModal.value?.show(),
	showOffline: () => addOfflineModal.value?.show(),
	showKLauncher: () => {
		kLauncherStep.value = 1
		addKLauncherModal.value?.show()
		if (props.kLauncherLoginValue && props.kLauncherLoginValue.trim().length >= 3) {
			void fetchKLauncherHead(props.kLauncherLoginValue)
		} else {
			if (kLauncherHeadUrl.value) {
				URL.revokeObjectURL(kLauncherHeadUrl.value)
			}
			kLauncherHeadUrl.value = null
		}
	},
	showTLauncher: () => {
		tLauncherStep.value = 1
		addTLauncherModal.value?.show()
		if (props.tLauncherLoginValue && props.tLauncherLoginValue.trim().length >= 3) {
			void fetchTLauncherHead(props.tLauncherLoginValue)
		} else {
			if (tLauncherHeadUrl.value) {
				URL.revokeObjectURL(tLauncherHeadUrl.value)
			}
			tLauncherHeadUrl.value = null
		}
	},
})
</script>

<template>
	<ModalWrapper ref="addElyByModal" class="modal" :header="formatMessage(messages.addElyByHeader)">
		<div class="flex flex-col gap-4 px-6 py-5 w-[360px]">
			<!-- Header / Player preview card -->
			<div class="flex items-center gap-3 p-3 bg-surface-2 border border-solid border-surface-5 rounded-xl">
				<img
					v-if="elyByHeadUrl"
					:src="elyByHeadUrl"
					alt=""
					class="w-10 h-10 rounded-lg object-cover image-pixelated"
				/>
				<div
					v-else
					class="w-10 h-10 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-base font-bold"
				>
					E
				</div>
				<div class="flex flex-col min-w-0">
					<span class="font-bold text-contrast truncate text-sm">
						{{ props.elyByLoginValue?.trim() || 'Игрок' }}
					</span>
					<span class="text-xs text-secondary">Аккаунт Ely.by</span>
				</div>
			</div>

			<!-- Input form -->
			<div class="flex flex-col gap-3">
				<label class="label form-label">{{ formatMessage(messages.elyByLoginLabel) }}</label>
				<input
					:value="props.elyByLoginValue"
					type="text"
					:placeholder="formatMessage(messages.elyByLoginPlaceholder)"
					class="input soft-input"
					@input="handleElyByNickInput(($event.target as HTMLInputElement).value)"
					@keydown.enter="props.elyByLoginValue && props.elyByPassword && emit('submit-elyby')"
				/>
				<label class="label form-label">{{ formatMessage(messages.elyByPasswordLabel) }}</label>
				<input
					:value="props.elyByPassword"
					type="password"
					:placeholder="formatMessage(messages.elyByPasswordPlaceholder)"
					class="input soft-input"
					@input="emit('update:elyByPassword', ($event.target as HTMLInputElement).value)"
					@keydown.enter="props.elyByLoginValue && props.elyByPassword && emit('submit-elyby')"
				/>
				<div class="mt-2 flex flex-col gap-2">
					<Button
						color="primary"
						class="w-full"
						:disabled="props.elyByLoginDisabled || !props.elyByLoginValue || !props.elyByPassword"
						@click="emit('submit-elyby')"
					>
						{{ formatMessage(messages.loginAction) }}
					</Button>
				</div>
				<div class="flex items-center justify-between mt-2">
					<button
						class="text-xs text-secondary underline bg-transparent border-0 cursor-pointer"
						@click="openElyByRegister"
					>
						Регистрация
					</button>
					<button
						class="text-xs text-secondary underline bg-transparent border-0 cursor-pointer"
						@click="openElyByRecovery"
					>
						Забыли пароль?
					</button>
				</div>
			</div>
		</div>
	</ModalWrapper>

	<ModalWrapper
		ref="requestElyByTwoFactorCodeModal"
		class="modal"
		:header="formatMessage(messages.requestTwoFactorHeader)"
	>
		<div class="flex flex-col gap-4 px-6 py-5 w-[360px]">
			<label class="label form-label">{{ formatMessage(messages.requestTwoFactorLabel) }}</label>
			<input
				:value="props.elyByTwoFactorCode"
				type="text"
				:placeholder="formatMessage(messages.requestTwoFactorPlaceholder)"
				class="input soft-input"
				@input="emit('update:elyByTwoFactorCode', ($event.target as HTMLInputElement).value)"
				@keydown.enter="props.elyByTwoFactorCode && emit('submit-elyby')"
			/>
			<div class="mt-2 flex flex-col gap-2">
				<Button
					color="primary"
					class="w-full"
					:disabled="props.elyByLoginDisabled || !props.elyByTwoFactorCode"
					@click="emit('submit-elyby')"
				>
					{{ formatMessage(messages.continueAction) }}
				</Button>
			</div>
		</div>
	</ModalWrapper>
	<ModalWrapper
		ref="addOfflineModal"
		class="modal"
		:header="formatMessage(messages.addOfflineHeader)"
	>
		<div class="flex flex-col gap-4 px-6 py-5 w-[360px]">
			<!-- Header -->
			<div class="flex items-center gap-3 p-3 bg-surface-2 border border-solid border-surface-5 rounded-xl">
				<div
					class="w-10 h-10 rounded-lg bg-surface-3 flex items-center justify-center text-secondary text-base font-bold select-none"
				>
					👤
				</div>
				<div class="flex flex-col min-w-0">
					<span class="font-bold text-contrast truncate text-sm">
						{{ props.offlinePlayerName?.trim() || 'Игрок' }}
					</span>
					<span class="text-xs text-secondary">Офлайн-аккаунт</span>
				</div>
			</div>

			<!-- Nickname input -->
			<div class="flex flex-col gap-2">
				<label class="label form-label">{{ formatMessage(messages.offlineNameLabel) }}</label>
				<input
					:value="props.offlinePlayerName"
					type="text"
					:placeholder="formatMessage(messages.offlineNamePlaceholder)"
					class="input soft-input"
					@input="emit('update:offlinePlayerName', ($event.target as HTMLInputElement).value)"
					@keydown.enter="props.offlinePlayerName && props.offlinePlayerName.trim().length >= 3 && emit('submit-offline')"
				/>
			</div>

			<!-- Action button -->
			<div class="mt-2">
				<Button
					color="primary"
					class="w-full"
					:disabled="props.offlineLoginDisabled || !props.offlinePlayerName || props.offlinePlayerName.trim().length < 3"
					@click="emit('submit-offline')"
				>
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
					@keydown.enter="props.kLauncherLoginValue && props.kLauncherLoginValue.trim().length >= 3 && goToKLauncherStep2()"
				/>
				<div class="mt-2 flex flex-col gap-2">
					<Button
						color="primary"
						class="w-full"
						:disabled="!props.kLauncherLoginValue || props.kLauncherLoginValue.trim().length < 3"
						@click="goToKLauncherStep2"
					>
						{{ formatMessage(messages.continueAction) }}
					</Button>
					<button
						class="text-xs text-secondary underline bg-transparent border-0 cursor-pointer self-center mt-1"
						@click="openKLauncherRegister"
					>
						Нет аккаунта? Зарегистрироваться
					</button>
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
					@keydown.enter="props.kLauncherPassword && emit('submit-klauncher')"
				/>
				<div class="mt-2 flex flex-col gap-2">
					<Button
						color="primary"
						class="w-full"
						:disabled="props.kLauncherLoginDisabled || !props.kLauncherPassword"
						@click="emit('submit-klauncher')"
					>
						{{ formatMessage(messages.loginAction) }}
					</Button>
				</div>
				<div class="flex items-center justify-between mt-2">
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
	<ModalWrapper
		ref="addTLauncherModal"
		class="modal"
		:header="formatMessage(messages.addTLauncherHeader)"
	>
		<div class="flex flex-col gap-4 px-6 py-5 w-[360px]">
			<!-- Header -->
			<div class="flex items-center gap-3 p-3 bg-surface-2 border border-solid border-surface-5 rounded-xl">
				<div
					class="w-10 h-10 rounded-lg bg-surface-3 flex items-center justify-center text-amber-400 text-base font-bold"
				>
					TL
				</div>
				<div class="flex flex-col min-w-0">
					<span class="font-bold text-contrast truncate text-sm">
						TLauncher
					</span>
					<span class="text-xs text-amber-400 font-medium">В будущем сделаем</span>
				</div>
			</div>

			<!-- Info banner -->
			<div class="p-3 bg-surface-2 border border-solid border-surface-5 rounded-xl flex flex-col gap-1 text-center">
				<span class="text-sm font-semibold text-contrast">Вход временно недоступен</span>
				<p class="text-xs text-secondary m-0">
					Авторизация через аккаунты TLauncher находится в разработке. В будущем сделаем поддержку входа.
				</p>
			</div>

			<!-- Disabled button -->
			<div class="mt-2">
				<Button
					color="primary"
					class="w-full opacity-50 cursor-not-allowed"
					disabled
				>
					В будущем сделаем
				</Button>
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
