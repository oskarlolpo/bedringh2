import type { ContentItem, ManagedContentProject, ManagedContentVersion } from '@modrinth/ui'

import {
	get_content_items,
	get_linked_modpack_info,
	type LinkedModpackInfo,
	scan_instance_local_mods,
} from '@/helpers/instance'
import type { CacheBehaviour } from '@/helpers/types'

export type InstanceContentData = {
	path: string
	contentItems: ContentItem[] | null
	modpack: InstanceContentModpackData | null
}

export type InstanceContentModpackData = {
	project: ManagedContentProject
	version: ManagedContentVersion | null
	updateVersionId: string | null
}

export async function loadInstanceContentData(
	path: string,
	cacheBehaviour?: CacheBehaviour,
	onError?: (error: Error) => unknown,
): Promise<InstanceContentData> {
	const [contentItems, modpackInfo, scannedMods] = await Promise.all([
		get_content_items(path, cacheBehaviour).catch((error) => handleLoadError(error, onError)),
		get_linked_modpack_info(path, cacheBehaviour).catch((error) => handleLoadError(error, onError)),
		scan_instance_local_mods(path).catch(() => []),
	])

	const items = (contentItems as ContentItem[] | null | undefined) ?? null
	if (items && Array.isArray(scannedMods) && scannedMods.length > 0) {
		for (const item of items) {
			const scanned = scannedMods.find((s) => s.file_name === item.file_name)
			if (scanned) {
				if (!item.project) {
					item.project = {
						id: scanned.mod_id ?? item.file_name,
						slug: scanned.mod_id ?? item.file_name,
						title: scanned.name,
						icon_url: scanned.icon_data_url ?? undefined,
						description: scanned.description ?? undefined,
					}
				} else if (!item.project.icon_url && scanned.icon_data_url) {
					item.project.icon_url = scanned.icon_data_url
				}
				if (!item.version) {
					item.version = {
						id: scanned.file_name,
						version_number: scanned.version ?? '',
						file_name: scanned.file_name,
					}
				}
			}
		}
	}

	return {
		path,
		contentItems: items,
		modpack: normalizeLinkedModpackInfo(modpackInfo as LinkedModpackInfo | null | undefined),
	}
}

function handleLoadError(error: unknown, onError?: (error: Error) => unknown) {
	if (!onError) throw error
	onError(error as Error)
	return null
}

function normalizeLinkedModpackInfo(
	modpackInfo: LinkedModpackInfo | null | undefined,
): InstanceContentModpackData | null {
	if (!modpackInfo) return null

	return {
		project: {
			...modpackInfo.project,
			slug: modpackInfo.project.slug ?? modpackInfo.project.id,
			icon_url: modpackInfo.project.icon_url ?? undefined,
		},
		version: modpackInfo.version
			? {
					...modpackInfo.version,
					date_published: modpackInfo.version.date_published.toString(),
				}
			: null,
		updateVersionId: modpackInfo.update_version_id,
	}
}
