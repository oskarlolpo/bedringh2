<template>
	<ReadyTransition :pending="loading">
		<div v-if="worlds.length === 0" class="flex flex-col items-center justify-center py-12">
			<EmptyState
				type="empty-inbox"
				heading="Нет сохраненных миров"
			/>
		</div>

		<div v-else class="flex flex-col gap-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<StyledInput
					v-model="searchQuery"
					:icon="SearchIcon"
					type="text"
					placeholder="Поиск миров..."
					clearable
					wrapper-class="flex-1 min-w-[200px]"
				/>
				<div class="flex items-center gap-2">
					<ButtonStyled type="outlined">
						<button @click="openBackups">
							<ArchiveIcon class="size-4" />
							Бэкапы
						</button>
					</ButtonStyled>
					<ButtonStyled type="outlined">
						<button @click="importFromFile">
							<DownloadIcon class="size-4" />
							Импорт (.mcworld)
						</button>
					</ButtonStyled>
					<ButtonStyled color="brand">
						<button @click="openCurseForgeWorlds">
							<CompassIcon class="size-4" />
							Каталог миров
						</button>
					</ButtonStyled>
				</div>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
				<div 
					v-for="world in filteredWorlds" 
					:key="world.folderName" 
					class="bg-surface-3 rounded-2xl overflow-hidden border border-surface-4 flex flex-col shadow-sm transition-all duration-150 hover:border-brand hover:shadow-md hover:-translate-y-0.5"
				>
					<div class="h-36 bg-surface-2 w-full relative overflow-hidden">
						<img v-if="world.iconPath" :src="convertFileSrc(world.iconPath)" class="w-full h-full object-cover">
						<div v-else class="w-full h-full flex flex-col items-center justify-center text-secondary gap-1 bg-surface-2/60">
							<GlobeIcon class="size-8 opacity-40" />
							<span class="text-xs">Без обложки</span>
						</div>
						<div class="absolute bottom-2 right-2 bg-black/70 text-white px-2 py-0.5 rounded-md text-xs font-mono backdrop-blur-md">
							{{ formatSize(world.sizeBytes) }}
						</div>
					</div>
					
					<div class="p-4 flex flex-col gap-1.5 flex-1">
						<div class="flex items-center gap-1.5">
							<div class="font-bold text-base text-primary truncate" :title="world.name">
								{{ world.name }}
							</div>
							<span
								v-if="world.isValid === false"
								class="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/15 text-red-400"
								title="В этой папке нет рабочих данных сохранения (db/) - Minecraft не сможет загрузить этот мир, даже если он отображается здесь"
							>
								Повреждён
							</span>
						</div>
						<div class="text-xs text-secondary flex items-center gap-1">
							<span>Последняя игра: {{ formatDate(world.lastPlayed) }}</span>
						</div>
						<div class="text-[11px] font-mono text-tertiary truncate">
							{{ world.folderName }}
						</div>
						
						<div class="mt-auto pt-3 flex gap-2 justify-end items-center border-t border-surface-4/60">
							<ButtonStyled size="small" type="outlined">
								<button @click="backupNow(world)" :disabled="backingUp === world.folderName" title="Создать снапшот мира">
									<ArchiveIcon v-if="backingUp !== world.folderName" class="size-4" />
									<SpinnerIcon v-else class="size-4 animate-spin" />
								</button>
							</ButtonStyled>
							<ButtonStyled size="small" type="outlined">
								<button @click="exportWorld(world)">
									Экспорт
								</button>
							</ButtonStyled>
							<ButtonStyled size="small" color="red" type="transparent">
								<button @click="deleteWorld(world)" title="Удалить мир">
									<TrashIcon class="size-4" />
								</button>
							</ButtonStyled>
						</div>
					</div>
				</div>
			</div>
		</div>

		<NewModal ref="backupsModal" header="Бэкапы миров" max-width="560px">
			<div class="flex flex-col gap-3 min-w-[320px]">
				<p class="m-0 text-sm text-secondary">
					Автоматические снапшоты создаются при запуске и выходе из игры. Хранятся последние 10 на мир.
				</p>
				<div v-if="backupsLoading" class="flex items-center justify-center py-8">
					<SpinnerIcon class="size-6 animate-spin text-secondary" />
				</div>
				<div v-else-if="backups.length === 0" class="py-8 text-center text-sm text-secondary">
					Снапшотов пока нет — они появятся после первого запуска игры.
				</div>
				<div v-else class="flex flex-col gap-2 max-h-[50vh] overflow-y-auto custom-scrollbar pr-1">
					<div
						v-for="backup in backups"
						:key="backup.folderName + '/' + backup.backupName"
						class="flex items-center justify-between gap-3 bg-surface-3 border border-surface-4 rounded-xl p-3"
					>
						<div class="flex flex-col overflow-hidden">
							<span class="font-medium text-sm text-primary truncate">
								{{ worldNameFor(backup.folderName) }}
							</span>
							<span class="text-xs text-secondary">
								{{ formatDate(backup.created) }} · {{ formatSize(backup.sizeBytes) }}
							</span>
						</div>
						<div class="flex items-center gap-2 shrink-0">
							<ButtonStyled size="small" type="outlined">
								<button
									:disabled="restoringBackup === backup.backupName"
									@click="restoreBackup(backup)"
								>
									<SpinnerIcon v-if="restoringBackup === backup.backupName" class="size-4 animate-spin" />
									<template v-else>Восстановить</template>
								</button>
							</ButtonStyled>
							<ButtonStyled size="small" color="red" type="transparent">
								<button :title="'Удалить снапшот'" @click="deleteBackup(backup)">
									<TrashIcon class="size-4" />
								</button>
							</ButtonStyled>
						</div>
					</div>
				</div>
			</div>
		</NewModal>
	</ReadyTransition>
</template>

<script setup lang="ts">
import { ArchiveIcon, CompassIcon, DownloadIcon, GlobeIcon, SearchIcon, SpinnerIcon, TrashIcon } from '@modrinth/assets'
import { ButtonStyled, EmptyState, NewModal, ReadyTransition, StyledInput, injectNotificationManager } from '@modrinth/ui'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'

import type { GameInstance } from '@/helpers/types'

const router = useRouter()

const props = defineProps<{
	instance: GameInstance
}>()

function openCurseForgeWorlds() {
	router.push({
		path: '/browse/bedrock/world',
		query: { i: props.instance.path },
	})
}

interface BedrockWorld {
	folderName: string
	name: string
	sizeBytes: number
	lastPlayed: number
	iconPath: string | null
	isValid?: boolean
}

interface BedrockWorldBackup {
	folderName: string
	backupName: string
	created: number
	sizeBytes: number
}

const loading = ref(true)
const searchQuery = ref('')
const worlds = ref<BedrockWorld[]>([])
const notifications = injectNotificationManager()

const backupsModal = ref<InstanceType<typeof NewModal> | null>(null)
const backups = ref<BedrockWorldBackup[]>([])
const backupsLoading = ref(false)
const backingUp = ref<string | null>(null)
const restoringBackup = ref<string | null>(null)

const filteredWorlds = computed(() => {
	if (!searchQuery.value.trim()) return worlds.value
	const q = searchQuery.value.toLowerCase()
	return worlds.value.filter((w) => w.name.toLowerCase().includes(q) || w.folderName.toLowerCase().includes(q))
})

function formatSize(bytes: number) {
	if (bytes < 1024) return bytes + ' B'
	else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
	else return (bytes / 1048576).toFixed(1) + ' MB'
}

function formatDate(timestamp: number) {
	if (timestamp === 0) return 'Никогда'
	return new Date(timestamp * 1000).toLocaleString()
}

async function fetchWorlds() {
	loading.value = true
	try {
		worlds.value = await invoke('plugin:bedrock-worlds|fetch_bedrock_worlds', {
			profilePath: props.instance.path,
		})
	} catch (e) {
		notifications.handleError(e as Error)
	} finally {
		loading.value = false
	}
}

async function deleteWorld(world: BedrockWorld) {
	if (!confirm(`Вы действительно хотите удалить мир ${world.name}?`)) return

	try {
		await invoke('plugin:bedrock-worlds|delete_bedrock_world', {
			profilePath: props.instance.path,
			folderName: world.folderName,
		})
		await fetchWorlds()
	} catch (e) {
		notifications.handleError(e as Error)
	}
}

async function exportWorld(world: BedrockWorld) {
	const outPath = await save({
		filters: [
			{
				name: 'Bedrock World',
				extensions: ['mcworld'],
			},
		],
		defaultPath: `${world.name}.mcworld`,
	})

	if (outPath) {
		loading.value = true
		try {
			await invoke('plugin:bedrock-worlds|export_bedrock_world', {
				profilePath: props.instance.path,
				folderName: world.folderName,
				outPath: outPath,
			})
			notifications.addNotification({
				type: 'success',
				title: 'Успешный экспорт',
				text: `Мир ${world.name} был экспортирован в ${outPath}`,
			})
		} catch (e) {
			notifications.handleError(e as Error)
		} finally {
			loading.value = false
		}
	}
}

async function importFromFile() {
	const file = await open({
		multiple: false,
		filters: [
			{
				name: 'Bedrock Worlds',
				extensions: ['mcworld', 'zip'],
			},
		],
	})

	if (file) {
		let pathStr = ''
		if (typeof file === 'string') {
			pathStr = file
		} else if ('path' in file) {
			pathStr = file.path
		}

		if (pathStr) {
			loading.value = true
			try {
				await invoke('plugin:bedrock-worlds|import_bedrock_world', {
					profilePath: props.instance.path,
					archivePath: pathStr,
				})
				notifications.addNotification({
					type: 'success',
					title: 'Мир успешно импортирован',
					text: 'Мир Bedrock добавлен в ваш профиль.',
				})
				await fetchWorlds()
			} catch (e) {
				notifications.handleError(e as Error)
			} finally {
				loading.value = false
			}
		}
	}
}

function worldNameFor(folderName: string) {
	return worlds.value.find((w) => w.folderName === folderName)?.name ?? folderName
}

async function fetchBackups() {
	backupsLoading.value = true
	try {
		backups.value = await invoke('plugin:bedrock-worlds|list_bedrock_world_backups', {
			profilePath: props.instance.path,
		})
	} catch (e) {
		notifications.handleError(e as Error)
	} finally {
		backupsLoading.value = false
	}
}

async function openBackups() {
	backupsModal.value?.show()
	await fetchBackups()
}

async function backupNow(world: BedrockWorld) {
	backingUp.value = world.folderName
	try {
		await invoke('plugin:bedrock-worlds|backup_bedrock_world_now', {
			profilePath: props.instance.path,
			folderName: world.folderName,
		})
		notifications.addNotification({
			type: 'success',
			title: 'Снапшот создан',
			text: `Бэкап мира ${world.name} сохранён.`,
		})
	} catch (e) {
		notifications.handleError(e as Error)
	} finally {
		backingUp.value = null
	}
}

async function restoreBackup(backup: BedrockWorldBackup) {
	if (!confirm(`Восстановить мир ${worldNameFor(backup.folderName)} из снапшота от ${formatDate(backup.created)}? Текущее состояние мира будет заменено.`)) return
	restoringBackup.value = backup.backupName
	try {
		await invoke('plugin:bedrock-worlds|restore_bedrock_world_backup', {
			profilePath: props.instance.path,
			folderName: backup.folderName,
			backupName: backup.backupName,
		})
		notifications.addNotification({
			type: 'success',
			title: 'Мир восстановлен',
			text: `Мир ${worldNameFor(backup.folderName)} восстановлен из снапшота.`,
		})
		await fetchWorlds()
	} catch (e) {
		notifications.handleError(e as Error)
	} finally {
		restoringBackup.value = null
	}
}

async function deleteBackup(backup: BedrockWorldBackup) {
	if (!confirm(`Удалить снапшот от ${formatDate(backup.created)}?`)) return
	try {
		await invoke('plugin:bedrock-worlds|delete_bedrock_world_backup', {
			profilePath: props.instance.path,
			folderName: backup.folderName,
			backupName: backup.backupName,
		})
		await fetchBackups()
	} catch (e) {
		notifications.handleError(e as Error)
	}
}

onMounted(() => {
	fetchWorlds()
})
</script>
