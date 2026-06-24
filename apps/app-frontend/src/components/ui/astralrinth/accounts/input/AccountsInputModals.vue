<script setup lang="ts">
import { Button, defineMessages, useVIntl } from '@modrinth/ui'
import { ref } from 'vue'

import ModalWrapper from '@/components/ui/modal/ModalWrapper.vue'

type ModalHandle = {
	hide: () => void
	show: () => void
}

const props = defineProps<{
	elyByLoginDisabled: boolean
	elyByLoginValue: string
	elyByPassword: string
	elyByTwoFactorCode: string
	offlineLoginDisabled: boolean
	offlinePlayerName: string
}>()

const emit = defineEmits<{
	(event: 'submit-elyby'): void
	(event: 'submit-offline'): void
	(event: 'update:elyByLoginValue', value: string): void
	(event: 'update:elyByPassword', value: string): void
	(event: 'update:elyByTwoFactorCode', value: string): void
	(event: 'update:offlinePlayerName', value: string): void
}>()

const { formatMessage } = useVIntl()

const addOfflineModal = ref<ModalHandle | null>(null)
const addElyByModal = ref<ModalHandle | null>(null)
const requestElyByTwoFactorCodeModal = ref<ModalHandle | null>(null)

const messages = defineMessages({
	addElyByHeader: {
		id: 'astralrinth.app.minecraft-account.input.elyby.header',
		defaultMessage: 'Authenticate with Ely.by',
	},
	requestTwoFactorHeader: {
		id: 'astralrinth.app.minecraft-account.input.elyby.two-factor.header',
		defaultMessage: 'Ely.by requested 2FA code for authentication',
	},
	requestTwoFactorLabel: {
		id: 'astralrinth.app.minecraft-account.input.elyby.two-factor.label',
		defaultMessage: 'Enter your 2FA code',
	},
	requestTwoFactorPlaceholder: {
		id: 'astralrinth.app.minecraft-account.input.elyby.two-factor.placeholder',
		defaultMessage: 'Your 2FA code here...',
	},
	continueAction: {
		id: 'astralrinth.app.minecraft-account.input.elyby.two-factor.continue-action',
		defaultMessage: 'Continue',
	},
	elyByLoginLabel: {
		id: 'astralrinth.app.minecraft-account.input.elyby.login.label',
		defaultMessage: 'Enter your player name or email (preferred)',
	},
	elyByLoginPlaceholder: {
		id: 'astralrinth.app.minecraft-account.input.elyby.login.placeholder',
		defaultMessage: 'Your player name or email here...',
	},
	elyByPasswordLabel: {
		id: 'astralrinth.app.minecraft-account.input.elyby.password.label',
		defaultMessage: 'Enter your password',
	},
	elyByPasswordPlaceholder: {
		id: 'astralrinth.app.minecraft-account.input.elyby.password.placeholder',
		defaultMessage: 'Your password here...',
	},
	loginAction: {
		id: 'astralrinth.app.minecraft-account.input.login-action',
		defaultMessage: 'Login',
	},
	addOfflineHeader: {
		id: 'astralrinth.app.minecraft-account.input.offline.header',
		defaultMessage: 'Add new offline account',
	},
	offlineNameLabel: {
		id: 'astralrinth.app.minecraft-account.input.offline.name.label',
		defaultMessage: 'Enter your player name',
	},
	offlineNamePlaceholder: {
		id: 'astralrinth.app.minecraft-account.input.offline.name.placeholder',
		defaultMessage: 'Your player name here...',
	},
})

defineExpose({
	hideElyBy: () => addElyByModal.value?.hide(),
	hideElyByTwoFactor: () => requestElyByTwoFactorCodeModal.value?.hide(),
	hideOffline: () => addOfflineModal.value?.hide(),
	showElyBy: () => addElyByModal.value?.show(),
	showElyByTwoFactor: () => requestElyByTwoFactorCodeModal.value?.show(),
	showOffline: () => addOfflineModal.value?.show(),
})
</script>

<template>
	<ModalWrapper ref="addElyByModal" class="modal" :header="formatMessage(messages.addElyByHeader)">
		<ModalWrapper
			ref="requestElyByTwoFactorCodeModal"
			class="modal"
			:header="formatMessage(messages.requestTwoFactorHeader)"
		>
			<div class="flex flex-col gap-4 px-6 py-5">
				<label class="label form-label">{{ formatMessage(messages.requestTwoFactorLabel) }}</label>
				<input
					:value="props.elyByTwoFactorCode"
					type="text"
					:placeholder="formatMessage(messages.requestTwoFactorPlaceholder)"
					class="input soft-input"
					@input="
						emit('update:elyByTwoFactorCode', ($event.target as HTMLInputElement).value)
					"
				/>
				<div class="mt-6 ml-auto">
					<Button color="primary" :disabled="props.elyByLoginDisabled" @click="emit('submit-elyby')">
						{{ formatMessage(messages.continueAction) }}
					</Button>
				</div>
			</div>
		</ModalWrapper>
		<div class="flex flex-col gap-4 px-6 py-5">
			<label class="label form-label">{{ formatMessage(messages.elyByLoginLabel) }}</label>
			<input
				:value="props.elyByLoginValue"
				type="text"
				:placeholder="formatMessage(messages.elyByLoginPlaceholder)"
				class="input soft-input"
				@input="emit('update:elyByLoginValue', ($event.target as HTMLInputElement).value)"
			/>
			<label class="label form-label">{{ formatMessage(messages.elyByPasswordLabel) }}</label>
			<input
				:value="props.elyByPassword"
				type="password"
				:placeholder="formatMessage(messages.elyByPasswordPlaceholder)"
				class="input soft-input"
				@input="emit('update:elyByPassword', ($event.target as HTMLInputElement).value)"
			/>
			<div class="mt-6 ml-auto">
				<Button color="primary" :disabled="props.elyByLoginDisabled" @click="emit('submit-elyby')">
					{{ formatMessage(messages.loginAction) }}
				</Button>
			</div>
		</div>
	</ModalWrapper>
	<ModalWrapper
		ref="addOfflineModal"
		class="modal"
		:header="formatMessage(messages.addOfflineHeader)"
	>
		<div class="flex flex-col gap-4 px-6 py-5">
			<label class="label form-label">{{ formatMessage(messages.offlineNameLabel) }}</label>
			<input
				:value="props.offlinePlayerName"
				type="text"
				:placeholder="formatMessage(messages.offlineNamePlaceholder)"
				class="input soft-input"
				@input="emit('update:offlinePlayerName', ($event.target as HTMLInputElement).value)"
			/>
			<div class="mt-6 ml-auto">
				<Button color="primary" :disabled="props.offlineLoginDisabled" @click="emit('submit-offline')">
					{{ formatMessage(messages.loginAction) }}
				</Button>
			</div>
		</div>
	</ModalWrapper>
</template>

<style scoped lang="scss">
@import '../../../../../../../../packages/assets/styles/astralrinth/soft-inputs.scss';

.modal {
	position: absolute;
}
</style>
