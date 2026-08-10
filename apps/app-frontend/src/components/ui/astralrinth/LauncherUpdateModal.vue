<script setup lang="ts">
import { Button, Combobox, defineMessages, useVIntl } from '@modrinth/ui'
import { computed, ref, watch } from 'vue'

import ModalWrapper from '@/components/ui/modal/ModalWrapper.vue'
import {
	downloadLatestRelease,
	getAvailableInstallers,
	isUpdateInstalling,
	LAUNCHER_RELEASES_URL,
	LAUNCHER_REPOSITORY_URL,
	latestLauncherReleases,
} from '@/helpers/astralrinth/update'

type ModalHandle = {
	hide: () => void
	show: () => void
}

const props = defineProps<{
	version: string
}>()

const { formatMessage } = useVIntl()

const updateModalView = ref<ModalHandle | null>(null)
const updateRequestFailView = ref<ModalHandle | null>(null)
const selectedInstallerName = ref<string | null>(null)

const releaseTag = computed(() => latestLauncherReleases.value?.tag_name ?? '')
const releaseTitle = computed(() => latestLauncherReleases.value?.name ?? '')
const availableInstallers = computed(() => getAvailableInstallers())
const selectedInstaller = computed(
	() =>
		availableInstallers.value.find((installer) => installer.name === selectedInstallerName.value) ??
		null,
)
const selectedInstallerUrl = computed(() => selectedInstaller.value?.browser_download_url ?? null)

const messages = defineMessages({
	updateHeader: {
		id: 'astralrinth.app.launcher-update-modal.update.header',
		defaultMessage: 'AstralRinth launcher update',
	},
	updateTitle: {
		id: 'astralrinth.app.launcher-update-modal.update.title',
		defaultMessage: 'A new version of the AstralRinth launcher is available.',
	},
	updateDescription: {
		id: 'astralrinth.app.launcher-update-modal.update.description',
		defaultMessage:
			'You are using an older version. We recommend updating now for the latest fixes and improvements.',
	},
	updateNoticeTitle: {
		id: 'astralrinth.app.launcher-update-modal.update.notice-title',
		defaultMessage: '⚠️ Before you continue',
	},
	updateNoticeLead: {
		id: 'astralrinth.app.launcher-update-modal.update.notice-lead',
		defaultMessage:
			'Save your work, close all running launcher instances, and back up your launcher data before installing the update.',
	},
	updateNoticeWindows: {
		id: 'astralrinth.app.launcher-update-modal.update.notice-windows',
		defaultMessage: 'On Windows, important data may be stored in',
	},
	updateNoticeMacos: {
		id: 'astralrinth.app.launcher-update-modal.update.notice-macos',
		defaultMessage: 'On macOS, important data may be stored in',
	},
	updateNoticeOutro: {
		id: 'astralrinth.app.launcher-update-modal.update.notice-outro',
		defaultMessage: 'To avoid data loss, keep a backup copy in a safe place before continuing.',
	},
	installerTitle: {
		id: 'astralrinth.app.launcher-update-modal.update.installer-title',
		defaultMessage: 'Installer type',
	},
	installerDescription: {
		id: 'astralrinth.app.launcher-update-modal.update.installer-description',
		defaultMessage: 'Choose the installer package you want to continue with.',
	},
	selectInstaller: {
		id: 'astralrinth.app.launcher-update-modal.update.select-installer',
		defaultMessage: 'Select an installer',
	},
	latestReleaseTag: {
		id: 'astralrinth.app.launcher-update-modal.update.latest-release-tag',
		defaultMessage: '☁️ Latest release tag:',
	},
	latestReleaseTitle: {
		id: 'astralrinth.app.launcher-update-modal.update.latest-release-title',
		defaultMessage: '☁️ Latest release title:',
	},
	installedVersion: {
		id: 'astralrinth.app.launcher-update-modal.update.installed-version',
		defaultMessage: '💾 Installed & Running version:',
	},
	repositoryLink: {
		id: 'astralrinth.app.launcher-update-modal.update.repository-link',
		defaultMessage: 'Open the project repository',
	},
	cancelAction: {
		id: 'astralrinth.app.launcher-update-modal.update.cancel-action',
		defaultMessage: 'Cancel',
	},
	downloadAction: {
		id: 'astralrinth.app.launcher-update-modal.update.download-action',
		defaultMessage: 'Download update',
	},
	errorHeader: {
		id: 'astralrinth.app.launcher-update-modal.error.header',
		defaultMessage: 'Could not download the update',
	},
	errorTitle: {
		id: 'astralrinth.app.launcher-update-modal.error.title',
		defaultMessage: 'Download failed',
	},
	errorDescription: {
		id: 'astralrinth.app.launcher-update-modal.error.description',
		defaultMessage: 'AstralRinth could not download the update file from the server.',
	},
	errorHelpText: {
		id: 'astralrinth.app.launcher-update-modal.error.help-text',
		defaultMessage: 'You can try downloading it manually from',
	},
	errorHelpLink: {
		id: 'astralrinth.app.launcher-update-modal.error.help-link',
		defaultMessage: 'AstralRinth repository releases',
	},
	errorHelpSuffix: {
		id: 'astralrinth.app.launcher-update-modal.error.help-suffix',
		defaultMessage: 'if a newer release is available there.',
	},
	localVersion: {
		id: 'astralrinth.app.launcher-update-modal.error.local-version',
		defaultMessage: 'Local AstralRinth:',
	},
	closeAction: {
		id: 'astralrinth.app.launcher-update-modal.error.close-action',
		defaultMessage: 'Close',
	},
})

watch(
	availableInstallers,
	(installers) => {
		const hasSelectedInstaller = installers.some(
			(installer) => installer.name === selectedInstallerName.value,
		)

		if (hasSelectedInstaller) {
			return
		}

		selectedInstallerName.value = installers.length === 1 ? installers[0].name : null
	},
	{ immediate: true },
)

async function show() {
	updateModalView.value?.show()
}

async function initDownload() {
	updateModalView.value?.hide()
	const result = await downloadLatestRelease(selectedInstaller.value)

	if (!result) {
		updateRequestFailView.value?.show()
	}
}

defineExpose({
	show,
	hide: () => updateModalView.value?.hide(),
})
</script>

<template>
	<ModalWrapper
		ref="updateModalView"
		:has-to-type="false"
		:header="formatMessage(messages.updateHeader)"
	>
		<div class="space-y-3 pb-16">
			<div class="space-y-1 rounded-2xl border border-solid border-[rgba(255,255,255,0.12)] p-3">
				<p class="m-0 text-base">
					<strong>{{ formatMessage(messages.updateTitle) }}</strong>
				</p>
				<p class="m-0 text-secondary">{{ formatMessage(messages.updateDescription) }}</p>
			</div>

			<div
				class="space-y-2 rounded-2xl border border-solid border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] p-3"
			>
				<div class="space-y-2">
					<p class="m-0">
						<strong class="neon-text">{{ formatMessage(messages.updateNoticeTitle) }}</strong>
					</p>
					<p class="m-0 text-secondary text-sm">{{ formatMessage(messages.updateNoticeLead) }}</p>
					<p class="m-0 text-sm">
						{{ formatMessage(messages.updateNoticeWindows) }}
						<code class="neon-text">%appdata%\Roaming\AstralRinthApp</code>
					</p>
					<p class="m-0 text-sm">
						{{ formatMessage(messages.updateNoticeMacos) }}
						<code class="neon-text">~/Library/Application Support/AstralRinthApp</code>
					</p>
					<p class="m-0 text-sm">{{ formatMessage(messages.updateNoticeOutro) }}</p>
				</div>
			</div>

			<div
				class="space-y-2 rounded-2xl border border-solid border-[rgba(255,255,255,0.12)] p-3 text-sm text-secondary"
			>
				<p class="m-0">
					<strong>{{ formatMessage(messages.latestReleaseTag) }}</strong>
					<span class="neon-text">{{ releaseTag }}</span>
					<br />
					<strong>{{ formatMessage(messages.latestReleaseTitle) }}</strong>
					<span class="neon-text">{{ releaseTitle }}</span>
					<br />
					<strong>{{ formatMessage(messages.installedVersion) }}</strong>
					<span class="neon-text">v{{ props.version }}</span>
				</p>
				<a
					class="inline-flex neon-text"
					:href="LAUNCHER_REPOSITORY_URL"
					target="_blank"
					rel="noopener noreferrer"
				>
					{{ formatMessage(messages.repositoryLink) }}
				</a>
			</div>

			<div class="space-y-2 rounded-2xl border border-solid border-[rgba(255,255,255,0.12)] p-3">
				<div>
					<p class="m-0 text-base">
						<strong>{{ formatMessage(messages.installerTitle) }}</strong>
					</p>
					<p class="m-0 text-secondary text-sm">
						{{ formatMessage(messages.installerDescription) }}
					</p>
				</div>
				<Combobox
					v-model="selectedInstallerName"
					name="AstralRinth launcher installer"
					:options="
						availableInstallers.map((installer) => ({
							value: installer.name,
							label: installer.name,
						}))
					"
					:display-value="selectedInstallerName ?? formatMessage(messages.selectInstaller)"
				/>
			</div>

			<div class="absolute bottom-4 right-4 flex items-center gap-4 neon-button neon">
				<Button class="bordered" @click="updateModalView?.hide()">
					{{ formatMessage(messages.cancelAction) }}
				</Button>
				<Button
					class="bordered"
					:disabled="isUpdateInstalling || !selectedInstallerUrl"
					@click="initDownload()"
				>
					{{ formatMessage(messages.downloadAction) }}
				</Button>
			</div>
		</div>
	</ModalWrapper>

	<ModalWrapper
		ref="updateRequestFailView"
		:has-to-type="false"
		:header="formatMessage(messages.errorHeader)"
	>
		<div class="space-y-3 pb-16">
			<div class="space-y-2 rounded-2xl border border-solid border-[rgba(255,255,255,0.12)] p-3">
				<p>
					<strong>{{ formatMessage(messages.errorTitle) }}</strong>
				</p>
				<p class="m-0 text-secondary">{{ formatMessage(messages.errorDescription) }}</p>
				<p class="m-0 text-sm">
					{{ formatMessage(messages.errorHelpText) }}
					<a
						class="neon-text"
						:href="LAUNCHER_RELEASES_URL"
						target="_blank"
						rel="noopener noreferrer"
					>
						{{ formatMessage(messages.errorHelpLink) }}
					</a>
					{{ formatMessage(messages.errorHelpSuffix) }}
				</p>
			</div>

			<div
				class="rounded-2xl border border-solid border-[rgba(255,255,255,0.12)] p-3 text-sm text-secondary"
			>
				<p class="m-0">
					<strong>{{ formatMessage(messages.localVersion) }}</strong>
					<span class="neon-text">v{{ props.version }}</span>
				</p>
			</div>

			<div class="absolute bottom-4 right-4 flex items-center gap-4 neon-button neon">
				<Button class="bordered" @click="updateRequestFailView?.hide()">
					{{ formatMessage(messages.closeAction) }}
				</Button>
			</div>
		</div>
	</ModalWrapper>
</template>

<style lang="scss" scoped>
@import '../../../../../../packages/assets/styles/astralrinth/neon-button.scss';
@import '../../../../../../packages/assets/styles/astralrinth/neon-text.scss';
</style>
