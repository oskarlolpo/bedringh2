<script setup lang="ts">
import {
	ChevronRightIcon,
	FolderOpenIcon,
	GlobeIcon,
	LoaderCircleIcon,
	PlayIcon,
	PlusIcon,
	ServerStackIcon,
	SettingsIcon,
	StopCircleIcon,
	TrashIcon,
} from '@modrinth/assets'
import {
	ButtonStyled,
	IconButton,
	defineMessages,
	injectNotificationManager,
	TagItem,
	useVIntl,
} from '@modrinth/ui'
import { computed, inject, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useRootBreadcrumb } from '@/providers/breadcrumbs'
import { type LocalServer, useLocalServers } from '@/providers/local-servers'
import { getServerDirectory } from '@/services/server-download'
import { startLocalServerProcess, stopLocalServerProcess } from '@/services/local-server-process'

const router = useRouter()
const { formatMessage } = useVIntl()
const { addNotification } = injectNotificationManager()
const { servers: localServers, removeServer, updateServerStatus } = useLocalServers()
const openCreateServer = inject<() => void>('openCreateServer')

const messages = defineMessages({
	breadcrumb: { id: 'servers.list.title', defaultMessage: 'My Servers' },
	title: { id: 'servers.list.title', defaultMessage: 'My Servers' },
	createBtn: { id: 'servers.list.create_btn', defaultMessage: 'Create Server' },
	statusRunning: { id: 'server.view.metric.running', defaultMessage: 'Online' },
	statusStopped: { id: 'server.view.metric.stopped', defaultMessage: 'Stopped' },
	statusStarting: { id: 'server.view.metric.starting', defaultMessage: 'Starting...' },
	actionStart: { id: 'server.view.action.start', defaultMessage: 'Start' },
	actionStop: { id: 'server.view.action.stop', defaultMessage: 'Stop' },
	actionDelete: { id: 'server.view.action.delete', defaultMessage: 'Delete server' },
	emptyTitle: { id: 'servers.list.empty_title', defaultMessage: 'No local servers yet' },
	emptyDesc: { id: 'servers.list.empty_desc', defaultMessage: 'Create your own Minecraft server in one click with plugins or mods' },
})

useRootBreadcrumb({
	slot: 'root',
	id: 'servers',
	label: formatMessage(messages.breadcrumb),
	to: '/hosting/manage/',
	visual: { type: 'icon', component: ServerStackIcon },
})

function handleCreateServer() {
	if (openCreateServer) {
		openCreateServer()
	} else {
		router.push('/?openCreate=true')
	}
}

function handleOpenServer(id: string) {
	router.push(`/hosting/manage/${id}`)
}

async function handleToggleServer(server: LocalServer, e: Event) {
	e.stopPropagation()
	if (server.status === 'stopped') {
		updateServerStatus(server.id, 'starting')
		try {
			const sDir = server.path || (await getServerDirectory(server.id))
			await startLocalServerProcess(server.id, sDir, {
				minRamMb: server.launchSettings?.minRamMb ?? 1024,
				maxRamMb: server.launchSettings?.maxRamMb ?? 4096,
				jvmArgs: server.launchSettings?.jvmArgs,
				javaPath: server.launchSettings?.javaPath,
			})
			updateServerStatus(server.id, 'running', 0)
			addNotification({
				title: `${server.name}`,
				text: `Ready on port ${server.port}`,
				type: 'success',
			})
		} catch (err) {
			updateServerStatus(server.id, 'stopped', 0)
			addNotification({
				title: 'Error',
				text: String(err),
				type: 'error',
			})
		}
	} else {
		try {
			await stopLocalServerProcess(server.id)
		} catch {
			// ignore
		}
		updateServerStatus(server.id, 'stopped', 0)
		addNotification({
			title: `${server.name}`,
			text: formatMessage(messages.statusStopped),
			type: 'info',
		})
	}
}

function handleDeleteServer(id: string, name: string, e: Event) {
	e.stopPropagation()
	if (confirm(`Delete server "${name}"?`)) {
		removeServer(id)
		addNotification({
			title: name,
			text: 'Server removed.',
			type: 'info',
		})
	}
}
</script>

<template>
	<div class="p-6 max-w-[1280px] mx-auto w-full box-border flex flex-col gap-6">
		<!-- Шапка страницы -->
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div>
				<h1 class="m-0 text-2xl font-extrabold text-contrast flex items-center gap-2">
					<ServerStackIcon class="size-7 text-brand" />
					<span>{{ formatMessage(messages.title) }}</span>
				</h1>
			</div>

			<ButtonStyled color="brand" size="large">
				<button type="button" @click="handleCreateServer">
					<PlusIcon aria-hidden="true" />
					{{ formatMessage(messages.createBtn) }}
				</button>
			</ButtonStyled>
		</div>

		<!-- Список серверов -->
		<div v-if="localServers.length > 0" class="flex flex-col gap-3">
			<div
				v-for="server in localServers"
				:key="server.id"
				class="bg-bg-raised border border-solid border-surface-4 hover:border-surface-5 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer transition-all shadow-sm group"
				@click="handleOpenServer(server.id)"
			>
				<!-- Инфо о сервере -->
				<div class="flex items-center gap-4 min-w-0">
					<!-- Иконка -->
					<div class="size-14 rounded-xl bg-surface-4 overflow-hidden shrink-0 flex items-center justify-center border border-solid border-surface-5 relative group-hover:scale-105 transition-transform">
						<img
							v-if="server.iconUrl"
							:src="server.iconUrl"
							:alt="server.name"
							class="w-full h-full object-cover"
						/>
						<ServerStackIcon v-else class="size-7 text-brand" />

						<!-- Точка статуса -->
						<span
							class="absolute -top-1 -right-1 size-3 rounded-full border-2 border-solid border-bg-raised"
							:class="
								server.status === 'running'
									? 'bg-green animate-pulse'
									: server.status === 'starting'
										? 'bg-yellow animate-spin'
										: server.status === 'installing'
											? 'bg-brand animate-pulse'
											: 'bg-secondary/40'
							"
						/>
					</div>

					<div class="flex flex-col gap-1 min-w-0">
						<div class="flex items-center gap-2.5">
							<h2 class="m-0 text-lg font-bold text-contrast truncate group-hover:text-brand transition-colors">
								{{ server.name }}
							</h2>

							<!-- Бейдж статуса -->
							<span
								class="px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider"
								:class="
									server.status === 'running'
										? 'bg-green/15 text-green'
										: server.status === 'starting'
											? 'bg-yellow/15 text-yellow'
											: server.status === 'installing'
												? 'bg-brand/15 text-brand'
												: 'bg-surface-4 text-secondary'
								"
							>
								{{
									server.status === 'running'
										? formatMessage(messages.statusRunning)
										: server.status === 'starting'
											? formatMessage(messages.statusStarting)
											: server.status === 'installing'
												? '...'
												: formatMessage(messages.statusStopped)
								}}
							</span>
						</div>

						<div class="flex items-center gap-2 text-xs text-secondary font-medium">
							<TagItem>
								<span class="capitalize font-bold text-contrast">{{ server.core }}</span>
								<span class="ml-1">{{ server.gameVersion }}</span>
							</TagItem>
							<span>&bull;</span>
							<span>port: {{ server.port }}</span>
						</div>
					</div>
				</div>

				<!-- Действия в карточке -->
				<div class="flex items-center gap-2 shrink-0 self-end md:self-center" @click.stop>
					<!-- Кнопка Быстрый Старт/Стоп -->
					<ButtonStyled
						:color="server.status === 'running' ? 'red' : 'brand'"
						size="medium"
					>
						<button
							type="button"
							:disabled="server.status === 'starting' || server.status === 'installing'"
							@click="handleToggleServer(server, $event)"
						>
							<LoaderCircleIcon
								v-if="server.status === 'starting' || server.status === 'installing'"
								class="size-4 animate-spin"
							/>
							<StopCircleIcon v-else-if="server.status === 'running'" aria-hidden="true" />
							<PlayIcon v-else aria-hidden="true" />
							<span>
								{{
									server.status === 'running'
										? formatMessage(messages.actionStop)
										: server.status === 'starting'
											? formatMessage(messages.statusStarting)
											: server.status === 'installing'
												? '...'
												: formatMessage(messages.actionStart)
								}}
							</span>
						</button>
					</ButtonStyled>

					<!-- Кнопка Управление -->
					<ButtonStyled color="standard" size="medium">
						<button type="button" @click="handleOpenServer(server.id)">
							<ChevronRightIcon class="size-4" />
						</button>
					</ButtonStyled>

					<!-- Удалить -->
					<IconButton
						size="sm"
						:label="formatMessage(messages.actionDelete)"
						@click="handleDeleteServer(server.id, server.name, $event)"
					>
						<TrashIcon class="size-4 text-red" />
					</IconButton>
				</div>
			</div>
		</div>

		<!-- Пустое состояние (Empty State) -->
		<div
			v-else
			class="min-h-[55vh] flex flex-col items-center justify-center text-center p-8 bg-bg-raised/40 border border-dashed border-surface-4 rounded-3xl"
		>
			<div class="size-20 rounded-full bg-surface-3 flex items-center justify-center mb-4">
				<ServerStackIcon class="size-10 text-brand" />
			</div>
			<h2 class="m-0 text-xl font-extrabold text-contrast mb-1">
				{{ formatMessage(messages.emptyTitle) }}
			</h2>
			<p class="m-0 text-sm text-secondary max-w-md leading-relaxed mb-6">
				{{ formatMessage(messages.emptyDesc) }}
			</p>
			<ButtonStyled color="brand" size="large">
				<button type="button" @click="handleCreateServer">
					<PlusIcon aria-hidden="true" />
					{{ formatMessage(messages.createBtn) }}
				</button>
			</ButtonStyled>
		</div>
	</div>
</template>
