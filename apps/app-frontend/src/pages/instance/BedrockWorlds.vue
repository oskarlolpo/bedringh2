<template>
	<ReadyTransition :pending="loading">
        <div class="flex flex-col gap-4">
            <div class="flex justify-between items-center bg-surface-1 p-4 rounded-xl border border-surface-2">
                <div>
                    <h2 class="text-xl font-bold">Bedrock Worlds</h2>
                    <p class="text-sm text-contrast">Manage your Minecraft Bedrock worlds, import new ones, or export existing ones for sharing.</p>
                </div>
                <div>
                    <ButtonStyled color="brand" @click="importFromFile">
                        Import World (.mcworld)
                    </ButtonStyled>
                </div>
            </div>

            <EmptyState
                v-if="worlds.length === 0"
                icon="globe"
                title="No Bedrock Worlds found"
                description="Import a world to get started."
            >
                <ButtonStyled color="brand" @click="importFromFile">
                    Import World (.mcworld)
                </ButtonStyled>
            </EmptyState>

            <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                <div 
                    v-for="world in worlds" 
                    :key="world.folderName" 
                    class="bg-surface-1 rounded-xl overflow-hidden border border-surface-2 flex flex-col shadow-md transition-shadow hover:shadow-lg"
                >
                    <div class="h-32 bg-surface-2 w-full relative">
                        <img v-if="world.iconPath" :src="'file://' + world.iconPath" class="w-full h-full object-cover">
                        <div v-else class="w-full h-full flex items-center justify-center text-contrast">
                            No Icon
                        </div>
                        <div class="absolute bottom-0 right-0 bg-black/60 text-white px-2 py-1 text-xs font-mono backdrop-blur-sm">
                            {{ formatSize(world.sizeBytes) }}
                        </div>
                    </div>
                    
                    <div class="p-4 flex flex-col gap-1 flex-1">
                        <div class="font-bold text-lg truncate" :title="world.name">
                            {{ world.name }}
                        </div>
                        <div class="text-xs text-contrast">
                            Last Played: {{ formatDate(world.lastPlayed) }}
                        </div>
                        <div class="text-xs font-mono text-contrast mt-1 text-[10px] break-all">
                            {{ world.folderName }}
                        </div>
                        
                        <div class="mt-auto pt-4 flex gap-2 justify-end isolate">
                            <ButtonStyled size="small" color="surface" @click="exportWorld(world)">
                                Export
                            </ButtonStyled>
                            <ButtonStyled size="small" color="red" type="transparent" @click="deleteWorld(world)" title="Delete World">
                                <TrashIcon />
                            </ButtonStyled>
                        </div>
                    </div>
                </div>
            </div>
        </div>
	</ReadyTransition>
</template>

<script setup lang="ts">
import { TrashIcon } from '@modrinth/assets'
import { ButtonStyled, EmptyState, ReadyTransition, injectNotificationManager } from '@modrinth/ui'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { ref, onMounted } from 'vue'

import type { GameInstance } from '@/helpers/types'

const props = defineProps<{
	instance: GameInstance
}>()

interface BedrockWorld {
    folderName: string;
    name: string;
    sizeBytes: number;
    lastPlayed: number;
    iconPath: string | null;
}

const loading = ref(true)
const worlds = ref<BedrockWorld[]>([])
const notifications = injectNotificationManager()

function formatSize(bytes: number) {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / 1048576).toFixed(1) + ' MB';
}

function formatDate(timestamp: number) {
    if (timestamp === 0) return 'Never'
    return new Date(timestamp * 1000).toLocaleString()
}

async function fetchWorlds() {
    loading.value = true
    try {
        worlds.value = await invoke('plugin:bedrock-worlds|fetch_bedrock_worlds', {
            profilePath: props.instance.path
        })
    } catch (e) {
        notifications.handleError(e as Error)
    } finally {
        loading.value = false
    }
}

async function deleteWorld(world: BedrockWorld) {
    if (!confirm(`Are you sure you want to delete ${world.name}?`)) return
    
    try {
        await invoke('plugin:bedrock-worlds|delete_bedrock_world', {
            profilePath: props.instance.path,
            folderName: world.folderName
        })
        await fetchWorlds()
    } catch (e) {
        notifications.handleError(e as Error)
    }
}

async function exportWorld(world: BedrockWorld) {
    const outPath = await save({
        filters: [{
            name: 'Bedrock World',
            extensions: ['mcworld']
        }],
        defaultPath: `${world.name}.mcworld`
    })

    if (outPath) {
        loading.value = true
        try {
            await invoke('plugin:bedrock-worlds|export_bedrock_world', {
                profilePath: props.instance.path,
                folderName: world.folderName,
                outPath: outPath
            })
            notifications.addNotification({
                type: 'success',
                title: 'Export successful',
                text: `${world.name} has been exported to ${outPath}`
            })
        } catch (e) {
            notifications.handleError(e as Error)
        } finally {
            loading.value = false
        }
    }
}

async function importFromFile() {
    const file = await open({
        multiple: false,
        filters: [{
            name: 'Bedrock Worlds',
            extensions: ['mcworld', 'zip']
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
                await invoke('plugin:bedrock-worlds|import_bedrock_world', {
                    profilePath: props.instance.path,
                    archivePath: pathStr
                })
                notifications.addNotification({
                    type: 'success',
                    title: 'World imported successfully',
                    text: 'The Bedrock World has been imported.'
                })
                await fetchWorlds()
            } catch (e) {
                notifications.handleError(e as Error)
            } finally {
                loading.value = false
            }
        }
    }
}

onMounted(() => {
    fetchWorlds()
})
</script>
