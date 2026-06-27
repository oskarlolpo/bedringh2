import { invoke } from '@tauri-apps/api/core'

/// Gets the game versions from daedalus
// Returns a VersionManifest
export async function get_game_versions() {
	return await invoke('plugin:metadata|metadata_get_game_versions')
}

// Gets the given loader versions from daedalus
// Returns Manifest
export async function get_loader_versions(loader) {
	if (loader === 'bedrock') {
		const versions = await invoke('plugin:bedrock|fetch_bedrock_versions').catch(() => [])
		return {
			gameVersions: versions.map((v) => ({
				id: v.version,
				stable: !v.is_preview,
				loaders: [{ id: v.identifier, stable: !v.is_preview }],
			})),
		}
	}
	return await invoke('plugin:metadata|metadata_get_loader_versions', { loader })
}
