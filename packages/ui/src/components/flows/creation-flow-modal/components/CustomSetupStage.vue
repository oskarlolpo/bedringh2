<template>
	<div class="space-y-6">
		<div
			v-if="ctx.projectInstall.value"
			class="flex items-center gap-2.5 rounded-[20px] bg-surface-2 p-3"
		>
			<div class="shrink-0">
				<div
					class="size-14 shrink-0 overflow-hidden rounded-2xl border border-solid border-surface-5"
				>
					<Avatar
						v-if="ctx.projectInstall.value.iconUrl"
						:src="ctx.projectInstall.value.iconUrl"
						:alt="ctx.projectInstall.value.title"
						size="100%"
						class="!rounded-2xl"
						no-shadow
					/>
				</div>
			</div>
			<div class="flex flex-col gap-1">
				<span class="font-semibold text-contrast">
					{{ ctx.projectInstall.value.title }}
				</span>
				<div
					v-if="ctx.projectInstall.value.owner"
					class="flex items-center gap-2 text-sm text-secondary"
				>
					<div class="flex items-center gap-1.5 text-inherit">
						<Avatar
							:src="ctx.projectInstall.value.owner.iconUrl"
							:alt="ctx.projectInstall.value.owner.name"
							size="1.25rem"
							:circle="ctx.projectInstall.value.owner.circle"
							no-shadow
						/>
						<span class="font-medium">{{ ctx.projectInstall.value.owner.name }}</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Instance-specific: Icon upload -->
		<div v-if="ctx.flowType === 'instance' || ctx.setupType.value === 'server'" class="flex items-center gap-2.5">
			<div class="group relative size-[7.75rem] shrink-0">
				<Avatar
					:src="ctx.instanceIconUrl.value ?? undefined"
					size="100%"
					no-shadow
					pad-transparent-corners
				/>
				<div
					v-if="ctx.instanceIconUrl.value"
					class="pointer-events-none absolute right-1.5 top-1.5 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
				>
					<Button
						size="sm"
						class="!p-2"
						:aria-label="formatMessage(commonMessages.removeImageButton)"
						@click="removeIcon"
					>
						<XIcon />
					</Button>
				</div>
			</div>
			<div class="flex flex-col gap-1.5">
				<Button type="outlined" @click="triggerIconInput">
					<UploadIcon />
					{{ formatMessage(messages.uploadIcon) }}
				</Button>
				<Button
					type="outlined"
					:disabled="randomizing"
					class="disabled:!cursor-defcaault"
					@click="randomizeIcon"
				>
					<SpinnerIcon v-if="randomizing" class="animate-spin" />
					<RefreshCwIcon v-else />
					{{ formatMessage(messages.randomizeIcon) }}
				</Button>
				<Button type="outlined" @click="ctx.customizeInstanceIcon?.()">
					<PaletteIcon />
					{{ formatMessage(messages.customizeIcon) }}
				</Button>
			</div>
		</div>

		<!-- Instance-specific: Name field -->
		<div v-if="ctx.flowType === 'instance' || ctx.setupType.value === 'server'" class="flex flex-col gap-2">
			<span class="font-semibold text-contrast">{{ formatMessage(messages.nameLabel) }}</span>
			<Input
				v-model="ctx.instanceName.value"
				:placeholder="ctx.autoInstanceName.value || formatMessage(messages.instanceNamePlaceholder)"
			/>
		</div>

		<!-- Loader chips -->
		<div v-if="!hideLoaderChips" class="flex flex-col gap-2">
			<span class="font-semibold text-contrast">{{
				ctx.setupType.value === 'server'
					? 'Ядро'
					: ctx.flowType === 'instance'
						? formatMessage(messages.loaderLabel)
						: formatMessage(messages.contentLoaderLabel)
			}}</span>
			<Chips
				v-model="selectedLoader"
				:items="effectiveLoaders"
				:format-label="formatLoaderLabel"
				:never-empty="ctx.setupType.value === 'server'"
			/>
		</div>

		<!-- Game version -->
		<div class="flex flex-col gap-2">
			<span class="font-semibold text-contrast">{{
				formatMessage(commonMessages.gameVersionLabel)
			}}</span>
			<Combobox
				v-model="selectedGameVersion"
				:options="gameVersionOptions"
				:no-options-message="
					gameVersionsLoading
						? formatMessage(commonMessages.loadingLabel)
						: formatMessage(messages.noVersionsAvailable)
				"
				searchable
				sync-with-selection
				:placeholder="formatMessage(messages.selectGameVersion)"
				:search-placeholder="formatMessage(messages.searchGameVersion)"
				@option-hover="handleGameVersionHover"
			>
				<template v-if="ctx.showSnapshotToggle" #dropdown-footer>
					<button
						type="button"
						class="flex w-full cursor-pointer items-center justify-center gap-1.5 border-0 border-t border-solid border-surface-5 bg-transparent py-3 text-center text-sm font-semibold text-secondary transition-colors hover:text-contrast"
						@mousedown.prevent.stop
						@click.stop="toggleSnapshots"
					>
						<EyeOffIcon v-if="ctx.showSnapshots.value" class="size-4" />
						<EyeIcon v-else class="size-4" />
						{{
							ctx.showSnapshots.value
								? formatMessage(commonMessages.hideSnapshotsButton)
								: formatMessage(commonMessages.showAllVersionsButton)
						}}
					</button>
				</template>
			</Combobox>
		</div>

		<!-- Loader version -->
		<template v-if="!hideLoaderVersion && selectedLoader !== 'bedrock'">
			<Collapsible :collapsed="!selectedLoader || !selectedGameVersion" overflow-visible>
				<div class="flex flex-col gap-2">
					<span class="font-semibold text-contrast">{{
						ctx.setupType.value === 'server'
							? formatMessage(messages.coreVersionLabel)
							: formatMessage(messages.loaderVersionLabel)
					}}</span>
					<Chips
						v-model="loaderVersionType"
						:items="loaderVersionTypeItems"
						:disabled-items="loaderVersionTypeDisabledItems"
						:disabled-tooltip="'No such versions available'"
						:format-label="formatLoaderVersionTypeLabel"
					/>
					<div v-if="loaderVersionType === 'other'">
						<Combobox
							v-model="selectedLoaderVersion"
							:options="loaderVersionOptions"
							:no-options-message="
								loaderVersionsLoading
									? formatMessage(commonMessages.loadingLabel)
									: formatMessage(messages.noVersionsAvailable)
							"
							searchable
							sync-with-selection
							:placeholder="
								ctx.setupType.value === 'server'
									? formatMessage(messages.selectCoreVersion)
									: formatMessage(messages.selectLoaderVersion)
							"
							:search-placeholder="
								ctx.setupType.value === 'server'
									? formatMessage(messages.searchCoreVersion)
									: formatMessage(messages.searchLoaderVersion)
							"
						>
							<!-- When not Paper, this scoped slot is omitted and Combobox uses default option markup. -->
							<template v-if="selectedLoader === 'paper'" #option="{ item, isSelected }">
								<div class="flex w-full items-center justify-between gap-2">
									<div class="flex flex-wrap items-center gap-2">
										<span
											class="font-semibold leading-tight"
											:class="isSelected ? 'text-contrast' : 'text-primary'"
										>
											{{ item.label }}
										</span>
										<PaperChannelBadge :channel="paperBuildChannelTag(String(item.value))" />
									</div>
								</div>
							</template>
							<template v-if="selectedLoader === 'paper'" #search-selection-affix="{ option }">
								<PaperChannelBadge
									affix
									:channel="option ? paperBuildChannelTag(String(option.value)) : null"
								/>
							</template>
						</Combobox>
					</div>
				</div>
			</Collapsible>
		</template>
	</div>
</template>

<script setup lang="ts">
import type { Paper } from '@modrinth/api-client'
import {
	EyeIcon,
	EyeOffIcon,
	PaletteIcon,
	RefreshCwIcon,
	SpinnerIcon,
	UploadIcon,
	XIcon,
} from '@modrinth/assets'
import { commonMessages, defineMessages, useVIntl } from '@modrinth/ui'
import { computed, onMounted, ref, watch } from 'vue'

import { Button } from '#ui/components/base/buttons'
import { useDebugLogger } from '#ui/composables/debug-logger'

import { injectFilePicker, injectModrinthClient, injectTags } from '../../../../providers'
import Avatar from '../../../base/Avatar.vue'
import Chips from '../../../base/Chips.vue'
import Collapsible from '../../../base/Collapsible.vue'
import Combobox, { type ComboboxOption } from '../../../base/Combobox.vue'
import Input from '../../../base/inputs/Input.vue'
import PaperChannelBadge from '../../../base/PaperChannelBadge.vue'
import type { LoaderVersionEntry, LoaderVersionType } from '../creation-flow-context'
import { injectCreationFlowContext } from '../creation-flow-context'
import { formatLoaderLabel } from '../shared'

const debug = useDebugLogger('CustomSetupStage')
const client = injectModrinthClient()
const ctx = injectCreationFlowContext()
const { formatMessage } = useVIntl()
const {
	selectedLoader,
	selectedGameVersion,
	loaderVersionType,
	selectedLoaderVersion,
	hideLoaderChips,
	hideLoaderVersion,
} = ctx

const messages = defineMessages({
	uploadIcon: {
		id: 'creation-flow.modal.custom-setup.icon.select',
		defaultMessage: 'Upload',
	},
	randomizeIcon: {
		id: 'creation-flow.modal.custom-setup.icon.randomize',
		defaultMessage: 'Randomize',
	},
	customizeIcon: {
		id: 'creation-flow.modal.custom-setup.icon.customize',
		defaultMessage: 'Customize',
	},
	nameLabel: {
		id: 'creation-flow.modal.custom-setup.name.label',
		defaultMessage: 'Name',
	},
	instanceNamePlaceholder: {
		id: 'creation-flow.modal.custom-setup.name.placeholder',
		defaultMessage: 'Enter instance name',
	},
	loaderLabel: {
		id: 'creation-flow.modal.custom-setup.loader.label',
		defaultMessage: 'Loader',
	},
	contentLoaderLabel: {
		id: 'creation-flow.modal.custom-setup.content-loader.label',
		defaultMessage: 'Content loader',
	},
	noVersionsAvailable: {
		id: 'creation-flow.modal.custom-setup.options.no-versions-available',
		defaultMessage: 'No versions available',
	},
	selectGameVersion: {
		id: 'creation-flow.modal.custom-setup.game-version.placeholder',
		defaultMessage: 'Select game version',
	},
	searchGameVersion: {
		id: 'creation-flow.modal.custom-setup.game-version.search-placeholder',
		defaultMessage: 'Search game version...',
	},
	buildNumberLabel: {
		id: 'creation-flow.modal.custom-setup.build-number.label',
		defaultMessage: 'Build number',
	},
	loaderVersionLabel: {
		id: 'creation-flow.modal.custom-setup.loader-version.label',
		defaultMessage: 'Loader version',
	},
	selectBuildNumber: {
		id: 'creation-flow.modal.custom-setup.build-number.placeholder',
		defaultMessage: 'Select build number',
	},
	selectLoaderVersion: {
		id: 'creation-flow.modal.custom-setup.loader-version.placeholder',
		defaultMessage: 'Select loader version',
	},
	searchBuildNumber: {
		id: 'creation-flow.modal.custom-setup.build-number.search-placeholder',
		defaultMessage: 'Search build number...',
	},
	searchLoaderVersion: {
		id: 'creation-flow.modal.custom-setup.loader-version.search-placeholder',
		defaultMessage: 'Search loader version...',
	},
	stableLoaderVersionType: {
		id: 'creation-flow.modal.custom-setup.loader-version-type.stable',
		defaultMessage: 'Stable',
	},
	latestLoaderVersionType: {
		id: 'creation-flow.modal.custom-setup.loader-version-type.latest',
		defaultMessage: 'Latest',
	},
	otherLoaderVersionType: {
		id: 'creation-flow.modal.custom-setup.loader-version-type.other',
		defaultMessage: 'Other',
	},
	coreVersionLabel: {
		id: 'creation-flow.modal.custom-setup.core-version.label',
		defaultMessage: 'Версия ядра',
	},
	selectCoreVersion: {
		id: 'creation-flow.modal.custom-setup.core-version.placeholder',
		defaultMessage: 'Выберите версию ядра',
	},
	searchCoreVersion: {
		id: 'creation-flow.modal.custom-setup.core-version.search-placeholder',
		defaultMessage: 'Поиск версии ядра...',
	},
})

function formatLoaderVersionTypeLabel(type: LoaderVersionType): string {
	switch (type) {
		case 'stable':
			return 'Стабильная'
		case 'latest':
			return 'Последняя'
		case 'other':
			return 'Другая'
	}
}

function toggleSnapshots(e?: Event) {
	e?.preventDefault()
	e?.stopPropagation()
	ctx.showSnapshots.value = !ctx.showSnapshots.value
}

// For instance flow, prepend 'vanilla' to available loaders.
// For server flows, vanilla is a separate option in the setup type stage, so exclude it here.
const serverCores = ['paper', 'purpur', 'fabric', 'neoforge', 'forge', 'folia', 'spigot', 'vanilla']

const effectiveLoaders = computed(() => {
	if (ctx.setupType.value === 'server') {
		return serverCores
	}
	if (ctx.projectInstall.value) {
		return ctx.projectInstall.value.compatibleLoaders
	}
	if (ctx.flowType === 'instance') {
		return ['vanilla', ...ctx.availableLoaders.filter((l) => l !== 'vanilla')]
	}
	if (ctx.flowType === 'server-onboarding' || ctx.flowType === 'reset-server') {
		return ctx.availableLoaders.filter((l) => l !== 'vanilla')
	}
	return ctx.availableLoaders
})

// Pre-select loader and game version from initial values
onMounted(() => {
	debug('mounted, initialLoader:', ctx.initialLoader, 'initialGameVersion:', ctx.initialGameVersion)
	if (ctx.flowType === 'instance') {
		void randomizeIcon()
	}
	if (!selectedLoader.value) {
		if (ctx.initialLoader) {
			selectedLoader.value = ctx.initialLoader
		} else if (ctx.setupType.value === 'server') {
			selectedLoader.value = 'paper'
		} else {
			selectedLoader.value = 'fabric'
		}
	}
	if (ctx.initialGameVersion && !selectedGameVersion.value && ctx.initialGameVersion !== '26.3') {
		selectedGameVersion.value = ctx.initialGameVersion
	} else if (!selectedGameVersion.value || selectedGameVersion.value === '26.3') {
		selectedGameVersion.value = '1.21.4'
	}
	debug('after init:', { loader: selectedLoader.value, gameVersion: selectedGameVersion.value })
})

const tags = injectTags()

const loaderVersionTypeItems: LoaderVersionType[] = ['stable', 'latest', 'other']

const loaderVersionTypeDisabledItems = computed<LoaderVersionType[]>(() => {
	const noStableVersions = !loaderVersionsData.value.some((v: LoaderVersionEntry) => v.stable)
	return noStableVersions ? ['stable'] : []
})

const isPaperLike = computed(
	() => selectedLoader.value === 'paper' || selectedLoader.value === 'purpur',
)

// Icon upload handling
const filePicker = injectFilePicker()

async function triggerIconInput() {
	const picked = await filePicker.pickImage()
	if (picked) {
		ctx.instanceIcon.value = picked.file
		ctx.instanceIconUrl.value = picked.previewUrl
		ctx.instanceIconPath.value = picked.path ?? null
	}
}

function removeIcon() {
	ctx.instanceIcon.value = null
	ctx.instanceIconUrl.value = null
	ctx.instanceIconPath.value = null
}

const randomizing = ref(false)

async function randomizeIcon() {
	if (!ctx.randomizeInstanceIcon || randomizing.value) return

	randomizing.value = true
	try {
		const generated = await ctx.randomizeInstanceIcon()
		if (!generated) return
		ctx.instanceIcon.value = null
		ctx.instanceIconUrl.value = generated.previewUrl
		ctx.instanceIconPath.value = generated.path
	} finally {
		randomizing.value = false
	}
}

const loaderVersionsLoading = ref(false)
const loaderVersionsData = ref<LoaderVersionEntry[]>([])

// Paper/Purpur/Folia build caches
const paperVersions = ref<Record<string, Paper.Versions.v3.Build[]>>({})
const purpurVersions = ref<Record<string, string[]>>({})
const foliaVersions = ref<Record<string, Paper.Versions.v3.Build[]>>({})

function toApiLoaderName(loader: string): string {
	return loader === 'neoforge' ? 'neo' : loader
}

const gameVersionsLoading = computed(() => {
	if (ctx.projectInstall.value) return false
	const loader = selectedLoader.value
	if (!loader || loader === 'vanilla' || loader === 'folia' || loader === 'spigot') return false
	if (loader === 'paper') return ctx.paperSupportedVersions.value === null
	if (loader === 'purpur') return ctx.purpurSupportedVersions.value === null
	return ctx.loaderVersionsCache.value[toApiLoaderName(loader)] === undefined
})

// Game versions from tags provider, filtered by loader support
const gameVersionOptions = computed<ComboboxOption<string>[]>(() => {
	if (ctx.projectInstall.value) {
		const versions =
			ctx.showSnapshots.value || ctx.projectInstall.value.releaseGameVersions.size === 0
				? ctx.projectInstall.value.gameVersions
				: ctx.projectInstall.value.gameVersions.filter((version) =>
						ctx.projectInstall.value!.releaseGameVersions.has(version),
					)
		return versions.map((version) => ({ value: version, label: version }))
	}

	const rawVersions = ctx.showSnapshots.value
		? tags.gameVersions.value
		: tags.gameVersions.value.filter((v) => v.version_type === 'release')

	const versions =
		ctx.setupType.value === 'server' && !ctx.showSnapshots.value
			? rawVersions.filter((v) => /^1\.\d+(\.\d+)?$/.test(v.version))
			: rawVersions

	// For loaders with per-version data, only show game versions that have builds
	if (selectedLoader.value && selectedLoader.value !== 'vanilla') {
		if (selectedLoader.value === 'bedrock') {
			const manifest = ctx.loaderVersionsCache.value['bedrock']
			if (!manifest?.gameVersions) return []
			const parseVer = (s: string): number[] => {
				const base = s.split('-')[0] || s
				return base.split('.').map((x) => parseInt(x, 10) || 0)
			}
			const compareVer = (a: any, b: any) => {
				const pa = parseVer(a.id)
				const pb = parseVer(b.id)
				const len = Math.max(pa.length, pb.length)
				for (let i = 0; i < len; i++) {
					const numA = pa[i] ?? 0
					const numB = pb[i] ?? 0
					if (numA !== numB) return numB - numA
				}
				return b.id.localeCompare(a.id)
			}

			const releases = [...manifest.gameVersions.filter((x: any) => x.stable)].sort(compareVer)

			if (!ctx.showSnapshots.value) {
				return releases.map((x: any) => ({
					value: x.id,
					label: x.id,
				}))
			}

			const all = [...manifest.gameVersions].sort(compareVer)
			return all.map((x: any) => ({
				value: x.id,
				label: x.stable ? x.id : `${x.id} (preview)`,
			}))
		}

		if (selectedLoader.value === 'paper') {
			if (!ctx.paperSupportedVersions.value || ctx.paperSupportedVersions.value.size === 0) {
				return versions.map((v) => ({ value: v.version, label: v.version }))
			}
			return versions
				.filter((v) => ctx.paperSupportedVersions.value!.has(v.version))
				.map((v) => ({ value: v.version, label: v.version }))
		}

		if (selectedLoader.value === 'purpur') {
			if (!ctx.purpurSupportedVersions.value || ctx.purpurSupportedVersions.value.size === 0) {
				return versions.map((v) => ({ value: v.version, label: v.version }))
			}
			return versions
				.filter((v) => ctx.purpurSupportedVersions.value!.has(v.version))
				.map((v) => ({ value: v.version, label: v.version }))
		}

		if (selectedLoader.value === 'folia' || selectedLoader.value === 'spigot' || selectedLoader.value === 'vanilla') {
			return versions.map((v) => ({ value: v.version, label: v.version }))
		}

		const apiLoader = toApiLoaderName(selectedLoader.value)
		const manifest = ctx.loaderVersionsCache.value[apiLoader]
		if (!manifest) return []

		const hasPlaceholder = manifest.gameVersions.some((x) => x.id === '${modrinth.gameVersion}')
		const supportedVersions = new Set(
			manifest.gameVersions
				.filter(
					(x) =>
						x.id !== '${modrinth.gameVersion}' &&
						(hasPlaceholder || x.loaders.length > 0 || !!x.versionGroup),
				)
				.map((x) => x.id),
		)
		return versions
			.filter((v) => supportedVersions.has(v.version))
			.map((v) => ({ value: v.version, label: v.version }))
	}

	return versions.map((v) => ({ value: v.version, label: v.version }))
})

// Auto-select latest game version when options change and current selection is missing or invalid
watch(
	gameVersionOptions,
	(options) => {
		if (options.length === 0) {
			selectedGameVersion.value = null
			return
		}
		if (
			!selectedGameVersion.value ||
			selectedGameVersion.value === '26.3' ||
			!options.some((o) => o.value === selectedGameVersion.value)
		) {
			selectedGameVersion.value = options[0].value
		}
	},
	{ immediate: true },
)

async function fetchLoaderManifest(loader: string) {
	const apiLoader = toApiLoaderName(loader)
	debug(
		'fetchLoaderManifest:',
		loader,
		'apiLoader:',
		apiLoader,
		'cached:',
		!!ctx.loaderVersionsCache.value[apiLoader],
	)
	await ctx.fetchLoaderMetadata(loader)
}

async function fetchLoaderMetadata(loader?: string | null) {
	await ctx.fetchLoaderMetadata(loader)
}

function paperBuildChannelTag(buildId: string): 'ALPHA' | 'BETA' | null {
	const gv = selectedGameVersion.value
	if (!gv || selectedLoader.value !== 'paper') return null
	const b = paperVersions.value[gv]?.find((x) => String(x.id) === buildId)
	if (!b) return null
	const u = String(b.channel).toUpperCase()
	if (u === 'ALPHA' || u === 'BETA') return u
	return null
}

async function fetchPaperVersions(mcVersion: string) {
	if (paperVersions.value[mcVersion] && paperVersions.value[mcVersion].length > 0) return
	try {
		const data = await client.paper.versions_v3.getBuilds(mcVersion)
		if (data?.builds?.length) {
			paperVersions.value[mcVersion] = data.builds.toSorted((a, b) => b.id - a.id)
			return
		}
	} catch {
		// fallback
	}
	try {
		const res = await fetch(`https://api.papermc.io/v2/projects/paper/versions/${mcVersion}/builds`)
		if (res.ok) {
			const data = await res.json()
			if (data.builds?.length) {
				paperVersions.value[mcVersion] = (data.builds || [])
					.map((b: any) => ({
						id: b.build,
						time: b.time,
						channel: b.channel || 'STABLE',
					}))
					.reverse()
				return
			}
		}
	} catch {
		// ignore
	}
	paperVersions.value[mcVersion] = [
		{ id: 1, time: new Date().toISOString(), channel: 'STABLE' },
	]
}

function handleGameVersionHover(option: ComboboxOption<string | null>) {
	const v = option.value
	if (v == null || v === '') return
	if (selectedLoader.value === 'paper') void fetchPaperVersions(v)
	else if (selectedLoader.value === 'purpur') void fetchPurpurVersions(v)
	else if (selectedLoader.value === 'folia') void fetchFoliaVersions(v)
}

async function fetchPurpurVersions(mcVersion: string) {
	if (purpurVersions.value[mcVersion] && purpurVersions.value[mcVersion].length > 0) return
	try {
		const data = await client.purpur.versions_v2.getBuilds(mcVersion)
		if (data?.builds?.all?.length) {
			purpurVersions.value[mcVersion] = data.builds.all.sort((a, b) => parseInt(b) - parseInt(a))
			return
		}
	} catch {
		// fallback
	}
	try {
		const res = await fetch(`https://api.purpurmc.org/v2/purpur/${mcVersion}`)
		if (res.ok) {
			const data = await res.json()
			if (data.builds?.all?.length) {
				purpurVersions.value[mcVersion] = data.builds.all.sort((a: string, b: string) => parseInt(b) - parseInt(a))
				return
			}
		}
	} catch {
		// ignore
	}
	purpurVersions.value[mcVersion] = ['1']
}

async function fetchFoliaVersions(mcVersion: string) {
	if (foliaVersions.value[mcVersion] && foliaVersions.value[mcVersion].length > 0) return
	try {
		const res = await fetch(`https://api.papermc.io/v2/projects/folia/versions/${mcVersion}/builds`)
		if (res.ok) {
			const data = await res.json()
			if (data.builds?.length) {
				foliaVersions.value[mcVersion] = (data.builds || [])
					.map((b: any) => ({
						id: b.build,
						time: b.time,
						channel: b.channel || 'STABLE',
					}))
					.reverse()
				return
			}
		}
	} catch {
		// ignore
	}
	foliaVersions.value[mcVersion] = [
		{ id: 1, time: new Date().toISOString(), channel: 'STABLE' },
	]
}

function getLoaderVersionsForGameVersion(
	loader: string,
	gameVersion: string,
): LoaderVersionEntry[] {
	const apiLoader = toApiLoaderName(loader)
	const manifest = ctx.loaderVersionsCache.value[apiLoader]
	debug('getLoaderVersionsForGameVersion:', {
		loader,
		apiLoader,
		gameVersion,
		hasManifest: !!manifest,
		manifestLength: manifest?.gameVersions.length,
	})
	if (loader === 'bedrock' || !manifest) return []

	// Some loaders (e.g. Fabric) list all versions under a placeholder entry
	const placeholder = manifest.gameVersions.find((x) => x.id === '${modrinth.gameVersion}')
	if (placeholder) {
		if (!manifest.gameVersions.some((x) => x.id === gameVersion)) return []
		debug(
			'getLoaderVersionsForGameVersion: using placeholder, loaders:',
			placeholder.loaders.length,
		)
		return placeholder.loaders
	}

	const entry = manifest.gameVersions.find((x) => x.id === gameVersion)
	if (entry?.versionGroup) {
		const loaders =
			manifest.versionGroups?.find((group) => group.id === entry.versionGroup)?.loaders ?? []
		debug(
			'getLoaderVersionsForGameVersion: version group for',
			gameVersion,
			':',
			entry.versionGroup,
			loaders.length + ' loaders',
		)
		return loaders
	}

	debug(
		'getLoaderVersionsForGameVersion: entry for',
		gameVersion,
		':',
		entry ? entry.loaders.length + ' loaders' : 'NOT FOUND',
	)
	return entry?.loaders ?? []
}

// Fetch version data when loader changes so game versions can be filtered
watch(
	() => selectedLoader.value,
	async (loader) => {
		if (ctx.projectInstall.value) return
		await fetchLoaderMetadata(loader)
	},
	{ immediate: true },
)

// Watch loader + game version to resolve loader versions
let loaderVersionWatchId = 0
watch(
	[() => selectedLoader.value, () => selectedGameVersion.value],
	async ([loader, gameVersion]) => {
		const watchId = ++loaderVersionWatchId
		debug('watch [loader, gameVersion] fired:', { loader, gameVersion, watchId })
		loaderVersionsData.value = []
		selectedLoaderVersion.value = null

		if (ctx.projectInstall.value) return
		if (!loader || !gameVersion) return

		if (loader === 'vanilla' || loader === 'spigot') {
			if (ctx.setupType.value === 'server') {
				loaderVersionsData.value = [{ id: gameVersion, stable: true }]
				selectedLoaderVersion.value = gameVersion
			}
			return
		}

		loaderVersionsLoading.value = true

		if (loader === 'paper') {
			await fetchPaperVersions(gameVersion)
			if (watchId !== loaderVersionWatchId) return
			const builds = paperVersions.value[gameVersion] ?? []
			loaderVersionsData.value = builds.map((b) => ({
				id: `${b.id}`,
				stable: b.channel === 'STABLE' || b.channel === 'default' || !b.channel,
			}))
			loaderVersionsLoading.value = false
			autoSelectLoaderVersion()
			return
		}

		if (loader === 'purpur') {
			await fetchPurpurVersions(gameVersion)
			if (watchId !== loaderVersionWatchId) return
			const builds = purpurVersions.value[gameVersion] ?? []
			loaderVersionsData.value = builds.map((b) => ({
				id: b,
				stable: true,
			}))
			loaderVersionsLoading.value = false
			autoSelectLoaderVersion()
			return
		}

		if (loader === 'folia') {
			await fetchFoliaVersions(gameVersion)
			if (watchId !== loaderVersionWatchId) return
			const builds = foliaVersions.value[gameVersion] ?? []
			loaderVersionsData.value = builds.map((b) => ({
				id: `${b.id}`,
				stable: b.channel === 'STABLE' || b.channel === 'default' || !b.channel,
			}))
			loaderVersionsLoading.value = false
			autoSelectLoaderVersion()
			return
		}

		await fetchLoaderManifest(loader)
		if (watchId !== loaderVersionWatchId) {
			debug('watch [loader, gameVersion]: stale execution, skipping', {
				watchId,
				current: loaderVersionWatchId,
			})
			return
		}
		loaderVersionsData.value = getLoaderVersionsForGameVersion(loader, gameVersion)
		debug(
			'watch [loader, gameVersion]: loaderVersionsData set, count:',
			loaderVersionsData.value.length,
		)
		loaderVersionsLoading.value = false

		// Auto-select based on loaderVersionType
		autoSelectLoaderVersion()
	},
)

watch(
	() => loaderVersionType.value,
	() => autoSelectLoaderVersion(),
)

function autoSelectLoaderVersion() {
	debug(
		'autoSelectLoaderVersion: type:',
		loaderVersionType.value,
		'dataCount:',
		loaderVersionsData.value.length,
		'stableCount:',
		loaderVersionsData.value.filter((v) => v.stable).length,
		'first:',
		loaderVersionsData.value[0]?.id,
	)
	if (
		loaderVersionType.value === 'stable' &&
		loaderVersionTypeDisabledItems.value.includes('stable')
	) {
		debug("'stable' loader version type is disabled, switching to 'latest'...")
		loaderVersionType.value = 'latest'
	}
	if (loaderVersionType.value === 'stable') {
		const stable = loaderVersionsData.value.find((v) => v.stable)
		selectedLoaderVersion.value = stable?.id ?? loaderVersionsData.value[0]?.id ?? null
	} else if (loaderVersionType.value === 'latest') {
		selectedLoaderVersion.value = loaderVersionsData.value[0]?.id ?? null
	} else if (loaderVersionType.value === 'other' && !selectedLoaderVersion.value) {
		selectedLoaderVersion.value = loaderVersionsData.value[0]?.id ?? null
	}
	debug('autoSelectLoaderVersion: result:', selectedLoaderVersion.value)
}

const loaderVersionOptions = computed<ComboboxOption<string>[]>(() => {
	if (selectedLoader.value === 'paper' && selectedGameVersion.value) {
		const builds = paperVersions.value[selectedGameVersion.value] ?? []
		return builds.map((b) => ({
			value: `${b.id}`,
			label: `Сборка #${b.id}${b.channel === 'STABLE' ? ' (Стабильная)' : ''}`,
		}))
	}

	if (selectedLoader.value === 'purpur' && selectedGameVersion.value) {
		const builds = purpurVersions.value[selectedGameVersion.value] ?? []
		return builds.map((b) => ({ value: b, label: `Сборка #${b}` }))
	}

	if (selectedLoader.value === 'folia' && selectedGameVersion.value) {
		const builds = foliaVersions.value[selectedGameVersion.value] ?? []
		return builds.map((b) => ({
			value: `${b.id}`,
			label: `Сборка #${b.id}${b.channel === 'STABLE' ? ' (Стабильная)' : ''}`,
		}))
	}

	return loaderVersionsData.value.map((v) => ({
		value: v.id,
		label: v.stable ? `${v.id} (стабильная)` : v.id,
	}))
})
</script>
