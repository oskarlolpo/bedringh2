<template>
	<ReadyTransition :pending="loading">
		<ContentCardLayout>
			<template #empty>
				<EmptyState
					v-if="addons.length === 0"
					icon="boxes"
					title="No Add-ons installed"
					description="Add behavioral or resource packs to customize your Bedrock experience."
				>
					<ButtonStyled color="brand" @click="installFromFile">
						<template #icon><DownloadIcon /></template>
						Install Add-on (.mcpack / .mcaddon)
					</ButtonStyled>
				</EmptyState>
			</template>
			<template #default>
				<div class="flex items-center justify-between mb-4">
					<h2 class="text-xl font-bold">Bedrock Add-ons</h2>
					<div class="flex gap-2">
						<ButtonStyled color="brand" @click="installFromFile">
							<template #icon><DownloadIcon /></template>
							Install from File
						</ButtonStyled>
					</div>
				</div>
                
                <div class="mb-6 p-4 bg-surface-1 rounded-xl border border-surface-2 flex flex-col gap-4">
                    <h3 class="font-bold text-lg flex items-center gap-2"><GlobeIcon/> Discover on CurseForge</h3>
                    <div class="flex gap-2">
                        <input
                            v-model="searchQuery"
                            type="text"
                            placeholder="Search behavior and resource packs..."
                            class="flex-1 bg-surface-base px-3 py-2 rounded outline-none border border-surface-2 placeholder:text-contrast focus:border-brand"
                            @keydown.enter="searchCurseForge"
                        />
                        <ButtonStyled color="brand" @click="searchCurseForge" :disabled="isSearchingCF">
                            {{ isSearchingCF ? 'Searching...' : 'Search' }}
                        </ButtonStyled>
                    </div>
                    
                    <div v-if="cfResults.length > 0" class="flex flex-col gap-2 mt-2 max-h-[300px] overflow-y-auto">
                        <div v-for="cfMod in cfResults" :key="cfMod.id" class="flex bg-surface-base border border-surface-2 rounded-lg p-3 justify-between items-center">
                            <div class="flex items-center gap-3">
                                <img v-if="cfMod.logo?.thumbnailUrl" :src="cfMod.logo.thumbnailUrl" class="w-10 h-10 rounded shadow-sm" />
                                <div class="w-10 h-10 rounded bg-surface-2 flex-shrink-0" v-else></div>
                                <div class="flex flex-col">
                                    <span class="font-bold cursor-pointer hover:underline" @click="openCfUrl(cfMod.slug)">{{ cfMod.name }}</span>
                                    <span class="text-xs text-contrast line-clamp-1">{{ cfMod.summary }}</span>
                                </div>
                            </div>
                            <ButtonStyled size="small" color="brand" @click="installCfMod(cfMod)">
                                Install
                            </ButtonStyled>
                        </div>
                    </div>
                </div>

				<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
					<div 
						v-for="addon in addons" 
						:key="addon.uuid" 
						class="bg-surface-1 rounded-xl p-4 border border-surface-2 flex flex-col gap-2 relative shadow-md transition-shadow hover:shadow-lg"
                        :class="{'opacity-50 grayscale': !addon.is_enabled}"
					>
						<div class="flex justify-between items-start">
							<div class="font-bold text-lg max-w-[80%] truncate" :title="addon.name">
								{{ addon.name }}
							</div>
							<div class="text-xs font-mono bg-surface-2 px-2 py-1 rounded">
								{{ addon.version }}
							</div>
						</div>
						
						<p class="text-sm text-contrast line-clamp-2 h-10" :title="addon.description">
							{{ addon.description || 'No description provided.' }}
						</p>
						
						<div class="mt-auto pt-2 flex items-center justify-between border-t border-surface-2">
							<div class="flex items-baseline gap-2">
                                <span class="text-xs font-semibold uppercase tracking-wider" :class="addon.kind === 'resource' ? 'text-blue-400' : 'text-purple-400'">
                                    {{ addon.kind }}
                                </span>
                            </div>
                            
                            <div class="flex gap-2 isolate">
                                <ButtonStyled 
                                    size="small" 
                                    :color="addon.is_enabled ? 'surface' : 'brand'"
                                    @click="toggleAddon(addon)"
                                >
                                    {{ addon.is_enabled ? 'Disable' : 'Enable' }}
                                </ButtonStyled>
                                <ButtonStyled 
                                    size="small" 
                                    color="red"
                                    type="transparent"
                                    @click="deleteAddon(addon)"
                                    title="Delete Add-on"
                                >
                                    <TrashIcon />
                                </ButtonStyled>
                            </div>
						</div>
					</div>
				</div>
			</template>
		</ContentCardLayout>
	</ReadyTransition>
</template>

<script setup lang="ts">
import { DownloadIcon, TrashIcon, GlobeIcon } from '@modrinth/assets'
import { ButtonStyled, EmptyState, ReadyTransition, ContentCardLayout, injectNotificationManager } from '@modrinth/ui'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ref, onMounted } from 'vue'

import type { GameInstance } from '@/helpers/types'

const props = defineProps<{
	instance: GameInstance
}>()

interface BedrockAddon {
    uuid: string;
    name: string;
    description: string;
    version: string;
    folder_name: string;
    kind: string;
    is_enabled: boolean;
}

const loading = ref(true)
const addons = ref<BedrockAddon[]>([])
const notifications = injectNotificationManager()

const searchQuery = ref('')
const isSearchingCF = ref(false)
const cfResults = ref<any[]>([])

async function searchCurseForge() {
    if (!searchQuery.value) return
    isSearchingCF.value = true
    try {
        cfResults.value = await invoke('plugin:bedrock-addons|search_bedrock_curseforge_addons', {
            query: searchQuery.value,
            categoryId: null
        })
    } catch (e) {
        notifications.handleError(e as Error)
    } finally {
        isSearchingCF.value = false
    }
}

function openCfUrl(slug: string) {
    // Bedrock id is 78022
    openUrl(`https://www.curseforge.com/minecraft-bedrock/addons/${slug}`)
}

async function installCfMod(cfMod: any) {
    loading.value = true
    try {
        const files: any[] = await invoke('plugin:bedrock-addons|get_bedrock_curseforge_addon_files', { modId: cfMod.id })
        if (files.length === 0) throw new Error("No files found for this addon.")
        
        // Grab the latest file
        const file = files[0]
        if (!file.downloadUrl) throw new Error("No download URL provided by CurseForge API.")
        
        await invoke('plugin:bedrock-addons|download_and_install_bedrock_curseforge_addon', {
            profilePath: props.instance.path,
            downloadUrl: file.downloadUrl
        })
        
        notifications.addNotification({
            type: 'success',
            title: 'Add-on installed',
            text: `Successfully downloaded and installed ${cfMod.name}`
        })
        await fetchAddons()
    } catch (e) {
        notifications.handleError(e as Error)
    } finally {
        loading.value = false
    }
}

async function fetchAddons() {
    loading.value = true
    try {
        addons.value = await invoke('plugin:bedrock-addons|fetch_bedrock_addons', {
            profilePath: props.instance.path
        })
    } catch (e) {
        notifications.handleError(e as Error)
    } finally {
        loading.value = false
    }
}

async function toggleAddon(addon: BedrockAddon) {
    try {
        await invoke('plugin:bedrock-addons|set_bedrock_addon_enabled', {
            profilePath: props.instance.path,
            kind: addon.kind,
            folderName: addon.folder_name,
            enable: !addon.is_enabled
        })
        await fetchAddons()
    } catch (e) {
        notifications.handleError(e as Error)
    }
}

async function deleteAddon(addon: BedrockAddon) {
    try {
        await invoke('plugin:bedrock-addons|delete_bedrock_addon', {
            profilePath: props.instance.path,
            kind: addon.kind,
            folderName: addon.folder_name
        })
        await fetchAddons()
    } catch (e) {
        notifications.handleError(e as Error)
    }
}

async function installFromFile() {
    const file = await open({
        multiple: false,
        filters: [{
            name: 'Bedrock Add-ons',
            extensions: ['mcpack', 'mcaddon', 'zip']
        }]
    })
    
    if (file) {
        let pathStr = ''
        if (typeof file === 'string') {
            pathStr = file
        } else if ('path' in file) {
            pathStr = file.path
        }
        
        if (pathStr) {
            loading.value = true
            try {
                await invoke('plugin:bedrock-addons|install_bedrock_addon_from_file', {
                    profilePath: props.instance.path,
                    archivePath: pathStr
                })
                notifications.addNotification({
                    type: 'success',
                    title: 'Add-on installed successfully',
                    text: 'The Bedrock Add-on has been installed.'
                })
                await fetchAddons()
            } catch (e) {
                notifications.handleError(e as Error)
            } finally {
                loading.value = false
            }
        }
    }
}

onMounted(() => {
    fetchAddons()
})
</script>
