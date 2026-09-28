import { detectActiveLanGame, detectAllActiveLanGames } from './bedringh-lan-detect'
import { formatSafeConnectAddress, getRelayApiBase } from './bedringh-network-config'
import {
	closeHostTunnel,
	getHostTunnelStatus,
	openHostTunnel,
	probeLocalPortOpen,
	setHostTunnelLocalPort,
} from './bedringh-tunnel'

export interface LobbyHostData {
	id: string
	name: string
	iconUrl?: string
	motdHtml?: string
	edition: 'java' | 'bedrock'
	version: string
	address: string
	host: string
	isMyHost?: boolean
	localPort?: number
	publicPort?: number
	tunnelConnected?: boolean
	players: number
	maxPlayers: number
	ping: number | null
	region: string
	categories?: string[]
	createdAt?: number
}

const activeHeartbeats = new Map<string, ReturnType<typeof setInterval>>()

/**
 * Получить список всех активных хостов с сервера VDS
 */
export async function fetchLobbyServers(): Promise<LobbyHostData[]> {
	const base = getRelayApiBase()
	try {
		const res = await fetch(`${base}/channels/minecraft-lobby/messages`, {
			method: 'GET',
			headers: { Accept: 'application/json' },
		})
		if (!res.ok) {
			console.warn(`[Bedringh Lobby] HTTP ${res.status} при получении списка серверов`)
			return []
		}
		const data = await res.json()
		if (!Array.isArray(data)) return []

		return data
			.map((item: any) => {
				const d = item.data || item
				if (!d || !d.name) return null
				const pubPort = typeof d.publicPort === 'number' && d.publicPort > 0 ? d.publicPort : undefined
				const locPort = typeof d.localPort === 'number' && d.localPort > 0 ? d.localPort : undefined
				const displayPort = pubPort || locPort || d.port || 25565
				return {
					id: item.clientId || item.client_id || d.id || `host-${Math.random()}`,
					name: d.name || 'Minecraft Server',
					iconUrl: d.iconUrl,
					motdHtml: d.motdHtml || d.motd,
					edition: d.edition === 'bedrock' ? 'bedrock' : 'java',
					version: d.version || '1.21.4',
					address: formatSafeConnectAddress(displayPort),
					host: d.host || d.nickname || 'Игрок',
					localPort: locPort,
					publicPort: pubPort,
					tunnelConnected: Boolean(pubPort),
					players: typeof d.players === 'number' ? d.players : (d.player_count ?? 1),
					maxPlayers: typeof d.maxPlayers === 'number' ? d.maxPlayers : (d.max_players ?? 10),
					ping: typeof d.ping === 'number' ? d.ping : 35,
					region: d.region || 'Bedringh Relay RU',
					categories: Array.isArray(d.categories) ? d.categories : [],
					createdAt: d.createdAt,
				} as LobbyHostData
			})
			.filter(Boolean) as LobbyHostData[]
	} catch (e) {
		console.warn('[Bedringh Lobby] Не удалось загрузить серверы с VDS лобби:', e)
		return []
	}
}

/**
 * Опубликовать хост в глобальном лобби на VDS
 */
export async function publishHostPresence(server: LobbyHostData): Promise<boolean> {
	const base = getRelayApiBase()
	try {
		// Синхронизируем живую статистику из нашего Rust-туннеля (активные потоки, выделенный порт, пинг)
		const tStatus = await getHostTunnelStatus(server.id)
		if (tStatus) {
			if (tStatus.publicPort > 0) {
				server.publicPort = tStatus.publicPort
				server.address = formatSafeConnectAddress(tStatus.publicPort)
			}
			server.tunnelConnected = tStatus.connected
			server.players = 1 + tStatus.activeStreams
			if (tStatus.pingMs > 0) {
				server.ping = tStatus.pingMs
			}
		}

		const payload = {
			name: 'host-presence',
			clientId: server.id,
			data: {
				id: server.id,
				name: server.name,
				iconUrl: server.iconUrl,
				motdHtml: server.motdHtml,
				edition: server.edition,
				version: server.version,
				address: server.address,
				localPort: server.localPort,
				publicPort: server.publicPort,
				host: server.host,
				players: server.players,
				maxPlayers: server.maxPlayers,
				ping: server.ping,
				region: server.region,
				categories: server.categories || [],
				createdAt: server.createdAt || Date.now(),
			},
		}

		const res = await fetch(`${base}/channels/minecraft-lobby/messages`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		})
		return res.ok || res.status === 201
	} catch (e) {
		console.warn('[Bedringh Lobby] Ошибка публикации хоста на VDS:', e)
		return false
	}
}

/**
 * Удалить хост из глобального лобби на VDS и закрыть его туннель
 */
export async function publishHostLeave(serverId: string): Promise<boolean> {
	stopHostHeartbeat(serverId)
	void closeHostTunnel(serverId)
	const base = getRelayApiBase()
	try {
		const payload = {
			name: 'host-leave',
			clientId: serverId,
		}
		const res = await fetch(`${base}/channels/minecraft-lobby/messages`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		})
		return res.ok || res.status === 201
	} catch (e) {
		console.warn('[Bedringh Lobby] Ошибка удаления хоста с VDS:', e)
		return false
	}
}

/**
 * Запустить мультиплексированный туннель (Proxima-протокол) и периодический heartbeat,
 * включая автоматическое отслеживание выхода из мира и смены локального порта LAN (`tunnel.setLocalPort`).
 */
export async function startHostHeartbeat(
	server: LobbyHostData,
	onStatusUpdate?: (updated: LobbyHostData) => void,
	onLocalWorldClosed?: (serverId: string) => void,
) {
	stopHostHeartbeat(server.id)

	const localPort =
		server.localPort ||
		parseInt(server.address.split(':')[1] || '', 10) ||
		(server.edition === 'bedrock' ? 19132 : 25565)
	server.localPort = localPort

	// 1. Открываем реальный мультиплексированный туннель к VDS
	const tunnelInfo = await openHostTunnel(
		server.id,
		localPort,
		server.edition,
		server.publicPort,
	)
	if (tunnelInfo) {
		if (tunnelInfo.publicPort > 0) {
			server.publicPort = tunnelInfo.publicPort
			server.address = formatSafeConnectAddress(tunnelInfo.publicPort)
		}
		server.tunnelConnected = tunnelInfo.connected
		if (tunnelInfo.pingMs > 0) {
			server.ping = tunnelInfo.pingMs
		}
		onStatusUpdate?.(server)
	}

	// 2. Сразу первая публикация в лобби
	await publishHostPresence(server)
	onStatusUpdate?.(server)

	let tickCount = 0
	// 3. Цикл проверки открытости локального мира (каждые 6с) и отправки heartbeat (каждые 18с)
	const interval = setInterval(async () => {
		tickCount++
		try {
			if (server.edition === 'java' && server.localPort) {
				const isPortAlive = await probeLocalPortOpen(server.localPort)
				if (!isPortAlive) {
					// Проверяем, не переоткрыл ли игрок этот же мир на новом порту
					const allLan = await detectAllActiveLanGames()
					const matchingWorld =
						allLan.find((g) => g.found && g.port && g.worldName === server.name) ||
						(allLan.filter((g) => g.found && g.port).length === 1
							? allLan.find((g) => g.found && g.port)
							: undefined)

					if (matchingWorld && matchingWorld.port) {
						const newPort = parseInt(matchingWorld.port, 10)
						if (newPort > 0 && newPort !== server.localPort) {
							server.localPort = newPort
							await setHostTunnelLocalPort(server.id, newPort)
						}
					} else {
						// Игрок вышел из мира или закрыл игру — закрываем туннель и удаляем карточку хоста!
						await publishHostLeave(server.id)
						onLocalWorldClosed?.(server.id)
						return
					}
				}
			} else {
				const lan = await detectActiveLanGame()
				if (lan.found && lan.port) {
					const detectedPort = parseInt(lan.port, 10)
					if (detectedPort > 0 && detectedPort !== server.localPort) {
						server.localPort = detectedPort
						await setHostTunnelLocalPort(server.id, detectedPort)
					}
				}
			}
		} catch {
			// ignore
		}

		if (tickCount % 3 === 0) {
			await publishHostPresence(server)
			onStatusUpdate?.(server)
		}
	}, 6000)

	activeHeartbeats.set(server.id, interval)
}

/**
 * Остановить heartbeat хоста и закрыть туннель
 */
export function stopHostHeartbeat(serverId: string) {
	const timer = activeHeartbeats.get(serverId)
	if (timer) {
		clearInterval(timer)
		activeHeartbeats.delete(serverId)
	}
	void closeHostTunnel(serverId)
}

/**
 * Подписаться на живые события лобби через SSE (Server-Sent Events)
 */
export function subscribeLobbySSE(onUpdate: () => void): () => void {
	const base = getRelayApiBase()
	let es: EventSource | null = null

	try {
		es = new EventSource(`${base}/sse?channels=minecraft-lobby`)
		es.onmessage = (_e) => {
			onUpdate()
		}
		es.onerror = () => {
			// Клиент автоматически попытается восстановить соединение
		}
	} catch (e) {
		console.warn('[Bedringh Lobby] SSE не поддерживается или ошибка подключения:', e)
	}

	return () => {
		if (es) {
			es.close()
		}
	}
}
