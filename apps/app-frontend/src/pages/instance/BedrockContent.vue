<template>
	<ReadyTransition :pending="loading">
		<ContentCardLayout>
			<template #empty>
				<EmptyState
					v-if="addons.length === 0"
					icon="boxes"
					title="Аддоны не установлены"
					description="Добавляйте наборы ресурсов и поведения для кастомизации Minecraft Bedrock."
				>
					<ButtonStyled color="brand" @click="installFromFile">
						<template #icon><DownloadIcon /></template>
						Установить аддон (.mcpack / .mcaddon)
					</ButtonStyled>
				</EmptyState>
			</template>
			<template #default>
				<div class="flex items-center justify-between mb-4">
					<h2 class="text-xl font-bold">Контент и Аддоны Bedrock</h2>
					<div class="flex gap-2">
						<ButtonStyled color="brand-outline" @click="checkAddonUpdates" :disabled="isCheckingUpdates">
							{{ isCheckingUpdates ? 'Проверка...' : 'Проверить обновления' }}
						</ButtonStyled>
						<ButtonStyled color="brand" @click="installFromFile">
							<template #icon><DownloadIcon /></template>
							Установить из файла
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
									<GlobeIcon class="w-5 h-5 text-brand" /> Найти на CurseForge
								</h3>
								<span v-if="activeFilterCount > 0" class="text-xs px-2 py-0.5 rounded-full bg-brand/20 text-brand font-semibold">
									Активно фильтров: {{ activeFilterCount }}
								</span>
							</div>

							<div class="flex gap-2">
								<input
									v-model="searchQuery"
									type="text"
									placeholder="Поиск аддонов, текстур-паков, карт, скинов..."
									class="flex-1 bg-surface-base px-3 py-2 rounded-lg outline-none border border-surface-2 placeholder:text-contrast focus:border-brand text-sm"
									@keydown.enter="searchCurseForge"
								/>
								<ButtonStyled color="brand" @click="searchCurseForge" :disabled="isSearchingCF">
									{{ isSearchingCF ? 'Поиск...' : 'Искать' }}
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
											<span class="text-xs text-contrast line-clamp-1">{{ cfMod.summary || 'Нет описания' }}</span>
										</div>
									</div>
									<ButtonStyled size="small" color="brand" @click="installCfMod(cfMod)">
										Установить
									</ButtonStyled>
								</div>
							</div>
							<div v-else-if="hasSearched && !isSearchingCF" class="text-xs text-contrast text-center py-3">
								Ничего не найдено по текущему запросу и фильтрам.
							</div>
						</div>

						<!-- Installed Add-ons List -->
						<div class="flex flex-col gap-3">
							<h3 class="font-bold text-lg">Установленные аддоны ({{ addons.length }})</h3>
							<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div 
									v-for="addon in addons" 
									:key="addon.uuid" 
									class="bg-surface-1 rounded-xl p-4 border border-surface-2 flex flex-col gap-2 relative shadow-sm transition-all hover:shadow-md hover:border-brand/40 cursor-pointer"
									:class="{'opacity-50 grayscale': !addon.is_enabled}"
									@click="selectedAddonDetail = addon"
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
										{{ addon.description || 'Описание отсутствует.' }}
									</p>
									
									<div class="mt-auto pt-2 flex items-center justify-between border-t border-surface-2">
										<span class="text-[11px] font-semibold uppercase tracking-wider" :class="addon.kind === 'resource' ? 'text-blue-400' : 'text-purple-400'">
											пакет {{ addon.kind === 'resource' ? 'ресурсов' : 'поведения' }}
										</span>
										
										<div class="flex gap-2 isolate" @click.stop>
											<ButtonStyled 
												size="small" 
												:color="addon.is_enabled ? 'surface' : 'brand'"
												@click.stop="toggleAddon(addon)"
											>
												{{ addon.is_enabled ? 'Отключить' : 'Включить' }}
											</ButtonStyled>
											<ButtonStyled 
												size="small" 
												color="red"
												type="transparent"
												@click.stop="deleteAddon(addon)"
												title="Удалить аддон"
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
								Фильтры
								<span v-if="activeFilterCount > 0" class="w-5 h-5 rounded-full bg-brand text-brand-contrast text-xs flex items-center justify-center font-bold">
									{{ activeFilterCount }}
								</span>
							</h3>
							<button 
								class="text-xs text-contrast hover:text-brand underline font-medium transition-colors"
								@click="clearAllFilters"
							>
								Сбросить
							</button>
						</div>

						<!-- Browse by Section -->
						<div class="flex flex-col gap-2">
							<div class="font-bold text-xs uppercase tracking-wider text-contrast flex items-center justify-between">
								<span>Тип контента</span>
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
								<span>Категории</span>
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
								<span>Версия Minecraft</span>
							</div>
							<input
								v-model="versionSearch"
								type="text"
								placeholder="Поиск версии..."
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
										Текущая
									</span>
								</label>
							</div>
						</div>
					</div>
				</div>
			</template>
		</ContentCardLayout>
	</ReadyTransition>

	<!-- Installed Add-on Detail Modal -->
	<div 
		v-if="selectedAddonDetail" 
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fade-in"
		@click.self="selectedAddonDetail = null"
	>
		<div class="bg-surface-1 border border-surface-3 rounded-2xl p-6 max-w-lg w-full shadow-2xl flex flex-col gap-5 relative overflow-hidden">
			<!-- Header -->
			<div class="flex items-start gap-4 border-b border-surface-2 pb-4">
				<div class="w-16 h-16 rounded-xl bg-surface-2 overflow-hidden flex-shrink-0 flex items-center justify-center border border-surface-3 shadow-inner">
					<img 
						v-if="selectedAddonDetail.icon_path" 
						:src="convertFileSrc(selectedAddonDetail.icon_path)" 
						:alt="selectedAddonDetail.name"
						class="w-full h-full object-cover"
					/>
					<div v-else class="text-xl font-black text-contrast uppercase">
						{{ selectedAddonDetail.kind[0] }}
					</div>
				</div>
				
				<div class="flex-1 min-w-0">
					<h3 class="font-extrabold text-xl truncate text-foreground">
						{{ selectedAddonDetail.name }}
					</h3>
					<div class="flex items-center gap-2 mt-1.5 flex-wrap">
						<span class="text-xs font-mono bg-surface-2 px-2.5 py-0.5 rounded-full font-semibold border border-surface-3">
							v{{ selectedAddonDetail.version }}
						</span>
						<span 
							class="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full"
							:class="selectedAddonDetail.kind === 'resource' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'"
						>
							пакет {{ selectedAddonDetail.kind === 'resource' ? 'ресурсов' : 'поведения' }}
						</span>
						<span 
							class="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full"
							:class="selectedAddonDetail.is_enabled ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'"
						>
							{{ selectedAddonDetail.is_enabled ? 'Активен' : 'Отключен' }}
						</span>
					</div>
				</div>
				
				<button 
					class="text-contrast hover:text-foreground text-lg font-bold p-1 transition-colors"
					@click="selectedAddonDetail = null"
				>
					✕
				</button>
			</div>

			<!-- Details Content -->
			<div class="flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-1">
				<div>
					<h4 class="text-xs uppercase font-bold text-contrast tracking-wider mb-1">Описание</h4>
					<p class="text-sm text-contrast leading-relaxed whitespace-pre-wrap bg-surface-2/50 p-3 rounded-xl border border-surface-2">
						{{ selectedAddonDetail.description || 'Для данного пакета описание не указано.' }}
					</p>
				</div>

				<div class="grid grid-cols-2 gap-3 text-xs bg-surface-2/30 p-3 rounded-xl border border-surface-2">
					<div>
						<span class="text-contrast block font-medium">Имя папки</span>
						<span class="font-mono text-foreground font-semibold truncate block" :title="selectedAddonDetail.folder_name">
							{{ selectedAddonDetail.folder_name }}
						</span>
					</div>
					<div>
						<span class="text-contrast block font-medium">UUID</span>
						<span class="font-mono text-foreground font-semibold truncate block" :title="selectedAddonDetail.uuid">
							{{ selectedAddonDetail.uuid }}
						</span>
					</div>
				</div>
			</div>

			<!-- Footer Actions -->
			<div class="flex items-center justify-between border-t border-surface-2 pt-4 mt-1">
				<ButtonStyled 
					color="red"
					type="transparent"
					@click="deleteAddon(selectedAddonDetail); selectedAddonDetail = null"
				>
					<TrashIcon class="w-4 h-4 mr-1.5" />
					Удалить аддон
				</ButtonStyled>

				<div class="flex items-center gap-2">
					<ButtonStyled 
						:color="selectedAddonDetail.is_enabled ? 'surface' : 'brand'"
						@click="toggleAddon(selectedAddonDetail)"
					>
						{{ selectedAddonDetail.is_enabled ? 'Отключить' : 'Включить' }}
					</ButtonStyled>
					<ButtonStyled 
						color="surface"
						@click="selectedAddonDetail = null"
					>
						Закрыть
					</ButtonStyled>
				</div>
			</div>
		</div>
	</div>
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

const selectedAddonDetail = ref<BedrockAddon | null>(null)

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
// Default game version is null for broad compatibility, selectable in sidebar
const selectedGameVersion = ref<string | null>(null)
const versionSearch = ref('')

// CurseForge Browse By Content Types
const browseByTypes = [
	{ id: null, label: 'Все' },
	{ id: 4984, label: 'Аддоны' },
	{ id: 6913, label: 'Карты' },
	{ id: 6929, label: 'Текстур-паки' },
	{ id: 6940, label: 'Скрипты' },
	{ id: 6925, label: 'Скины' },
]

// CurseForge Categories by Class ID
const categoriesMap: Record<number, { id: number; label: string }[]> = {
	4984: [ // Addons
		{ id: 8834, label: 'Оружие и броня' },
		{ id: 8825, label: 'Косметика' },
		{ id: 4992, label: 'Дата-паки' },
		{ id: 8828, label: 'Фэнтези' },
		{ id: 8836, label: 'Еда' },
		{ id: 8833, label: 'Хоррор' },
		{ id: 8829, label: 'Магия' },
		{ id: 4986, label: 'Карты' },
		{ id: 4991, label: 'Мобы' },
		{ id: 8835, label: 'Мультиплеер' },
		{ id: 8837, label: 'Производительность' },
		{ id: 4990, label: 'Игроки' },
		{ id: 4993, label: 'PvP' },
		{ id: 4994, label: 'Реализм' },
		{ id: 8827, label: 'РП (Roleplay)' },
		{ id: 4995, label: 'Простые' },
		{ id: 4989, label: 'Скины' },
		{ id: 8831, label: 'Выживание' },
		{ id: 8826, label: 'Технологии' },
		{ id: 4987, label: 'Текстуры' },
		{ id: 4997, label: 'Тематические' },
		{ id: 8832, label: 'Утилиты' },
		{ id: 8830, label: 'Ванилла+' },
	],
	6913: [ // Maps
		{ id: 6914, label: 'Приключения' },
		{ id: 6915, label: 'Строительство' },
		{ id: 6916, label: 'CTM' },
		{ id: 6917, label: 'Свой ландшафт' },
		{ id: 6918, label: 'Мини-игры' },
		{ id: 6919, label: 'Паркур' },
		{ id: 6920, label: 'Головоломки' },
		{ id: 6921, label: 'PvP' },
		{ id: 6922, label: 'Редстоун' },
		{ id: 6923, label: 'Американские горки' },
		{ id: 6924, label: 'Выживание' },
	],
	6929: [ // Texture Packs
		{ id: 10747, label: 'Интерфейс (GUI)' },
		{ id: 6930, label: 'Разное' },
		{ id: 6931, label: 'PvP' },
		{ id: 6932, label: 'Реализм' },
		{ id: 6939, label: 'Шейдеры' },
		{ id: 6933, label: 'Простые' },
		{ id: 6934, label: 'Тематические' },
		{ id: 6935, label: '16x' },
		{ id: 6936, label: '32x' },
		{ id: 6937, label: '64x' },
		{ id: 6938, label: '128x' },
	],
	6940: [ // Scripts
		{ id: 6941, label: 'Скрипты' },
		{ id: 8824, label: 'Утилиты' },
	],
	6925: [ // Skins
		{ id: 6928, label: 'Наборы скинов' },
		{ id: 6927, label: 'Скины игроков' },
		{ id: 6926, label: 'Скины мобов' },
	],
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

const curseForgeVersions = ref<string[]>([])

const gameVersionsList = [
	'1.21.132', '1.21.131', '1.21.130', '1.21.124', '1.21.123', '1.21.122', '1.21.121', '1.21.120',
	'1.21.60', '1.21.50', '1.21.40', '1.21.30', '1.21.20', '1.21.0',
	'1.20.80', '1.20.70', '1.20.60', '1.20.50', '1.20.40', '1.20.30', '1.20.10', '1.20.0'
]

// Dynamically include CurseForge versions & instance version
const allGameVersions = computed(() => {
	const set = new Set<string>()
	if (props.instance.game_version) {
		set.add(props.instance.game_version)
	}
	for (const v of curseForgeVersions.value) {
		set.add(v)
	}
	for (const v of gameVersionsList) {
		set.add(v)
	}
	return Array.from(set)
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
		const res: any = await invoke('plugin:bedrock-addons|search_bedrock_curseforge_addons', {
			query: searchQuery.value || '',
			categoryId: selectedCategoryId.value,
			classId: selectedClassId.value,
			gameVersion: selectedGameVersion.value
		})
		cfResults.value = res?.data || (Array.isArray(res) ? res : [])
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

onMounted(async () => {
	fetchAddons()
	searchCurseForge()
	try {
		const versions: string[] = await invoke('plugin:bedrock-addons|get_curseforge_minecraft_versions')
		if (versions && versions.length > 0) {
			curseForgeVersions.value = versions
		}
	} catch (e) {
		console.warn('Failed to load CurseForge versions', e)
	}
})
</script>
