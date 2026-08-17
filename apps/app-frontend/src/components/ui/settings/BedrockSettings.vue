<script setup lang="ts">
import { DownloadIcon, ExternalIcon } from '@modrinth/assets'
import { ButtonStyled, defineMessages, Toggle, useVIntl } from '@modrinth/ui'
import { openUrl } from '@tauri-apps/plugin-opener'
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
	},
	gamingServicesTitle: {
		id: 'app.settings.bedrock.gaming-services.title',
		defaultMessage: 'Gaming Services (System Dependency)',
	},
	gamingServicesDesc: {
		id: 'app.settings.bedrock.gaming-services.desc',
		defaultMessage: 'Microsoft Gaming Services is required for Bedrock Minecraft to launch and load GDK runtime binaries (xgameruntime.dll). If game launch fails or complains about missing runtime components, download or repair Gaming Services via Microsoft Store.',
	},
	gamingServicesBtn: {
		id: 'app.settings.bedrock.gaming-services.btn',
		defaultMessage: 'Download Gaming Services in Store',
	},
})

function openGamingServicesStore() {
	openUrl('ms-windows-store://pdp/?productid=9MWPM2CQNLHN')
}

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

			<div class="border-0 border-t border-solid border-white/10 pt-4 flex items-center justify-between gap-4">
				<div class="flex flex-col gap-1 flex-1">
					<h3 class="m-0 text-lg font-semibold text-contrast">{{ formatMessage(messages.gamingServicesTitle) }}</h3>
					<p class="m-0 leading-tight text-sm">
						{{ formatMessage(messages.gamingServicesDesc) }}
					</p>
				</div>
				<ButtonStyled color="brand">
					<button class="flex items-center gap-2 whitespace-nowrap" @click="openGamingServicesStore">
						<DownloadIcon class="h-4 w-4" />
						<span>{{ formatMessage(messages.gamingServicesBtn) }}</span>
						<ExternalIcon class="h-3.5 w-3.5 opacity-70" />
					</button>
				</ButtonStyled>
			</div>
		</div>
	</div>
</template>
