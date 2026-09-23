import { invoke } from '@tauri-apps/api/core'

export interface LocalServerLogsResponse {
	logs: string[]
	total: number
	running: boolean
}

export interface LocalServerMetrics {
	cpu_percent: number
	ram_used_mb: number
	ram_total_mb: number
	disk_mb: number
	running: boolean
	pid: number | null
}

export interface ServerLaunchOptions {
	minRamMb?: number
	maxRamMb?: number
	jvmArgs?: string
	javaPath?: string
}

export async function startLocalServerProcess(
	serverId: string,
	serverPath: string,
	options?: ServerLaunchOptions,
): Promise<number> {
	return await invoke<number>('plugin:local-server|local_server_start', {
		serverId,
		serverPath,
		minRamMb: options?.minRamMb ?? 1024,
		maxRamMb: options?.maxRamMb ?? 4096,
		jvmArgs: options?.jvmArgs || undefined,
		javaPath: options?.javaPath || undefined,
	})
}

export async function stopLocalServerProcess(serverId: string): Promise<void> {
	return await invoke<void>('plugin:local-server|local_server_stop', { serverId })
}

export async function sendLocalServerCommand(
	serverId: string,
	command: string,
): Promise<void> {
	return await invoke<void>('plugin:local-server|local_server_send_command', {
		serverId,
		command,
	})
}

export async function getLocalServerLogs(
	serverId: string,
	sinceIndex: number,
): Promise<LocalServerLogsResponse> {
	return await invoke<LocalServerLogsResponse>('plugin:local-server|local_server_get_logs', {
		serverId,
		sinceIndex,
	})
}

export async function getLocalServerStatus(serverId: string): Promise<boolean> {
	return await invoke<boolean>('plugin:local-server|local_server_get_status', {
		serverId,
	})
}

export async function getLocalServerMetrics(
	serverId: string,
	serverPath?: string,
): Promise<LocalServerMetrics> {
	return await invoke<LocalServerMetrics>('plugin:local-server|local_server_get_metrics', {
		serverId,
		serverPath: serverPath || undefined,
	})
}

export interface LocalServerBackup {
	file_name: string
	file_path: string
	size_bytes: number
	created_at: number
}

export interface ScannedAddonFile {
	file_name: string
	relative_path: string
	addon_type: 'mod' | 'plugin' | 'datapack'
	enabled: boolean
	size_bytes: number
	sha1: string
}

export async function createLocalServerBackup(
	serverId: string,
	serverPath: string,
	backupName?: string,
): Promise<LocalServerBackup> {
	return await invoke<LocalServerBackup>('plugin:local-server|local_server_create_backup', {
		serverId,
		serverPath,
		backupName: backupName || undefined,
	})
}

export async function listLocalServerBackups(serverId: string): Promise<LocalServerBackup[]> {
	return await invoke<LocalServerBackup[]>('plugin:local-server|local_server_list_backups', {
		serverId,
	})
}

export async function restoreLocalServerBackup(
	serverId: string,
	serverPath: string,
	backupFileName: string,
): Promise<void> {
	return await invoke<void>('plugin:local-server|local_server_restore_backup', {
		serverId,
		serverPath,
		backupFileName,
	})
}

export async function deleteLocalServerBackup(
	serverId: string,
	backupFileName: string,
): Promise<void> {
	return await invoke<void>('plugin:local-server|local_server_delete_backup', {
		serverId,
		backupFileName,
	})
}

export async function generateLocalServerScripts(
	serverPath: string,
	serverName: string,
	options: {
		minRamMb?: number
		maxRamMb?: number
		jvmArgs?: string
		javaPath?: string
	},
): Promise<void> {
	return await invoke<void>('plugin:local-server|local_server_generate_scripts', {
		serverPath,
		serverName,
		minRamMb: options.minRamMb ?? 1024,
		maxRamMb: options.maxRamMb ?? 4096,
		jvmArgs: options.jvmArgs || undefined,
		javaPath: options.javaPath || undefined,
	})
}

export async function scanLocalServerAddons(serverPath: string): Promise<ScannedAddonFile[]> {
	return await invoke<ScannedAddonFile[]>('plugin:local-server|local_server_scan_addons', {
		serverPath,
	})
}

