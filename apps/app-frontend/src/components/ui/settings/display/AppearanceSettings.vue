<script setup lang="ts">
import {
	AppearanceSettingsLayout,
	Combobox,
	injectAuth,
	injectUserPreferences,
	provideAppearanceSettings,
	Toggle,
	useSavable,
} from '@modrinth/ui'
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { type ColorTheme, isDarkTheme, useTheme } from '@/composables/use-theme.ts'
import { type AppSettings, get, set } from '@/helpers/settings.ts'
import { getOS } from '@/helpers/utils'
import { appSettingsModalContextKey } from '@/providers/app-settings-modal'
import { useTheming } from '@/store/theme'

const theme = useTheme()
const themeStore = useTheming()
const auth = injectAuth()
const { updatePreferences } = injectUserPreferences()
const settingsModal = inject(appSettingsModalContextKey, null)
const os = await getOS()
const settings = ref(await get())

type AppearanceSettingsState = {
	theme: ColorTheme
	syncAcrossDevices: boolean
	advancedRendering: boolean
	nativeDecorations: boolean
}

function getAppearanceSettingsState(settings: AppSettings): AppearanceSettingsState {
	return {
		theme: settings.theme,
		syncAcrossDevices: settings.sync_theme_across_devices,
		advancedRendering: settings.advanced_rendering,
		nativeDecorations: settings.native_decorations,
	}
}

const { saved, current, changes, saving, hasChanges, reset, save } = useSavable(
	() => getAppearanceSettingsState(settings.value),
	async (appearanceChanges) => {
		const value = current.value
		if (
			value.syncAcrossDevices &&
			auth.user.value &&
			(appearanceChanges.theme !== undefined || appearanceChanges.syncAcrossDevices !== undefined)
		) {
			await updatePreferences({
				appearance: value.theme === 'system' ? { auto: true } : { auto: false, theme: value.theme },
			})
		}

		const nextSettings: AppSettings = {
			...settings.value,
			theme: value.theme,
			sync_theme_across_devices: value.syncAcrossDevices,
			advanced_rendering: value.advancedRendering,
			native_decorations: value.nativeDecorations,
		}

		await set(nextSettings)
		settings.value = nextSettings
		if (isDarkTheme(value.theme)) {
			theme.preferredDark = value.theme
		}
		theme.preferred = value.theme
		theme.syncAcrossDevices = value.syncAcrossDevices
		theme.advancedRendering = value.advancedRendering
	},
)

const themeOptions = computed(() =>
	theme.options.filter(
		(option) =>
			option !== 'retro' || settings.value.developer_mode || current.value.theme === 'retro',
	),
)

const preferredDarkTheme = computed(() =>
	isDarkTheme(current.value.theme) ? current.value.theme : theme.preferredDark,
)

function setTheme(value: ColorTheme): void {
	current.value.theme = value
}

function setSyncAcrossDevices(enabled: boolean): void {
	current.value.syncAcrossDevices = enabled
}

function setAdvancedRendering(enabled: boolean): void {
	current.value.advancedRendering = enabled
}

function setNativeDecorations(enabled: boolean): void {
	current.value.nativeDecorations = enabled
}

watch(
	[() => current.value.theme, () => saved.value.theme],
	([selectedTheme, savedTheme]) => {
		theme.preview = selectedTheme === savedTheme ? null : selectedTheme
	},
	{ immediate: true },
)

async function saveAppearanceSettings(): Promise<void> {
	try {
		await save()
	} catch {
		return
	}
}

onMounted(() => {
	settingsModal?.registerUnsavedChangesController({
		hasChanges: () => hasChanges.value,
		getOriginal: () => saved.value,
		getModified: () => changes.value,
		isSaving: () => saving.value,
		reset,
		save: saveAppearanceSettings,
	})
})

onBeforeUnmount(() => {
	theme.preview = null
	settingsModal?.registerUnsavedChangesController(null)
})

provideAppearanceSettings({
	deferPersistence: true,
	theme: {
		current: computed(() => current.value.theme),
		options: themeOptions,
		system: computed(() => (theme.native === 'light' ? 'light' : preferredDarkTheme.value)),
		preferredDark: preferredDarkTheme,
		set: setTheme,
		syncAcrossDevices: {
			value: computed(() => current.value.syncAcrossDevices),
			set: setSyncAcrossDevices,
		},
		syncDisabled: computed(() => !auth.user.value),
	},
	advancedRendering: {
		value: computed(() => current.value.advancedRendering),
		set: setAdvancedRendering,
	},
	nativeDecorations:
		os !== 'MacOS'
			? {
					value: computed(() => current.value.nativeDecorations),
					set: setNativeDecorations,
				}
			: undefined,
	updatePreferences,
})

const accentColor = ref(localStorage.getItem('accent_color') || 'green')

const accentColorOptions = [
	{ value: 'green', label: 'Изумрудный', hex: '#1bd96a' },
	{ value: 'teal', label: 'Морская волна', hex: '#14b8a6' },
	{ value: 'cyan', label: 'Бирюзовый', hex: '#06b6d4' },
	{ value: 'sky', label: 'Небесный', hex: '#0ea5e9' },
	{ value: 'blue', label: 'Синий', hex: '#2979ff' },
	{ value: 'indigo', label: 'Индиго', hex: '#6366f1' },
	{ value: 'violet', label: 'Аметист', hex: '#8b5cf6' },
	{ value: 'purple', label: 'Фиолетовый', hex: '#9c40ff' },
	{ value: 'fuchsia', label: 'Фуксия', hex: '#d946ef' },
	{ value: 'pink', label: 'Розовый', hex: '#ec4899' },
	{ value: 'rose', label: 'Алая роза', hex: '#f43f5e' },
	{ value: 'red', label: 'Красный', hex: '#ff2a55' },
	{ value: 'orange', label: 'Оранжевый', hex: '#ff7a1a' },
	{ value: 'amber', label: 'Янтарный', hex: '#f59e0b' },
	{ value: 'yellow', label: 'Золотой', hex: '#eab308' },
	{ value: 'lime', label: 'Лаймовый', hex: '#84cc16' },
]

const accentColorDisplay = computed(() => {
	const opt = accentColorOptions.find((o) => o.value === accentColor.value)
	return opt ? opt.label : 'Изумрудный'
})

function setAccentColor(val: string) {
	accentColor.value = val
	localStorage.setItem('accent_color', val)
	for (const opt of accentColorOptions) {
		document.documentElement.classList.remove('theme-' + opt.value)
	}
	document.documentElement.classList.add('theme-' + val)
}

function toggleChibi(val: boolean) {
	themeStore.setChibiEnabled(val)
}
</script>

<template>
	<AppearanceSettingsLayout />

	<div class="mt-6 flex flex-col gap-4 border-0 border-t-[1px] border-solid border-surface-4 pt-6">
		<div class="flex items-center justify-between">
			<div>
				<h2 class="m-0 text-lg font-semibold text-contrast">
					Акцентный цвет
				</h2>
				<p class="m-0 mt-1 text-secondary">Выберите желаемый оттенок акцентов и подсветки для интерфейса лаунчера.</p>
			</div>
			<Combobox
				id="accent-color"
				:model-value="accentColor"
				name="Accent color dropdown"
				class="max-w-44"
				:options="accentColorOptions"
				:display-value="accentColorDisplay"
				@update:model-value="setAccentColor"
			/>
		</div>

		<div class="flex flex-wrap items-center gap-2 pt-1">
			<button
				v-for="opt in accentColorOptions"
				:key="opt.value"
				type="button"
				:title="opt.label"
				class="relative flex size-8 items-center justify-center rounded-full transition-all duration-150 hover:scale-110 focus:outline-none border border-solid border-white/20 cursor-pointer"
				:class="{ 'ring-2 ring-contrast ring-offset-2 ring-offset-[--color-bg] scale-105': accentColor === opt.value }"
				:style="{ backgroundColor: opt.hex }"
				@click="setAccentColor(opt.value)"
			>
				<span
					v-if="accentColor === opt.value"
					class="size-2 rounded-full bg-white shadow-sm"
				></span>
			</button>
		</div>
	</div>

	<div class="mt-6 flex items-center justify-between border-0 border-t-[1px] border-solid border-surface-4 pt-6">
		<div>
			<h2 class="m-0 text-lg font-semibold text-contrast">
				Персонаж-чибик
			</h2>
			<p class="m-0 mt-1 text-secondary">
				Отображать интерактивную чиби-модель вашего персонажа с активным скином в правом нижнем углу боковой панели.
			</p>
		</div>
		<Toggle
			id="chibi-avatar-toggle"
			:model-value="themeStore.chibiEnabled"
			@update:model-value="toggleChibi"
		/>
	</div>
</template>
