<script setup lang="ts">
import { CheckIcon, SpinnerIcon, TagCategoryZapIcon as BoltIcon } from '@modrinth/assets'
import { Button, injectNotificationManager, Toggle } from '@modrinth/ui'
import { useQueryClient } from '@tanstack/vue-query'
import { computed, onMounted, ref, watch } from 'vue'

import {
	get_content_items,
	install_project_with_dependencies,
	remove_project,
} from '@/helpers/instance'
import type { GameInstance } from '@/helpers/types'
import { instanceKeys } from '../../query-options'

const props = defineProps<{
	instance: GameInstance
}>()

const { addNotification, handleError } = injectNotificationManager()
const queryClient = useQueryClient()

const loading = ref(false)
const boostEnabled = ref(false)
const installing = ref(false)
const currentStatus = ref('')
const installedBoostMods = ref<string[]>([])

const isJava = computed(() => {
	const l = props.instance.loader?.toLowerCase()
	return l !== 'bedrock'
})

const isVanilla = computed(() => {
	return props.instance.loader?.toLowerCase() === 'vanilla'
})

const boostModPresets = computed(() => {
	const l = props.instance.loader?.toLowerCase()
	if (l === 'forge') {
		return [
			{ id: 'embeddium', name: 'Embeddium', desc: 'Рендеринг нового поколения (Sodium для Forge)' },
			{ id: 'ferrite-core', name: 'FerriteCore', desc: 'Оптимизация потребления оперативной памяти' },
			{ id: 'immediatelyfast', name: 'ImmediatelyFast', desc: 'Ускорение рендеринга интерфейса и HUD' },
			{ id: 'modernfix', name: 'ModernFix', desc: 'Ускорение запуска и устранение утечек памяти' },
			{ id: 'entityculling', name: 'EntityCulling', desc: 'Отсечение невидимых сущностей для повышения FPS' },
		]
	}
	if (l === 'neoforge') {
		return [
			{ id: 'sodium', name: 'Sodium', desc: 'Кардинальное повышение FPS и оптимизация рендеринга' },
			{ id: 'ferrite-core', name: 'FerriteCore', desc: 'Оптимизация потребления RAM' },
			{ id: 'immediatelyfast', name: 'ImmediatelyFast', desc: 'Ускорение рендеринга GUI' },
			{ id: 'modernfix', name: 'ModernFix', desc: 'Ускорение загрузки' },
			{ id: 'entityculling', name: 'EntityCulling', desc: 'Отсечение невидимых сущностей' },
		]
	}
	// Default Fabric / Quilt
	return [
		{ id: 'sodium', name: 'Sodium', desc: 'Кардинальное повышение FPS и оптимизация графики' },
		{ id: 'lithium', name: 'Lithium', desc: 'Оптимизация физики и игровой логики без изменения механик' },
		{ id: 'ferrite-core', name: 'FerriteCore', desc: 'Снижение потребления оперативной памяти' },
		{ id: 'immediatelyfast', name: 'ImmediatelyFast', desc: 'Оптимизация отрисовки интерфейса и шрифтов' },
		{ id: 'entityculling', name: 'EntityCulling', desc: 'Скрытие невидимых мобов и сущностей' },
	]
})

async function checkInstalled() {
	if (!props.instance?.id || !isJava.value || isVanilla.value) return
	loading.value = true
	try {
		const items = await get_content_items(props.instance.id)
		const installed = items
			.flatMap((item) => [
				item.project?.slug?.toLowerCase(),
				item.project?.id?.toLowerCase(),
			])
			.filter((x): x is string => Boolean(x))

		installedBoostMods.value = installed
		const presetSlugs = boostModPresets.value.map((m) => m.id.toLowerCase())
		const count = presetSlugs.filter((slug) => installed.includes(slug)).length

		// Considered enabled if at least 2 key optimization mods are present
		boostEnabled.value = count >= 2
	} catch {
		// Ignore
	} finally {
		loading.value = false
	}
}

watch(() => props.instance.id, checkInstalled)
onMounted(checkInstalled)

async function handleToggle(value: boolean) {
	if (installing.value || loading.value) return

	if (isVanilla.value) {
		addNotification({
			title: 'Буст FPS',
			text: 'Для установки модов буста FPS выберите загрузчик (Fabric, Forge или NeoForge)',
			type: 'warning',
		})
		boostEnabled.value = false
		return
	}

	installing.value = true
	boostEnabled.value = value

	if (value) {
		// Apply FPS Boost
		currentStatus.value = 'Подготовка модов оптимизации...'
		try {
			const missing = boostModPresets.value.filter(
				(m) => !installedBoostMods.value.includes(m.id.toLowerCase()),
			)

			for (const mod of missing) {
				currentStatus.value = `Установка ${mod.name}...`
				try {
					await install_project_with_dependencies(props.instance.id, {
						project_id: mod.id,
						content_type: 'mod',
					})
				} catch (err) {
					console.warn(`Could not install ${mod.name}:`, err)
				}
			}

			await queryClient.invalidateQueries({
				queryKey: ['instanceContent', props.instance.id],
			})
			await queryClient.invalidateQueries({
				queryKey: instanceKeys.instance(props.instance.id),
			})

			await checkInstalled()
			addNotification({
				title: 'Буст FPS',
				text: 'Буст FPS успешно применен! Моды добавлены в список контента.',
				type: 'success',
			})
		} catch (err) {
			handleError(err as Error)
			await checkInstalled()
		} finally {
			installing.value = false
			currentStatus.value = ''
		}
	} else {
		// Turn off / remove
		currentStatus.value = 'Отключение модов оптимизации...'
		try {
			const items = await get_content_items(props.instance.id)
			const presetSlugs = boostModPresets.value.map((m) => m.id.toLowerCase())
			const toRemove = items.filter((item) => {
				const slug = item.project?.slug?.toLowerCase() || item.project?.id?.toLowerCase()
				return slug && presetSlugs.includes(slug)
			})

			for (const mod of toRemove) {
				const pathToRemove = mod.file_path || (mod.file_name ? `mods/${mod.file_name}` : null)
				if (pathToRemove) {
					await remove_project(props.instance.id, pathToRemove).catch((e) => {
						console.warn('Failed to remove mod:', pathToRemove, e)
					})
				}
			}

			await queryClient.invalidateQueries({
				queryKey: ['instanceContent', props.instance.id],
			})
			await queryClient.invalidateQueries({
				queryKey: instanceKeys.instance(props.instance.id),
			})

			await checkInstalled()
			addNotification({
				title: 'Буст FPS',
				text: 'Моды оптимизации FPS удалены.',
				type: 'info',
			})
		} catch (err) {
			handleError(err as Error)
			await checkInstalled()
		} finally {
			installing.value = false
			currentStatus.value = ''
		}
	}
}
</script>

<template>
	<div
		v-if="isJava"
		class="mt-4 rounded-xl border border-color-bg-subtle bg-color-bg-base p-4 shadow-sm"
	>
		<div class="flex items-center justify-between gap-4">
			<div class="flex items-start gap-3">
				<div class="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 mt-0.5">
					<BoltIcon class="w-5 h-5 text-brand" />
				</div>
				<div>
					<div class="font-bold text-sm text-color-text-primary flex items-center gap-2">
						<span>Буст FPS (Тюнинг оптимизации)</span>
						<span
							v-if="boostEnabled"
							class="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium"
						>
							Активен
						</span>
					</div>
					<div class="text-xs text-color-text-secondary mt-0.5">
						Автоматическая установка набора оптимизирующих модов под версию игры и загрузчик.
						Моды добавляются как отдельные в списке контента.
					</div>
					<div v-if="currentStatus" class="text-xs text-brand font-medium mt-1 flex items-center gap-1.5">
						<SpinnerIcon class="w-3.5 h-3.5 animate-spin" />
						{{ currentStatus }}
					</div>
				</div>
			</div>

			<div class="flex items-center gap-3">
				<Toggle
					id="fps-boost-toggle"
					:model-value="boostEnabled"
					:disabled="loading || installing || isVanilla"
					@update:model-value="handleToggle"
				/>
			</div>
		</div>

		<!-- Preset mods list -->
		<div v-if="!isVanilla" class="mt-3 pt-3 border-t border-color-bg-subtle/50 flex flex-wrap gap-2">
			<div
				v-for="mod in boostModPresets"
				:key="mod.id"
				class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-color-bg-subtle/40 border border-color-bg-subtle/60"
			>
				<CheckIcon
					v-if="installedBoostMods.includes(mod.id.toLowerCase())"
					class="w-3.5 h-3.5 text-emerald-400"
				/>
				<span
					:class="installedBoostMods.includes(mod.id.toLowerCase()) ? 'text-color-text-primary font-medium' : 'text-color-text-secondary'"
				>
					{{ mod.name }}
				</span>
			</div>
		</div>

		<div v-if="isVanilla" class="mt-2 text-xs text-amber-400/90">
			Для работы буста FPS требуется загрузчик (выберите Fabric, Forge или NeoForge в настройках выше).
		</div>
	</div>
</template>
