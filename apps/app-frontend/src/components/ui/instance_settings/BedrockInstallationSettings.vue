<script setup lang="ts">
import { DownloadIcon, HammerIcon, SpinnerIcon } from '@modrinth/assets'
import { ButtonStyled, Combobox,ConfirmRepairModal, injectNotificationManager } from '@modrinth/ui'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { invoke } from '@tauri-apps/api/core'
import { computed, ref } from 'vue'

import { install_existing_instance as install } from '@/helpers/install'
import { edit } from '@/helpers/instance'
import { injectInstanceSettings } from '@/providers/instance-settings'

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

const versionsSelectOptions = computed(() => {
    if (!bedrockVersionsQuery.data.value) return []
    return bedrockVersionsQuery.data.value.map(v => {
        let label = v.version
        if (v.is_preview) label += ' (Preview)'
        if (v.is_gdk) label += ' [GDK]'

        return {
            value: v.version,
            label,
            disabled: false
        }
    })
})

const repairIntegrity = async () => {
    integrityRepairing.value = true
    try {
        await install(instance.value.id, true)
        addNotification({
            title: 'Проверка завершена',
            text: 'Целостность файлов восстановлена. Недостающие компоненты были скачаны и распакованы.',
            type: 'success'
        })
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
        await edit(instance.value.id, {
            game_version: selectedVersion.value,
            loader_version: selectedVersion.value
        })
        await install(instance.value.id, true)
        addNotification({
            title: 'Успех',
            text: 'Версия изменена.',
            type: 'success'
        })
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
                    <span class="font-semibold text-green">
                        Ready
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
                            <SpinnerIcon v-if="repairing" class="size-5 animate-spin" />
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
                        <SpinnerIcon v-if="integrityRepairing" class="size-5 animate-spin" />
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
