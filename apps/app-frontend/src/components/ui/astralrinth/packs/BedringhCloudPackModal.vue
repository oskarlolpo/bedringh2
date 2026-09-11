<template>
	<NewModal
		ref="modal"
		header="Установка сборки Bedringh Cloud"
		max-width="540px"
		width="100%"
		no-padding
		@hide="onHide"
	>
		<div class="flex flex-col gap-5 p-6">
			<!-- Ввод кода / ссылки, если сборка еще не выбрана -->
			<div v-if="!selectedPack" class="flex flex-col gap-4">
				<div class="flex items-center gap-3 p-3 bg-brand/10 text-brand rounded-xl">
					<CloudIcon class="w-6 h-6 shrink-0" />
					<div class="text-sm">
						Введите код сборки вида <b>BP-XXXXXX</b> или вставьте полученную от друга ссылку.
					</div>
				</div>

				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-semibold text-secondary uppercase tracking-wider">Код или ссылка на сборку</label>
					<div class="flex gap-2">
						<StyledInput
							v-model="packInput"
							type="text"
							placeholder="Например: BP-A1B2C3 или ссылка"
							class="flex-1"
							:disabled="loading"
							@keydown.enter="handleFetchPack"
						/>
						<ButtonStyled color="brand">
							<button type="button" class="px-4 py-2 font-semibold" :disabled="loading || !packInput.trim()" @click="handleFetchPack">
								<SpinnerIcon v-if="loading" class="animate-spin w-5 h-5" />
								<span v-else>Найти</span>
							</button>
						</ButtonStyled>
					</div>
				</div>

				<div v-if="errorMessage" class="p-3 bg-red-500/15 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-start gap-2">
					<TriangleAlertIcon class="w-5 h-5 shrink-0 mt-0.5" />
					<span>{{ errorMessage }}</span>
				</div>
			</div>

			<!-- Превью найденной сборки -->
			<div v-else-if="selectedPack && !installing" class="flex flex-col gap-4">
				<div class="flex items-start gap-4 p-4 rounded-xl bg-surface-2 border border-surface-3">
					<div class="w-14 h-14 rounded-xl bg-brand/20 text-brand flex items-center justify-center shrink-0">
						<FolderOpenIcon class="w-7 h-7" />
					</div>
					<div class="flex flex-col gap-1 min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<h3 class="m-0 text-lg font-bold text-contrast truncate">{{ selectedPack.name }}</h3>
							<span class="px-2 py-0.5 text-xs font-bold rounded-full bg-brand/20 text-brand shrink-0">
								v{{ selectedPack.version }}
							</span>
						</div>
						<div class="text-xs text-secondary flex items-center gap-1.5">
							<span>Автор: <b class="text-contrast">{{ selectedPack.author }}</b></span>
							<span>•</span>
							<span>Код: <b class="text-brand">{{ selectedPack.id }}</b></span>
						</div>
						<div class="flex items-center gap-2 mt-1">
							<span class="px-2 py-0.5 text-xs rounded bg-surface-3 text-secondary font-medium">
								MC {{ selectedPack.gameVersion }}
							</span>
							<span class="px-2 py-0.5 text-xs rounded bg-surface-3 text-secondary font-medium capitalize">
								{{ selectedPack.loader }} {{ selectedPack.loaderVersion || '' }}
							</span>
							<span class="px-2 py-0.5 text-xs rounded bg-surface-3 text-secondary font-medium">
								Модов: {{ selectedPack.manifest?.projects?.length || 0 }}
							</span>
						</div>
					</div>
				</div>

				<div v-if="selectedPack.description" class="text-sm text-secondary bg-surface-3/50 p-3 rounded-xl border border-surface-3">
					{{ selectedPack.description }}
				</div>

				<!-- Список модов (свернутый) -->
				<div class="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
					<label class="text-xs font-semibold text-secondary uppercase tracking-wider">
						Включенные моды ({{ selectedPack.manifest?.projects?.length || 0 }}):
					</label>
					<div
						v-for="(mod, idx) in selectedPack.manifest?.projects || []"
						:key="idx"
						class="flex items-center justify-between p-2 rounded-lg bg-surface-2 text-xs"
					>
						<span class="font-medium text-contrast truncate">{{ mod.title }}</span>
						<span class="text-secondary text-[11px] shrink-0 ml-2">{{ mod.versionNumber || mod.fileName }}</span>
					</div>
				</div>

				<div v-if="errorMessage" class="p-3 bg-red-500/15 border border-red-500/30 rounded-xl text-red-400 text-sm">
					{{ errorMessage }}
				</div>

				<div class="flex gap-2 mt-2">
					<ButtonStyled color="quiet" class="flex-1">
						<button type="button" class="w-full py-2.5 font-semibold" @click="selectedPack = null">
							Назад
						</button>
					</ButtonStyled>
					<ButtonStyled color="brand" class="flex-1">
						<button type="button" class="w-full justify-center py-2.5 font-semibold" @click="handleInstall">
							<DownloadIcon class="w-5 h-5 mr-2" />
							Установить и следить
						</button>
					</ButtonStyled>
				</div>
			</div>

			<!-- Процесс установки -->
			<div v-else-if="installing" class="flex flex-col gap-4 items-center text-center py-4">
				<SpinnerIcon class="w-10 h-10 animate-spin text-brand" />
				<div class="flex flex-col gap-1">
					<h3 class="m-0 text-base font-bold text-contrast">Установка сборки...</h3>
					<p class="m-0 text-sm text-secondary">{{ progressText }}</p>
				</div>
				<div class="w-full bg-surface-3 h-2 rounded-full overflow-hidden mt-2">
					<div
						class="bg-brand h-full transition-all duration-300"
						:style="{ width: `${progressPercent}%` }"
					/>
				</div>
				<span class="text-xs text-secondary">{{ progressCurrent }} из {{ progressTotal }}</span>
			</div>
		</div>
	</NewModal>
</template>

<script setup lang="ts">
import {
	CloudIcon,
	DownloadIcon,
	FolderOpenIcon,
	SpinnerIcon,
	TriangleAlertIcon,
} from '@modrinth/assets'
import { ButtonStyled, injectNotificationManager, NewModal, StyledInput } from '@modrinth/ui'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
	fetchCloudPack,
	installCloudPackForSubscriber,
	type CloudPackManifest,
} from '@/services/bedringh-cloud-packs'

const modal = ref<InstanceType<typeof NewModal> | null>(null)
const router = useRouter()
const { addNotification, handleError } = injectNotificationManager()

const packInput = ref('')
const loading = ref(false)
const installing = ref(false)
const errorMessage = ref('')
const selectedPack = ref<CloudPackManifest | null>(null)

const progressText = ref('Подготовка...')
const progressCurrent = ref(0)
const progressTotal = ref(0)

const progressPercent = computed(() => {
	if (!progressTotal.value) return 0
	return Math.min(100, Math.round((progressCurrent.value / progressTotal.value) * 100))
})

function extractPackId(input: string): string {
	const trimmed = input.trim()
	// Если передали URL: .../pack/BP-XXXXXX
	const urlMatch = trimmed.match(/\/pack\/([A-Za-z0-9-_]+)/i)
	if (urlMatch) return urlMatch[1].toUpperCase()

	// Если передали deep-link: bedringh://pack/BP-XXXXXX
	const deepMatch = trimmed.match(/pack\/([A-Za-z0-9-_]+)/i)
	if (deepMatch) return deepMatch[1].toUpperCase()

	return trimmed.toUpperCase()
}

async function handleFetchPack() {
	if (!packInput.value.trim()) return
	errorMessage.value = ''
	loading.value = true

	try {
		const packId = extractPackId(packInput.value)
		const pack = await fetchCloudPack(packId)
		selectedPack.value = pack
	} catch (e: any) {
		errorMessage.value = e?.message || 'Сборка не найдена. Проверьте правильность кода.'
	} finally {
		loading.value = false
	}
}

async function handleInstall() {
	if (!selectedPack.value) return
	errorMessage.value = ''
	installing.value = true
	progressCurrent.value = 0
	progressTotal.value = selectedPack.value.manifest?.projects?.length || 1

	try {
		const instanceId = await installCloudPackForSubscriber(
			selectedPack.value,
			(text, cur, tot) => {
				progressText.value = text
				progressCurrent.value = cur
				progressTotal.value = tot
			},
		)

		addNotification({
			type: 'success',
			title: 'Сборка установлена',
			text: `Сборка "${selectedPack.value.name}" успешно установлена и привязана к обновлениям автора!`,
		})

		hide()
		void router.push(`/instance/${encodeURIComponent(instanceId)}`)
	} catch (e: any) {
		errorMessage.value = e?.message || 'Ошибка установки сборки'
		installing.value = false
	}
}

function show(initialCode?: string) {
	errorMessage.value = ''
	selectedPack.value = null
	installing.value = false
	if (initialCode) {
		packInput.value = initialCode
		void handleFetchPack()
	} else {
		packInput.value = ''
	}
	modal.value?.show()
}

function hide() {
	modal.value?.hide()
}

function onHide() {
	errorMessage.value = ''
	installing.value = false
}

defineExpose({
	show,
	hide,
})
</script>
