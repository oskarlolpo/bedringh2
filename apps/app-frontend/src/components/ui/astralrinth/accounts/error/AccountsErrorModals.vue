<script setup lang="ts">
import { Button, defineMessages, useVIntl } from '@modrinth/ui'
import { ref } from 'vue'

import ModalWrapper from '@/components/ui/modal/ModalWrapper.vue'

type ModalHandle = {
	hide: () => void
	show: () => void
}

defineProps<{
	maxOfflinePlayerNameLength: number
	minOfflinePlayerNameLength: number
	nameExp: string
}>()

const emit = defineEmits<{
	(event: 'retry-elyby'): void
	(event: 'retry-offline'): void
}>()

const { formatMessage } = useVIntl()

const authenticationElyByErrorModal = ref<ModalHandle | null>(null)
const inputElyByErrorModal = ref<ModalHandle | null>(null)
const inputOfflineErrorModal = ref<ModalHandle | null>(null)
const unexpectedErrorModal = ref<ModalHandle | null>(null)

const messages = defineMessages({
	authenticationElyByHeader: {
		id: 'astralrinth.app.minecraft-account.error.authentication-elyby.header',
		defaultMessage: 'Error while proceeding authentication event with Ely.by',
	},
	authenticationElyByDescription: {
		id: 'astralrinth.app.minecraft-account.error.authentication-elyby.description',
		defaultMessage: 'An error occurred while logging in.',
	},
	inputElyByHeader: {
		id: 'astralrinth.app.minecraft-account.error.input-elyby.header',
		defaultMessage: 'Error while proceeding input event with Ely.by',
	},
	inputElyByDescription: {
		id: 'astralrinth.app.minecraft-account.error.input-elyby.description',
		defaultMessage:
			'An error occurred while adding the Ely.by account. Please follow the instructions below.',
	},
	inputElyByNameOrEmailHint: {
		id: 'astralrinth.app.minecraft-account.error.input-elyby.name-or-email-hint',
		defaultMessage: 'Check that you have entered the correct player name or email.',
	},
	inputElyByPasswordHint: {
		id: 'astralrinth.app.minecraft-account.error.input-elyby.password-hint',
		defaultMessage: 'Check that you have entered the correct password.',
	},
	inputOfflineHeader: {
		id: 'astralrinth.app.minecraft-account.error.input-offline.header',
		defaultMessage: 'Error while proceeding input event with offline account',
	},
	inputOfflineDescription: {
		id: 'astralrinth.app.minecraft-account.error.input-offline.description',
		defaultMessage:
			'An error occurred while adding the offline account. Please follow the instructions below.',
	},
	inputOfflineNameHint: {
		id: 'astralrinth.app.minecraft-account.error.input-offline.name-hint',
		defaultMessage: 'Check that you have entered the correct player name.',
	},
	inputOfflineLengthHint: {
		id: 'astralrinth.app.minecraft-account.error.input-offline.length-hint',
		defaultMessage:
			'Player name must be at least {min} characters long and no more than {max} characters.',
	},
	inputOfflineFormatHint: {
		id: 'astralrinth.app.minecraft-account.error.input-offline.format-hint',
		defaultMessage: 'Make sure your name meets the format requirement `{nameExp}`',
	},
	unexpectedHeader: {
		id: 'astralrinth.app.minecraft-account.error.unexpected.header',
		defaultMessage: 'Unexpected error occurred',
	},
	unexpectedDescription: {
		id: 'astralrinth.app.minecraft-account.error.unexpected.description',
		defaultMessage: 'An unexpected error has occurred. Please try again later.',
	},
	retryAction: {
		id: 'astralrinth.app.minecraft-account.error.retry-action',
		defaultMessage: 'Try again',
	},
})

defineExpose({
	hideAuthenticationElyByError: () => authenticationElyByErrorModal.value?.hide(),
	hideInputElyByError: () => inputElyByErrorModal.value?.hide(),
	hideInputOfflineError: () => inputOfflineErrorModal.value?.hide(),
	showAuthenticationElyByError: () => authenticationElyByErrorModal.value?.show(),
	showInputElyByError: () => inputElyByErrorModal.value?.show(),
	showInputOfflineError: () => inputOfflineErrorModal.value?.show(),
	showUnexpectedError: () => unexpectedErrorModal.value?.show(),
})
</script>

<template>
	<ModalWrapper
		ref="authenticationElyByErrorModal"
		class="modal"
		:header="formatMessage(messages.authenticationElyByHeader)"
	>
		<div class="flex flex-col gap-4 px-6 py-5">
			<label class="text-base font-medium text-red-700">
				{{ formatMessage(messages.authenticationElyByDescription) }}
			</label>
			<div class="mt-6 ml-auto">
				<Button color="primary" @click="emit('retry-elyby')">
					{{ formatMessage(messages.retryAction) }}
				</Button>
			</div>
		</div>
	</ModalWrapper>
	<ModalWrapper
		ref="inputElyByErrorModal"
		class="modal"
		:header="formatMessage(messages.inputElyByHeader)"
	>
		<div class="flex flex-col gap-4 px-6 py-5">
			<label class="text-base font-medium text-red-700">
				{{ formatMessage(messages.inputElyByDescription) }}
			</label>
			<ul class="list-disc list-inside text-sm space-y-1">
				<li>{{ formatMessage(messages.inputElyByNameOrEmailHint) }}</li>
				<li>{{ formatMessage(messages.inputElyByPasswordHint) }}</li>
			</ul>
			<div class="mt-6 ml-auto">
				<Button color="primary" @click="emit('retry-elyby')">
					{{ formatMessage(messages.retryAction) }}
				</Button>
			</div>
		</div>
	</ModalWrapper>
	<ModalWrapper
		ref="inputOfflineErrorModal"
		class="modal"
		:header="formatMessage(messages.inputOfflineHeader)"
	>
		<div class="flex flex-col gap-4 px-6 py-5">
			<label class="text-base font-medium text-red-700">
				{{ formatMessage(messages.inputOfflineDescription) }}
			</label>
			<ul class="list-disc list-inside text-sm space-y-1">
				<li>{{ formatMessage(messages.inputOfflineNameHint) }}</li>
				<li>
					{{
						formatMessage(messages.inputOfflineLengthHint, {
							min: minOfflinePlayerNameLength,
							max: maxOfflinePlayerNameLength,
						})
					}}
				</li>
				<li>
					{{ formatMessage(messages.inputOfflineFormatHint, { nameExp }) }}
				</li>
			</ul>
			<div class="mt-6 ml-auto">
				<Button color="primary" @click="emit('retry-offline')">
					{{ formatMessage(messages.retryAction) }}
				</Button>
			</div>
		</div>
	</ModalWrapper>
	<ModalWrapper
		ref="unexpectedErrorModal"
		class="modal"
		:header="formatMessage(messages.unexpectedHeader)"
	>
		<div class="modal-body">
			<label class="label">{{ formatMessage(messages.unexpectedDescription) }}</label>
		</div>
	</ModalWrapper>
</template>

<style scoped lang="scss">
.modal {
	position: absolute;
}

.modal-body {
	display: flex;
	flex-direction: row;
	gap: var(--gap-lg);
	align-items: center;
	padding: var(--gap-xl);
}
</style>
