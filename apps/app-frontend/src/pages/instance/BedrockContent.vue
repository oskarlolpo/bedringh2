<template>
	<ReadyTransition :pending="loading">
		<ContentPageLayout />
	</ReadyTransition>
</template>

<script setup lang="ts">
import {
	ContentCardLayout as ContentPageLayout,
	type ContentCardTableItem,
	type ContentItem,
	defineMessages,
	injectNotificationManager,
	provideContentManager,
	ReadyTransition,
	useVIntl,
} from '@modrinth/ui'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import type { GameInstance } from '@/helpers/types'

import {
	loadBedrockMetadataMap,
	autoResolveAddonMetadata,
	metadataVersion,
} from '@/composables/use-bedrock-metadata'

const props = defineProps<{
	instance: GameInstance
}>()

const { formatMessage } = useVIntl()
const { handleError, addNotification } = injectNotificationManager()
const router = useRouter()

const messages = defineMessages({
	contentTypeAddon: {
		id: 'app.bedrock.content-type-addon',
		defaultMessage: 'Bedrock Add-on',
	},
	successfullyInstalled: {
		id: 'app.bedrock.successfully-installed',
		defaultMessage: 'Successfully installed',
	},
	addonWasInstalled: {
		id: 'app.bedrock.addon-was-installed',
		defaultMessage: 'Installed {count} pack(s)',
	},
})

interface BedrockAddon {
	uuid: string
	name: string
	description: string
	version: string
	folder_name: string
	kind: string // 'behavior', 'resource', 'skin'
	is_enabled: boolean
	icon_path?: string
	has_update?: boolean
	latest_version?: string
}

const loading = ref(true)
const rawAddons = ref<BedrockAddon[]>([])

async function fetchAddons() {
	if (!props.instance?.path) return
	try {
		loading.value = true
		const list = await invoke<BedrockAddon[]>('plugin:bedrock-addons|list_bedrock_addons', {
			profilePath: props.instance.path,
		})
		rawAddons.value = list || []
		autoResolveAddonMetadata(props.instance.path, rawAddons.value)
	} catch (e) {
		console.error('Failed to list bedrock addons:', e)
		handleError(e as Error)
	} finally {
		loading.value = false
	}
}

watch(
	() => props.instance?.path,
	(newPath) => {
		if (newPath) fetchAddons()
	},
	{ immediate: true },
)

onMounted(() => {
	fetchAddons()
})

const contentItems = computed<ContentItem[]>(() => {
	// Access metadataVersion to ensure reactivity when background metadata resolution completes
	const _v = metadataVersion.value
	const metaMap = props.instance?.path ? loadBedrockMetadataMap(props.instance.path) : {}

	return rawAddons.value.map((addon) => {
		const cleanTitle = addon.name.replace(/§[0-9a-fk-or]/gi, '').trim()
		const cleanKey = cleanTitle.toLowerCase()
		const meta = metaMap[cleanKey] || metaMap[addon.folder_name.toLowerCase()]
		const authorName = meta?.author || 'CurseForge Creator'
		const avatarUrl = meta?.avatarUrl || meta?.iconUrl || addon.icon_path
		const projectId = meta?.projectId || addon.folder_name

		return {
			id: addon.folder_name,
			file_name: addon.folder_name,
			file_path: addon.folder_name,
			enabled: addon.is_enabled,
			has_update: addon.has_update ?? false,
			update_version_id: null,
			project_type: addon.kind === 'resource' ? 'resourcepack' : addon.kind === 'skin' ? 'skinpack' : 'mod',
			owner: {
				name: authorName,
				avatar_url: avatarUrl,
				type: 'user',
			},
			project: {
				id: projectId,
				slug: meta?.slug || addon.folder_name,
				title: cleanTitle,
				icon_url: meta?.iconUrl || addon.icon_path || undefined,
				author: authorName,
			},
			version: {
				id: addon.uuid,
				version_number: addon.version || '1.0.0',
				file_name: addon.folder_name,
			},
		}
	})
})

async function toggleAddon(item: ContentItem) {
	if (!props.instance?.path) return
	try {
		const rawAddon = rawAddons.value.find((a) => a.folder_name === item.file_name)
		const kind = rawAddon?.kind || 'behavior'
		const targetState = !item.enabled
		await invoke('plugin:bedrock-addons|set_bedrock_addon_enabled', {
			profilePath: props.instance.path,
			kind,
			folderName: item.file_name,
			enable: targetState,
		})
		await fetchAddons()
	} catch (e) {
		handleError(e as Error)
	}
}

async function deleteAddon(item: ContentItem) {
	if (!props.instance?.path) return
	try {
		const rawAddon = rawAddons.value.find((a) => a.folder_name === item.file_name)
		const kind = rawAddon?.kind || 'behavior'
		await invoke('plugin:bedrock-addons|delete_bedrock_addon', {
			profilePath: props.instance.path,
			kind,
			folderName: item.file_name,
		})
		await fetchAddons()
	} catch (e) {
		handleError(e as Error)
	}
}

async function installFromFile() {
	if (!props.instance?.path) return
	const files = await open({
		multiple: true,
		filters: [{ name: 'Bedrock Packs (*.mcpack, *.mcaddon, *.zip)', extensions: ['mcpack', 'mcaddon', 'zip'] }],
	})
	if (!files) return

	const filePaths = Array.isArray(files) ? files : [files]
	let count = 0
	for (const file of filePaths) {
		const path = (file as { path?: string }).path ?? file
		try {
			await invoke('plugin:bedrock-addons|install_bedrock_addon_from_file', {
				profilePath: props.instance.path,
				archivePath: path,
			})
			count++
		} catch (e) {
			handleError(e as Error)
		}
	}
	await fetchAddons()
	if (count > 0) {
		addNotification({
			type: 'success',
			title: formatMessage(messages.successfullyInstalled),
			text: formatMessage(messages.addonWasInstalled, { count }),
		})
	}
}

function handleBrowseContent() {
	if (!props.instance) return
	router.push({
		path: '/browse/bedrock/addon',
		query: { i: props.instance.path },
	})
}

provideContentManager({
	items: contentItems,
	loading,
	error: ref(null),
	modpack: ref(null),
	isPackLocked: ref(false),
	isBusy: ref(false),
	isBulkOperating: ref(false),
	contentTypeLabel: computed(() => 'Bedrock Add-ons'),
	toggleEnabled: toggleAddon,
	deleteItem: deleteAddon,
	refresh: fetchAddons,
	browse: handleBrowseContent,
	uploadFiles: installFromFile,
	hasUpdateSupport: false,
	mapToTableItem: (item: ContentItem): ContentCardTableItem => {
		const targetId = item.project?.id || item.id
		return {
			id: item.id,
			project: item.project ?? { id: item.id, slug: item.id, title: item.file_name, icon_url: undefined },
			projectLink: {
				path: `/project/${encodeURIComponent(targetId)}`,
				query: { i: props.instance.path },
			},
			version: item.version,
			enabled: item.enabled,
			hasUpdate: item.has_update,
			owner: item.owner
				? {
						...item.owner,
						ownerLink: `https://www.curseforge.com/members/${encodeURIComponent(item.owner.name)}`,
					}
				: undefined,
		}
	},
})
</script>
