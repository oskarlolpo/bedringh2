<script setup lang="ts">
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { computed, ref, watch } from 'vue'
import { injectNotificationManager, ButtonStyled, DropdownSelect, SettingsLabel, useVIntl } from '@modrinth/ui'
import { invoke } from '@tauri-apps/api/core'
import { LoaderIcon, AlertTriangleIcon } from 'lucide-vue-next'

import { injectInstanceSettings } from '@/providers/instance-settings'
import { edit, install } from '@/helpers/profile'

const { instance } = injectInstanceSettings()
const { handleError, notify } = injectNotificationManager()
const { formatMessage } = useVIntl()
const queryClient = useQueryClient()

const selectedVersion = ref(instance.value.game_version)
const repairing = ref(false)

const bedrockVersionsQuery = useQuery({
    queryKey: ['bedrock-versions'],
    queryFn: async () => {
        return (await invoke('plugin:bedrock|fetch_bedrock_versions').catch(() => [])) as { version: string, identifier: string, is_preview: boolean, is_gdk: boolean }[]
    }
})

const bedrockPackagesQuery = useQuery({
    queryKey: ['bedrock-packages-cache'],
    queryFn: async () => {
        return (await invoke('plugin:cache|get_bedrock_packages')) as { version: string, is_valid: boolean }[]
    }
})

const versionsSelectOptions = computed(() => {
    if (!bedrockVersionsQuery.data.value) return []
    return bedrockVersionsQuery.data.value.map(v => {
        let label = v.version
        if (v.is_preview) label += ' (Preview)'
        if (v.is_gdk) label += ' [GDK]'
        
        let invalid = false
        if (bedrockPackagesQuery.data.value) {
            const pkg = bedrockPackagesQuery.data.value.find(p => p.version === v.version)
            if (pkg && !pkg.is_valid) {
                invalid = true
                label += ' ⚠'
            }
        }

        return {
            value: v.version,
            label,
            invalid
        }
    })
})

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
        notify({
            title: 'Успех',
            description: 'Версия изменена.',
            type: 'success'
        })
        await queryClient.invalidateQueries({ queryKey: ['bedrock-packages-cache'] })
    } catch (e) {
        handleError(e)
    } finally {
        repairing.value = false
    }
}
</script>

<template>
    <div class="flex flex-col h-full overflow-y-auto w-full max-w-[800px] mt-0 mx-auto px-6 py-6 pb-20 custom-scrollbar gap-8">
        <h1 class="text-2xl font-bold m-0 mb-4">
            Версия Bedrock
        </h1>
        <div class="flex flex-col gap-4">
            <SettingsLabel title="Версия игры" description="Установите версию Minecraft Bedrock без изменения загрузчика.">
                <template #control>
                    <div class="flex flex-row items-center gap-2">
                        <DropdownSelect
                            name="bedrock-version-select"
                            v-model="selectedVersion"
                            :options="versionsSelectOptions"
                            :displayName="(opt) => opt.label"
                            :disabled="bedrockVersionsQuery.isLoading.value || repairing"
                            class="min-w-[200px]"
                        >
                        </DropdownSelect>
                    </div>
                </template>
            </SettingsLabel>

            <div class="flex flex-row items-center gap-4 mt-4 select-none">
                <ButtonStyled
                    color="primary"
                    :disabled="selectedVersion === instance.game_version || repairing"
                    @click="changeVersion()"
                >
                    <button class="flex flex-row items-center gap-2">
                        <LoaderIcon v-if="repairing" class="w-4 h-4 animate-spin" />
                        Изменить версию (с переустановкой)
                    </button>
                </ButtonStyled>
            </div>
        </div>
    </div>
</template>
