<template>
	<div v-if="data">
		<Teleport to="#sidebar-teleport-target">
			<ProjectSidebarCompatibility
				v-if="!isServerProject"
				:project="data"
				:tags="{ loaders: allLoaders, gameVersions: allGameVersions }"
				:project-v3="projectV3"
				class="project-sidebar-section"
			/>
			<ProjectSidebarServerInfo
				v-if="isServerProject"
				:project-v3="projectV3"
				:tags="{ loaders: allLoaders, gameVersions: allGameVersions }"
				:required-content="serverRequiredContent"
				:recommended-version="serverRecommendedVersion"
				:supported-versions="serverSupportedVersions"
				:loaders="serverModpackLoaders"
				:ping="serverPing"
				:status-online="serverStatusOnline"
				class="project-sidebar-section"
			/>
			<ProjectSidebarLinks
				link-target="_blank"
				:project="data"
				:project-v3="projectV3"
				class="project-sidebar-section"
			/>
			<ProjectSidebarTags :project="data" class="project-sidebar-section" />
			<ProjectSidebarCreators
				:organization="organization"
				:members="members"
				:org-link="(slug) => `https://modrinth.com/organization/${slug}`"
				:user-link="(username) => data?.is_curseforge ? (data?.author_details?.link || `https://www.curseforge.com/members/${username}`) : `https://modrinth.com/user/${username}`"
				link-target="_blank"
				class="project-sidebar-section"
			/>
			<ProjectSidebarDetails
				:project="data"
				:has-versions="versions.length > 0"
				:link-target="`_blank`"
				:hide-license="isServerProject"
				:show-followers="isServerProject"
				class="project-sidebar-section"
			/>
		</Teleport>
		<div class="flex flex-col gap-4 p-6">
			<div
				v-if="projectInstallContext"
				class="sticky top-0 z-20 -mx-6 -mt-6 rounded-tl-[--radius-xl] border-0 border-b border-solid bg-surface-1 p-3 border-surface-5"
			>
				<BrowseInstallHeader :install-context="projectInstallContext">
					<template #actions>
						<ButtonStyled
							circular
							size="large"
							:color="isTranslated ? 'brand' : 'surface'"
						>
							<button
								v-tooltip="isTranslated ? 'Показать оригинал' : 'Перевести на русский'"
								:aria-label="isTranslated ? 'Показать оригинал' : 'Перевести на русский'"
								@click="toggleTranslation(data)"
							>
								<SpinnerIcon v-if="isTranslating" class="animate-spin text-lg" />
								<svg
									v-else
									xmlns="http://www.w3.org/2000/svg"
									width="20"
									height="20"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									class="icon icon-tabler icons-tabler-outline icon-tabler-language-hiragana"
								>
									<path stroke="none" d="M0 0h24v24H0z" fill="none" />
									<path d="M4 5h7" />
									<path d="M7 4c0 4.846 0 7 .5 8" />
									<path d="M10 8.5c0 2.286 -2 4.5 -3.5 4.5s-2.5 -1.135 -2.5 -2c0 -2 1 -3 3 -3s5 .57 5 2.857c0 1.524 -.667 2.571 -2 3.143" />
									<path d="M12 20l4 -9l4 9" />
									<path d="M19.1 18h-6.2" />
								</svg>
							</button>
						</ButtonStyled>
					</template>
				</BrowseInstallHeader>
			</div>
			<InstanceIndicator v-if="instance && !projectInstallContext" :instance="instance" />
			<template v-if="data">
				<Teleport
					v-if="themeStore.featureFlags.project_background"
					to="#background-teleport-target"
				>
					<ProjectBackgroundGradient :project="data" />
				</Teleport>
				<ProjectHeader
					v-else
					:project="data"
					:project-v3="projectV3"
					:ping="serverPing"
					@contextmenu.prevent.stop="handleRightClick"
				>
					<template v-if="isServerProject" #actions>
						<ButtonStyled v-if="serverPlaying" size="large" color="red">
							<button @click="handleStopServer">
								<StopCircleIcon />
								{{ formatMessage(commonMessages.stopButton) }}
							</button>
						</ButtonStyled>
						<ButtonStyled v-else size="large" color="brand">
							<button
								:disabled="data && installingServerProjects.includes(data.id)"
								@click="handleClickPlay"
							>
								<PlayIcon />
								{{
									data && installingServerProjects.includes(data.id)
										? formatMessage(commonMessages.installingLabel)
										: formatMessage(commonMessages.playButton)
								}}
							</button>
						</ButtonStyled>
						<ButtonStyled size="large" circular>
							<button
								v-tooltip="formatMessage(commonMessages.addServerToInstanceButton)"
								@click="handleAddServerToInstance"
							>
								<PlusIcon />
							</button>
						</ButtonStyled>
						<ButtonStyled size="large" circular type="transparent">
							<OverflowMenu
								:tooltip="`More options`"
								:options="[
									{
										id: 'open-in-browser',
										link: data?.is_curseforge ? data?.website_url : `https://modrinth.com/project/${data?.slug}`,
										external: true,
									},
									{
										divider: true,
									},
									{
										id: 'report',
										color: 'red',
										hoverFilled: true,
										link: data?.is_curseforge ? data?.website_url : `https://modrinth.com/report?item=project&itemID=${data?.id}`,
									},
								]"
								aria-label="More options"
							>
								<MoreVerticalIcon aria-hidden="true" />
								<template #open-in-browser> <ExternalIcon /> Open in browser </template>
								<template #report> <ReportIcon /> Report </template>
							</OverflowMenu>
						</ButtonStyled>
					</template>
					<template v-else #actions>
						<ButtonStyled size="large" color="brand">
							<button
								v-tooltip="installButtonTooltip"
								:disabled="installButtonDisabled"
								@click="install(null)"
							>
								<SpinnerIcon
									v-if="installButtonLoading && !installButtonInstalled"
									class="animate-spin"
								/>
								<DownloadIcon v-else-if="!installButtonInstalled && !serverProjectSelected" />
								<CheckIcon v-else />
								{{ installButtonLabel }}
							</button>
						</ButtonStyled>
						<ButtonStyled size="large" circular type="transparent">
							<OverflowMenu
								:tooltip="`More options`"
								:options="[
									{
										id: 'follow',
										disabled: true,
										tooltip: 'Coming soon',
										action: () => {},
									},
									{
										id: 'save',
										disabled: true,
										tooltip: 'Coming soon',
										action: () => {},
									},
									{
										id: 'open-in-browser',
										link: data?.is_curseforge ? data?.website_url : `https://modrinth.com/${data?.project_type || 'mod'}/${data?.slug || ''}`,
										external: true,
									},
									{
										divider: true,
									},
									{
										id: 'report',
										color: 'red',
										hoverFilled: true,
										link: data?.is_curseforge ? data?.website_url : `https://modrinth.com/report?item=project&itemID=${data?.id || ''}`,
									},
								]"
								aria-label="More options"
							>
								<MoreVerticalIcon aria-hidden="true" />
								<template #open-in-browser> <ExternalIcon /> Open in browser </template>
								<template #follow> <HeartIcon /> Follow </template>
								<template #save> <BookmarkIcon /> Save </template>
								<template #report> <ReportIcon /> Report </template>
							</OverflowMenu>
						</ButtonStyled>
					</template>
				</ProjectHeader>
				<NavTabs
					:links="[
						{
							label: formatMessage(commonMessages?.descriptionTabLabel) || 'Description',
							href: projectDescriptionHref,
						},
						{
							label: formatMessage(commonMessages?.versionsTabLabel) || 'Versions',
							href: versionsHref,
							subpages: ['version'],
							shown: projectV3?.minecraft_server == null,
						},
						{
							label: formatMessage(commonMessages?.galleryTabLabel) || 'Gallery',
							href: projectGalleryHref,
							shown: (data?.gallery?.length ?? 0) > 0,
						},
					]"
				/>
				<RouterView
					v-if="route.path.startsWith('/project')"
					v-slot="{ Component }"
				>
					<component
						:is="Component"
						:key="route.fullPath"
						:project="data"
						:versions="versions"
						:members="members"
						:instance="instance"
						:install="install"
						:installed="installed"
						:installing="installing"
						:installed-version="installedVersion"
					/>
				</RouterView>
			</template>
			<template v-else> Project data couldn't not be loaded. </template>
		</div>
		<SelectedProjectsFloatingBar
			v-if="projectInstallContext"
			:install-context="projectInstallContext"
		/>
		<ContextMenu ref="options" @option-clicked="handleOptionsClick">
			<template #install>
				<DownloadIcon /> {{ formatMessage(commonMessages.installButton) }}
			</template>
			<template #open_link>
				<GlobeIcon /> {{ formatMessage(commonMessages.openInModrinthButton) }} <ExternalIcon />
			</template>
			<template #copy_link>
				<ClipboardCopyIcon /> {{ formatMessage(commonMessages.copyLinkButton) }}
			</template>
		</ContextMenu>
		<CreationFlowModal
			v-if="serverInstallContent.isServerContext.value && data?.project_type === 'modpack'"
			ref="serverSetupModalRef"
			:type="
				serverInstallContent.serverFlowFrom.value === 'reset-server'
					? 'reset-server'
					: 'server-onboarding'
			"
			:available-loaders="['vanilla', 'fabric', 'neoforge', 'forge', 'quilt', 'paper', 'purpur']"
			:show-snapshot-toggle="true"
			:on-back="serverInstallContent.onServerFlowBack"
			:search-modpacks="serverInstallContent.searchServerModpacks"
			:get-project-versions="serverInstallContent.getServerProjectVersions"
			:get-loader-manifest="getLoaderManifest"
			@hide="() => {}"
			@browse-modpacks="() => {}"
			@create="serverInstallContent.handleServerModpackFlowCreate"
		/>
	</div>
</template>

<script setup>
import { loadBedrockMetadataMap } from '@/composables/use-bedrock-metadata'
import {
	BookmarkIcon,
	CheckIcon,
	ClipboardCopyIcon,
	DownloadIcon,
	ExternalIcon,
	GlobeIcon,
	HeartIcon,
	MoreVerticalIcon,
	PlayIcon,
	PlusIcon,
	ReportIcon,
	SpinnerIcon,
	StopCircleIcon,
} from '@modrinth/assets'
import {
	BrowseInstallHeader,
	ButtonStyled,
	commonMessages,
	CreationFlowModal,
	defineMessages,
	getTargetInstallPreferences,
	injectNotificationManager,
	NavTabs,
	OverflowMenu,
	ProjectBackgroundGradient,
	ProjectHeader,
	ProjectSidebarCompatibility,
	ProjectSidebarCreators,
	ProjectSidebarDetails,
	ProjectSidebarLinks,
	ProjectSidebarServerInfo,
	ProjectSidebarTags,
	requestInstall,
	SelectedProjectsFloatingBar,
	useVIntl,
} from '@modrinth/ui'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ContextMenu from '@/components/ui/ContextMenu.vue'
import InstanceIndicator from '@/components/ui/InstanceIndicator.vue'
import {
	get_organization,
	get_project,
	get_project_v3,
	get_team,
	get_version,
	get_version_many,
} from '@/helpers/cache.js'
import { process_listener } from '@/helpers/events'
import { get_loader_versions as getLoaderManifest } from '@/helpers/metadata'
import { get_by_profile_path } from '@/helpers/process'
import {
	get as getInstance,
	get_projects as getInstanceProjects,
	kill,
	list as listInstances,
} from '@/helpers/profile'
import { get_categories, get_game_versions, get_loaders } from '@/helpers/tags'
import { getServerLatency } from '@/helpers/worlds'
import { injectContentInstall } from '@/providers/content-install'
import { injectServerInstall } from '@/providers/server-install'
import { createServerInstallContent } from '@/providers/setup/server-install-content'
import { useProjectTranslation } from '@/composables/use-project-translation'
import { useBreadcrumbs } from '@/store/breadcrumbs'
import { getServerAddress } from '@/store/install.js'
import { useTheming } from '@/store/state.js'

const { isTranslated, isTranslating, toggleTranslation } = useProjectTranslation()

dayjs.extend(relativeTime)

const { handleError } = injectNotificationManager()
const { install: installVersion } = injectContentInstall()
const route = useRoute()
const router = useRouter()
const breadcrumbs = useBreadcrumbs()
const themeStore = useTheming()
const { formatMessage } = useVIntl()

const messages = defineMessages({
	backToBrowse: {
		id: 'app.project.install-context.back-to-browse',
		defaultMessage: 'Back to discover',
	},
	installContentToInstance: {
		id: 'app.project.install-context.install-content-to-instance',
		defaultMessage: 'Install content to instance',
	},
	alreadyInstalled: {
		id: 'app.project.install-button.already-installed',
		defaultMessage: 'This project is already installed',
	},
})

const { installingServerProjects, playServerProject, showAddServerToInstanceModal } =
	injectServerInstall()
const installing = ref(false)
const data = shallowRef(null)
const versions = shallowRef([])
const members = shallowRef([])
const categories = shallowRef([])
const organization = shallowRef(null)
const instance = ref(null)
const instanceProjects = ref(null)

const installed = ref(false)
const installedVersion = ref(null)
const isServerProject = ref(false)
const projectV3 = shallowRef(null)
const serverRequiredContent = shallowRef(null)
const serverRecommendedVersion = shallowRef(null)
const serverSupportedVersions = shallowRef([])
const serverModpackLoaders = shallowRef([])
const serverPing = ref(undefined)
const serverStatusOnline = ref(false)
const serverInstancePath = ref(null)
const serverPlaying = ref(false)
const serverSetupModalRef = ref(null)
const serverInstallContent = createServerInstallContent({ serverSetupModalRef })

serverInstallContent.watchServerContextChanges()
await serverInstallContent.initServerContext()

const instanceFilters = computed(() => {
	if (!instance.value || !data.value) {
		return {}
	}

	const loaders = []
	if (data.value.project_type === 'mod') {
		if (instance.value.loader !== 'vanilla') {
			loaders.push(instance.value.loader)
		}
		if (instance.value.loader === 'vanilla' || (data.value.loaders || []).includes('datapack')) {
			loaders.push('datapack')
		}
	}

	return { l: loaders, g: instance.value.game_version }
})

function buildProjectHref(path, extraQuery = {}) {
	const params = new URLSearchParams()
	for (const [key, val] of Object.entries({ ...route.query, ...extraQuery })) {
		if (Array.isArray(val)) {
			for (const v of val) params.append(key, v)
		} else if (val) {
			params.append(key, String(val))
		}
	}
	const qs = params.toString()
	return qs ? `${path}?${qs}` : path
}

function buildBrowseHref(path) {
	const params = new URLSearchParams()
	for (const [key, val] of Object.entries(route.query)) {
		if (key === 'b') continue
		if (Array.isArray(val)) {
			for (const v of val) params.append(key, v)
		} else if (val) {
			params.append(key, String(val))
		}
	}
	const qs = params.toString()
	return qs ? `${path}?${qs}` : path
}

const projectDescriptionHref = computed(() => buildProjectHref(`/project/${route.params.id}`))
const versionsHref = computed(() =>
	buildProjectHref(`/project/${route.params.id}/versions`, instanceFilters.value),
)
const projectGalleryHref = computed(() => buildProjectHref(`/project/${route.params.id}/gallery`))

const projectBrowseBackUrl = computed(() => {
	const browsePath = route.query.b
	if (typeof browsePath === 'string' && browsePath.startsWith('/browse/')) return browsePath
	if (data.value?.is_curseforge || instance.value?.loader?.toLowerCase() === 'bedrock') {
		return buildBrowseHref('/browse/bedrock/addon')
	}
	const type = data.value?.project_type ? `${data.value.project_type}` : 'mod'
	return buildBrowseHref(`/browse/${type}`)
})

const projectInstallContext = computed(() => {
	const serverData = serverInstallContent.serverContextServerData.value
	if (serverData) {
		return {
			name: serverData.name,
			loader: serverData.loader ?? '',
			gameVersion: serverData.mc_version ?? '',
			serverId: serverInstallContent.serverIdQuery.value,
			upstream: serverData.upstream,
			iconSrc: null,
			isMedal: serverData.is_medal,
			backUrl: projectBrowseBackUrl.value,
			backLabel: formatMessage(messages.backToBrowse),
			heading: serverInstallContent.serverBrowseHeading.value,
			queuedCount: serverInstallContent.queuedServerInstallCount.value,
			selectedProjects: serverInstallContent.selectedServerInstallProjects.value,
			isInstallingSelected: serverInstallContent.isInstallingQueuedServerInstalls.value,
			installProgress: serverInstallContent.queuedInstallProgress.value,
			clearQueued: serverInstallContent.clearQueuedServerInstalls,
			clearSelected: serverInstallContent.clearQueuedServerInstalls,
			discardSelectedAndBack: serverInstallContent.discardQueuedServerInstallsAndBack,
			installSelected: serverInstallContent.installQueuedServerInstallsAndBack,
		}
	}

	if (instance.value) {
		return {
			name: instance.value.name,
			loader: instance.value.loader,
			gameVersion: instance.value.game_version,
			iconSrc: instance.value.icon_path ? convertFileSrc(instance.value.icon_path) : null,
			backUrl: projectBrowseBackUrl.value,
			backLabel: formatMessage(messages.backToBrowse),
			heading: formatMessage(messages.installContentToInstance),
		}
	}

	return null
})

const serverProjectInstallContext = computed(
	() =>
		!!serverInstallContent.serverContextServerData.value &&
		['modpack', 'mod', 'plugin', 'datapack'].includes(data.value?.project_type),
)
const serverProjectSelected = computed(
	() => !!data.value && serverInstallContent.queuedServerInstallProjectIds.value.has(data.value.id),
)
const serverProjectInstalled = computed(
	() =>
		!!data.value &&
		(serverInstallContent.serverContentProjectIds.value.has(data.value.id) ||
			serverInstallContent.serverContextServerData.value?.upstream?.project_id === data.value.id),
)
const installButtonLoading = computed(
	() => installing.value || serverInstallContent.isInstallingQueuedServerInstalls.value,
)
const installButtonValidating = computed(
	() =>
		serverProjectInstallContext.value &&
		installing.value &&
		data.value?.project_type !== 'modpack' &&
		!serverInstallContent.isInstallingQueuedServerInstalls.value,
)
const installButtonInstalled = computed(() =>
	serverProjectInstallContext.value ? serverProjectInstalled.value : installed.value,
)
const installButtonDisabled = computed(
	() => installButtonInstalled.value || installButtonLoading.value,
)
const installButtonLabel = computed(() => {
	if (installButtonInstalled.value) return formatMessage(commonMessages.installedLabel)
	if (installButtonValidating.value) return formatMessage(commonMessages.validatingLabel)
	if (installButtonLoading.value) return formatMessage(commonMessages.installingLabel)
	if (serverProjectSelected.value) return formatMessage(commonMessages.selectedLabel)
	return formatMessage(commonMessages.installButton)
})
const installButtonTooltip = computed(() => {
	if (installButtonInstalled.value) return formatMessage(messages.alreadyInstalled)
	return null
})

const [allLoaders, allGameVersions] = await Promise.all([
	get_loaders().catch(handleError).then(ref),
	get_game_versions().catch(handleError).then(ref),
])

async function handleClickPlay() {
	if (!isServerProject.value) return
	await playServerProject(data.value.id).catch(handleError)
	await updateServerPlayState()
}

async function updateServerPlayState() {
	if (!isServerProject.value || !data.value) return
	const packs = await listInstances()
	const inst = packs.find((p) => p.linked_data?.project_id === data.value.id)
	if (inst) {
		serverInstancePath.value = inst.path
		const processes = await get_by_profile_path(inst.path).catch(() => [])
		serverPlaying.value = Array.isArray(processes) && processes.length > 0
	} else {
		serverInstancePath.value = null
		serverPlaying.value = false
	}
}

async function handleStopServer() {
	if (!serverInstancePath.value) return
	await kill(serverInstancePath.value).catch(() => {})
	serverPlaying.value = false
}

function handleAddServerToInstance() {
	const address = getServerAddress(projectV3.value?.minecraft_java_server)
	if (!address || !data.value) return
	showAddServerToInstanceModal(data.value.title, address)
}

async function fetchProjectData() {
	let project = null
	let projectV3Result = null
	const rawId = String(route.params.id || '')
	const cleanId = rawId.replace(/^curseforge[-:]?/, '')
	const digitsOnly = cleanId.replace(/[^0-9]/g, '')
	const isNumericId = digitsOnly.length > 0 && digitsOnly === cleanId

	if (!isNumericId) {
		project = await get_project(rawId, 'must_revalidate').catch(() => null)
		projectV3Result = await get_project_v3(rawId, 'must_revalidate').catch(() => null)
	}

	if (!project) {
		let cfModId = isNumericId ? parseInt(digitsOnly, 10) : NaN
		if (isNaN(cfModId)) {
			try {
				const searchRes = await invoke('plugin:bedrock-addons|search_bedrock_curseforge_addons', {
					query: rawId,
				}).catch(() => null)
				const list = Array.isArray(searchRes) ? searchRes : (searchRes?.data || [])
				if (list.length > 0) {
					cfModId = list[0].id
				}
			} catch (e) {
				console.error('Failed to search CurseForge by slug:', e)
			}
		}

		if (!isNaN(cfModId)) {
			try {
				const [cfMod, cfFiles, cfDescription] = await Promise.all([
					invoke('plugin:bedrock-addons|get_bedrock_curseforge_addon', { modId: cfModId }).catch(() => null),
					invoke('plugin:bedrock-addons|get_bedrock_curseforge_addon_files', { modId: cfModId }).catch(() => []),
					invoke('plugin:bedrock-addons|get_bedrock_curseforge_addon_description', { modId: cfModId }).catch(() => ''),
				])

				if (cfMod) {
					let authorName = 'CurseForge Creator'
					let authorUrl = `https://www.curseforge.com/minecraft/mc-addons/${cfMod.slug}`
					let authorAvatar = cfMod.authors?.[0]?.avatarUrl || cfMod.authors?.[0]?.avatar_url || cfMod.logo?.thumbnailUrl || cfMod.logo?.url
					if (cfMod.authors && cfMod.authors.length > 0) {
						authorName = cfMod.authors[0].name
						authorUrl = cfMod.authors[0].url || authorUrl
					}

					const rawSum = cfMod.summary || ''
					const cleanSummary = rawSum
						.replace(/<script[\s\S]*?<\/script>/gi, '')
						.replace(/<style[\s\S]*?<\/style>/gi, '')
						.replace(/<[^>]+>/g, ' ')
						.replace(/&nbsp;/gi, ' ')
						.replace(/&amp;/gi, '&')
						.replace(/&lt;/gi, '<')
						.replace(/&gt;/gi, '>')
						.replace(/&quot;/gi, '"')
						.replace(/&#39;/gi, "'")
						.replace(/\s+/g, ' ')
						.trim()

					project = {
						id: cfMod.id.toString(),
						slug: cfMod.slug,
						project_type: 'addon',
						title: cfMod.name,
						name: cfMod.name,
						summary: cleanSummary,
						description: cfDescription || cleanSummary,
						body: cfDescription || cleanSummary,
						downloads: cfMod.downloadCount || 0,
						followers: 0,
						icon_url: cfMod.logo?.thumbnailUrl || cfMod.logo?.url,
						categories: cfMod.categories?.map((c) => c.name || c.slug) || [],
						additional_categories: [],
						versions: (cfFiles || []).map((f) => f.id.toString()),
						author: authorName,
						author_details: {
							name: authorName,
							avatar_url: authorAvatar,
							link: authorUrl,
						},
						published: cfMod.dateCreated || cfMod.dateReleased || cfMod.dateModified || new Date().toISOString(),
						created: cfMod.dateCreated || cfMod.dateReleased || cfMod.dateModified || new Date().toISOString(),
						updated: cfMod.dateModified || cfMod.dateCreated || cfMod.dateReleased || new Date().toISOString(),
						approved: cfMod.dateReleased || cfMod.dateCreated || cfMod.dateModified || new Date().toISOString(),
						license: { id: 'Custom', name: 'Custom License', url: '' },
						website_url: cfMod.websiteUrl || `https://www.curseforge.com/minecraft/mc-addons/${cfMod.slug}`,
						is_curseforge: true,
						gallery: [],
						client_side: 'required',
						server_side: 'optional',
						loaders: ['bedrock'],
						game_versions: [],
					}

					versions.value = (cfFiles || []).map((f) => ({
						id: f.id.toString(),
						project_id: cfMod.id.toString(),
						name: f.displayName || f.fileName,
						version_number: f.displayName || f.fileName,
						version_type: 'release',
						downloads: f.downloadCount ?? cfMod.downloadCount ?? 0,
						game_versions: (f.gameVersions || []).map((v) => v.replace(/^MC\s*/i, '')),
						loaders: ['bedrock'],
						files: [
							{
								id: f.id.toString(),
								url: f.downloadUrl,
								filename: f.fileName,
								size: f.fileLength,
								primary: true,
							},
						],
						date_published: f.fileDate
							? new Date(f.fileDate).toISOString()
							: cfMod.dateCreated
							? new Date(cfMod.dateCreated).toISOString()
							: new Date().toISOString(),
					}))

					members.value = [
						{
							id: 'cf_' + authorName,
							role: 'Creator',
							is_owner: true,
							user: {
								id: 'cf_' + authorName,
								username: authorName,
								name: authorName,
								avatar_url: authorAvatar,
							},
						},
					]
				}
			} catch (e) {
				console.error('Failed to load CurseForge mod:', e)
			}
		}
	}

	if (!project) {
		const rawName = decodeURIComponent(String(route.params.id || ''))
		const metaMap = route.query.i ? loadBedrockMetadataMap(String(route.query.i)) : {}
		const meta = metaMap[rawName.toLowerCase()] || metaMap[rawName.replace(/§[0-9a-fk-or]/gi, '').trim().toLowerCase()]
		const authorName = meta?.author || undefined
		const avatarUrl = meta?.avatarUrl || meta?.iconUrl || undefined
		const cleanTitle = meta?.name || meta?.title || meta?.slug || rawName.replace(/§[0-9a-fk-or]/gi, '').trim()

		project = {
			id: rawName,
			slug: meta?.slug || rawName,
			project_type: 'addon',
			title: cleanTitle,
			name: cleanTitle,
			summary: meta?.summary || meta?.description || 'Bedrock Addon',
			description: meta?.description || meta?.summary || 'Bedrock Addon',
			body: meta?.body || meta?.description || meta?.summary || 'Bedrock Addon',
			downloads: meta?.downloads ?? 0,
			followers: meta?.followers ?? 0,
			icon_url: avatarUrl,
			categories: meta?.categories || [],
			additional_categories: [],
			versions: meta?.version ? [meta.version] : ['1.0.0'],
			author: authorName,
			author_details: authorName
				? {
						name: authorName,
						avatar_url: avatarUrl,
						link: meta?.projectUrl || (meta?.is_curseforge ? `https://www.curseforge.com/members/${encodeURIComponent(authorName)}` : ''),
					}
				: undefined,
			published: meta?.published || new Date().toISOString(),
			created: meta?.created || new Date().toISOString(),
			updated: meta?.updated || new Date().toISOString(),
			approved: new Date().toISOString(),
			license: { id: 'Custom', name: 'Custom License', url: '' },
			website_url: meta?.projectUrl || '',
			is_curseforge: !!meta?.is_curseforge,
			gallery: meta?.gallery || [],
			client_side: 'required',
			server_side: 'optional',
			loaders: ['bedrock'],
			game_versions: meta?.game_versions || [],
		}

		members.value = authorName
			? [
					{
						id: 'author_' + authorName,
						role: 'Creator',
						is_owner: true,
						user: {
							id: 'author_' + authorName,
							username: authorName,
							name: authorName,
							avatar_url: avatarUrl,
						},
					},
				]
			: []
	}

	if (!project) {
		handleError('Error loading project')
		return
	}

	data.value = project
	projectV3.value = projectV3Result

	if (!project.is_curseforge) {
		const fetches = [
			get_version_many(project.versions, 'must_revalidate').catch(handleError),
			project.team ? get_team(project.team).catch(handleError) : Promise.resolve(members.value),
			get_categories().catch(handleError),
			route.query.i ? getInstance(route.query.i).catch(handleError) : Promise.resolve(),
			route.query.i ? getInstanceProjects(route.query.i).catch(handleError) : Promise.resolve(),
		]

		const [vRes, mRes, cRes, iRes, ipRes] = await Promise.all(fetches)
		versions.value = vRes || []
		if (mRes) members.value = mRes
		categories.value = cRes || []
		instance.value = iRes
		instanceProjects.value = ipRes

		versions.value = (versions.value || []).sort(
			(a, b) => dayjs(b.date_published) - dayjs(a.date_published),
		)
	} else {
		;[categories.value, instance.value, instanceProjects.value] = await Promise.all([
			get_categories().catch(handleError),
			route.query.i ? getInstance(route.query.i).catch(handleError) : Promise.resolve(),
			route.query.i ? getInstanceProjects(route.query.i).catch(handleError) : Promise.resolve(),
		])
	}

	if (instanceProjects.value && data.value) {
		const targetId = String(data.value.id || '')
		const targetSlug = String(data.value.slug || '').toLowerCase()
		const installedFile = Object.values(instanceProjects.value).find(
			(x) =>
				x?.metadata &&
				(String(x.metadata.project_id) === targetId ||
					String(x.metadata.project_id || '').toLowerCase() === targetSlug ||
					String(x.metadata.slug || '').toLowerCase() === targetSlug),
		)
		if (installedFile) {
			installed.value = true
			installedVersion.value = installedFile.metadata?.version_id
		}
	}

	if (instance.value && data.value) {
		try {
			const bedrockAddons = await invoke('plugin:bedrock-addons|list_bedrock_addons', {
				profilePath: instance.value.path,
			}).catch(() => [])
			if (bedrockAddons && bedrockAddons.length > 0) {
				const projectTitleNorm = (data.value.title || '').toLowerCase().trim()
				const projectSlugNorm = (data.value.slug || '').toLowerCase().trim()
				const projectIdNorm = String(data.value.id || '').toLowerCase().trim()
				const isInstalledInBedrock = bedrockAddons.some((addon) => {
					const nameNorm = (addon.name || '').toLowerCase().trim()
					const subPathNorm = (addon.sub_path || '').toLowerCase().trim()
					return (
						(nameNorm && (nameNorm.includes(projectTitleNorm) || projectTitleNorm.includes(nameNorm))) ||
						(subPathNorm && (subPathNorm.includes(projectSlugNorm) || subPathNorm.includes(projectIdNorm)))
					)
				})
				if (isInstalledInBedrock) {
					installed.value = true
				}
			}
		} catch (e) {
			console.error('Error checking Bedrock installed status:', e)
		}
	}

	if (project?.organization) {
		organization.value = await get_organization(project.organization).catch(handleError)
	}

	isServerProject.value = projectV3.value?.minecraft_server != null
	serverStatusOnline.value = !!projectV3.value?.minecraft_java_server?.ping?.data

	if (data.value?.title) {
		breadcrumbs.setName('Project', data.value.title)
	}
	if (instance.value?.loader?.toLowerCase() === 'bedrock' || data.value?.is_curseforge) {
		if (instance.value) {
			breadcrumbs.setContext({
				name: instance.value.name,
				link: `/instance/${instance.value.path}/content`,
			})
		} else {
			breadcrumbs.setContext({
				name: 'Поиск проектов',
				link: projectBrowseBackUrl.value,
			})
		}
	}

	fetchDeferredServerData(project)
}

function fetchDeferredServerData(project) {
	const serverAddress = projectV3.value?.minecraft_java_server?.address
	if (serverAddress) {
		serverPing.value = undefined
		getServerLatency(serverAddress)
			.then((latency) => {
				serverPing.value = latency
			})
			.catch((error) => {
				console.error(`Failed to ping server ${serverAddress}:`, error)
			})
	}

	const content = projectV3.value?.minecraft_java_server?.content
	if (content?.kind === 'modpack' && content.version_id) {
		get_version(content.version_id, 'bypass')
			.catch(handleError)
			.then(async (modpackVersion) => {
				if (!modpackVersion) return
				serverRecommendedVersion.value = modpackVersion.game_versions?.[0] ?? null
				serverModpackLoaders.value = modpackVersion.mrpack_loaders ?? []
				if (modpackVersion.project_id) {
					const modpackProject = await get_project_v3(
						modpackVersion.project_id,
						'must_revalidate',
					).catch(handleError)
					if (modpackProject) {
						const primaryFile =
							modpackVersion.files?.find((f) => f.primary) ?? modpackVersion.files?.[0]

						serverRequiredContent.value = {
							name: modpackProject.name,
							versionNumber: modpackVersion.version_number ?? '',
							icon: modpackProject.icon_url,
							onclickName:
								modpackProject.id !== project.id
									? () => router.push(`/project/${modpackProject.id}`)
									: undefined,
							onclickVersion:
								modpackProject.id !== project.id
									? () => router.push(`/project/${modpackProject.id}/version/${modpackVersion.id}`)
									: undefined,
							onclickDownload: primaryFile?.url ? () => openUrl(primaryFile.url) : undefined,
							showCustomModpackTooltip: modpackProject.id === project.id,
						}
					}
				}
			})
	} else if (content?.kind === 'vanilla') {
		serverRecommendedVersion.value = content.recommended_game_version ?? null
		const supported = content.supported_game_versions ?? []
		serverSupportedVersions.value = supported.filter((v) => !!v)
	}

	updateServerPlayState()
}

await fetchProjectData()

let unlistenProcesses
process_listener((e) => {
	if (
		e.event === 'finished' &&
		serverInstancePath.value &&
		e.profile_path_id === serverInstancePath.value
	) {
		serverPlaying.value = false
	}
}).then((unlisten) => {
	unlistenProcesses = unlisten
})

onUnmounted(() => {
	unlistenProcesses?.()
})

watch(
	() => route.params.id,
	async () => {
		if (route.params.id && route.path.startsWith('/project')) {
			await fetchProjectData()
		}
	},
)

async function install(version) {
	if (serverProjectInstallContext.value && data.value) {
		if (serverProjectSelected.value) {
			serverInstallContent.removeQueuedServerInstall(data.value.id)
			return
		}
		if (installButtonDisabled.value) return

		installing.value = true
		try {
			const contentType = data.value.project_type
			await requestInstall({
				project: {
					...data.value,
					project_id: data.value.id,
					icon_url: data.value.icon_url,
				},
				contentType,
				mode: contentType === 'modpack' ? 'immediate' : 'queue',
				selectedFilters: [],
				providedFilters: [],
				overriddenProvidedFilterTypes: [],
				targetPreferences: getTargetInstallPreferences(
					{
						gameVersion: serverInstallContent.serverContextServerData.value?.mc_version,
						loader: serverInstallContent.serverContextServerData.value?.loader,
					},
					contentType,
				),
				getProjectVersions: async () => versions.value,
				queue: {
					get: serverInstallContent.getQueuedServerInstallPlans,
					set: serverInstallContent.setQueuedServerInstallPlans,
				},
				install: (plan) =>
					serverInstallContent.openServerModpackInstallFlow({
						projectId: plan.projectId,
						versionId: plan.versionId,
						name: plan.project.title ?? plan.project.name ?? data.value.title,
						iconUrl: plan.project.icon_url ?? undefined,
					}),
			})
		} catch (err) {
			handleError(err)
		} finally {
			installing.value = false
		}
		return
	}

	installing.value = true
	await installVersion(
		data.value.id,
		version,
		instance.value ? instance.value.path : null,
		'ProjectPage',
		(version, installedProjectIds) => {
			installing.value = false

			const installedIds = installedProjectIds ?? [data.value.id]
			if (instance.value && version && installedIds.includes(data.value.id)) {
				installed.value = true
				installedVersion.value = version
			}
		},
		(profile) => {
			router.push(`/instance/${profile}`)
		},
	).catch(handleError)
}

const options = ref(null)
const handleRightClick = (event) => {
	options.value.showMenu(event, data.value, [
		{
			name: 'install',
		},
		{
			type: 'divider',
		},
		{
			name: 'open_link',
		},
		{
			name: 'copy_link',
		},
	])
}
const handleOptionsClick = (args) => {
	switch (args.option) {
		case 'install':
			install(null)
			break
		case 'open_link':
			openUrl(`https://modrinth.com/${args.item.project_type}/${args.item.slug}`)
			break
		case 'copy_link':
			navigator.clipboard.writeText(
				`https://modrinth.com/${args.item.project_type}/${args.item.slug}`,
			)
			break
	}
}
</script>

<style scoped lang="scss">
.root-container {
	display: flex;
	flex-direction: row;
	min-height: 100%;
}

.project-sidebar {
	position: fixed;
	width: calc(300px + 1.5rem);
	min-height: calc(100vh - 3.25rem);
	height: fit-content;
	max-height: calc(100vh - 3.25rem);
	padding: 1rem 0.5rem 1rem 1rem;
	overflow-y: auto;
	-ms-overflow-style: none;
	scrollbar-width: none;

	&::-webkit-scrollbar {
		width: 0;
		background: transparent;
	}
}

.sidebar-card {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.content-container {
	display: flex;
	flex-direction: column;
	width: 100%;
	padding: 1rem;
	margin-left: calc(300px + 1rem);
}

.button-group {
	display: flex;
	flex-wrap: wrap;
	flex-direction: row;
	gap: 0.5rem;
}

.stats {
	display: flex;
	flex-direction: column;
	flex-wrap: wrap;
	gap: var(--gap-md);

	.stat {
		display: flex;
		flex-direction: row;
		align-items: center;
		width: fit-content;
		gap: var(--gap-xs);
		--stat-strong-size: 1.25rem;

		strong {
			font-size: var(--stat-strong-size);
		}

		p {
			margin: 0;
		}

		svg {
			min-height: var(--stat-strong-size);
			min-width: var(--stat-strong-size);
		}
	}

	.date {
		margin-top: auto;
	}
}

.tabs {
	display: flex;
	flex-direction: row;
	gap: 1rem;
	margin-bottom: var(--gap-md);
	justify-content: space-between;

	.tab {
		display: flex;
		flex-direction: row;
		align-items: center;
		border-radius: var(--border-radius);
		cursor: pointer;
		transition: background-color 0.2s ease-in-out;

		&:hover {
			background-color: var(--color-raised-bg);
		}

		&.router-view-active {
			background-color: var(--color-raised-bg);
		}
	}
}

.links {
	a {
		display: inline-flex;
		align-items: center;
		border-radius: 1rem;
		color: var(--color-text);

		svg,
		img {
			height: 1rem;
			width: 1rem;
		}

		span {
			margin-left: 0.25rem;
			text-decoration: underline;
			line-height: 2rem;
		}

		&:focus-visible,
		&:hover {
			svg,
			img,
			span {
				color: var(--color-heading);
			}
		}

		&:active {
			svg,
			img,
			span {
				color: var(--color-text-dark);
			}
		}

		&:not(:last-child)::after {
			content: '•';
			margin: 0 0.25rem;
		}
	}
}

.install-loading {
	scale: 0.2;
	height: 1rem;
	width: 1rem;
	margin-right: -1rem;

	:deep(svg) {
		color: var(--color-contrast);
	}
}

.project-sidebar-section {
	@apply p-4 flex flex-col gap-2 border-0 border-b-[1px] border-[--brand-gradient-border] border-solid;
}
</style>
