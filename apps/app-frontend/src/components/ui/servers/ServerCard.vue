<script setup lang="ts">
import {
	FolderOpenIcon,
	GameIcon,
	getLoaderIcon,
	PlayIcon,
	ServerStackIcon,
	SpinnerIcon,
	StopCircleIcon,
} from '@modrinth/assets'
import {
	Avatar,
	formatMinecraftText,
	IconButton,
	injectNotificationManager,
	useVIntl,
} from '@modrinth/ui'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { type LocalServer, useLocalServers } from '@/providers/local-servers'
import {
	getLocalServerStatus,
	startLocalServerProcess,
	stopLocalServerProcess,
} from '@/services/local-server-process'
import { getServerDirectory } from '@/services/server-download'
import { openPath } from '@/helpers/utils.js'

const props = defineProps<{
	server: LocalServer
	compact?: boolean
	first?: boolean
}>()

const router = useRouter()
const { updateServerStatus } = useLocalServers()
const { addNotification } = injectNotificationManager()

const seeServer = async () => {
	await router.push(`/hosting/manage/${encodeURIComponent(props.server.id)}`)
}

const checkProcess = async () => {
	try {
		const isRunning = await getLocalServerStatus(props.server.id)
		if (isRunning && props.server.status !== 'running') {
			updateServerStatus(props.server.id, 'running', props.server.players ?? 0)
		} else if (!isRunning && props.server.status === 'running') {
			updateServerStatus(props.server.id, 'stopped', 0)
		}
	} catch {
		// ignore
	}
}

function formatErrorMessage(err: unknown): string {
	if (!err) return 'Неизвестная ошибка'
	if (typeof err === 'string') return err
	if (err instanceof Error) return err.message
	if (typeof err === 'object') {
		const obj = err as Record<string, unknown>
		if (typeof obj.OtherError === 'string') return obj.OtherError
		if (typeof obj.message === 'string') return obj.message
		if (typeof obj.error === 'string') return obj.error
		try {
			return JSON.stringify(err)
		} catch {
			return String(err)
		}
	}
	return String(err)
}

const isBusy = computed(
	() => props.server.status === 'starting' || props.server.status === 'installing',
)

async function play(e?: Event) {
	e?.stopPropagation()
	if (isBusy.value) return
	updateServerStatus(props.server.id, 'starting')
	try {
		const sDir = props.server.path || (await getServerDirectory(props.server.id))
		await startLocalServerProcess(props.server.id, sDir, {
			minRamMb: props.server.launchSettings?.minRamMb ?? 1024,
			maxRamMb: props.server.launchSettings?.maxRamMb ?? 4096,
			jvmArgs: props.server.launchSettings?.jvmArgs,
			javaPath: props.server.launchSettings?.javaPath,
		})
		updateServerStatus(props.server.id, 'running', 0)
		addNotification({
			title: `${props.server.name}`,
			text: `Сервер запущен (порт ${props.server.port})`,
			type: 'success',
		})
	} catch (err) {
		updateServerStatus(props.server.id, 'stopped', 0)
		addNotification({
			title: 'Ошибка запуска сервера',
			text: formatErrorMessage(err),
			type: 'error',
		})
	}
}

async function stop(e?: Event) {
	e?.stopPropagation()
	try {
		await stopLocalServerProcess(props.server.id)
	} catch {
		// ignore
	}
	updateServerStatus(props.server.id, 'stopped', 0)
	addNotification({
		title: `${props.server.name}`,
		text: 'Сервер остановлен',
		type: 'info',
	})
}

const openFolder = async () => {
	const sDir = props.server.path || (await getServerDirectory(props.server.id))
	if (sDir) {
		await openPath(sDir)
	}
}

const copyAddress = async () => {
	const addr = props.server.publicAddress || `127.0.0.1:${props.server.port}`
	await navigator.clipboard.writeText(addr)
	addNotification({
		title: props.server.name,
		text: `Адрес ${addr} скопирован в буфер обмена`,
		type: 'success',
	})
}

const copyId = async () => {
	await navigator.clipboard.writeText(props.server.id)
	addNotification({
		title: props.server.name,
		text: `ID сервера скопирован: ${props.server.id}`,
		type: 'info',
	})
}

defineExpose({
	server: props.server,
	play,
	stop,
	seeServer,
	openFolder,
	copyAddress,
	copyId,
	isBusy,
})

onMounted(() => {
	checkProcess()
})
</script>

<template>
	<template v-if="compact">
		<div
			class="card-shadow grid grid-cols-[auto_1fr_auto] bg-bg-raised rounded-xl p-3 pl-4 gap-2 cursor-pointer hover:brightness-90 transition-all"
			@click="seeServer"
			@mouseenter="checkProcess"
		>
			<Avatar
				size="48px"
				:src="server.iconUrl"
				:tint-by="server.id"
				:alt="server.name"
				pad-transparent-corners
			/>
			<div class="h-full flex items-center font-bold text-contrast leading-normal">
				<span class="line-clamp-2" v-html="formatMinecraftText(server.name)" />
			</div>
			<div class="flex items-center">
				<IconButton
					v-if="server.status === 'running'"
					v-tooltip="'Остановить'"
					type="colored"
					color="red"
					label="Остановить"
					@mouseenter="checkProcess"
					@click="(e) => stop(e)"
				>
					<StopCircleIcon />
				</IconButton>
				<IconButton
					v-else-if="isBusy"
					v-tooltip="server.status === 'installing' ? 'Установка...' : 'Запуск сервера...'"
					label="Загрузка"
					disabled
				>
					<SpinnerIcon class="animate-spin" />
				</IconButton>
				<IconButton
					v-else
					v-tooltip="'Запустить'"
					:type="first ? 'colored' : 'base'"
					:color="first ? 'brand' : undefined"
					label="Запустить"
					@click="(e) => play(e)"
					@mouseenter="checkProcess"
				>
					<PlayIcon class="translate-x-[1px]" />
				</IconButton>
			</div>
			<div class="flex items-center col-span-3 gap-1.5 text-secondary font-semibold">
				<component
					:is="getLoaderIcon(server.core) || ServerStackIcon"
					class="shrink-0 size-4"
				/>
				<span class="text-sm capitalize">{{ server.core }} {{ server.gameVersion }}</span>
			</div>
		</div>
	</template>
	<div v-else>
		<div
			class="button-base bg-bg-raised p-4 rounded-xl flex gap-3 group cursor-pointer border border-solid border-surface-4 hover:border-surface-5 transition-all"
			@click="seeServer"
			@mouseenter="checkProcess"
		>
			<div class="relative flex items-center justify-center shrink-0">
				<Avatar
					size="48px"
					:src="server.iconUrl"
					:tint-by="server.id"
					:alt="server.name"
					:class="`transition-all ${isBusy ? 'brightness-[0.25] scale-[0.85]' : 'group-hover:brightness-75'}`"
					pad-transparent-corners
				/>
				<div class="absolute inset-0 flex items-center justify-center">
					<IconButton
						v-if="server.status === 'running'"
						v-tooltip="'Остановить'"
						type="colored"
						color="red"
						size="xl"
						label="Остановить"
						:class="{ 'scale-100 opacity-100': server.status === 'running' }"
						class="transition-all scale-75 origin-bottom opacity-0 card-shadow"
						@click="(e) => stop(e)"
						@mouseenter="checkProcess"
					>
						<StopCircleIcon />
					</IconButton>
					<SpinnerIcon
						v-else-if="isBusy"
						v-tooltip="server.status === 'installing' ? 'Установка...' : 'Запуск сервера...'"
						class="animate-spin w-8 h-8 text-brand"
						tabindex="-1"
					/>
					<IconButton
						v-else
						v-tooltip="'Запустить'"
						type="colored"
						color="brand"
						size="xl"
						label="Запустить"
						class="transition-all scale-75 group-hover:scale-100 group-focus-within:scale-100 origin-bottom opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 card-shadow"
						@click="(e) => play(e)"
						@mouseenter="checkProcess"
					>
						<PlayIcon class="translate-x-[2px]" />
					</IconButton>
				</div>
			</div>
			<div class="flex flex-col gap-1 min-w-0 flex-1">
				<div class="flex items-center justify-between gap-2">
					<p
						class="m-0 text-md font-bold text-contrast leading-tight line-clamp-1 group-hover:text-brand transition-colors"
						v-html="formatMinecraftText(server.name)"
					/>
					<span
						v-if="server.status === 'running'"
						class="flex items-center gap-1 text-[11px] font-bold text-green shrink-0"
					>
						<span class="size-1.5 rounded-full bg-green animate-pulse" />
						Онлайн
					</span>
				</div>
				<div class="flex items-center justify-between col-span-3 gap-1.5 text-secondary font-semibold mt-auto pt-1">
					<div class="flex items-center gap-1.5 truncate">
						<component
							:is="getLoaderIcon(server.core) || ServerStackIcon"
							class="shrink-0 size-4"
						/>
						<span class="text-sm capitalize truncate">
							{{ server.core }} {{ server.gameVersion }}
						</span>
					</div>
					<span class="text-xs text-secondary/80 font-mono shrink-0">
						:{{ server.port }}
					</span>
				</div>
			</div>
		</div>
	</div>
</template>
