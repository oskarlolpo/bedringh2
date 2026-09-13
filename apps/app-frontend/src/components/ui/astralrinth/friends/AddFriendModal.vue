<script setup lang="ts">
import { CheckIcon, PlusIcon, SearchIcon, UserPlusIcon } from '@modrinth/assets'
import { ButtonStyled, NewModal, StyledInput, injectNotificationManager } from '@modrinth/ui'
import { ref, watch } from 'vue'
import { sendFriendRequest } from '@/services/bedringh-friends'

const modal = ref<InstanceType<typeof NewModal> | null>(null)
const { addNotification } = injectNotificationManager()

const targetUsername = ref('')
const loading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const headUrl = ref<string | null>(null)

let searchTimeout: any = null

watch(targetUsername, (val) => {
	errorMessage.value = ''
	successMessage.value = ''

	if (searchTimeout) clearTimeout(searchTimeout)

	const trimmed = val.trim()
	if (trimmed.length >= 3) {
		searchTimeout = setTimeout(() => {
			headUrl.value = `https://mc-heads.net/avatar/${encodeURIComponent(trimmed)}/64`
		}, 300)
	} else {
		headUrl.value = null
	}
})

async function handleSendRequest() {
	const trimmed = targetUsername.value.trim()
	if (!trimmed) return

	loading.value = true
	errorMessage.value = ''
	successMessage.value = ''

	try {
		const res = await sendFriendRequest(trimmed)
		successMessage.value = res.message || 'Заявка успешно отправлена!'
		addNotification({
			type: 'success',
			title: 'Заявка в друзья',
			text: `Заявка пользователю ${trimmed} успешно отправлена`,
		})
		setTimeout(() => {
			if (successMessage.value) {
				modal.value?.hide()
				targetUsername.value = ''
				headUrl.value = null
			}
		}, 1200)
	} catch (e: any) {
		errorMessage.value = e?.message || 'Не удалось отправить заявку'
	} finally {
		loading.value = false
	}
}

function show() {
	targetUsername.value = ''
	errorMessage.value = ''
	successMessage.value = ''
	headUrl.value = null
	modal.value?.show()
}

function hide() {
	modal.value?.hide()
}

defineExpose({ show, hide })
</script>

<template>
	<NewModal ref="modal" header="Добавить друга">
		<div class="flex flex-col gap-4 px-6 py-5 w-[420px] max-w-full">
			<!-- Информационный баннер -->
			<div class="flex items-center gap-3 p-3 bg-brand/10 border border-solid border-brand/20 rounded-xl text-xs text-secondary">
				<UserPlusIcon class="w-5 h-5 text-brand shrink-0" />
				<span>
					Введите никнейм игрока в <b>Bedringh ID</b> для отправки заявки в друзья.
				</span>
			</div>

			<!-- Поле ввода -->
			<div class="flex flex-col gap-1.5">
				<label class="text-xs font-semibold text-secondary">Никнейм пользователя</label>
				<div class="relative flex items-center">
					<StyledInput
						v-model="targetUsername"
						type="text"
						placeholder="Например: Player123..."
						class="w-full"
						:disabled="loading"
						@keyup.enter="targetUsername.trim().length >= 3 && handleSendRequest()"
					/>
				</div>
			</div>

			<!-- Превью найденного игрока -->
			<div
				v-if="targetUsername.trim().length >= 3"
				class="flex items-center justify-between p-3 bg-surface-2 border border-solid border-surface-5 rounded-xl transition-all"
			>
				<div class="flex items-center gap-3 min-w-0">
					<img
						v-if="headUrl"
						:src="headUrl"
						alt=""
						class="w-10 h-10 rounded-lg object-cover image-pixelated bg-surface-3"
					/>
					<div
						v-else
						class="w-10 h-10 rounded-lg bg-surface-3 flex items-center justify-center text-secondary font-bold"
					>
						?
					</div>
					<div class="flex flex-col min-w-0">
						<span class="font-bold text-contrast truncate text-sm">
							{{ targetUsername.trim() }}
						</span>
						<span class="text-xs text-emerald-400">Bedringh ID аккаунт</span>
					</div>
				</div>

				<ButtonStyled color="brand">
					<button
						type="button"
						class="px-3 py-1.5 text-xs font-semibold"
						:disabled="loading || !targetUsername.trim()"
						@click="handleSendRequest"
					>
						<UserPlusIcon class="w-4 h-4 mr-1 inline" />
						Отправить
					</button>
				</ButtonStyled>
			</div>

			<!-- Сообщения об успехе или ошибке -->
			<div v-if="errorMessage" class="text-xs text-red-400 font-medium px-1">
				{{ errorMessage }}
			</div>
			<div v-if="successMessage" class="text-xs text-emerald-400 font-medium flex items-center gap-1.5 px-1">
				<CheckIcon class="w-4 h-4 text-emerald-400" />
				{{ successMessage }}
			</div>
		</div>
	</NewModal>
</template>
