<script setup lang="ts">
import { Combobox, defineMessages, ThemeSelector, Toggle, useVIntl } from '@modrinth/ui'
import { computed, ref, watch } from 'vue'

import { get, set } from '@/helpers/settings.ts'
import { getOS } from '@/helpers/utils'
import { useTheming } from '@/store/state'
import type { ColorTheme } from '@/store/theme.ts'

const themeStore = useTheming()
const { formatMessage } = useVIntl()

const messages = defineMessages({
	colorThemeTitle: {
		id: 'app.appearance-settings.color-theme.title',
		defaultMessage: 'Color theme',
	},
	colorThemeDescription: {
		id: 'app.appearance-settings.color-theme.description',
		defaultMessage: 'Choose the color theme used by Modrinth App.',
	},
	accentColorTitle: {
		id: 'app.appearance-settings.accent-color.title',
		defaultMessage: 'Accent Color',
	},
	accentColorDescription: {
		id: 'app.appearance-settings.accent-color.description',
		defaultMessage: 'Select your preferred accent color for the UI.',
	},
	accentColorGreen: {
		id: 'app.appearance-settings.accent-color.green',
		defaultMessage: 'Green',
	},
	accentColorPurple: {
		id: 'app.appearance-settings.accent-color.purple',
		defaultMessage: 'Purple',
	},
	accentColorBlue: {
		id: 'app.appearance-settings.accent-color.blue',
		defaultMessage: 'Blue',
	},
	accentColorRed: {
		id: 'app.appearance-settings.accent-color.red',
		defaultMessage: 'Red',
	},
	accentColorOrange: {
		id: 'app.appearance-settings.accent-color.orange',
		defaultMessage: 'Orange',
	},
	accentColorPink: {
		id: 'app.appearance-settings.accent-color.pink',
		defaultMessage: 'Pink',
	},
	accentColorTeal: {
		id: 'app.appearance-settings.accent-color.teal',
		defaultMessage: 'Teal',
	},
	accentColorCyan: {
		id: 'app.appearance-settings.accent-color.cyan',
		defaultMessage: 'Cyan',
	},
	accentColorYellow: {
		id: 'app.appearance-settings.accent-color.yellow',
		defaultMessage: 'Yellow',
	},
	advancedRenderingTitle: {
		id: 'app.appearance-settings.advanced-rendering.title',
		defaultMessage: 'Advanced rendering',
	},
	advancedRenderingDescription: {
		id: 'app.appearance-settings.advanced-rendering.description',
		defaultMessage:
			'Enable visual effects such as background blur. This may reduce performance without hardware acceleration.',
	},
	nativeDecorationsTitle: {
		id: 'app.appearance-settings.native-decorations.title',
		defaultMessage: 'System window frame',
	},
	nativeDecorationsDescription: {
		id: 'app.appearance-settings.native-decorations.description',
		defaultMessage:
			"Use your operating system's title bar and window controls. Requires an app restart.",
	},
})

const os = ref(await getOS())
const settings = ref(await get())
const themeOptions = computed(() =>
	themeStore
		.getThemeOptions()
		.filter((theme) => theme !== 'retro' || themeStore.devMode || settings.value.theme === 'retro'),
)

const ACCENT_COLORS = [
	'green',
	'purple',
	'blue',
	'red',
	'orange',
	'pink',
	'teal',
	'cyan',
	'yellow',
] as const

function applyAccentColor(color: string) {
	const html = document.documentElement
	html.style.removeProperty('--brand-h')
	for (const c of ACCENT_COLORS) {
		html.classList.remove(`theme-${c}`)
	}
	html.classList.add(`theme-${color}`)
	window?.localStorage?.setItem('accent_color', color)
}

const accentColor = ref(window?.localStorage?.getItem('accent_color') || 'green')
applyAccentColor(accentColor.value)

const accentColorOptions = computed(() => [
	{ value: 'green', label: formatMessage(messages.accentColorGreen) },
	{ value: 'purple', label: formatMessage(messages.accentColorPurple) },
	{ value: 'blue', label: formatMessage(messages.accentColorBlue) },
	{ value: 'red', label: formatMessage(messages.accentColorRed) },
	{ value: 'orange', label: formatMessage(messages.accentColorOrange) },
	{ value: 'pink', label: formatMessage(messages.accentColorPink) },
	{ value: 'teal', label: formatMessage(messages.accentColorTeal) },
	{ value: 'cyan', label: formatMessage(messages.accentColorCyan) },
	{ value: 'yellow', label: formatMessage(messages.accentColorYellow) },
])

const accentColorLabel = computed(() => {
	const opt = accentColorOptions.value.find((o) => o.value === accentColor.value)
	return opt?.label ?? accentColor.value
})

watch(
	settings,
	async () => {
		await set(settings.value)
	},
	{ deep: true },
)
</script>
<template>
	<h2 class="m-0 text-lg font-semibold text-contrast">
		{{ formatMessage(messages.colorThemeTitle) }}
	</h2>

	<p class="m-0 mt-1">{{ formatMessage(messages.colorThemeDescription) }}</p>

	<ThemeSelector
		:update-color-theme="
			(theme: ColorTheme) => {
				themeStore.setThemeState(theme)
				settings.theme = theme
			}
		"
		:current-theme="settings.theme"
		:theme-options="themeOptions"
		system-theme-color="system"
	/>

	<div class="mt-6 flex items-center justify-between">
		<div>
			<h2 class="m-0 text-lg font-semibold text-contrast">
				{{ formatMessage(messages.accentColorTitle) }}
			</h2>
			<p class="m-0 mt-1">{{ formatMessage(messages.accentColorDescription) }}</p>
		</div>
		<Combobox
			id="accent-color"
			:model-value="accentColor"
			name="Accent color dropdown"
			class="max-w-40"
			:options="accentColorOptions"
			:display-value="accentColorLabel"
			@update:model-value="(val) => {
				accentColor = val;
				applyAccentColor(val);
			}"
		/>
	</div>

	<div class="mt-6 flex items-center justify-between">
		<div>
			<h2 class="m-0 text-lg font-semibold text-contrast">
				{{ formatMessage(messages.advancedRenderingTitle) }}
			</h2>
			<p class="m-0 mt-1">
				{{ formatMessage(messages.advancedRenderingDescription) }}
			</p>
		</div>

		<Toggle
			id="advanced-rendering"
			:model-value="themeStore.advancedRendering"
			@update:model-value="
				(e) => {
					themeStore.advancedRendering = !!e
					settings.advanced_rendering = themeStore.advancedRendering
				}
			"
		/>
	</div>

	<div v-if="os !== 'MacOS'" class="mt-6 flex items-center justify-between gap-4">
		<div>
			<h2 class="m-0 text-lg font-semibold text-contrast">
				{{ formatMessage(messages.nativeDecorationsTitle) }}
			</h2>
			<p class="m-0 mt-1">{{ formatMessage(messages.nativeDecorationsDescription) }}</p>
		</div>
		<Toggle id="native-decorations" v-model="settings.native_decorations" />
	</div>
</template>
