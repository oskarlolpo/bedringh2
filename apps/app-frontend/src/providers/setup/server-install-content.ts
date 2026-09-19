import type { Archon, Labrinth } from '@modrinth/api-client'
import {
	type BrowseInstallPlan,
	type BrowseSelectedProject,
	createContext,
	type CreationFlowContextValue,
	flushStoredServerAddonInstallQueue,
	getServerAddonInstallPlanProjectIds,
	getStoredServerAddonInstallQueue,
	getTargetInstallPreferences,
	injectModrinthClient,
	injectNotificationManager,
	type ProjectSearchResult,
	readStoredServerInstallQueue,
	resolveServerAddonInstallPlans,
	useServerContextRuntime,
	useServerPanelSync,
	waitForServerContextRuntimeReady,
	writeStoredServerInstallQueue,
} from '@modrinth/ui'
import { useQueryClient } from '@tanstack/vue-query'
import { computed, type ComputedRef, nextTick, type Ref, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLocalServers } from '@/providers/local-servers'
import { join } from '@tauri-apps/api/path'
import { mkdir, writeFile } from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { get_version } from '@/helpers/cache.js'
import { getServerDirectory } from '@/services/server-download'

type ServerFlowFrom = 'onboarding' | 'reset-server'

type InstallableSearchResult = Labrinth.Search.v3.ResultSearchProject & {
	installing?: boolean
	installed?: boolean
}

export interface ServerModpackSelectionRequest {
	projectId: string
	versionId: string
	name: string
	iconUrl?: string
}

interface ServerSetupModalHandle {
	show: () => void | Promise<void>
	hide: () => void
	ctx?: CreationFlowContextValue | null
}

export interface ServerInstallContentContext {
	serverIdQuery: ComputedRef<string | null>
	worldIdQuery: ComputedRef<string | null>
	browseFrom: ComputedRef<string | null>
	serverFlowFrom: ComputedRef<ServerFlowFrom | null>
	isFromWorlds: ComputedRef<boolean>
	isServerContext: ComputedRef<boolean>
	isSetupServerContext: ComputedRef<boolean>
	effectiveServerWorldId: ComputedRef<string | null>
	serverContextServerData: Ref<Archon.Servers.v0.Server | null>
	serverContentProjectIds: Ref<Set<string>>
	queuedServerInstallRootProjectIds: ComputedRef<Set<string>>
	queuedServerInstallProjectIds: ComputedRef<Set<string>>
	queuedServerInstallCount: ComputedRef<number>
	selectedServerInstallProjects: ComputedRef<BrowseSelectedProject[]>
	isInstallingQueuedServerInstalls: Ref<boolean>
	queuedInstallProgress: Ref<{ completed: number; total: number }>
	serverBackUrl: ComputedRef<string>
	serverBackLabel: ComputedRef<string>
	serverBrowseHeading: ComputedRef<string>
	clearQueuedServerInstalls: () => void
	removeQueuedServerInstall: (projectId: string) => void
	flushQueuedServerInstalls: () => Promise<boolean>
	discardQueuedServerInstallsAndBack: () => Promise<void>
	installQueuedServerInstallsAndBack: () => Promise<boolean>
	initServerContext: () => Promise<void>
	watchServerContextChanges: () => void
	searchServerModpacks: (query: string, limit?: number) => Promise<ProjectSearchResult>
	getServerProjectVersions: (projectId: string) => Promise<{ id: string }[]>
	enforceSetupModpackRoute: (currentProjectType: string | undefined) => void
	getQueuedServerInstallPlans: () => Map<string, BrowseInstallPlan<InstallableSearchResult>>
	setQueuedServerInstallPlans: (
		plans: Map<string, BrowseInstallPlan<InstallableSearchResult>>,
	) => void
	resolveQueuedServerInstallPlan: (
		plan: BrowseInstallPlan<InstallableSearchResult>,
	) => Promise<void>
	openServerModpackInstallFlow: (request: ServerModpackSelectionRequest) => Promise<void>
	onServerFlowBack: () => void
	handleServerModpackFlowCreate: (config: CreationFlowContextValue) => Promise<void>
	markServerProjectInstalled: (id: string) => void
}

export const [injectServerInstallContent, provideServerInstallContent] =
	createContext<ServerInstallContentContext>('Browse', 'serverInstallContent')

function readQueryString(value: unknown): string | null {
	if (Array.isArray(value)) return value[0] ?? null
	return typeof value === 'string' && value.length > 0 ? value : null
}

export function createServerInstallContent(opts: {
	serverSetupModalRef: Ref<ServerSetupModalHandle | null>
}) {
	const { serverSetupModalRef } = opts
	const route = useRoute()
	const router = useRouter()
	const client = injectModrinthClient()
	const { handleError, addNotification } = injectNotificationManager()
	const queryClient = useQueryClient()

	const serverIdQuery = computed(() => readQueryString(route.query.sid))
	const worldIdQuery = computed(() => readQueryString(route.query.wid))
	const browseFrom = computed(() => readQueryString(route.query.from))
	const serverFlowFrom = computed<ServerFlowFrom | null>(() =>
		browseFrom.value === 'onboarding' || browseFrom.value === 'reset-server'
			? browseFrom.value
			: null,
	)

	const isFromWorlds = computed(() => browseFrom.value === 'worlds')
	const isServerContext = computed(() => !!serverIdQuery.value)
	const isSetupServerContext = computed(() => !!serverIdQuery.value && !!serverFlowFrom.value)
	useServerContextRuntime(serverIdQuery)

	const serverContextWorldId = ref<string | null>(worldIdQuery.value)

	const { getServerById, getServerAddons, addServerAddon } = useLocalServers()

	function getCachedServer(serverId: string): Archon.Servers.v0.Server | null {
		const local = getServerById(serverId)
		if (local) {
			return {
				server_id: local.id,
				name: local.name,
				loader: local.core,
				mc_version: local.gameVersion,
				status: local.status,
				owner: 'local',
				region: 'local',
				memory: 4096,
				port: local.port,
				motd: local.motd,
				is_medal: false,
			} as unknown as Archon.Servers.v0.Server
		}
		return (
			queryClient.getQueryData<Archon.Servers.v0.Server>(['servers', 'detail', serverId]) ??
			queryClient
				.getQueryData<Archon.Servers.v0.ServerGetResponse>(['servers'])
				?.servers.find((server) => server.server_id === serverId) ??
			null
		)
	}

	async function ensureServer(serverId: string): Promise<Archon.Servers.v0.Server> {
		const local = getServerById(serverId)
		if (local) {
			return getCachedServer(serverId)!
		}
		return queryClient.ensureQueryData({
			queryKey: ['servers', 'detail', serverId],
			queryFn: () => client.archon.servers_v0.get(serverId),
			staleTime: 30_000,
		})
	}

	const initialServerId = serverIdQuery.value
	const serverContextServerData = ref<Archon.Servers.v0.Server | null>(
		initialServerId ? getCachedServer(initialServerId) : null,
	)
	const serverContentProjectIds = ref<Set<string>>(new Set())
	const queuedServerInstalls = ref<Map<string, BrowseInstallPlan<InstallableSearchResult>>>(
		new Map(),
	)
	const queuedServerInstallRootProjectIds = computed(
		() => new Set(queuedServerInstalls.value.keys()),
	)
	const queuedServerInstallProjectIds = computed(() =>
		getServerAddonInstallPlanProjectIds(queuedServerInstalls.value.values()),
	)
	const queuedServerInstallCount = computed(() => queuedServerInstalls.value.size)
	const selectedServerInstallProjects = computed<BrowseSelectedProject[]>(() =>
		Array.from(queuedServerInstalls.value.values()).map((plan) => ({
			id: plan.projectId,
			name: plan.project.name ?? 'Project',
			iconUrl: plan.project.icon_url ?? null,
		})),
	)
	const isInstallingQueuedServerInstalls = ref(false)
	const queuedInstallProgress = ref({ completed: 0, total: 0 })
	const effectiveServerWorldId = computed(() => worldIdQuery.value ?? serverContextWorldId.value)
	useServerPanelSync({
		serverId: serverIdQuery,
		worldId: effectiveServerWorldId,
	})
	const serverBackUrl = computed(() => {
		const sid = serverIdQuery.value
		if (!sid) return '/hosting/manage'
		const local = getServerById(sid)
		if (local) return `/server/${sid}`
		if (serverFlowFrom.value === 'onboarding') {
			return `/hosting/manage/${sid}?resumeModal=setup-type`
		}
		if (serverFlowFrom.value === 'reset-server') {
			return `/hosting/manage/${sid}?openSettings=installation`
		}
		return `/hosting/manage/${sid}/content`
	})
	const serverBackLabel = computed(() => {
		const sid = serverIdQuery.value
		if (sid && getServerById(sid)) return 'Вернуться к серверу'
		if (serverFlowFrom.value === 'onboarding') return 'Back to setup'
		if (serverFlowFrom.value === 'reset-server') return 'Cancel reset'
		return 'Back to server'
	})
	const serverBrowseHeading = computed(() => {
		if (serverFlowFrom.value === 'reset-server') {
			return 'Selecting modpack to install after reset'
		}
		return 'Installing content'
	})

	async function resolveServerContextWorldId(serverId: string) {
		try {
			const server = await client.archon.servers_v1.get(serverId)
			const activeWorld = server.worlds.find((world) => world.is_active)
			return activeWorld?.id ?? server.worlds[0]?.id ?? null
		} catch (err) {
			handleError(err as Error)
			return null
		}
	}

	async function refreshServerInstalledContent(serverId: string, worldId: string) {
		const local = getServerById(serverId)
		if (local) {
			const addons = getServerAddons(serverId)
			serverContentProjectIds.value = new Set(
				addons.map((a) => a.project?.id || a.id).filter(Boolean),
			)
			return
		}
		try {
			const content = await client.archon.content_v1.getAddons(serverId, worldId)
			if (serverIdQuery.value !== serverId || effectiveServerWorldId.value !== worldId) {
				return
			}
			const ids = new Set(
				(content.addons ?? [])
					.map((addon) => addon.project_id)
					.filter((projectId): projectId is string => !!projectId),
			)
			serverContentProjectIds.value = ids
		} catch (err) {
			handleError(err as Error)
		}
	}

	async function initServerContext() {
		const sid = serverIdQuery.value
		if (!sid) return

		try {
			const server = await ensureServer(sid)
			if (serverIdQuery.value === sid) {
				serverContextServerData.value = server
			}
		} catch (err) {
			handleError(err as Error)
		}

		if (serverIdQuery.value !== sid) return

		const local = getServerById(sid)
		if (local) {
			serverContextWorldId.value = 'local-world'
			queuedServerInstalls.value = readStoredServerInstallQueue(sid, 'local-world')
			await refreshServerInstalledContent(sid, 'local-world')
			return
		}

		let resolvedWorldId = effectiveServerWorldId.value
		if (!resolvedWorldId) {
			resolvedWorldId = await resolveServerContextWorldId(sid)
			if (serverIdQuery.value !== sid) return
			if (resolvedWorldId) {
				serverContextWorldId.value = resolvedWorldId
			}
		}

		if (resolvedWorldId) {
			queuedServerInstalls.value = readStoredServerInstallQueue(sid, resolvedWorldId)
			await refreshServerInstalledContent(sid, resolvedWorldId)
		}
	}

	function watchServerContextChanges() {
		watch([serverIdQuery, effectiveServerWorldId], async ([sid, wid], [prevSid, prevWid]) => {
			if (!sid) {
				serverContextWorldId.value = null
				serverContextServerData.value = null
				serverContentProjectIds.value = new Set()
				setQueuedServerInstallPlans(new Map())
				return
			}

			if (sid !== prevSid) {
				serverContentProjectIds.value = new Set()
				queuedServerInstalls.value = readStoredServerInstallQueue(sid, wid)
				serverContextServerData.value = getCachedServer(sid)
				try {
					const server = await ensureServer(sid)
					if (serverIdQuery.value === sid) {
						serverContextServerData.value = server
					}
				} catch (err) {
					handleError(err as Error)
				}
			}

			if (wid !== prevWid) {
				queuedServerInstalls.value = readStoredServerInstallQueue(sid, wid)
			}

			if (wid && (sid !== prevSid || wid !== prevWid)) {
				await refreshServerInstalledContent(sid, wid)
			}
		})
	}

	function enforceSetupModpackRoute(currentProjectType: string | undefined) {
		if (!isSetupServerContext.value || currentProjectType === 'modpack') return
		router.replace({
			path: '/browse/modpack',
			query: route.query,
		})
	}

	async function searchServerModpacks(query: string, limit: number = 10) {
		const results = await client.labrinth.projects_v3.search({
			query: query || undefined,
			new_filters:
				'project_types = "modpack" AND environment IN ["client_and_server", "server_only_client_optional"]',
			limit,
		})

		return {
			hits: results.hits.map((hit) => ({
				project_id: hit.project_id,
				title: hit.name,
				icon_url: hit.icon_url ?? '',
				latest_version: hit.version_id,
			})),
			total_hits: results.total_hits,
			offset: (results.page - 1) * results.hits_per_page,
			limit: results.hits_per_page,
		}
	}

	async function getServerProjectVersions(projectId: string) {
		const versions = await client.labrinth.versions_v3.getProjectVersions(projectId)
		return versions.map((version) => ({ id: version.id }))
	}

	async function openServerModpackInstallFlow(request: ServerModpackSelectionRequest) {
		if (!serverIdQuery.value || !effectiveServerWorldId.value) {
			throw new Error('Missing server context')
		}

		const modalInstance = serverSetupModalRef.value
		if (!modalInstance) return

		modalInstance.show()
		await nextTick()

		const ctx = modalInstance.ctx
		if (!ctx) return

		ctx.setupType.value = 'modpack'
		ctx.modpackSelection.value = {
			projectId: request.projectId,
			versionId: request.versionId,
			name: request.name,
			iconUrl: request.iconUrl,
		}
		ctx.modal.value?.setStage('final-config')
	}

	function clearQueuedServerInstalls() {
		setQueuedServerInstallPlans(new Map())
	}

	function removeQueuedServerInstall(projectId: string) {
		const nextPlans = new Map(queuedServerInstalls.value)
		nextPlans.delete(projectId)
		setQueuedServerInstallPlans(nextPlans)
	}

	function setStoredServerInstallPlans(
		serverId: string,
		worldId: string,
		plans: Map<string, BrowseInstallPlan<InstallableSearchResult>>,
	) {
		if (serverId === serverIdQuery.value && worldId === effectiveServerWorldId.value) {
			queuedServerInstalls.value = plans
		}
		writeStoredServerInstallQueue(serverId, worldId, plans)
	}

	function toResolvePreferences(
		preferences?: BrowseInstallPlan<InstallableSearchResult>['preferences'],
	): Labrinth.Content.v3.ResolutionPreferences {
		return {
			game_versions: preferences?.gameVersions,
			loaders: preferences?.loaders,
		}
	}

	async function resolveAddonPlan(
		plan: BrowseInstallPlan<InstallableSearchResult>,
		existingProjectIds: string[],
	) {
		const target = getTargetInstallPreferences(
			{
				gameVersion: serverContextServerData.value?.mc_version,
				loader: serverContextServerData.value?.loader,
			},
			plan.contentType,
		)
		const resolved = await client.labrinth.content_v3.resolve({
			project_id: plan.projectId,
			version_id: plan.versionId,
			content_type: plan.contentType as Labrinth.Content.v3.ContentType,
			selected: toResolvePreferences(plan.preferences),
			target: toResolvePreferences(target),
			existing_project_ids: existingProjectIds,
		})

		return [resolved.primary, ...resolved.dependencies].map((item) => ({
			projectId: item.project_id,
			versionId: item.version_id,
		}))
	}

	async function resolveQueuedServerInstallPlan(plan: BrowseInstallPlan<InstallableSearchResult>) {
		const resolvedContent = await resolveAddonPlan(plan, Array.from(serverContentProjectIds.value))
		const storedPlan = queuedServerInstalls.value.get(plan.projectId)
		if (!storedPlan || storedPlan.versionId !== plan.versionId) return

		const nextPlans = new Map(queuedServerInstalls.value)
		nextPlans.set(plan.projectId, { ...storedPlan, resolvedContent })
		setQueuedServerInstallPlans(nextPlans)
	}

	async function resolveQueuedAddonPlans(plans: BrowseInstallPlan<InstallableSearchResult>[]) {
		return await resolveServerAddonInstallPlans({
			plans,
			existingProjectIds: serverContentProjectIds.value,
			resolvePlan: resolveAddonPlan,
		})
	}

	async function flushQueuedServerInstalls(
		serverId: string | null = serverIdQuery.value,
		worldId: string | null = effectiveServerWorldId.value,
	) {
		if (isInstallingQueuedServerInstalls.value) return false

		if (!serverId || !worldId) {
			handleError(new Error('No server world is available for install.'))
			return false
		}

		const queuedPlans = getStoredServerAddonInstallQueue<InstallableSearchResult>(serverId, worldId)
		if (queuedPlans.size === 0) return true

		const local = getServerById(serverId)
		if (local) {
			isInstallingQueuedServerInstalls.value = true
			queuedInstallProgress.value = {
				completed: 0,
				total: queuedPlans.size,
			}
			try {
				const serverDir = local.path || (await getServerDirectory(serverId))
				let installedCount = 0

				for (const plan of queuedPlans.values()) {
					const p = plan.project
					let folderName = 'plugins'
					if (plan.contentType === 'mod') {
						folderName = 'mods'
					} else if (plan.contentType === 'datapack') {
						folderName = 'world/datapacks'
					}

					const targetDir = await join(serverDir, folderName)
					await mkdir(targetDir, { recursive: true })

					// Fetch version metadata to resolve actual download URL and file name
					let versionData: any = null
					if (plan.versionId) {
						try {
							versionData = await get_version(plan.versionId).catch(() => null)
						} catch {
							// fallback
						}
						if (!versionData) {
							try {
								const res = await tauriFetch(`https://api.modrinth.com/v2/version/${plan.versionId}`)
								if (res.ok) {
									versionData = await res.json()
								}
							} catch (e) {
								console.warn('Failed to fetch version from Modrinth API:', e)
							}
						}
					}

					// Find primary or first downloadable file
					const file =
						versionData?.files?.find((f: any) => f.primary) || versionData?.files?.[0]
					const actualFileName = file?.filename || `${p.slug ?? plan.projectId}.jar`
					const fileUrl = file?.url
					let fileSizeFormatted = ''

					if (fileUrl) {
						try {
							const dlRes = await tauriFetch(fileUrl)
							if (dlRes.ok) {
								const arrayBuf = await dlRes.arrayBuffer()
								const bytes = new Uint8Array(arrayBuf)
								const filePath = await join(targetDir, actualFileName)
								await writeFile(filePath, bytes)
								fileSizeFormatted = `${(bytes.length / (1024 * 1024)).toFixed(2)} MB`
								installedCount++
							}
						} catch (dlErr) {
							console.error('Failed to download plugin jar:', dlErr)
						}
					}

					addServerAddon(serverId, {
						id: plan.projectId,
						file_name: actualFileName,
						project_type: plan.contentType,
						enabled: true,
						date_added: new Date().toISOString(),
						description_text: p.description ?? '',
						file_size_formatted:
							fileSizeFormatted ||
							(file?.size ? `${(file.size / (1024 * 1024)).toFixed(2)} MB` : undefined),
						project: {
							id: plan.projectId,
							slug: p.slug,
							title: p.title ?? p.name ?? plan.projectId,
							icon_url: p.icon_url,
							categories: p.categories ?? [plan.contentType],
						},
						version: {
							id: versionData?.id ?? plan.versionId ?? 'latest',
							version_number: versionData?.version_number ?? 'latest',
							file_name: actualFileName,
						},
						owner: {
							id: p.author ?? 'Author',
							name: p.author ?? 'Author',
							type: 'user',
						},
					})

					queuedInstallProgress.value = {
						completed: queuedInstallProgress.value.completed + 1,
						total: queuedPlans.size,
					}
				}

				serverContentProjectIds.value = new Set([
					...serverContentProjectIds.value,
					...Array.from(queuedPlans.keys()),
				])
				setStoredServerInstallPlans(serverId, worldId, new Map())

				addNotification({
					title: 'Установка завершена',
					text: `Успешно установлено контента: ${installedCount}. Файлы сохранены в папку сервера.`,
					type: 'success',
				})

				return true
			} catch (err) {
				console.error('Failed to install server content:', err)
				handleError(err instanceof Error ? err : new Error(String(err)))
				return false
			} finally {
				isInstallingQueuedServerInstalls.value = false
				queuedInstallProgress.value = { completed: 0, total: 0 }
			}
		}

		try {
			await waitForServerContextRuntimeReady(client, serverId)
		} catch (error) {
			handleError(error as Error)
			return false
		}

		isInstallingQueuedServerInstalls.value = true
		queuedInstallProgress.value = {
			completed: 0,
			total: queuedPlans.size,
		}

		try {
			const result = await flushStoredServerAddonInstallQueue({
				serverId,
				worldId,
				install: async (plans) => {
					const addons = await resolveQueuedAddonPlans(plans)
					if (addons.length > 0) {
						await client.archon.content_v1.addAddons(serverId, worldId, addons)
					}
				},
				onQueueChange: (plans) => setStoredServerInstallPlans(serverId, worldId, plans),
			})

			if (!result.ok) {
				handleError(result.error as Error)
				return false
			}

			queuedInstallProgress.value = {
				completed: result.flushedPlans.length,
				total: result.flushedPlans.length,
			}
			serverContentProjectIds.value = new Set([
				...serverContentProjectIds.value,
				...result.flushedPlans.map((plan) => plan.projectId),
			])
			if (result.flushedPlans.length > 0) {
				await queryClient.invalidateQueries({ queryKey: ['content', 'list', 'v1', serverId] })
			}

			return true
		} finally {
			isInstallingQueuedServerInstalls.value = false
			queuedInstallProgress.value = { completed: 0, total: 0 }
		}
	}

	async function discardQueuedServerInstallsAndBack() {
		clearQueuedServerInstalls()
		await router.push(serverBackUrl.value)
	}

	async function installQueuedServerInstallsAndBack() {
		const sid = serverIdQuery.value
		const wid = effectiveServerWorldId.value
		const backUrl = serverBackUrl.value
		const plans = new Map(queuedServerInstalls.value)

		if (sid && wid) {
			writeStoredServerInstallQueue(sid, wid, plans)
		}
		const installed = await flushQueuedServerInstalls(sid, wid)
		if (!installed) return false
		await router.push(backUrl)

		return true
	}

	function getQueuedServerInstallPlans() {
		return queuedServerInstalls.value
	}

	function setQueuedServerInstallPlans(
		plans: Map<string, BrowseInstallPlan<InstallableSearchResult>>,
	) {
		queuedServerInstalls.value = plans
		writeStoredServerInstallQueue(serverIdQuery.value, effectiveServerWorldId.value, plans)
	}

	function onServerFlowBack() {
		serverSetupModalRef.value?.hide()
	}

	async function handleServerModpackFlowCreate(config: CreationFlowContextValue) {
		const sid = serverIdQuery.value
		const wid = effectiveServerWorldId.value
		if (!sid || !wid || !config.modpackSelection.value) {
			config.loading.value = false
			return
		}

		try {
			await client.archon.content_v1.installContent(sid, wid, {
				content_variant: 'modpack',
				spec: {
					platform: 'modrinth',
					project_id: config.modpackSelection.value.projectId,
					version_id: config.modpackSelection.value.versionId,
				},
				soft_override: false,
				properties: config.buildProperties(),
			} satisfies Archon.Content.v1.InstallWorldContent)
			serverSetupModalRef.value?.hide()

			if (serverFlowFrom.value === 'onboarding') {
				await client.archon.servers_v1.endIntro(sid)
				await router.push(`/hosting/manage/${sid}/content`)
				return
			}

			await router.push(`/hosting/manage/${sid}?openSettings=installation`)
		} catch (err) {
			handleError(err as Error)
			config.loading.value = false
		}
	}

	function markServerProjectInstalled(id: string) {
		serverContentProjectIds.value = new Set([...serverContentProjectIds.value, id])
	}

	return {
		serverIdQuery,
		worldIdQuery,
		browseFrom,
		serverFlowFrom,
		isFromWorlds,
		isServerContext,
		isSetupServerContext,
		effectiveServerWorldId,
		serverContextServerData,
		serverContentProjectIds,
		queuedServerInstallRootProjectIds,
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
		resolveQueuedServerInstallPlan,
		openServerModpackInstallFlow,
		onServerFlowBack,
		handleServerModpackFlowCreate,
		markServerProjectInstalled,
	}
}
