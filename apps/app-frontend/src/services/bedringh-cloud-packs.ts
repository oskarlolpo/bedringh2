import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import {
	add_project_from_version,
	install_project_with_dependencies,
	list as listInstances,
	remove_project,
	type GameInstance,
} from '@/helpers/instance'
import { loadInstanceContentData } from '@/helpers/instance-content'
import { install_create_instance } from '@/helpers/install'
import { getActiveBedringhUser } from './bedringh-settings-sync'

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
 * Опубликовать или обновить облачную сборку для инстанса
 */
export async function publishInstanceAsCloudPack(instance: GameInstance, description?: string): Promise<{
	packId: string
	version: number
	shareCode: string
	shareUrl: string
	deepLink: string
}> {
	const user = getActiveBedringhUser()
	if (!user || !user.username) {
		throw new Error('Для публикации сборки необходимо войти в Bedringh ID')
	}

	const content = await loadInstanceContentData(instance.path)
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

	const existingMeta = getLocalInstancePackMeta(instance.path)
	const packId = existingMeta?.role === 'author' ? existingMeta.packId : undefined

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
			manifest: {
				projects,
			},
		},
	})

	const data = await res.json()
	if (!res.ok || !data.success) {
		throw new Error(data.error || 'Ошибка публикации сборки')
	}

	// Сохраняем привязку инстанса к сборке
	saveLocalInstancePackMeta(instance.path, {
		packId: data.packId,
		version: data.version,
		role: 'author',
		author: user.username,
		lastSyncAt: Date.now(),
	})

	return {
		packId: data.packId,
		version: data.version,
		shareCode: data.shareCode,
		shareUrl: data.shareUrl,
		deepLink: data.deepLink,
	}
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

		try {
			if (p.versionId) {
				await add_project_from_version(instanceId, p.versionId, 'modpack')
			} else if (p.projectId) {
				await install_project_with_dependencies(instanceId, {
					project_id: p.projectId,
					content_type: 'mod',
				})
			}
		} catch (err) {
			console.warn(`[Bedringh Cloud Packs] Не удалось установить мод ${p.title}:`, err)
		}
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
	const localContent = await loadInstanceContentData(instance.path)
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
		try {
			if (p.versionId) {
				await add_project_from_version(instance.id, p.versionId, 'modpack')
			} else if (p.projectId) {
				await install_project_with_dependencies(instance.id, {
					project_id: p.projectId,
					content_type: 'mod',
				})
			}
		} catch (e) {
			console.warn(`[Bedringh Cloud Packs] Ошибка установки ${p.title}:`, e)
		}
	}

	// 3. Обновляем версию
	saveLocalInstancePackMeta(instance.path, {
		...meta,
		version: remotePack.version,
		lastSyncAt: Date.now(),
	})

	onProgress?.('Сборка успешно обновлена!', 1, 1)
}
