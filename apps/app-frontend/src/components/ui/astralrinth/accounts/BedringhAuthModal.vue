<template>
	<NewModal
		ref="modal"
		:header="modalTitle"
		max-width="480px"
		width="100%"
		no-padding
		@hide="onHide"
	>
		<div class="flex flex-col gap-5 p-6">
			<!-- Переключатель режима: Вход / Регистрация (скрыт во время ожидания TG и 2FA) -->
			<div v-if="mode === 'login' || mode === 'register'" class="flex rounded-xl bg-surface-3 p-1">
				<button
					type="button"
					class="flex-1 py-2 text-sm font-semibold rounded-lg transition-colors border-0 cursor-pointer"
					:class="mode === 'login' ? 'bg-brand text-white shadow-sm' : 'bg-transparent text-secondary hover:text-contrast'"
					@click="switchMode('login')"
				>
					Вход
				</button>
				<button
					type="button"
					class="flex-1 py-2 text-sm font-semibold rounded-lg transition-colors border-0 cursor-pointer"
					:class="mode === 'register' ? 'bg-brand text-white shadow-sm' : 'bg-transparent text-secondary hover:text-contrast'"
					@click="switchMode('register')"
				>
					Регистрация
				</button>
			</div>

			<!-- Сообщение об ошибке -->
			<div v-if="errorMessage" class="p-3 bg-red-500/15 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-start gap-2">
				<span class="shrink-0 font-bold">⚠️</span>
				<span>{{ errorMessage }}</span>
			</div>

			<!-- Успешное сообщение -->
			<div v-if="successMessage" class="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm flex items-start gap-2">
				<span class="shrink-0 font-bold">✅</span>
				<span>{{ successMessage }}</span>
			</div>

			<!-- 1. ФОРМА ВХОДА -->
			<form v-if="mode === 'login'" class="flex flex-col gap-4" @submit.prevent="handleLogin">
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-semibold text-secondary uppercase tracking-wider">Никнейм</label>
					<StyledInput
						v-model="loginUsername"
						type="text"
						placeholder="Ваш игровой ник"
						required
						:disabled="loading"
						autocomplete="username"
					/>
				</div>

				<div class="flex flex-col gap-1.5">
					<div class="flex justify-between items-center">
						<label class="text-xs font-semibold text-secondary uppercase tracking-wider">Пароль</label>
						<button
							type="button"
							class="text-xs text-brand hover:underline bg-transparent border-0 cursor-pointer p-0 font-medium"
							@click="switchMode('forgot')"
						>
							Забыли пароль?
						</button>
					</div>
					<StyledInput
						v-model="loginPassword"
						type="password"
						placeholder="Ваш пароль"
						required
						:disabled="loading"
						autocomplete="current-password"
					/>
				</div>

				<ButtonStyled color="brand" class="w-full mt-2">
					<button type="submit" class="w-full justify-center py-2.5 font-semibold" :disabled="loading">
						<SpinnerIcon v-if="loading" class="animate-spin w-5 h-5 mr-2" />
						<LogInIcon v-else class="w-5 h-5 mr-2" />
						Войти в Bedringh ID
					</button>
				</ButtonStyled>
			</form>

			<!-- 2. ВВОД 2FA КОДА ПРИ ВХОДЕ -->
			<div v-else-if="mode === '2fa'" class="flex flex-col gap-4 items-center text-center">
				<div class="w-14 h-14 rounded-2xl bg-purple-500/20 text-purple-400 flex items-center justify-center text-2xl font-bold">
					🛡️
				</div>
				<div class="flex flex-col gap-1">
					<h3 class="m-0 text-lg font-bold text-contrast">Двухэтапная аутентификация</h3>
					<p class="m-0 text-sm text-secondary">
						Код подтверждения отправлен в ваш Telegram-бот <b>@bedringh_bot</b>.
					</p>
				</div>

				<div class="w-full flex flex-col gap-1.5 mt-2">
					<StyledInput
						v-model="twoFactorCode"
						type="text"
						maxlength="6"
						placeholder="6-значный код"
						class="text-center text-xl tracking-widest font-mono"
						:disabled="loading"
						@keyup.enter="handleVerify2FA"
					/>
				</div>

				<ButtonStyled color="brand" class="w-full">
					<button type="button" class="w-full justify-center py-2.5 font-semibold" :disabled="loading || twoFactorCode.length !== 6" @click="handleVerify2FA">
						<SpinnerIcon v-if="loading" class="animate-spin w-5 h-5 mr-2" />
						Подтвердить вход
					</button>
				</ButtonStyled>

				<button
					type="button"
					class="text-xs text-secondary hover:text-contrast bg-transparent border-0 cursor-pointer"
					@click="switchMode('login')"
				>
					← Вернуться ко входу
				</button>
			</div>

			<!-- 3. ФОРМА РЕГИСТРАЦИИ -->
			<form v-else-if="mode === 'register'" class="flex flex-col gap-4" @submit.prevent="handleRegisterIntent">
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-semibold text-secondary uppercase tracking-wider">Игровой никнейм</label>
					<StyledInput
						v-model="regUsername"
						type="text"
						placeholder="Например: Steve_2026"
						required
						:disabled="loading"
					/>
					<span class="text-[11px] text-secondary">Латинские буквы, цифры и _, от 3 до 16 символов</span>
				</div>

				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-semibold text-secondary uppercase tracking-wider">Пароль</label>
					<StyledInput
						v-model="regPassword"
						type="password"
						placeholder="Минимум 6 символов"
						required
						:disabled="loading"
					/>
				</div>

				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-semibold text-secondary uppercase tracking-wider">Повторите пароль</label>
					<StyledInput
						v-model="regPasswordConfirm"
						type="password"
						placeholder="Повторите пароль"
						required
						:disabled="loading"
					/>
				</div>

				<!-- Чекбокс 2FA -->
				<label class="flex items-center gap-2.5 p-3 rounded-xl bg-surface-3 border border-surface-5 cursor-pointer mt-1">
					<input v-model="regEnable2FA" type="checkbox" class="w-4 h-4 rounded text-brand cursor-pointer" />
					<div class="flex flex-col text-left">
						<span class="text-xs font-bold text-contrast">Двухэтапная аутентификация (2FA)</span>
						<span class="text-[11px] text-secondary">Запрашивать код из Telegram при каждом входе в лаунчер</span>
					</div>
				</label>

				<ButtonStyled color="brand" class="w-full mt-2">
					<button type="submit" class="w-full justify-center py-2.5 font-semibold" :disabled="loading">
						<SpinnerIcon v-if="loading" class="animate-spin w-5 h-5 mr-2" />
						<PlusIcon v-else class="w-5 h-5 mr-2" />
						Продолжить регистрацию
					</button>
				</ButtonStyled>
			</form>

			<!-- 4. ОЖИДАНИЕ ПОДТВЕРЖДЕНИЯ В TELEGRAM -->
			<div v-else-if="mode === 'waiting_tg'" class="flex flex-col gap-5 items-center text-center">
				<div class="w-16 h-16 rounded-full bg-brand/15 text-brand flex items-center justify-center text-3xl">
					✈️
				</div>

				<div class="flex flex-col gap-1">
					<h3 class="m-0 text-xl font-bold text-contrast">Подтвердите в Telegram</h3>
					<p class="m-0 text-sm text-secondary">
						Для завершения регистрации аккаунта <b>{{ regUsername }}</b> подтвердите его через нашего бота.
					</p>
				</div>

				<!-- Большой 6-значный код -->
				<div class="w-full p-4 rounded-2xl bg-surface-3 border border-brand/30 flex flex-col items-center gap-1">
					<span class="text-xs text-secondary font-medium">Ваш код подтверждения:</span>
					<span class="text-3xl font-mono font-bold tracking-widest text-brand">{{ tgCode }}</span>
				</div>

				<!-- Кнопка быстрого перехода в Telegram -->
				<ButtonStyled color="brand" class="w-full">
					<button type="button" class="w-full justify-center py-3 text-base font-bold" @click="openTelegramBot">
						🚀 Открыть @bedringh_bot в Telegram
					</button>
				</ButtonStyled>

				<div class="flex items-center gap-2 text-xs text-secondary">
					<SpinnerIcon class="animate-spin w-4 h-4 text-brand" />
					<span>Ожидаем нажатия Start или ввода кода в боте...</span>
				</div>

				<button
					type="button"
					class="text-xs text-secondary hover:text-contrast bg-transparent border-0 cursor-pointer"
					@click="cancelWaiting"
				>
					Отменить
				</button>
			</div>

			<!-- 5. ВОССТАНОВЛЕНИЕ ПАРОЛЯ -->
			<div v-else-if="mode === 'forgot'" class="flex flex-col gap-4">
				<div v-if="!forgotCodeSent" class="flex flex-col gap-4">
					<p class="m-0 text-sm text-secondary">
						Введите ваш игровой никнейм. Мы отправим код для сброса пароля в привязанный Telegram-бот.
					</p>

					<div class="flex flex-col gap-1.5">
						<label class="text-xs font-semibold text-secondary uppercase tracking-wider">Никнейм</label>
						<StyledInput v-model="forgotUsername" type="text" placeholder="Игровой ник" required :disabled="loading" />
					</div>

					<ButtonStyled color="brand" class="w-full">
						<button type="button" class="w-full justify-center py-2.5 font-semibold" :disabled="loading || !forgotUsername" @click="handleSendResetCode">
							<SpinnerIcon v-if="loading" class="animate-spin w-5 h-5 mr-2" />
							Отправить код в Telegram
						</button>
					</ButtonStyled>
				</div>

				<div v-else class="flex flex-col gap-4">
					<p class="m-0 text-sm text-secondary">
						Код отправлен в Telegram. Введите его и укажите новый пароль.
					</p>

					<div class="flex flex-col gap-1.5">
						<label class="text-xs font-semibold text-secondary uppercase tracking-wider">Код из Telegram</label>
						<StyledInput v-model="forgotCode" type="text" placeholder="6-значный код" required :disabled="loading" />
					</div>

					<div class="flex flex-col gap-1.5">
						<label class="text-xs font-semibold text-secondary uppercase tracking-wider">Новый пароль</label>
						<StyledInput v-model="forgotNewPassword" type="password" placeholder="Минимум 6 символов" required :disabled="loading" />
					</div>

					<ButtonStyled color="brand" class="w-full">
						<button type="button" class="w-full justify-center py-2.5 font-semibold" :disabled="loading" @click="handleResetPassword">
							<SpinnerIcon v-if="loading" class="animate-spin w-5 h-5 mr-2" />
							Сохранить новый пароль
						</button>
					</ButtonStyled>
				</div>

				<button
					type="button"
					class="text-xs text-secondary hover:text-contrast bg-transparent border-0 cursor-pointer self-center"
					@click="switchMode('login')"
				>
					← Вернуться ко входу
				</button>
			</div>
		</div>
	</NewModal>
</template>

<script setup lang="ts">
import { LogInIcon, PlusIcon, SpinnerIcon } from '@modrinth/assets'
import { ButtonStyled, NewModal, StyledInput, injectNotificationManager } from '@modrinth/ui'
import { openUrl } from '@tauri-apps/plugin-opener'
import { computed, onUnmounted, ref } from 'vue'

const emit = defineEmits<{
	success: [account: any]
}>()

const modal = ref<InstanceType<typeof NewModal> | null>(null)
const { addNotification, handleError } = injectNotificationManager()

const API_BASE_URL = 'https://oskarlolpo.play2go.cloud'

type AuthMode = 'login' | 'register' | 'waiting_tg' | '2fa' | 'forgot'

const mode = ref<AuthMode>('login')
const loading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

// Login state
const loginUsername = ref('')
const loginPassword = ref('')

// 2FA state
const twoFactorCode = ref('')
const temp2FAToken = ref('')

// Register state
const regUsername = ref('')
const regPassword = ref('')
const regPasswordConfirm = ref('')
const regEnable2FA = ref(false)

// TG Waiting state
const tgToken = ref('')
const tgCode = ref('')
const tgBotUrl = ref('')
let pollTimer: any = null

// Forgot password state
const forgotUsername = ref('')
const forgotCode = ref('')
const forgotNewPassword = ref('')
const forgotCodeSent = ref(false)

const modalTitle = computed(() => {
	switch (mode.value) {
		case 'login':
			return 'Вход в Bedringh ID'
		case 'register':
			return 'Регистрация Bedringh ID'
		case 'waiting_tg':
			return 'Подтверждение в Telegram'
		case '2fa':
			return 'Проверка 2FA'
		case 'forgot':
			return 'Восстановление пароля'
		default:
			return 'Bedringh ID'
	}
})

function show(initialMode: AuthMode = 'login') {
	switchMode(initialMode)
	errorMessage.value = ''
	successMessage.value = ''
	modal.value?.show()
}

function hide() {
	stopPolling()
	modal.value?.hide()
}

function onHide() {
	stopPolling()
}

function switchMode(newMode: AuthMode) {
	mode.value = newMode
	errorMessage.value = ''
	successMessage.value = ''
	stopPolling()
}

// 1. Вход
async function handleLogin() {
	errorMessage.value = ''
	loading.value = true

	try {
		const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: loginUsername.value.trim(),
				password: loginPassword.value,
			}),
		})

		const data = await response.json()

		if (!response.ok) {
			errorMessage.value = data.error || 'Ошибка при входе'
			return
		}

		// Если требуется 2FA
		if (data.twoFactorRequired) {
			temp2FAToken.value = data.tempToken
			twoFactorCode.value = ''
			switchMode('2fa')
			return
		}

		// Успешный вход
		await completeLogin(data.user.username, data.authToken)
	} catch (err: any) {
		errorMessage.value = err?.message || 'Не удалось подключиться к серверу авторизации'
	} finally {
		loading.value = false
	}
}

// 2. Подтверждение 2FA
async function handleVerify2FA() {
	if (twoFactorCode.value.length !== 6) return
	errorMessage.value = ''
	loading.value = true

	try {
		const response = await fetch(`${API_BASE_URL}/api/auth/verify-2fa`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: loginUsername.value.trim(),
				code: twoFactorCode.value.trim(),
				tempToken: temp2FAToken.value,
			}),
		})

		const data = await response.json()

		if (!response.ok) {
			errorMessage.value = data.error || 'Неверный код 2FA'
			return
		}

		await completeLogin(data.user.username, data.authToken)
	} catch (err: any) {
		errorMessage.value = err?.message || 'Ошибка проверки 2FA'
	} finally {
		loading.value = false
	}
}

// 3. Запрос регистрации (intent)
async function handleRegisterIntent() {
	errorMessage.value = ''

	if (regPassword.value !== regPasswordConfirm.value) {
		errorMessage.value = 'Пароли не совпадают'
		return
	}

	if (regPassword.value.length < 6) {
		errorMessage.value = 'Пароль должен быть не менее 6 символов'
		return
	}

	loading.value = true

	try {
		const response = await fetch(`${API_BASE_URL}/api/auth/register-intent`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: regUsername.value.trim(),
				password: regPassword.value,
				enable2FA: regEnable2FA.value,
			}),
		})

		const data = await response.json()

		if (!response.ok) {
			errorMessage.value = data.error || 'Ошибка при регистрации'
			return
		}

		tgToken.value = data.token
		tgCode.value = data.code
		tgBotUrl.value = data.botUrl

		mode.value = 'waiting_tg'
		startPolling()
	} catch (err: any) {
		errorMessage.value = err?.message || 'Не удалось связаться с сервером авторизации'
	} finally {
		loading.value = false
	}
}

function openTelegramBot() {
	if (tgBotUrl.value) {
		openUrl(tgBotUrl.value)
	}
}

function startPolling() {
	stopPolling()
	pollTimer = setInterval(async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/api/auth/poll/${tgToken.value}`)
			if (!res.ok) return

			const data = await res.json()

			if (data.status === 'confirmed') {
				stopPolling()
				await completeLogin(data.user.username, data.authToken)
			} else if (data.status === 'rejected') {
				stopPolling()
				errorMessage.value = data.error || 'Регистрация отклонена'
				mode.value = 'register'
			} else if (data.status === 'expired') {
				stopPolling()
				errorMessage.value = 'Время ожидания истекло. Начните заново.'
				mode.value = 'register'
			}
		} catch (e) {
			console.warn('Polling error:', e)
		}
	}, 2000)
}

function stopPolling() {
	if (pollTimer) {
		clearInterval(pollTimer)
		pollTimer = null
	}
}

function cancelWaiting() {
	stopPolling()
	mode.value = 'register'
}

// 4. Завершение входа через Bedringh Rust плагин
async function completeLogin(username: string, authToken: string) {
	try {
		const { bedringh_login } = await import('@/helpers/auth')
		const result = await bedringh_login(username, authToken)
		hide()
		addNotification({
			type: 'success',
			title: 'Вход выполнен',
			text: `Добро пожаловать в Bedringh Launcher, ${username}!`,
		})
		emit('success', result)
	} catch (e: any) {
		handleError(e)
	}
}

// 5. Сброс пароля
async function handleSendResetCode() {
	if (!forgotUsername.value) return
	errorMessage.value = ''
	loading.value = true

	try {
		const res = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: forgotUsername.value.trim() }),
		})

		const data = await res.json()
		if (!res.ok) {
			errorMessage.value = data.error || 'Ошибка отправки кода'
			return
		}

		forgotCodeSent.value = true
		successMessage.value = 'Код отправлен ботом в ваш Telegram!'
	} catch (err: any) {
		errorMessage.value = err?.message || 'Ошибка связи с сервером'
	} finally {
		loading.value = false
	}
}

async function handleResetPassword() {
	if (!forgotCode.value || !forgotNewPassword.value) return
	errorMessage.value = ''
	loading.value = true

	try {
		const res = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: forgotUsername.value.trim(),
				code: forgotCode.value.trim(),
				newPassword: forgotNewPassword.value,
			}),
		})

		const data = await res.json()
		if (!res.ok) {
			errorMessage.value = data.error || 'Ошибка сброса пароля'
			return
		}

		successMessage.value = 'Пароль успешно изменён! Войдите с новым паролем.'
		loginUsername.value = forgotUsername.value
		loginPassword.value = forgotNewPassword.value
		switchMode('login')
	} catch (err: any) {
		errorMessage.value = err?.message || 'Ошибка связи с сервером'
	} finally {
		loading.value = false
	}
}

onUnmounted(() => {
	stopPolling()
})

defineExpose({
	show,
	hide,
})
</script>
