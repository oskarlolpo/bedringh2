import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { readFile as readFileBytes, writeFile as writeFileBytes } from '@tauri-apps/plugin-fs'
import {
	add_project_from_version,
	get_full_path,
	get_mod_full_path,
	install_project_with_dependencies,
	list as listInstances,
	remove_project,
	type GameInstance,
} from '@/helpers/instance'
import { loadInstanceContentData } from '@/helpers/instance-content'
import { install_create_instance } from '@/helpers/install'
import { getActiveBedringhUser, resolveActiveBedringhUser } from './bedringh-settings-sync'

const API_CANDIDATES = [
	'http://2.26.87.126:3100',
	'https://oskarlolpo.play2go.cloud',
	'http://oskarlolpo.play2go.cloud:3100',
]

let activeApiBase = API_CANDIDATES[0]

async function safeFetch(url: string, init: any) {
	try {
		return await window.fetch(url, init)
	} catch (nativeErr) {
		console.warn('[Bedringh Cloud Packs] Native fetch failed, trying tauriFetch fallback:', nativeErr)
	}

	try {
		return await tauriFetch(url, init)
	} catch (tauriErr) {
		console.error('[Bedringh Cloud Packs] Tauri fetch also failed:', tauriErr)
		throw tauriErr
	}
}

async function requestApi(endpoint: string, options: { method?: string; body?: any; headers?: Record<string, string> } = {}) {
	const method = options.method || 'GET'
	const headers = {
		'Content-Type': 'application/json',
		...(options.headers || {}),
	}
	const body = options.body ? JSON.stringify(options.body) : undefined

	try {
		const res = await safeFetch(`${activeApiBase}${endpoint}`, { method, headers, body })
		if (res && res.status !== 502 && res.status !== 503) {
			return res
		}
	} catch (e) {
		console.warn(`[Bedringh Cloud Packs] Failed to connect to ${activeApiBase}${endpoint}:`, e)
	}

	for (const candidate of API_CANDIDATES) {
		if (candidate === activeApiBase) continue
		try {
			const res = await safeFetch(`${candidate}${endpoint}`, { method, headers, body })
			if (res && res.status !== 502 && res.status !== 503) {
				activeApiBase = candidate
				return res
			}
		} catch (e) {
			console.warn(`[Bedringh Cloud Packs] Candidate ${candidate} failed:`, e)
		}
	}

	throw new Error('Не удалось подключиться к серверу Bedringh')
}

export interface CloudPackProject {
	projectId?: string
	title: string
	versionId?: string
	versionNumber?: string
	fileName: string
	fileType?: string
	iconUrl?: string
	isCustom?: boolean
	sha1?: string
	downloadUrl?: string
}

export interface CloudPackManifest {
	id: string
	author: string
	name: string
	description?: string
	gameVersion: string
	loader: string
	loaderVersion?: string
	version: number
	updatedAt: string
	manifest: {
		projects: CloudPackProject[]
	}
}

export interface CloudPackMeta {
	packId: string
	version: number
	role: 'author' | 'subscriber'
	author?: string
	lastSyncAt?: number
	modsHash?: string
}

export function computePackModsHash(
	gameVersion: string,
	loader: string,
	projects: CloudPackProject[],
): string {
	const itemsKey = projects
		.map(
			(p) =>
				`${p.projectId || p.title || p.fileName}:${p.versionId || p.versionNumber || ''}:${p.fileName}`,
		)
		.sort()
		.join('|')
	return `${gameVersion}:${loader}:${itemsKey}`
}

const STORAGE_KEY_PREFIX = 'bedringh_instance_pack_'

export function getLocalInstancePackMeta(instancePath: string): CloudPackMeta | null {
	try {
		const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${instancePath}`)
		return raw ? JSON.parse(raw) : null
	} catch {
		return null
	}
}

export function saveLocalInstancePackMeta(instancePath: string, meta: CloudPackMeta): void {
	try {
		localStorage.setItem(`${STORAGE_KEY_PREFIX}${instancePath}`, JSON.stringify(meta))
	} catch {}
}

export function removeLocalInstancePackMeta(instancePath: string): void {
	try {
		localStorage.removeItem(`${STORAGE_KEY_PREFIX}${instancePath}`)
	} catch {}
}

/**
 * Проверить, есть ли у автора локальные изменения модов относительно опубликованной версии
 */
export async function checkAuthorHasChanges(instance: GameInstance): Promise<boolean> {
	const existingMeta = getLocalInstancePackMeta(instance.path)
	if (!existingMeta || existingMeta.role !== 'author') return true
	if (!existingMeta.modsHash) return true

	const content = await loadInstanceContentData(instance.id || instance.path)
	const projects: CloudPackProject[] = []
	if (content.contentItems) {
		for (const item of content.contentItems) {
			if (item.disabled) continue
			projects.push({
				projectId: item.project?.id,
				title: item.project?.title || item.file_name,
				versionId: item.version?.id,
				versionNumber: item.version?.version_number,
				fileName: item.file_name,
				fileType: item.project_type || 'mod',
				iconUrl: item.project?.icon_url,
			})
		}
	}
	const currentHash = computePackModsHash(instance.game_version, instance.loader, projects)
	return currentHash !== existingMeta.modsHash
}

export interface PackModDiffItem {
	name: string
	fileName: string
	iconUrl?: string
	status: 'added' | 'removed' | 'updated' | 'unchanged'
	oldVersion?: string
	newVersion?: string
	isCustom?: boolean
}

export interface PackDiffResult {
	added: PackModDiffItem[]
	removed: PackModDiffItem[]
	updated: PackModDiffItem[]
	unchanged: PackModDiffItem[]
	totalChanges: number
	hasChanges: boolean
	customCount: number
	allCurrentProjects: CloudPackProject[]
}

export interface CloudPackVersionItem {
	version: number
	changelog: string | null
	createdAt: string
	modsCount: number
	isCurrent: boolean
}

export interface CloudPackVersionsResponse {
	packId: string
	packName: string
	author: string
	currentVersion: number
	versions: CloudPackVersionItem[]
}

async function hashBytesSha1(bytes: Uint8Array): Promise<string> {
	const hashBuffer = await crypto.subtle.digest('SHA-1', bytes)
	const hashArray = Array.from(new Uint8Array(hashBuffer))
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = ''
	const chunkSize = 0x8000
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize)
		binary += String.fromCharCode.apply(null, chunk as unknown as number[])
	}
	return btoa(binary)
}

export async function uploadCustomFileIfNeeded(
	instanceId: string,
	project: CloudPackProject,
): Promise<void> {
	if (!project.isCustom && project.projectId && project.projectId !== project.fileName) {
		return
	}

	try {
		const modPath = await get_mod_full_path(instanceId, project.fileName)
		const bytes = await readFileBytes(modPath)
		const sha1 = await hashBytesSha1(bytes)
		const dataBase64 = bytesToBase64(bytes)

		const res = await requestApi('/api/packs/custom-file', {
			method: 'POST',
			body: {
				sha1,
				fileName: project.fileName,
				dataBase64,
			},
		})
		const data = await res.json()
		if (data?.success) {
			project.sha1 = sha1
			project.downloadUrl = data.downloadUrl
		}
	} catch (err) {
		console.warn(`[Bedringh Cloud Packs] Не удалось загрузить кастомный файл ${project.fileName}:`, err)
	}
}

async function installSingleProject(instanceId: string, p: CloudPackProject): Promise<void> {
	if (p.downloadUrl) {
		try {
			const fullUrl = p.downloadUrl.startsWith('http') ? p.downloadUrl : `${activeApiBase}${p.downloadUrl}`
			const res = await safeFetch(fullUrl, {})
			if (res && res.ok) {
				const buffer = await res.arrayBuffer()
				const instanceDir = await get_full_path(instanceId)
				const targetFilePath = `${instanceDir}/mods/${p.fileName}`
				await writeFileBytes(targetFilePath, new Uint8Array(buffer))
			}
		} catch (e) {
			console.warn(`[Bedringh Cloud Packs] Ошибка скачивания кастомного файла ${p.fileName}:`, e)
		}
	} else if (p.versionId) {
		await add_project_from_version(instanceId, p.versionId, 'modpack')
	} else if (p.projectId) {
		await install_project_with_dependencies(instanceId, {
			project_id: p.projectId,
			content_type: 'mod',
		})
	}
}

/**
 * Рассчитать разницу (diff в стиле Git) между локальным инстансом и последней версией в облаке
 */
export async function computeInstanceDiff(
	instance: GameInstance,
	existingPackId?: string,
): Promise<PackDiffResult> {
	const content = await loadInstanceContentData(instance.id || instance.path)
	const currentProjects: CloudPackProject[] = []

	if (content.contentItems) {
		for (const item of content.contentItems) {
			if (item.disabled) continue
			const isCustom = !item.project?.id || item.project.id === item.file_name
			currentProjects.push({
				projectId: item.project?.id,
				title: item.project?.title || item.file_name,
				versionId: item.version?.id,
				versionNumber: item.version?.version_number,
				fileName: item.file_name,
				fileType: item.project_type || 'mod',
				iconUrl: item.project?.icon_url,
				isCustom,
			})
		}
	}

	const added: PackModDiffItem[] = []
	const removed: PackModDiffItem[] = []
	const updated: PackModDiffItem[] = []
	const unchanged: PackModDiffItem[] = []

	if (!existingPackId) {
		for (const p of currentProjects) {
			added.push({
				name: p.title,
				fileName: p.fileName,
				iconUrl: p.iconUrl,
				status: 'added',
				newVersion: p.versionNumber || undefined,
				isCustom: p.isCustom,
			})
		}
		return {
			added,
			removed: [],
			updated: [],
			unchanged: [],
			totalChanges: added.length,
			hasChanges: added.length > 0,
			customCount: added.filter((x) => x.isCustom).length,
			allCurrentProjects: currentProjects,
		}
	}

	let remoteProjects: CloudPackProject[] = []
	try {
		const remotePack = await fetchCloudPack(existingPackId)
		remoteProjects = remotePack.manifest?.projects || []
	} catch (e) {
		console.warn('[Bedringh Cloud Packs] Не удалось загрузить манифест для диффа:', e)
	}

	const remoteMap = new Map<string, CloudPackProject>()
	for (const r of remoteProjects) {
		const key = r.projectId && r.projectId !== r.fileName ? `pid:${r.projectId}` : `fn:${r.fileName.toLowerCase()}`
		remoteMap.set(key, r)
	}

	const matchedRemoteKeys = new Set<string>()

	for (const current of currentProjects) {
		const keyByPid = current.projectId && current.projectId !== current.fileName ? `pid:${current.projectId}` : null
		const keyByFn = `fn:${current.fileName.toLowerCase()}`

		let matchedRemote: CloudPackProject | undefined
		let matchedKey: string | undefined

		if (keyByPid && remoteMap.has(keyByPid)) {
			matchedRemote = remoteMap.get(keyByPid)
			matchedKey = keyByPid
		} else if (remoteMap.has(keyByFn)) {
			matchedRemote = remoteMap.get(keyByFn)
			matchedKey = keyByFn
		}

		if (!matchedRemote) {
			added.push({
				name: current.title,
				fileName: current.fileName,
				iconUrl: current.iconUrl,
				status: 'added',
				newVersion: current.versionNumber || undefined,
				isCustom: current.isCustom,
			})
		} else {
			if (matchedKey) matchedRemoteKeys.add(matchedKey)

			const versionChanged =
				(current.versionNumber && matchedRemote.versionNumber && current.versionNumber !== matchedRemote.versionNumber) ||
				(current.versionId && matchedRemote.versionId && current.versionId !== matchedRemote.versionId) ||
				current.fileName.toLowerCase() !== matchedRemote.fileName.toLowerCase()

			if (versionChanged) {
				updated.push({
					name: current.title,
					fileName: current.fileName,
					iconUrl: current.iconUrl || matchedRemote.iconUrl,
					status: 'updated',
					oldVersion: matchedRemote.versionNumber || matchedRemote.fileName,
					newVersion: current.versionNumber || current.fileName,
					isCustom: current.isCustom,
				})
			} else {
				unchanged.push({
					name: current.title,
					fileName: current.fileName,
					iconUrl: current.iconUrl,
					status: 'unchanged',
					newVersion: current.versionNumber || undefined,
					isCustom: current.isCustom,
				})
			}
		}
	}

	for (const remote of remoteProjects) {
		const keyByPid = remote.projectId && remote.projectId !== remote.fileName ? `pid:${remote.projectId}` : null
		const keyByFn = `fn:${remote.fileName.toLowerCase()}`

		if ((keyByPid && matchedRemoteKeys.has(keyByPid)) || matchedRemoteKeys.has(keyByFn)) {
			continue
		}

		removed.push({
			name: remote.title,
			fileName: remote.fileName,
			iconUrl: remote.iconUrl,
			status: 'removed',
			oldVersion: remote.versionNumber || undefined,
			isCustom: remote.isCustom,
		})
	}

	const totalChanges = added.length + removed.length + updated.length

	return {
		added,
		removed,
		updated,
		unchanged,
		totalChanges,
		hasChanges: totalChanges > 0,
		customCount: currentProjects.filter((x) => x.isCustom).length,
		allCurrentProjects: currentProjects,
	}
}

/**
 * Опубликовать или обновить облачную сборку для инстанса
 */
export async function publishInstanceAsCloudPack(
	instance: GameInstance,
	description?: string,
	changelog?: string,
): Promise<{
	packId: string
	version: number
	shareCode: string
	shareUrl: string
	deepLink: string
	noChanges?: boolean
}> {
	let user = getActiveBedringhUser()
	if (!user || !user.username) {
		user = await resolveActiveBedringhUser()
	}
	if (!user || !user.username) {
		throw new Error('Для публикации сборки необходимо войти в Bedringh ID')
	}

	const content = await loadInstanceContentData(instance.id || instance.path)
	const projects: CloudPackProject[] = []

	if (content.contentItems) {
		for (const item of content.contentItems) {
			if (item.disabled) continue
			const isCustom = !item.project?.id || item.project.id === item.file_name
			projects.push({
				projectId: item.project?.id,
				title: item.project?.title || item.file_name,
				versionId: item.version?.id,
				versionNumber: item.version?.version_number,
				fileName: item.file_name,
				fileType: item.project_type || 'mod',
				iconUrl: item.project?.icon_url,
				isCustom,
			})
		}
	}

	const currentHash = computePackModsHash(instance.game_version, instance.loader, projects)
	const existingMeta = getLocalInstancePackMeta(instance.path)
	const packId = existingMeta?.role === 'author' ? existingMeta.packId : undefined

	// Защита от спама: если моды не изменились, не отправляем запрос на повышение версии
	if (existingMeta?.role === 'author' && existingMeta.modsHash && existingMeta.modsHash === currentHash) {
		return {
			packId: existingMeta.packId,
			version: existingMeta.version,
			shareCode: existingMeta.packId,
			shareUrl: `https://oskarlolpo.play2go.cloud/pack/${existingMeta.packId}`,
			deepLink: `bedringh://pack/${existingMeta.packId}`,
			noChanges: true,
		}
	}

	// Загружаем кастомные неизвестные моды на сервер Bedringh (дедупликация по SHA-1)
	for (const p of projects) {
		if (p.isCustom) {
			await uploadCustomFileIfNeeded(instance.id, p)
		}
	}

	const res = await requestApi('/api/packs/publish', {
		method: 'POST',
		headers: user.token ? { Authorization: `Bearer ${user.token}` } : {},
		body: {
			packId,
			username: user.username,
			authToken: user.token,
			name: instance.name,
			description: description || `Сборка от ${user.username}`,
			gameVersion: instance.game_version,
			loader: instance.loader,
			loaderVersion: instance.loader_version,
			changelog: changelog || undefined,
			manifest: {
				projects,
			},
		},
	})

	const data = await res.json()
	if (!res.ok || !data.success) {
		throw new Error(data.error || 'Ошибка публикации сборки')
	}

	// Сохраняем привязку инстанса к сборке вместе с хешем модов
	saveLocalInstancePackMeta(instance.path, {
		packId: data.packId,
		version: data.version,
		role: 'author',
		author: user.username,
		lastSyncAt: Date.now(),
		modsHash: currentHash,
	})

	return {
		packId: data.packId,
		version: data.version,
		shareCode: data.shareCode,
		shareUrl: data.shareUrl,
		deepLink: data.deepLink,
		noChanges: false,
	}
}

/**
 * Получить историю всех версий сборки (с отказоустойчивым фолбэком)
 */
export async function fetchPackVersions(packId: string): Promise<CloudPackVersionsResponse> {
	const cleanId = packId.trim().toUpperCase()
	try {
		const res = await requestApi(`/api/packs/${encodeURIComponent(cleanId)}/versions`)
		if (res && res.ok) {
			const data = await res.json()
			if (data?.success) {
				return data as CloudPackVersionsResponse
			}
		}
	} catch (e) {
		console.warn('[Bedringh Cloud Packs] /versions endpoint not available, fallback to main pack info:', e)
	}

	// Фолбэк на базовую информацию сборки, если сервер еще не перезапущен
	const basePack = await fetchCloudPack(cleanId)
	return {
		packId: basePack.id,
		packName: basePack.name,
		author: basePack.author,
		currentVersion: basePack.version,
		versions: [
			{
				version: basePack.version,
				changelog: basePack.description || 'Текущая версия сборки',
				createdAt: basePack.updatedAt,
				modsCount: basePack.manifest?.projects?.length || 0,
				isCurrent: true,
			},
		],
	}
}

/**
 * Получить манифест конкретной исторической версии сборки
 */
export async function fetchPackHistoricalVersion(
	packId: string,
	versionNumber: number,
): Promise<CloudPackManifest> {
	const cleanId = packId.trim().toUpperCase()
	try {
		const res = await requestApi(`/api/packs/${encodeURIComponent(cleanId)}/version/${versionNumber}`)
		if (res && res.ok) {
			const data = await res.json()
			if (data?.success) {
				return {
					id: data.packId,
					author: data.author,
					name: data.name,
					gameVersion: data.manifest?.gameVersion || '',
					loader: data.manifest?.loader || '',
					loaderVersion: data.manifest?.loaderVersion,
					version: data.version,
					updatedAt: data.createdAt,
					manifest: data.manifest,
				}
			}
		}
	} catch (e) {
		console.warn('[Bedringh Cloud Packs] /version/:num endpoint not available, fallback:', e)
	}

	return await fetchCloudPack(cleanId)
}

/**
 * Откатить локальный инстанс к выбранной версии
 */
export async function rollbackInstanceToVersion(
	instance: GameInstance,
	targetVersionNumber: number,
	onProgress?: (text: string, current: number, total: number) => void,
): Promise<void> {
	const meta = getLocalInstancePackMeta(instance.path)
	if (!meta || !meta.packId) {
		throw new Error('Этот инстанс не привязан к облачной сборке Bedringh')
	}

	onProgress?.(`Загрузка манифеста версии v${targetVersionNumber}...`, 0, 1)
	const targetPack = await fetchPackHistoricalVersion(meta.packId, targetVersionNumber)
	const targetProjects = targetPack.manifest?.projects || []
	const targetFileNames = new Set(targetProjects.map((p) => p.fileName.toLowerCase()))

	onProgress?.('Проверка установленных модов...', 0, 1)
	const localContent = await loadInstanceContentData(instance.id || instance.path)
	const localItems = localContent.contentItems || []

	// 1. Удаляем моды, которых не должно быть в целевой версии
	for (const local of localItems) {
		if (local.file_name && !targetFileNames.has(local.file_name.toLowerCase())) {
			onProgress?.(`Удаление мода: ${local.file_name}`, 0, 1)
			await remove_project(instance.id, local.path).catch(console.warn)
		}
	}

	// 2. Скачиваем недостающие моды
	const localFileNames = new Set(localItems.map((l) => l.file_name.toLowerCase()))
	const missing = targetProjects.filter((p) => !localFileNames.has(p.fileName.toLowerCase()))

	for (let i = 0; i < missing.length; i++) {
		const p = missing[i]
		onProgress?.(`Восстановление мода (${i + 1}/${missing.length}): ${p.title}`, i + 1, missing.length)
		await installSingleProject(instance.id, p)
	}

	// 3. Сохраняем обновленный хэш и версию
	const newHash = computePackModsHash(instance.game_version, instance.loader, targetProjects)
	saveLocalInstancePackMeta(instance.path, {
		...meta,
		version: targetPack.version,
		modsHash: newHash,
		lastSyncAt: Date.now(),
	})

	onProgress?.(`Сборка успешно откачена до v${targetVersionNumber}!`, 1, 1)
}

/**
 * Получить информацию о сборке по ID или коду (BP-XXXXXX)
 */
export async function fetchCloudPack(packId: string): Promise<CloudPackManifest> {
	const cleanId = packId.trim().toUpperCase()
	const res = await requestApi(`/api/packs/${encodeURIComponent(cleanId)}`)
	const data = await res.json()
	if (!res.ok || !data.success) {
		throw new Error(data.error || 'Сборка не найдена')
	}
	return data.pack as CloudPackManifest
}

/**
 * Проверить, есть ли обновление для инстанса
 */
export async function checkInstanceCloudPackUpdate(instancePath: string): Promise<{
	hasUpdate: boolean
	latestVersion?: number
	currentVersion?: number
	author?: string
	packName?: string
} | null> {
	const meta = getLocalInstancePackMeta(instancePath)
	if (!meta || !meta.packId) return null

	try {
		const res = await requestApi(`/api/packs/${encodeURIComponent(meta.packId)}/check-update?version=${meta.version}`)
		const data = await res.json()
		if (!res.ok || !data.success) return null

		return {
			hasUpdate: Boolean(data.hasUpdate),
			latestVersion: data.latestVersion,
			currentVersion: data.currentVersion,
			author: data.author,
			packName: data.packName,
		}
	} catch {
		return null
	}
}

/**
 * Установить сборку подписчику по манифесту
 */
export async function installCloudPackForSubscriber(
	pack: CloudPackManifest,
	onProgress?: (text: string, current: number, total: number) => void,
): Promise<string> {
	onProgress?.('Создание инстанса...', 0, pack.manifest.projects.length)

	// 1. Создаем локальный инстанс
	const createJob = await install_create_instance({
		name: pack.name,
		game_version: pack.gameVersion,
		loader: pack.loader as any,
		loader_version: pack.loaderVersion || undefined,
	})

	const createdPath = (createJob as any)?.path || (createJob as any)?.instance_path
	let resolvedInstance: GameInstance | undefined

	// Ищем созданный инстанс
	const allInstances = await listInstances()
	resolvedInstance = allInstances.find((i) => i.path === createdPath || i.name === pack.name)

	const instanceId = resolvedInstance?.id || pack.name
	const instancePath = resolvedInstance?.path || createdPath || pack.name

	// 2. Скачиваем моды
	const projects = pack.manifest.projects || []
	const total = projects.length

	for (let i = 0; i < total; i++) {
		const p = projects[i]
		onProgress?.(`Установка мода: ${p.title}`, i + 1, total)
		await installSingleProject(instanceId, p)
	}

	// 3. Сохраняем метаданные подписки
	saveLocalInstancePackMeta(instancePath, {
		packId: pack.id,
		version: pack.version,
		role: 'subscriber',
		author: pack.author,
		lastSyncAt: Date.now(),
	})

	onProgress?.('Готово!', total, total)
	return instanceId
}

/**
 * Синхронизировать (обновить) сборку у подписчика
 */
export async function syncSubscriberPackUpdate(
	instance: GameInstance,
	onProgress?: (text: string, current: number, total: number) => void,
): Promise<void> {
	const meta = getLocalInstancePackMeta(instance.path)
	if (!meta || !meta.packId) {
		throw new Error('Этот инстанс не привязан к облачной сборке Bedringh')
	}

	onProgress?.('Загрузка свежего манифеста сборки...', 0, 1)
	const remotePack = await fetchCloudPack(meta.packId)

	onProgress?.('Проверка установленных модов...', 0, 1)
	const localContent = await loadInstanceContentData(instance.id || instance.path)
	const localItems = localContent.contentItems || []

	const remoteProjects = remotePack.manifest.projects || []
	const remoteFileNames = new Set(remoteProjects.map((p) => p.fileName.toLowerCase()))

	// 1. Удаляем моды, которые автор убрал
	for (const local of localItems) {
		if (local.file_name && !remoteFileNames.has(local.file_name.toLowerCase())) {
			onProgress?.(`Удаление устаревшего мода: ${local.file_name}`, 0, 1)
			await remove_project(instance.id, local.path).catch(console.warn)
		}
	}

	// 2. Докачиваем новые моды
	const localFileNames = new Set(localItems.map((l) => l.file_name.toLowerCase()))
	const missing = remoteProjects.filter((p) => !localFileNames.has(p.fileName.toLowerCase()))

	for (let i = 0; i < missing.length; i++) {
		const p = missing[i]
		onProgress?.(`Скачивание нового мода (${i + 1}/${missing.length}): ${p.title}`, i + 1, missing.length)
		await installSingleProject(instance.id, p)
	}

	// 3. Обновляем версию
	saveLocalInstancePackMeta(instance.path, {
		...meta,
		version: remotePack.version,
		lastSyncAt: Date.now(),
	})

	onProgress?.('Сборка успешно обновлена!', 1, 1)
}
