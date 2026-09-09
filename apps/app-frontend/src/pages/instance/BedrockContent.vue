<template>
	<ReadyTransition :pending="loading">
		<ContentPageLayout />
	</ReadyTransition>
</template>

<script setup lang="ts">
import { ClipboardCopyIcon, FolderOpenIcon } from '@modrinth/assets'
import {
	commonMessages,
	ContentCardLayout as ContentPageLayout,
	type ContentCardTableItem,
	type ContentItem,
	defineMessages,
	injectNotificationManager,
	type OverflowMenuOption,
	provideContentManager,
	ReadyTransition,
	useVIntl,
} from '@modrinth/ui'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import {
	autoResolveAddonMetadata,
	loadBedrockMetadataMap,
	metadataVersion,
} from '@/composables/use-bedrock-metadata'
import { get_full_path } from '@/helpers/instance'
import type { GameInstance } from '@/helpers/types'
import { highlightInFolder } from '@/helpers/utils.js'
import { injectInstancePage } from './instance-context'

const props = defineProps<{
	instance?: GameInstance
}>()

const instancePage = injectInstancePage()
const instance = computed(() => props.instance || instancePage?.instance.value)

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
	curseforge_mod_id?: number | null
}

const loading = ref(true)
const rawAddons = ref<BedrockAddon[]>([])

async function fetchAddons(showSpinner = true) {
	if (!instance.value?.path) return
	try {
		if (showSpinner) loading.value = true
		const list = await invoke<BedrockAddon[]>('plugin:bedrock-addons|check_bedrock_addon_updates', {
			profilePath: instance.value.path,
		}).catch(() => invoke<BedrockAddon[]>('plugin:bedrock-addons|list_bedrock_addons', {
			profilePath: instance.value!.path,
		}))
		rawAddons.value = list || []
		autoResolveAddonMetadata(instance.value.path, rawAddons.value)
	} catch (e) {
		console.error('Failed to list bedrock addons:', e)
		handleError(e as Error)
	} finally {
		if (showSpinner) loading.value = false
	}
}

watch(
	() => instance.value?.path,
	(newPath) => {
		if (newPath) fetchAddons(true)
	},
	{ immediate: true },
)

onMounted(() => {
	fetchAddons(true)
})

const contentItems = computed<ContentItem[]>(() => {
	// Access metadataVersion to ensure reactivity when background metadata resolution completes
	const _v = metadataVersion.value
	const metaMap = instance.value?.path ? loadBedrockMetadataMap(instance.value.path) : {}

	return rawAddons.value.map((addon) => {
		const cleanTitle = addon.name.replace(/§[0-9a-fk-or]/gi, '').trim()
		const cleanKey = cleanTitle.toLowerCase()
		const meta = metaMap[cleanKey] || metaMap[addon.folder_name.toLowerCase()]
		const authorName = meta?.author || undefined
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
			owner: authorName
				? {
						id: authorName,
						name: authorName,
						avatar_url: avatarUrl,
						type: 'user',
					}
				: undefined,
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
		if (rawAddon) {
			rawAddon.is_enabled = targetState
		}
		await invoke('plugin:bedrock-addons|set_bedrock_addon_enabled', {
			profilePath: props.instance.path,
			kind,
			folderName: item.file_name,
			enable: targetState,
		})
		await fetchAddons(false)
	} catch (e) {
		handleError(e as Error)
	}
}

async function deleteAddon(item: ContentItem) {
	if (!props.instance?.path) return
	try {
		const rawAddon = rawAddons.value.find((a) => a.folder_name === item.file_name)
		const kind = rawAddon?.kind || 'behavior'
		rawAddons.value = rawAddons.value.filter((a) => a.folder_name !== item.file_name)
		await invoke('plugin:bedrock-addons|delete_bedrock_addon', {
			profilePath: props.instance.path,
			kind,
			folderName: item.file_name,
		})
		await fetchAddons(false)
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
				profilePath: instance.value?.path,
				archivePath: path,
			})
			count++
		} catch (e) {
			handleError(e as Error)
		}
	}
	await fetchAddons(false)
	if (count > 0) {
		addNotification({
			type: 'success',
			title: formatMessage(messages.successfullyInstalled),
			text: formatMessage(messages.addonWasInstalled, { count }),
		})
	}
}

function handleBrowseContent() {
	if (!instance.value) return
	router.push({
		path: '/browse/bedrock/addon',
		query: { i: instance.value.id || instance.value.path },
	})
}

function kindToDir(kind: string | undefined): string {
	switch (kind) {
		case 'resource':
			return 'resource_packs'
		case 'skin':
			return 'skin_packs'
		default:
			return 'behavior_packs'
	}
}

async function showAddonInFolder(item: ContentItem) {
	if (!instance.value?.path) return
	try {
		const rawAddon = rawAddons.value.find((a) => a.folder_name === item.file_name)
		const kindDir = kindToDir(rawAddon?.kind)
		const instanceFullPath = await get_full_path(instance.value.path)
		const sep = instanceFullPath.includes('\\') ? '\\' : '/'
		const addonPath = [instanceFullPath, 'com.mojang', kindDir, item.file_name].join(sep)
		await highlightInFolder(addonPath)
	} catch (e) {
		handleError(e as Error)
	}
}

function getOverflowOptions(item: ContentItem): OverflowMenuOption[] {
	const options: OverflowMenuOption[] = []

	options.push({
		id: formatMessage(commonMessages.showFileButton),
		icon: FolderOpenIcon,
		action: () => showAddonInFolder(item),
	})

	const metaMap = instance.value?.path ? loadBedrockMetadataMap(instance.value.path) : {}
	const cleanKey = (item.project?.title || item.file_name).replace(/§[0-9a-fk-or]/gi, '').trim().toLowerCase()
	const meta = metaMap[cleanKey] || metaMap[item.file_name.toLowerCase()]
	const projectUrl = meta?.projectUrl

	if (projectUrl) {
		options.push({
			id: formatMessage(commonMessages.copyLinkButton),
			icon: ClipboardCopyIcon,
			action: async () => {
				await navigator.clipboard.writeText(projectUrl)
			},
		})
	}

	return options
}

async function updateBedrockAddon(item: ContentItem) {
	if (!instance.value?.path) return
	const rawAddon = rawAddons.value.find((a) => a.folder_name === item.file_name)
	const projectId = rawAddon?.curseforge_mod_id ? String(rawAddon.curseforge_mod_id) : (item.project?.id || item.id)
	try {
		await invoke('plugin:bedrock-addons|update_bedrock_addon', {
			profilePath: instance.value.path,
			projectId,
			targetFileId: null,
		})
		addNotification({
			type: 'success',
			title: 'Обновление завершено',
			text: `${item.project?.title || item.file_name} успешно обновлен`,
		})
		await fetchAddons(false)
	} catch (e) {
		handleError(e as Error)
	}
}

async function bulkUpdateAllBedrock() {
	if (!instance.value?.path) return
	const updatables = contentItems.value.filter((i) => i.has_update)
	for (const item of updatables) {
		await updateBedrockAddon(item)
	}
}

provideContentManager({
	items: contentItems,
	loading,
	error: ref(null),
	managedContent: ref(null),
	isPackLocked: ref(false),
	isBusy: ref(false),
	isBulkOperating: ref(false),
	contentTypeLabel: computed(() => 'Bedrock Add-ons'),
	toggleEnabled: toggleAddon,
	deleteItem: deleteAddon,
	refresh: () => fetchAddons(true),
	browse: handleBrowseContent,
	uploadFiles: installFromFile,
	hasUpdateSupport: true,
	updateItem: async (id: string) => {
		const item = contentItems.value.find((i) => i.id === id)
		if (item) await updateBedrockAddon(item)
	},
	bulkUpdateItem: updateBedrockAddon,
	bulkUpdateAll: bulkUpdateAllBedrock,
	getOverflowOptions,
	mapToTableItem: (item: ContentItem): ContentCardTableItem => {
		const targetId = item.project?.id || item.id
		const metaMap = instance.value?.path ? loadBedrockMetadataMap(instance.value.path) : {}
		const cleanKey = (item.project?.title || item.file_name).replace(/§[0-9a-fk-or]/gi, '').trim().toLowerCase()
		const meta = metaMap[cleanKey] || metaMap[item.file_name.toLowerCase()]
		const memberLink = meta?.projectUrl || (item.owner?.name ? `https://www.curseforge.com/members/${encodeURIComponent(item.owner.name)}` : undefined)

		return {
			id: item.id,
			project: item.project ?? { id: item.id, slug: item.id, title: item.file_name, icon_url: undefined },
			projectLink: {
				path: `/project/${encodeURIComponent(targetId)}`,
				query: { i: instance.value?.path },
			},
			version: item.version,
			enabled: item.enabled,
			hasUpdate: item.has_update,
			owner: item.owner
				? {
						...item.owner,
						link: memberLink,
					}
				: undefined,
		}
	},
})
</script>
