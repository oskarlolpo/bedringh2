<script setup>
import { BoxIcon, FolderSearchIcon, TrashIcon, DownloadIcon, ArchiveIcon } from '@modrinth/assets'
import { ButtonStyled, injectNotificationManager, Slider, StyledInput, defineMessages, useVIntl, Combobox, Checkbox, Card } from '@modrinth/ui'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { onMounted, ref, watch, computed } from 'vue'

import ConfirmModalWrapper from '@/components/ui/modal/ConfirmModalWrapper.vue'
import { purge_cache_types } from '@/helpers/cache.js'
import { remove as removeProfile } from '@/helpers/profile.ts'
import { get, set } from '@/helpers/settings.ts'

const { formatMessage } = useVIntl()
const { handleError } = injectNotificationManager()
const settings = ref(await get())

const activeTab = ref('profiles')
const cacheSizes = ref(null)
const bedrockPackages = ref([])
const profiles = ref([])
const sizesLoading = ref(false)

const sortOption = ref('size')
const selectedBedrockPackages = ref([])

const purgeCacheConfirmModal = ref(null)
const deleteProfileModal = ref(null)
const deleteVersionModal = ref(null)

const profileToDelete = ref(null)
const versionToDelete = ref(null)
const linkedProfilesForVersion = ref([])
const alsoDeleteLinked = ref(true)
const isDeletingProfile = ref(false)

const messages = defineMessages({
	rmTitle: { id: 'app.resource-management.title', defaultMessage: 'Storage' },
	tabProfiles: { id: 'app.resource-management.tab.profiles', defaultMessage: 'Builds' },
	tabVersions: { id: 'app.resource-management.tab.versions', defaultMessage: 'Bedrock Versions' },
	tabCache: { id: 'app.resource-management.tab.cache', defaultMessage: 'Cache' },
	cacheSize: { id: 'app.resource-management.cache-size', defaultMessage: 'Total cache size' },
	bedrockPackages: { id: 'app.resource-management.bedrock-packages', defaultMessage: 'Bedrock versions' },
	javaRuntimes: { id: 'app.resource-management.java-runtimes', defaultMessage: 'Java environments' },
	httpCache: { id: 'app.resource-management.http-cache', defaultMessage: 'Data cache' },
	broken: { id: 'app.resource-management.broken', defaultMessage: 'Broken' },
	sortOptions: { id: 'app.resource-management.sort', defaultMessage: 'Sort by' },
	sortSize: { id: 'app.resource-management.sort.size', defaultMessage: 'Size' },
	sortDate: { id: 'app.resource-management.sort.date', defaultMessage: 'Date' },
	sortName: { id: 'app.resource-management.sort.name', defaultMessage: 'Name' },
	deleteSelected: { id: 'app.resource-management.delete-selected', defaultMessage: 'Delete selected ({count})' },
	linkedCount: { id: 'app.resource-management.linked-count', defaultMessage: '{count} build(s)' },
	loadingSize: { id: 'app.resource-management.loading-size', defaultMessage: 'Calculating...' },
	noItems: { id: 'app.resource-management.no-items', defaultMessage: 'Nothing found' }
})

const tabs = computed(() => [
	{ id: 'profiles', label: formatMessage(messages.tabProfiles), count: profiles.value?.length || 0 },
	{ id: 'versions', label: formatMessage(messages.tabVersions), count: bedrockPackages.value?.length || 0 },
	{ id: 'cache', label: formatMessage(messages.tabCache), count: null },
])

function sortList(list) {
	if (!list) return []
	return [...list].sort((a, b) => {
		if (sortOption.value === 'size') return (b.size || 0) - (a.size || 0);
		if (sortOption.value === 'date') return (b.created || 0) - (a.created || 0);
		return a.name.localeCompare(b.name);
	});
}

async function fetchCacheInfo() {
	const [sizes, fetchedBedrock, fetchedProfiles] = await Promise.all([
		invoke('plugin:cache|get_cache_sizes').catch(handleError),
		invoke('plugin:cache|get_bedrock_packages').catch(handleError),
		invoke('plugin:cache|get_profile_storage').catch(handleError),
	])

	if (sizes) cacheSizes.value = sizes
	if (fetchedBedrock) bedrockPackages.value = sortList(fetchedBedrock)
	if (fetchedProfiles) profiles.value = sortList(fetchedProfiles)
	selectedBedrockPackages.value = [];

	loadSizesProgressively()
}

async function loadSizesProgressively() {
	if (sizesLoading.value) return
	sizesLoading.value = true

	try {
		const allItems = [
			...(profiles.value || []).map(p => ({ type: 'profile', path: p.path, item: p })),
			...(bedrockPackages.value || []).map(p => ({ type: 'bedrock', path: p.path, item: p })),
		]

		for (const { type, path, item } of allItems) {
			try {
				const size = await invoke('plugin:cache|get_directory_size', { path })
				if (type === 'profile') {
					const idx = profiles.value.findIndex(p => p.path === path)
					if (idx > -1) profiles.value[idx].size = size
				} else {
					const idx = bedrockPackages.value.findIndex(p => p.path === path)
					if (idx > -1) bedrockPackages.value[idx].size = size
				}
			} catch (e) {
				console.warn('Failed to load size for', path, e)
			}
		}
	} finally {
		sizesLoading.value = false
	}
}

watch(sortOption, () => {
	if (bedrockPackages.value) bedrockPackages.value = sortList(bedrockPackages.value);
	if (profiles.value) profiles.value = sortList(profiles.value);
})

onMounted(() => {
	fetchCacheInfo()
})

function formatBytes(bytes) {
	if (!bytes || bytes === 0) return '—'
	const k = 1024
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function getLinkedProfiles(pkg) {
	if (!pkg || !profiles.value) return []
	return profiles.value.filter(
		(p) => p.loader === 'bedrock' && `bedrock_${p.game_version}` === pkg.name
	)
}

function requestRemoveBedrockPackage(pkg) {
	const linked = getLinkedProfiles(pkg)
	if (linked.length > 0) {
		versionToDelete.value = pkg
		linkedProfilesForVersion.value = linked
		alsoDeleteLinked.value = true
		deleteVersionModal.value?.show()
	} else {
		removeBedrockPackage(pkg.path)
	}
}

async function confirmRemoveBedrockPackage() {
	const pkg = versionToDelete.value
	if (!pkg) return
	try {
		if (alsoDeleteLinked.value && linkedProfilesForVersion.value.length > 0) {
			for (const p of linkedProfilesForVersion.value) {
				await removeProfile(p.path).catch(handleError)
			}
		}
		await invoke('plugin:cache|remove_directory', { path: pkg.path }).catch(handleError)
	} finally {
		versionToDelete.value = null
		linkedProfilesForVersion.value = []
		await fetchCacheInfo()
	}
}

async function removeBedrockPackage(path) {
	await invoke('plugin:cache|remove_directory', { path }).catch(handleError)
	await fetchCacheInfo()
}

function requestRemoveProfile(profile) {
	profileToDelete.value = profile
	deleteProfileModal.value?.show()
}

async function confirmRemoveProfile() {
	const profile = profileToDelete.value
	if (!profile) return
	isDeletingProfile.value = true
	try {
		await removeProfile(profile.path).catch(handleError)
	} finally {
		isDeletingProfile.value = false
		profileToDelete.value = null
		await fetchCacheInfo()
	}
}

function toggleBedrockSelection(pkgPath) {
	const idx = selectedBedrockPackages.value.indexOf(pkgPath);
	if (idx > -1) selectedBedrockPackages.value.splice(idx, 1);
	else selectedBedrockPackages.value.push(pkgPath);
}

const isDeleting = ref(false);
async function removeSelectedBedrockPackages() {
	isDeleting.value = true;
	try {
		for (const p of selectedBedrockPackages.value) {
			await invoke('plugin:cache|remove_directory', { path: p }).catch(handleError)
		}
	} finally {
		isDeleting.value = false;
		await fetchCacheInfo();
	}
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
		<ConfirmModalWrapper
			ref="purgeCacheConfirmModal"
			title="Are you sure you want to purge the cache?"
			description="If you proceed, your entire cache will be purged. This may slow down the app temporarily."
			:has-to-type="false"
			proceed-label="Purge cache"
			:show-ad-on-close="false"
			@proceed="purgeCache"
		/>
		<ConfirmModalWrapper
			ref="deleteProfileModal"
			:title="`Delete build '${profileToDelete?.name}'?`"
			:description="`The build folder and all its contents (worlds, addons, settings) will be permanently deleted. This action cannot be undone.`"
			:has-to-type="false"
			proceed-label="Delete build"
			:show-ad-on-close="false"
			@proceed="confirmRemoveProfile"
		/>
		<ConfirmModalWrapper
			ref="deleteVersionModal"
			:title="`Delete version '${versionToDelete?.name}'?`"
			:description="`This version is used by ${linkedProfilesForVersion.length} build(s): ${linkedProfilesForVersion.map((p) => p.name).join(', ')}. ${alsoDeleteLinked ? 'The linked builds will also be deleted.' : 'The linked builds will remain, but may stop working until the version is re-downloaded.'}`"
			:has-to-type="false"
			:proceed-label="alsoDeleteLinked && linkedProfilesForVersion.length > 0 ? 'Delete version and builds' : 'Delete version only'"
			:show-ad-on-close="false"
			@proceed="confirmRemoveBedrockPackage"
		/>

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
			<h2 class="m-0 text-lg font-semibold text-contrast">App cache</h2>
			<div>
				<ButtonStyled color="red" @click="purgeCacheConfirmModal?.show()">
					<TrashIcon />
					Purge cache
				</ButtonStyled>
			</div>
			<p class="m-0 leading-tight text-secondary">
				The Modrinth app stores a cache of data to speed up loading. This can be purged to force the
				app to reload data. This may slow down the app temporarily.
			</p>
		</div>

		<div class="flex flex-col gap-4 mt-4">
			<div class="flex items-center justify-between">
				<h2 class="m-0 text-lg font-semibold text-contrast">{{ formatMessage(messages.rmTitle) }}</h2>
				<div class="flex items-center gap-2" v-if="activeTab !== 'cache'">
					<Combobox
						id="sort-options"
						v-model="sortOption"
						name="Sort options"
						class="max-w-40"
						:options="[
							{ value: 'size', label: formatMessage(messages.sortSize) },
							{ value: 'date', label: formatMessage(messages.sortDate) },
							{ value: 'name', label: formatMessage(messages.sortName) }
						]"
						:display-value="sortOption === 'size' ? formatMessage(messages.sortSize) : sortOption === 'date' ? formatMessage(messages.sortDate) : formatMessage(messages.sortName)"
					/>
					<ButtonStyled v-if="activeTab === 'versions' && selectedBedrockPackages.length > 0" @click="removeSelectedBedrockPackages" color="red" class="shrink-0" :disabled="isDeleting">
						<TrashIcon class="w-4 h-4 mr-2" />
						{{ formatMessage(messages.deleteSelected, { count: selectedBedrockPackages.length }) }}
					</ButtonStyled>
				</div>
			</div>

			<div class="flex gap-1 p-1 bg-black/5 dark:bg-white/5 rounded-lg w-fit">
				<button
					v-for="tab in tabs"
					:key="tab.id"
					class="px-4 py-2 rounded-md text-sm font-medium transition-colors"
					:class="activeTab === tab.id ? 'bg-white dark:bg-black/20 text-contrast shadow-sm' : 'text-secondary hover:text-contrast'"
					@click="activeTab = tab.id"
				>
					{{ tab.label }}
					<span v-if="tab.count !== null" class="ml-1.5 text-xs opacity-70">{{ tab.count }}</span>
				</button>
			</div>

			<div v-if="activeTab === 'cache'" class="flex flex-col gap-3">
				<Card class="p-4">
					<div class="flex flex-col gap-3">
						<div class="flex justify-between items-center border-b border-black/10 dark:border-white/10 pb-3">
							<span class="font-medium">{{ formatMessage(messages.cacheSize) }}</span>
							<span class="font-bold text-brand text-lg">{{ cacheSizes ? formatBytes(cacheSizes.total) : '—' }}</span>
						</div>
						<div class="grid grid-cols-3 gap-4">
							<div class="flex flex-col gap-1 p-3 bg-black/5 dark:bg-white/5 rounded-lg">
								<span class="text-xs text-secondary">{{ formatMessage(messages.bedrockPackages) }}</span>
								<span class="font-semibold">{{ cacheSizes ? formatBytes(cacheSizes.bedrock_packages) : '—' }}</span>
							</div>
							<div class="flex flex-col gap-1 p-3 bg-black/5 dark:bg-white/5 rounded-lg">
								<span class="text-xs text-secondary">{{ formatMessage(messages.javaRuntimes) }}</span>
								<span class="font-semibold">{{ cacheSizes ? formatBytes(cacheSizes.java_runtimes) : '—' }}</span>
							</div>
							<div class="flex flex-col gap-1 p-3 bg-black/5 dark:bg-white/5 rounded-lg">
								<span class="text-xs text-secondary">{{ formatMessage(messages.httpCache) }}</span>
								<span class="font-semibold">{{ cacheSizes ? formatBytes(cacheSizes.http_cache) : '—' }}</span>
							</div>
						</div>
					</div>
				</Card>
			</div>

			<div v-else-if="activeTab === 'profiles'" class="flex flex-col gap-2">
				<div v-if="!profiles || profiles.length === 0" class="text-center py-8 text-secondary">
					{{ formatMessage(messages.noItems) }}
				</div>
				<Card v-for="pkg in profiles" :key="pkg.path" class="p-3">
					<div class="flex items-center justify-between">
						<div class="flex flex-col overflow-hidden min-w-0">
							<div class="flex items-center gap-2">
								<span class="font-medium truncate">{{ pkg.name }}</span>
								<span class="text-[10px] uppercase font-bold bg-brand/20 text-brand px-2 py-0.5 rounded-full whitespace-nowrap shrink-0">{{ pkg.loader }} {{ pkg.game_version }}</span>
							</div>
							<span class="text-xs text-secondary truncate mt-1" :title="pkg.path">{{ pkg.path }}</span>
						</div>
						<div class="flex items-center gap-3 shrink-0 pl-4">
							<span class="text-sm font-medium min-w-[60px] text-right" :class="{ 'text-secondary animate-pulse': !pkg.size }">
								{{ pkg.size ? formatBytes(pkg.size) : formatMessage(messages.loadingSize) }}
							</span>
							<ButtonStyled @click="requestRemoveProfile(pkg)" color="red" class="p-2" aria-label="Delete build">
								<TrashIcon class="w-4 h-4" />
							</ButtonStyled>
						</div>
					</div>
				</Card>
			</div>

			<div v-else-if="activeTab === 'versions'" class="flex flex-col gap-2">
				<div v-if="!bedrockPackages || bedrockPackages.length === 0" class="text-center py-8 text-secondary">
					{{ formatMessage(messages.noItems) }}
				</div>
				<Card v-for="pkg in bedrockPackages" :key="pkg.path" class="p-3" :class="{ 'border-red-500/50': !pkg.is_valid }">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-3 overflow-hidden min-w-0">
							<Checkbox
								:model-value="selectedBedrockPackages.includes(pkg.path)"
								@update:model-value="toggleBedrockSelection(pkg.path)"
							/>
							<div class="flex flex-col overflow-hidden min-w-0">
								<div class="flex items-center gap-2">
									<span class="font-medium truncate">{{ pkg.name }}</span>
									<span v-if="!pkg.is_valid" class="text-[10px] uppercase font-bold bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0">{{ formatMessage(messages.broken) }}</span>
									<span v-if="getLinkedProfiles(pkg).length > 0" class="text-[10px] uppercase font-bold bg-brand/20 text-brand px-2 py-0.5 rounded-full whitespace-nowrap shrink-0">{{ formatMessage(messages.linkedCount, { count: getLinkedProfiles(pkg).length }) }}</span>
								</div>
								<span class="text-xs text-secondary truncate mt-1" :title="pkg.path">{{ pkg.path }}</span>
							</div>
						</div>
						<div class="flex items-center gap-3 shrink-0 pl-4">
							<span class="text-sm font-medium min-w-[60px] text-right" :class="{ 'text-secondary animate-pulse': !pkg.size }">
								{{ pkg.size ? formatBytes(pkg.size) : formatMessage(messages.loadingSize) }}
							</span>
							<ButtonStyled @click="requestRemoveBedrockPackage(pkg)" color="red" class="p-2" aria-label="Delete">
								<TrashIcon class="w-4 h-4" />
							</ButtonStyled>
						</div>
					</div>
				</Card>
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
