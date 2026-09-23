<template>
	<NewModal ref="modal" :header="formatMessage(messages.header)" fade="danger" max-width="500px">
		<div class="flex flex-col gap-6">
			<Admonition type="critical" :header="formatMessage(messages.admonitionHeader)">
				{{ formatMessage(messages.admonitionBody) }}
			</Admonition>

			<div v-if="server" class="flex min-w-0 flex-col gap-2">
				<span class="font-semibold text-contrast">
					{{ formatMessage(messages.serverLabel) }}
				</span>
				<div
					class="flex min-w-0 items-center gap-3 rounded-[20px] border border-solid border-transparent bg-surface-2 p-3.5"
				>
					<div
						class="size-11 rounded-xl bg-surface-4 overflow-hidden shrink-0 flex items-center justify-center border border-solid border-surface-5"
					>
						<img
							v-if="server.iconUrl"
							:src="server.iconUrl"
							:alt="server.name"
							class="w-full h-full object-cover"
						/>
						<ServerStackIcon v-else class="size-6 text-brand" />
					</div>
					<div class="flex min-w-0 flex-col gap-1">
						<span class="min-w-0 truncate font-bold text-contrast text-base">
							{{ server.name }}
						</span>
						<span class="truncate text-xs font-medium text-secondary">
							<span class="capitalize font-semibold text-contrast">{{ server.core }}</span>
							<span class="ml-1">{{ server.gameVersion }}</span>
							<span class="mx-1">&bull;</span>
							<span>порт: {{ server.port }}</span>
						</span>
					</div>
				</div>
			</div>
		</div>

		<template #actions>
			<div class="flex gap-2 justify-end">
				<Button type="outlined" :disabled="deleting" @click="modal?.hide()">
					<XIcon />
					{{ formatMessage(commonMessages.cancelButton) }}
				</Button>
				<Button type="colored" color="red" :loading="deleting" @click="confirm">
					<TrashIcon />
					{{ formatMessage(messages.deleteButton) }}
				</Button>
			</div>
		</template>
	</NewModal>
</template>

<script setup lang="ts">
import { ServerStackIcon, TrashIcon, XIcon } from '@modrinth/assets'
import {
	Admonition,
	Button,
	commonMessages,
	defineMessages,
	injectNotificationManager,
	NewModal,
	useVIntl,
} from '@modrinth/ui'
import { ref } from 'vue'

import { type LocalServer, useLocalServers } from '@/providers/local-servers'

const { formatMessage } = useVIntl()
const { addNotification } = injectNotificationManager()
const { removeServer } = useLocalServers()

const messages = defineMessages({
	header: {
		id: 'app.server.confirm-delete.header',
		defaultMessage: 'Удалить сервер',
	},
	admonitionHeader: {
		id: 'app.server.confirm-delete.admonition-header',
		defaultMessage: 'Это действие необратимо',
	},
	admonitionBody: {
		id: 'app.server.confirm-delete.admonition-body',
		defaultMessage:
			'Все данные сервера будут безвозвратно удалены с диска, включая миры, плагины, моды, конфигурации и сохранения игроков.',
	},
	serverLabel: {
		id: 'app.server.confirm-delete.server-label',
		defaultMessage: 'Сервер для удаления',
	},
	deleteButton: {
		id: 'app.server.confirm-delete.delete-button',
		defaultMessage: 'Удалить сервер с диска',
	},
})

const emit = defineEmits<{
	(e: 'deleted', serverId: string): void
}>()

const modal = ref<InstanceType<typeof NewModal>>()
const server = ref<LocalServer | null>(null)
const deleting = ref(false)

function show(targetServer: LocalServer) {
	server.value = targetServer
	modal.value?.show()
}

async function confirm() {
	if (!server.value) return
	const s = server.value
	deleting.value = true
	try {
		await removeServer(s.id, true)
		modal.value?.hide()
		emit('deleted', s.id)
		addNotification({
			title: s.name,
			text: 'Сервер и все файлы успешно удалены с диска.',
			type: 'info',
		})
	} catch (e) {
		console.error('Failed to remove server:', e)
		addNotification({
			title: 'Ошибка удаления',
			text: e instanceof Error ? e.message : String(e),
			type: 'error',
		})
	} finally {
		deleting.value = false
	}
}

defineExpose({
	show,
})
</script>
