import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

export interface BedrockAddonMeta {
	projectId?: string
	slug?: string
	author?: string
	avatarUrl?: string
	iconUrl?: string
	projectUrl?: string
	is_curseforge?: boolean
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

export async function autoResolveAddonMetadata(
	profilePath: string,
	addons: Array<{ name: string; folder_name: string; icon_path?: string; curseforge_mod_id?: number | null }>,
) {
	if (!profilePath || !addons || addons.length === 0) return
	const map = loadBedrockMetadataMap(profilePath)
	let updated = false

	for (const addon of addons) {
		const cleanName = addon.name.replace(/§[0-9a-fk-or]/gi, '').trim()
		const cleanKey = cleanName.toLowerCase()
		if (map[cleanKey] && map[cleanKey].author && map[cleanKey].projectId) continue

		// If we know exactly which CurseForge project this came from (stored at
		// install time), fetch it directly instead of guessing from the folder
		// name - the folder name is often mangled with disambiguation suffixes
		// (e.g. "_ef21cad0") that make text search unreliable or wrong.
		if (addon.curseforge_mod_id) {
			try {
				const mod: any = await invoke('plugin:bedrock-addons|get_bedrock_curseforge_addon', {
					modId: addon.curseforge_mod_id,
				}).catch(() => null)

				if (mod) {
					let authorName = 'CurseForge Creator'
					let authorUrl = `https://www.curseforge.com/minecraft/mc-addons/${mod.slug}`
					if (mod.authors && mod.authors.length > 0) {
						authorName = mod.authors[0].name
						authorUrl = mod.authors[0].url || authorUrl
					}

					const meta: BedrockAddonMeta = {
						projectId: mod.id.toString(),
						slug: mod.slug,
						author: authorName,
						avatarUrl: mod.authors?.[0]?.avatarUrl || mod.authors?.[0]?.avatar_url || mod.logo?.thumbnailUrl || mod.logo?.url,
						iconUrl: mod.logo?.thumbnailUrl || mod.logo?.url || addon.icon_path,
						projectUrl: authorUrl,
						is_curseforge: true,
					}

					map[cleanKey] = meta
					map[mod.id.toString()] = meta
					map[mod.slug.toLowerCase()] = meta
					updated = true
					continue
				}
			} catch (e) {
				console.error(`Failed to resolve metadata by id for ${cleanName}:`, e)
			}
		}

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
					is_curseforge: true,
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
