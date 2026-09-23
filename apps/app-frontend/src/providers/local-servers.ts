import { ref, computed } from 'vue'
import { join } from '@tauri-apps/api/path'
import { remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { getServerDirectory } from '@/services/server-download'
import { stopLocalServerProcess, scanLocalServerAddons } from '@/services/local-server-process'

export type ServerCore =
	| 'paper'
	| 'purpur'
	| 'spigot'
	| 'folia'
	| 'fabric'
	| 'forge'
	| 'neoforge'
	| 'mohist'
	| 'quilt'
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

	async function removeServer(id: string, deleteFiles: boolean = true) {
		const s = getServerById(id)
		if (s) {
			try {
				await stopLocalServerProcess(id)
			} catch (e) {
				console.warn('Error stopping server before removal:', e)
			}

			if (deleteFiles) {
				try {
					const sDir = s.path || (await getServerDirectory(id))
					if (sDir) {
						await remove(sDir, { recursive: true })
					}
				} catch (e) {
					console.warn('Failed to delete server directory on disk:', e)
				}
			}
		}
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
		syncServerJsonToDisk(s)
	}

	async function syncServerJsonToDisk(server: LocalServer) {
		try {
			const sDir = server.path || (await getServerDirectory(server.id))
			if (sDir) {
				const metaPath = await join(sDir, 'server.json')
				const data = JSON.stringify(
					{
						id: server.id,
						name: server.name,
						core: server.core,
						gameVersion: server.gameVersion,
						coreVersion: server.coreVersion,
						port: server.port,
						motd: server.motd,
						createdAt: server.createdAt,
						launchSettings: server.launchSettings,
						addons: server.addons,
					},
					null,
					2,
				)
				await writeTextFile(metaPath, data)
			}
		} catch (e) {
			console.warn('Failed to sync server.json to disk:', e)
		}
	}

	async function syncAddonsWithDisk(serverId: string): Promise<ServerAddonItem[]> {
		const s = getServerById(serverId)
		if (!s) return []
		const sDir = s.path || (await getServerDirectory(s.id))
		if (!sDir) return []

		try {
			const scanned = await scanLocalServerAddons(sDir)
			const existingAddons = Array.isArray(s.addons) ? [...s.addons] : []
			const existingMap = new Map<string, ServerAddonItem>()
			for (const a of existingAddons) {
				existingMap.set(a.file_name, a)
			}

			const activeScannedFiles = new Set(scanned.map((f) => f.file_name))
			for (const f of scanned) {
				if (f.file_name.endsWith('.disabled')) {
					activeScannedFiles.add(f.file_name.replace(/\.disabled$/, ''))
				} else {
					activeScannedFiles.add(`${f.file_name}.disabled`)
				}
			}

			// 1. Filter out removed files
			const updatedAddons: ServerAddonItem[] = existingAddons.filter((a) =>
				activeScannedFiles.has(a.file_name),
			)

			// 2. Find new/untracked files
			const untracked = scanned.filter(
				(f) =>
					!existingMap.has(f.file_name) &&
					!existingMap.has(f.file_name.replace(/\.disabled$/, '')),
			)

			if (untracked.length > 0) {
				const hashes = untracked.map((u) => u.sha1).filter(Boolean)
				let mrVersions: Record<string, any> = {}
				if (hashes.length > 0) {
					try {
						const res = await tauriFetch('https://api.modrinth.com/v2/version_files', {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								'User-Agent': 'Bedringh-Launcher/1.0',
							},
							body: JSON.stringify({
								hashes,
								algorithm: 'sha1',
							}),
						})
						if (res.ok) {
							mrVersions = await res.json()
						}
					} catch (e) {
						console.warn('Failed to query Modrinth API for scanned addons:', e)
					}
				}

				for (const item of untracked) {
					const matchedVer = mrVersions[item.sha1]
					let title = item.file_name
						.replace(/\.(jar|zip)(\.disabled)?$/i, '')
						.replace(/[-_]/g, ' ')
					let projId = item.file_name
					let projSlug: string | null = null
					let iconUrl: string | null = null
					let authorName = 'Локальный файл'
					const categories: string[] = [item.addon_type]

					if (matchedVer && matchedVer.project_id) {
						projId = matchedVer.project_id
						title = matchedVer.name || title
					}

					const sizeMb = (item.size_bytes / (1024 * 1024)).toFixed(2)
					const newAddon: ServerAddonItem = {
						id: projId,
						file_name: item.file_name,
						project_type: item.addon_type,
						enabled: item.enabled,
						has_update: false,
						file_size_formatted: `${sizeMb} MB`,
						description_text: 'Обнаружено на диске сервера',
						project: {
							id: projId,
							slug: projSlug,
							title,
							icon_url: iconUrl,
							categories,
						},
						version: {
							id: matchedVer?.id || item.sha1.substring(0, 8),
							version_number: matchedVer?.version_number || 'local',
							file_name: item.file_name,
						},
						owner: {
							id: 'local',
							name: authorName,
							type: 'user',
						},
					}
					updatedAddons.push(newAddon)
				}
			}

			s.addons = updatedAddons
			saveToStorage()
			await syncServerJsonToDisk(s)
			return updatedAddons
		} catch (err) {
			console.error('Failed to sync addons with disk:', err)
			return s.addons || []
		}
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
		syncAddonsWithDisk,
		syncServerJsonToDisk,
	}
}

