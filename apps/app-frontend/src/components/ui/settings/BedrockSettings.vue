<script setup lang="ts">
import { Toggle, defineMessages, useVIntl } from '@modrinth/ui'
import { ref, watch } from 'vue'
import { get, set } from '@/helpers/settings.ts'

const { formatMessage } = useVIntl()

const messages = defineMessages({
	gdkUnlockerTitle: {
		id: 'app.settings.bedrock.gdk-unlocker',
		defaultMessage: 'GDK Unlocker (Xbox App)',
	},
	gdkUnlockerDesc: {
		id: 'app.settings.bedrock.gdk-unlocker.desc',
		defaultMessage: 'Replaces the license verification process with custom DLLs for Xbox App instances.\nAdds antivirus exceptions automatically to prevent the fix from being removed.',
	},
	uwpUnlockerTitle: {
		id: 'app.settings.bedrock.uwp-unlocker',
		defaultMessage: 'UWP Unlocker (Microsoft Store)',
	},
	uwpUnlockerDesc: {
		id: 'app.settings.bedrock.uwp-unlocker.desc',
		defaultMessage: 'Modifies the Windows system Store components to unlock trial restriction for UWP Minecraft instances.',
	},
	uwpUnlockerWarn: {
		id: 'app.settings.bedrock.uwp-unlocker.warn',
		defaultMessage: '⚠ This requires Administrator privileges. A backup of original files is automatically taken.',
	}
})

const fetchSettings = await get()
const settings = ref(fetchSettings)

const bedrockUnlockerGdk = ref(settings.value.feature_flags?.bedrock_unlocker_gdk ?? false)
const bedrockUnlockerUwp = ref(settings.value.feature_flags?.bedrock_unlocker_uwp ?? false)

watch(
	bedrockUnlockerGdk,
	async (val) => {
		if (!settings.value.feature_flags) {
			settings.value.feature_flags = {}
		}
		settings.value.feature_flags.bedrock_unlocker_gdk = val
		await set(settings.value)
	},
)

watch(
	bedrockUnlockerUwp,
	async (val) => {
		if (!settings.value.feature_flags) {
			settings.value.feature_flags = {}
		}
		settings.value.feature_flags.bedrock_unlocker_uwp = val
		await set(settings.value)
	},
)
</script>

<template>
	<div>
		<div class="flex flex-col gap-6">
			<div class="flex items-center justify-between gap-4">
				<div class="flex flex-col gap-1">
					<h3 class="m-0 text-lg font-semibold text-contrast">{{ formatMessage(messages.gdkUnlockerTitle) }}</h3>
					<p class="m-0 leading-tight whitespace-pre-wrap">{{ formatMessage(messages.gdkUnlockerDesc) }}</p>
				</div>
				<Toggle id="bedrock-unlocker-gdk" v-model="bedrockUnlockerGdk" />
			</div>
			
			<div class="flex items-center justify-between gap-4">
				<div class="flex flex-col gap-1">
					<h3 class="m-0 text-lg font-semibold text-contrast">{{ formatMessage(messages.uwpUnlockerTitle) }}</h3>
					<p class="m-0 leading-tight">
						{{ formatMessage(messages.uwpUnlockerDesc) }}
					</p>
					<p class="m-0 leading-tight text-orange-400 text-sm mt-1">
						{{ formatMessage(messages.uwpUnlockerWarn) }}
					</p>
				</div>
				<Toggle id="bedrock-unlocker-uwp" v-model="bedrockUnlockerUwp" />
			</div>
		</div>
	</div>
</template>
