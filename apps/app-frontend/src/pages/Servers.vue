<script setup lang="ts">
import {
	CheckIcon,
	FilterIcon,
	GlobeIcon,
	PlugIcon,
	PlusIcon,
	RefreshCwIcon,
	SearchIcon,
	ServerStackIcon,
	TrashIcon,
	UsersIcon,
	XIcon,
} from '@modrinth/assets'
import {
	Button,
	ButtonStyled,
	defineMessages,
	IconButton,
	injectNotificationManager,
	ProjectCard,
	ProjectCardList,
	StyledInput,
	useVIntl,
} from '@modrinth/ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import CreateHostModal, { SERVER_CATEGORIES } from './CreateHostModal.vue'
import { useRootBreadcrumb } from '@/providers/breadcrumbs'
import { useLocalServers } from '@/providers/local-servers'
import { setPendingPlayInvite, useBedringhFriends } from '@/services/bedringh-friends'
import {
	fetchLobbyServers,
	type LobbyHostData,
	publishHostLeave,
	startHostHeartbeat,
	stopHostHeartbeat,
	subscribeLobbySSE,
} from '@/services/bedringh-lobby'
import { useBedringhAccount } from '@/composables/use-bedringh-account'
import { formatSafeConnectAddress } from '@/services/bedringh-network-config'
import { getActiveBedringhUser } from '@/services/bedringh-settings-sync'
import { connectClientBridge, probeLocalPortOpen } from '@/services/bedringh-tunnel'

export interface HostedServer {
	id: string
	name: string
	iconUrl?: string
	motdHtml?: string
	edition: 'java' | 'bedrock'
	version: string
	address: string
	host: string
	isMyHost?: boolean
	localPort?: number
	publicPort?: number
	tunnelConnected?: boolean
	players: number
	maxPlayers: number
	ping: number | null
	region: string
	categories?: string[]
	createdAt?: number
}

const { formatMessage } = useVIntl()
const { addNotification } = injectNotificationManager()
const { servers: localServers } = useLocalServers()
const { state: socialState } = useBedringhFriends()

const messages = defineMessages({
	breadcrumb: { id: 'app.nav.servers-menu', defaultMessage: 'Серверы' },
	title: { id: 'servers.browse.title', defaultMessage: 'Серверы' },
	subtitle: {
		id: 'servers.browse.subtitle',
		defaultMessage:
			'Список общих серверов, хостящихся через Bedringh Хостинг. Играйте вместе без пробития портов.',
	},
	createBtn: { id: 'servers.list.create_host_btn', defaultMessage: 'Создать хост' },
	filterAll: { id: 'app.common.all', defaultMessage: 'Все' },
	filterMyHosts: { id: 'servers.filter.my_hosts', defaultMessage: 'Мои хосты' },
	connect: { id: 'server.view.action.connect', defaultMessage: 'Подключиться' },
	copied: { id: 'server.view.action.copied', defaultMessage: 'Скопировано!' },
	offline: { id: 'server.view.metric.stopped', defaultMessage: 'Офлайн' },
	emptyTitle: { id: 'servers.list.empty_title', defaultMessage: 'Серверы не найдены' },
	emptyDesc: {
		id: 'servers.list.empty_desc',
		defaultMessage: 'Пока никто не хостит серверы по вашему запросу. Создайте первый хост!',
	},
})

useRootBreadcrumb({
	slot: 'root',
	id: 'servers',
	label: formatMessage(messages.breadcrumb),
	to: '/hosting/manage/',
	visual: { type: 'icon', component: ServerStackIcon },
})

const STORAGE_HOSTS_KEY = 'bedringh_hosted_servers_v1'

const createHostModalRef = ref<InstanceType<typeof CreateHostModal> | null>(null)
const searchQuery = ref('')
type FilterType = 'all' | 'java' | 'bedrock' | 'my'
const activeFilter = ref<FilterType>('all')
const userHosts = ref<HostedServer[]>([])
const remoteLobbyServers = ref<HostedServer[]>([])
const copiedId = ref<string | null>(null)
const isRefreshing = ref(false)
let sseUnsubscribe: (() => void) | null = null

const { bedringhAccount } = useBedringhAccount()

const myRunningLocalServers = computed<HostedServer[]>(() => {
	const hostName = bedringhAccount.value?.username || getActiveBedringhUser()?.username || 'Вы'
	return localServers.value
		.filter((s) => s.status === 'running')
		.map((s) => ({
			id: s.id,
			name: s.name,
			iconUrl: s.iconUrl,
			motdHtml:
				s.motd || `<span style="color:#55FF55">Сервер ${s.core.toUpperCase()} ${s.gameVersion}</span>`,
			edition: 'java' as const,
			version: s.gameVersion || '1.21.4',
			address: s.publicAddress || formatSafeConnectAddress(s.publicPort || s.port || 25565),
			host: hostName,
			isMyHost: true,
			localPort: s.port || 25565,
			publicPort: s.publicPort,
			players: Math.max(1, s.players || 1),
			maxPlayers: s.maxPlayers || 20,
			ping: 28,
			region: 'Bedringh Relay RU',
			categories: s.core === 'vanilla' ? ['survival', 'vanilla'] : ['survival', 'mods'],
			createdAt: s.createdAt,
		}))
})

function loadUserHosts(): HostedServer[] {
	try {
		const raw = localStorage.getItem(STORAGE_HOSTS_KEY)
		if (raw) {
			const parsed = JSON.parse(raw)
			if (Array.isArray(parsed)) {
				return parsed.map((h: HostedServer) => ({
					...h,
					address: formatSafeConnectAddress(
						h.publicPort || h.localPort || h.address?.split(':')[1] || 25565,
					),
				}))
			}
		}
	} catch (e) {
		console.warn('Failed to load user hosts', e)
	}
	return []
}

function saveUserHosts() {
	try {
		localStorage.setItem(STORAGE_HOSTS_KEY, JSON.stringify(userHosts.value))
	} catch (e) {
		console.warn('Failed to save user hosts', e)
	}
}

function handleAutoCloseLocalHost(closedId: string) {
	const existing = userHosts.value.find((h) => h.id === closedId)
	if (!existing) return
	userHosts.value = userHosts.value.filter((h) => h.id !== closedId)
	saveUserHosts()
	addNotification({
		title: existing.name,
		text: 'Вы вышли из мира — хост и туннель автоматически закрыты',
		type: 'info',
	})
}

async function pruneClosedLocalHosts() {
	const aliveHosts: HostedServer[] = []
	let changed = false

	for (const host of userHosts.value) {
		if (host.edition === 'java' && host.localPort) {
			const isOpen = await probeLocalPortOpen(host.localPort)
			if (!isOpen) {
				stopHostHeartbeat(host.id)
				void publishHostLeave(host.id)
				changed = true
				continue
			}
		}
		aliveHosts.push(host)
	}

	if (changed) {
		userHosts.value = aliveHosts
		saveUserHosts()
	}
}

async function refreshLobby() {
	try {
		const remote = await fetchLobbyServers()
		// Исключаем свои собственные хосты и локальные серверы из удалённого списка (чтобы не дублировались)
		const myIds = new Set([
			...userHosts.value.map((h) => h.id),
			...localServers.value.map((s) => s.id),
		])
		remoteLobbyServers.value = remote
			.filter((r) => !myIds.has(r.id))
			.map((r) => ({
				...r,
				isMyHost: false,
			}))
	} catch (e) {
		console.warn('[Bedringh Servers] Ошибка обновления лобби:', e)
	}
}

async function handleRefreshCatalog() {
	if (isRefreshing.value) return
	isRefreshing.value = true
	try {
		await pruneClosedLocalHosts()
		await refreshLobby()
	} finally {
		setTimeout(() => {
			isRefreshing.value = false
		}, 350)
	}
}

onMounted(async () => {
	userHosts.value = loadUserHosts()
	// Сначала очищаем старые хосты, из которых игрок уже вышел
	await pruneClosedLocalHosts()

	// Запускаем туннель и heartbeat только для реально открытых хостов
	for (const host of userHosts.value) {
		void startHostHeartbeat(
			host,
			() => saveUserHosts(),
			(closedId) => handleAutoCloseLocalHost(closedId),
		)
	}
	// И для всех запущенных локальных серверов (Paper/Fabric/Forge/Vanilla)
	for (const srv of myRunningLocalServers.value) {
		void startHostHeartbeat(srv)
	}

	void refreshLobby()

	// Подписываемся на живые SSE-обновления лобби
	sseUnsubscribe = subscribeLobbySSE(() => {
		void refreshLobby()
	})
})

onUnmounted(() => {
	if (sseUnsubscribe) {
		sseUnsubscribe()
	}
})

const allServers = computed<HostedServer[]>(() => {
	const userIds = new Set(userHosts.value.map((h) => h.id))
	const localRunning = myRunningLocalServers.value.filter((s) => !userIds.has(s.id))
	return [...localRunning, ...userHosts.value, ...remoteLobbyServers.value]
})

const filteredServers = computed<HostedServer[]>(() => {
	let list = allServers.value

	if (activeFilter.value === 'java') {
		list = list.filter((s) => s.edition === 'java')
	} else if (activeFilter.value === 'bedrock') {
		list = list.filter((s) => s.edition === 'bedrock')
	} else if (activeFilter.value === 'my') {
		list = list.filter((s) => s.isMyHost)
	}

	const q = searchQuery.value.trim().toLowerCase()
	if (q) {
		list = list.filter(
			(s) =>
				s.name.toLowerCase().includes(q) ||
				s.host.toLowerCase().includes(q) ||
				s.version.toLowerCase().includes(q) ||
				s.address.toLowerCase().includes(q) ||
				(s.categories && s.categories.some((c) => c.toLowerCase().includes(q))),
		)
	}

	return list
})

function openCreateHostModal() {
	createHostModalRef.value?.show()
}

async function onHostCreated(data: {
	name: string
	edition: 'java' | 'bedrock'
	port: string
	categories: string[]
	host: string
}) {
	const parsedLocalPort = parseInt(data.port, 10) || (data.edition === 'bedrock' ? 19132 : 25565)
	const safeAddress = formatSafeConnectAddress(parsedLocalPort)
	const newHost: HostedServer = {
		id: 'host-' + Date.now(),
		name: data.name,
		motdHtml: `<span style="color:#55FF55">Хост игрока ${data.host}</span>`,
		edition: data.edition,
		version: data.edition === 'java' ? '1.21.4' : '1.21.70',
		address: safeAddress,
		host: data.host,
		isMyHost: true,
		localPort: parsedLocalPort,
		players: 1,
		maxPlayers: 10,
		ping: 28,
		region: 'Bedringh Relay RU',
		categories: data.categories,
		createdAt: Date.now(),
	}

	userHosts.value.unshift(newHost)
	saveUserHosts()

	// Открываем мультиплексированный туннель на VDS и запускаем фоновый heartbeat с авто-закрытием при выходе из мира
	await startHostHeartbeat(
		newHost,
		() => saveUserHosts(),
		(closedId) => handleAutoCloseLocalHost(closedId),
	)
	saveUserHosts()

	addNotification({
		title: newHost.name,
		text: newHost.publicPort
			? `Туннель открыт! Адрес для друзей: ${newHost.address}`
			: `Хост опубликован в Bedringh Хостинге! Адрес: ${newHost.address}`,
		type: 'success',
	})
}

function handleDeleteUserHost(id: string, name: string) {
	// Останавливаем heartbeat, закрываем туннель и шлём host-leave на VDS
	stopHostHeartbeat(id)
	void publishHostLeave(id)

	userHosts.value = userHosts.value.filter((h) => h.id !== id)
	saveUserHosts()
	addNotification({
		title: name,
		text: 'Туннель закрыт и хост удален из сети',
		type: 'info',
	})
}

async function handleConnect(server: HostedServer) {
	try {
		// Если на VDS уже открыт публичный порт туннеля — копируем прямой доменный адрес bedringh.duckdns.org:<port>
		// (и параллельно поднимаем локальный мост как резервный канал)
		void connectClientBridge(server.id, server.localPort)
		const connectAddr = server.publicPort
			? formatSafeConnectAddress(server.publicPort)
			: server.address

		await navigator.clipboard.writeText(connectAddr)
		copiedId.value = server.id
		setTimeout(() => {
			if (copiedId.value === server.id) {
				copiedId.value = null
			}
		}, 2000)

		addNotification({
			title: server.name,
			text: `Адрес скопирован для входа в Minecraft: ${connectAddr}`,
			type: 'success',
		})
	} catch (e) {
		console.warn('Failed to copy address', e)
	}
}

function formatCategoryBadge(catId: string): string {
	const found = SERVER_CATEGORIES.find((c) => c.id === catId)
	if (found) return found.name
	return catId
}

function cleanSummary(motdHtml?: string, address?: string): string {
	const text = (motdHtml || '').replace(/<[^>]*>/g, '').trim()
	if (text && address) {
		return `${text} • ${address}`
	}
	return text || address || 'Bedringh Hosted Server'
}

function pillClass(active: boolean) {
	return [
		'cursor-pointer rounded-xl border border-solid px-3 py-1.5 text-sm font-medium leading-5 transition-all duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-shadow',
		active
			? 'border-brand bg-brand-highlight text-brand font-semibold'
			: 'border-surface-5 bg-transparent text-primary hover:bg-surface-3',
	]
}
</script>

<template>
	<div class="p-6 max-w-[1280px] mx-auto w-full box-border flex flex-col gap-6">
		<!-- Плашка отложенного приглашения друга (InviteChip) -->
		<div
			v-if="socialState.pendingPlayInvite"
			class="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-purple-500/15 border border-solid border-purple-500/35 text-xs"
		>
			<div class="flex items-center gap-2.5">
				<UsersIcon class="size-5 text-purple-300 shrink-0" />
				<span class="text-contrast">
					Позовём <strong class="text-purple-300">{{ socialState.pendingPlayInvite.title }}</strong> автоматически сразу после создания хоста!
				</span>
			</div>
			<div class="flex items-center gap-2">
				<ButtonStyled color="brand" size="small">
					<button type="button" @click="openCreateHostModal">
						<PlusIcon aria-hidden="true" />
						<span>Создать хост сейчас</span>
					</button>
				</ButtonStyled>
				<button
					type="button"
					class="p-1.5 rounded-lg bg-transparent border-0 text-secondary hover:text-contrast cursor-pointer"
					title="Отменить приглашение"
					@click="setPendingPlayInvite(null)"
				>
					<XIcon class="size-4" />
				</button>
			</div>
		</div>

		<!-- Шапка страницы -->
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div class="flex flex-col gap-1">
				<h1 class="m-0 text-2xl font-extrabold text-contrast flex items-center gap-2">
					<ServerStackIcon class="size-7 text-brand" />
					<span>{{ formatMessage(messages.title) }}</span>
				</h1>
				<p class="m-0 text-sm text-secondary max-w-[580px] leading-relaxed">
					{{ formatMessage(messages.subtitle) }}
				</p>
			</div>

			<div class="flex items-center gap-2.5">
				<ButtonStyled type="outlined" size="large">
					<button type="button" :disabled="isRefreshing" @click="handleRefreshCatalog">
						<RefreshCwIcon aria-hidden="true" :class="{ 'animate-spin': isRefreshing }" />
						<span>Обновить</span>
					</button>
				</ButtonStyled>

				<ButtonStyled color="brand" size="large">
					<button type="button" @click="openCreateHostModal">
						<PlusIcon aria-hidden="true" />
						{{ formatMessage(messages.createBtn) }}
					</button>
				</ButtonStyled>
			</div>
		</div>

		<!-- Поиск и фильтры -->
		<div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pb-2">
			<!-- Фильтры -->
			<div class="flex items-center gap-2">
				<FilterIcon class="size-5 shrink-0 text-secondary" />
				<div class="filter-pills__chips flex flex-wrap items-center gap-1.5">
					<button
						type="button"
						:class="pillClass(activeFilter === 'all')"
						:aria-pressed="activeFilter === 'all'"
						@click="activeFilter = 'all'"
					>
						{{ formatMessage(messages.filterAll) }}
					</button>
					<button
						type="button"
						:class="pillClass(activeFilter === 'java')"
						:aria-pressed="activeFilter === 'java'"
						@click="activeFilter = 'java'"
					>
						Java
					</button>
					<button
						type="button"
						:class="pillClass(activeFilter === 'bedrock')"
						:aria-pressed="activeFilter === 'bedrock'"
						@click="activeFilter = 'bedrock'"
					>
						Bedrock
					</button>
					<button
						v-if="userHosts.length > 0"
						type="button"
						:class="pillClass(activeFilter === 'my')"
						:aria-pressed="activeFilter === 'my'"
						class="flex items-center gap-1.5"
						@click="activeFilter = 'my'"
					>
						<span>{{ formatMessage(messages.filterMyHosts) }}</span>
						<span
							class="px-1.5 py-0.2 text-xs rounded-full font-bold"
							:class="activeFilter === 'my' ? 'bg-brand/20 text-brand' : 'bg-surface-4 text-secondary'"
						>
							{{ userHosts.length }}
						</span>
					</button>
				</div>
			</div>

			<!-- Поле поиска -->
			<div class="w-full sm:w-72">
				<StyledInput
					v-model="searchQuery"
					:icon="SearchIcon"
					placeholder="Поиск по названию или хосту..."
				/>
			</div>
		</div>

		<!-- Список серверов -->
		<ProjectCardList v-if="filteredServers.length > 0" layout="list">
			<ProjectCard
				v-for="server in filteredServers"
				:key="server.id"
				:title="server.name"
				:icon-url="server.iconUrl"
				:author="{ name: server.host }"
				:summary="cleanSummary(server.motdHtml, server.address)"
				:tags="[
					server.isMyHost ? 'Мой хост' : '',
					server.edition === 'java' ? 'Java' : 'Bedrock',
					server.version,
					...(server.categories || []).map(formatCategoryBadge),
				].filter(Boolean)"
				:server-online-players="server.players"
				:server-region="server.region"
				:server-ping="server.ping ?? undefined"
				:server-status-online="server.ping !== null"
				:link="() => handleConnect(server)"
				layout="list"
				is-server-project
				exclude-loaders
			>
				<template #actions>
					<div class="flex items-center gap-2">
						<Button
							type="colored"
							color="brand"
							:disabled="server.ping === null"
							@click.stop="handleConnect(server)"
						>
							<component :is="copiedId === server.id ? CheckIcon : PlugIcon" class="size-4" />
							<span>{{ copiedId === server.id ? formatMessage(messages.copied) : formatMessage(messages.connect) }}</span>
						</Button>
						<IconButton
							v-if="server.isMyHost"
							v-tooltip="'Удалить хост'"
							label="Удалить хост"
							color="red"
							@click.stop="handleDeleteUserHost(server.id, server.name)"
						>
							<TrashIcon class="size-4" />
						</IconButton>
					</div>
				</template>
			</ProjectCard>
		</ProjectCardList>

		<!-- Пустое состояние -->
		<div
			v-else
			class="min-h-[45vh] flex flex-col items-center justify-center text-center p-8 bg-bg-raised/40 border border-dashed border-surface-4 rounded-3xl"
		>
			<div class="size-16 rounded-full bg-surface-3 flex items-center justify-center mb-4">
				<GlobeIcon class="size-8 text-brand" />
			</div>
			<h2 class="m-0 text-lg font-extrabold text-contrast mb-1">
				{{ formatMessage(messages.emptyTitle) }}
			</h2>
			<p class="m-0 text-sm text-secondary max-w-md leading-relaxed mb-6">
				{{ formatMessage(messages.emptyDesc) }}
			</p>
			<ButtonStyled color="brand" size="large">
				<button type="button" @click="openCreateHostModal">
					<PlusIcon aria-hidden="true" />
					{{ formatMessage(messages.createBtn) }}
				</button>
			</ButtonStyled>
		</div>

		<!-- Модальное окно создания хоста -->
		<CreateHostModal ref="createHostModalRef" @create="onHostCreated" />
	</div>
</template>

<style scoped>
.filter-pills__chips {
	filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.15));
}
</style>
