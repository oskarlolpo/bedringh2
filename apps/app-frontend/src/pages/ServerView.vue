<script setup lang="ts">
import {
	BoxesIcon,
	CheckIcon,
	ChevronLeftIcon,
	ClockArrowDownIcon,
	CompassIcon,
	CopyIcon,
	CpuIcon,
	DatabaseIcon,
	DownloadIcon,
	FileIcon,
	FolderOpenIcon,
	HistoryIcon,
	LinkIcon,
	LoaderCircleIcon,
	MoreVerticalIcon,
	PlayIcon,
	PlusIcon,
	RefreshCwIcon,
	SearchIcon,
	ServerStackIcon,
	SettingsIcon,
	StopCircleIcon,
	TagIcon,
	TerminalSquareIcon,
	TimerIcon,
	TrashIcon,
	UploadIcon,
} from '@modrinth/assets'
import {
	Avatar,
	Button,
	ButtonStyled,
	Chips,
	ConfirmModal,
	ContextMenu,
	ContentCardLayout,
	FilePageLayout,
	FloatingActionBar,
	IconButton,
	injectNotificationManager,
	Input,
	NavTabs,
	PageHeader,
	PageHeaderActions,
	PageHeaderMetadata,
	PageHeaderMetadataItem,
	provideContentManager,
	provideFileManager,
	ReadyTransition,
	TagItem,
	Toggle,
	defineMessages,
	useVIntl,
} from '@modrinth/ui'
import type { ContentItem, EditingFile, FileItem, UploadState } from '@modrinth/ui'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { convertFileSrc } from '@tauri-apps/api/core'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import { openPath } from '@/helpers/utils.js'

import { type LocalServer, type ServerLaunchSettings, useLocalServers } from '@/providers/local-servers'
import {
	mkdir,
	readDir,
	readFile as readFileBytes,
	readTextFile,
	remove,
	rename,
	stat,
	writeFile as writeFileBytes,
	writeTextFile,
} from '@tauri-apps/plugin-fs'
import { getServerDirectory } from '@/services/server-download'
import {
	getLocalServerLogs,
	getLocalServerMetrics,
	getLocalServerStatus,
	sendLocalServerCommand,
	startLocalServerProcess,
	stopLocalServerProcess,
} from '@/services/local-server-process'

const props = defineProps({
	serverId: {
		type: String,
		default: '',
	},
})

const route = useRoute()
const router = useRouter()
const { formatMessage } = useVIntl()
const { addNotification } = injectNotificationManager()
const {
	getServerById,
	updateServerStatus,
	getServerAddons,
	addServerAddon,
	removeServerAddon,
	toggleServerAddon,
	removeServer,
	updateServer,
	updateServerLaunchSettings,
} = useLocalServers()

const messages = defineMessages({
	tabOverview: { id: 'server.view.tab.overview', defaultMessage: 'Overview & Console' },
	tabContent: { id: 'server.view.tab.content', defaultMessage: 'Content' },
	tabFiles: { id: 'server.view.tab.files', defaultMessage: 'Files' },
	tabSettings: { id: 'server.view.tab.settings', defaultMessage: 'Settings' },
	allServers: { id: 'server.view.all_servers', defaultMessage: 'All servers' },
	metricCpu: { id: 'server.view.metric.cpu', defaultMessage: 'Processor' },
	metricRam: { id: 'server.view.metric.ram', defaultMessage: 'Memory' },
	metricDisk: { id: 'server.view.metric.disk', defaultMessage: 'Disk' },
	metricUptime: { id: 'server.view.metric.uptime', defaultMessage: 'Uptime' },
	metricStatus: { id: 'server.view.metric.status', defaultMessage: 'Status' },
	statusRunning: { id: 'server.view.metric.running', defaultMessage: 'Online' },
	statusStopped: { id: 'server.view.metric.stopped', defaultMessage: 'Stopped' },
	statusStarting: { id: 'server.view.metric.starting', defaultMessage: 'Starting...' },
	actionStart: { id: 'server.view.action.start', defaultMessage: 'Start server' },
	actionStop: { id: 'server.view.action.stop', defaultMessage: 'Stop server' },
	actionRestart: { id: 'server.view.action.restart', defaultMessage: 'Restart server' },
	actionAddContent: { id: 'server.view.action.add_content', defaultMessage: 'Add plugins & mods' },
	actionOpenFolder: { id: 'server.view.action.open_folder', defaultMessage: 'Open server folder' },
	actionChangeIcon: { id: 'server.view.action.change_icon', defaultMessage: 'Change server icon' },
	actionCopyAddress: { id: 'server.view.action.copy_address', defaultMessage: 'Copy address' },
	actionDelete: { id: 'server.view.action.delete', defaultMessage: 'Delete server' },
	inputPlaceholder: { id: 'server.view.console.input_placeholder', defaultMessage: 'Enter Minecraft command (e.g. op, gamemode, whitelist)...' },
	filterPlaceholder: { id: 'server.view.console.filter_placeholder', defaultMessage: 'Filter logs...' },
	consoleClear: { id: 'server.view.console.clear', defaultMessage: 'Clear' },
	consoleCopy: { id: 'server.view.console.copy_logs', defaultMessage: 'Copy logs' },
	jvmHeading: { id: 'server.view.jvm.heading', defaultMessage: 'Server Startup & JVM Settings' },
	jvmDescription: { id: 'server.view.jvm.description', defaultMessage: 'Configure memory allocation, Java version and startup optimization flags' },
	jvmMinRam: { id: 'server.view.jvm.min_ram', defaultMessage: 'Minimum RAM (-Xms)' },
	jvmMaxRam: { id: 'server.view.jvm.max_ram', defaultMessage: 'Maximum RAM (-Xmx)' },
	jvmAikarFlags: { id: 'server.view.jvm.aikar_flags', defaultMessage: "Aikar's Garbage Collection Flags" },
	jvmAikarFlagsDesc: { id: 'server.view.jvm.aikar_flags_desc', defaultMessage: 'Recommended optimization flags for stable TPS and minimal GC pauses' },
	jvmCustomArgs: { id: 'server.view.jvm.custom_args', defaultMessage: 'Custom JVM Arguments' },
	jvmCustomArgsPlaceholder: { id: 'server.view.jvm.custom_args_placeholder', defaultMessage: 'e.g. -Dfile.encoding=UTF-8 -XX:+AlwaysPreTouch' },
	jvmJavaPath: { id: 'server.view.jvm.java_path', defaultMessage: 'Java Executable Path' },
	jvmJavaPathPlaceholder: { id: 'server.view.jvm.java_path_placeholder', defaultMessage: 'Default (system detected)' },
	jvmSaveBtn: { id: 'server.view.jvm.save_btn', defaultMessage: 'Save startup parameters' },
	jvmSavedSuccess: { id: 'server.view.jvm.saved_success', defaultMessage: 'Startup settings saved successfully' },
	propsHeading: { id: 'server.view.props.heading', defaultMessage: 'server.properties Configuration' },
	propsDescription: { id: 'server.view.props.description', defaultMessage: 'Manage core Minecraft gameplay, difficulty, network and world parameters' },
	propsSaveBtn: { id: 'server.view.props.save_btn', defaultMessage: 'Save server.properties' },
	propsSearchPlaceholder: { id: 'server.view.props.search_placeholder', defaultMessage: 'Search settings (motd, pvp, port, gamemode)...' },
	propsSavedSuccess: { id: 'server.view.props.saved_success', defaultMessage: 'server.properties configuration saved' },
	gmSurvival: { id: 'server.view.props.gamemode.survival', defaultMessage: 'Survival' },
	gmCreative: { id: 'server.view.props.gamemode.creative', defaultMessage: 'Creative' },
	gmAdventure: { id: 'server.view.props.gamemode.adventure', defaultMessage: 'Adventure' },
	gmSpectator: { id: 'server.view.props.gamemode.spectator', defaultMessage: 'Spectator' },
	diffPeaceful: { id: 'server.view.props.difficulty.peaceful', defaultMessage: 'Peaceful' },
	diffEasy: { id: 'server.view.props.difficulty.easy', defaultMessage: 'Easy' },
	diffNormal: { id: 'server.view.props.difficulty.normal', defaultMessage: 'Normal' },
	diffHard: { id: 'server.view.props.difficulty.hard', defaultMessage: 'Hard' },
	deleteModalTitle: { id: 'server.view.delete_modal.title', defaultMessage: 'Delete Server' },
	deleteModalDescription: { id: 'server.view.delete_modal.description', defaultMessage: 'Are you sure you want to delete this server? All files and worlds will be deleted permanently.' },
	deleteModalConfirm: { id: 'server.view.delete_modal.confirm', defaultMessage: 'Delete permanently' },
	deleteModalCancel: { id: 'server.view.delete_modal.cancel', defaultMessage: 'Cancel' },
})

const effectiveServerId = computed(
	() => props.serverId || (route.params.id as string) || '',
)
const server = computed<LocalServer | undefined>(() =>
	getServerById(effectiveServerId.value),
)

const serverContextMenu = ref<InstanceType<typeof ContextMenu> | null>(null)
const deleteServerModal = ref<InstanceType<typeof ConfirmModal> | null>(null)

function handleBrowseContent() {
	if (!server.value) return
	const isModCore = ['fabric', 'forge', 'neoforge', 'quilt'].includes(server.value.core.toLowerCase())
	router.push(`/browse/${isModCore ? 'mod' : 'plugin'}?sid=${server.value.id}`)
}

async function handleOpenServerFolder() {
	if (!server.value) return
	try {
		const dir = server.value.path || (await getServerDirectory(server.value.id))
		await openPath(dir)
	} catch (e) {
		console.error('Failed to open server folder', e)
		addNotification({
			title: 'Ошибка',
			text: 'Не удалось открыть папку сервера.',
			type: 'error',
		})
	}
}

async function handleChangeAvatar() {
	if (!server.value) return
	try {
		const selected = await openFileDialog({
			multiple: false,
			filters: [
				{
					name: 'Изображение',
					extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
				},
			],
		})
		if (selected && typeof selected === 'string') {
			const iconUrl = convertFileSrc(selected)
			updateServer(server.value.id, { iconUrl })
			addNotification({
				title: 'Иконка обновлена',
				text: 'Иконка сервера успешно изменена.',
				type: 'success',
			})
		}
	} catch (e) {
		console.error('Failed to update server icon', e)
	}
}

function handleDeleteServer() {
	deleteServerModal.value?.show()
}

async function confirmDeleteServer() {
	if (!server.value) return
	const sName = server.value.name
	const sid = server.value.id
	removeServer(sid)
	addNotification({
		title: 'Сервер удален',
		text: `Сервер "${sName}" успешно удален.`,
		type: 'info',
	})
	router.push('/hosting/manage')
}

function handleAvatarContextMenu(event: MouseEvent) {
	if (!server.value) return
	const isRunning = server.value.status === 'running'
	const isStopped = server.value.status === 'stopped'

	serverContextMenu.value?.open(event, [
		{
			id: 'play',
			label: formatMessage(messages.actionStart),
			icon: PlayIcon,
			shown: isStopped,
			tone: 'brand',
			action: () => handleStartServer(),
		},
		{
			id: 'stop',
			label: formatMessage(messages.actionStop),
			icon: StopCircleIcon,
			shown: isRunning,
			tone: 'red',
			action: () => handleStopServer(),
		},
		{
			id: 'restart',
			label: formatMessage(messages.actionRestart),
			icon: RefreshCwIcon,
			shown: isRunning,
			action: () => handleRestartServer(),
		},
		{
			id: 'add_content',
			label: formatMessage(messages.actionAddContent),
			icon: PlusIcon,
			shown: true,
			action: () => handleBrowseContent(),
		},
		{
			id: 'open_folder',
			label: formatMessage(messages.actionOpenFolder),
			icon: FolderOpenIcon,
			shown: true,
			action: () => handleOpenServerFolder(),
		},
		{
			id: 'change_icon',
			label: formatMessage(messages.actionChangeIcon),
			icon: UploadIcon,
			shown: true,
			action: () => handleChangeAvatar(),
		},
		{
			id: 'copy_address',
			label: formatMessage(messages.actionCopyAddress),
			icon: CopyIcon,
			shown: true,
			action: () => copyAddress(),
		},
		{
			id: 'delete',
			label: formatMessage(messages.actionDelete),
			icon: TrashIcon,
			shown: true,
			tone: 'red',
			action: () => handleDeleteServer(),
		},
	])
}

// ==========================================
// НАВИГАЦИЯ ПО ВКЛАДКАМ (Modrinth NavTabs)
// Порядок: 1. Обзор и Логи, 2. Контент, 3. Файлы, 4. Настройки
// ==========================================
const activeTabIndex = ref(0)
const navTabs = computed(() => [
	{ label: formatMessage(messages.tabOverview), href: 'overview', icon: TerminalSquareIcon },
	{ label: formatMessage(messages.tabContent), href: 'content', icon: BoxesIcon },
	{ label: formatMessage(messages.tabFiles), href: 'files', icon: FolderOpenIcon },
	{ label: formatMessage(messages.tabSettings), href: 'settings', icon: SettingsIcon },
])

watch(
	() => route.query.tab,
	(tab) => {
		if (tab) {
			const found = navTabs.value.findIndex((t) => t.href === tab)
			if (found !== -1) {
				activeTabIndex.value = found
			}
		}
	},
	{ immediate: true },
)

function handleTabClick(index: number) {
	activeTabIndex.value = index
	const targetTab = navTabs.value[index]
	if (targetTab) {
		router.replace({ query: { ...route.query, tab: targetTab.href } }).catch(() => {})
	}
}

// ==========================================
// 1. СТАТИСТИКА И КОНСОЛЬ (Overview)
// ==========================================
const cpuPercent = ref(0)
const ramUsedMb = ref(0)
const ramTotalMb = ref(4096)
const diskMb = ref(0)
const cpuHistory = ref<number[]>([0, 0, 0, 0, 0])
const ramHistory = ref<number[]>([0, 0, 0, 0, 0])

const formattedDisk = computed(() => {
	if (diskMb.value >= 1024) {
		return `${(diskMb.value / 1024).toFixed(2)} GB`
	}
	return `${diskMb.value.toFixed(1)} MB`
})

const uptimeSeconds = ref(0)
let uptimeTimer: ReturnType<typeof setInterval> | null = null

const formattedUptime = computed(() => {
	const h = Math.floor(uptimeSeconds.value / 3600)
	const m = Math.floor((uptimeSeconds.value % 3600) / 60)
	const s = uptimeSeconds.value % 60
	if (h > 0) return `${h}ч ${m}м ${s}с`
	return `${m}м ${s}с`
})

// Console state
interface ConsoleLine {
	id: number
	timestamp: string
	type: 'info' | 'warn' | 'error' | 'system' | 'relay'
	text: string
}

let nextLineId = 1
const consoleLogs = ref<ConsoleLine[]>([])
const consoleInput = ref('')
const consoleFilter = ref('')
const consoleContainer = ref<HTMLElement | null>(null)
const commandHistory = ref<string[]>([])
const historyIndex = ref(-1)

function addLog(text: string, type: ConsoleLine['type'] = 'info') {
	const now = new Date()
	const timestamp = now.toTimeString().split(' ')[0]
	consoleLogs.value.push({
		id: nextLineId++,
		timestamp,
		type,
		text,
	})
	if (consoleLogs.value.length > 500) {
		consoleLogs.value.shift()
	}
	nextTick(() => {
		if (consoleContainer.value) {
			consoleContainer.value.scrollTop = consoleContainer.value.scrollHeight
		}
	})
}

const filteredLogs = computed(() => {
	if (!consoleFilter.value.trim()) return consoleLogs.value
	const q = consoleFilter.value.toLowerCase()
	return consoleLogs.value.filter(
		(l) => l.text.toLowerCase().includes(q) || l.type.toLowerCase().includes(q),
	)
})

let logPollInterval: ReturnType<typeof setInterval> | null = null
let lastLogIndex = 0

function handleProcessExited() {
	if (!server.value) return
	updateServerStatus(server.value.id, 'stopped', 0)
	if (uptimeTimer) {
		clearInterval(uptimeTimer)
		uptimeTimer = null
	}
	if (logPollInterval) {
		clearInterval(logPollInterval)
		logPollInterval = null
	}
	if (metricsInterval) {
		clearInterval(metricsInterval)
		metricsInterval = null
	}
	cpuPercent.value = 0
	ramUsedMb.value = 0
	addLog('[Система] Сервер остановлен.', 'system')
}

function startLogPolling() {
	if (logPollInterval) clearInterval(logPollInterval)
	logPollInterval = setInterval(async () => {
		if (!server.value) return
		try {
			const res = await getLocalServerLogs(server.value.id, lastLogIndex)
			if (res.logs && res.logs.length > 0) {
				for (const line of res.logs) {
					const lvl = line.includes('[STDERR]') || line.includes('ERROR')
						? 'error'
						: line.includes('WARN')
							? 'warn'
							: 'info'
					addLog(line, lvl)
				}
				lastLogIndex = res.total
			}
			if (!res.running && server.value.status === 'running') {
				handleProcessExited()
			}
		} catch (e) {
			// ignore poll errors
		}
	}, 350)
}

async function handleSendCommand() {
	const cmd = consoleInput.value.trim()
	if (!cmd) return

	addLog(`> ${cmd}`, 'system')
	commandHistory.value.push(cmd)
	historyIndex.value = -1
	consoleInput.value = ''

	if (server.value?.status !== 'running') {
		addLog('Сервер не запущен. Команда не может быть выполнена.', 'warn')
		return
	}

	try {
		await sendLocalServerCommand(server.value.id, cmd)
	} catch (e) {
		addLog(`Ошибка отправки команды: ${e}`, 'error')
	}
}

function handleHistoryKey(e: KeyboardEvent) {
	if (e.key === 'ArrowUp') {
		if (commandHistory.value.length === 0) return
		if (historyIndex.value === -1) {
			historyIndex.value = commandHistory.value.length - 1
		} else if (historyIndex.value > 0) {
			historyIndex.value--
		}
		consoleInput.value = commandHistory.value[historyIndex.value] || ''
		e.preventDefault()
	} else if (e.key === 'ArrowDown') {
		if (historyIndex.value === -1) return
		if (historyIndex.value < commandHistory.value.length - 1) {
			historyIndex.value++
			consoleInput.value = commandHistory.value[historyIndex.value] || ''
		} else {
			historyIndex.value = -1
			consoleInput.value = ''
		}
		e.preventDefault()
	}
}

function clearConsole() {
	consoleLogs.value = []
	addLog('Консоль очищена.', 'system')
}

function copyAllLogs() {
	const text = consoleLogs.value
		.map((l) => `[${l.timestamp}] [${l.type.toUpperCase()}] ${l.text}`)
		.join('\n')
	navigator.clipboard.writeText(text)
	addNotification({
		title: 'Логи скопированы',
		text: 'Содержимое консоли скопировано в буфер обмена.',
		type: 'success',
	})
}

// Lifecycle управления сервером
let metricsInterval: ReturnType<typeof setInterval> | null = null

const AIKAR_FLAGS =
	'-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1'

const launchSettings = ref<ServerLaunchSettings>({
	minRamMb: 1024,
	maxRamMb: 4096,
	jvmArgs: '',
	javaPath: '',
	aikarFlags: true,
})

watch(
	() => server.value,
	(s) => {
		if (s) {
			launchSettings.value = {
				minRamMb: s.launchSettings?.minRamMb ?? 1024,
				maxRamMb: s.launchSettings?.maxRamMb ?? 4096,
				jvmArgs: s.launchSettings?.jvmArgs ?? '',
				javaPath: s.launchSettings?.javaPath ?? '',
				aikarFlags: s.launchSettings?.aikarFlags ?? true,
			}
		}
	},
	{ immediate: true },
)

function saveLaunchSettings() {
	if (!server.value) return
	updateServerLaunchSettings(server.value.id, { ...launchSettings.value })
	addNotification({
		title: formatMessage(messages.jvmSavedSuccess),
		type: 'success',
	})
	addLog(`[Параметры запуска] Настройки сохранены: Xms ${launchSettings.value.minRamMb}M, Xmx ${launchSettings.value.maxRamMb}M`, 'info')
}

async function pollMetrics() {
	if (!server.value) return
	try {
		const sDir = server.value.path || (await getServerDirectory(server.value.id))
		const m = await getLocalServerMetrics(server.value.id, sDir)
		if (m.running) {
			cpuPercent.value = Math.min(100, Math.round(m.cpu_percent))
			ramUsedMb.value = m.ram_used_mb
			if (m.ram_total_mb > 0) {
				ramTotalMb.value = m.ram_total_mb
			}
			cpuHistory.value.push(cpuPercent.value)
			if (cpuHistory.value.length > 20) cpuHistory.value.shift()

			const maxRam = launchSettings.value.maxRamMb || 4096
			const ramPct = Math.min(100, Math.round((ramUsedMb.value / maxRam) * 100))
			ramHistory.value.push(ramPct)
			if (ramHistory.value.length > 20) ramHistory.value.shift()
		} else {
			cpuPercent.value = 0
			ramUsedMb.value = 0
		}
		if (m.disk_mb > 0) {
			diskMb.value = m.disk_mb
		}
	} catch (e) {
		// ignore poll errors
	}
}

function startMetricsPolling() {
	if (metricsInterval) clearInterval(metricsInterval)
	pollMetrics()
	metricsInterval = setInterval(pollMetrics, 1500)
}

async function handleStartServer() {
	if (!server.value) return
	updateServerStatus(server.value.id, 'starting')
	addLog(`[Система] Запуск сервера ${server.value.name} (${server.value.core} ${server.value.gameVersion})...`, 'system')

	try {
		const sDir = server.value.path || (await getServerDirectory(server.value.id))
		lastLogIndex = 0

		let finalJvmArgs = launchSettings.value.jvmArgs || ''
		if (launchSettings.value.aikarFlags) {
			finalJvmArgs = `${AIKAR_FLAGS} ${finalJvmArgs}`.trim()
		}

		const pid = await startLocalServerProcess(server.value.id, sDir, {
			minRamMb: launchSettings.value.minRamMb,
			maxRamMb: launchSettings.value.maxRamMb,
			jvmArgs: finalJvmArgs,
			javaPath: launchSettings.value.javaPath,
		})
		updateServerStatus(server.value.id, 'running', 0)
		addLog(`[JVM] Minecraft сервер успешно запущен (PID: ${pid}) на порту ${server.value.port}!`, 'info')

		uptimeSeconds.value = 0
		if (uptimeTimer) clearInterval(uptimeTimer)
		uptimeTimer = setInterval(() => {
			uptimeSeconds.value++
		}, 1000)

		startMetricsPolling()
		startLogPolling()
	} catch (err) {
		console.error('Failed to start server:', err)
		updateServerStatus(server.value.id, 'stopped', 0)
		addLog(`[Ошибка запуска] ${err}`, 'error')
		addNotification({
			title: 'Ошибка запуска сервера',
			text: String(err),
			type: 'error',
		})
	}
}

async function handleStopServer() {
	if (!server.value) return
	addLog(`[Система] Остановка сервера по запросу пользователя...`, 'system')
	try {
		await stopLocalServerProcess(server.value.id)
	} catch (e) {
		console.warn('Failed to stop server:', e)
	}
	handleProcessExited()
}

async function handleRestartServer() {
	await handleStopServer()
	setTimeout(() => {
		handleStartServer()
	}, 1200)
}

function generateSparkline(data: number[]): string {
	if (!data.length) return ''
	const max = 100
	const min = 0
	const width = 120
	const height = 36
	const step = width / (data.length - 1 || 1)
	return data
		.map((val, idx) => {
			const x = idx * step
			const y = height - ((val - min) / (max - min || 1)) * height
			return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
		})
		.join(' ')
}

// ==========================================
// 2. СТРАНИЦА КОНТЕНТА (ContentCardLayout)
// Скопирована и адаптирована из instance/content
// ==========================================
interface ServerAddonItem extends ContentItem {
	id: string
	file_name: string
	project_type: string
	has_update: boolean
	update_version_id: string | null
	enabled: boolean
	date_added?: string
	project: {
		id: string
		slug: string | null
		title: string
		icon_url: string | null
		categories: string[]
	}
	version: {
		id: string
		version_number: string
		file_name: string
	}
	owner: {
		id: string
		name: string
		type: 'user' | 'organization'
	}
	file_size_formatted: string
	description_text: string
}

const serverContent = computed<ServerAddonItem[]>(() => {
	const sid = server.value?.id
	if (!sid) return []
	return getServerAddons(sid) as ServerAddonItem[]
})

const contentLoading = ref(false)

// Настройка provideContentManager для нативного ContentCardLayout
provideContentManager({
	items: serverContent,
	loading: contentLoading,
	error: ref(null),
	managedContent: ref(null),
	isPackLocked: ref(false),
	isBusy: ref(false),
	disableAddContent: ref(false),
	isBulkOperating: ref(false),
	contentTypeLabel: ref('плагины и моды'),
	toggleEnabled: async (item: ContentItem) => {
		const sid = server.value?.id
		if (!sid) return
		toggleServerAddon(sid, item.id)
		try {
			const folder =
				item.project_type === 'mod'
					? 'mods'
					: item.project_type === 'datapack'
						? 'world/datapacks'
						: 'plugins'
			const fileName = item.file_name || `${item.id}.jar`
			const isCurrentlyDisabled = fileName.endsWith('.disabled')
			const currentAbs = resolveServerFilePath(`${folder}/${fileName}`)
			const targetName = isCurrentlyDisabled
				? fileName.replace(/\.disabled$/, '')
				: `${fileName}.disabled`
			const targetAbs = resolveServerFilePath(`${folder}/${targetName}`)
			await rename(currentAbs, targetAbs)
			item.file_name = targetName
		} catch (e) {
			console.warn('Could not rename addon file on disk:', e)
		}
		addLog(
			`[Контент] Переключено состояние: ${item.file_name || item.id}.`,
			'info',
		)
	},
	deleteItem: async (item: ContentItem) => {
		const sid = server.value?.id
		if (!sid) return
		removeServerAddon(sid, item.id)
		try {
			const folder =
				item.project_type === 'mod'
					? 'mods'
					: item.project_type === 'datapack'
						? 'world/datapacks'
						: 'plugins'
			const fileName = item.file_name || `${item.id}.jar`
			const absPath = resolveServerFilePath(`${folder}/${fileName}`)
			await remove(absPath)
			const disabledPath = resolveServerFilePath(`${folder}/${fileName}.disabled`)
			await remove(disabledPath).catch(() => {})
		} catch (e) {
			console.warn('Could not delete addon file from disk:', e)
		}
		addLog(`[Контент] Удален ${item.file_name || item.id}.`, 'warn')
		addNotification({
			title: 'Удалено',
			text: item.file_name || item.id,
			type: 'info',
		})
	},
	refresh: async () => {
		contentLoading.value = true
		setTimeout(() => {
			contentLoading.value = false
		}, 300)
	},
	browse: () => {
		const sid = server.value?.id
		if (!sid) return
		const core = server.value?.core?.toLowerCase()
		const isPluginCore = ['paper', 'purpur', 'spigot', 'folia'].includes(core ?? '')
		router.push({
			path: `/browse/${isPluginCore ? 'plugin' : 'mod'}`,
			query: { sid },
		})
	},
	uploadFiles: () => {
		activeTabIndex.value = 2 // Перейти во вкладку файлов
	},
	hasUpdateSupport: false,
	mapToTableItem: (item: ContentItem) => {
		const serverItem = item as ServerAddonItem
		const projectSlugOrId = serverItem.project?.slug || serverItem.project?.id
		const versionId = serverItem.version?.id
		const authorName = serverItem.owner?.name
		return {
			id: serverItem.id,
			project: serverItem.project,
			projectLink: projectSlugOrId ? `/project/${projectSlugOrId}` : undefined,
			version: serverItem.version,
			versionLink:
				projectSlugOrId && versionId
					? `/project/${projectSlugOrId}/version/${versionId}`
					: undefined,
			owner: serverItem.owner
				? {
						...serverItem.owner,
						link: authorName ? `/user/${encodeURIComponent(authorName)}` : undefined,
					}
				: undefined,
			external: false,
			enabled: serverItem.enabled,
			hasUpdate: false,
		}
	},
})

// ==========================================
// 3. ФАЙЛОВЫЙ МЕНЕДЖЕР (FilePageLayout)
// Реальное чтение и запись файлов с диска (servers/<id>/)
// ==========================================
const serverRootDir = ref<string>('')
const fileManagerItems = ref<FileItem[]>([])
const currentFilePath = ref('')
const filesLoading = ref(false)
const filesError = ref<Error | null>(null)
const editingFile = ref<EditingFile | null>(null)
const uploadState = ref<UploadState>({
	isUploading: false,
	currentFileName: null,
	currentFileProgress: 0,
	uploadedBytes: 0,
	totalBytes: 0,
	completedFiles: 0,
	totalFiles: 0,
})

async function initServerDirectory(): Promise<string> {
	if (serverRootDir.value) return serverRootDir.value
	const sid = effectiveServerId.value
	if (!sid) return ''
	try {
		const dir = server.value?.path || (await getServerDirectory(sid))
		serverRootDir.value = dir
		return dir
	} catch (e) {
		console.error('Failed to get server directory:', e)
		return ''
	}
}

function resolveServerFilePath(relativePath: string): string {
	const root = serverRootDir.value
	if (!root) return ''
	const clean = relativePath.replace(/^[/\\]+/, '').replace(/[/\\]+/g, '/')
	return clean ? `${root}/${clean}` : root
}

async function listServerDirectory(dirRelPath: string): Promise<FileItem[]> {
	const root = await initServerDirectory()
	if (!root) return []
	const absPath = resolveServerFilePath(dirRelPath)
	try {
		const entries = await readDir(absPath)
		const results = await Promise.all(
			entries.map(async (entry) => {
				const entryAbsPath = `${absPath}/${entry.name}`
				let metadata
				try {
					metadata = await stat(entryAbsPath)
				} catch {
					return null
				}
				const item: FileItem = {
					name: entry.name,
					type: entry.isDirectory ? 'directory' : 'file',
					path: dirRelPath ? `${dirRelPath}/${entry.name}` : entry.name,
					modified: metadata.mtime ? Math.floor(metadata.mtime.getTime() / 1000) : Math.floor(Date.now() / 1000),
					created: metadata.birthtime ? Math.floor(metadata.birthtime.getTime() / 1000) : Math.floor(Date.now() / 1000),
				}
				if (!entry.isDirectory) {
					item.size = metadata.size
				} else {
					try {
						const children = await readDir(entryAbsPath)
						item.count = children.length
					} catch {
						item.count = 0
					}
				}
				return item
			}),
		)
		return results
			.filter((item): item is FileItem => item !== null)
			.sort((a, b) => {
				if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
				return a.name.localeCompare(b.name)
			})
	} catch (e) {
		console.warn('Failed to read server dir:', absPath, e)
		return []
	}
}

async function fileManagerRefresh() {
	filesLoading.value = true
	filesError.value = null
	try {
		fileManagerItems.value = await listServerDirectory(currentFilePath.value)
	} catch (e) {
		filesError.value = e instanceof Error ? e : new Error(String(e))
	} finally {
		filesLoading.value = false
	}
}

watch(
	[() => effectiveServerId.value, () => currentFilePath.value],
	async () => {
		serverRootDir.value = ''
		await fileManagerRefresh()
	},
	{ immediate: true },
)

function fileManagerNavigateTo(path: string) {
	currentFilePath.value = path.startsWith('/') ? path.slice(1) : path
	void fileManagerRefresh()
}

function fileManagerStartEditing(file: EditingFile) {
	editingFile.value = file
}

function fileManagerStopEditing() {
	editingFile.value = null
}

async function fileManagerCreateItem(name: string, type: 'file' | 'directory') {
	const relPath = currentFilePath.value ? `${currentFilePath.value}/${name}` : name
	const absPath = resolveServerFilePath(relPath)
	try {
		if (type === 'directory') {
			await mkdir(absPath, { recursive: true })
		} else {
			await writeTextFile(absPath, '')
		}
		await fileManagerRefresh()
		addNotification({
			title: type === 'directory' ? 'Папка создана' : 'Файл создан',
			text: name,
			type: 'success',
		})
	} catch (e) {
		addNotification({
			title: 'Ошибка создания',
			text: e instanceof Error ? e.message : String(e),
			type: 'error',
		})
	}
}

async function fileManagerRenameItem(path: string, newName: string) {
	const oldAbs = resolveServerFilePath(path)
	const parentDir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : ''
	const newPath = parentDir ? `${parentDir}/${newName}` : newName
	const newAbs = resolveServerFilePath(newPath)
	try {
		await rename(oldAbs, newAbs)
		await fileManagerRefresh()
		addNotification({
			title: 'Переименовано',
			text: `${path} -> ${newName}`,
			type: 'success',
		})
	} catch (e) {
		addNotification({
			title: 'Ошибка переименования',
			text: e instanceof Error ? e.message : String(e),
			type: 'error',
		})
	}
}

async function fileManagerMoveItem(src: string, dest: string) {
	const oldAbs = resolveServerFilePath(src)
	const newAbs = resolveServerFilePath(dest)
	try {
		await rename(oldAbs, newAbs)
		await fileManagerRefresh()
		addNotification({
			title: 'Перемещено',
			text: `${src} -> ${dest}`,
			type: 'success',
		})
	} catch (e) {
		addNotification({
			title: 'Ошибка перемещения',
			text: e instanceof Error ? e.message : String(e),
			type: 'error',
		})
	}
}

async function fileManagerDeleteItem(path: string) {
	const absPath = resolveServerFilePath(path)
	try {
		await remove(absPath, { recursive: true })
		await fileManagerRefresh()
		addNotification({
			title: 'Удалено',
			text: path,
			type: 'info',
		})
	} catch (e) {
		addNotification({
			title: 'Ошибка удаления',
			text: e instanceof Error ? e.message : String(e),
			type: 'error',
		})
	}
}

async function fileManagerReadFile(path: string): Promise<string> {
	const absPath = resolveServerFilePath(path)
	try {
		return await readTextFile(absPath)
	} catch (e) {
		if (path.endsWith('server.properties')) {
			return serializeServerProperties()
		}
		if (path.endsWith('eula.txt')) {
			return `# EULA agreement\neula=true\n`
		}
		throw e
	}
}

async function fileManagerReadFileAsBlob(path: string): Promise<Blob> {
	const absPath = resolveServerFilePath(path)
	const bytes = await readFileBytes(absPath)
	return new Blob([bytes])
}

async function fileManagerWriteFile(path: string, content: string) {
	const absPath = resolveServerFilePath(path)
	await writeTextFile(absPath, content)
	if (path.endsWith('server.properties')) {
		parseServerProperties(content)
	}
	await fileManagerRefresh()
	addNotification({
		title: 'Файл сохранен',
		text: path,
		type: 'success',
	})
}

async function fileManagerDownloadFile(path: string, fileName: string) {
	addNotification({
		title: 'Файл сохранен локально',
		text: `${fileName} находится в ${resolveServerFilePath(path)}`,
		type: 'info',
	})
}

async function fileManagerUploadFiles(files: File[]) {
	uploadState.value.isUploading = true
	uploadState.value.totalFiles = files.length
	try {
		for (let i = 0; i < files.length; i++) {
			const f = files[i]
			uploadState.value.currentFileName = f.name
			uploadState.value.completedFiles = i + 1
			const relPath = currentFilePath.value ? `${currentFilePath.value}/${f.name}` : f.name
			const absPath = resolveServerFilePath(relPath)
			const arrayBuf = await f.arrayBuffer()
			await writeFileBytes(absPath, new Uint8Array(arrayBuf))
		}
		await fileManagerRefresh()
		addNotification({
			title: 'Файлы загружены',
			text: `Успешно загружено файлов: ${files.length}`,
			type: 'success',
		})
	} catch (e) {
		addNotification({
			title: 'Ошибка загрузки файлов',
			text: e instanceof Error ? e.message : String(e),
			type: 'error',
		})
	} finally {
		uploadState.value.isUploading = false
	}
}

provideFileManager({
	items: fileManagerItems,
	loading: filesLoading,
	error: filesError,
	currentPath: currentFilePath,
	editingFile,
	uploadState,
	refresh: async () => fileManagerRefresh(),
	navigateTo: fileManagerNavigateTo,
	startEditing: fileManagerStartEditing,
	stopEditing: fileManagerStopEditing,
	createItem: fileManagerCreateItem,
	renameItem: fileManagerRenameItem,
	moveItem: fileManagerMoveItem,
	deleteItem: fileManagerDeleteItem,
	readFile: fileManagerReadFile,
	readFileAsBlob: fileManagerReadFileAsBlob,
	writeFile: fileManagerWriteFile,
	downloadFile: fileManagerDownloadFile,
	uploadFiles: fileManagerUploadFiles,
})

// ==========================================
// 4. НАСТРОЙКИ (ПОЛНЫЙ server.properties)
// Стиль настроек сборок: карточки, Toggle, Chips, Input
// ==========================================
const serverProps = ref({
	// Основные
	motd: 'A Minecraft Server hosted on Bedringh',
	server_port: 25565,
	server_ip: '',
	max_players: 20,
	gamemode: 'survival',
	difficulty: 'normal',
	hardcore: false,
	pvp: true,
	online_mode: false, // Пиратка по умолчанию
	white_list: false,
	enforce_whitelist: false,
	spawn_protection: 16,
	allow_flight: false,
	allow_cheats: true,
	spawn_monsters: true,
	spawn_animals: true,
	spawn_npcs: true,
	hide_online_players: false,
	force_gamemode: false,
	op_permission_level: 4,

	// Производительность и чанки
	view_distance: 10,
	simulation_distance: 8,
	max_tick_time: 60000,
	player_idle_timeout: 0,
	sync_chunk_writes: true,
	network_compression_threshold: 256,
	rate_limit: 0,
	entity_broadcast_range_percentage: 100,

	// Ресурспак (Текстуры)
	resource_pack: '',
	resource_pack_sha1: '',
	require_resource_pack: false,
	resource_pack_prompt: '',

	// Генерация мира
	level_name: 'world',
	level_seed: '',
	level_type: 'minecraft:normal',
	generate_structures: true,
	allow_nether: true,

	// RCON и Query
	enable_rcon: false,
	rcon_port: 25575,
	rcon_password: '',
	enable_query: false,
	query_port: 25565,
})

const propertiesSearch = ref('')

const gamemodeItems = ['survival', 'creative', 'adventure', 'spectator']
const difficultyItems = ['peaceful', 'easy', 'normal', 'hard']

function formatGamemode(mode: string): string {
	switch (mode) {
		case 'survival':
			return formatMessage(messages.gmSurvival)
		case 'creative':
			return formatMessage(messages.gmCreative)
		case 'adventure':
			return formatMessage(messages.gmAdventure)
		case 'spectator':
			return formatMessage(messages.gmSpectator)
		default:
			return mode
	}
}

function formatDifficulty(diff: string): string {
	switch (diff) {
		case 'peaceful':
			return formatMessage(messages.diffPeaceful)
		case 'easy':
			return formatMessage(messages.diffEasy)
		case 'normal':
			return formatMessage(messages.diffNormal)
		case 'hard':
			return formatMessage(messages.diffHard)
		default:
			return diff
	}
}

function serializeServerProperties(): string {
	const p = serverProps.value
	return `# Minecraft server properties
# Updated via Bedringh Server Manager
motd=${p.motd}
server-port=${p.server_port}
server-ip=${p.server_ip}
max-players=${p.max_players}
gamemode=${p.gamemode}
difficulty=${p.difficulty}
hardcore=${p.hardcore}
pvp=${p.pvp}
online-mode=${p.online_mode}
white-list=${p.white_list}
enforce-whitelist=${p.enforce_whitelist}
spawn-protection=${p.spawn_protection}
allow-flight=${p.allow_flight}
enable-command-block=${p.allow_cheats}
spawn-monsters=${p.spawn_monsters}
spawn-animals=${p.spawn_animals}
spawn-npcs=${p.spawn_npcs}
hide-online-players=${p.hide_online_players}
force-gamemode=${p.force_gamemode}
op-permission-level=${p.op_permission_level}
view-distance=${p.view_distance}
simulation-distance=${p.simulation_distance}
max-tick-time=${p.max_tick_time}
player-idle-timeout=${p.player_idle_timeout}
sync-chunk-writes=${p.sync_chunk_writes}
network-compression-threshold=${p.network_compression_threshold}
rate-limit=${p.rate_limit}
entity-broadcast-range-percentage=${p.entity_broadcast_range_percentage}
resource-pack=${p.resource_pack}
resource-pack-sha1=${p.resource_pack_sha1}
require-resource-pack=${p.require_resource_pack}
resource-pack-prompt=${p.resource_pack_prompt}
level-name=${p.level_name}
level-seed=${p.level_seed}
level-type=${p.level_type}
generate-structures=${p.generate_structures}
allow-nether=${p.allow_nether}
enable-rcon=${p.enable_rcon}
rcon.port=${p.rcon_port}
rcon.password=${p.rcon_password}
enable-query=${p.enable_query}
query.port=${p.query_port}
`
}

function parseServerProperties(text: string) {
	const lines = text.split('\n')
	for (const line of lines) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		const idx = trimmed.indexOf('=')
		if (idx === -1) continue
		const key = trimmed.slice(0, idx).trim()
		const val = trimmed.slice(idx + 1).trim()

		if (key === 'motd') serverProps.value.motd = val
		else if (key === 'server-port') serverProps.value.server_port = Number(val) || 25565
		else if (key === 'max-players') serverProps.value.max_players = Number(val) || 20
		else if (key === 'gamemode') serverProps.value.gamemode = val
		else if (key === 'difficulty') serverProps.value.difficulty = val
		else if (key === 'pvp') serverProps.value.pvp = val === 'true'
		else if (key === 'online-mode') serverProps.value.online_mode = val === 'true'
		else if (key === 'white-list') serverProps.value.white_list = val === 'true'
		else if (key === 'hardcore') serverProps.value.hardcore = val === 'true'
		else if (key === 'allow-flight') serverProps.value.allow_flight = val === 'true'
		else if (key === 'enable-command-block') serverProps.value.allow_cheats = val === 'true'
		else if (key === 'view-distance') serverProps.value.view_distance = Number(val) || 10
		else if (key === 'simulation-distance') serverProps.value.simulation_distance = Number(val) || 8
		else if (key === 'resource-pack') serverProps.value.resource_pack = val
		else if (key === 'level-seed') serverProps.value.level_seed = val
	}
}

const originalPropsSnapshot = ref(JSON.stringify(serverProps.value))

const hasUnsavedChanges = computed(() => {
	return JSON.stringify(serverProps.value) !== originalPropsSnapshot.value
})

watch(
	() => server.value?.id,
	async (sid) => {
		if (sid) {
			await initServerDirectory()
			try {
				const propsAbsPath = resolveServerFilePath('server.properties')
				if (propsAbsPath) {
					const text = await readTextFile(propsAbsPath)
					parseServerProperties(text)
				}
			} catch {
				const saved = localStorage.getItem(`bedringh_server_props_${sid}`)
				if (saved) {
					try {
						Object.assign(serverProps.value, JSON.parse(saved))
					} catch {
						// ignore
					}
				}
			}
			originalPropsSnapshot.value = JSON.stringify(serverProps.value)
		}
	},
	{ immediate: true },
)

function resetServerProperties() {
	try {
		serverProps.value = JSON.parse(originalPropsSnapshot.value)
		addNotification({
			title: 'Изменения сброшены',
			text: 'Настройки возвращены к предыдущему состоянию.',
			type: 'info',
		})
	} catch (e) {
		console.error('Failed to reset properties', e)
	}
}

async function saveServerProperties() {
	originalPropsSnapshot.value = JSON.stringify(serverProps.value)
	if (server.value?.id) {
		localStorage.setItem(
			`bedringh_server_props_${server.value.id}`,
			JSON.stringify(serverProps.value),
		)
	}
	try {
		const propsAbsPath = resolveServerFilePath('server.properties')
		if (propsAbsPath) {
			await writeTextFile(propsAbsPath, serializeServerProperties())
		}
	} catch (e) {
		console.warn('Could not write server.properties to disk:', e)
	}
	addLog('[Настройки] server.properties успешно сохранен и применен.', 'info')
	addNotification({
		title: 'Настройки сохранены',
		text: 'Конфигурация server.properties успешно обновлена.',
		type: 'success',
	})
}

function matchesSearch(...terms: (string | undefined | null)[]): boolean {
	if (!propertiesSearch.value.trim()) return true
	const q = propertiesSearch.value.toLowerCase()
	return terms.some((t) => t && t.toLowerCase().includes(q))
}

function copyAddress() {
	const addr = `localhost:${server.value?.port || 25565}`
	navigator.clipboard.writeText(addr)
	addNotification({
		title: 'Адрес скопирован',
		text: addr,
		type: 'success',
	})
}

onMounted(async () => {
	if (server.value) {
		serverProps.value.server_port = server.value.port
		addLog(`[Система] Сервер инициализирован: ${server.value.name}`, 'system')

		// Initial poll for disk size and state
		await pollMetrics()

		try {
			const isRunning = await getLocalServerStatus(server.value.id)
			if (isRunning) {
				updateServerStatus(server.value.id, 'running', 0)
				startMetricsPolling()
				startLogPolling()
			} else if (server.value.status === 'running') {
				updateServerStatus(server.value.id, 'stopped', 0)
			}
		} catch (e) {
			console.warn('Failed to check server status on mount:', e)
		}
	}
})

onUnmounted(() => {
	if (uptimeTimer) clearInterval(uptimeTimer)
	if (metricsInterval) clearInterval(metricsInterval)
	if (logPollInterval) clearInterval(logPollInterval)
})
</script>

<template>
	<div v-if="server" class="flex flex-col gap-6 p-6 max-w-[1280px] mx-auto w-full box-border">
		<!-- Навигация "Назад" -->
		<div class="flex items-center justify-between">
			<router-link
				to="/hosting/manage"
				class="text-secondary hover:text-contrast text-sm font-semibold flex items-center gap-1 no-underline transition-colors"
			>
				<ChevronLeftIcon class="h-4 w-4" />
				<span>{{ formatMessage(messages.allServers) }}</span>
			</router-link>
		</div>

		<!-- ШАПКА СЕРВЕРА (PageHeader в нативном стиле сборок) -->
		<PageHeader :title="server.name">
			<template #leading>
				<div
					class="relative group cursor-pointer"
					title="ПКМ: Действия с сервером / ЛКМ: Сменить иконку"
					@click="handleChangeAvatar"
					@contextmenu.prevent.stop="(event) => handleAvatarContextMenu(event)"
				>
					<Avatar
						:src="server.iconUrl"
						:alt="server.name"
						size="64px"
						pad-transparent-corners
						class="transition-all group-hover:brightness-75"
					/>
					<div
						class="absolute inset-0 rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity"
					>
						<UploadIcon class="size-6 text-white opacity-90" />
					</div>
				</div>
			</template>

			<template #badges>
				<div
					class="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
					:class="
						server.status === 'running'
							? 'bg-green/15 text-green border border-solid border-green/30'
							: server.status === 'starting'
								? 'bg-yellow/15 text-yellow border border-solid border-yellow/30'
								: server.status === 'installing'
									? 'bg-brand/15 text-brand border border-solid border-brand/30'
									: 'bg-surface-4 text-secondary border border-solid border-surface-5'
					"
				>
					<span
						class="size-1.5 rounded-full"
						:class="
							server.status === 'running'
								? 'bg-green animate-ping'
								: server.status === 'starting'
									? 'bg-yellow animate-bounce'
									: server.status === 'installing'
										? 'bg-brand animate-pulse'
										: 'bg-secondary'
						"
					/>
					<span>
						{{
							server.status === 'running'
								? formatMessage(messages.statusRunning)
								: server.status === 'starting'
									? formatMessage(messages.statusStarting)
									: server.status === 'installing'
										? 'Установка...'
										: formatMessage(messages.statusStopped)
						}}
					</span>
				</div>
			</template>

			<template #metadata>
				<PageHeaderMetadata>
					<PageHeaderMetadataItem :icon="TagIcon">
						<span class="capitalize font-bold">{{ server.core }}</span>
						<span class="ml-1">{{ server.gameVersion }}</span>
					</PageHeaderMetadataItem>

					<PageHeaderMetadataItem :icon="LinkIcon">
						<button
							type="button"
							class="bg-transparent border-none p-0 text-secondary hover:text-contrast cursor-pointer flex items-center gap-1 text-sm font-medium"
							@click="copyAddress"
						>
							<span>localhost:{{ server.port }}</span>
							<CopyIcon class="size-3.5 opacity-60 ml-0.5" />
						</button>
					</PageHeaderMetadataItem>

					<PageHeaderMetadataItem v-if="server.status === 'running'" :icon="TimerIcon">
						{{ formattedUptime }}
					</PageHeaderMetadataItem>
				</PageHeaderMetadata>
			</template>

			<template #actions>
				<PageHeaderActions>
					<Button
						v-if="server.status === 'installing'"
						type="colored"
						color="brand"
						size="xl"
						native-type="button"
						disabled
					>
						<LoaderCircleIcon class="size-5 animate-spin" aria-hidden="true" />
						Установка...
					</Button>

					<Button
						v-else-if="server.status === 'stopped'"
						type="colored"
						color="brand"
						size="xl"
						native-type="button"
						@click="handleStartServer"
					>
						<PlayIcon aria-hidden="true" />
						{{ formatMessage(messages.actionStart) }}
					</Button>

					<Button
						v-else-if="server.status === 'starting'"
						type="colored"
						color="brand"
						size="xl"
						native-type="button"
						disabled
					>
						<LoaderCircleIcon class="size-5 animate-spin" aria-hidden="true" />
						{{ formatMessage(messages.statusStarting) }}
					</Button>

					<Button
						v-else
						type="colored"
						color="red"
						size="xl"
						native-type="button"
						@click="handleStopServer"
					>
						<StopCircleIcon aria-hidden="true" />
						{{ formatMessage(messages.actionStop) }}
					</Button>

					<IconButton
						:label="formatMessage(messages.actionRestart)"
						:disabled="server.status !== 'running'"
						@click="handleRestartServer"
					>
						<RefreshCwIcon aria-hidden="true" />
					</IconButton>
				</PageHeaderActions>
			</template>
		</PageHeader>

		<!-- ВКЛАДКИ НАВИГАЦИИ (Нативный NavTabs) -->
		<NavTabs
			:links="navTabs"
			mode="local"
			:active-index="activeTabIndex"
			@tab-click="handleTabClick"
			@tabClick="handleTabClick"
		/>

		<!-- ========================================== -->
		<!-- ВКЛАДКА 1: ОБЗОР И КОНСОЛЬ -->
		<!-- ========================================== -->
		<div v-if="activeTabIndex === 0" class="flex flex-col gap-5">
			<!-- Индикатор загрузки ядра сервера -->
			<div
				v-if="server.status === 'installing' || server.installProgress"
				class="p-5 rounded-2xl bg-brand/10 border border-solid border-brand/30 flex flex-col gap-3"
			>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2.5">
						<LoaderCircleIcon class="size-5 text-brand animate-spin" />
						<span class="font-bold text-contrast text-base">
							{{ server.installProgress?.stage || `Установка ядра ${server.core}...` }}
						</span>
					</div>
					<span class="font-mono font-bold text-brand text-sm">
						{{ server.installProgress?.percent ?? 10 }}%
					</span>
				</div>
				<!-- Полоса прогресса -->
				<div class="w-full bg-surface-4 h-2.5 rounded-full overflow-hidden">
					<div
						class="bg-brand h-full rounded-full transition-all duration-300 ease-out"
						:style="{ width: `${server.installProgress?.percent ?? 10}%` }"
					/>
				</div>
				<div class="flex items-center justify-between text-xs text-secondary">
					<span>Загрузка server.jar для {{ server.core }} {{ server.gameVersion }}</span>
					<span v-if="server.installProgress?.receivedMb" class="font-mono">
						{{ server.installProgress.receivedMb }} / {{ server.installProgress.totalMb || '?' }} МБ
					</span>
				</div>
			</div>
			<!-- Метрики RAM, CPU, Storage -->
			<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
				<div class="relative overflow-hidden rounded-[20px] bg-bg-raised border border-solid border-surface-4 p-5 flex flex-col justify-between min-h-[140px]">
					<div class="flex items-center justify-between z-10">
						<span class="text-sm font-bold text-secondary uppercase tracking-wider">{{ formatMessage(messages.metricRam) }}</span>
						<DatabaseIcon class="size-6 text-brand" />
					</div>
					<div class="flex items-baseline gap-2 z-10 my-1">
						<span class="text-3xl font-black text-contrast">
							{{ server.status === 'running' ? `${(ramUsedMb / 1024).toFixed(2)} GB` : '0 GB' }}
						</span>
						<span class="text-sm font-semibold text-secondary">
							/ {{ (launchSettings.maxRamMb / 1024).toFixed(1) }} GB
						</span>
					</div>
					<svg
						v-if="server.status === 'running'"
						class="absolute bottom-0 left-0 right-0 h-10 w-full opacity-35 text-brand"
						viewBox="0 0 120 36"
						preserveAspectRatio="none"
					>
						<path
							:d="generateSparkline(ramHistory)"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
						/>
					</svg>
				</div>

				<div class="relative overflow-hidden rounded-[20px] bg-bg-raised border border-solid border-surface-4 p-5 flex flex-col justify-between min-h-[140px]">
					<div class="flex items-center justify-between z-10">
						<span class="text-sm font-bold text-secondary uppercase tracking-wider">{{ formatMessage(messages.metricCpu) }}</span>
						<CpuIcon class="size-6 text-brand" />
					</div>
					<div class="flex items-baseline gap-2 z-10 my-1">
						<span class="text-3xl font-black text-contrast">
							{{ server.status === 'running' ? `${cpuPercent}%` : '0%' }}
						</span>
					</div>
					<svg
						v-if="server.status === 'running'"
						class="absolute bottom-0 left-0 right-0 h-10 w-full opacity-35 text-brand"
						viewBox="0 0 120 36"
						preserveAspectRatio="none"
					>
						<path
							:d="generateSparkline(cpuHistory)"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
						/>
					</svg>
				</div>

				<div class="relative overflow-hidden rounded-[20px] bg-bg-raised border border-solid border-surface-4 p-5 flex flex-col justify-between min-h-[140px]">
					<div class="flex items-center justify-between z-10">
						<span class="text-sm font-bold text-secondary uppercase tracking-wider">{{ formatMessage(messages.metricDisk) }}</span>
						<FolderOpenIcon class="size-6 text-brand" />
					</div>
					<div class="flex items-baseline gap-2 z-10 my-1">
						<span class="text-3xl font-black text-contrast">{{ formattedDisk }}</span>
					</div>
					<div
						class="text-xs text-brand font-semibold cursor-pointer hover:underline z-10"
						@click="activeTabIndex = 2"
					>
						{{ formatMessage(messages.tabFiles) }} &rarr;
					</div>
				</div>
			</div>

			<!-- Терминал Minecraft Консоли -->
			<div class="bg-bg-raised border border-solid border-surface-4 rounded-3xl overflow-hidden flex flex-col">
				<div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-solid border-surface-4 bg-surface-2">
					<div class="flex items-center gap-2 font-bold text-contrast text-base">
						<span>Консоль сервера</span>
						<span
							class="size-2 rounded-full"
							:class="server.status === 'running' ? 'bg-green' : 'bg-secondary'"
						/>
					</div>

					<div class="flex items-center gap-2">
						<div class="relative flex items-center">
							<SearchIcon class="size-3.5 absolute left-2.5 text-secondary pointer-events-none" />
							<input
								v-model="consoleFilter"
								type="text"
								:placeholder="formatMessage(messages.filterPlaceholder)"
								class="bg-surface-3 text-contrast placeholder:text-secondary rounded-lg pl-8 pr-3 py-1 text-xs border border-solid border-transparent focus:border-brand focus:outline-none w-48 transition-colors"
							/>
						</div>

						<IconButton
							:label="formatMessage(messages.consoleCopy)"
							@click="copyAllLogs"
						>
							<CopyIcon class="size-4" />
						</IconButton>

						<IconButton
							:label="formatMessage(messages.consoleClear)"
							@click="clearConsole"
						>
							<TrashIcon class="size-4" />
						</IconButton>
					</div>
				</div>

				<div
					ref="consoleContainer"
					class="p-4 bg-surface-1 font-mono text-xs leading-5 h-[460px] overflow-y-auto flex flex-col gap-1 select-text"
				>
					<div
						v-for="log in filteredLogs"
						:key="log.id"
						class="flex items-start gap-2 break-all"
					>
						<span class="text-secondary select-none opacity-60">[{{ log.timestamp }}]</span>
						<span
							:class="
								log.type === 'warn'
									? 'text-yellow'
									: log.type === 'error'
										? 'text-red font-bold'
										: log.type === 'relay'
											? 'text-brand font-bold'
											: log.type === 'system'
												? 'text-blue'
												: 'text-contrast'
							"
						>
							{{ log.text }}
						</span>
					</div>

					<div v-if="filteredLogs.length === 0" class="text-secondary italic text-center py-10">
						{{ consoleFilter ? 'Ничего не найдено по вашему запросу.' : 'Логов пока нет.' }}
					</div>
				</div>

				<form
					class="flex items-center gap-2 p-3 bg-surface-2 border-t border-solid border-surface-4"
					@submit.prevent="handleSendCommand"
				>
					<span class="font-mono text-sm font-bold text-brand pl-2">&gt;</span>
					<input
						v-model="consoleInput"
						type="text"
						class="flex-1 bg-surface-3 text-contrast placeholder:text-secondary rounded-xl px-4 py-2.5 text-sm border border-solid border-transparent focus:border-brand focus:outline-none transition-colors"
						:placeholder="formatMessage(messages.inputPlaceholder)"
						@keydown="handleHistoryKey"
					/>
					<ButtonStyled color="brand">
						<button type="submit">
							&crarr;
						</button>
					</ButtonStyled>
				</form>
			</div>
		</div>

		<!-- ========================================== -->
		<!-- ВКЛАДКА 2: КОНТЕНТ (ContentCardLayout)     -->
		<!-- Скопировано со страницы контента сборок     -->
		<!-- ========================================== -->
		<div v-if="activeTabIndex === 1" class="flex flex-col gap-4">
			<ContentCardLayout />
		</div>

		<!-- ========================================== -->
		<!-- ВКЛАДКА 3: ФАЙЛЫ (FilePageLayout)          -->
		<!-- Скопировано со страницы файлов сборок      -->
		<!-- ========================================== -->
		<div v-if="activeTabIndex === 2" class="flex flex-col gap-4">
			<FilePageLayout :show-refresh-button="true" />
		</div>

		<!-- ========================================== -->
		<!-- ВКЛАДКА 4: НАСТРОЙКИ (server.properties)   -->
		<!-- Стиль настроек Modrinth: карточки, Chips,  -->
		<!-- Toggle, Input                              -->
		<!-- ========================================== -->
		<div v-if="activeTabIndex === 3" class="max-w-[860px] mx-auto w-full flex flex-col gap-6 pb-12">
			<!-- 0. Параметры запуска и память JVM -->
			<div class="flex flex-col gap-2.5">
				<div class="flex items-center justify-between">
					<div>
						<h3 class="m-0 text-base font-semibold text-contrast">
							{{ formatMessage(messages.jvmHeading) }}
						</h3>
						<p class="m-0 text-xs text-secondary mt-0.5">
							{{ formatMessage(messages.jvmDescription) }}
						</p>
					</div>
					<Button
						type="colored"
						color="brand"
						size="sm"
						native-type="button"
						@click="saveLaunchSettings"
					>
						{{ formatMessage(messages.jvmSaveBtn) }}
					</Button>
				</div>

				<div class="flex flex-col gap-3 rounded-2xl border border-solid border-surface-5 p-5 bg-surface-1">
					<!-- Min RAM -->
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">{{ formatMessage(messages.jvmMinRam) }}</span>
							<span class="text-xs text-secondary">Начальный объем памяти JVM (-Xms) в мегабайтах</span>
						</div>
						<div class="w-full sm:w-[200px] shrink-0">
							<Input
								v-model.number="launchSettings.minRamMb"
								type="number"
								placeholder="1024"
								wrapper-class="w-full"
							/>
						</div>
					</div>

					<!-- Max RAM -->
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">{{ formatMessage(messages.jvmMaxRam) }}</span>
							<span class="text-xs text-secondary">Максимальный предел памяти сервера (-Xmx) в мегабайтах</span>
						</div>
						<div class="flex items-center gap-2 w-full sm:w-[320px] shrink-0 justify-end">
							<button
								v-for="preset in [2048, 4096, 6144, 8192]"
								:key="preset"
								type="button"
								class="px-2 py-1 text-xs rounded-lg border border-solid transition-colors cursor-pointer"
								:class="launchSettings.maxRamMb === preset ? 'bg-brand/20 border-brand text-brand font-bold' : 'bg-surface-3 border-surface-4 text-secondary hover:text-contrast'"
								@click="launchSettings.maxRamMb = preset"
							>
								{{ preset / 1024 }}G
							</button>
							<div class="w-[120px]">
								<Input
									v-model.number="launchSettings.maxRamMb"
									type="number"
									placeholder="4096"
									wrapper-class="w-full"
								/>
							</div>
						</div>
					</div>

					<!-- Aikar Flags Toggle -->
					<div class="flex items-center justify-between gap-4 py-2 border-b border-surface-4/40 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">{{ formatMessage(messages.jvmAikarFlags) }}</span>
							<span class="text-xs text-secondary">{{ formatMessage(messages.jvmAikarFlagsDesc) }}</span>
						</div>
						<Toggle v-model="launchSettings.aikarFlags" class="shrink-0" />
					</div>

					<!-- Custom JVM Arguments -->
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">{{ formatMessage(messages.jvmCustomArgs) }}</span>
							<span class="text-xs text-secondary">Пользовательские флаги, передаваемые Java виртуальной машине</span>
						</div>
						<div class="w-full sm:w-[340px] shrink-0">
							<Input
								v-model="launchSettings.jvmArgs"
								:placeholder="formatMessage(messages.jvmCustomArgsPlaceholder)"
								wrapper-class="w-full"
							/>
						</div>
					</div>

					<!-- Java Executable Path -->
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">{{ formatMessage(messages.jvmJavaPath) }}</span>
							<span class="text-xs text-secondary">Пользовательский путь к java.exe (оставьте пустым для автопоиска)</span>
						</div>
						<div class="w-full sm:w-[340px] shrink-0">
							<Input
								v-model="launchSettings.javaPath"
								:placeholder="formatMessage(messages.jvmJavaPathPlaceholder)"
								wrapper-class="w-full"
							/>
						</div>
					</div>
				</div>
			</div>

			<!-- Панель поиска параметров -->
			<div class="w-full text-sm">
				<Input
					v-model="propertiesSearch"
					:icon="SearchIcon"
					type="search"
					size="medium"
					:placeholder="formatMessage(messages.propsSearchPlaceholder)"
					wrapper-class="w-full"
				/>
			</div>

			<!-- 1. Основные параметры игрового процесса -->
			<div
				v-show="matchesSearch('основные', 'motd', 'gamemode', 'difficulty', 'port', 'max players', 'pvp', 'hardcore', 'flight', 'полет', 'cheats', 'читер', 'команд', 'сложность', 'режим', 'животн', 'монстр', 'жител', serverProps.motd)"
				class="flex flex-col gap-2.5"
			>
				<h3 class="m-0 text-base font-semibold text-contrast">
					Основные параметры игрового процесса
				</h3>
				<div class="flex flex-col gap-3 rounded-2xl border border-solid border-surface-5 p-5 bg-surface-1">
					<!-- MOTD -->
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">Описание сервера (MOTD)</span>
							<span class="text-xs text-secondary">Текст в сетевом списке серверов Minecraft</span>
						</div>
						<div class="w-full sm:w-[320px] shrink-0">
							<Input
								v-model="serverProps.motd"
								placeholder="A Minecraft Server"
								wrapper-class="w-full"
							/>
						</div>
					</div>

					<!-- Gamemode -->
					<div class="flex flex-col gap-2 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">Режим игры по умолчанию (gamemode)</span>
							<span class="text-xs text-secondary">Начальный режим для новых игроков</span>
						</div>
						<Chips
							v-model="serverProps.gamemode"
							:items="gamemodeItems"
							:format-label="formatGamemode"
						/>
					</div>

					<!-- Difficulty -->
					<div class="flex flex-col gap-2 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">Сложность (difficulty)</span>
							<span class="text-xs text-secondary">Влияет на урон мобов и голод</span>
						</div>
						<Chips
							v-model="serverProps.difficulty"
							:items="difficultyItems"
							:format-label="formatDifficulty"
						/>
					</div>

					<!-- Port -->
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">Порт сервера (server-port)</span>
							<span class="text-xs text-secondary">Сетевой порт для подключения игроков (стандарт: 25565)</span>
						</div>
						<div class="w-full sm:w-[140px] shrink-0">
							<Input
								v-model.number="serverProps.server_port"
								type="number"
								placeholder="25565"
								wrapper-class="w-full"
							/>
						</div>
					</div>

					<!-- Max Players -->
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">Максимум игроков (max-players)</span>
							<span class="text-xs text-secondary">Максимальный онлайн на сервере</span>
						</div>
						<div class="w-full sm:w-[140px] shrink-0">
							<Input
								v-model.number="serverProps.max_players"
								type="number"
								placeholder="20"
								wrapper-class="w-full"
							/>
						</div>
					</div>

					<!-- PvP -->
					<div class="flex items-center justify-between gap-4 py-2 border-b border-surface-4/40 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">PvP урон (pvp)</span>
							<span class="text-xs text-secondary">Разрешить игрокам атаковать друг друга</span>
						</div>
						<Toggle v-model="serverProps.pvp" class="shrink-0" />
					</div>

					<!-- Hardcore -->
					<div class="flex items-center justify-between gap-4 py-2 border-b border-surface-4/40 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Режим Хардкор (hardcore)</span>
							<span class="text-xs text-secondary">Игроки блокируются на сервере после смерти</span>
						</div>
						<Toggle v-model="serverProps.hardcore" class="shrink-0" />
					</div>

					<!-- Allow Flight -->
					<div class="flex items-center justify-between gap-4 py-2 border-b border-surface-4/40 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Разрешить полёты (allow-flight)</span>
							<span class="text-xs text-secondary">Не кикать игроков при парении в воздухе</span>
						</div>
						<Toggle v-model="serverProps.allow_flight" class="shrink-0" />
					</div>

					<!-- Cheats / Command blocks -->
					<div class="flex items-center justify-between gap-4 py-2 border-b border-surface-4/40 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Командные блоки (enable-command-block)</span>
							<span class="text-xs text-secondary">Разрешить выполнение командных блоков в мире</span>
						</div>
						<Toggle v-model="serverProps.allow_cheats" class="shrink-0" />
					</div>

					<!-- Spawn Animals -->
					<div class="flex items-center justify-between gap-4 py-2 border-b border-surface-4/40 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Спавн животных (spawn-animals)</span>
							<span class="text-xs text-secondary">Мирные существа (коровы, овцы, свиньи)</span>
						</div>
						<Toggle v-model="serverProps.spawn_animals" class="shrink-0" />
					</div>

					<!-- Spawn Monsters -->
					<div class="flex items-center justify-between gap-4 py-2 border-b border-surface-4/40 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Спавн монстров (spawn-monsters)</span>
							<span class="text-xs text-secondary">Враждебные существа (зомби, скелеты, криперы)</span>
						</div>
						<Toggle v-model="serverProps.spawn_monsters" class="shrink-0" />
					</div>

					<!-- Spawn NPCs -->
					<div class="flex items-center justify-between gap-4 py-2 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Спавн жителей деревень (spawn-npcs)</span>
							<span class="text-xs text-secondary">Жители и странствующие торговцы</span>
						</div>
						<Toggle v-model="serverProps.spawn_npcs" class="shrink-0" />
					</div>
				</div>
			</div>

			<!-- 2. Лицензия и безопасность -->
			<div
				v-show="matchesSearch('лицензия', 'пират', 'online mode', 'whitelist', 'белый список', 'сеть', 'безопасность', 'скрывать', 'hide')"
				class="flex flex-col gap-2.5"
			>
				<h3 class="m-0 text-base font-semibold text-contrast">
					Лицензия и безопасность
				</h3>
				<div class="flex flex-col gap-3 rounded-2xl border border-solid border-surface-5 p-5 bg-surface-1">
					<!-- Пиратский режим -->
					<div class="flex items-center justify-between gap-4 py-2 border-b border-surface-4/40 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Пиратский режим (Online Mode: ВЫКЛ)</span>
							<span class="text-xs text-secondary">Позволяет заходить игрокам с любыми лаунчерами без лицензии Mojang</span>
						</div>
						<Toggle
							:model-value="!serverProps.online_mode"
							class="shrink-0"
							@update:model-value="serverProps.online_mode = !$event"
						/>
					</div>

					<!-- Whitelist -->
					<div class="flex items-center justify-between gap-4 py-2 border-b border-surface-4/40 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Белый список (white-list)</span>
							<span class="text-xs text-secondary">Доступ на сервер только для ников из whitelist.json</span>
						</div>
						<Toggle v-model="serverProps.white_list" class="shrink-0" />
					</div>

					<!-- Enforce Whitelist -->
					<div class="flex items-center justify-between gap-4 py-2 border-b border-surface-4/40 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Строгий белый список (enforce-whitelist)</span>
							<span class="text-xs text-secondary">Кикать игроков при удалении из белого списка</span>
						</div>
						<Toggle v-model="serverProps.enforce_whitelist" class="shrink-0" />
					</div>

					<!-- Hide Online Players -->
					<div class="flex items-center justify-between gap-4 py-2 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Скрывать список игроков (hide-online-players)</span>
							<span class="text-xs text-secondary">Не показывать ники игроков при наведении в сетевом меню</span>
						</div>
						<Toggle v-model="serverProps.hide_online_players" class="shrink-0" />
					</div>
				</div>
			</div>

			<!-- 3. Производительность и чанки -->
			<div
				v-show="matchesSearch('производительность', 'чанк', 'view distance', 'прорисовка', 'симуляция', 'simulation', 'память', 'sync chunk', 'tick time', 'idle')"
				class="flex flex-col gap-2.5"
			>
				<h3 class="m-0 text-base font-semibold text-contrast">
					Производительность и чанки
				</h3>
				<div class="flex flex-col gap-3 rounded-2xl border border-solid border-surface-5 p-5 bg-surface-1">
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">Дальность прорисовки (view-distance)</span>
							<span class="text-xs text-secondary">Радиус чанков вокруг игрока (рекомендуется 8-12)</span>
						</div>
						<div class="w-full sm:w-[140px] shrink-0">
							<Input
								v-model.number="serverProps.view_distance"
								type="number"
								placeholder="10"
								wrapper-class="w-full"
							/>
						</div>
					</div>

					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">Дальность симуляции (simulation-distance)</span>
							<span class="text-xs text-secondary">Радиус тика сущностей и механизмов (рекомендуется 6-8)</span>
						</div>
						<div class="w-full sm:w-[140px] shrink-0">
							<Input
								v-model.number="serverProps.simulation_distance"
								type="number"
								placeholder="8"
								wrapper-class="w-full"
							/>
						</div>
					</div>

					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">Макс. время тика в мс (max-tick-time)</span>
							<span class="text-xs text-secondary">При превышении сторожевой таймер считает сервер зависшим</span>
						</div>
						<div class="w-full sm:w-[140px] shrink-0">
							<Input
								v-model.number="serverProps.max_tick_time"
								type="number"
								placeholder="60000"
								wrapper-class="w-full"
							/>
						</div>
					</div>

					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">Таймаут AFK в минутах (player-idle-timeout)</span>
							<span class="text-xs text-secondary">0 — отключено (не кикать неактивных игроков)</span>
						</div>
						<div class="w-full sm:w-[140px] shrink-0">
							<Input
								v-model.number="serverProps.player_idle_timeout"
								type="number"
								placeholder="0"
								wrapper-class="w-full"
							/>
						</div>
					</div>

					<div class="flex items-center justify-between gap-4 py-2 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Синхронная запись чанков (sync-chunk-writes)</span>
							<span class="text-xs text-secondary">Гарантирует надежное сохранение карты на диск без сбоев</span>
						</div>
						<Toggle v-model="serverProps.sync_chunk_writes" class="shrink-0" />
					</div>
				</div>
			</div>

			<!-- 4. Ресурспак сервера -->
			<div
				v-show="matchesSearch('ресурспак', 'текстурпак', 'resource pack', 'текстуры', 'sha1')"
				class="flex flex-col gap-2.5"
			>
				<h3 class="m-0 text-base font-semibold text-contrast">
					Ресурспак сервера
				</h3>
				<div class="flex flex-col gap-3 rounded-2xl border border-solid border-surface-5 p-5 bg-surface-1">
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">Прямая ссылка на ресурспак (resource-pack)</span>
							<span class="text-xs text-secondary">URL прямого скачивания zip-архива с текстурами</span>
						</div>
						<div class="w-full sm:w-[320px] shrink-0">
							<Input
								v-model="serverProps.resource_pack"
								type="text"
								placeholder="https://example.com/pack.zip"
								wrapper-class="w-full"
							/>
						</div>
					</div>

					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">Хэш SHA-1 (resource-pack-sha1)</span>
							<span class="text-xs text-secondary">Контрольная сумма для валидации клиентом</span>
						</div>
						<div class="w-full sm:w-[320px] shrink-0">
							<Input
								v-model="serverProps.resource_pack_sha1"
								type="text"
								placeholder="40-символьный хэш sha1"
								wrapper-class="w-full"
							/>
						</div>
					</div>

					<div class="flex items-center justify-between gap-4 py-2 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Обязательный ресурспак (require-resource-pack)</span>
							<span class="text-xs text-secondary">Отключать игроков, отклонивших загрузку ресурспака</span>
						</div>
						<Toggle v-model="serverProps.require_resource_pack" class="shrink-0" />
					</div>
				</div>
			</div>

			<!-- 5. Генерация мира -->
			<div
				v-show="matchesSearch('мир', 'генерация', 'seed', 'сид', 'level', 'структуры', 'незер', 'nether')"
				class="flex flex-col gap-2.5"
			>
				<h3 class="m-0 text-base font-semibold text-contrast">
					Генерация мира
				</h3>
				<div class="flex flex-col gap-3 rounded-2xl border border-solid border-surface-5 p-5 bg-surface-1">
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">Имя папки мира (level-name)</span>
							<span class="text-xs text-secondary">Название каталога сохранений мира</span>
						</div>
						<div class="w-full sm:w-[220px] shrink-0">
							<Input
								v-model="serverProps.level_name"
								type="text"
								placeholder="world"
								wrapper-class="w-full"
							/>
						</div>
					</div>

					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
						<div class="flex flex-col gap-0.5">
							<span class="font-semibold text-contrast text-sm">Сид генерации (level-seed)</span>
							<span class="text-xs text-secondary">Ключ генерации (оставьте пустым для случайного)</span>
						</div>
						<div class="w-full sm:w-[220px] shrink-0">
							<Input
								v-model="serverProps.level_seed"
								type="text"
								placeholder="Случайный"
								wrapper-class="w-full"
							/>
						</div>
					</div>

					<div class="flex items-center justify-between gap-4 py-2 border-b border-surface-4/40 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Генерация структур (generate-structures)</span>
							<span class="text-xs text-secondary">Деревни, храмы, крепости и подземелья</span>
						</div>
						<Toggle v-model="serverProps.generate_structures" class="shrink-0" />
					</div>

					<div class="flex items-center justify-between gap-4 py-2 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Нижний мир (allow-nether)</span>
							<span class="text-xs text-secondary">Разрешить порталы и измерение Незер</span>
						</div>
						<Toggle v-model="serverProps.allow_nether" class="shrink-0" />
					</div>
				</div>
			</div>

			<!-- 6. Удаленный доступ (RCON и Query) -->
			<div
				v-show="matchesSearch('rcon', 'query', 'удаленный', 'пароль', 'gamespy')"
				class="flex flex-col gap-2.5"
			>
				<h3 class="m-0 text-base font-semibold text-contrast">
					Удаленный доступ (RCON и Query)
				</h3>
				<div class="flex flex-col gap-3 rounded-2xl border border-solid border-surface-5 p-5 bg-surface-1">
					<div class="flex items-center justify-between gap-4 py-2 border-b border-surface-4/40 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Включить RCON (enable-rcon)</span>
							<span class="text-xs text-secondary">Удаленное администрирование консоли</span>
						</div>
						<Toggle v-model="serverProps.enable_rcon" class="shrink-0" />
					</div>

					<template v-if="serverProps.enable_rcon">
						<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
							<div class="flex flex-col gap-0.5">
								<span class="font-semibold text-contrast text-sm">Порт RCON (rcon.port)</span>
								<span class="text-xs text-secondary">Порт удаленного доступа</span>
							</div>
							<div class="w-full sm:w-[140px] shrink-0">
								<Input
									v-model.number="serverProps.rcon_port"
									type="number"
									placeholder="25575"
									wrapper-class="w-full"
								/>
							</div>
						</div>

						<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-surface-4/40">
							<div class="flex flex-col gap-0.5">
								<span class="font-semibold text-contrast text-sm">Пароль RCON (rcon.password)</span>
								<span class="text-xs text-secondary">Пароль для авторизации через RCON</span>
							</div>
							<div class="w-full sm:w-[220px] shrink-0">
								<Input
									v-model="serverProps.rcon_password"
									type="password"
									placeholder="Надежный пароль..."
									wrapper-class="w-full"
								/>
							</div>
						</div>
					</template>

					<div class="flex items-center justify-between gap-4 py-2 min-h-10">
						<div class="flex flex-col gap-0.5 pr-2">
							<span class="font-semibold text-contrast text-sm">Включить GameSpy4 Query (enable-query)</span>
							<span class="text-xs text-secondary">Опрос статуса сервера ботами и сайтами мониторинга</span>
						</div>
						<Toggle v-model="serverProps.enable_query" class="shrink-0" />
					</div>
				</div>
			</div>
		</div>

		<!-- Плавающий баннер сохранения настроек (Modrinth FloatingActionBar) -->
		<FloatingActionBar :shown="hasUnsavedChanges && activeTabIndex === 3">
			<div class="flex items-center gap-2">
				<span class="text-sm font-semibold text-contrast">У вас есть несохраненные изменения</span>
			</div>
			<div class="ml-auto flex items-center gap-2">
				<Button
					type="quiet"
					@click="resetServerProperties"
				>
					<HistoryIcon class="size-4" />
					<span>Сбросить</span>
				</Button>
				<Button
					type="colored"
					color="brand"
					@click="saveServerProperties"
				>
					<CheckIcon class="size-4" />
					<span>Сохранить настройки</span>
				</Button>
			</div>
		</FloatingActionBar>

		<!-- Контекстное меню действий с сервером (ПКМ по аватарке) -->
		<ContextMenu ref="serverContextMenu" label="Действия с сервером" />

		<!-- Модальное окно подтверждения удаления сервера -->
		<ConfirmModal
			ref="deleteServerModal"
			:title="formatMessage(messages.deleteModalTitle)"
			:description="formatMessage(messages.deleteModalDescription)"
			:proceed-label="formatMessage(messages.deleteModalConfirm)"
			danger
			@proceed="confirmDeleteServer"
		/>
	</div>

	<!-- Сервер не найден -->
	<div
		v-else
		class="min-h-[50vh] flex flex-col items-center justify-center gap-4 text-center p-6"
	>
		<ServerStackIcon class="size-16 text-secondary/50" />
		<h2 class="m-0 text-xl font-bold text-contrast">404</h2>
		<p class="m-0 text-sm text-secondary">
			{{ effectiveServerId }}
		</p>
		<router-link
			to="/hosting/manage"
			class="button-base bg-brand text-brand-contrast px-5 py-2.5 rounded-xl font-bold text-sm no-underline"
		>
			{{ formatMessage(messages.allServers) }}
		</router-link>
	</div>
</template>
