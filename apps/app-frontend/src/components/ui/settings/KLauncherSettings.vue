<script setup lang="ts">
import { defineMessages, Toggle, useVIntl } from '@modrinth/ui'
import { ref, watch } from 'vue'

import { get, set } from '@/helpers/settings.ts'

const { formatMessage } = useVIntl()

const messages = defineMessages({
	skinSystemTitle: {
		id: 'klauncher.settings.skin-system.title',
		defaultMessage: 'Система скинов',
	},
	skinSystemDescription: {
		id: 'klauncher.settings.skin-system.description',
		defaultMessage: 'Функциональная система скинов от KL:Launcher',
	},
	censorshipTitle: {
		id: 'klauncher.settings.censorship.title',
		defaultMessage: 'Система цензуры',
	},
	censorshipDescription: {
		id: 'klauncher.settings.censorship.description',
		defaultMessage: 'Система защиты не прошедших модерацию скинов и плащей',
	},
	klmasterTitle: {
		id: 'klauncher.settings.klmaster.title',
		defaultMessage: 'Мод KL:Master',
	},
	klmasterDescription: {
		id: 'klauncher.settings.klmaster.description',
		defaultMessage:
			'HD скины на 1.17+, анимированные и зачарованные плащи и прочие весомые улучшения игрового процесса Minecraft',
	},
})

const settings = ref(await get())

const skinSystem = ref(settings.value.feature_flags?.KLauncherSkinSystem ?? true)
const censorship = ref(settings.value.feature_flags?.KLauncherCensorship ?? false)
const klmaster = ref(settings.value.feature_flags?.KLauncherKLMaster ?? true)

async function saveFlags() {
	settings.value.feature_flags = {
		...settings.value.feature_flags,
		KLauncherSkinSystem: skinSystem.value,
		KLauncherCensorship: censorship.value,
		KLauncherKLMaster: klmaster.value,
	}
	await set(settings.value)
}

watch([skinSystem, censorship, klmaster], saveFlags)
</script>

<template>
	<div class="flex flex-col gap-6">
		<!-- Система скинов -->
		<div class="flex items-center justify-between gap-4">
			<div>
				<h2 class="m-0 text-lg font-semibold text-contrast">
					{{ formatMessage(messages.skinSystemTitle) }}
				</h2>
				<p class="m-0 mt-1 text-sm text-secondary">
					{{ formatMessage(messages.skinSystemDescription) }}
				</p>
			</div>
			<Toggle id="klauncher-skin-system" v-model="skinSystem" />
		</div>

		<!-- Система цензуры -->
		<div class="flex items-center justify-between gap-4">
			<div>
				<h2 class="m-0 text-lg font-semibold text-contrast">
					{{ formatMessage(messages.censorshipTitle) }}
				</h2>
				<p class="m-0 mt-1 text-sm text-secondary">
					{{ formatMessage(messages.censorshipDescription) }}
				</p>
			</div>
			<Toggle id="klauncher-censorship" v-model="censorship" />
		</div>

		<!-- Мод KL:Master -->
		<div class="flex items-center justify-between gap-4">
			<div>
				<h2 class="m-0 text-lg font-semibold text-contrast">
					{{ formatMessage(messages.klmasterTitle) }}
				</h2>
				<p class="m-0 mt-1 text-sm text-secondary">
					{{ formatMessage(messages.klmasterDescription) }}
				</p>
			</div>
			<Toggle id="klauncher-klmaster" v-model="klmaster" />
		</div>
	</div>
</template>

