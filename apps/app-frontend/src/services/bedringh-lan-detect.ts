import { invoke } from '@tauri-apps/api/core'
import { get_instance_worlds, get_recent_worlds } from '@/helpers/worlds'
import { get_live_log_buffer, get_output_by_filename, get_latest_log_cursor } from '@/helpers/logs'
import { get as getInstance } from '@/helpers/instance'
import { probeLocalPortOpen } from './bedringh-tunnel'

export interface DetectedLanGame {
	id?: string
	found: boolean
	port: string
	worldName: string
	edition: 'java' | 'bedrock'
	version: string
	instanceName?: string
	source: 'logs' | 'recent_world' | 'process_without_port' | 'default'
}

interface ProcessItem {
	uuid: string
	instance_id: string
	instance_path: string
	instance_name: string
	start_time: string
}

/**
 * Извлекает порт открытой для сети игры из логов Minecraft.
 * Сканирует строки с конца к началу, чтобы взять самый последний открытый порт.
 * Если после открытия порта в логах есть "Stopping server" (игрок вышел из мира в меню) — возвращает null.
 */
function extractLanPort(logText: string): string | null {
	if (!logText) return null

	const lines = logText.split(/\r?\n/)
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]?.trim()
		if (!line) continue

		// 0. Если игрок уже вышел из мира в главное меню ("Stopping server"), более старые порты игнорируем
		if (
			/\bStopping server\b/i.test(line) ||
			/\bStopping singleplayer server\b/i.test(line) ||
			/Остановка сервера/i.test(line)
		) {
			return null
		}

		// 1. Started serving on 63990 (Fabric / Modern Vanilla 1.21+)
		let m = line.match(/Started serving on\s+(\d{3,5})/i)
		if (m && m[1]) return m[1]

		// 2. Local game hosted on port [63990] или Local game hosted on port 63990
		m = line.match(/Local game hosted on port\s*\[?(\d{3,5})\]?/i)
		if (m && m[1]) return m[1]

		// 3. Started local game on 54321 (Vanilla Java)
		m = line.match(/Started local game on\s+(\d{3,5})/i)
		if (m && m[1]) return m[1]

		// 4. Opened LAN server on port 54321
		m = line.match(/Opened LAN server on port\s*\[?(\d{3,5})\]?/i)
		if (m && m[1]) return m[1]

		// 5. Hosted world on port 54321
		m = line.match(/Hosted world on port\s*\[?(\d{3,5})\]?/i)
		if (m && m[1]) return m[1]

		// 6. Русская локализация Minecraft:
		// "Порт локального сервера: [55231]" / "Локальный мир открыт для сети на порту [63990]" / "Игра открыта для сети на порту 63990"
		m = line.match(/Порт локального сервера:\s*\[?(\d{3,5})\]?/i)
		if (m && m[1]) return m[1]

		m = line.match(/(?:локальный мир|игра|сервер|мир).*(?:открыт[а]?|запущен[а]?|размещен[а]?).*порту?\s*\[?(\d{3,5})\]?/i)
		if (m && m[1]) return m[1]

		// 7. Listening on port 54321
		m = line.match(/Listening on port\s*\[?(\d{3,5})\]?/i)
		if (m && m[1]) return m[1]

		// 8. Started on 54321
		m = line.match(/Started on\s+(\d{3,5})/i)
		if (m && m[1]) return m[1]

		// 9. Bedrock Edition: IPv4 port: 19132 или Server opened on port 19132
		m = line.match(/(?:IPv4 port|Server opened on port|RakNet server listening on .*?):?\s*(\d{3,5})/i)
		if (m && m[1]) return m[1]

		// 10. Общий шаблон для строки чата с портом: port [63990]
		m = line.match(/\bport\s*\[(\d{3,5})\]/i)
		if (m && m[1]) return m[1]
	}

	return null
}

/**
 * Извлекает имя загруженного мира из логов Minecraft.
 */
function extractWorldName(logText: string): string | null {
	if (!logText) return null

	const lines = logText.split(/\r?\n/)
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]?.trim()
		if (!line) continue

		// 1. Modern Minecraft 1.21+: Saving chunks for level 'ServerLevel[New World]'/minecraft:overworld
		let m = line.match(/level 'ServerLevel\[([^\]]+)\]'/i)
		if (m && m[1]) return m[1].trim()

		// 2. Saving chunks for level 'ServerLevel[...]'
		m = line.match(/Saving chunks for level '[^']*?\[([^\]]+)\]'/i)
		if (m && m[1]) return m[1].trim()

		// 3. Preparing level "New World"
		m = line.match(/Preparing level "([^"]+)"/i)
		if (m && m[1]) return m[1].trim()

		// 4. Loading level "New World"
		m = line.match(/Loading level "([^"]+)"/i)
		if (m && m[1]) return m[1].trim()

		// 5. Loaded world "New World"
		m = line.match(/Loaded world "([^"]+)"/i)
		if (m && m[1]) return m[1].trim()

		// 6. Preparing level 'New World'
		m = line.match(/Preparing (?:start region for )?level '([^']+)'/i)
		if (m && m[1]) return m[1].trim()
	}

	return null
}

/**
 * Получает логи активного инстанса из нескольких источников:
 * 1. Живой ring-buffer в оперативной памяти Tauri (актуален в реальном времени).
 * 2. Файл latest.log через plugin:logs|logs_get_output_by_filename.
 * 3. Fallback: get_latest_log_cursor.
 */
async function fetchInstanceLogs(instanceId: string): Promise<string> {
	let combined = ''

	// 1. Живой лог-буфер из памяти Rust
	try {
		const liveBuffer = await get_live_log_buffer(instanceId)
		if (typeof liveBuffer === 'string') {
			combined += liveBuffer + '\n'
		} else if (liveBuffer && typeof (liveBuffer as any).output === 'string') {
			combined += (liveBuffer as any).output + '\n'
		}
	} catch (e) {
		console.debug('[LAN Detect] live buffer:', e)
	}

	// 2. latest.log через правильный LogType: 'InfoLog'
	try {
		const fileOutput = await get_output_by_filename(instanceId, 'InfoLog', 'latest.log')
		if (typeof fileOutput === 'string') {
			combined += fileOutput + '\n'
		} else if (fileOutput && typeof (fileOutput as any).output === 'string') {
			combined += (fileOutput as any).output + '\n'
		}
	} catch (e) {
		console.debug('[LAN Detect] latest.log:', e)
	}

	// 3. get_latest_log_cursor если пусто
	if (!combined.trim()) {
		try {
			const cursorData = await get_latest_log_cursor(instanceId, 0)
			if (cursorData && typeof cursorData.output === 'string') {
				combined += cursorData.output
			}
		} catch (e) {
			console.debug('[LAN Detect] cursor log:', e)
		}
	}

	return combined
}

/**
 * Обнаруживает ВСЕ запущенные сборки/миры Minecraft (например, если запущено 2-4 локальных мира сразу).
 * Для каждого проверяет реальную открытость TCP-порта на 127.0.0.1, чтобы вышедшие в меню миры не висели.
 */
export async function detectAllActiveLanGames(): Promise<DetectedLanGame[]> {
	const results: DetectedLanGame[] = []
	const seenPorts = new Set<string>()

	try {
		const runningProcesses = await invoke<ProcessItem[]>('plugin:process|process_get_all').catch(() => [])

		if (runningProcesses && runningProcesses.length > 0) {
			// Обходим с конца к началу (от самых свежих к более ранним)
			for (let idx = runningProcesses.length - 1; idx >= 0; idx--) {
				const activeProc = runningProcesses[idx]
				if (!activeProc) continue
				const instanceId = activeProc.instance_id

				const instance = await getInstance(instanceId).catch(() => null)
				const edition: 'java' | 'bedrock' =
					instance?.path?.toLowerCase().includes('bedrock') || instance?.loader?.toLowerCase().includes('bedrock')
						? 'bedrock'
						: 'java'
				const version = instance?.game_version || '1.21.11'
				const instanceName = instance?.name || activeProc.instance_name

				let detectedPort: string | null = null
				let detectedWorldName: string | null = null

				const logText = await fetchInstanceLogs(instanceId)
				if (logText) {
					detectedPort = extractLanPort(logText)
					detectedWorldName = extractWorldName(logText)
				}

				// Проверяем, что порт реально слушается прямо сейчас (игрок не вышел из мира)
				if (detectedPort && edition === 'java') {
					const isAlive = await probeLocalPortOpen(detectedPort)
					if (!isAlive) {
						detectedPort = null
					}
				}

				if (!detectedWorldName) {
					try {
						const worlds = await get_instance_worlds(instanceId).catch(() => [])
						if (worlds && worlds.length > 0) {
							const singleplayerWorlds = worlds.filter((w) => (w as any).type === 'singleplayer' || !w.type)
							const targetList = singleplayerWorlds.length > 0 ? singleplayerWorlds : worlds
							const sorted = [...targetList].sort((a, b) => {
								const timeA = a.last_played ? new Date(a.last_played).getTime() : 0
								const timeB = b.last_played ? new Date(b.last_played).getTime() : 0
								return timeB - timeA
							})
							if (sorted[0]?.name) {
								detectedWorldName = sorted[0].name
							}
						}
					} catch {
						// ignore
					}
				}

				if (detectedPort) {
					if (!seenPorts.has(detectedPort)) {
						seenPorts.add(detectedPort)
						results.push({
							id: `${activeProc.uuid || instanceId}:${detectedPort}`,
							found: true,
							port: detectedPort,
							worldName: detectedWorldName || instanceName || 'Локальный мир',
							edition,
							version,
							instanceName,
							source: 'logs',
						})
					}
				} else {
					results.push({
						id: `${activeProc.uuid || instanceId}:noport`,
						found: false,
						port: '',
						worldName: detectedWorldName || instanceName || '',
						edition,
						version,
						instanceName,
						source: 'process_without_port',
					})
				}
			}
		}
	} catch (e) {
		console.warn('[Bedringh LAN Detect] Ошибка сканирования всех процессов:', e)
	}

	return results
}

/**
 * Автоматическое обнаружение открытого для сети мира Minecraft (возвращает основной/первый открытый мир).
 */
export async function detectActiveLanGame(): Promise<DetectedLanGame> {
	try {
		const all = await detectAllActiveLanGames()

		// Сначала ищем реально открытый для сети мир (found: true)
		const openGame = all.find((g) => g.found && g.port)
		if (openGame) return openGame

		// Иначе берем запущенную сборку без открытого порта
		const runningProc = all[0]
		if (runningProc) return runningProc

		// Если активных процессов сборок нет, ищем недавно запущенные миры
		const recentWorlds = await get_recent_worlds(1).catch(() => [])
		if (recentWorlds && recentWorlds.length > 0 && recentWorlds[0]?.world?.name) {
			const w = recentWorlds[0].world
			return {
				found: false,
				port: '',
				worldName: w.name,
				edition: 'java',
				version: '1.21.11',
				source: 'recent_world',
			}
		}
	} catch (e) {
		console.warn('[Bedringh LAN Detect] Ошибка автоопределения:', e)
	}

	return {
		found: false,
		port: '',
		worldName: '',
		edition: 'java',
		version: '1.21.11',
		source: 'default',
	}
}

