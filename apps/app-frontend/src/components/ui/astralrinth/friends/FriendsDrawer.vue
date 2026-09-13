<script setup lang="ts">
import {
	CheckIcon,
	CopyIcon,
	DownloadIcon,
	GameIcon,
	PlusIcon,
	RefreshCwIcon,
	TrashIcon,
	UserPlusIcon,
	UsersIcon,
	XIcon,
} from '@modrinth/assets'
import { ButtonStyled, NewModal, injectNotificationManager } from '@modrinth/ui'
import { computed, inject, ref } from 'vue'
import {
	cancelFriendRequest,
	refreshFriendsList,
	removeFriend,
	respondFriendRequest,
	useBedringhFriends,
	type BedringhFriend,
} from '@/services/bedringh-friends'
import { getActiveBedringhUser } from '@/services/bedringh-settings-sync'
import AddFriendModal from './AddFriendModal.vue'

const modal = ref<InstanceType<typeof NewModal> | null>(null)
const addFriendModal = ref<InstanceType<typeof AddFriendModal> | null>(null)
const { addNotification } = injectNotificationManager()

const openBedringhCloudPackModal = inject<(code: string) => void>('openBedringhCloudPackModal', () => {})

const {
	state,
	totalIncoming,
	onlineFriends,
	inGameFriends,
	offlineFriends,
} = useBedringhFriends()

type TabType = 'all' | 'incoming' | 'outgoing'
const activeTab = ref<TabType>('all')

const activeUser = computed(() => getActiveBedringhUser()?.username || null)

function openAddFriend() {
	addFriendModal.value?.show()
}

async function handleRefresh() {
	await refreshFriendsList(true)
}

async function handleAccept(requestId: string, username: string) {
	const ok = await respondFriendRequest(requestId, 'accept')
	if (ok) {
		addNotification({
			type: 'success',
			title: 'Друзья',
			text: `Вы и ${username} теперь друзья!`,
		})
	}
}

async function handleReject(requestId: string) {
	await respondFriendRequest(requestId, 'reject')
}

async function handleCancel(requestId: string) {
	await cancelFriendRequest(requestId)
}

async function handleRemove(friendUsername: string) {
	if (confirm(`Удалить ${friendUsername} из списка друзей?`)) {
		const ok = await removeFriend(friendUsername)
		if (ok) {
			addNotification({
				type: 'info',
				title: 'Друзья',
				text: `Пользователь ${friendUsername} удален из друзей`,
			})
		}
	}
}

function handleCopyServer(address?: string) {
	if (!address) return
	navigator.clipboard.writeText(address)
	addNotification({
		type: 'success',
		title: 'Скопировано',
		text: `Адрес сервера ${address} скопирован в буфер обмена`,
	})
}

function handleInstallFriendPack(instanceName?: string) {
	if (!instanceName) return
	// Если это код Cloud Pack (BP-XXXXXX)
	if (instanceName.startsWith('BP-')) {
		openBedringhCloudPackModal(instanceName)
	} else {
		// Открываем модалку облачных сборок
		openBedringhCloudPackModal('')
	}
}

function show() {
	modal.value?.show()
}

function hide() {
	modal.value?.hide()
}

defineExpose({ show, hide })
</script>

<template>
	<NewModal ref="modal" header="Друзья Bedringh ID">
		<div class="flex flex-col gap-4 px-6 py-5 w-[500px] max-w-full min-h-[420px]">
			<!-- Если не авторизован в Bedringh ID -->
			<div
				v-if="!activeUser"
				class="flex flex-col items-center justify-center p-8 text-center bg-surface-2 border border-solid border-surface-5 rounded-2xl gap-3 my-auto"
			>
				<div class="w-14 h-14 rounded-2xl bg-brand/10 text-brand flex items-center justify-center">
					<UsersIcon class="w-7 h-7" />
				</div>
				<h3 class="m-0 text-base font-bold text-contrast">Войдите в Bedringh ID</h3>
				<p class="m-0 text-xs text-secondary max-w-xs">
					Чтобы находить друзей, видеть в какие сборки они играют и играть вместе, войдите в свой профиль Bedringh ID.
				</p>
			</div>

			<!-- Авторизован: Основной интерфейс -->
			<template v-else>
				<!-- Верхняя панель действий -->
				<div class="flex items-center justify-between gap-2 border-b border-solid border-surface-5 pb-3">
					<div class="flex items-center gap-1.5 bg-surface-2 p-1 rounded-xl border border-solid border-surface-5 text-xs">
						<button
							type="button"
							class="px-3 py-1.5 rounded-lg font-medium border-0 cursor-pointer transition-all"
							:class="activeTab === 'all' ? 'bg-surface-4 text-contrast shadow-sm font-semibold' : 'bg-transparent text-secondary hover:text-contrast'"
							@click="activeTab = 'all'"
						>
							Все ({{ state.friends.length }})
						</button>
						<button
							type="button"
							class="px-3 py-1.5 rounded-lg font-medium border-0 cursor-pointer transition-all flex items-center gap-1.5"
							:class="activeTab === 'incoming' ? 'bg-surface-4 text-contrast shadow-sm font-semibold' : 'bg-transparent text-secondary hover:text-contrast'"
							@click="activeTab = 'incoming'"
						>
							<span>Заявки</span>
							<span
								v-if="totalIncoming > 0"
								class="px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-brand text-white"
							>
								{{ totalIncoming }}
							</span>
						</button>
						<button
							v-if="state.outgoingRequests.length > 0"
							type="button"
							class="px-3 py-1.5 rounded-lg font-medium border-0 cursor-pointer transition-all"
							:class="activeTab === 'outgoing' ? 'bg-surface-4 text-contrast shadow-sm font-semibold' : 'bg-transparent text-secondary hover:text-contrast'"
							@click="activeTab = 'outgoing'"
						>
							Исходящие ({{ state.outgoingRequests.length }})
						</button>
					</div>

					<div class="flex items-center gap-2">
						<ButtonStyled type="quiet" class="!p-2">
							<button
								type="button"
								class="p-1.5 text-secondary hover:text-contrast"
								title="Обновить"
								:disabled="state.loading"
								@click="handleRefresh"
							>
								<RefreshCwIcon class="w-4 h-4" :class="{ 'animate-spin': state.loading }" />
							</button>
						</ButtonStyled>

						<ButtonStyled color="brand">
							<button type="button" class="px-3 py-1.5 text-xs font-semibold" @click="openAddFriend">
								<PlusIcon class="w-4 h-4 mr-1 inline" />
								Добавить
							</button>
						</ButtonStyled>
					</div>
				</div>

				<!-- Вкладка 1: Список друзей -->
				<div v-if="activeTab === 'all'" class="flex flex-col gap-3 overflow-y-auto max-h-[380px] pr-1">
					<div v-if="state.friends.length === 0" class="flex flex-col items-center justify-center p-8 text-center text-secondary gap-2">
						<UsersIcon class="w-8 h-8 opacity-40" />
						<span class="text-xs">У вас пока нет друзей в Bedringh ID.</span>
						<button
							type="button"
							class="text-xs text-brand underline bg-transparent border-0 cursor-pointer mt-1"
							@click="openAddFriend"
						>
							Найти и добавить друга
						</button>
					</div>

					<!-- Группа: В игре -->
					<div v-if="inGameFriends.length > 0" class="flex flex-col gap-2">
						<span class="text-[11px] font-bold tracking-wider text-purple-400 uppercase px-1">
							В игре ({{ inGameFriends.length }})
						</span>
						<div
							v-for="friend in inGameFriends"
							:key="friend.id"
							class="flex flex-col p-3 bg-purple-500/10 border border-solid border-purple-500/20 rounded-xl gap-2"
						>
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3 min-w-0">
									<div class="relative">
										<img
											:src="`https://mc-heads.net/avatar/${encodeURIComponent(friend.username)}/64`"
											alt=""
											class="w-9 h-9 rounded-lg object-cover image-pixelated bg-surface-3"
										/>
										<span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-purple-500 border-2 border-solid border-bg-raised rounded-full"></span>
									</div>
									<div class="flex flex-col min-w-0">
										<span class="font-bold text-contrast truncate text-sm">
											{{ friend.username }}
										</span>
										<span class="text-xs text-purple-300 font-medium flex items-center gap-1">
											<GameIcon class="w-3.5 h-3.5" />
											Играет в {{ friend.gameInfo?.instanceName || 'Minecraft' }}
										</span>
									</div>
								</div>

								<div class="flex items-center gap-1">
									<ButtonStyled
										v-if="friend.gameInfo?.serverAddress"
										type="quiet"
										class="!p-1.5"
										title="Скопировать IP сервера"
									>
										<button type="button" @click="handleCopyServer(friend.gameInfo?.serverAddress)">
											<CopyIcon class="w-4 h-4 text-purple-300" />
										</button>
									</ButtonStyled>
									<ButtonStyled
										v-if="friend.gameInfo?.instanceName"
										type="quiet"
										class="!p-1.5"
										title="Установить такую же сборку"
									>
										<button type="button" @click="handleInstallFriendPack(friend.gameInfo?.instanceName)">
											<DownloadIcon class="w-4 h-4 text-purple-300" />
										</button>
									</ButtonStyled>
									<button
										type="button"
										class="p-1.5 text-secondary hover:text-red-400 bg-transparent border-0 cursor-pointer rounded-lg"
										title="Удалить из друзей"
										@click="handleRemove(friend.username)"
									>
										<TrashIcon class="w-4 h-4" />
									</button>
								</div>
							</div>

							<!-- Детали сборки/версии -->
							<div
								v-if="friend.gameInfo?.mcVersion || friend.gameInfo?.loader"
								class="flex items-center gap-2 text-[11px] text-secondary pl-12"
							>
								<span v-if="friend.gameInfo?.mcVersion" class="px-1.5 py-0.5 bg-surface-3 rounded">
									MC {{ friend.gameInfo.mcVersion }}
								</span>
								<span v-if="friend.gameInfo?.loader" class="px-1.5 py-0.5 bg-surface-3 rounded capitalize">
									{{ friend.gameInfo.loader }}
								</span>
								<span v-if="friend.gameInfo?.serverAddress" class="truncate text-purple-300/80">
									Сервер: {{ friend.gameInfo.serverAddress }}
								</span>
							</div>
						</div>
					</div>

					<!-- Группа: В сети (Лаунчер) -->
					<div v-if="onlineFriends.filter(f => f.status === 'online').length > 0" class="flex flex-col gap-2">
						<span class="text-[11px] font-bold tracking-wider text-emerald-400 uppercase px-1">
							В сети ({{ onlineFriends.filter(f => f.status === 'online').length }})
						</span>
						<div
							v-for="friend in onlineFriends.filter(f => f.status === 'online')"
							:key="friend.id"
							class="flex items-center justify-between p-2.5 bg-surface-2 border border-solid border-surface-5 rounded-xl"
						>
							<div class="flex items-center gap-3 min-w-0">
								<div class="relative">
									<img
										:src="`https://mc-heads.net/avatar/${encodeURIComponent(friend.username)}/64`"
										alt=""
										class="w-9 h-9 rounded-lg object-cover image-pixelated bg-surface-3"
									/>
									<span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-solid border-bg-raised rounded-full"></span>
								</div>
								<div class="flex flex-col min-w-0">
									<span class="font-bold text-contrast truncate text-sm">
										{{ friend.username }}
									</span>
									<span class="text-xs text-emerald-400">В сети</span>
								</div>
							</div>

							<button
								type="button"
								class="p-1.5 text-secondary hover:text-red-400 bg-transparent border-0 cursor-pointer rounded-lg"
								title="Удалить из друзей"
								@click="handleRemove(friend.username)"
							>
								<TrashIcon class="w-4 h-4" />
							</button>
						</div>
					</div>

					<!-- Группа: Не в сети -->
					<div v-if="offlineFriends.length > 0" class="flex flex-col gap-2">
						<span class="text-[11px] font-bold tracking-wider text-secondary uppercase px-1">
							Не в сети ({{ offlineFriends.length }})
						</span>
						<div
							v-for="friend in offlineFriends"
							:key="friend.id"
							class="flex items-center justify-between p-2.5 bg-surface-2/60 border border-solid border-surface-5/50 rounded-xl opacity-75 hover:opacity-100 transition-opacity"
						>
							<div class="flex items-center gap-3 min-w-0">
								<div class="relative">
									<img
										:src="`https://mc-heads.net/avatar/${encodeURIComponent(friend.username)}/64`"
										alt=""
										class="w-9 h-9 rounded-lg object-cover image-pixelated bg-surface-3 grayscale"
									/>
									<span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-surface-4 border-2 border-solid border-bg-raised rounded-full"></span>
								</div>
								<div class="flex flex-col min-w-0">
									<span class="font-medium text-contrast truncate text-sm">
										{{ friend.username }}
									</span>
									<span class="text-xs text-secondary">Не в сети</span>
								</div>
							</div>

							<button
								type="button"
								class="p-1.5 text-secondary hover:text-red-400 bg-transparent border-0 cursor-pointer rounded-lg"
								title="Удалить из друзей"
								@click="handleRemove(friend.username)"
							>
								<TrashIcon class="w-4 h-4" />
							</button>
						</div>
					</div>
				</div>

				<!-- Вкладка 2: Входящие заявки -->
				<div v-else-if="activeTab === 'incoming'" class="flex flex-col gap-2.5 overflow-y-auto max-h-[380px]">
					<div v-if="state.incomingRequests.length === 0" class="flex flex-col items-center justify-center p-8 text-center text-secondary gap-2">
						<CheckIcon class="w-8 h-8 opacity-40 text-emerald-400" />
						<span class="text-xs">Новых входящих заявок нет.</span>
					</div>

					<div
						v-for="req in state.incomingRequests"
						:key="req.id"
						class="flex items-center justify-between p-3 bg-surface-2 border border-solid border-surface-5 rounded-xl"
					>
						<div class="flex items-center gap-3 min-w-0">
							<img
								:src="`https://mc-heads.net/avatar/${encodeURIComponent(req.username)}/64`"
								alt=""
								class="w-9 h-9 rounded-lg object-cover image-pixelated bg-surface-3"
							/>
							<div class="flex flex-col min-w-0">
								<span class="font-bold text-contrast truncate text-sm">
									{{ req.username }}
								</span>
								<span class="text-xs text-brand">Хочет добавить вас в друзья</span>
							</div>
						</div>

						<div class="flex items-center gap-1.5">
							<ButtonStyled color="brand">
								<button
									type="button"
									class="px-2.5 py-1 text-xs font-semibold"
									@click="handleAccept(req.id, req.username)"
								>
									<CheckIcon class="w-3.5 h-3.5 mr-1 inline" />
									Принять
								</button>
							</ButtonStyled>
							<ButtonStyled type="quiet">
								<button
									type="button"
									class="px-2.5 py-1 text-xs text-secondary hover:text-red-400"
									@click="handleReject(req.id)"
								>
									Отклонить
								</button>
							</ButtonStyled>
						</div>
					</div>
				</div>

				<!-- Вкладка 3: Исходящие заявки -->
				<div v-else-if="activeTab === 'outgoing'" class="flex flex-col gap-2.5 overflow-y-auto max-h-[380px]">
					<div
						v-for="req in state.outgoingRequests"
						:key="req.id"
						class="flex items-center justify-between p-3 bg-surface-2 border border-solid border-surface-5 rounded-xl"
					>
						<div class="flex items-center gap-3 min-w-0">
							<img
								:src="`https://mc-heads.net/avatar/${encodeURIComponent(req.username)}/64`"
								alt=""
								class="w-9 h-9 rounded-lg object-cover image-pixelated bg-surface-3"
							/>
							<div class="flex flex-col min-w-0">
								<span class="font-bold text-contrast truncate text-sm">
									{{ req.username }}
								</span>
								<span class="text-xs text-secondary">Ожидание подтверждения...</span>
							</div>
						</div>

						<ButtonStyled type="quiet">
							<button
								type="button"
								class="px-2.5 py-1 text-xs text-secondary hover:text-red-400"
								@click="handleCancel(req.id)"
							>
								Отменить
							</button>
						</ButtonStyled>
					</div>
				</div>
			</template>
		</div>
	</NewModal>

	<!-- Модалка добавления нового друга -->
	<AddFriendModal ref="addFriendModal" />
</template>
