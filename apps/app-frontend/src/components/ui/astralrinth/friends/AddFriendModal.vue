<script setup lang="ts">
import { SendIcon, UserIcon } from '@modrinth/assets'
import { Button, defineMessages, injectNotificationManager, Input, useVIntl } from '@modrinth/ui'
import { ref } from 'vue'

import ModalWrapper from '@/components/ui/modal/ModalWrapper.vue'
import { sendFriendRequest } from '@/services/bedringh-friends'

const modal = ref<InstanceType<typeof ModalWrapper> | null>(null)
const { addNotification } = injectNotificationManager()
const { formatMessage } = useVIntl()

const username = ref('')
const loading = ref(false)

const messages = defineMessages({
	addingAFriend: {
		id: 'friends.add-friend.title',
		defaultMessage: 'Adding a friend',
	},
	usernameTitle: {
		id: 'bedringh.friends.add-friend.username.title',
		defaultMessage: "What's your friend's Bedringh ID username?",
	},
	usernameDescription: {
		id: 'friends.add-friend.username.description',
		defaultMessage: 'It may be different from their Minecraft username!',
	},
	usernamePlaceholder: {
		id: 'bedringh.friends.add-friend.username.placeholder',
		defaultMessage: 'Enter Bedringh ID username...',
	},
	sendFriendRequest: {
		id: 'friends.add-friend.submit',
		defaultMessage: 'Send friend request',
	},
})

async function addFriendFromModal() {
	const target = username.value.trim()
	if (!target || loading.value) return

	loading.value = true
	try {
		const res = await sendFriendRequest(target)
		addNotification({
			type: 'success',
			title: formatMessage(messages.addingAFriend),
			text: res.message || `Friend request to ${target} sent successfully`,
		})
		modal.value?.hide()
		username.value = ''
	} catch (e: any) {
		addNotification({
			type: 'error',
			title: 'Error',
			text: e?.message || 'Failed to send friend request',
		})
	} finally {
		loading.value = false
	}
}

function show() {
	username.value = ''
	modal.value?.show()
}

function hide() {
	modal.value?.hide()
}

defineExpose({ show, hide })
</script>

<template>
	<ModalWrapper ref="modal" :header="formatMessage(messages.addingAFriend)">
		<div class="min-w-[30rem]">
			<h2 class="m-0 text-base font-medium text-primary">
				{{ formatMessage(messages.usernameTitle) }}
			</h2>
			<p class="m-0 mt-1 text-sm text-secondary leading-tight">
				{{ formatMessage(messages.usernameDescription) }}
			</p>
			<div class="flex items-center gap-2 mt-4">
				<Input
					v-model="username"
					:icon="UserIcon"
					type="text"
					:placeholder="formatMessage(messages.usernamePlaceholder)"
					wrapper-class="flex-1"
					:disabled="loading"
					@keyup.enter="addFriendFromModal"
				/>
				<Button
					type="colored"
					color="brand"
					:disabled="username.trim().length === 0 || loading"
					@click="addFriendFromModal"
				>
					<SendIcon />
					{{ formatMessage(messages.sendFriendRequest) }}
				</Button>
			</div>
		</div>
	</ModalWrapper>
</template>
