<template>
	<ReadyTransition :pending="loading">
		<div class="flex flex-col gap-4">
			<div class="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-surface-1 p-5 rounded-2xl border border-surface-2 gap-4">
				<div class="flex flex-col gap-1">
					<h2 class="text-xl font-bold text-primary">Миры Bedrock</h2>
					<p class="text-sm text-secondary">Управляйте мирами Minecraft Bedrock, импортируйте новые или экспортируйте для обмена.</p>
				</div>
				<div class="flex items-center gap-2">
					<ButtonStyled color="surface" type="outlined" @click="importFromFile">
						<template #icon><DownloadIcon class="size-4" /></template>
						Импорт (.mcworld)
					</ButtonStyled>
					<ButtonStyled color="brand" @click="openCurseForgeWorlds">
						<template #icon><CompassIcon class="size-4" /></template>
						Найти миры
					</ButtonStyled>
				</div>
			</div>

			<div v-if="worlds.length === 0" class="flex flex-col items-center justify-center py-16 bg-surface-1 rounded-2xl border border-surface-2 gap-4 text-center px-4">
				<div class="w-16 h-16 rounded-full bg-surface-2 flex items-center justify-center text-primary mb-1 shadow-inner">
					<GlobeIcon class="w-8 h-8 opacity-80 text-brand" />
				</div>
				<div class="flex flex-col gap-1">
					<h3 class="text-xl font-bold text-primary">Нет сохраненных миров</h3>
					<p class="text-secondary text-sm max-w-md">Найдите миры на CurseForge или импортируйте готовый файл .mcworld с вашего компьютера.</p>
				</div>
				
				<div class="flex items-center gap-3 mt-2">
					<ButtonStyled color="surface" @click="importFromFile" class="!px-5 !py-2.5 font-semibold">
						<template #icon><DownloadIcon class="size-4" /></template>
						Импортировать (.mcworld)
					</ButtonStyled>
					<ButtonStyled color="brand" @click="openCurseForgeWorlds" class="!px-5 !py-2.5 font-semibold">
						<template #icon><CompassIcon class="size-4" /></template>
						Каталог миров
					</ButtonStyled>
				</div>
			</div>

			<div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
				<div 
					v-for="world in worlds" 
					:key="world.folderName" 
					class="bg-surface-1 rounded-2xl overflow-hidden border border-surface-2 flex flex-col shadow-sm transition-all duration-150 hover:border-brand/40 hover:shadow-md"
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
						<div class="font-bold text-base text-primary truncate" :title="world.name">
							{{ world.name }}
						</div>
						<div class="text-xs text-secondary flex items-center gap-1">
							<span>Последняя игра: {{ formatDate(world.lastPlayed) }}</span>
						</div>
						<div class="text-[11px] font-mono text-tertiary truncate">
							{{ world.folderName }}
						</div>
						
						<div class="mt-auto pt-3 flex gap-2 justify-end items-center border-t border-surface-2/60">
							<ButtonStyled size="small" color="surface" type="outlined" @click="exportWorld(world)">
								Экспорт
							</ButtonStyled>
							<ButtonStyled size="small" color="red" type="transparent" @click="deleteWorld(world)" title="Удалить мир">
								<TrashIcon class="size-4 text-red-500" />
							</ButtonStyled>
						</div>
					</div>
				</div>
			</div>
		</div>
	</ReadyTransition>
</template>

<script setup lang="ts">
import { CompassIcon, DownloadIcon, GlobeIcon, TrashIcon } from '@modrinth/assets'
import { ButtonStyled, ReadyTransition, injectNotificationManager } from '@modrinth/ui'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { ref, onMounted } from 'vue'
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
}

const loading = ref(true)
const worlds = ref<BedrockWorld[]>([])
const notifications = injectNotificationManager()

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

onMounted(() => {
	fetchWorlds()
})
</script>
