<script setup lang="ts">
import type { Labrinth } from '@modrinth/api-client'
import {
	CheckIcon,
	ClipboardCopyIcon,
	ExternalIcon,
	GlobeIcon,
	PlusIcon,
	SpinnerIcon,
} from '@modrinth/assets'
import type { BrowseInstallContentType, CardAction, ProjectType, Tags } from '@modrinth/ui'
import {
	BrowsePageLayout,
	BrowseSidebar,
	commonMessages,
	CreationFlowModal,
	defineMessages,
	getLatestMatchingInstallVersion,
	getSelectedInstallPreferences,
	getTargetInstallPreferences,
	injectNotificationManager,
	preferencesDiffer,
	provideBrowseManager,
	requestInstall,
	useBrowseSearch,
	useDebugLogger,
	useVIntl,
} from '@modrinth/ui'
import { useQueryClient } from '@tanstack/vue-query'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { Ref } from 'vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { LocationQuery } from 'vue-router'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'

import ContextMenu from '@/components/ui/ContextMenu.vue'
import { useAppServerBrowse } from '@/composables/browse/use-app-server-browse'
import {
	get_project,
	get_project_v3,
	get_search_results_v3,
	get_version_many,
} from '@/helpers/cache.js'
import { profile_listener } from '@/helpers/events.js'
import { get_loader_versions as getLoaderManifest } from '@/helpers/metadata'
import {
	get as getInstance,
	get_installed_project_ids as getInstalledProjectIds,
} from '@/helpers/profile.js'
import { get_categories, get_game_versions, get_loaders } from '@/helpers/tags'
import { get_profile_worlds } from '@/helpers/worlds'
import { injectContentInstall } from '@/providers/content-install'
import { injectServerInstall } from '@/providers/server-install'
import {
	createServerInstallContent,
	provideServerInstallContent,
} from '@/providers/setup/server-install-content'
import { useBreadcrumbs } from '@/store/breadcrumbs'

const { handleError } = injectNotificationManager()
const { formatMessage } = useVIntl()
const { installingServerProjects, playServerProject, showAddServerToInstanceModal } =
	injectServerInstall()
const { install: installVersion } = injectContentInstall()
const queryClient = useQueryClient()
const debugLog = useDebugLogger('Browse')

const router = useRouter()
const route = useRoute()
const serverSetupModalRef = ref<InstanceType<typeof CreationFlowModal> | null>(null)
const serverInstallContent = createServerInstallContent({ serverSetupModalRef })
provideServerInstallContent(serverInstallContent)
const {
	serverIdQuery,
	serverFlowFrom,
	isFromWorlds,
	isServerContext,
	isSetupServerContext,
	effectiveServerWorldId,
	serverContextServerData,
	serverContentProjectIds,
	queuedServerInstallProjectIds,
	queuedServerInstallCount,
	selectedServerInstallProjects,
	isInstallingQueuedServerInstalls,
	queuedInstallProgress,
	serverBackUrl,
	serverBackLabel,
	serverBrowseHeading,
	clearQueuedServerInstalls,
	removeQueuedServerInstall,
	flushQueuedServerInstalls,
	discardQueuedServerInstallsAndBack,
	installQueuedServerInstallsAndBack,
	initServerContext,
	watchServerContextChanges,
	searchServerModpacks,
	getServerProjectVersions,
	enforceSetupModpackRoute,
	getQueuedServerInstallPlans,
	setQueuedServerInstallPlans,
	openServerModpackInstallFlow,
	onServerFlowBack,
	handleServerModpackFlowCreate,
	markServerProjectInstalled,
} = serverInstallContent

debugLog('fetching tags (categories, loaders, gameVersions)')
const [categories, loaders, rawBedrockVersions] = await Promise.all([
	get_categories()
		.catch(handleError)
		.then(ref<Labrinth.Tags.v2.Category[]>),
	get_loaders()
		.catch(handleError)
		.then(ref<Labrinth.Tags.v2.Loader[]>),
	invoke('plugin:bedrock-addons|get_curseforge_minecraft_versions')
		.catch(() => [])
		.then((vs: any) =>
			ref<Labrinth.Tags.v2.GameVersion[]>(
				(vs || []).map((v: string) => ({
					version: v,
					version_type: 'release',
					date: new Date().toISOString(),
					major: true,
				})),
			),
		),
])

const availableGameVersions = rawBedrockVersions

const bedrockCategoriesMap: Record<string, any[]> = {
	addon: [
		{ id: '8834', name: 'Оружие и броня', project_type: 'addon' },
		{ id: '8825', name: 'Косметика', project_type: 'addon' },
		{ id: '4992', name: 'Дата-паки', project_type: 'addon' },
		{ id: '8828', name: 'Фэнтези', project_type: 'addon' },
		{ id: '8836', name: 'Еда', project_type: 'addon' },
		{ id: '8833', name: 'Хоррор', project_type: 'addon' },
		{ id: '8829', name: 'Магия', project_type: 'addon' },
		{ id: '4986', name: 'Карты', project_type: 'addon' },
		{ id: '4991', name: 'Мобы', project_type: 'addon' },
		{ id: '8835', name: 'Мультиплеер', project_type: 'addon' },
		{ id: '8837', name: 'Производительность', project_type: 'addon' },
		{ id: '4990', name: 'Игроки', project_type: 'addon' },
		{ id: '4993', name: 'PvP', project_type: 'addon' },
		{ id: '4994', name: 'Реализм', project_type: 'addon' },
		{ id: '8827', name: 'РП (Roleplay)', project_type: 'addon' },
		{ id: '4995', name: 'Простые', project_type: 'addon' },
		{ id: '4989', name: 'Скины', project_type: 'addon' },
		{ id: '8831', name: 'Выживание', project_type: 'addon' },
		{ id: '8826', name: 'Технологии', project_type: 'addon' },
		{ id: '4987', name: 'Текстуры', project_type: 'addon' },
		{ id: '4997', name: 'Тематические', project_type: 'addon' },
		{ id: '8832', name: 'Утилиты', project_type: 'addon' },
		{ id: '8830', name: 'Ванилла+', project_type: 'addon' },
	],
	resourcepack: [
		{ id: '10747', name: 'Интерфейс (GUI)', project_type: 'resourcepack' },
		{ id: '6930', name: 'Разное', project_type: 'resourcepack' },
		{ id: '6931', name: 'PvP', project_type: 'resourcepack' },
		{ id: '6932', name: 'Реализм', project_type: 'resourcepack' },
		{ id: '6939', name: 'Шейдеры', project_type: 'resourcepack' },
		{ id: '6933', name: 'Простые', project_type: 'resourcepack' },
		{ id: '6934', name: 'Тематические', project_type: 'resourcepack' },
		{ id: '6935', name: '16x', project_type: 'resourcepack' },
		{ id: '6936', name: '32x', project_type: 'resourcepack' },
		{ id: '6937', name: '64x', project_type: 'resourcepack' },
		{ id: '6938', name: '128x', project_type: 'resourcepack' },
	],
	world: [
		{ id: '6914', name: 'Приключения', project_type: 'world' },
		{ id: '6915', name: 'Строительство', project_type: 'world' },
		{ id: '6916', name: 'CTM', project_type: 'world' },
		{ id: '6917', name: 'Свой ландшафт', project_type: 'world' },
		{ id: '6918', name: 'Мини-игры', project_type: 'world' },
		{ id: '6919', name: 'Паркур', project_type: 'world' },
		{ id: '6920', name: 'Головоломки', project_type: 'world' },
		{ id: '6921', name: 'PvP', project_type: 'world' },
		{ id: '6922', name: 'Редстоун', project_type: 'world' },
		{ id: '6923', name: 'Американские горки', project_type: 'world' },
		{ id: '6924', name: 'Выживание', project_type: 'world' },
	],
	skin: [
		{ id: '6928', name: 'Наборы скинов', project_type: 'skin' },
		{ id: '6927', name: 'Скины игроков', project_type: 'skin' },
		{ id: '6926', name: 'Скины мобов', project_type: 'skin' },
	],
	script: [
		{ id: '6941', name: 'Скрипты', project_type: 'script' },
		{ id: '8824', name: 'Утилиты', project_type: 'script' },
	],
}

const tags: Ref<Tags> = computed(() => {
	const activeType = (projectType.value as string) || 'addon'
	const rawCats = (bedrockCategoriesMap[activeType] || bedrockCategoriesMap['addon']) as any[]
	const cats = rawCats.map((c) => ({
		header: 'categories',
		name: c.id,
		formatted_name: c.name || c.formatted_name,
		project_type: activeType,
		icon: c.icon,
	}))
	return {
		gameVersions: availableGameVersions.value ?? [],
		loaders: loaders.value ?? [],
		categories: cats,
	}
})

type Instance = {
	game_version: string
	loader: string
	path: string
	install_stage: string
	icon_path?: string
	name: string
	linked_data?: {
		project_id: string
		version_id: string
		locked: boolean
	}
}

const instance: Ref<Instance | null> = ref(null)
const installedProjectIds: Ref<string[] | null> = ref(null)
const instanceHideInstalled = ref(false)
const newlyInstalled = ref<string[]>([])
const hiddenInstanceProjectIds = ref<Set<string>>(new Set())
const hiddenInstanceProjectIdsInitialized = ref(false)
const isServerInstance = ref(false)

if (isFromWorlds.value && route.params.projectType !== 'server') {
	router.replace({
		path: '/browse/server',
		query: route.query,
	})
}

enforceSetupModpackRoute(route.params.projectType as string | undefined)

const allInstalledIds = computed(
	() => new Set([...newlyInstalled.value, ...(installedProjectIds.value ?? [])]),
)

function syncHiddenInstanceProjectIds() {
	hiddenInstanceProjectIds.value = new Set([
		...(installedProjectIds.value ?? []),
		...newlyInstalled.value,
	])
	hiddenInstanceProjectIdsInitialized.value = true
}

watch(
	installedProjectIds,
	(ids) => {
		if (!ids) return
		if (!hiddenInstanceProjectIdsInitialized.value) {
			syncHiddenInstanceProjectIds()
		}
	},
	{ immediate: true },
)

watchServerContextChanges()

await initInstanceContext()

async function refreshInstalledProjectIds() {
	if (!route.query.i) return

	if (route.query.from === 'worlds') {
		const worlds = await get_profile_worlds(route.query.i as string).catch(handleError)
		if (!worlds) return

		const serverProjectIds = worlds
			.filter((w) => w.type === 'server' && 'project_id' in w && w.project_id)
			.map((w) => (w as { project_id: string }).project_id)
		debugLog('installedServerProjectIds loaded', { count: serverProjectIds.length })
		installedProjectIds.value = serverProjectIds
		return
	}

	const ids = await getInstalledProjectIds(route.query.i as string).catch(handleError)
	if (!ids) return

	debugLog('installedProjectIds loaded', { count: ids.length })
	installedProjectIds.value = ids
}

async function initInstanceContext() {
	debugLog('initInstanceContext', {
		queryI: route.query.i,
		queryAi: route.query.ai,
		querySid: route.query.sid,
		queryWid: route.query.wid,
		queryFrom: route.query.from,
	})
	await initServerContext()

	if (route.query.i) {
		instance.value = (await getInstance(route.query.i as string).catch(handleError)) ?? null
		debugLog('instance loaded', {
			name: instance.value?.name,
			loader: instance.value?.loader,
			gameVersion: instance.value?.game_version,
		})

		await refreshInstalledProjectIds()

		if (instance.value?.linked_data?.project_id) {
			debugLog('checking linked project for server status', instance.value.linked_data.project_id)
			const projectV3 = await get_project_v3(
				instance.value.linked_data.project_id,
				'must_revalidate',
			).catch(handleError)
			if (projectV3?.minecraft_server != null) {
				debugLog('instance is a server instance')
				isServerInstance.value = true
			}
		}
	}

	if (route.query.ai && !(route.params.projectType === 'modpack')) {
		debugLog('setting instanceHideInstalled from query', route.query.ai)
		instanceHideInstalled.value = route.query.ai === 'true'
	}
}

const instanceFilters = computed(() => {
	const filters = []

	if (instance.value) {
		const gameVersion = instance.value.game_version
		if (gameVersion) {
			filters.push({ type: 'game_version', option: gameVersion })
		}

		const platform = instance.value.loader
		const supportedModLoaders = ['fabric', 'forge', 'quilt', 'neoforge']

		if (platform && projectType.value === 'mod' && supportedModLoaders.includes(platform)) {
			filters.push({ type: 'mod_loader', option: platform })
		}

		if (isServerInstance.value) {
			filters.push({ type: 'environment', option: 'client' })
		}

		if (instanceHideInstalled.value && hiddenInstanceProjectIds.value.size > 0) {
			for (const id of hiddenInstanceProjectIds.value) {
				filters.push({ type: 'project_id', option: `project_id:${id}`, negative: true })
			}
		}
	}

	return filters
})

const serverHideInstalled = ref(false)
const hideSelectedServerInstalls = ref(false)
if (route.query.shi) {
	serverHideInstalled.value = route.query.shi === 'true'
}
const hiddenServerContentProjectIds = ref<Set<string>>(new Set())
const hiddenServerContentProjectIdsInitialized = ref(false)

function syncHiddenServerContentProjectIds() {
	hiddenServerContentProjectIds.value = new Set(serverContentProjectIds.value)
	hiddenServerContentProjectIdsInitialized.value = true
}

watch(
	serverContentProjectIds,
	() => {
		if (!hiddenServerContentProjectIdsInitialized.value) {
			syncHiddenServerContentProjectIds()
		}
	},
	{ immediate: true },
)

const serverContextFilters = computed(() => {
	const filters: { type: string; option: string; negative?: boolean }[] = []
	if (!serverContextServerData.value) return filters
	const pt = projectType.value

	if (pt !== 'modpack') {
		const gameVersion = serverContextServerData.value.mc_version
		if (gameVersion) filters.push({ type: 'game_version', option: gameVersion })

		const platform = serverContextServerData.value.loader?.toLowerCase()
		if (platform && ['fabric', 'forge', 'quilt', 'neoforge'].includes(platform))
			filters.push({ type: 'mod_loader', option: platform })
		if (platform && ['paper', 'purpur'].includes(platform))
			filters.push({ type: 'plugin_loader', option: platform })

		if (pt === 'mod') filters.push({ type: 'environment', option: 'server' })

		if (hideSelectedServerInstalls.value && queuedServerInstallProjectIds.value.size > 0) {
			for (const id of queuedServerInstallProjectIds.value) {
				filters.push({ type: 'project_id', option: `project_id:${id}`, negative: true })
			}
		}
	}

	if (pt === 'modpack') {
		filters.push(
			{ type: 'environment', option: 'client' },
			{ type: 'environment', option: 'server' },
		)
	}

	if (serverHideInstalled.value && hiddenServerContentProjectIds.value.size > 0) {
		for (const id of hiddenServerContentProjectIds.value) {
			filters.push({ type: 'project_id', option: `project_id:${id}`, negative: true })
		}
	}

	return filters
})

const combinedProvidedFilters = computed(() =>
	isServerContext.value ? serverContextFilters.value : instanceFilters.value,
)

const {
	serverPings,
	contextMenuRef,
	updateServerHits,
	getServerModpackContent,
	getServerCardActions,
	handleRightClick,
	handleOptionsClick,
} = useAppServerBrowse({
	instance,
	isFromWorlds,
	allInstalledIds,
	newlyInstalled,
	installingServerProjects,
	playServerProject,
	showAddServerToInstanceModal,
	handleError,
	router,
})

const offline = ref(!navigator.onLine)
window.addEventListener('offline', () => {
	debugLog('went offline')
	offline.value = true
})
window.addEventListener('online', () => {
	debugLog('went online')
	offline.value = false
})

const messages = defineMessages({
	addServersToInstance: {
		id: 'app.browse.add-servers-to-instance',
		defaultMessage: 'Adding server to instance',
	},
	addToAnInstance: {
		id: 'app.browse.add-to-an-instance',
		defaultMessage: 'Add to an instance',
	},
	discoverContent: {
		id: 'app.browse.discover-content',
		defaultMessage: 'Discover content',
	},
	discoverServers: {
		id: 'app.browse.discover-servers',
		defaultMessage: 'Discover servers',
	},
	environmentProvidedByServer: {
		id: 'search.filter.locked.server-environment.title',
		defaultMessage: 'Only client-side mods can be added to the server instance',
	},
	gameVersionProvidedByInstance: {
		id: 'search.filter.locked.instance-game-version.title',
		defaultMessage: 'Game version is provided by the instance',
	},
	gameVersionProvidedByServer: {
		id: 'search.filter.locked.server-game-version.title',
		defaultMessage: 'Game version is provided by the server',
	},
	hideAddedServers: {
		id: 'app.browse.hide-added-servers',
		defaultMessage: 'Hide already added servers',
	},
	installingToServer: {
		id: 'app.browse.server.installing',
		defaultMessage: 'Installing',
	},
	backToInstance: {
		id: 'app.browse.back-to-instance',
		defaultMessage: 'Back to instance',
	},
	serverInstanceContentWarning: {
		id: 'app.browse.server-instance-content-warning',
		defaultMessage:
			'Adding content can break compatibility when joining the server. Any added content will also be lost when you update the server instance content.',
	},
	modLoaderProvidedByInstance: {
		id: 'search.filter.locked.instance-loader.title',
		defaultMessage: 'Loader is provided by the instance',
	},
	modpacksProjectType: {
		id: 'app.browse.project-type.modpacks',
		defaultMessage: 'Modpacks',
	},
	modLoaderProvidedByServer: {
		id: 'search.filter.locked.server-loader.title',
		defaultMessage: 'Loader is provided by the server',
	},
	providedByInstance: {
		id: 'search.filter.locked.instance',
		defaultMessage: 'Provided by the instance',
	},
	providedByServer: {
		id: 'search.filter.locked.server',
		defaultMessage: 'Provided by the server',
	},
	syncFilterButton: {
		id: 'search.filter.locked.instance.sync',
		defaultMessage: 'Sync with instance',
	},
	addonsProjectType: {
		id: 'app.browse.project-type.addons',
		defaultMessage: 'Add-ons',
	},
	resourcePacksProjectType: {
		id: 'app.browse.project-type.resource-packs',
		defaultMessage: 'Resource Packs',
	},
})

const breadcrumbs = useBreadcrumbs()
const browseTitle = computed(() =>
	formatMessage(isFromWorlds.value ? messages.discoverServers : messages.discoverContent),
)
breadcrumbs.setName('BrowseTitle', browseTitle.value)
if (instance.value) {
	const instanceLink = `/instance/${encodeURIComponent(instance.value.path)}`
	breadcrumbs.setContext({
		name: instance.value.name,
		link: isFromWorlds.value ? `${instanceLink}/worlds` : instanceLink,
	})
} else {
	breadcrumbs.setContext(null)
}

onBeforeRouteLeave(() => {
	breadcrumbs.setContext({
		name: browseTitle.value,
		link: `/browse/${projectType.value}`,
		query: route.query,
	})
})

const projectType = ref<ProjectType>(route.params.projectType as ProjectType)

watch(
	() => route.params.projectType as ProjectType,
	async (newType) => {
		if (isSetupServerContext.value) {
			enforceSetupModpackRoute(newType)
			if (newType !== 'modpack') return
		}

		if (!newType || newType === projectType.value) return

		debugLog('projectType route param changed', { from: projectType.value, to: newType })
		projectType.value = newType

		if (!route.query.i && instance.value) {
			debugLog('instance context removed, resetting')
			instance.value = null
			installedProjectIds.value = null
			instanceHideInstalled.value = false
			newlyInstalled.value = []
			isServerInstance.value = false
			breadcrumbs.setName('BrowseTitle', formatMessage(messages.discoverContent))
			breadcrumbs.setContext(null)
		}
	},
)

const selectableProjectTypes = computed(() => {
	let dataPacks = false,
		mods = false,
		modpacks = false

	if (instance.value) {
		if (
			availableGameVersions.value &&
			availableGameVersions.value.findIndex((x) => x.version === instance.value?.game_version) <=
				availableGameVersions.value.findIndex((x) => x.version === '1.13') &&
			!isServerInstance.value
		) {
			dataPacks = true
		}

		if (instance.value.loader !== 'vanilla') {
			mods = true
		}
	} else {
		dataPacks = true
		mods = true
		modpacks = true
	}

	const params: LocationQuery = {}

	if (route.query.i) params.i = route.query.i
	if (route.query.ai) params.ai = route.query.ai
	if (route.query.from) params.from = route.query.from
	if (route.query.sid) params.sid = route.query.sid
	if (effectiveServerWorldId.value) params.wid = effectiveServerWorldId.value

	const queryString = new URLSearchParams(params as Record<string, string>).toString()
	const suffix = queryString ? `?${queryString}` : ''

	if (isSetupServerContext.value) {
		return [
			{ label: formatMessage(messages.modpacksProjectType), href: `/browse/modpack${suffix}` },
		]
	}

	if (isFromWorlds.value) {
		return [{ label: 'Servers', href: `/browse/server${suffix}` }]
	}

	return [
		{ label: formatMessage(messages.addonsProjectType), href: `/browse/bedrock/addon${suffix}` },
		{ label: formatMessage(messages.resourcePacksProjectType), href: `/browse/bedrock/resourcepack${suffix}` },
		{ label: 'Карты', href: `/browse/bedrock/world${suffix}` },
		{ label: 'Скины', href: `/browse/bedrock/skin${suffix}` },
		{ label: 'Скрипты', href: `/browse/bedrock/script${suffix}` },
	]
})

const installContext = computed(() => {
	if (isServerContext.value && serverContextServerData.value) {
		return {
			name: serverContextServerData.value.name,
			loader: serverContextServerData.value.loader ?? '',
			gameVersion: serverContextServerData.value.mc_version ?? '',
			serverId: serverIdQuery.value,
			upstream: serverContextServerData.value.upstream,
			iconSrc: null as string | null,
			isMedal: serverContextServerData.value.is_medal,
			backUrl: serverBackUrl.value,
			backLabel: serverBackLabel.value,
			heading: serverBrowseHeading.value,
			queuedCount: queuedServerInstallCount.value,
			selectedProjects: selectedServerInstallProjects.value,
			isInstallingSelected: isInstallingQueuedServerInstalls.value,
			installProgress: queuedInstallProgress.value,
			clearQueued: clearQueuedServerInstalls,
			clearSelected: clearQueuedServerInstalls,
			onBack: flushQueuedServerInstalls,
			discardSelectedAndBack: discardQueuedServerInstallsAndBack,
			installSelected: installQueuedServerInstallsAndBack,
		}
	}
	if (instance.value) {
		return {
			name: instance.value.name,
			loader: instance.value.loader,
			gameVersion: instance.value.game_version,
			iconSrc: instance.value.icon_path ? convertFileSrc(instance.value.icon_path) : null,
			backUrl: `/instance/${encodeURIComponent(instance.value.path)}${isFromWorlds.value ? '/worlds' : ''}`,
			backLabel: formatMessage(messages.backToInstance),
			heading: formatMessage(
				isFromWorlds.value ? messages.addServersToInstance : commonMessages.installingContentLabel,
			),
			warning:
				isServerInstance.value && !isFromWorlds.value
					? formatMessage(messages.serverInstanceContentWarning)
					: undefined,
		}
	}
	return null
})

const installingProjectIds = ref<Set<string>>(new Set())

function setProjectInstalling(projectId: string, installing: boolean) {
	const next = new Set(installingProjectIds.value)
	if (installing) {
		next.add(projectId)
	} else {
		next.delete(projectId)
	}
	installingProjectIds.value = next
}

const serverInstallQueue = {
	get: getQueuedServerInstallPlans,
	set: setQueuedServerInstallPlans,
}

function getCurrentSelectedInstallPreferences(projectTypeValue: string) {
	return getSelectedInstallPreferences({
		contentType: projectTypeValue,
		selectedFilters: searchState.currentFilters.value,
		providedFilters: combinedProvidedFilters.value,
		overriddenProvidedFilterTypes: searchState.overriddenProvidedFilterTypes.value,
	})
}

function getServerInstallTargetPreferences(contentType: BrowseInstallContentType) {
	return getTargetInstallPreferences(
		{
			gameVersion: serverContextServerData.value?.mc_version,
			loader: serverContextServerData.value?.loader,
		},
		contentType,
	)
}

function getInstanceInstallTargetPreferences(projectTypeValue: string) {
	return getTargetInstallPreferences(
		{
			gameVersion: instance.value?.game_version,
			loader: instance.value?.loader,
		},
		projectTypeValue,
	)
}

async function getInstallProjectVersions(projectId: string) {
	const project = await get_project(projectId, 'must_revalidate')
	return (await get_version_many(
		project.versions,
		'must_revalidate',
	)) as Labrinth.Versions.v2.Version[]
}

async function chooseInstanceInstallVersion(
	project: Labrinth.Search.v2.ResultSearchProject & Labrinth.Search.v3.ResultSearchProject,
	projectTypeValue: string,
) {
	const targetInstance = instance.value
	if (!targetInstance) {
		return { versionId: null as string | null }
	}

	const selectedPreferences = getCurrentSelectedInstallPreferences(projectTypeValue)
	const targetPreferences = getInstanceInstallTargetPreferences(projectTypeValue)
	if (!preferencesDiffer(selectedPreferences, targetPreferences)) {
		return { versionId: null as string | null }
	}

	const selectedVersion = getLatestMatchingInstallVersion(
		await getInstallProjectVersions(project.project_id),
		selectedPreferences,
		projectTypeValue,
	)

	if (!selectedVersion) {
		return { versionId: null as string | null }
	}

	return { versionId: selectedVersion.id }
}

function getCardActions(
	result: Labrinth.Search.v2.ResultSearchProject | Labrinth.Search.v3.ResultSearchProject,
	currentProjectType: string,
): CardAction[] {
	if (currentProjectType === 'server') {
		return getServerCardActions(result as Labrinth.Search.v3.ResultSearchProject)
	}

	// Non-server project actions
	const projectResult = result as (Labrinth.Search.v2.ResultSearchProject &
		Labrinth.Search.v3.ResultSearchProject) & {
		installed?: boolean
		installing?: boolean
	}
	const isInstalled =
		projectResult.installed ||
		allInstalledIds.value.has(projectResult.project_id || '') ||
		serverContentProjectIds.value.has(projectResult.project_id || '') ||
		serverContextServerData.value?.upstream?.project_id === projectResult.project_id
	const isInstalling = installingProjectIds.value.has(projectResult.project_id)

	if (
		isServerContext.value &&
		['modpack', 'mod', 'plugin', 'datapack'].includes(currentProjectType)
	) {
		const isQueued = queuedServerInstallProjectIds.value.has(projectResult.project_id)
		const isInstallingSelection = isInstallingQueuedServerInstalls.value
		const validatingInstall =
			isInstalling && currentProjectType !== 'modpack' && !isInstallingSelection
		const installLabel = isInstalled
			? commonMessages.installedLabel
			: isQueued
				? isInstalling || isInstallingSelection
					? validatingInstall
						? commonMessages.validatingLabel
						: messages.installingToServer
					: commonMessages.selectedLabel
				: isInstalling || isInstallingSelection
					? validatingInstall
						? commonMessages.validatingLabel
						: messages.installingToServer
					: commonMessages.installButton
		return [
			{
				key: 'install',
				label: formatMessage(installLabel),
				icon:
					isInstalling || isInstallingSelection
						? SpinnerIcon
						: isQueued || isInstalled
							? CheckIcon
							: PlusIcon,
				iconClass: isInstalling || isInstallingSelection ? 'animate-spin' : undefined,
				disabled: isInstalled || isInstalling || isInstallingSelection,
				color: isQueued && !isInstalling && !isInstallingSelection ? 'green' : 'brand',
				type: 'outlined',
				onClick: async () => {
					if (isQueued) {
						removeQueuedServerInstall(projectResult.project_id)
						return
					}

					const contentType = currentProjectType as BrowseInstallContentType
					const isModpack = contentType === 'modpack'
					const shouldShowInstalling = isModpack || !isQueued
					if (shouldShowInstalling) {
						setProjectInstalling(projectResult.project_id, true)
					}
					try {
						await requestInstall({
							project: projectResult,
							contentType,
							mode: isModpack ? 'immediate' : 'queue',
							selectedFilters: isModpack ? [] : searchState.currentFilters.value,
							providedFilters: isModpack ? [] : combinedProvidedFilters.value,
							overriddenProvidedFilterTypes: isModpack
								? []
								: searchState.overriddenProvidedFilterTypes.value,
							targetPreferences: getServerInstallTargetPreferences(contentType),
							getProjectVersions: getInstallProjectVersions,
							queue: serverInstallQueue,
							install: (plan) =>
								openServerModpackInstallFlow({
									projectId: plan.projectId,
									versionId: plan.versionId,
									name: plan.project.name,
									iconUrl: plan.project.icon_url ?? undefined,
								}),
						})
					} catch (err) {
						handleError(err as Error)
					} finally {
						if (shouldShowInstalling) {
							setProjectInstalling(projectResult.project_id, false)
						}
					}
				},
			},
		]
	}

	const isModpack = projectResult.project_types?.includes('modpack')
	const shouldUseInstallIcon = !!instance.value || isModpack

	return [
		{
			key: 'install',
			label: formatMessage(
				isInstalling
					? messages.installingToServer
					: isInstalled
						? commonMessages.installedLabel
						: shouldUseInstallIcon
							? commonMessages.installButton
							: messages.addToAnInstance,
			),
			icon: isInstalling ? SpinnerIcon : isInstalled ? CheckIcon : PlusIcon,
			iconClass: isInstalling ? 'animate-spin' : undefined,
			disabled: isInstalled || isInstalling,
			color: 'brand',
			type: 'outlined',
			onClick: async () => {
				setProjectInstalling(projectResult.project_id, true)
				try {
					const modId = parseInt(projectResult.project_id)
					if (!isNaN(modId) && instance.value) {
						const files: any[] = await invoke('plugin:bedrock-addons|get_bedrock_curseforge_addon_files', { modId })
						if (files && files.length > 0) {
							const downloadUrl = files[0].downloadUrl
							if (downloadUrl) {
								await invoke('plugin:bedrock-addons|download_and_install_bedrock_curseforge_addon', {
									profilePath: instance.value.path,
									downloadUrl,
								})
								onSearchResultsInstalled([projectResult.project_id])
							} else {
								throw new Error('Download URL not found for this project.')
							}
						} else {
							throw new Error('No files found for this project.')
						}
					}
				} catch (err) {
					handleError(err as Error)
				} finally {
					setProjectInstalling(projectResult.project_id, false)
				}
			},
		},
	]
}

function onSearchResultInstalled(id: string) {
	if (isServerContext.value) {
		markServerProjectInstalled(id)
		return
	}
	if (!newlyInstalled.value.includes(id)) {
		newlyInstalled.value = [...newlyInstalled.value, id]
	}
}

function onSearchResultsInstalled(ids: string[]) {
	if (isServerContext.value) {
		for (const id of ids) {
			markServerProjectInstalled(id)
		}
		return
	}
	newlyInstalled.value = Array.from(new Set([...newlyInstalled.value, ...ids]))
}

import { invoke } from '@tauri-apps/api/core'

async function search(requestParams: string) {
	debugLog('searching curseforge', requestParams)

	const params = new URLSearchParams(requestParams)
	const query = params.get('query') || ''
	const pt = projectType.value

	let classId: number | null = 4984
	if (pt === 'resourcepack') {
		classId = 6929
	} else if (pt === 'addon' || pt === 'mod') {
		classId = 4984
	} else if (pt === 'world' || pt === 'map') {
		classId = 6913
	} else if (pt === 'skin') {
		classId = 6925
	} else if (pt === 'script') {
		classId = 6940
	}

	let categoryId: number | null = null
	const facetsStr = params.get('facets')
	if (facetsStr) {
		try {
			const parsed = JSON.parse(facetsStr)
			for (const group of parsed) {
				for (const item of group) {
					if (typeof item === 'string' && item.startsWith('categories:')) {
						const catVal = item.replace('categories:', '')
						const parsedCat = parseInt(catVal)
						if (!isNaN(parsedCat)) {
							categoryId = parsedCat
						}
					}
				}
			}
		} catch (e) {}
	}
	if (!categoryId && params.get('f')) {
		const fVal = params.get('f')
		if (fVal?.includes('categories:')) {
			const parsedCat = parseInt(fVal.split('categories:')[1])
			if (!isNaN(parsedCat)) categoryId = parsedCat
		}
	}

	let gameVersionFilter: string | null = params.get('v') || null
	if (!gameVersionFilter && facetsStr) {
		try {
			const parsed = JSON.parse(facetsStr)
			for (const group of parsed) {
				for (const item of group) {
					if (typeof item === 'string') {
						if (item.startsWith('versions:')) {
							gameVersionFilter = item.replace('versions:', '')
						} else if (item.startsWith('game_versions:')) {
							gameVersionFilter = item.replace('game_versions:', '')
						}
					}
				}
			}
		} catch (e) {}
	}
	if (!gameVersionFilter && instance.value?.game_version) {
		gameVersionFilter = instance.value.game_version
	}

	const page = parseInt(params.get('page') || '1')
	const limit = parseInt(params.get('limit') || '20')
	const offset = (page - 1) * limit

	let sortField = 1
	const indexSort = params.get('index')
	if (indexSort === 'downloads') {
		sortField = 6
	} else if (indexSort === 'updated' || indexSort === 'newest') {
		sortField = 3
	} else if (indexSort === 'name') {
		sortField = 4
	} else {
		sortField = 6
	}

	const searchRes: { data: any[]; totalCount: number } = await invoke(
		'plugin:bedrock-addons|search_bedrock_curseforge_addons',
		{
			query,
			categoryId,
			classId,
			gameVersion: gameVersionFilter,
			sortField,
			sortOrder: 'desc',
			index: offset,
			pageSize: limit,
		},
	)

	const hits = (searchRes.data || []).map((hit: any) => {
		let authorName = ''
		let authorUrl = ''
		if (hit.authors && hit.authors.length > 0) {
			authorName = hit.authors[0].name
			authorUrl = hit.authors[0].url || `https://www.curseforge.com/members/${hit.authors[0].name}`
		}
		const websiteUrl = `https://www.curseforge.com/minecraft/mc-addons/${hit.slug}`

		const mapped = {
			project_id: hit.id.toString(),
			slug: hit.slug,
			name: hit.name,
			title: hit.name,
			summary: hit.summary,
			description: hit.summary,
			downloads: hit.downloadCount,
			icon_url: hit.logo?.thumbnailUrl || hit.logo?.url,
			categories: hit.categories?.map((c: any) => c.id?.toString() || c.slug),
			project_types: [pt],
			author: authorName,
			author_details: {
				name: authorName || 'CurseForge Creator',
				link: authorUrl || websiteUrl,
			},
			website_url: websiteUrl,
			is_curseforge: true,
		} as unknown as Labrinth.Search.v2.ResultSearchProject & { installed?: boolean }

		if (instance.value) {
			const installedIds = new Set([...newlyInstalled.value, ...(installedProjectIds.value ?? [])])
			mapped.installed = installedIds.has(mapped.project_id)
		}

		return mapped
	})

	return {
		projectHits: hits,
		serverHits: [],
		total_hits: searchRes.totalCount || hits.length,
		per_page: limit,
	}
}

const isServerFilterContext = computed(() => isServerContext.value || isServerInstance.value)

const lockedFilterMessages = computed(() => ({
	gameVersion: formatMessage(
		isServerFilterContext.value
			? messages.gameVersionProvidedByServer
			: messages.gameVersionProvidedByInstance,
	),
	modLoader: formatMessage(
		isServerFilterContext.value
			? messages.modLoaderProvidedByServer
			: messages.modLoaderProvidedByInstance,
	),
	environment: formatMessage(messages.environmentProvidedByServer),
	syncButton: formatMessage(messages.syncFilterButton),
	providedBy: formatMessage(
		isServerFilterContext.value ? messages.providedByServer : messages.providedByInstance,
	),
}))

const searchState = useBrowseSearch({
	projectType,
	tags,
	providedFilters: combinedProvidedFilters,
	search,
	persistentQueryParams: ['i', 'ai', 'shi', 'sid', 'wid', 'from'],
	getExtraQueryParams: () => ({
		sid: serverIdQuery.value || undefined,
		wid: effectiveServerWorldId.value || undefined,
		ai: instanceHideInstalled.value ? 'true' : undefined,
		shi: serverHideInstalled.value ? 'true' : undefined,
	}),
})

watch(
	[
		() => searchState.query.value,
		() => searchState.currentFilters.value,
		() => searchState.serverCurrentFilters.value,
		() => projectType.value,
	],
	() => {
		if (isServerContext.value) {
			syncHiddenServerContentProjectIds()
		} else if (instance.value) {
			syncHiddenInstanceProjectIds()
		}
	},
	{ deep: true },
)

watch(queuedServerInstallCount, (count) => {
	if (count === 0) {
		hideSelectedServerInstalls.value = false
	}
})

if (instance.value?.game_version) {
	const gv = instance.value.game_version
	const alreadyHasGv = searchState.serverCurrentFilters.value.some(
		(f) => f.type === 'server_game_version' && f.option === gv,
	)
	if (!alreadyHasGv) {
		searchState.serverCurrentFilters.value.push({ type: 'server_game_version', option: gv })
	}
}

await searchState.refreshSearch()

type UnlistenFn = () => void

let isUnmounted = false
let unlistenProfiles: UnlistenFn | null = null

onMounted(() => {
	profile_listener(async (event: { event: string; profile_path_id: string }) => {
		if (
			instance.value &&
			event.profile_path_id === instance.value.path &&
			event.event === 'synced'
		) {
			await refreshInstalledProjectIds()
			await searchState.refreshSearch()
		}
	})
		.then((unlisten) => {
			if (isUnmounted) {
				unlisten()
				return
			}

			unlistenProfiles = unlisten
		})
		.catch(handleError)
})

onUnmounted(() => {
	isUnmounted = true
	unlistenProfiles?.()
})

function getProjectBrowseQuery() {
	if (!installContext.value) return undefined
	return {
		...route.query,
		b: route.fullPath,
	}
}

provideBrowseManager({
	tags,
	projectType,
	...searchState,
	getProjectLink: (result: Labrinth.Search.v2.ResultSearchProject) => ({
		path: `/project/${result.project_id ?? result.slug}`,
		query: getProjectBrowseQuery(),
	}),
	getServerProjectLink: (result: Labrinth.Search.v3.ResultSearchProject) => ({
		path: `/project/${result.slug ?? result.project_id}`,
		query: getProjectBrowseQuery(),
	}),
	selectableProjectTypes,
	showProjectTypeTabs: computed(() => !isServerContext.value),
	variant: 'app',
	getCardActions,
	installContext,
	providedFilters: combinedProvidedFilters,
	hideInstalled: computed({
		get: () => (isServerContext.value ? serverHideInstalled.value : instanceHideInstalled.value),
		set: (val: boolean) => {
			if (isServerContext.value) {
				serverHideInstalled.value = val
				if (val) syncHiddenServerContentProjectIds()
			} else {
				instanceHideInstalled.value = val
				if (val) syncHiddenInstanceProjectIds()
			}
		},
	}),
	showHideInstalled: computed(
		() => (isServerContext.value && projectType.value !== 'modpack') || !!instance.value,
	),
	hideInstalledLabel: computed(() =>
		formatMessage(
			isFromWorlds.value ? messages.hideAddedServers : commonMessages.hideInstalledContentLabel,
		),
	),
	hideSelected: hideSelectedServerInstalls,
	showHideSelected: computed(
		() =>
			isServerContext.value &&
			projectType.value !== 'modpack' &&
			queuedServerInstallCount.value > 0,
	),
	hideSelectedLabel: computed(() => formatMessage(commonMessages.hideSelectedContentLabel)),
	onInstalled: onSearchResultInstalled,
	serverPings,
	getServerModpackContent,
	onContextMenu: handleRightClick,
	offline,
	lockedFilterMessages,
})
</script>

<template>
	<div class="flex flex-col gap-3 p-6">
		<BrowsePageLayout>
			<template #after>
				<ContextMenu ref="contextMenuRef" @option-clicked="handleOptionsClick">
					<template #open_link>
						<GlobeIcon /> {{ formatMessage(commonMessages.openInModrinthButton) }} <ExternalIcon />
					</template>
					<template #copy_link>
						<ClipboardCopyIcon /> {{ formatMessage(commonMessages.copyLinkButton) }}
					</template>
				</ContextMenu>
			</template>
		</BrowsePageLayout>
		<CreationFlowModal
			v-if="isServerContext && projectType === 'modpack'"
			ref="serverSetupModalRef"
			:type="serverFlowFrom === 'reset-server' ? 'reset-server' : 'server-onboarding'"
			:available-loaders="['vanilla', 'fabric', 'neoforge', 'forge', 'quilt', 'paper', 'purpur']"
			:show-snapshot-toggle="true"
			:on-back="onServerFlowBack"
			:search-modpacks="searchServerModpacks"
			:get-project-versions="getServerProjectVersions"
			:get-loader-manifest="getLoaderManifest"
			@hide="() => {}"
			@browse-modpacks="() => {}"
			@create="handleServerModpackFlowCreate"
		/>
		<Teleport to="#sidebar-teleport-target">
			<BrowseSidebar />
		</Teleport>
	</div>
</template>
