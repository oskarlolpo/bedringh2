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
