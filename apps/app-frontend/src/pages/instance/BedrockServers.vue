<template>
	<div class="p-6">
		<div class="flex items-center justify-between mb-6">
			<h1 class="text-2xl font-bold m-0">Favorite Servers</h1>
			<ButtonStyled color="brand">
				<button @click="addModal?.show()">
					<PlusIcon /> Add Server
				</button>
			</ButtonStyled>
		</div>

		<div v-if="loading" class="flex justify-center p-12">
			<ProgressSpinner />
		</div>
		<div v-else-if="favoriteServers.length === 0" class="text-center py-12 text-surface-4 font-medium text-lg">
			No favorite servers added yet.
		</div>
		<div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			<div v-for="server in favoriteServers" :key="server.id" class="bg-surface-0 border-[1px] border-surface-2 rounded-lg p-4 flex flex-col gap-2 relative group">
				<div class="flex items-center justify-between">
					<h3 class="text-lg font-bold m-0 truncate pr-8">{{ server.name }}</h3>
					<div class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
						<ButtonStyled type="transparent" color="red" circular size="small">
							<button v-tooltip="'Remove server'" @click="removeServer(server.id)">
								<TrashIcon />
							</button>
						</ButtonStyled>
					</div>
				</div>
				<div class="flex flex-col gap-1 text-sm text-surface-4">
					<div class="flex items-center gap-2">
						<GlobeIcon class="w-4 h-4 shrink-0" />
						<span class="truncate">{{ server.address }}</span>
					</div>
					<div class="flex items-center gap-2">
						<HashIcon class="w-4 h-4 shrink-0" />
						<span>{{ server.port }}</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Add Server Modal -->
		<NewModal ref="addModal" header="Add Favorite Server" max-width="500px">
			<div class="flex flex-col gap-4">
				<StyledInput v-model="newServer.name" label="Server Name" placeholder="My Awesome Server" />
				<StyledInput v-model="newServer.address" label="Server Address" placeholder="play.example.com" />
				<StyledInput v-model="newServer.port" label="Port" placeholder="19132" />
			</div>
			<div class="flex justify-end gap-2 mt-6">
				<ButtonStyled>
					<button @click="addModal?.hide()">Cancel</button>
				</ButtonStyled>
				<ButtonStyled color="brand">
					<button :disabled="!newServer.name || !newServer.address" @click="addServer">Save</button>
				</ButtonStyled>
			</div>
		</NewModal>
	</div>
</template>

<script setup lang="ts">
import { GlobeIcon, HashIcon,PlusIcon, TrashIcon } from '@modrinth/assets'
import { ButtonStyled, injectNotificationManager,NewModal, ProgressSpinner, StyledInput } from '@modrinth/ui'
import { invoke } from '@tauri-apps/api/core'
import { onMounted,ref } from 'vue'

const { handleError, addNotification } = injectNotificationManager()
const favoriteServers = ref([])
const loading = ref(true)

const addModal = ref<InstanceType<typeof NewModal> | null>(null)
const newServer = ref({ name: '', address: '', port: '19132' })

async function fetchServers() {
	loading.value = true
	try {
		favoriteServers.value = await invoke('plugin:bedrock-servers|list_favorite_servers')
	} catch (e) {
		handleError(e as Error)
	} finally {
		loading.value = false
	}
}

async function addServer() {
	if (!newServer.value.name || !newServer.value.address) return
	
	try {
		await invoke('plugin:bedrock-servers|add_favorite_server', {
			server: {
				id: Date.now().toString(),
				name: newServer.value.name,
				address: newServer.value.address,
				port: parseInt(newServer.value.port) || 19132,
				instanceId: null
			}
		})
		
		addModal.value?.hide()
		newServer.value = { name: '', address: '', port: '19132' }
		await fetchServers()
		addNotification({ title: 'Server added', type: 'success' })
	} catch (e) {
		handleError(e as Error)
	}
}

async function removeServer(id: string) {
	try {
		await invoke('plugin:bedrock-servers|remove_favorite_server', { id })
		await fetchServers()
		addNotification({ title: 'Server removed', type: 'success' })
	} catch (e) {
		handleError(e as Error)
	}
}

onMounted(() => {
	fetchServers()
})
</script>
