import { invoke } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { copyFile, mkdir, readDir, readTextFile, stat, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
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
): Promise<{ url: string; fallbackUrls?: string[]; resolvedVersion: string }> {
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
		let loaderVersion = coreVersion && coreVersion !== 'latest' && coreVersion !== 'stable' ? coreVersion : ''
		if (!loaderVersion) {
			try {
				const res = await tauriFetch(
					`https://meta.fabricmc.net/v2/versions/loader/${gameVersion}`,
				)
				if (res.ok) {
					const data = await res.json()
					if (Array.isArray(data) && data.length > 0) {
						loaderVersion = data[0].loader?.version || '0.16.10'
					}
				}
			} catch (e) {
				console.warn('Failed to fetch Fabric loader metadata:', e)
			}
		}
		if (!loaderVersion) {
			loaderVersion = '0.16.10'
		}

		let installerVersion = '1.0.1'
		try {
			const instRes = await tauriFetch('https://meta.fabricmc.net/v2/versions/installer')
			if (instRes.ok) {
				const instData = await instRes.json()
				if (Array.isArray(instData) && instData.length > 0) {
					installerVersion = instData[0].version || '1.0.1'
				}
			}
		} catch {
			// fallback to 1.0.1
		}

		return {
			url: `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}/${loaderVersion}/${installerVersion}/server/jar`,
			resolvedVersion: `${loaderVersion} (${installerVersion})`,
		}
	}

	if (normalizedCore === 'quilt') {
		let loaderVersion = '0.26.4'
		try {
			const res = await tauriFetch(`https://meta.quiltmc.org/v3/versions/loader/${gameVersion}`)
			if (res.ok) {
				const data = await res.json()
				if (Array.isArray(data) && data.length > 0) {
					loaderVersion = data[0].loader?.version || '0.26.4'
				}
			}
		} catch {}

		return {
			url: `https://meta.quiltmc.org/v3/versions/loader/${gameVersion}/${loaderVersion}/0.1.2/server/jar`,
			resolvedVersion: loaderVersion,
		}
	}

	if (normalizedCore === 'mohist') {
		try {
			const res = await tauriFetch(
				`https://mohistmc.com/api/v2/projects/mohist/${gameVersion}/builds`,
			)
			if (res.ok) {
				const data = await res.json()
				const builds = data.builds || []
				if (builds.length > 0) {
					const latest = builds[builds.length - 1]
					const dlUrl = latest.url || latest.originUrl
					if (dlUrl) {
						return {
							url: dlUrl,
							resolvedVersion:
								latest.forgeVersion ||
								latest.neoForgeVersion ||
								(latest.id ? latest.id.slice(0, 8) : 'latest'),
						}
					}
				}
			}
		} catch (e) {
			console.warn('Failed to fetch from Mohist API:', e)
		}

		return {
			url: `https://mohistmc.com/api/v2/projects/mohist/${gameVersion}/builds/latest/download`,
			resolvedVersion: 'latest',
		}
	}

	if (normalizedCore === 'forge') {
		let forgeVersion = coreVersion && coreVersion !== 'latest' && coreVersion !== 'stable' ? coreVersion : ''
		if (!forgeVersion) {
			try {
				const promoRes = await tauriFetch(
					'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
				)
				if (promoRes.ok) {
					const promoData = await promoRes.json()
					const promos = promoData.promos || {}
					forgeVersion =
						promos[`${gameVersion}-recommended`] ||
						promos[`${gameVersion}-latest`] ||
						''
				}
			} catch (e) {
				console.warn('Failed to fetch Forge promotions:', e)
			}
		}

		// Known fallbacks
		if (!forgeVersion) {
			const fallbacks: Record<string, string> = {
				'1.21.1': '52.1.0',
				'1.21': '51.0.33',
				'1.20.1': '47.4.10',
				'1.20.2': '48.1.0',
				'1.20.4': '49.2.0',
				'1.19.4': '45.4.0',
				'1.19.2': '43.5.0',
				'1.18.2': '40.3.0',
				'1.16.5': '36.2.34',
				'1.12.2': '14.23.5.2859',
				'1.7.10': '10.13.4.1614',
			}
			forgeVersion = fallbacks[gameVersion] || 'latest'
		}

		const isOldUniversal = gameVersion.startsWith('1.12') || gameVersion.startsWith('1.7')
		const artifactType = isOldUniversal ? 'universal' : 'installer'
		const fullVersion = forgeVersion.startsWith(gameVersion)
			? forgeVersion
			: `${gameVersion}-${forgeVersion}`
		const primaryUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-${artifactType}.jar`
		const fallbackUrls = [
			`https://maven.creeperhost.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-${artifactType}.jar`,
			`https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-${artifactType}.jar`,
		]

		return {
			url: primaryUrl,
			fallbackUrls,
			resolvedVersion: forgeVersion,
		}
	}

	if (normalizedCore === 'neoforge') {
		let neoVersion = coreVersion && coreVersion !== 'latest' && coreVersion !== 'stable' ? coreVersion : ''
		if (neoVersion) {
			neoVersion = neoVersion.replace(/^neoforge[-/]/i, '').trim()
		}
		if (!neoVersion) {
			try {
				const res = await tauriFetch(
					'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge',
				)
				if (res.ok) {
					const data = await res.json()
					const versions: string[] = data.versions || []
					// Filter versions matching mc (e.g., for 1.20.4 prefix is 20.4, for 1.21.1 is 21.1)
					const parts = gameVersion.split('.')
					if (parts.length >= 2) {
						const prefix = `${parts[1]}.${parts[2] || '0'}`
						const matched = versions.filter(
							(v) => v === prefix || v.startsWith(`${prefix}.`) || v.startsWith(`${prefix}-`),
						)
						if (matched.length > 0) {
							neoVersion = matched[matched.length - 1]
						}
					}
				}
			} catch (e) {
				console.warn('Failed to fetch NeoForge versions:', e)
			}
		}

		if (!neoVersion) {
			const fallbacks: Record<string, string> = {
				'1.20.4': '20.4.237',
				'1.20.6': '20.6.119',
				'1.21': '21.0.167',
				'1.21.1': '21.1.72',
				'1.21.3': '21.3.56',
				'1.21.4': '21.4.67-beta',
			}
			neoVersion = fallbacks[gameVersion] || '21.1.72'
		}

		const primaryUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoVersion}/neoforge-${neoVersion}-installer.jar`
		const fallbackUrls = [
			`https://bmclapi2.bangbang93.com/maven/net/neoforged/neoforge/${neoVersion}/neoforge-${neoVersion}-installer.jar`,
		]

		return {
			url: primaryUrl,
			fallbackUrls,
			resolvedVersion: neoVersion,
		}
	}

	if (normalizedCore === 'vanilla') {
		let manifest: any = null
		try {
			const manifestRes = await tauriFetch(
				'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
				{ signal: AbortSignal.timeout(8000) },
			)
			if (manifestRes.ok) manifest = await manifestRes.json()
		} catch (e) {
			console.warn('Failed to fetch from piston-meta, trying BMCLAPI mirror:', e)
		}

		if (!manifest) {
			const mirrorRes = await tauriFetch(
				'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json',
				{ signal: AbortSignal.timeout(10000) },
			)
			if (!mirrorRes.ok) {
				throw new Error('Не удалось загрузить манифест версий Minecraft (Mojang & BMCLAPI недоступны)')
			}
			manifest = await mirrorRes.json()
		}

		const versionEntry = manifest.versions?.find((v: any) => v.id === gameVersion)
		if (!versionEntry?.url) {
			throw new Error(`Minecraft Vanilla ${gameVersion} не найден в манифесте версий`)
		}

		let versionDetails: any = null
		try {
			const versionDetailsRes = await tauriFetch(versionEntry.url, { signal: AbortSignal.timeout(8000) })
			if (versionDetailsRes.ok) versionDetails = await versionDetailsRes.json()
		} catch (e) {
			console.warn('Failed to fetch version details from Mojang, trying BMCLAPI mirror:', e)
		}

		if (!versionDetails) {
			const mirrorDetailsUrl = versionEntry.url
				.replace('piston-meta.mojang.com', 'bmclapi2.bangbang93.com')
				.replace('launchermeta.mojang.com', 'bmclapi2.bangbang93.com')
			const mirrorDetailsRes = await tauriFetch(mirrorDetailsUrl, { signal: AbortSignal.timeout(10000) })
			if (!mirrorDetailsRes.ok) {
				throw new Error(`Не удалось получить данные о версии Minecraft Vanilla ${gameVersion}`)
			}
			versionDetails = await mirrorDetailsRes.json()
		}

		const serverUrl = versionDetails.downloads?.server?.url
		if (!serverUrl) {
			throw new Error(`Для Minecraft Vanilla ${gameVersion} нет серверного jar`)
		}

		const fallbackUrls = [
			serverUrl
				.replace('piston-data.mojang.com', 'bmclapi2.bangbang93.com')
				.replace('launcher.mojang.com', 'bmclapi2.bangbang93.com'),
		]

		return {
			url: serverUrl,
			fallbackUrls,
			resolvedVersion: gameVersion,
		}
	}

	if (normalizedCore === 'spigot') {
		return {
			url: `https://download.getbukkit.org/spigot/spigot-${gameVersion}.jar`,
			resolvedVersion: gameVersion,
		}
	}

	throw new Error(`Неподдерживаемое ядро сервера: ${core}`)
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
	const { url: primaryUrl, fallbackUrls = [], resolvedVersion } = await resolveServerCoreDownload(
		core,
		gameVersion,
		coreVersion,
	)
	const candidateUrls = [primaryUrl, ...fallbackUrls]

	let jarDownloaded = false
	let jarErrorReason = ''

	// Check for existing local cached core in sibling servers (ATLauncher architecture)
	try {
		const serversBase = await join(serverDir, '..')
		const entries = await readDir(serversBase)
		for (const entry of entries) {
			if (entry.isDirectory && entry.name !== serverId) {
				const sibDir = await join(serversBase, entry.name)
				const sibMetaPath = await join(sibDir, 'server.json')
				const sibJarPath = await join(sibDir, 'server.jar')
				try {
					const metaTxt = await readTextFile(sibMetaPath)
					const meta = JSON.parse(metaTxt)
					if (meta.core === core && meta.gameVersion === gameVersion) {
						const jarStat = await stat(sibJarPath)
						if (jarStat.size > 1024 * 1024) {
							onProgress?.(
								`Найдено ядро в локальном кэше (${(jarStat.size / (1024 * 1024)).toFixed(1)} МБ)! Мгновенное копирование...`,
								80,
							)
							const targetJarPath = await join(serverDir, 'server.jar')
							await copyFile(sibJarPath, targetJarPath)
							jarDownloaded = true
							break
						}
					}
				} catch {
					// continue
				}
			}
		}
	} catch (e) {
		console.warn('Local cache check failed, falling back to download:', e)
	}

	for (let i = 0; !jarDownloaded && i < candidateUrls.length; i++) {
		const downloadUrl = candidateUrls[i]
		try {
			const label =
				i === 0
					? `Подключение к серверу загрузки ${core}...`
					: `Подключение к зеркалу ${i}/${candidateUrls.length - 1} (${core})...`
			onProgress?.(label, 30)

			const response = await tauriFetch(downloadUrl, {
				headers: {
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
					Accept: '*/*',
				},
				signal: AbortSignal.timeout(60000),
			})
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
			break
		} catch (err) {
			jarErrorReason = err instanceof Error ? err.message : String(err)
			console.warn(`Download attempt failed for ${downloadUrl}:`, err)
		}
	}

	if (!jarDownloaded) {
		// Fallback to native Rust downloader via reqwest (which bypasses browser/WebKit TLS restrictions)
		onProgress?.(`Загрузка ядра через нативный клиент (${core})...`, 40)
		try {
			await invoke<string>('plugin:local-server|local_server_download_core', {
				serverPath: serverDir,
				candidateUrls,
			})
			jarDownloaded = true
		} catch (rustErr) {
			console.warn('Native download also failed:', rustErr)
			jarErrorReason = rustErr instanceof Error ? rustErr.message : String(rustErr)
		}
	}

	if (!jarDownloaded) {
		const urlsList = candidateUrls
			.map((u, idx) => `${idx === 0 ? 'Основная ссылка' : `Зеркало ${idx}`}:\n${u}`)
			.join('\n\n')
		const infoPath = await join(serverDir, 'server.jar.download_info.txt')
		await writeTextFile(
			infoPath,
			`Ядро: ${core}\nВерсия: ${gameVersion} (сборка ${resolvedVersion})\n\nСсылки для скачивания:\n${urlsList}\n\nОшибка автозагрузки: ${jarErrorReason}\n\nПоместите скачанный файл как server.jar в эту папку.`,
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
