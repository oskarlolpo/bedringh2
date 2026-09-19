import { appDataDir, join } from '@tauri-apps/api/path'
import { mkdir, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

export interface DownloadServerOptions {
	serverId: string
	serverName: string
	core: string // 'paper' | 'purpur' | 'folia' | 'fabric' | 'vanilla' | 'spigot'
	gameVersion: string
	coreVersion?: string | null
	port?: number
	onProgress?: (stage: string, progress?: number, receivedMb?: string, totalMb?: string) => void
}

export interface ServerMeta {
	id: string
	name: string
	core: string
	gameVersion: string
	coreVersion: string
	path: string
	jarFile: string
	port: number
	createdAt: string
}

export async function getServerDirectory(serverId: string): Promise<string> {
	const base = await appDataDir()
	const dir = await join(base, 'servers', serverId)
	await mkdir(dir, { recursive: true })
	return dir
}

export async function getServersRootDirectory(): Promise<string> {
	const base = await appDataDir()
	const dir = await join(base, 'servers')
	await mkdir(dir, { recursive: true })
	return dir
}

/**
 * Resolves the direct download URL for the chosen Minecraft server core.
 */
export async function resolveServerCoreDownload(
	core: string,
	gameVersion: string,
	coreVersion?: string | null,
): Promise<{ url: string; resolvedVersion: string }> {
	const normalizedCore = core.toLowerCase().trim()

	if (normalizedCore === 'paper') {
		// Try Paper v3 API on fill.papermc.io first (current official API)
		try {
			const v3Res = await tauriFetch(
				`https://fill.papermc.io/v3/projects/paper/versions/${gameVersion}/builds`,
			)
			if (v3Res.ok) {
				const builds = await v3Res.json()
				if (Array.isArray(builds) && builds.length > 0) {
					let selectedBuild = builds[0]
					if (coreVersion && coreVersion !== 'latest' && coreVersion !== 'stable') {
						const match = builds.find((b: any) => String(b.id) === String(coreVersion))
						if (match) selectedBuild = match
					} else if (coreVersion === 'stable') {
						const stableMatch = builds.find(
							(b: any) => b.channel === 'STABLE' || b.channel === 'default',
						)
						if (stableMatch) selectedBuild = stableMatch
					}
					const dlUrl = selectedBuild.downloads?.['server:default']?.url
					if (dlUrl) {
						return {
							url: dlUrl,
							resolvedVersion: `${selectedBuild.id}`,
						}
					}
				}
			}
		} catch (e) {
			console.warn('Failed to fetch from fill.papermc.io v3:', e)
		}

		// Fallback to Paper v2 API
		if (coreVersion && coreVersion !== 'latest' && coreVersion !== 'stable') {
			return {
				url: `https://api.papermc.io/v2/projects/paper/versions/${gameVersion}/builds/${coreVersion}/downloads/paper-${gameVersion}-${coreVersion}.jar`,
				resolvedVersion: coreVersion,
			}
		}
		const res = await tauriFetch(
			`https://api.papermc.io/v2/projects/paper/versions/${gameVersion}/builds`,
		)
		if (res.ok) {
			const data = await res.json()
			const builds = data.builds || []
			if (builds.length > 0) {
				const latest = builds[builds.length - 1]
				const buildNum = latest.build
				return {
					url: `https://api.papermc.io/v2/projects/paper/versions/${gameVersion}/builds/${buildNum}/downloads/paper-${gameVersion}-${buildNum}.jar`,
					resolvedVersion: `${buildNum}`,
				}
			}
		}
		throw new Error(
			`Не удалось найти ядро Paper для Minecraft ${gameVersion}. Пожалуйста, выберите официальный релиз (например, 1.21.4 или 1.21.1).`,
		)
	}

	if (normalizedCore === 'purpur') {
		if (coreVersion && coreVersion !== 'latest' && coreVersion !== 'stable') {
			return {
				url: `https://api.purpurmc.org/v2/purpur/${gameVersion}/${coreVersion}/download`,
				resolvedVersion: coreVersion,
			}
		}
		return {
			url: `https://api.purpurmc.org/v2/purpur/${gameVersion}/latest/download`,
			resolvedVersion: 'latest',
		}
	}

	if (normalizedCore === 'folia') {
		try {
			const v3Res = await tauriFetch(
				`https://fill.papermc.io/v3/projects/folia/versions/${gameVersion}/builds`,
			)
			if (v3Res.ok) {
				const builds = await v3Res.json()
				if (Array.isArray(builds) && builds.length > 0) {
					let selectedBuild = builds[0]
					if (coreVersion && coreVersion !== 'latest' && coreVersion !== 'stable') {
						const match = builds.find((b: any) => String(b.id) === String(coreVersion))
						if (match) selectedBuild = match
					}
					const dlUrl = selectedBuild.downloads?.['server:default']?.url
					if (dlUrl) {
						return {
							url: dlUrl,
							resolvedVersion: `${selectedBuild.id}`,
						}
					}
				}
			}
		} catch (e) {
			console.warn('Failed to fetch from fill.papermc.io folia:', e)
		}

		if (coreVersion && coreVersion !== 'latest' && coreVersion !== 'stable') {
			return {
				url: `https://api.papermc.io/v2/projects/folia/versions/${gameVersion}/builds/${coreVersion}/downloads/folia-${gameVersion}-${coreVersion}.jar`,
				resolvedVersion: coreVersion,
			}
		}
		const res = await tauriFetch(
			`https://api.papermc.io/v2/projects/folia/versions/${gameVersion}/builds`,
		)
		if (res.ok) {
			const data = await res.json()
			const builds = data.builds || []
			if (builds.length > 0) {
				const latest = builds[builds.length - 1]
				const buildNum = latest.build
				return {
					url: `https://api.papermc.io/v2/projects/folia/versions/${gameVersion}/builds/${buildNum}/downloads/folia-${gameVersion}-${buildNum}.jar`,
					resolvedVersion: `${buildNum}`,
				}
			}
		}
		throw new Error(`Не удалось найти ядро Folia для Minecraft ${gameVersion}`)
	}

	if (normalizedCore === 'fabric') {
		if (coreVersion && coreVersion !== 'latest' && coreVersion !== 'stable') {
			return {
				url: `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}/${coreVersion}/server/jar`,
				resolvedVersion: coreVersion,
			}
		}
		// Resolve latest fabric loader version for this gameVersion
		const res = await tauriFetch(
			`https://meta.fabricmc.net/v2/versions/loader/${gameVersion}`,
		)
		if (!res.ok) {
			throw new Error(`Failed to fetch Fabric loader for ${gameVersion}: ${res.statusText}`)
		}
		const data = await res.json()
		if (!Array.isArray(data) || data.length === 0) {
			throw new Error(`No Fabric loader versions found for Minecraft ${gameVersion}`)
		}
		const loaderVersion = data[0].loader?.version || 'latest'
		return {
			url: `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}/${loaderVersion}/server/jar`,
			resolvedVersion: loaderVersion,
		}
	}

	if (normalizedCore === 'vanilla') {
		const manifestRes = await tauriFetch(
			'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
		)
		if (!manifestRes.ok) {
			throw new Error('Failed to fetch Mojang version manifest')
		}
		const manifest = await manifestRes.json()
		const versionEntry = manifest.versions?.find((v: any) => v.id === gameVersion)
		if (!versionEntry?.url) {
			throw new Error(`Minecraft Vanilla ${gameVersion} not found in Mojang manifest`)
		}
		const versionDetailsRes = await tauriFetch(versionEntry.url)
		if (!versionDetailsRes.ok) {
			throw new Error(`Failed to fetch details for Minecraft Vanilla ${gameVersion}`)
		}
		const versionDetails = await versionDetailsRes.json()
		const serverUrl = versionDetails.downloads?.server?.url
		if (!serverUrl) {
			throw new Error(`No server jar download available for Minecraft Vanilla ${gameVersion}`)
		}
		return {
			url: serverUrl,
			resolvedVersion: gameVersion,
		}
	}

	if (normalizedCore === 'spigot') {
		return {
			url: `https://download.getbukkit.org/spigot/spigot-${gameVersion}.jar`,
			resolvedVersion: gameVersion,
		}
	}

	throw new Error(`Unsupported server core: ${core}`)
}

/**
 * Downloads the server core jar and sets up the server files structure on disk.
 */
export async function downloadServerCore(opts: DownloadServerOptions): Promise<ServerMeta> {
	const { serverId, serverName, core, gameVersion, coreVersion, port = 25565, onProgress } = opts

	onProgress?.('Подготовка папки сервера...', 10)
	const serverDir = await getServerDirectory(serverId)

	// Create subdirectories
	const subdirs = ['plugins', 'mods', 'logs', 'config', 'world']
	for (const sub of subdirs) {
		const subPath = await join(serverDir, sub)
		await mkdir(subPath, { recursive: true })
	}

	onProgress?.(`Получение ссылки на ядро ${core} (${gameVersion})...`, 25)
	const { url: downloadUrl, resolvedVersion } = await resolveServerCoreDownload(
		core,
		gameVersion,
		coreVersion,
	)

	let jarDownloaded = false
	let jarErrorReason = ''

	try {
		onProgress?.(`Подключение к серверу загрузки ${core}...`, 30)
		const response = await tauriFetch(downloadUrl)
		if (!response.ok) {
			throw new Error(`Статус ${response.status}: ${response.statusText}`)
		}

		const contentLength = response.headers.get('content-length')
		const totalBytes = contentLength ? parseInt(contentLength, 10) : 0
		const totalMb = totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(1) : ''
		let jarBytes: Uint8Array

		if (response.body && typeof response.body.getReader === 'function') {
			const reader = response.body.getReader()
			const chunks: Uint8Array[] = []
			let receivedBytes = 0

			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				if (value) {
					chunks.push(value)
					receivedBytes += value.length
					const receivedMb = (receivedBytes / (1024 * 1024)).toFixed(1)
					if (totalBytes > 0) {
						const percent = Math.min(95, Math.round(30 + (receivedBytes / totalBytes) * 60))
						onProgress?.(
							`Скачивание ${core}.jar (${receivedMb} / ${totalMb} МБ)...`,
							percent,
							receivedMb,
							totalMb,
						)
					} else {
						onProgress?.(`Скачивание ${core}.jar (${receivedMb} МБ)...`, 60, receivedMb, '')
					}
				}
			}

			jarBytes = new Uint8Array(receivedBytes)
			let offset = 0
			for (const chunk of chunks) {
				jarBytes.set(chunk, offset)
				offset += chunk.length
			}
		} else {
			onProgress?.(`Скачивание ${core}.jar...`, 50)
			const arrayBuffer = await response.arrayBuffer()
			jarBytes = new Uint8Array(arrayBuffer)
			const recMb = (jarBytes.length / (1024 * 1024)).toFixed(1)
			onProgress?.(`Скачивание ${core}.jar (${recMb} МБ)...`, 90, recMb, recMb)
		}

		onProgress?.('Сохранение server.jar на диск...', 95)
		const jarPath = await join(serverDir, 'server.jar')
		await writeFile(jarPath, jarBytes)
		jarDownloaded = true
	} catch (err) {
		jarErrorReason = err instanceof Error ? err.message : String(err)
		console.warn('Failed to download server jar automatically:', downloadUrl, err)
		const infoPath = await join(serverDir, 'server.jar.download_info.txt')
		await writeTextFile(
			infoPath,
			`Ядро: ${core}\nВерсия: ${gameVersion} (сборка ${resolvedVersion})\nПрямая ссылка для скачивания:\n${downloadUrl}\n\nОшибка автозагрузки: ${jarErrorReason}\n\nПоместите скачанный файл как server.jar в эту папку.`,
		)
	}

	onProgress?.('Инициализация конфигурации сервера...', 90)
	// Write eula.txt
	const eulaPath = await join(serverDir, 'eula.txt')
	const eulaContent = `#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\n#${new Date().toISOString()}\neula=true\n`
	await writeTextFile(eulaPath, eulaContent)

	// Write server.properties
	const propsPath = await join(serverDir, 'server.properties')
	const propsContent = `#Minecraft server properties\n#${new Date().toISOString()}\nmotd=A Minecraft Server (${serverName})\nserver-port=${port}\nonline-mode=false\nenable-command-block=true\ndifficulty=easy\ngamemode=survival\nmax-players=20\nspawn-protection=0\nview-distance=10\nsync-chunk-writes=true\npvp=true\n`
	await writeTextFile(propsPath, propsContent)

	const meta: ServerMeta = {
		id: serverId,
		name: serverName,
		core,
		gameVersion,
		coreVersion: resolvedVersion,
		path: serverDir,
		jarFile: 'server.jar',
		port,
		createdAt: new Date().toISOString(),
	}

	// Write server.json metadata in folder
	const metaPath = await join(serverDir, 'server.json')
	await writeTextFile(metaPath, JSON.stringify(meta, null, 2))

	if (!jarDownloaded) {
		throw new Error(
			`Структура сервера создана, но автозагрузка .jar заблокирована сетью (${jarErrorReason}). Ссылка сохранена в server.jar.download_info.txt. Перезапустите приложение или положите server.jar вручную.`,
		)
	}

	onProgress?.('Сервер готов!', 100)
	return meta
}
