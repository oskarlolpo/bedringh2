import { invoke } from '@tauri-apps/api/core'
import { getRelayApiBase } from './bedringh-network-config'

export interface TunnelStatusInfo {
	sessionId: string
	edition: 'java' | 'bedrock'
	localPort: number
	publicPort: number
	connected: boolean
	activeStreams: number
	bytesRx: number
	bytesTx: number
	pingMs: number
}

export interface ClientBridgeInfo {
	sessionId: string
	localPort: number
	localAddress: string
}

/**
 * Открыть мультиплексированный туннель хоста к VDS (нативный Rust-аналог ProximaMP Sidecar `tunnel.open`).
 * Выделяет реальный публичный TCP/UDP порт на VDS (30000..30500) и проксирует входящие подключения
 * на локальный порт игры (127.0.0.1:localPort).
 */
export async function openHostTunnel(
	sessionId: string,
	localPort: number | string,
	edition: 'java' | 'bedrock' = 'java',
	preferredPort?: number,
): Promise<TunnelStatusInfo | null> {
	const parsedPort = typeof localPort === 'string' ? parseInt(localPort, 10) : localPort
	if (!parsedPort || isNaN(parsedPort)) return null

	try {
		return await invoke<TunnelStatusInfo>('plugin:tunnel|tunnel_open', {
			sessionId,
			localPort: parsedPort,
			edition,
			relayUrl: getRelayApiBase(),
			preferredPort: preferredPort || undefined,
		})
	} catch (e) {
		console.warn('[Bedringh Tunnel] Ошибка открытия туннеля хоста:', e)
		return null
	}
}

/**
 * Закрыть туннель хоста и освободить публичный порт на VDS (`tunnel.close`).
 */
export async function closeHostTunnel(sessionId: string): Promise<boolean> {
	try {
		return await invoke<boolean>('plugin:tunnel|tunnel_close', { sessionId })
	} catch (e) {
		console.warn('[Bedringh Tunnel] Ошибка закрытия туннеля:', e)
		return false
	}
}

/**
 * Горячая смена локального порта без разрыва публичного адреса (`tunnel.setLocalPort`).
 */
export async function setHostTunnelLocalPort(
	sessionId: string,
	localPort: number | string,
): Promise<boolean> {
	const parsedPort = typeof localPort === 'string' ? parseInt(localPort, 10) : localPort
	if (!parsedPort || isNaN(parsedPort)) return false

	try {
		return await invoke<boolean>('plugin:tunnel|tunnel_set_local_port', {
			sessionId,
			localPort: parsedPort,
		})
	} catch (e) {
		console.warn('[Bedringh Tunnel] Ошибка смены локального порта туннеля:', e)
		return false
	}
}

/**
 * Получить живой статус туннеля хоста (выделенный публичный порт, число подключённых игроков, трафик, пинг).
 */
export async function getHostTunnelStatus(sessionId: string): Promise<TunnelStatusInfo | null> {
	try {
		return await invoke<TunnelStatusInfo | null>('plugin:tunnel|tunnel_status', { sessionId })
	} catch {
		return null
	}
}

/**
 * Получить список всех активных туннелей хоста в лаунчере.
 */
export async function listHostTunnels(): Promise<TunnelStatusInfo[]> {
	try {
		return await invoke<TunnelStatusInfo[]>('plugin:tunnel|tunnel_list')
	} catch {
		return []
	}
}

/**
 * Замерить реальный пинг (RTT в мс) до VDS-релея (`tunnel.probeCandidates`).
 */
export async function probeRelayPing(): Promise<number | null> {
	try {
		return await invoke<number | null>('plugin:tunnel|tunnel_probe_ping', {
			relayUrl: getRelayApiBase(),
		})
	} catch {
		return null
	}
}

/**
 * Поднять локальный TCP-мост (127.0.0.1:<port>) на ПК игрока для прямого подключения к хосту через VDS
 * в 1 клик без раскрытия IP VDS.
 */
export async function connectClientBridge(
	sessionId: string,
	preferredLocalPort?: number,
): Promise<ClientBridgeInfo | null> {
	try {
		return await invoke<ClientBridgeInfo>('plugin:tunnel|tunnel_connect_client', {
			sessionId,
			relayUrl: getRelayApiBase(),
			preferredLocalPort: preferredLocalPort || undefined,
		})
	} catch (e) {
		console.warn('[Bedringh Tunnel] Ошибка запуска клиентского моста:', e)
		return null
	}
}

/**
 * Проверить, открыт ли локальный TCP-порт на 127.0.0.1:<port> (например, открыт ли мир в Minecraft).
 */
export async function probeLocalPortOpen(port: number | string): Promise<boolean> {
	const parsedPort = typeof port === 'string' ? parseInt(port, 10) : port
	if (!parsedPort || isNaN(parsedPort) || parsedPort <= 0) return false

	try {
		const res = await invoke<number | null>('plugin:tunnel|tunnel_probe_ping', {
			relayUrl: `http://127.0.0.1:${parsedPort}`,
		})
		return res !== null && res >= 0
	} catch {
		return false
	}
}

/**
 * Остановить локальный TCP-мост клиента.
 */
export async function disconnectClientBridge(sessionId: string): Promise<boolean> {
	try {
		return await invoke<boolean>('plugin:tunnel|tunnel_disconnect_client', { sessionId })
	} catch {
		return false
	}
}

