<template>
	<NewModal
		ref="modal"
		:header="isFirstPublish ? 'Публикация сборки в облако Bedringh' : `Публикация обновления v${nextVersion}`"
		max-width="620px"
		width="100%"
		no-padding
		@hide="onHide"
	>
		<div class="flex flex-col gap-5 p-6">
			<!-- Загрузка диффа -->
			<div v-if="loadingDiff" class="flex flex-col items-center justify-center py-10 gap-3 text-secondary">
				<SpinnerIcon class="size-8 animate-spin text-brand" />
				<span class="text-sm font-medium">Анализ изменений в сборке...</span>
			</div>

			<template v-else>
				<!-- Заголовок и сводка диффа в стиле GitHub -->
				<div class="flex flex-col gap-3">
					<div class="flex items-center justify-between">
						<div>
							<h3 class="m-0 text-base font-bold text-contrast">
								{{ instance?.name }}
							</h3>
							<p class="m-0 text-xs text-secondary mt-0.5">
								MC {{ instance?.game_version }} • {{ instance?.loader }}
							</p>
						</div>

						<!-- Git-style бейджи изменений -->
						<div class="flex items-center gap-1.5 flex-wrap justify-end">
							<span
								v-if="diff.added.length > 0"
								class="px-2.5 py-1 text-xs font-bold rounded-lg bg-green-500/15 text-green-400 border border-solid border-green-500/30 flex items-center gap-1"
							>
								<PlusIcon class="size-3.5" />
								{{ diff.added.length }}
							</span>
							<span
								v-if="diff.updated.length > 0"
								class="px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-500/15 text-amber-400 border border-solid border-amber-500/30 flex items-center gap-1"
							>
								<UpdatedIcon class="size-3.5" />
								{{ diff.updated.length }}
							</span>
							<span
								v-if="diff.removed.length > 0"
								class="px-2.5 py-1 text-xs font-bold rounded-lg bg-red-500/15 text-red-400 border border-solid border-red-500/30 flex items-center gap-1"
							>
								<XIcon class="size-3.5" />
								{{ diff.removed.length }}
							</span>
							<span
								v-if="diff.unchanged.length > 0 && !isFirstPublish"
								class="px-2.5 py-1 text-xs font-medium rounded-lg bg-surface-3 text-secondary"
							>
								{{ diff.unchanged.length }} без изм.
							</span>
						</div>
					</div>

					<!-- Предупреждение если изменений нет -->
					<div
						v-if="!diff.hasChanges && !isFirstPublish"
						class="p-3 bg-blue-500/15 border border-solid border-blue-500/30 rounded-xl text-xs text-blue-300 flex items-center gap-2.5"
					>
						<CheckIcon class="size-4 shrink-0 text-blue-400" />
						<span>Состав модов не изменился. Публикация не создаст новую версию на сервере.</span>
					</div>

					<!-- Информационный блок о кастомных модах -->
					<div
						v-if="diff.customCount > 0"
						class="p-3 bg-purple-500/15 border border-solid border-purple-500/30 rounded-xl text-xs text-purple-300 flex items-center gap-2.5"
					>
						<CloudIcon class="size-4 shrink-0 text-purple-400" />
						<span>
							Найдено {{ diff.customCount }} локальных модов без Modrinth. Они будут сохранены в облако Bedringh с дедупликацией по SHA-1.
						</span>
					</div>
				</div>

				<!-- Список измененных модов -->
				<div class="flex flex-col gap-2">
					<span class="text-xs font-semibold text-secondary uppercase tracking-wider">
						{{ isFirstPublish ? `Все моды в сборке (${diff.added.length})` : `Изменения модов (${diff.totalChanges})` }}
					</span>

					<div class="max-h-56 overflow-y-auto pr-1 flex flex-col gap-1.5 rounded-xl">
						<!-- Добавленные -->
						<div
							v-for="item in diff.added"
							:key="`add-${item.fileName}`"
							class="flex items-center justify-between p-2.5 rounded-xl bg-green-500/10 border border-solid border-green-500/25 text-xs"
						>
							<div class="flex items-center gap-2 min-w-0">
								<div class="size-5 rounded-md bg-green-500/20 text-green-400 flex items-center justify-center shrink-0 font-bold">
									+
								</div>
								<span class="font-semibold text-contrast truncate">{{ item.name }}</span>
								<span v-if="item.isCustom" class="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 text-[10px] shrink-0 font-medium">
									Локальный
								</span>
							</div>
							<span class="text-secondary font-mono text-[11px] shrink-0 ml-2">
								{{ item.newVersion || item.fileName }}
							</span>
						</div>

						<!-- Обновленные -->
						<div
							v-for="item in diff.updated"
							:key="`upd-${item.fileName}`"
							class="flex items-center justify-between p-2.5 rounded-xl bg-amber-500/10 border border-solid border-amber-500/25 text-xs"
						>
							<div class="flex items-center gap-2 min-w-0">
								<div class="size-5 rounded-md bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 font-bold">
									~
								</div>
								<span class="font-semibold text-contrast truncate">{{ item.name }}</span>
							</div>
							<div class="flex items-center gap-1 font-mono text-[11px] shrink-0 ml-2">
								<span class="text-secondary line-through">{{ item.oldVersion }}</span>
								<span class="text-amber-400 font-bold">➔</span>
								<span class="text-contrast font-bold">{{ item.newVersion }}</span>
							</div>
						</div>

						<!-- Удаленные -->
						<div
							v-for="item in diff.removed"
							:key="`rem-${item.fileName}`"
							class="flex items-center justify-between p-2.5 rounded-xl bg-red-500/10 border border-solid border-red-500/25 text-xs"
						>
							<div class="flex items-center gap-2 min-w-0">
								<div class="size-5 rounded-md bg-red-500/20 text-red-400 flex items-center justify-center shrink-0 font-bold">
									-
								</div>
								<span class="font-medium text-contrast line-through truncate opacity-80">{{ item.name }}</span>
							</div>
							<span class="text-red-400/70 font-mono text-[11px] shrink-0 ml-2">
								{{ item.oldVersion || item.fileName }}
							</span>
						</div>

						<div v-if="diff.totalChanges === 0 && !isFirstPublish" class="text-xs text-secondary py-2 text-center">
							Нет изменений в модах
						</div>
					</div>

					<!-- Аккордеон неизмененных модов -->
					<div v-if="diff.unchanged.length > 0 && !isFirstPublish" class="mt-1">
						<button
							type="button"
							class="text-xs text-secondary hover:text-contrast transition flex items-center gap-1.5 py-1"
							@click="showUnchanged = !showUnchanged"
						>
							<ChevronRightIcon class="size-3.5 transition-transform" :class="{ 'rotate-90': showUnchanged }" />
							<span>Неизмененные моды ({{ diff.unchanged.length }})</span>
						</button>

						<div v-if="showUnchanged" class="max-h-36 overflow-y-auto pr-1 flex flex-col gap-1 mt-1.5">
							<div
								v-for="item in diff.unchanged"
								:key="`unchanged-${item.fileName}`"
								class="flex items-center justify-between p-2 rounded-lg bg-surface-2 text-xs"
							>
								<span class="text-secondary truncate">{{ item.name }}</span>
								<span class="text-secondary text-[11px] font-mono shrink-0 ml-2">{{ item.newVersion || '' }}</span>
							</div>
						</div>
					</div>
				</div>

				<!-- Поле Changelog -->
				<div class="flex flex-col gap-2">
					<div class="flex items-center justify-between">
						<label class="text-xs font-semibold text-secondary uppercase tracking-wider">
							Описание изменений (Changelog)
						</label>
						<button
							type="button"
							class="text-xs text-brand hover:underline flex items-center gap-1 font-medium cursor-pointer"
							@click="generateAutoChangelog"
						>
							<RefreshCwIcon class="size-3" />
							Сгенерировать авто-описание
						</button>
					</div>

					<textarea
						v-model="changelogText"
						rows="3"
						placeholder="Например: Обновил Sodium до версии 0.6, добавил шейдеры Iris и убрал устаревший мод..."
						class="w-full bg-surface-2 border border-solid border-surface-4 rounded-xl p-3 text-xs text-contrast outline-none focus:border-brand transition resize-none"
					></textarea>
				</div>

				<!-- Ошибка при публикации -->
				<div
					v-if="errorMessage"
					class="p-3 bg-red-500/15 border border-solid border-red-500/30 rounded-xl text-red-400 text-xs flex items-center gap-2"
				>
					<XIcon class="size-4 shrink-0" />
					<span>{{ errorMessage }}</span>
				</div>

				<!-- Кнопки действий -->
				<div class="flex gap-2.5 mt-1">
					<ButtonStyled color="quiet" class="flex-1">
						<button type="button" class="w-full py-2.5 font-semibold text-sm" @click="hide">
							Отмена
						</button>
					</ButtonStyled>

					<ButtonStyled color="brand" class="flex-1">
						<button
							type="button"
							class="w-full justify-center py-2.5 font-bold text-sm"
							:disabled="isPublishing"
							@click="handleConfirmPublish"
						>
							<SpinnerIcon v-if="isPublishing" class="size-4 animate-spin mr-2" />
							<UploadIcon v-else class="size-4 mr-2" />
							<span>
								{{ isFirstPublish ? 'Опубликовать сборку' : `Опубликовать v${nextVersion}` }}
							</span>
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
	ChevronRightIcon,
	CloudIcon,
	PlusIcon,
	RefreshCwIcon,
	SpinnerIcon,
	UpdatedIcon,
	UploadIcon,
	XIcon,
} from '@modrinth/assets'
import { ButtonStyled, injectNotificationManager, NewModal } from '@modrinth/ui'
import { computed, ref } from 'vue'

import type { GameInstance } from '@/helpers/instance'
import {
	computeInstanceDiff,
	getLocalInstancePackMeta,
	publishInstanceAsCloudPack,
	type PackDiffResult,
} from '@/services/bedringh-cloud-packs'

const emit = defineEmits<{
	(e: 'published', payload: { packId: string; version: number; shareCode: string; noChanges?: boolean }): void
}>()

const modal = ref<InstanceType<typeof NewModal> | null>(null)
const { addNotification } = injectNotificationManager()

const instance = ref<GameInstance | null>(null)
const loadingDiff = ref(false)
const isPublishing = ref(false)
const errorMessage = ref('')
const changelogText = ref('')
const showUnchanged = ref(false)

const diff = ref<PackDiffResult>({
	added: [],
	removed: [],
	updated: [],
	unchanged: [],
	totalChanges: 0,
	hasChanges: false,
	customCount: 0,
	allCurrentProjects: [],
})

const existingMeta = computed(() => (instance.value?.path ? getLocalInstancePackMeta(instance.value.path) : null))
const isFirstPublish = computed(() => !existingMeta.value || existingMeta.value.role !== 'author')
const nextVersion = computed(() => (existingMeta.value?.version ? existingMeta.value.version + 1 : 1))

function generateAutoChangelog() {
	if (isFirstPublish.value) {
		changelogText.value = `Начальный релиз сборки. Установлено ${diff.value.added.length} модов.`
		return
	}

	const parts: string[] = []
	if (diff.value.added.length > 0) {
		const names = diff.value.added.slice(0, 3).map((m) => m.name).join(', ')
		const suffix = diff.value.added.length > 3 ? ` и ещё ${diff.value.added.length - 3}` : ''
		parts.push(`+ Добавлено: ${names}${suffix}`)
	}
	if (diff.value.updated.length > 0) {
		const names = diff.value.updated.slice(0, 3).map((m) => `${m.name} (${m.newVersion})`).join(', ')
		const suffix = diff.value.updated.length > 3 ? ` и ещё ${diff.value.updated.length - 3}` : ''
		parts.push(`~ Обновлено: ${names}${suffix}`)
	}
	if (diff.value.removed.length > 0) {
		const names = diff.value.removed.slice(0, 3).map((m) => m.name).join(', ')
		const suffix = diff.value.removed.length > 3 ? ` и ещё ${diff.value.removed.length - 3}` : ''
		parts.push(`- Удалено: ${names}${suffix}`)
	}

	if (parts.length > 0) {
		changelogText.value = parts.join('\n')
	} else {
		changelogText.value = 'Небольшие оптимизации и изменения настроек.'
	}
}

async function show(targetInstance: GameInstance) {
	instance.value = targetInstance
	errorMessage.value = ''
	changelogText.value = ''
	showUnchanged.value = false
	modal.value?.show()

	loadingDiff.value = true
	try {
		const packId = existingMeta.value?.role === 'author' ? existingMeta.value.packId : undefined
		diff.value = await computeInstanceDiff(targetInstance, packId)
		generateAutoChangelog()
	} catch (e: any) {
		errorMessage.value = e?.message || 'Не удалось подготовить список изменений'
	} finally {
		loadingDiff.value = false
	}
}

function hide() {
	modal.value?.hide()
}

function onHide() {
	errorMessage.value = ''
}

async function handleConfirmPublish() {
	if (!instance.value) return

	try {
		isPublishing.value = true
		errorMessage.value = ''

		const result = await publishInstanceAsCloudPack(
			instance.value,
			undefined,
			changelogText.value.trim() || undefined,
		)

		emit('published', {
			packId: result.packId,
			version: result.version,
			shareCode: result.shareCode,
			noChanges: result.noChanges,
		})

		hide()
	} catch (err: any) {
		errorMessage.value = err?.message || 'Не удалось опубликовать сборку'
	} finally {
		isPublishing.value = false
	}
}

defineExpose({
	show,
	hide,
})
</script>
