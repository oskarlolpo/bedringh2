<template>
	<ReadyTransition :pending="loading">
		<ContentCardLayout>
			<template #empty>
				<EmptyState
					v-if="addons.length === 0"
					icon="boxes"
					title="No Add-ons installed"
					description="Add behavioral or resource packs to customize your Bedrock experience."
				>
					<ButtonStyled color="brand" @click="installFromFile">
						<template #icon><DownloadIcon /></template>
						Install Add-on (.mcpack / .mcaddon)
					</ButtonStyled>
				</EmptyState>
			</template>
			<template #default>
				<div class="flex items-center justify-between mb-4">
					<h2 class="text-xl font-bold">Bedrock Add-ons & Content</h2>
					<div class="flex gap-2">
						<ButtonStyled color="brand-outline" @click="checkAddonUpdates" :disabled="isCheckingUpdates">
							{{ isCheckingUpdates ? 'Checking...' : 'Check for Updates' }}
						</ButtonStyled>
						<ButtonStyled color="brand" @click="installFromFile">
							<template #icon><DownloadIcon /></template>
							Install from File
						</ButtonStyled>
					</div>
				</div>

				<!-- Main 2-column layout: Search & Results on Left, Filters Sidebar on Top-Right -->
				<div class="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
					<!-- Main Content Area (Left, 3 columns) -->
					<div class="lg:col-span-3 flex flex-col gap-4">
						<!-- CurseForge Search Box -->
						<div class="p-4 bg-surface-1 rounded-xl border border-surface-2 flex flex-col gap-3">
							<div class="flex items-center justify-between">
								<h3 class="font-bold text-base flex items-center gap-2">
									<GlobeIcon class="w-5 h-5 text-brand" /> Discover on CurseForge
								</h3>
								<span v-if="activeFilterCount > 0" class="text-xs px-2 py-0.5 rounded-full bg-brand/20 text-brand font-semibold">
									{{ activeFilterCount }} filter(s) active
								</span>
							</div>

							<div class="flex gap-2">
								<input
									v-model="searchQuery"
									type="text"
									placeholder="Search behavior packs, resource packs, maps, skins..."
									class="flex-1 bg-surface-base px-3 py-2 rounded-lg outline-none border border-surface-2 placeholder:text-contrast focus:border-brand text-sm"
									@keydown.enter="searchCurseForge"
								/>
								<ButtonStyled color="brand" @click="searchCurseForge" :disabled="isSearchingCF">
									{{ isSearchingCF ? 'Searching...' : 'Search' }}
								</ButtonStyled>
							</div>

							<!-- Search Results -->
							<div v-if="cfResults.length > 0" class="flex flex-col gap-2 mt-2 max-h-[380px] overflow-y-auto pr-1">
								<div v-for="cfMod in cfResults" :key="cfMod.id" class="flex bg-surface-base border border-surface-2 rounded-lg p-3 justify-between items-center hover:border-brand/50 transition-colors">
									<div class="flex items-center gap-3">
										<img v-if="cfMod.logo?.thumbnailUrl" :src="cfMod.logo.thumbnailUrl" class="w-10 h-10 rounded shadow-sm object-cover" />
										<div v-else class="w-10 h-10 rounded bg-surface-2 flex-shrink-0 flex items-center justify-center font-bold text-xs">
											{{ cfMod.name.charAt(0) }}
										</div>
										<div class="flex flex-col min-w-0">
											<span class="font-bold text-sm cursor-pointer hover:underline truncate" @click="openCfUrl(cfMod.slug)">{{ cfMod.name }}</span>
											<span class="text-xs text-contrast line-clamp-1">{{ cfMod.summary || 'No description' }}</span>
										</div>
									</div>
									<ButtonStyled size="small" color="brand" @click="installCfMod(cfMod)">
										Install
									</ButtonStyled>
								</div>
							</div>
							<div v-else-if="hasSearched && !isSearchingCF" class="text-xs text-contrast text-center py-3">
								No content found matching current search and filters.
							</div>
						</div>

						<!-- Installed Add-ons List -->
						<div class="flex flex-col gap-3">
							<h3 class="font-bold text-lg">Installed Add-ons ({{ addons.length }})</h3>
							<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div 
									v-for="addon in addons" 
									:key="addon.uuid" 
									class="bg-surface-1 rounded-xl p-4 border border-surface-2 flex flex-col gap-2 relative shadow-sm transition-all hover:shadow-md"
									:class="{'opacity-50 grayscale': !addon.is_enabled}"
								>
									<div class="flex justify-between items-start">
										<div class="flex items-center gap-3 max-w-[75%]">
											<img v-if="addon.icon_path" :src="convertFileSrc(addon.icon_path)" class="w-10 h-10 rounded shadow-sm object-cover flex-shrink-0" />
											<div v-else class="w-10 h-10 rounded bg-surface-2 flex items-center justify-center flex-shrink-0 font-bold text-sm text-contrast">
												{{ addon.name.charAt(0).toUpperCase() }}
											</div>
											<div class="font-bold text-base truncate" :title="addon.name">
												{{ addon.name }}
											</div>
										</div>
										<div class="text-xs font-mono bg-surface-2 px-2 py-1 rounded">
											{{ addon.version }}
										</div>
									</div>
									
									<p class="text-xs text-contrast line-clamp-2 h-8" :title="addon.description">
										{{ addon.description || 'No description provided.' }}
									</p>
									
									<div class="mt-auto pt-2 flex items-center justify-between border-t border-surface-2">
										<span class="text-[11px] font-semibold uppercase tracking-wider" :class="addon.kind === 'resource' ? 'text-blue-400' : 'text-purple-400'">
											{{ addon.kind }}
										</span>
										
										<div class="flex gap-2 isolate">
											<ButtonStyled 
												size="small" 
												:color="addon.is_enabled ? 'surface' : 'brand'"
												@click="toggleAddon(addon)"
											>
												{{ addon.is_enabled ? 'Disable' : 'Enable' }}
											</ButtonStyled>
											<ButtonStyled 
												size="small" 
												color="red"
												type="transparent"
												@click="deleteAddon(addon)"
												title="Delete Add-on"
											>
												<TrashIcon class="w-4 h-4" />
											</ButtonStyled>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>

					<!-- Filters Sidebar (Right column, Top-Right placement) -->
					<div class="lg:col-span-1 bg-surface-1 rounded-xl p-4 border border-surface-2 flex flex-col gap-5 h-fit sticky top-4">
						<!-- Filters Header -->
						<div class="flex items-center justify-between border-b border-surface-2 pb-3">
							<h3 class="font-bold text-base flex items-center gap-1.5">
								Filters
								<span v-if="activeFilterCount > 0" class="w-5 h-5 rounded-full bg-brand text-brand-contrast text-xs flex items-center justify-center font-bold">
									{{ activeFilterCount }}
								</span>
							</h3>
							<button 
								class="text-xs text-contrast hover:text-brand underline font-medium transition-colors"
								@click="clearAllFilters"
							>
								Clear all
							</button>
						</div>

						<!-- Browse by Section -->
						<div class="flex flex-col gap-2">
							<div class="font-bold text-xs uppercase tracking-wider text-contrast flex items-center justify-between">
								<span>Browse by</span>
							</div>
							<div class="flex flex-col gap-1">
								<label 
									v-for="type in browseByTypes" 
									:key="type.id ?? 'all'" 
									class="flex items-center gap-2 text-xs cursor-pointer py-1.5 px-2 rounded-lg transition-colors hover:bg-surface-2"
									:class="{ 'bg-surface-2 font-bold text-brand': selectedClassId === type.id }"
								>
									<input 
										type="radio" 
										name="browseBy" 
										:checked="selectedClassId === type.id"
										class="accent-brand cursor-pointer"
										@change="selectBrowseBy(type.id)"
									/>
									<span>{{ type.label }}</span>
								</label>
							</div>
						</div>

						<!-- Categories Section -->
						<div class="flex flex-col gap-2 border-t border-surface-2 pt-4">
							<div class="font-bold text-xs uppercase tracking-wider text-contrast flex items-center justify-between">
								<span>Categories</span>
							</div>
							<div class="flex flex-col gap-1 max-h-[220px] overflow-y-auto pr-1">
								<label 
									v-for="cat in availableCategories" 
									:key="cat.id ?? 'all'"
									class="flex items-center gap-2 text-xs cursor-pointer py-1 px-2 rounded-lg transition-colors hover:bg-surface-2"
									:class="{ 'bg-surface-2 font-semibold text-brand': selectedCategoryId === cat.id }"
								>
									<input 
										type="checkbox"
										:checked="selectedCategoryId === cat.id"
										class="accent-brand rounded cursor-pointer"
										@change="toggleCategory(cat.id)"
									/>
									<span class="truncate">{{ cat.label }}</span>
								</label>
							</div>
						</div>

						<!-- Game Version Section -->
						<div class="flex flex-col gap-2 border-t border-surface-2 pt-4">
							<div class="font-bold text-xs uppercase tracking-wider text-contrast flex items-center justify-between">
								<span>Game Version</span>
							</div>
							<input
								v-model="versionSearch"
								type="text"
								placeholder="Search versions..."
								class="bg-surface-base px-2.5 py-1.5 rounded outline-none border border-surface-2 placeholder:text-contrast text-xs"
							/>
							<div class="flex flex-col gap-1 max-h-[180px] overflow-y-auto pr-1">
								<label 
									v-for="ver in filteredVersions" 
									:key="ver"
									class="flex items-center gap-2 text-xs cursor-pointer py-1 px-2 rounded-lg transition-colors hover:bg-surface-2"
									:class="{ 'bg-surface-2 font-bold text-brand': selectedGameVersion === ver }"
								>
									<input 
										type="checkbox"
										:checked="selectedGameVersion === ver"
										class="accent-brand rounded cursor-pointer"
										@change="toggleVersion(ver)"
									/>
									<span>{{ ver }}</span>
									<span v-if="ver === props.instance.game_version" class="text-[10px] px-1.5 py-0.2 rounded bg-brand/20 text-brand font-semibold ml-auto">
										Current
									</span>
								</label>
							</div>
						</div>
					</div>
				</div>
			</template>
		</ContentCardLayout>
	</ReadyTransition>
</template>

<script setup lang="ts">
import { DownloadIcon, TrashIcon, GlobeIcon } from '@modrinth/assets'
import { ButtonStyled, EmptyState, ReadyTransition, ContentCardLayout, injectNotificationManager } from '@modrinth/ui'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ref, computed, onMounted } from 'vue'

import type { GameInstance } from '@/helpers/types'

const props = defineProps<{
	instance: GameInstance
}>()

interface BedrockAddon {
	uuid: string;
	name: string;
	description: string;
	version: string;
	folder_name: string;
	kind: string;
	is_enabled: boolean;
	icon_path?: string;
	has_update?: boolean;
	latest_version?: string;
}

const loading = ref(true)
const addons = ref<BedrockAddon[]>([])
const notifications = injectNotificationManager()

const searchQuery = ref('')
const isSearchingCF = ref(false)
const hasSearched = ref(false)
const cfResults = ref<any[]>([])
const isCheckingUpdates = ref(false)

// Filters State
const selectedClassId = ref<number | null>(4984) // Default: Addons (4984)
const selectedCategoryId = ref<number | null>(null)
// Default game version is pre-checked to the instance's game_version as requested!
const selectedGameVersion = ref<string | null>(props.instance.game_version || null)
const versionSearch = ref('')

// CurseForge Browse By Content Types
const browseByTypes = [
	{ id: null, label: 'All' },
	{ id: 4984, label: 'Addons' },
	{ id: 4985, label: 'Maps' },
	{ id: 4986, label: 'Texture Packs' },
	{ id: 4987, label: 'Scripts' },
	{ id: 4988, label: 'Skins' },
]

// CurseForge Categories by Class ID
const categoriesMap: Record<number, { id: number; label: string }[]> = {
	4984: [ // Addons
		{ id: 5191, label: 'Armor, Tools, And Weapons' },
		{ id: 5192, label: 'Cosmetics' },
		{ id: 5193, label: 'Data Packs' },
		{ id: 5194, label: 'Fantasy' },
		{ id: 5195, label: 'Food' },
		{ id: 5196, label: 'Horror' },
		{ id: 5197, label: 'Magic' },
		{ id: 5198, label: 'Maps' },
		{ id: 5199, label: 'Minecraft Addon Maker' },
		{ id: 5200, label: 'ModJam 2025' },
		{ id: 5201, label: 'Multiplayer' },
		{ id: 5202, label: 'Performance' },
		{ id: 5203, label: 'Roleplay' },
		{ id: 5204, label: 'Skins' },
		{ id: 5205, label: 'Survival' },
	],
	4985: [ // Maps
		{ id: 5206, label: 'Adventure' },
		{ id: 5207, label: 'Creation' },
		{ id: 5208, label: 'CTM' },
		{ id: 5209, label: 'Custom Terrain' },
		{ id: 5210, label: 'Minigame' },
		{ id: 5211, label: 'Parkour' },
		{ id: 5212, label: 'Puzzle' },
		{ id: 5213, label: 'PvP' },
		{ id: 5214, label: 'Redstone' },
		{ id: 5215, label: 'Rollercoaster' },
		{ id: 5216, label: 'Survival' },
	],
	4986: [ // Texture Packs
		{ id: 5217, label: 'GUI' },
		{ id: 5218, label: 'Miscellaneous' },
		{ id: 5219, label: 'ModJam 2025' },
		{ id: 5220, label: 'PvP' },
		{ id: 5221, label: 'Realistic' },
		{ id: 5222, label: 'Shaders' },
		{ id: 5223, label: 'Simplistic' },
		{ id: 5224, label: 'Themed' },
		{ id: 5225, label: 'X128' },
		{ id: 5226, label: 'X16' },
		{ id: 5227, label: 'X32' },
		{ id: 5228, label: 'X64' },
	],
	4987: [ // Scripts
		{ id: 5229, label: 'Utility' },
		{ id: 5230, label: 'Miscellaneous' },
	],
	4988: [ // Skins
		{ id: 5231, label: 'Anime' },
		{ id: 5232, label: 'Fantasy' },
		{ id: 5233, label: 'Games' },
		{ id: 5234, label: 'TV & Movies' },
		{ id: 5235, label: 'Miscellaneous' },
	]
}

const availableCategories = computed(() => {
	if (!selectedClassId.value || !categoriesMap[selectedClassId.value]) {
		// Return combined unique categories if 'All' is selected
		const allCats: { id: number; label: string }[] = []
		Object.values(categoriesMap).forEach(cats => {
			cats.forEach(c => {
				if (!allCats.some(x => x.id === c.id)) allCats.push(c)
			})
		})
		return allCats
	}
	return categoriesMap[selectedClassId.value]
})

const gameVersionsList = [
	'1.21.132', '1.21.131', '1.21.130', '1.21.124', '1.21.123', '1.21.122', '1.21.121', '1.21.120',
	'1.21.114', '1.21.60', '1.21.50', '1.21.40', '1.21.30', '1.21.20', '1.21.0',
	'1.20.80', '1.20.70', '1.20.60', '1.20.50', '1.20.40', '1.20.30', '1.20.10', '1.20.0'
]

// Dynamically include instance version in version list if missing
const allGameVersions = computed(() => {
	const list = [...gameVersionsList]
	if (props.instance.game_version && !list.includes(props.instance.game_version)) {
		list.unshift(props.instance.game_version)
	}
	return list
})

const filteredVersions = computed(() => {
	if (!versionSearch.value.trim()) return allGameVersions.value
	const q = versionSearch.value.toLowerCase()
	return allGameVersions.value.filter(v => v.toLowerCase().includes(q))
})

const activeFilterCount = computed(() => {
	let count = 0
	if (selectedClassId.value !== null) count++
	if (selectedCategoryId.value !== null) count++
	if (selectedGameVersion.value !== null) count++
	return count
})

function selectBrowseBy(classId: number | null) {
	selectedClassId.value = classId
	selectedCategoryId.value = null // reset category when browse by changes
	searchCurseForge()
}

function toggleCategory(catId: number) {
	if (selectedCategoryId.value === catId) {
		selectedCategoryId.value = null
	} else {
		selectedCategoryId.value = catId
	}
	searchCurseForge()
}

function toggleVersion(ver: string) {
	if (selectedGameVersion.value === ver) {
		selectedGameVersion.value = null
	} else {
		selectedGameVersion.value = ver
	}
	searchCurseForge()
}

function clearAllFilters() {
	selectedClassId.value = null
	selectedCategoryId.value = null
	selectedGameVersion.value = null
	searchCurseForge()
}

async function checkAddonUpdates() {
	isCheckingUpdates.value = true
	try {
		addons.value = await invoke('plugin:bedrock-addons|check_bedrock_addon_updates', {
			profilePath: props.instance.path
		})
		notifications.addNotification({
			type: 'info',
			title: 'Update check finished',
			text: 'Bedrock add-ons update status refreshed.'
		})
	} catch (e) {
		notifications.handleError(e as Error)
	} finally {
		isCheckingUpdates.value = false
	}
}

async function searchCurseForge() {
	isSearchingCF.value = true
	hasSearched.value = true
	try {
		cfResults.value = await invoke('plugin:bedrock-addons|search_bedrock_curseforge_addons', {
			query: searchQuery.value || '',
			categoryId: selectedCategoryId.value,
			classId: selectedClassId.value,
			gameVersion: selectedGameVersion.value
		})
	} catch (e) {
		notifications.handleError(e as Error)
	} finally {
		isSearchingCF.value = false
	}
}

function openCfUrl(slug: string) {
	openUrl(`https://www.curseforge.com/minecraft-bedrock/addons/${slug}`)
}

async function installCfMod(cfMod: any) {
	loading.value = true
	try {
		const files: any[] = await invoke('plugin:bedrock-addons|get_bedrock_curseforge_addon_files', { modId: cfMod.id })
		if (files.length === 0) throw new Error("No files found for this addon.")
		
		const file = files[0]
		if (!file.downloadUrl) throw new Error("No download URL provided by CurseForge API.")
		
		await invoke('plugin:bedrock-addons|download_and_install_bedrock_curseforge_addon', {
			profilePath: props.instance.path,
			downloadUrl: file.downloadUrl
		})
		
		notifications.addNotification({
			type: 'success',
			title: 'Add-on installed',
			text: `Successfully downloaded and installed ${cfMod.name}`
		})
		await fetchAddons()
	} catch (e) {
		notifications.handleError(e as Error)
	} finally {
		loading.value = false
	}
}

async function fetchAddons() {
	loading.value = true
	try {
		addons.value = await invoke('plugin:bedrock-addons|fetch_bedrock_addons', {
			profilePath: props.instance.path
		})
	} catch (e) {
		notifications.handleError(e as Error)
	} finally {
		loading.value = false
	}
}

async function toggleAddon(addon: BedrockAddon) {
	try {
		await invoke('plugin:bedrock-addons|set_bedrock_addon_enabled', {
			profilePath: props.instance.path,
			kind: addon.kind,
			folderName: addon.folder_name,
			enable: !addon.is_enabled
		})
		await fetchAddons()
	} catch (e) {
		notifications.handleError(e as Error)
	}
}

async function deleteAddon(addon: BedrockAddon) {
	try {
		await invoke('plugin:bedrock-addons|delete_bedrock_addon', {
			profilePath: props.instance.path,
			kind: addon.kind,
			folderName: addon.folder_name
		})
		await fetchAddons()
	} catch (e) {
		notifications.handleError(e as Error)
	}
}

async function installFromFile() {
	const selected = await open({
		multiple: true,
		filters: [{
			name: 'Bedrock Add-ons',
			extensions: ['mcpack', 'mcaddon', 'zip']
		}]
	})
	
	if (selected) {
		const files: string[] = []
		if (Array.isArray(selected)) {
			for (const item of selected) {
				if (typeof item === 'string') files.push(item)
				else if (item && typeof item === 'object' && 'path' in item) files.push((item as any).path)
			}
		} else if (typeof selected === 'string') {
			files.push(selected)
		} else if (selected && typeof selected === 'object' && 'path' in selected) {
			files.push((selected as any).path)
		}
		
		if (files.length > 0) {
			loading.value = true
			try {
				for (const pathStr of files) {
					await invoke('plugin:bedrock-addons|install_bedrock_addon_from_file', {
						profilePath: props.instance.path,
						archivePath: pathStr
					})
				}
				notifications.addNotification({
					type: 'success',
					title: 'Add-ons installed successfully',
					text: `Successfully installed ${files.length} Bedrock Add-on(s).`
				})
				await fetchAddons()
			} catch (e) {
				notifications.handleError(e as Error)
			} finally {
				loading.value = false
			}
		}
	}
}

onMounted(() => {
	fetchAddons()
	searchCurseForge()
})
</script>
