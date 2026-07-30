<template>
	<ReadyTransition :pending="loading">
		<ContentCardLayout>
			<template #empty>
				<EmptyState
					v-if="addons.length === 0"
					icon="boxes"
					:title="formatMessage(messages.noAddonsInstalled)"
					:description="formatMessage(messages.noAddonsDesc)"
				>
					<ButtonStyled color="brand" @click="installFromFile">
						<template #icon><DownloadIcon /></template>
						{{ formatMessage(messages.installAddonBtn) }}
					</ButtonStyled>
				</EmptyState>
			</template>
			<template #default>
				<div class="flex items-center justify-between mb-4">
					<h2 class="text-xl font-bold">{{ formatMessage(messages.bedrockTitle) }}</h2>
					<div class="flex gap-2">
						<ButtonStyled color="brand-outline" @click="checkAddonUpdates" :disabled="isCheckingUpdates">
							{{ isCheckingUpdates ? formatMessage(messages.checking) : formatMessage(messages.checkForUpdates) }}
						</ButtonStyled>
						<ButtonStyled color="brand" @click="installFromFile">
							<template #icon><DownloadIcon /></template>
							{{ formatMessage(messages.installFromFile) }}
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
									<GlobeIcon class="w-5 h-5 text-brand" /> {{ formatMessage(messages.discoverCurseForge) }}
								</h3>
								<span v-if="activeFilterCount > 0" class="text-xs px-2 py-0.5 rounded-full bg-brand/20 text-brand font-semibold">
									{{ formatMessage(messages.activeFilters, { count: activeFilterCount }) }}
								</span>
							</div>

							<div class="flex gap-2">
								<input
									v-model="searchQuery"
									type="text"
									:placeholder="formatMessage(messages.searchPlaceholder)"
									class="flex-1 bg-surface-base px-3 py-2 rounded-lg outline-none border border-surface-2 placeholder:text-contrast focus:border-brand text-sm"
									@keydown.enter="searchCurseForge"
								/>
								<ButtonStyled color="brand" @click="searchCurseForge" :disabled="isSearchingCF">
									{{ isSearchingCF ? formatMessage(messages.searching) : formatMessage(messages.searchBtn) }}
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
											<span class="text-xs text-contrast line-clamp-1">{{ cfMod.summary || formatMessage(messages.noDescription) }}</span>
										</div>
									</div>
									<ButtonStyled size="small" color="brand" @click="installCfMod(cfMod)">
										{{ formatMessage(messages.installBtn) }}
									</ButtonStyled>
								</div>
							</div>
							<div v-else-if="hasSearched && !isSearchingCF" class="text-xs text-contrast text-center py-3">
								{{ formatMessage(messages.noContentFound) }}
							</div>
						</div>

						<!-- Installed Add-ons List -->
						<div class="flex flex-col gap-3">
							<h3 class="font-bold text-lg">{{ formatMessage(messages.installedAddons, { count: addons.length }) }}</h3>
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
										{{ addon.description || formatMessage(messages.noDescProvided) }}
									</p>
									
									<div class="mt-auto pt-2 flex items-center justify-between border-t border-surface-2">
										<span class="text-[11px] font-semibold uppercase tracking-wider" :class="addon.kind === 'resource' ? 'text-blue-400' : 'text-purple-400'">
											{{ addon.kind === 'resource' ? formatMessage(messages.resourcePack) : formatMessage(messages.behaviorPack) }}
										</span>
										
										<div class="flex gap-2 isolate" @click.stop>
											<ButtonStyled 
												size="small" 
												:color="addon.is_enabled ? 'surface' : 'brand'"
												@click.stop="toggleAddon(addon)"
											>
												{{ addon.is_enabled ? formatMessage(messages.disableBtn) : formatMessage(messages.enableBtn) }}
											</ButtonStyled>
											<ButtonStyled 
												size="small" 
												color="red"
												type="transparent"
												@click.stop="deleteAddon(addon)"
												:title="formatMessage(messages.deleteAddonTitle)"
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
								{{ formatMessage(messages.filtersHeader) }}
								<span v-if="activeFilterCount > 0" class="w-5 h-5 rounded-full bg-brand text-brand-contrast text-xs flex items-center justify-center font-bold">
									{{ activeFilterCount }}
								</span>
							</h3>
							<button 
								class="text-xs text-contrast hover:text-brand underline font-medium transition-colors"
								@click="clearAllFilters"
							>
								{{ formatMessage(messages.clearAll) }}
							</button>
						</div>

						<!-- Browse by Section -->
						<div class="flex flex-col gap-2">
							<div class="font-bold text-xs uppercase tracking-wider text-contrast flex items-center justify-between">
								<span>{{ formatMessage(messages.contentType) }}</span>
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
								<span>{{ formatMessage(messages.categories) }}</span>
							</div>
							<div class="flex flex-col gap-1 max-h-[220px] overflow-y-auto pr-1">
								<div 
									v-for="cat in availableCategories" 
									:key="cat.id"
									class="flex items-center gap-2 text-xs cursor-pointer py-1 px-2 rounded-lg transition-colors hover:bg-surface-2 select-none"
									:class="{ 'bg-surface-2 font-semibold text-brand': selectedCategoryId === cat.id }"
									@click="toggleCategory(cat.id)"
								>
									<input 
										type="checkbox"
										:checked="selectedCategoryId === cat.id"
										class="accent-brand rounded cursor-pointer pointer-events-none"
									/>
									<component :is="cat.icon" v-if="cat.icon" class="h-4 w-4 shrink-0 text-secondary" />
									<span class="truncate">{{ cat.label }}</span>
								</div>
							</div>
						</div>

						<!-- Game Version Section -->
						<div class="flex flex-col gap-2 border-t border-surface-2 pt-4">
							<div class="font-bold text-xs uppercase tracking-wider text-contrast flex items-center justify-between">
								<span>{{ formatMessage(messages.gameVersion) }}</span>
							</div>
							<input
								v-model="versionSearch"
								type="text"
								:placeholder="formatMessage(messages.searchVersions)"
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
										{{ formatMessage(messages.currentVersion) }}
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
							{{ selectedAddonDetail.kind === 'resource' ? formatMessage(messages.resourcePack) : formatMessage(messages.behaviorPack) }}
						</span>
						<span 
							class="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full"
							:class="selectedAddonDetail.is_enabled ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'"
						>
							{{ selectedAddonDetail.is_enabled ? formatMessage(messages.activeStatus) : formatMessage(messages.disabledStatus) }}
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
					<h4 class="text-xs uppercase font-bold text-contrast tracking-wider mb-1">{{ formatMessage(messages.descriptionLabel) }}</h4>
					<p class="text-sm text-contrast leading-relaxed whitespace-pre-wrap bg-surface-2/50 p-3 rounded-xl border border-surface-2">
						{{ selectedAddonDetail.description || formatMessage(messages.noDescProvided) }}
					</p>
				</div>

				<div class="grid grid-cols-2 gap-3 text-xs bg-surface-2/30 p-3 rounded-xl border border-surface-2">
					<div>
						<span class="text-contrast block font-medium">{{ formatMessage(messages.folderNameLabel) }}</span>
						<span class="font-mono text-foreground font-semibold truncate block" :title="selectedAddonDetail.folder_name">
							{{ selectedAddonDetail.folder_name }}
						</span>
					</div>
					<div>
						<span class="text-contrast block font-medium">{{ formatMessage(messages.uuidLabel) }}</span>
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
					{{ formatMessage(messages.deleteAddonTitle) }}
				</ButtonStyled>

				<div class="flex items-center gap-2">
					<ButtonStyled 
						:color="selectedAddonDetail.is_enabled ? 'surface' : 'brand'"
						@click="toggleAddon(selectedAddonDetail)"
					>
						{{ selectedAddonDetail.is_enabled ? formatMessage(messages.disableBtn) : formatMessage(messages.enableBtn) }}
					</ButtonStyled>
					<ButtonStyled 
						color="surface"
						@click="selectedAddonDetail = null"
					>
						{{ formatMessage(messages.closeBtn) }}
					</ButtonStyled>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { DownloadIcon, TrashIcon, GlobeIcon, getCategoryIcon } from '@modrinth/assets'
import { ButtonStyled, EmptyState, ReadyTransition, ContentCardLayout, injectNotificationManager, defineMessages, useVIntl } from '@modrinth/ui'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ref, computed, onMounted } from 'vue'

import type { GameInstance } from '@/helpers/types'

const props = defineProps<{
	instance: GameInstance
}>()

const { formatMessage } = useVIntl()

const messages = defineMessages({
	noAddonsInstalled: {
		id: 'app.bedrock.no-addons-installed',
		defaultMessage: 'No Add-ons installed',
	},
	noAddonsDesc: {
		id: 'app.bedrock.no-addons-desc',
		defaultMessage: 'Add behavioral or resource packs to customize your Bedrock experience.',
	},
	installAddonBtn: {
		id: 'app.bedrock.install-addon-btn',
		defaultMessage: 'Install Add-on (.mcpack / .mcaddon)',
	},
	bedrockTitle: {
		id: 'app.bedrock.title',
		defaultMessage: 'Bedrock Add-ons & Content',
	},
	checking: {
		id: 'app.bedrock.checking',
		defaultMessage: 'Checking...',
	},
	checkForUpdates: {
		id: 'app.bedrock.check-for-updates',
		defaultMessage: 'Check for Updates',
	},
	installFromFile: {
		id: 'app.bedrock.install-from-file',
		defaultMessage: 'Install from File',
	},
	discoverCurseForge: {
		id: 'app.bedrock.discover-curseforge',
		defaultMessage: 'Discover on CurseForge',
	},
	activeFilters: {
		id: 'app.bedrock.active-filters',
		defaultMessage: '{count, plural, one {# filter active} other {# filters active}}',
	},
	searchPlaceholder: {
		id: 'app.bedrock.search-placeholder',
		defaultMessage: 'Search behavior packs, resource packs, maps, skins...',
	},
	searching: {
		id: 'app.bedrock.searching',
		defaultMessage: 'Searching...',
	},
	searchBtn: {
		id: 'app.bedrock.search-btn',
		defaultMessage: 'Search',
	},
	noDescription: {
		id: 'app.bedrock.no-description',
		defaultMessage: 'No description',
	},
	installBtn: {
		id: 'app.bedrock.install-btn',
		defaultMessage: 'Install',
	},
	noContentFound: {
		id: 'app.bedrock.no-content-found',
		defaultMessage: 'No content found matching current search and filters.',
	},
	installedAddons: {
		id: 'app.bedrock.installed-addons',
		defaultMessage: 'Installed Add-ons ({count})',
	},
	noDescProvided: {
		id: 'app.bedrock.no-desc-provided',
		defaultMessage: 'No description provided.',
	},
	resourcePack: {
		id: 'app.bedrock.resource-pack',
		defaultMessage: 'resource pack',
	},
	behaviorPack: {
		id: 'app.bedrock.behavior-pack',
		defaultMessage: 'behavior pack',
	},
	disableBtn: {
		id: 'app.bedrock.disable-btn',
		defaultMessage: 'Disable',
	},
	enableBtn: {
		id: 'app.bedrock.enable-btn',
		defaultMessage: 'Enable',
	},
	deleteAddonTitle: {
		id: 'app.bedrock.delete-addon-title',
		defaultMessage: 'Delete Add-on',
	},
	filtersHeader: {
		id: 'app.bedrock.filters-header',
		defaultMessage: 'Filters',
	},
	clearAll: {
		id: 'app.bedrock.clear-all',
		defaultMessage: 'Clear all',
	},
	contentType: {
		id: 'app.bedrock.content-type',
		defaultMessage: 'Content Type',
	},
	categories: {
		id: 'app.bedrock.categories',
		defaultMessage: 'Categories',
	},
	gameVersion: {
		id: 'app.bedrock.game-version',
		defaultMessage: 'Minecraft Version',
	},
	searchVersions: {
		id: 'app.bedrock.search-versions',
		defaultMessage: 'Search versions...',
	},
	currentVersion: {
		id: 'app.bedrock.current-version',
		defaultMessage: 'Current',
	},
	activeStatus: {
		id: 'app.bedrock.active-status',
		defaultMessage: 'Active',
	},
	disabledStatus: {
		id: 'app.bedrock.disabled-status',
		defaultMessage: 'Disabled',
	},
	descriptionLabel: {
		id: 'app.bedrock.description-label',
		defaultMessage: 'Description',
	},
	folderNameLabel: {
		id: 'app.bedrock.folder-name-label',
		defaultMessage: 'Folder Name',
	},
	uuidLabel: {
		id: 'app.bedrock.uuid-label',
		defaultMessage: 'UUID',
	},
	closeBtn: {
		id: 'app.bedrock.close-btn',
		defaultMessage: 'Close',
	},
	typeAll: {
		id: 'app.bedrock.type-all',
		defaultMessage: 'All',
	},
	typeAddons: {
		id: 'app.bedrock.type-addons',
		defaultMessage: 'Addons',
	},
	typeMaps: {
		id: 'app.bedrock.type-maps',
		defaultMessage: 'Maps',
	},
	typeTexturePacks: {
		id: 'app.bedrock.type-texture-packs',
		defaultMessage: 'Texture Packs',
	},
	typeScripts: {
		id: 'app.bedrock.type-scripts',
		defaultMessage: 'Scripts',
	},
	typeSkins: {
		id: 'app.bedrock.type-skins',
		defaultMessage: 'Skins',
	},
	catWeaponsArmor: { id: 'app.bedrock.category.weapons-armor', defaultMessage: 'Armor, Tools & Weapons' },
	catCosmetics: { id: 'app.bedrock.category.cosmetics', defaultMessage: 'Cosmetics' },
	catDataPacks: { id: 'app.bedrock.category.data-packs', defaultMessage: 'Data Packs' },
	catFantasy: { id: 'app.bedrock.category.fantasy', defaultMessage: 'Fantasy' },
	catFood: { id: 'app.bedrock.category.food', defaultMessage: 'Food' },
	catHorror: { id: 'app.bedrock.category.horror', defaultMessage: 'Horror' },
	catMagic: { id: 'app.bedrock.category.magic', defaultMessage: 'Magic' },
	catMaps: { id: 'app.bedrock.category.maps', defaultMessage: 'Maps' },
	catMobs: { id: 'app.bedrock.category.mobs', defaultMessage: 'Mobs' },
	catMultiplayer: { id: 'app.bedrock.category.multiplayer', defaultMessage: 'Multiplayer' },
	catPerformance: { id: 'app.bedrock.category.performance', defaultMessage: 'Performance' },
	catPlayers: { id: 'app.bedrock.category.players', defaultMessage: 'Players' },
	catPvp: { id: 'app.bedrock.category.pvp', defaultMessage: 'PvP' },
	catRealistic: { id: 'app.bedrock.category.realistic', defaultMessage: 'Realistic' },
	catRoleplay: { id: 'app.bedrock.category.roleplay', defaultMessage: 'Roleplay' },
	catSimplistic: { id: 'app.bedrock.category.simplistic', defaultMessage: 'Simplistic' },
	catSkins: { id: 'app.bedrock.category.skins', defaultMessage: 'Skins' },
	catSurvival: { id: 'app.bedrock.category.survival', defaultMessage: 'Survival' },
	catTechnology: { id: 'app.bedrock.category.technology', defaultMessage: 'Technology' },
	catTextures: { id: 'app.bedrock.category.textures', defaultMessage: 'Textures' },
	catThemed: { id: 'app.bedrock.category.themed', defaultMessage: 'Themed' },
	catUtility: { id: 'app.bedrock.category.utility', defaultMessage: 'Utility' },
	catVanillaPlus: { id: 'app.bedrock.category.vanilla-plus', defaultMessage: 'Vanilla+' },
	catAdventure: { id: 'app.bedrock.category.adventure', defaultMessage: 'Adventure' },
	catBuilding: { id: 'app.bedrock.category.building', defaultMessage: 'Building' },
	catCtm: { id: 'app.bedrock.category.ctm', defaultMessage: 'CTM' },
	catCustomTerrain: { id: 'app.bedrock.category.custom-terrain', defaultMessage: 'Custom Terrain' },
	catMinigame: { id: 'app.bedrock.category.minigame', defaultMessage: 'Minigame' },
	catParkour: { id: 'app.bedrock.category.parkour', defaultMessage: 'Parkour' },
	catPuzzle: { id: 'app.bedrock.category.puzzle', defaultMessage: 'Puzzle' },
	catRedstone: { id: 'app.bedrock.category.redstone', defaultMessage: 'Redstone' },
	catRollerCoaster: { id: 'app.bedrock.category.roller-coaster', defaultMessage: 'Roller Coaster' },
	catGui: { id: 'app.bedrock.category.gui', defaultMessage: 'GUI' },
	catMiscellaneous: { id: 'app.bedrock.category.miscellaneous', defaultMessage: 'Miscellaneous' },
	catShaders: { id: 'app.bedrock.category.shaders', defaultMessage: 'Shaders' },
	cat16x: { id: 'app.bedrock.category.16x', defaultMessage: '16x' },
	cat32x: { id: 'app.bedrock.category.32x', defaultMessage: '32x' },
	cat64x: { id: 'app.bedrock.category.64x', defaultMessage: '64x' },
	cat128x: { id: 'app.bedrock.category.128x', defaultMessage: '128x' },
	catScripts: { id: 'app.bedrock.category.scripts', defaultMessage: 'Scripts' },
	catSkinPacks: { id: 'app.bedrock.category.skin-packs', defaultMessage: 'Skin Packs' },
	catPlayerSkins: { id: 'app.bedrock.category.player-skins', defaultMessage: 'Player Skins' },
	catMobSkins: { id: 'app.bedrock.category.mob-skins', defaultMessage: 'Mob Skins' },
})

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
const browseByTypes = computed(() => [
	{ id: null, label: formatMessage(messages.typeAll) },
	{ id: 4984, label: formatMessage(messages.typeAddons) },
	{ id: 6913, label: formatMessage(messages.typeMaps) },
	{ id: 6929, label: formatMessage(messages.typeTexturePacks) },
	{ id: 6940, label: formatMessage(messages.typeScripts) },
	{ id: 6925, label: formatMessage(messages.typeSkins) },
])

// CurseForge Categories by Class ID
const categoriesMap = computed<Record<number, { id: number; label: string; icon?: unknown }[]>>(() => ({
	4984: [ // Addons
		{ id: 8834, label: formatMessage(messages.catWeaponsArmor), icon: getCategoryIcon('swords') },
		{ id: 8825, label: formatMessage(messages.catCosmetics), icon: getCategoryIcon('palette') },
		{ id: 4992, label: formatMessage(messages.catDataPacks), icon: getCategoryIcon('library') },
		{ id: 8828, label: formatMessage(messages.catFantasy), icon: getCategoryIcon('fantasy') },
		{ id: 8836, label: formatMessage(messages.catFood), icon: getCategoryIcon('food') },
		{ id: 8833, label: formatMessage(messages.catHorror), icon: getCategoryIcon('skull') },
		{ id: 8829, label: formatMessage(messages.catMagic), icon: getCategoryIcon('magic') },
		{ id: 4991, label: formatMessage(messages.catMobs), icon: getCategoryIcon('mobs') },
		{ id: 8835, label: formatMessage(messages.catMultiplayer), icon: getCategoryIcon('multiplayer') },
		{ id: 8837, label: formatMessage(messages.catPerformance), icon: getCategoryIcon('optimization') },
		{ id: 4990, label: formatMessage(messages.catPlayers), icon: getCategoryIcon('users') },
		{ id: 4993, label: formatMessage(messages.catPvp), icon: getCategoryIcon('sword') },
		{ id: 4994, label: formatMessage(messages.catRealistic), icon: getCategoryIcon('realistic') },
		{ id: 8827, label: formatMessage(messages.catRoleplay), icon: getCategoryIcon('theater') },
		{ id: 4995, label: formatMessage(messages.catSimplistic), icon: getCategoryIcon('simplistic') },
		{ id: 8831, label: formatMessage(messages.catSurvival), icon: getCategoryIcon('shield') },
		{ id: 8826, label: formatMessage(messages.catTechnology), icon: getCategoryIcon('technology') },
		{ id: 4997, label: formatMessage(messages.catThemed), icon: getCategoryIcon('themed') },
		{ id: 8832, label: formatMessage(messages.catUtility), icon: getCategoryIcon('utility') },
		{ id: 8830, label: formatMessage(messages.catVanillaPlus), icon: getCategoryIcon('vanilla-like') },
	],
	6913: [ // Maps
		{ id: 6914, label: formatMessage(messages.catAdventure), icon: getCategoryIcon('adventure') },
		{ id: 6915, label: formatMessage(messages.catBuilding), icon: getCategoryIcon('building-2') },
		{ id: 6916, label: formatMessage(messages.catCtm), icon: getCategoryIcon('blocks') },
		{ id: 6917, label: formatMessage(messages.catCustomTerrain), icon: getCategoryIcon('tree-pine') },
		{ id: 6918, label: formatMessage(messages.catMinigame), icon: getCategoryIcon('minigame') },
		{ id: 6919, label: formatMessage(messages.catParkour), icon: getCategoryIcon('footprints') },
		{ id: 6920, label: formatMessage(messages.catPuzzle), icon: getCategoryIcon('quests') },
		{ id: 6921, label: formatMessage(messages.catPvp), icon: getCategoryIcon('sword') },
		{ id: 6922, label: formatMessage(messages.catRedstone), icon: getCategoryIcon('zap') },
		{ id: 6923, label: formatMessage(messages.catRollerCoaster), icon: getCategoryIcon('compass') },
		{ id: 6924, label: formatMessage(messages.catSurvival), icon: getCategoryIcon('shield') },
	],
	6929: [ // Texture Packs
		{ id: 10747, label: formatMessage(messages.catGui), icon: getCategoryIcon('gui') },
		{ id: 6930, label: formatMessage(messages.catMiscellaneous), icon: getCategoryIcon('kitchen-sink') },
		{ id: 6931, label: formatMessage(messages.catPvp), icon: getCategoryIcon('sword') },
		{ id: 6932, label: formatMessage(messages.catRealistic), icon: getCategoryIcon('realistic') },
		{ id: 6939, label: formatMessage(messages.catShaders), icon: getCategoryIcon('core-shaders') },
		{ id: 6933, label: formatMessage(messages.catSimplistic), icon: getCategoryIcon('simplistic') },
		{ id: 6934, label: formatMessage(messages.catThemed), icon: getCategoryIcon('themed') },
		{ id: 6935, label: formatMessage(messages.cat16x), icon: getCategoryIcon('grid-3x3') },
		{ id: 6936, label: formatMessage(messages.cat32x), icon: getCategoryIcon('grid-3x3') },
		{ id: 6937, label: formatMessage(messages.cat64x), icon: getCategoryIcon('grid-3x3') },
		{ id: 6938, label: formatMessage(messages.cat128x), icon: getCategoryIcon('grid-3x3') },
	],
	6940: [ // Scripts
		{ id: 6941, label: formatMessage(messages.catScripts), icon: getCategoryIcon('terminal') },
		{ id: 8824, label: formatMessage(messages.catUtility), icon: getCategoryIcon('utility') },
	],
	6925: [ // Skins
		{ id: 6928, label: formatMessage(messages.catSkinPacks), icon: getCategoryIcon('palette') },
		{ id: 6927, label: formatMessage(messages.catPlayerSkins), icon: getCategoryIcon('users') },
		{ id: 6926, label: formatMessage(messages.catMobSkins), icon: getCategoryIcon('mobs') },
	],
}))

const availableCategories = computed(() => {
	if (!selectedClassId.value || !categoriesMap.value[selectedClassId.value]) {
		// Return combined unique categories if 'All' is selected
		const allCats: { id: number; label: string; icon?: unknown }[] = []
		Object.values(categoriesMap.value).forEach(cats => {
			cats.forEach(c => {
				if (!allCats.some(x => x.id === c.id)) allCats.push(c)
			})
		})
		return allCats
	}
	return categoriesMap.value[selectedClassId.value]
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
