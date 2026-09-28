<script setup lang="ts">
import {
	ClipboardCopyIcon,
	EyeIcon,
	FolderOpenIcon,
	GlobeIcon,
	PlayIcon,
	PlusIcon,
	SearchIcon,
	ServerStackIcon,
	StopCircleIcon,
	TrashIcon,
} from '@modrinth/assets'
import {
	Accordion,
	Button,
	ButtonStyled,
	DropdownSelect,
	NavTabs,
	StyledInput,
	useVIntl,
} from '@modrinth/ui'
import { useStorage } from '@vueuse/core'
import dayjs from 'dayjs'
import { computed, inject, ref } from 'vue'
import { useRoute } from 'vue-router'

import ContextMenu from '@/components/ui/ContextMenu.vue'
import ConfirmDeleteServerModal from '@/components/ui/modal/ConfirmDeleteServerModal.vue'
import ServerCard from '@/components/ui/servers/ServerCard.vue'
import { useRootBreadcrumb } from '@/providers/breadcrumbs'
import { type LocalServer, useLocalServers } from '@/providers/local-servers'

const route = useRoute()
const openCreateServer = inject<() => void>('openCreateServer')
const { servers: localServers } = useLocalServers()

useRootBreadcrumb({
	slot: 'root',
	id: 'servers-library',
	label: 'Серверы',
	to: '/servers/library',
	visual: { type: 'icon', component: ServerStackIcon },
})

const serverCardComponents = ref<InstanceType<typeof ServerCard>[] | null>(null)
const contextMenuRef = ref<InstanceType<typeof ContextMenu> | null>(null)
const confirmModalRef = ref<InstanceType<typeof ConfirmDeleteServerModal> | null>(null)

function openCreateServerModal() {
	openCreateServer?.()
}

// Active tab filter based on route query ?core=...
const activeCoreFilter = computed(() => {
	const c = (route.query.core as string)?.toLowerCase()
	return c || 'all'
})

// State for search, sort, group
const state = useStorage(
	'servers-library-display-state',
	{
		group: 'Ядро',
		sortBy: 'Имя',
		collapsedGroups: [] as string[],
	},
	localStorage,
	{ mergeDefaults: true },
)

const search = ref('')
const collapsedSectionKeys = computed(() => new Set(state.value.collapsedGroups ?? []))
const getSectionKey = (sectionName: string) => `${state.value.group}:${sectionName}`

const isSectionCollapsed = (sectionName: string) => {
	return collapsedSectionKeys.value.has(getSectionKey(sectionName))
}

const setSectionCollapsed = (sectionName: string, collapsed: boolean) => {
	const sectionKey = getSectionKey(sectionName)
	const collapsedSections = new Set(state.value.collapsedGroups ?? [])
	if (collapsed) {
		collapsedSections.add(sectionKey)
	} else {
		collapsedSections.delete(sectionKey)
	}
	state.value.collapsedGroups = [...collapsedSections]
}

function formatCore(core: string): string {
	const c = (core || '').toLowerCase()
	if (c === 'paper') return 'Paper'
	if (c === 'purpur') return 'Purpur'
	if (c === 'spigot') return 'Spigot'
	if (c === 'folia') return 'Folia'
	if (c === 'fabric') return 'Fabric'
	if (c === 'forge') return 'Forge'
	if (c === 'neoforge') return 'NeoForge'
	if (c === 'quilt') return 'Quilt'
	if (c === 'mohist') return 'Mohist'
	if (c === 'vanilla') return 'Vanilla'
	return core || 'Другое'
}

const filteredServers = computed(() => {
	let list = [...localServers.value]

	// 1. Tab filter
	const tab = activeCoreFilter.value
	if (tab === 'paper') {
		list = list.filter((s) =>
			['paper', 'purpur', 'spigot', 'folia'].includes((s.core || '').toLowerCase()),
		)
	} else if (tab === 'modded') {
		list = list.filter((s) =>
			['fabric', 'forge', 'neoforge', 'quilt', 'mohist'].includes((s.core || '').toLowerCase()),
		)
	} else if (tab === 'vanilla') {
		list = list.filter((s) => (s.core || '').toLowerCase() === 'vanilla')
	}

	// 2. Search filter
	if (search.value.trim()) {
		const q = search.value.trim().toLowerCase()
		list = list.filter(
			(s) =>
				(s.name || '').toLowerCase().includes(q) ||
				(s.core || '').toLowerCase().includes(q) ||
				(s.gameVersion || '').toLowerCase().includes(q) ||
				String(s.port).includes(q),
		)
	}

	// 3. Sorting
	const { sortBy } = state.value
	if (sortBy === 'Имя') {
		list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
	} else if (sortBy === 'Версия игры') {
		list.sort((a, b) =>
			(a.gameVersion || '').localeCompare(b.gameVersion || '', undefined, { numeric: true }),
		)
	} else if (sortBy === 'Ядро') {
		list.sort((a, b) => (a.core || '').localeCompare(b.core || ''))
	} else if (sortBy === 'Статус') {
		const statusWeight = (status: string) => {
			if (status === 'running') return 0
			if (status === 'starting' || status === 'installing') return 1
			return 2
		}
		list.sort((a, b) => statusWeight(a.status) - statusWeight(b.status))
	} else if (sortBy === 'Дата создания') {
		list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
	}

	// 4. Grouping
	const { group } = state.value
	const serverMap = new Map<string, LocalServer[]>()

	if (group === 'Ядро') {
		list.forEach((s) => {
			const key = formatCore(s.core)
			if (!serverMap.has(key)) serverMap.set(key, [])
			serverMap.get(key)!.push(s)
		})
	} else if (group === 'Версия игры') {
		list.forEach((s) => {
			const key = s.gameVersion || 'Неизвестно'
			if (!serverMap.has(key)) serverMap.set(key, [])
			serverMap.get(key)!.push(s)
		})
	} else if (group === 'Статус') {
		list.forEach((s) => {
			const key =
				s.status === 'running'
					? 'Запущенные'
					: s.status === 'starting' || s.status === 'installing'
						? 'Запускаются'
						: 'Остановленные'
			if (!serverMap.has(key)) serverMap.set(key, [])
			serverMap.get(key)!.push(s)
		})
	} else {
		serverMap.set('None', list)
	}

	return serverMap
})

// Context Menu Handling
function handleRightClick(event: MouseEvent, serverId: string) {
	const item = serverCardComponents.value?.find((c: any) => c.server?.id === serverId)
	if (!item) return

	const isRunning = item.server?.status === 'running'
	const options = [
		isRunning
			? { name: 'stop', color: 'danger' }
			: { name: 'play', color: 'primary' },
		{ name: 'edit' },
		{ name: 'open' },
		{ name: 'copy_address' },
		{ name: 'copy_id' },
		{ type: 'divider' },
		{ name: 'delete', color: 'danger' },
	]

	contextMenuRef.value?.showMenu(event, item, options)
}

function handleContextMenuClick(args: { item: any; option: string }) {
	const item = args.item
	if (!item) return

	switch (args.option) {
		case 'play':
			item.play?.()
			break
		case 'stop':
			item.stop?.()
			break
		case 'edit':
			item.seeServer?.()
			break
		case 'open':
			item.openFolder?.()
			break
		case 'copy_address':
			item.copyAddress?.()
			break
		case 'copy_id':
			item.copyId?.()
			break
		case 'delete':
			if (item.server) {
				confirmModalRef.value?.show(item.server)
			}
			break
	}
}
</script>

<template>
	<div class="p-6 flex flex-col gap-4">
		<!-- Top Navigation Tabs and Actions -->
		<div class="flex items-center justify-between gap-3 flex-wrap">
			<NavTabs
				query="core"
				:links="[
					{ label: 'Все серверы', href: '' },
					{ label: 'Paper / Spigot', href: 'paper' },
					{ label: 'Fabric / Forge', href: 'modded' },
					{ label: 'Vanilla', href: 'vanilla' },
				]"
			/>

			<div class="flex items-center gap-2">
				<ButtonStyled color="quiet">
					<router-link to="/hosting/manage/">
						<GlobeIcon />
						Bedringh Хостинг
					</router-link>
				</ButtonStyled>
				<ButtonStyled color="brand">
					<button type="button" @click="openCreateServerModal">
						<PlusIcon />
						Создать сервер
					</button>
				</ButtonStyled>
			</div>
		</div>

		<!-- Main content when servers exist -->
		<template v-if="localServers.length > 0">
			<!-- Search and Filter Bar -->
			<div class="flex gap-2 items-center flex-wrap">
				<StyledInput
					v-model="search"
					:icon="SearchIcon"
					type="text"
					placeholder="Поиск серверов..."
					clearable
					wrapper-class="flex-1 min-w-[200px]"
				/>

				<DropdownSelect
					v-slot="{ selected }"
					v-model="state.sortBy"
					name="Sort Dropdown"
					class="max-w-[16rem]"
					:options="['Имя', 'Версия игры', 'Ядро', 'Статус', 'Дата создания']"
					placeholder="Сортировка..."
				>
					<span class="font-semibold text-primary">Сортировка: </span>
					<span class="font-semibold text-secondary">{{ selected }}</span>
				</DropdownSelect>

				<DropdownSelect
					v-slot="{ selected }"
					v-model="state.group"
					name="Group Dropdown"
					class="max-w-[16rem]"
					:options="['Ядро', 'Версия игры', 'Статус', 'Без группировки']"
					placeholder="Группировка..."
				>
					<span class="font-semibold text-primary">Группировать: </span>
					<span class="font-semibold text-secondary">{{ selected }}</span>
				</DropdownSelect>
			</div>

			<!-- Server Groups Accordions -->
			<div class="flex flex-col gap-3">
				<Accordion
					v-for="section in Array.from(filteredServers, ([key, value]) => ({ key, value }))"
					:key="section.key"
					:divider="section.key !== 'None'"
					:open-by-default="!isSectionCollapsed(section.key)"
					class="w-full"
					@on-open="setSectionCollapsed(section.key, false)"
					@on-close="setSectionCollapsed(section.key, true)"
				>
					<template v-if="section.key !== 'None'" #title>
						<span class="text-base font-bold text-contrast flex items-center gap-2">
							{{ section.key }}
							<span class="text-xs font-semibold text-secondary">
								({{ section.value.length }})
							</span>
						</span>
					</template>

					<div class="server-grid">
						<ServerCard
							v-for="server in section.value"
							ref="serverCardComponents"
							:key="server.id"
							:server="server"
							@contextmenu.prevent.stop="(event) => handleRightClick(event, server.id)"
						/>
					</div>
				</Accordion>
			</div>
		</template>

		<!-- Empty state when no servers exist -->
		<div v-else class="no-servers py-16">
			<div class="icon">
				<ServerStackIcon class="size-28 text-brand" />
			</div>
			<h2 class="text-xl font-bold text-contrast m-0">Серверы не найдены</h2>
			<p class="text-sm text-secondary m-0 max-w-md text-center">
				Создайте свой локальный сервер Minecraft прямо в Bedringh. Поддерживаются Paper, Spigot, Fabric, Forge и Vanilla.
			</p>
			<ButtonStyled color="brand">
				<button type="button" @click="openCreateServerModal">
					<PlusIcon />
					Создать сервер
				</button>
			</ButtonStyled>
		</div>

		<!-- Context Menu -->
		<ContextMenu ref="contextMenuRef" @option-clicked="handleContextMenuClick">
			<template #play>
				<PlayIcon />
				Запустить
			</template>
			<template #stop>
				<StopCircleIcon />
				Остановить
			</template>
			<template #edit>
				<EyeIcon />
				Настройки сервера
			</template>
			<template #open>
				<FolderOpenIcon />
				Открыть папку
			</template>
			<template #copy_address>
				<ClipboardCopyIcon />
				Скопировать адрес
			</template>
			<template #copy_id>
				<ClipboardCopyIcon />
				Скопировать ID
			</template>
			<template #delete>
				<TrashIcon />
				Удалить сервер
			</template>
		</ContextMenu>

		<!-- Delete Confirmation Modal -->
		<ConfirmDeleteServerModal ref="confirmModalRef" />
	</div>
</template>

<style lang="scss" scoped>
.server-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
	width: 100%;
	gap: 0.75rem;
	margin-right: auto;
}

.no-servers {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 1rem;
	text-align: center;
}
</style>
