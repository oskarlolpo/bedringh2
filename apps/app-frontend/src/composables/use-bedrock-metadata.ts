import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

export interface BedrockAddonMeta {
	projectId?: string
	slug?: string
	author?: string
	avatarUrl?: string
	iconUrl?: string
	projectUrl?: string
}

export const metadataVersion = ref(0)

function getStorageKey(profilePath: string): string {
	let hash = 0
	for (let i = 0; i < profilePath.length; i++) {
		hash = (hash << 5) - hash + profilePath.charCodeAt(i)
		hash |= 0
	}
	return `bedrock_meta_${Math.abs(hash)}`
}

export function loadBedrockMetadataMap(profilePath: string): Record<string, BedrockAddonMeta> {
	if (!profilePath) return {}
	try {
		const raw = localStorage.getItem(getStorageKey(profilePath))
		if (raw) return JSON.parse(raw)
	} catch (e) {
		console.error('Failed to load bedrock metadata map:', e)
	}
	return {}
}

export function saveBedrockMetadata(profilePath: string, addonKey: string, meta: BedrockAddonMeta) {
	if (!profilePath || !addonKey) return
	try {
		const map = loadBedrockMetadataMap(profilePath)
		const cleanKey = addonKey.replace(/§[0-9a-fk-or]/gi, '').trim().toLowerCase()
		map[cleanKey] = { ...map[cleanKey], ...meta }
		if (meta.projectId) map[meta.projectId] = map[cleanKey]
		if (meta.slug) map[meta.slug.toLowerCase()] = map[cleanKey]
		localStorage.setItem(getStorageKey(profilePath), JSON.stringify(map))
		metadataVersion.value++
	} catch (e) {
		console.error('Failed to save bedrock metadata:', e)
	}
}

export async function autoResolveAddonMetadata(profilePath: string, addons: Array<{ name: string; folder_name: string; icon_path?: string }>) {
	if (!profilePath || !addons || addons.length === 0) return
	const map = loadBedrockMetadataMap(profilePath)
	let updated = false

	for (const addon of addons) {
		const cleanName = addon.name.replace(/§[0-9a-fk-or]/gi, '').trim()
		const cleanKey = cleanName.toLowerCase()
		if (map[cleanKey] && map[cleanKey].author && map[cleanKey].projectId) continue

		try {
			const searchRes = await invoke('plugin:bedrock-addons|search_bedrock_curseforge_addons', {
				query: cleanName,
			}).catch(() => null)

			const list = Array.isArray(searchRes) ? searchRes : (searchRes?.data || [])
			if (list.length > 0) {
				const hit = list[0]
				let authorName = 'CurseForge Creator'
				let authorUrl = `https://www.curseforge.com/minecraft/mc-addons/${hit.slug}`
				let authorAvatar = hit.authors?.[0]?.avatarUrl || hit.authors?.[0]?.avatar_url || hit.logo?.thumbnailUrl || hit.logo?.url

				if (hit.authors && hit.authors.length > 0) {
					authorName = hit.authors[0].name
					authorUrl = hit.authors[0].url || authorUrl
				}

				const meta: BedrockAddonMeta = {
					projectId: hit.id.toString(),
					slug: hit.slug,
					author: authorName,
					avatarUrl: authorAvatar,
					iconUrl: hit.logo?.thumbnailUrl || hit.logo?.url || addon.icon_path,
					projectUrl: authorUrl,
				}

				map[cleanKey] = meta
				map[hit.id.toString()] = meta
				map[hit.slug.toLowerCase()] = meta
				updated = true
			}
		} catch (e) {
			console.error(`Failed to auto-resolve metadata for ${cleanName}:`, e)
		}
	}

	if (updated) {
		try {
			localStorage.setItem(getStorageKey(profilePath), JSON.stringify(map))
			metadataVersion.value++
		} catch (e) {
			console.error('Failed to update metadata map:', e)
		}
	}
}
