<script setup lang="ts">
import { LeftArrowIcon, SpinnerIcon } from '@modrinth/assets'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import Admonition from '#ui/components/base/Admonition.vue'
import Avatar from '#ui/components/base/Avatar.vue'
import ButtonStyled from '#ui/components/base/ButtonStyled.vue'
import { defineMessages, useVIntl } from '#ui/composables/i18n'
import { useServerImage } from '#ui/composables/use-server-image'
import { formatLoaderLabel } from '#ui/utils/loaders'

import SelectedProjectsLeaveModal from './components/SelectedProjectsLeaveModal.vue'
import { useSearchTranslation } from './composables/use-search-translation'
import { injectBrowseManager } from './providers/browse-manager'
import type { BrowseInstallContext } from './types'

const MEDAL_ICON_URL = 'https://cdn-raw.modrinth.com/medal_icon.webp'

const router = useRouter()
const props = defineProps<{
	installContext?: BrowseInstallContext | null
}>()
type SelectedProjectsLeaveResult = 'cancel' | 'discard' | 'install'

const ctx = injectBrowseManager(null)
const installContext = computed(() => props.installContext ?? ctx?.installContext?.value ?? null)
const selectedProjectsLeaveModal = ref<InstanceType<typeof SelectedProjectsLeaveModal>>()

const { formatMessage } = useVIntl()
const {
	isTranslated: isSearchTranslated,
	isTranslating: isSearchTranslating,
	applyingTranslation,
	toggleSearchTranslation,
	translateNewHits,
} = useSearchTranslation(ctx?.query)

function setHits(updated: any[]) {
	if (!ctx) return
	applyingTranslation.value = true
	if (ctx.isServerType.value) {
		ctx.serverHits.value = updated as typeof ctx.serverHits.value
	} else {
		ctx.projectHits.value = updated as typeof ctx.projectHits.value
	}
	// Release the flag after Vue flushes the watcher queue so our own
	// replacement does not retrigger the auto-translate watcher below.
	setTimeout(() => {
		applyingTranslation.value = false
	}, 0)
}

async function handleToggleSearchTranslation() {
	if (!ctx) return
	const hits = ctx.isServerType.value ? ctx.serverHits.value : ctx.projectHits.value
	const updated = await toggleSearchTranslation(hits as any[])
	setHits(updated)
}

// When translation is enabled and the search results change (e.g. page switch),
// automatically translate the newly loaded hits.
watch(
	() => (ctx ? (ctx.isServerType.value ? ctx.serverHits.value : ctx.projectHits.value) : null),
	async (newHits, oldHits) => {
		if (!ctx || !newHits || newHits === oldHits) return
		if (applyingTranslation.value) return
		if (!isSearchTranslated.value || isSearchTranslating.value) return
		const updated = await translateNewHits(newHits as any[])
		if (updated === newHits) return
		setHits(updated)
	},
)

const messages = defineMessages({
	translatePage: {
		id: 'browse.translate-page',
		defaultMessage: 'Translate this page',
	},
	showOriginal: {
		id: 'browse.show-original',
		defaultMessage: 'Show original',
	},
})

const serverId = computed(() => installContext.value?.serverId ?? '')
const upstream = computed(() => installContext.value?.upstream ?? null)

const { image: fetchedIcon } = useServerImage(serverId, upstream, {
	enabled: computed(() => !!installContext.value?.serverId),
})

const iconSrc = computed(() => {
	if (installContext.value?.isMedal) return MEDAL_ICON_URL
	return fetchedIcon.value ?? installContext.value?.iconSrc ?? null
})

const metadataItems = computed(() => {
	const context = installContext.value
	if (!context) return []
	return [
		context.heading,
		context.gameVersion ? `MC ${context.gameVersion}` : '',
		context.loader ? formatLoaderLabel(context.loader) : '',
	].filter(Boolean)
})

const selectedCount = computed(() => installContext.value?.selectedProjects?.length ?? 0)
const isInstallingSelected = computed(() => installContext.value?.isInstallingSelected ?? false)

async function handleBack() {
	const context = installContext.value
	if (!context) return

	if (selectedCount.value > 0 && !isInstallingSelected.value) {
		const result = await selectedProjectsLeaveModal.value?.prompt()
		await handleSelectedProjectsLeaveResult(result ?? 'cancel', context)
		return
	}

	const shouldNavigate = await context.onBack?.()
	if (shouldNavigate === false) return

	await router.push(context.backUrl)
}

async function handleSelectedProjectsLeaveResult(
	result: SelectedProjectsLeaveResult,
	context: BrowseInstallContext,
) {
	if (result === 'cancel') return
	if (result === 'install') {
		const shouldNavigate = await context.installSelected?.()
		if (shouldNavigate === false) return
		return
	}

	if (context.discardSelectedAndBack) {
		await context.discardSelectedAndBack()
		return
	}

	await (context.clearSelected ?? context.clearQueued)?.()
	await router.push(context.backUrl)
}
</script>

<template>
	<template v-if="installContext">
		<SelectedProjectsLeaveModal
			ref="selectedProjectsLeaveModal"
			:count="selectedCount"
			:installing="isInstallingSelected"
		/>
		<div class="flex flex-col gap-2">
			<div class="flex flex-wrap items-center justify-between gap-4">
				<div class="flex min-w-0 items-center gap-4">
					<ButtonStyled circular size="large">
						<button :aria-label="installContext.backLabel" @click="handleBack">
							<LeftArrowIcon />
						</button>
					</ButtonStyled>

					<Avatar v-if="iconSrc" :src="iconSrc" size="48px" class="shrink-0" />

					<div class="flex min-w-0 flex-col justify-center gap-1">
						<h1 class="m-0 truncate text-2xl font-semibold leading-8 text-contrast">
							{{ installContext.name }}
						</h1>
						<div
							v-if="metadataItems.length"
							class="flex flex-wrap items-center gap-2 text-base font-medium leading-6 text-primary"
						>
							<template v-for="(item, index) in metadataItems" :key="item">
								<span
									v-if="index > 0"
									class="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60"
								/>
								<span>{{ item }}</span>
							</template>
						</div>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<ButtonStyled
						v-if="ctx"
						circular
						size="large"
						:color="isSearchTranslated ? 'brand' : 'standard'"
					>
						<button
							v-tooltip="
								isSearchTranslated
									? formatMessage(messages.showOriginal)
									: formatMessage(messages.translatePage)
							"
							:aria-label="
								isSearchTranslated
									? formatMessage(messages.showOriginal)
									: formatMessage(messages.translatePage)
							"
							:disabled="isSearchTranslating"
							@click="handleToggleSearchTranslation"
						>
							<SpinnerIcon v-if="isSearchTranslating" class="animate-spin size-5" />
							<svg
								v-else
								xmlns="http://www.w3.org/2000/svg"
								width="22"
								height="22"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								class="icon icon-tabler icons-tabler-outline icon-tabler-language-hiragana"
							>
								<path stroke="none" d="M0 0h24v24H0z" fill="none" />
								<path d="M4 5h7" />
								<path d="M7 4c0 4.846 0 7 .5 8" />
								<path d="M10 8.5c0 2.286 -2 4.5 -3.5 4.5s-2.5 -1.135 -2.5 -2c0 -2 1 -3 3 -3s5 .57 5 2.857c0 1.524 -.667 2.571 -2 3.143" />
								<path d="M12 20l4 -9l4 9" />
								<path d="M19.1 18h-6.2" />
							</svg>
						</button>
					</ButtonStyled>
					<slot name="actions" />
				</div>
			</div>
		</div>
		<Admonition v-if="installContext.warning" type="warning" class="mb-1">
			{{ installContext.warning }}
		</Admonition>
	</template>
</template>
