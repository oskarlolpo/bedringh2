<script setup lang="ts">
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, ref } from 'vue'
import { injectNotificationManager, ButtonStyled, ConfirmRepairModal, Combobox } from '@modrinth/ui'
import { HammerIcon, DownloadIcon } from '@modrinth/assets'
import { invoke } from '@tauri-apps/api/core'
import { LoaderIcon } from 'lucide-vue-next'

import { injectInstanceSettings } from '@/providers/instance-settings'
import { edit, install } from '@/helpers/profile'

const { instance } = injectInstanceSettings()
const { handleError, addNotification } = injectNotificationManager()
const queryClient = useQueryClient()

const selectedVersion = ref(instance.value.game_version)
const repairing = ref(false)
const integrityRepairing = ref(false)
const repairModal = ref<InstanceType<typeof ConfirmRepairModal>>()

const bedrockVersionsQuery = useQuery({
    queryKey: ['bedrock-versions'],
    queryFn: async () => {
        return (await invoke('plugin:bedrock|fetch_bedrock_versions').catch(() => [])) as { version: string, identifier: string, is_preview: boolean, is_gdk: boolean }[]
    }
})

const bedrockPackagesQuery = useQuery({
    queryKey: ['bedrock-packages-cache'],
    queryFn: async () => {
        return (await invoke('plugin:cache|get_bedrock_packages')) as { name: string, is_valid: boolean }[]
    }
})

const versionsSelectOptions = computed(() => {
    if (!bedrockVersionsQuery.data.value) return []
    return bedrockVersionsQuery.data.value.map(v => {
        let label = v.version
        if (v.is_preview) label += ' (Preview)'
        if (v.is_gdk) label += ' [GDK]'
        
        let disabled = false
        let subLabel: string | undefined
        if (bedrockPackagesQuery.data.value) {
            const pkg = bedrockPackagesQuery.data.value.find(p => p.name === `bedrock_${v.version}`)
            if (pkg && !pkg.is_valid) {
                disabled = true
                subLabel = 'Broken installation'
            }
        }

        return {
            value: v.version,
            label,
            subLabel,
            disabled
        }
    })
})

const currentPackage = computed(() => {
    if (!bedrockPackagesQuery.data.value) return null
    return bedrockPackagesQuery.data.value.find(p => p.name === `bedrock_${instance.value.game_version}`)
})

const repairIntegrity = async () => {
    integrityRepairing.value = true
    try {
        await install(instance.value.path, true)
        addNotification({
            title: 'Проверка завершена',
            text: 'Целостность файлов восстановлена. Недостающие компоненты были скачаны и распакованы.',
            type: 'success'
        })
        await queryClient.invalidateQueries({ queryKey: ['bedrock-packages-cache'] })
    } catch (e) {
        handleError(e as Error)
    } finally {
        integrityRepairing.value = false
    }
}

const changeVersion = async () => {
    if (selectedVersion.value === instance.value.game_version) return
    const v = bedrockVersionsQuery.data.value?.find(x => x.version === selectedVersion.value)
    if (!v) return

    repairing.value = true
    try {
        await edit(instance.value.path, {
            game_version: selectedVersion.value,
            loader_version: v.identifier
        })
        await install(instance.value.path, true)
        addNotification({
            title: 'Успех',
            text: 'Версия изменена.',
            type: 'success'
        })
        await queryClient.invalidateQueries({ queryKey: ['bedrock-packages-cache'] })
    } catch (e) {
        handleError(e as Error)
    } finally {
        repairing.value = false
    }
}
</script>

<template>
    <div class="flex flex-col gap-6">
        <!-- Installation Info -->
        <div class="flex flex-col gap-2.5">
            <span class="text-lg font-semibold text-contrast">Installation info</span>
            <div class="flex flex-col gap-2.5 rounded-[20px] bg-surface-2 p-4">
                <div class="flex items-center justify-between">
                    <span class="text-primary">Platform</span>
                    <span class="font-semibold text-contrast">Bedrock</span>
                </div>
                <div class="flex items-center justify-between">
                    <span class="text-primary">Game version</span>
                    <span class="font-semibold text-contrast">{{ instance.game_version }}</span>
                </div>
                <div class="flex items-center justify-between">
                    <span class="text-primary">Status</span>
                    <span class="font-semibold" :class="currentPackage?.is_valid ? 'text-green' : 'text-red'">
                        {{ currentPackage?.is_valid ? 'Installed' : 'Broken' }}
                    </span>
                </div>
            </div>
        </div>

        <!-- Change Version -->
        <div class="flex flex-col gap-2.5">
            <span class="text-lg font-semibold text-contrast">Change version</span>
            <div class="flex flex-col gap-3">
                <Combobox
                    v-model="selectedVersion"
                    :options="versionsSelectOptions"
                    :disabled="bedrockVersionsQuery.isLoading.value || repairing"
                    class="w-full"
                />
                <div>
                    <ButtonStyled color="brand">
                        <button
                            class="!shadow-none"
                            :disabled="selectedVersion === instance.game_version || repairing"
                            @click="changeVersion()"
                        >
                            <LoaderIcon v-if="repairing" class="size-5 animate-spin" />
                            <DownloadIcon v-else class="size-5" />
                            {{ repairing ? 'Installing...' : 'Change version (reinstall)' }}
                        </button>
                    </ButtonStyled>
                </div>
            </div>
            <span class="text-primary text-sm">
                Select a new Minecraft Bedrock version. The game will be reinstalled with the new version.
            </span>
        </div>

        <!-- Repair -->
        <div class="flex flex-col gap-2.5">
            <span class="text-lg font-semibold text-contrast">Repair instance</span>
            <div>
                <ButtonStyled>
                    <button
                        class="!shadow-none"
                        :disabled="integrityRepairing"
                        @click="repairModal?.show()"
                    >
                        <LoaderIcon v-if="integrityRepairing" class="size-5 animate-spin" />
                        <HammerIcon v-else class="size-5" />
                        {{ integrityRepairing ? 'Repairing...' : 'Repair' }}
                    </button>
                </ButtonStyled>
            </div>
            <span class="text-primary text-sm">
                Reinstalls Minecraft Bedrock dependencies and checks for corruption. This may resolve issues if your game is not launching due to launcher-related errors.
            </span>
        </div>

        <ConfirmRepairModal ref="repairModal" :server="false" @repair="repairIntegrity" />
    </div>
</template>
