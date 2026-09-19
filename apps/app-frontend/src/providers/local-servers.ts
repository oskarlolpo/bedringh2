import { ref, computed } from 'vue'

export type ServerCore =
	| 'paper'
	| 'purpur'
	| 'spigot'
	| 'folia'
	| 'fabric'
	| 'forge'
	| 'neoforge'
	| 'vanilla'

export interface ServerAddonItem {
	id: string
	file_name: string
	project_type: string
	has_update?: boolean
	update_version_id?: string | null
	enabled: boolean
	date_added?: string
	description_text?: string
	file_size_formatted?: string
	project: {
		id: string
		slug?: string | null
		title: string
		icon_url?: string | null
		categories?: string[]
	}
	version: {
		id: string
		version_number: string
		file_name: string
	}
	owner: {
		id: string
		name: string
		type: string
	}
}

export interface ServerLaunchSettings {
	minRamMb?: number
	maxRamMb?: number
	jvmArgs?: string
	javaPath?: string
	aikarFlags?: boolean
}

export interface LocalServer {
	id: string
	name: string
	iconUrl?: string
	core: ServerCore
	gameVersion: string
	coreVersion?: string
	path?: string
	port: number
	motd?: string
	status: 'installing' | 'stopped' | 'starting' | 'running'
	installProgress?: {
		stage: string
		percent: number
		receivedMb?: string
		totalMb?: string
	}
	players: number
	maxPlayers: number
	createdAt: number
	addons?: ServerAddonItem[]
	launchSettings?: ServerLaunchSettings
}

const STORAGE_KEY = 'bedringh_local_servers_v1'

function loadFromStorage(): LocalServer[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (raw) {
			const parsed = JSON.parse(raw)
			if (Array.isArray(parsed)) {
				// Filter out old mock servers
				const filtered = parsed.filter((s: LocalServer) => s.id !== 'srv-1' && s.id !== 'srv-2')
				if (filtered.length !== parsed.length) {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
				}
				return filtered.map((s) => ({
					...s,
					addons: Array.isArray(s.addons) ? s.addons : [],
				}))
			}
		}
	} catch (e) {
		console.warn('Failed to load local servers from localStorage', e)
	}
	return []
}

const servers = ref<LocalServer[]>(loadFromStorage())

function saveToStorage() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(servers.value))
	} catch (e) {
		console.error('Failed to save local servers', e)
	}
}

export function useLocalServers() {
	const allServers = computed(() => servers.value)

	function addServer(server: Omit<LocalServer, 'id' | 'createdAt' | 'status' | 'players' | 'addons'>) {
		const newServer: LocalServer = {
			...server,
			id: 'srv-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
			createdAt: Date.now(),
			status: 'stopped',
			players: 0,
			addons: [],
		}
		servers.value.unshift(newServer)
		saveToStorage()
		return newServer
	}

	function removeServer(id: string) {
		servers.value = servers.value.filter((s) => s.id !== id)
		saveToStorage()
	}

	function getServerById(id: string) {
		return servers.value.find((s) => s.id === id)
	}

	function updateServer(id: string, partial: Partial<LocalServer>) {
		const s = getServerById(id)
		if (s) {
			Object.assign(s, partial)
			saveToStorage()
		}
	}

	function updateServerStatus(id: string, status: LocalServer['status'], players = 0) {
		const s = getServerById(id)
		if (s) {
			s.status = status
			s.players = players
			saveToStorage()
		}
	}

	function getServerAddons(serverId: string): ServerAddonItem[] {
		const s = getServerById(serverId)
		if (!s) return []
		if (!Array.isArray(s.addons)) s.addons = []
		return s.addons
	}

	function addServerAddon(serverId: string, addon: ServerAddonItem) {
		const s = getServerById(serverId)
		if (!s) return
		if (!Array.isArray(s.addons)) s.addons = []
		const existingIndex = s.addons.findIndex(
			(a) => a.project?.id === addon.project?.id || a.id === addon.id,
		)
		if (existingIndex >= 0) {
			s.addons[existingIndex] = addon
		} else {
			s.addons.push(addon)
		}
		saveToStorage()
	}

	function removeServerAddon(serverId: string, addonId: string) {
		const s = getServerById(serverId)
		if (!s || !Array.isArray(s.addons)) return
		s.addons = s.addons.filter((a) => a.id !== addonId && a.project?.id !== addonId)
		saveToStorage()
	}

	function toggleServerAddon(serverId: string, addonId: string) {
		const s = getServerById(serverId)
		if (!s || !Array.isArray(s.addons)) return
		const addon = s.addons.find((a) => a.id === addonId || a.project?.id === addonId)
		if (addon) {
			addon.enabled = !addon.enabled
			saveToStorage()
		}
	}

	function isAddonInstalled(serverId: string, projectId: string): boolean {
		const s = getServerById(serverId)
		if (!s || !Array.isArray(s.addons)) return false
		return s.addons.some((a) => a.project?.id === projectId || a.id === projectId)
	}

	function updateServerLaunchSettings(
		serverId: string,
		settings: Partial<ServerLaunchSettings>,
	) {
		const s = getServerById(serverId)
		if (!s) return
		s.launchSettings = {
			...(s.launchSettings || {}),
			...settings,
		}
		saveToStorage()
	}

	return {
		servers: allServers,
		addServer,
		removeServer,
		getServerById,
		updateServer,
		updateServerStatus,
		getServerAddons,
		addServerAddon,
		removeServerAddon,
		toggleServerAddon,
		isAddonInstalled,
		updateServerLaunchSettings,
	}
}
