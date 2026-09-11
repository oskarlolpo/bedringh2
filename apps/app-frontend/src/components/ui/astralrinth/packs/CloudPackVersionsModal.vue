<template>
	<NewModal
		ref="modal"
		header="История версий сборки"
		max-width="600px"
		width="100%"
		no-padding
		@hide="onHide"
	>
		<div class="flex flex-col gap-5 p-6">
			<!-- Загрузка версий -->
			<div v-if="loading" class="flex flex-col items-center justify-center py-12 gap-3 text-secondary">
				<SpinnerIcon class="size-8 animate-spin text-brand" />
				<span class="text-sm font-medium">Загрузка истории версий...</span>
			</div>

			<!-- Процесс отката (Rollback in progress) -->
			<div v-else-if="isRollingBack" class="flex flex-col items-center justify-center py-10 gap-3 text-center">
				<SpinnerIcon class="size-10 animate-spin text-brand" />
				<div class="flex flex-col gap-1">
					<h3 class="m-0 text-base font-bold text-contrast">Откат сборки к v{{ rollbackTargetVersion }}...</h3>
					<p class="m-0 text-xs text-secondary">{{ rollbackProgressText }}</p>
				</div>
			</div>

			<template v-else>
				<!-- Шапка со сборкой -->
				<div class="flex items-center justify-between p-3.5 rounded-xl bg-surface-2 border border-solid border-surface-4">
					<div class="flex items-center gap-3 min-w-0">
						<div class="size-10 rounded-xl bg-brand/15 text-brand flex items-center justify-center shrink-0">
							<HistoryIcon class="size-5" />
						</div>
						<div class="min-w-0">
							<h3 class="m-0 text-sm font-bold text-contrast truncate">
								{{ versionsData?.packName || instance?.name }}
							</h3>
							<p class="m-0 text-xs text-secondary mt-0.5">
								Автор: <span class="text-contrast font-medium">{{ versionsData?.author || 'Bedringh' }}</span> • Код: <span class="text-brand font-mono font-semibold">{{ packId }}</span>
							</p>
						</div>
					</div>

					<span class="px-2.5 py-1 text-xs font-bold rounded-lg bg-brand/20 text-brand border border-solid border-brand/30 shrink-0">
						v{{ versionsData?.currentVersion || 1 }}
					</span>
				</div>

				<!-- Список версий (Timeline) -->
				<div class="flex flex-col gap-2.5 max-h-[380px] overflow-y-auto pr-1">
					<div
						v-for="ver in versionsData?.versions || []"
						:key="ver.version"
						class="flex flex-col gap-2.5 p-4 rounded-xl border border-solid transition"
						:class="ver.isCurrent ? 'bg-brand/10 border-brand/40' : 'bg-surface-2 border-surface-4 hover:border-surface-5'"
					>
						<div class="flex items-center justify-between gap-3">
							<div class="flex items-center gap-2">
								<span
									class="px-2.5 py-0.5 text-xs font-bold rounded-md"
									:class="ver.isCurrent ? 'bg-brand text-bg-base' : 'bg-surface-3 text-contrast'"
								>
									v{{ ver.version }}
								</span>
								<span v-if="ver.isCurrent" class="text-[11px] font-bold text-brand uppercase tracking-wider">
									Текущая
								</span>
								<span class="text-xs text-secondary">
									• {{ formatDate(ver.createdAt) }}
								</span>
							</div>

							<div class="flex items-center gap-2">
								<span class="text-xs text-secondary font-medium">
									{{ ver.modsCount }} модов
								</span>

								<!-- Кнопка отката -->
								<ButtonStyled v-if="!ver.isCurrent" color="quiet" size="sm">
									<button
										type="button"
										class="px-2.5 py-1 text-xs font-semibold flex items-center gap-1.5"
										:disabled="isRollingBack"
										@click="promptRollback(ver.version)"
									>
										<RotateCounterClockwiseIcon class="size-3.5 text-secondary" />
										<span>Откатить</span>
									</button>
								</ButtonStyled>
							</div>
						</div>

						<!-- Чейнджлог -->
						<div
							v-if="ver.changelog"
							class="text-xs text-secondary whitespace-pre-line bg-surface-1/60 p-2.5 rounded-lg border border-solid border-surface-3 font-sans leading-relaxed"
						>
							{{ ver.changelog }}
						</div>
						<div v-else class="text-xs text-secondary/60 italic">
							Описание изменений отсутствует
						</div>
					</div>

					<div v-if="(versionsData?.versions?.length || 0) === 0" class="text-xs text-secondary py-6 text-center">
						История версий пока пуста
					</div>
				</div>

				<!-- Диалог подтверждения отката -->
				<div
					v-if="confirmRollbackVersion !== null"
					class="p-4 bg-amber-500/15 border border-solid border-amber-500/35 rounded-xl flex flex-col gap-3"
				>
					<div class="flex items-start gap-2.5">
						<RotateCounterClockwiseIcon class="size-5 text-amber-400 shrink-0 mt-0.5" />
						<div class="flex flex-col gap-0.5 text-xs text-amber-200">
							<span class="font-bold text-contrast">Откатить сборку до версии v{{ confirmRollbackVersion }}?</span>
							<span>Все локальные моды инстанса будут синхронизированы в точное соответствие с версией v{{ confirmRollbackVersion }}. Лишние моды будут удалены, а недостающие установлены.</span>
						</div>
					</div>

					<div class="flex items-center justify-end gap-2">
						<ButtonStyled color="quiet" size="sm">
							<button type="button" class="px-3 py-1.5 text-xs font-semibold" @click="confirmRollbackVersion = null">
								Отмена
							</button>
						</ButtonStyled>

						<ButtonStyled color="brand" size="sm">
							<button
								type="button"
								class="px-3 py-1.5 text-xs font-bold flex items-center gap-1.5"
								@click="executeRollback(confirmRollbackVersion)"
							>
								<CheckIcon class="size-3.5" />
								<span>Да, откатить к v{{ confirmRollbackVersion }}</span>
							</button>
						</ButtonStyled>
					</div>
				</div>

				<!-- Ошибка если возникла -->
				<div
					v-if="errorMessage"
					class="p-3 bg-red-500/15 border border-solid border-red-500/30 rounded-xl text-red-400 text-xs flex items-center gap-2"
				>
					<XIcon class="size-4 shrink-0" />
					<span>{{ errorMessage }}</span>
				</div>

				<!-- Кнопка закрытия -->
				<div class="flex justify-end mt-1">
					<ButtonStyled color="quiet">
						<button type="button" class="px-5 py-2 font-semibold text-xs" @click="hide">
							Закрыть
						</button>
					</ButtonStyled>
				</div>
			</template>
		</div>
	</NewModal>
</template>

<script setup lang="ts">
import {
	CheckIcon,
	HistoryIcon,
	RotateCounterClockwiseIcon,
	SpinnerIcon,
	XIcon,
} from '@modrinth/assets'
import { ButtonStyled, injectNotificationManager, NewModal } from '@modrinth/ui'
import { ref } from 'vue'

import type { GameInstance } from '@/helpers/instance'
import {
	fetchPackVersions,
	rollbackInstanceToVersion,
	type CloudPackVersionsResponse,
} from '@/services/bedringh-cloud-packs'

const emit = defineEmits<{
	(e: 'rolledBack', targetVersion: number): void
}>()

const modal = ref<InstanceType<typeof NewModal> | null>(null)
const { addNotification } = injectNotificationManager()

const instance = ref<GameInstance | null>(null)
const packId = ref('')
const loading = ref(false)
const errorMessage = ref('')
const versionsData = ref<CloudPackVersionsResponse | null>(null)

const confirmRollbackVersion = ref<number | null>(null)
const isRollingBack = ref(false)
const rollbackTargetVersion = ref<number | null>(null)
const rollbackProgressText = ref('')

function formatDate(isoString?: string): string {
	if (!isoString) return ''
	try {
		const d = new Date(isoString)
		return d.toLocaleString('ru-RU', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		})
	} catch {
		return isoString
	}
}

async function show(targetInstance: GameInstance, targetPackId: string) {
	instance.value = targetInstance
	packId.value = targetPackId
	errorMessage.value = ''
	confirmRollbackVersion.value = null
	modal.value?.show()

	loading.value = true
	try {
		versionsData.value = await fetchPackVersions(targetPackId)
	} catch (e: any) {
		errorMessage.value = e?.message || 'Не удалось загрузить историю версий'
	} finally {
		loading.value = false
	}
}

function hide() {
	modal.value?.hide()
}

function onHide() {
	errorMessage.value = ''
	confirmRollbackVersion.value = null
}

function promptRollback(version: number) {
	confirmRollbackVersion.value = version
}

async function executeRollback(targetVersion: number) {
	if (!instance.value) return
	confirmRollbackVersion.value = null
	isRollingBack.value = true
	rollbackTargetVersion.value = targetVersion
	rollbackProgressText.value = 'Подготовка к откату...'

	try {
		await rollbackInstanceToVersion(instance.value, targetVersion, (text) => {
			rollbackProgressText.value = text
		})

		addNotification({
			type: 'success',
			title: 'Сборка откачена',
			text: `Сборка успешно возвращена к версии v${targetVersion}!`,
		})

		emit('rolledBack', targetVersion)
		hide()
	} catch (err: any) {
		errorMessage.value = err?.message || 'Ошибка отката сборки'
		addNotification({
			type: 'error',
			title: 'Ошибка отката',
			text: err?.message || 'Не удалось откатить сборку к выбранной версии',
		})
	} finally {
		isRollingBack.value = false
		rollbackTargetVersion.value = null
	}
}

defineExpose({
	show,
	hide,
})
</script>
