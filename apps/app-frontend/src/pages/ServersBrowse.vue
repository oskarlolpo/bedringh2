<script setup lang="ts">
import {
	GlobeIcon,
	NoSignalIcon,
	PlugIcon,
	ServerPlusIcon,
	SignalIcon,
	UsersIcon,
} from '@modrinth/assets'
import { Avatar, ButtonStyled, defineMessages, TagItem, useVIntl } from '@modrinth/ui'
import { getPingLevel } from '@modrinth/utils'
import { computed, ref } from 'vue'

import CreateHostModal from './CreateHostModal.vue'

interface HostedServer {
	id: string
	name: string
	motdHtml: string
	edition: 'java' | 'bedrock'
	host: string
	hostAvatar?: string
	players: number
	maxPlayers: number
	ping: number | null
	region: string
}

const { formatMessage } = useVIntl()
const messages = defineMessages({
	title: { id: 'servers.browse.title', defaultMessage: 'Minecraft Servers' },
	subtitle: { id: 'servers.browse.create_banner_desc', defaultMessage: 'Play with friends or discover community servers' },
	createBtn: { id: 'servers.list.create_btn', defaultMessage: 'Create Server' },
	filterAll: { id: 'app.common.all', defaultMessage: 'All' },
	connect: { id: 'server.view.action.start', defaultMessage: 'Connect' },
	offline: { id: 'server.view.metric.stopped', defaultMessage: 'Offline' },
	empty: { id: 'servers.list.empty_title', defaultMessage: 'No servers currently available' },
})

const MOCK_SERVERS: HostedServer[] = [
	{
		id: '1',
		name: 'Survival SMP',
		motdHtml:
			'<span style="color:#55FF55">Vanilla + Friends</span> <span style="color:#AAAAAA">•</span> <span style="color:#FFFF55">Season 3</span>',
		edition: 'java',
		host: 'oskarlolpo',
		players: 3,
		maxPlayers: 8,
		ping: 46,
		region: 'EU Central',
	},
	{
		id: '2',
		name: 'Bedrock Crossplay',
		motdHtml:
			'<span style="color:#55FFFF">Crossplay enabled</span> <span style="color:#FFFFFF">Join via PC or Mobile</span>',
		edition: 'bedrock',
		host: 'kama_survivor',
		players: 5,
		maxPlayers: 10,
		ping: 88,
		region: 'EU Central',
	},
]

const servers = ref<HostedServer[]>(MOCK_SERVERS)

type EditionFilter = 'all' | 'java' | 'bedrock'
const activeFilter = ref<EditionFilter>('all')

const filters = computed(() => [
	{ value: 'all' as EditionFilter, label: formatMessage(messages.filterAll) },
	{ value: 'java' as EditionFilter, label: 'Java' },
	{ value: 'bedrock' as EditionFilter, label: 'Bedrock' },
])

const filteredServers = computed(() =>
	activeFilter.value === 'all'
		? servers.value
		: servers.value.filter((s) => s.edition === activeFilter.value),
)

function editionLabel(edition: HostedServer['edition']) {
	return edition === 'java' ? 'Java' : 'Bedrock'
}

function editionColorVar(edition: HostedServer['edition']) {
	return edition === 'java' ? 'var(--color-green)' : 'var(--color-blue)'
}

const createHostModal = ref<InstanceType<typeof CreateHostModal> | null>(null)

function openCreateHostModal() {
	createHostModal.value?.show()
}

function handleConnect(server: HostedServer) {
	console.log('[servers] connect ->', server.id)
}
</script>

<template>
	<div class="flex flex-col gap-4 p-6 max-w-[1100px] mx-auto w-full">
		<!-- Заголовок вкладки -->
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div class="flex flex-col gap-1">
				<h1 class="m-0 text-2xl font-extrabold text-contrast flex items-center gap-2">
					{{ formatMessage(messages.title) }}
				</h1>
				<p class="m-0 text-sm text-secondary max-w-[520px] leading-relaxed">
					{{ formatMessage(messages.subtitle) }}
				</p>
			</div>
			<ButtonStyled color="brand" size="large">
				<button type="button" @click="openCreateHostModal">
					<ServerPlusIcon aria-hidden="true" />
					{{ formatMessage(messages.createBtn) }}
				</button>
			</ButtonStyled>
		</div>

		<!-- Фильтр по редакции -->
		<div class="flex items-center gap-1 p-1 bg-bg-raised rounded-xl w-fit border border-solid border-surface-4">
			<button
				v-for="f in filters"
				:key="f.value"
				type="button"
				class="px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors border-none cursor-pointer"
				:class="
					activeFilter === f.value
						? 'bg-bg-super-raised text-contrast shadow-sm'
						: 'bg-transparent text-secondary hover:text-primary'
				"
				@click="activeFilter = f.value"
			>
				{{ f.label }}
			</button>
		</div>

		<!-- Список серверов -->
		<div class="flex flex-col gap-2">
			<div
				v-for="server in filteredServers"
				:key="server.id"
				class="grid grid-cols-[auto_minmax(0,2.2fr)_minmax(0,2fr)_auto_auto] items-center gap-3 p-3 bg-bg-raised card-shadow rounded-xl border border-solid border-transparent transition-colors hover:border-surface-5"
			>
				<!-- Иконка/аватар хоста -->
				<Avatar :src="server.hostAvatar" size="48px" :tint-by="server.id" />

				<!-- Название + автор + бейдж редакции -->
				<div class="flex flex-col gap-1 min-w-0">
					<div class="flex items-center gap-2 min-w-0">
						<span class="text-base font-bold text-contrast truncate">{{ server.name }}</span>
						<TagItem :style="`--_color:#fff; --_bg-color:${editionColorVar(server.edition)}`">
							{{ editionLabel(server.edition) }}
						</TagItem>
					</div>
					<div class="text-sm text-secondary flex items-center gap-1 truncate">
						<span>{{ server.host }}</span>
					</div>
				</div>

				<!-- MOTD -->
				<div class="min-w-0 hidden md:block">
					<div
						class="font-minecraft text-sm leading-5 line-clamp-2"
						v-html="server.motdHtml"
					/>
				</div>

				<!-- Пинг + игроки -->
				<div class="flex flex-col items-end gap-1 text-sm font-semibold shrink-0">
					<div
						v-if="server.ping !== null"
						class="flex items-center gap-1 text-secondary cursor-help"
					>
						<SignalIcon
							aria-hidden="true"
							:style="`--_signal-${getPingLevel(server.ping)}: var(--color-green)`"
							stroke-width="3px"
							class="h-4 w-4 shrink-0"
						/>
						{{ server.ping }} ms
					</div>
					<div v-else class="flex items-center gap-1 text-secondary">
						<NoSignalIcon aria-hidden="true" stroke-width="3px" class="h-4 w-4 shrink-0" />
						{{ formatMessage(messages.offline) }}
					</div>
					<div class="flex items-center gap-1 text-secondary font-normal">
						<UsersIcon aria-hidden="true" class="h-3.5 w-3.5 shrink-0" />
						{{ server.players }}/{{ server.maxPlayers }}
					</div>
				</div>

				<!-- Кнопка подключения -->
				<ButtonStyled color="brand">
					<button type="button" :disabled="server.ping === null" @click="handleConnect(server)">
						<PlugIcon aria-hidden="true" />
						{{ formatMessage(messages.connect) }}
					</button>
				</ButtonStyled>
			</div>

			<!-- Пустое состояние -->
			<div
				v-if="filteredServers.length === 0"
				class="flex flex-col items-center gap-3 py-16 text-center text-secondary"
			>
				<GlobeIcon aria-hidden="true" class="h-10 w-10 opacity-50" />
				<p class="m-0">{{ formatMessage(messages.empty) }}</p>
			</div>
		</div>
	</div>

	<CreateHostModal ref="createHostModal" />
</template>
