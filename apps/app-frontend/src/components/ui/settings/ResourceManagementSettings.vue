<script setup>
import { BoxIcon, FolderSearchIcon, TrashIcon } from '@modrinth/assets'
import { ButtonStyled, injectNotificationManager, Slider, StyledInput } from '@modrinth/ui'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { onMounted, ref, watch } from 'vue'

import ConfirmModalWrapper from '@/components/ui/modal/ConfirmModalWrapper.vue'
import { purge_cache_types } from '@/helpers/cache.js'
import { get, set } from '@/helpers/settings.ts'

const { handleError } = injectNotificationManager()
const settings = ref(await get())

const cacheSizes = ref(null)
const bedrockPackages = ref([])
const profiles = ref([])

async function fetchCacheInfo() {
	cacheSizes.value = await invoke('plugin:cache|get_cache_sizes').catch(handleError)
	bedrockPackages.value = await invoke('plugin:cache|get_bedrock_packages').catch(handleError)
	
	const fetchedProfiles = await invoke('plugin:cache|get_profile_storage').catch(handleError)
	if (fetchedProfiles) {
		fetchedProfiles.sort((a, b) => b.size - a.size) // sort by size descending
		profiles.value = fetchedProfiles
	}
}

onMounted(() => {
	fetchCacheInfo()
})

function formatBytes(bytes) {
	if (bytes === 0) return '0 B'
	const k = 1024
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

async function removeBedrockPackage(path) {
	await invoke('plugin:cache|remove_directory', { path }).catch(handleError)
	await fetchCacheInfo()
}

watch(
	settings,
	async () => {
		const setSettings = JSON.parse(JSON.stringify(settings.value))

		if (!setSettings.custom_dir) {
			setSettings.custom_dir = null
		}

		await set(setSettings)
	},
	{ deep: true },
)

async function purgeCache() {
	await purge_cache_types([
		'project',
		'project_v3',
		'version',
		'user',
		'team',
		'organization',
		'file',
		'loader_manifest',
		'minecraft_manifest',
		'categories',
		'report_types',
		'loaders',
		'game_versions',
		'donation_platforms',
		'file_hash',
		'file_update',
		'search_results',
		'search_results_v3',
	]).catch(handleError)
}

async function findLauncherDir() {
	const newDir = await open({
		multiple: false,
		directory: true,
		title: 'Select a new app directory',
	})

	if (newDir) {
		settings.value.custom_dir = newDir
	}
}
</script>

<template>
	<div class="flex flex-col gap-6">
		<div class="flex flex-col gap-2.5">
			<h2 class="m-0 text-lg font-semibold text-contrast">App directory</h2>
			<StyledInput
				id="appDir"
				v-model="settings.custom_dir"
				:icon="BoxIcon"
				type="text"
				wrapper-class="w-full"
			>
				<template #right>
					<ButtonStyled circular>
						<button class="ml-1.5" @click="findLauncherDir">
							<FolderSearchIcon />
						</button>
					</ButtonStyled>
				</template>
			</StyledInput>
			<p class="m-0 leading-tight text-secondary">
				The directory where the launcher stores all of its files. Changes will be applied after
				restarting the launcher.
			</p>
		</div>

		<div class="flex flex-col gap-2.5">
			<ConfirmModalWrapper
				ref="purgeCacheConfirmModal"
				title="Are you sure you want to purge the cache?"
				description="If you proceed, your entire cache will be purged. This may slow down the app temporarily."
				:has-to-type="false"
				proceed-label="Purge cache"
				:show-ad-on-close="false"
				@proceed="purgeCache"
			/>
			<h2 class="m-0 text-lg font-semibold text-contrast">App cache</h2>
			<button id="purge-cache" class="btn min-w-max" @click="$refs.purgeCacheConfirmModal.show()">
				<TrashIcon />
				Purge cache
			</button>
			<p class="m-0 leading-tight text-secondary">
				The Modrinth app stores a cache of data to speed up loading. This can be purged to force the
				app to reload data. This may slow down the app temporarily.
			</p>
		</div>

		<div class="flex flex-col gap-2.5 mt-4">
			<h2 class="m-0 text-lg font-semibold text-contrast">Менеджер Памяти и Кеша</h2>
			<div v-if="cacheSizes" class="flex flex-col gap-2 bg-black/5 dark:bg-white/5 p-4 rounded-lg">
				<div class="flex justify-between items-center border-b border-black/10 dark:border-white/10 pb-2 mb-1">
					<span class="font-medium">Общий размер кеша</span>
					<span class="font-bold text-brand">{{ formatBytes(cacheSizes.total) }}</span>
				</div>
				<div class="flex justify-between text-sm text-secondary">
					<span>Сборки Bedrock</span>
					<span>{{ formatBytes(cacheSizes.bedrock_packages) }}</span>
				</div>
				<div class="flex justify-between text-sm text-secondary">
					<span>Среды Java</span>
					<span>{{ formatBytes(cacheSizes.java_runtimes) }}</span>
				</div>
				<div class="flex justify-between text-sm text-secondary">
					<span>Кеш данных</span>
					<span>{{ formatBytes(cacheSizes.http_cache) }}</span>
				</div>
			</div>

			<h3 class="m-0 mt-4 text-md font-semibold text-contrast" v-if="profiles && profiles.length > 0">Установленные Сборки (Профили)</h3>
			<div v-if="profiles && profiles.length > 0" class="flex flex-col gap-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
				<div v-for="pkg in profiles" :key="pkg.path" class="flex items-center justify-between bg-black/5 dark:bg-white/5 p-3 rounded-lg border border-transparent transition-colors hover:bg-black/10 dark:hover:bg-white/10">
					<div class="flex flex-col overflow-hidden">
						<span class="font-medium flex items-center gap-2 truncate">
							{{ pkg.name }}
						</span>
						<span class="text-xs text-secondary truncate mt-0.5" :title="pkg.path">{{ pkg.path }}</span>
					</div>
					<div class="flex items-center gap-4 shrink-0 pl-4">
						<span class="text-sm font-medium">{{ formatBytes(pkg.size) }}</span>
					</div>
				</div>
			</div>

			<h3 class="m-0 mt-4 text-md font-semibold text-contrast" v-if="bedrockPackages && bedrockPackages.length > 0">Загруженные версии Bedrock</h3>
			<div v-if="bedrockPackages && bedrockPackages.length > 0" class="flex flex-col gap-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
				<div v-for="pkg in bedrockPackages" :key="pkg.path" class="flex items-center justify-between bg-black/5 dark:bg-white/5 p-3 rounded-lg border border-transparent transition-colors hover:bg-black/10 dark:hover:bg-white/10" :class="{ 'border-red-500/50 bg-red-500/5 dark:bg-red-500/10': !pkg.is_valid }">
					<div class="flex flex-col overflow-hidden">
						<span class="font-medium flex items-center gap-2 truncate">
							{{ pkg.name }}
							<span v-if="!pkg.is_valid" class="text-[10px] uppercase font-bold bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full whitespace-nowrap">Битый / Недокачанный</span>
						</span>
						<span class="text-xs text-secondary truncate mt-0.5" :title="pkg.path">{{ pkg.path }}</span>
					</div>
					<div class="flex items-center gap-4 shrink-0 pl-4">
						<span class="text-sm font-medium">{{ formatBytes(pkg.size) }}</span>
						<ButtonStyled @click="removeBedrockPackage(pkg.path)" color="red" class="p-2" aria-label="Удалить пакет">
							<TrashIcon class="w-4 h-4" />
						</ButtonStyled>
					</div>
				</div>
			</div>
		</div>

		<div class="flex flex-col gap-2.5">
			<h2 class="m-0 text-lg font-semibold text-contrast mt-4">Maximum concurrent downloads</h2>
			<Slider
				id="max-downloads"
				v-model="settings.max_concurrent_downloads"
				:min="1"
				:max="10"
				:step="1"
			/>
			<p class="m-0 leading-tight text-secondary">
				The maximum amount of files the launcher can download at the same time. Set this to a lower
				value if you have a poor internet connection. (app restart required to take effect)
			</p>
		</div>

		<div class="flex flex-col gap-2.5">
			<h2 class="mt-0 m-0 text-lg font-semibold text-contrast">Maximum concurrent writes</h2>
			<Slider
				id="max-writes"
				v-model="settings.max_concurrent_writes"
				:min="1"
				:max="50"
				:step="1"
			/>
			<p class="m-0 leading-tight text-secondary">
				The maximum amount of files the launcher can write to the disk at once. Set this to a lower
				value if you are frequently getting I/O errors. (app restart required to take effect)
			</p>
		</div>
	</div>
</template>
