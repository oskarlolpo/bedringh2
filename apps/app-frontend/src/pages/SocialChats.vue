<script setup lang="ts">
import {
	CheckIcon,
	GameIcon,
	LogInIcon,
	MessagesSquareIcon,
	MoreVerticalIcon,
	NoMessagesIllustration,
	PlayIcon,
	PlusIcon,
	SearchIcon,
	SendIcon,
	ServerStackIcon,
	ShareIcon,
	ThinkingRinthbot,
	TrashIcon,
	UserPlusIcon,
	UsersIcon,
	XIcon,
} from '@modrinth/assets'
import {
	Avatar,
	Button,
	Chips,
	EmptyState,
	IconButton,
	injectNotificationManager,
	Input,
	type InvitePlayersInvitePayload,
	InvitePlayersModal,
	type InvitePlayersSearchUser,
	type InvitePlayersUser,
	TeleportOverflowMenu,
	UserAvatar,
	useRelativeTime,
} from '@modrinth/ui'
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BedringhChatThread from '@/components/ui/friends/BedringhChatThread.vue'
import ModalWrapper from '@/components/ui/modal/ModalWrapper.vue'
import { useRootBreadcrumb } from '@/providers/breadcrumbs'
import {
	type BedringhFriend,
	cancelFriendRequest,
	createChatRoom,
	openChatTarget,
	refreshFriendsList,
	removeFriend,
	respondFriendRequest,
	searchBedringhUsers,
	sendFriendRequest,
	setPendingPlayInvite,
	startFriendsPolling,
	useBedringhFriends,
} from '@/services/bedringh-friends'
import { quickJoinServer, triggerPlayInvite } from '@/services/bedringh-play-invite'
import { resolveActiveBedringhUser } from '@/services/bedringh-settings-sync'

useRootBreadcrumb({
	slot: 'root',
	id: 'social-chats',
	label: 'Друзья и Чаты',
	to: '/chats',
	visual: { type: 'icon', component: MessagesSquareIcon },
})

const router = useRouter()
const route = useRoute()
const { addNotification } = injectNotificationManager()
const formatRelativeTime = useRelativeTime()

const openBedringhAuthModal = inject<(mode?: 'login' | 'register') => void>(
	'openBedringhAuthModal',
	() => {
		window.dispatchEvent(new CustomEvent('open-bedringh-auth', { detail: { mode: 'login' } }))
	},
)

const {
	state,
	totalIncoming,
	totalUnreadMessages,
	inGameFriends,
	onlineFriends,
} = useBedringhFriends()

type LeftTab = 'chats' | 'friends' | 'requests'
const leftTabs: LeftTab[] = ['chats', 'friends', 'requests']
const activeTab = ref<LeftTab>('chats')

type SortMode = 'now' | 'hours'
const sortOptions: SortMode[] = ['now', 'hours']
const sortMode = ref<SortMode>('now')

function formatLeftTab(tab: LeftTab): string {
	switch (tab) {
		case 'chats':
			return totalUnreadMessages.value > 0 ? `Чаты (${totalUnreadMessages.value})` : 'Чаты'
		case 'friends':
			return `Друзья (${state.friends.length})`
		case 'requests':
			return totalIncoming.value > 0 ? `Заявки (${totalIncoming.value})` : 'Заявки'
	}
}

function formatSortOption(opt: SortMode): string {
	return opt === 'now' ? 'Активные' : 'По часам'
}

const searchQuery = ref('')
const searchResults = ref<{ username: string; avatarUrl?: string }[]>([])
const similarResults = ref<{ username: string; avatarUrl?: string }[]>([])
const searchingServer = ref(false)
let searchDebounce: ReturnType<typeof setTimeout> | null = null

// Модалка создания группового чата (через родной ModalWrapper)
const createRoomModal = ref<InstanceType<typeof ModalWrapper> | null>(null)
const newRoomTitle = ref('')
const selectedRoomMembers = ref<string[]>([])

// Родная модалка приглашения игроков Modrinth (@modrinth/ui InvitePlayersModal)
const invitePlayersModal = ref<InstanceType<typeof InvitePlayersModal> | null>(null)
const invitedUsernames = ref<Set<string>>(new Set())

const inviteModalFriends = computed<InvitePlayersUser[]>(() =>
	state.friends.map((f) => ({
		id: f.username,
		username: f.username,
		avatarUrl: getAvatarUrl(f),
		online: f.status === 'online' || f.status === 'in_game',
		status: invitedUsernames.value.has(f.username.toLowerCase()) ? 'added' : 'available',
	})),
)

async function searchUsersForInviteModal(query: string): Promise<InvitePlayersSearchUser[]> {
	const res = await searchBedringhUsers(query)
	return [...res.users, ...res.similar].map((u) => ({
		id: u.username,
		username: u.username,
		avatarUrl: u.avatarUrl || `https://mc-heads.net/avatar/${encodeURIComponent(u.username)}/32`,
	}))
}

async function handleInviteFromModal(payload: InvitePlayersInvitePayload) {
	const targetNick = payload.user.username
	invitedUsernames.value = new Set(invitedUsernames.value).add(targetNick.toLowerCase())
	if (payload.source === 'search') {
		await sendFriendRequest(targetNick).catch(() => {})
	}
	await triggerPlayInvite(
		{
			type: 'dm',
			id: targetNick,
			title: targetNick,
		},
		{
			navigateToServers: () => {
				invitePlayersModal.value?.hide()
				void router.push('/hosting/manage/')
			},
			openChat: (target) => {
				invitePlayersModal.value?.hide()
				void handleSelectDialog(target)
			},
			notify: (n) =>
				addNotification({
					title: n.title,
					text: n.text,
					type: n.type || 'info',
				}),
		},
	)
}

watch(searchQuery, (q) => {
	if (searchDebounce) clearTimeout(searchDebounce)
	const trimmed = q.trim()
	if (trimmed.length < 2 || !state.activeUsername) {
		searchResults.value = []
		similarResults.value = []
		searchingServer.value = false
		return
	}
	searchingServer.value = true
	searchDebounce = setTimeout(async () => {
		const res = await searchBedringhUsers(trimmed)
		const existingSet = new Set(state.friends.map((f) => f.username.toLowerCase()))
		searchResults.value = res.users.filter((u) => !existingSet.has(u.username.toLowerCase()))
		similarResults.value = res.similar.filter((u) => !existingSet.has(u.username.toLowerCase()))
		searchingServer.value = false
	}, 280)
})

interface UnifiedDialogItem {
	key: string
	type: 'dm' | 'room'
	id: string
	title: string
	avatarUrl?: string
	status?: BedringhFriend['status']
	gameInfo?: BedringhFriend['gameInfo']
	unread: number
	lastMessage?: string
	lastMessageSender?: string
	lastMessageAt: number
}

function getAvatarUrl(userOrName: string | BedringhFriend): string {
	const name = typeof userOrName === 'string' ? userOrName : userOrName.username
	const custom = typeof userOrName !== 'string' ? userOrName.avatarUrl : undefined
	return custom || `https://mc-heads.net/avatar/${encodeURIComponent(name)}/64`
}

const unifiedDialogs = computed<UnifiedDialogItem[]>(() => {
	const items: UnifiedDialogItem[] = []

	for (const r of state.rooms) {
		items.push({
			key: `room:${r.id}`,
			type: 'room',
			id: r.id,
			title: r.title,
			unread: r.unread || 0,
			lastMessage: r.lastMessage,
			lastMessageSender: r.lastMessageSender,
			lastMessageAt: r.lastMessageAt || r.createdAt || 0,
		})
	}

	for (const f of state.friends) {
		const dmKey = `dm:${f.username.toLowerCase()}`
		const history = state.messagesByKey[dmKey]
		let lastMsg = f.lastMessage
		let lastMsgAt = f.lastMessageAt || f.lastSeen || 0

		if (history && history.length > 0) {
			const valid = [...history].reverse().find((m) => (m.content || '').trim().length > 0)
			if (valid) {
				lastMsg = valid.content.trim()
				lastMsgAt = valid.createdAt
			}
		}

		if (lastMsg === 'Изображение' || lastMsg === 'Голосовое сообщение') {
			lastMsg = undefined
		}

		items.push({
			key: dmKey,
			type: 'dm',
			id: f.username,
			title: f.username,
			avatarUrl: getAvatarUrl(f),
			status: f.status,
			gameInfo: f.gameInfo,
			unread: f.unread || 0,
			lastMessage: lastMsg,
			lastMessageSender: f.lastMessageSender,
			lastMessageAt: lastMsgAt,
		})
	}

	const q = searchQuery.value.trim().toLowerCase()
	const filtered = q ? items.filter((i) => i.title.toLowerCase().includes(q)) : items

	return filtered.sort((a, b) => {
		if (a.unread !== b.unread) return b.unread - a.unread
		return b.lastMessageAt - a.lastMessageAt
	})
})

const sortedFriendsForTab = computed<BedringhFriend[]>(() => {
	const q = searchQuery.value.trim().toLowerCase()
	const base = q
		? state.friends.filter((f) => f.username.toLowerCase().includes(q))
		: [...state.friends]

	if (sortMode.value === 'hours') {
		return base.sort((a, b) => (b.totalHours || 0) - (a.totalHours || 0))
	}

	const rank = (s: BedringhFriend['status']) =>
		s === 'in_game' ? 0 : s === 'online' ? 1 : 2

	return base.sort((a, b) => {
		const rDiff = rank(a.status) - rank(b.status)
		if (rDiff !== 0) return rDiff
		return a.username.localeCompare(b.username)
	})
})

const canDirectAddNick = computed(() => {
	const q = searchQuery.value.trim()
	if (q.length < 3 || !/^[a-zA-Z0-9_]{3,16}$/.test(q)) return null
	if (state.activeUsername && q.toLowerCase() === state.activeUsername.toLowerCase()) return null
	const existsInFriends = state.friends.some(
		(f) => f.username.toLowerCase() === q.toLowerCase(),
	)
	if (existsInFriends) return null
	return q
})

async function handleSelectDialog(target: { type: 'dm' | 'room'; id: string }) {
	await openChatTarget(target)
}

async function handleAddFriendByNick(nick: string) {
	try {
		const res = await sendFriendRequest(nick)
		addNotification({
			title: 'Друзья Bedringh ID',
			text: res.message || `Заявка отправлена игроку ${nick}`,
			type: 'success',
		})
		searchQuery.value = ''
		await refreshFriendsList(true)
	} catch (e: any) {
		addNotification({
			title: 'Ошибка',
			text: e?.message || 'Не удалось отправить заявку',
			type: 'error',
		})
	}
}

async function handleAcceptRequest(id: string, username: string) {
	const ok = await respondFriendRequest(id, 'accept')
	if (ok) {
		addNotification({
			title: 'Друзья Bedringh ID',
			text: `Вы и ${username} теперь друзья`,
			type: 'success',
		})
	}
}

async function handleInviteFriend(friend: BedringhFriend) {
	await triggerPlayInvite(
		{
			type: 'dm',
			id: friend.username,
			title: friend.username,
		},
		{
			navigateToServers: () => void router.push('/hosting/manage/'),
			openChat: (target) => void handleSelectDialog(target),
			notify: (n) =>
				addNotification({
					title: n.title,
					text: n.text,
					type: n.type || 'info',
				}),
		},
	)
}

async function handleJoinFriend(friend: BedringhFriend) {
	if (!friend.gameInfo?.serverAddress) return
	await quickJoinServer(
		{
			addr: friend.gameInfo.serverAddress,
			name: friend.gameInfo.serverName || friend.gameInfo.instanceName || friend.username,
			version: friend.gameInfo.mcVersion,
			loader: friend.gameInfo.loader,
			packCode: friend.gameInfo.packCode,
		},
		(n) =>
			addNotification({
				title: n.title,
				text: n.text,
				type: n.type || 'info',
			}),
	)
}

function openCreateRoomModal() {
	newRoomTitle.value = ''
	selectedRoomMembers.value = []
	createRoomModal.value?.show()
}

async function handleCreateRoom() {
	if (!newRoomTitle.value.trim()) return
	const room = await createChatRoom(newRoomTitle.value.trim(), selectedRoomMembers.value)
	if (room) {
		createRoomModal.value?.hide()
		newRoomTitle.value = ''
		selectedRoomMembers.value = []
		await handleSelectDialog({ type: 'room', id: room.id })
		addNotification({
			title: 'Группа создана',
			text: `Групповой чат «${room.title}» готов к общению!`,
			type: 'success',
		})
	}
}

function toggleRoomMember(username: string) {
	const idx = selectedRoomMembers.value.indexOf(username)
	if (idx >= 0) selectedRoomMembers.value.splice(idx, 1)
	else selectedRoomMembers.value.push(username)
}

async function handleSocialAccountChanged() {
	searchQuery.value = ''
	searchResults.value = []
	similarResults.value = []
	await resolveActiveBedringhUser()
	if (!state.activeUsername) {
		await openChatTarget(null)
		return
	}
	if (unifiedDialogs.value.length > 0) {
		const first = unifiedDialogs.value[0]
		await openChatTarget({ type: first.type, id: first.id })
	} else {
		await openChatTarget(null)
	}
}

onMounted(async () => {
	window.addEventListener('bedringh:account-changed', handleSocialAccountChanged)
	await resolveActiveBedringhUser()
	startFriendsPolling()
	if (!state.activeUsername) return

	const peerQuery = typeof route.query.peer === 'string' ? route.query.peer : ''
	const roomQuery = typeof route.query.room === 'string' ? route.query.room : ''
	if (peerQuery) {
		await openChatTarget({ type: 'dm', id: peerQuery })
	} else if (roomQuery) {
		await openChatTarget({ type: 'room', id: roomQuery })
	} else if (!state.activeChatTarget && unifiedDialogs.value.length > 0) {
		const first = unifiedDialogs.value[0]
		await openChatTarget({ type: first.type, id: first.id })
	}
})

onUnmounted(() => {
	window.removeEventListener('bedringh:account-changed', handleSocialAccountChanged)
})
</script>

<template>
	<div class="p-6 max-w-[1400px] mx-auto w-full h-[calc(100vh-3.5rem)] box-border flex flex-col gap-4">
		<!-- 1. Если НЕ выполнен вход в Bedringh ID — родной EmptyState из @modrinth/ui (как в AccountSocialSettings.vue) -->
		<div
			v-if="!state.activeUsername"
			class="card-shadow bg-bg-raised rounded-2xl border border-solid border-surface-5/70 flex-1 flex items-center justify-center p-8"
			style="border-color: var(--color-divider);"
		>
			<EmptyState
				type="empty"
				class="[&>div:last-child]:!mt-6"
				heading="Требуется аккаунт Bedringh ID"
				description="Войдите в свой аккаунт Bedringh ID, чтобы добавлять друзей, общаться в чатах, создавать групповые комнаты и приглашать друзей в открытые миры в 1 клик."
			>
				<template #illustration>
					<div class="relative mb-4 h-[200px]">
						<img :src="ThinkingRinthbot" alt="" class="h-full w-auto object-contain" />
						<div
							class="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-bg-raised to-transparent"
						/>
					</div>
				</template>
				<template #actions>
					<Button
						type="colored"
						color="brand"
						size="xl"
						native-type="button"
						@click="openBedringhAuthModal('login')"
					>
						<LogInIcon aria-hidden="true" />
						Войти в Bedringh ID
					</Button>
				</template>
			</EmptyState>
		</div>

		<!-- 2. Авторизован в Bedringh ID -->
		<template v-else>
			<!-- Модалка создания группового чата на базе родного ModalWrapper -->
			<ModalWrapper ref="createRoomModal" header="Создать групповую комнату">
				<div class="flex flex-col gap-4 min-w-[28rem]">
					<div class="flex flex-col gap-1.5">
						<label class="text-sm font-semibold text-contrast">Название группы</label>
						<Input
							v-model="newRoomTitle"
							type="text"
							placeholder="Например: Выживание на сборке..."
							@keyup.enter="handleCreateRoom"
						/>
					</div>

					<div class="flex flex-col gap-2">
						<label class="text-sm font-semibold text-contrast">
							Выберите друзей ({{ selectedRoomMembers.length }})
						</label>
						<div
							v-if="state.friends.length === 0"
							class="p-4 rounded-xl bg-surface-2 text-sm text-secondary text-center"
						>
							Добавьте друзей в список, чтобы приглашать их в групповые комнаты.
						</div>
						<div v-else class="flex flex-col gap-1 max-h-56 overflow-y-auto pr-1">
							<div
								v-for="fr in state.friends"
								:key="fr.username"
								class="flex items-center justify-between gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors"
								:class="
									selectedRoomMembers.includes(fr.username)
										? 'bg-brand/15 border border-solid border-brand/40 text-contrast'
										: 'hover:bg-button-bg border border-solid border-transparent text-primary'
								"
								@click="toggleRoomMember(fr.username)"
							>
								<div class="flex items-center gap-2.5 min-w-0">
									<UserAvatar
										:src="getAvatarUrl(fr)"
										size="28px"
										:badge="fr.status !== 'offline'"
									/>
									<span class="text-sm font-medium truncate">{{ fr.username }}</span>
								</div>
								<CheckIcon v-if="selectedRoomMembers.includes(fr.username)" class="w-4 h-4 text-brand shrink-0" />
							</div>
						</div>
					</div>

					<div class="flex justify-end gap-2 pt-2">
						<Button type="outlined" @click="createRoomModal?.hide()">
							Отмена
						</Button>
						<Button
							type="colored"
							color="brand"
							:disabled="!newRoomTitle.trim()"
							@click="handleCreateRoom"
						>
							<PlusIcon />
							Создать комнату
						</Button>
					</div>
				</div>
			</ModalWrapper>

			<!-- Родная модалка приглашения игроков из @modrinth/ui -->
			<InvitePlayersModal
				ref="invitePlayersModal"
				header="Пригласить друзей в игру"
				:friends="inviteModalFriends"
				:search-users="searchUsersForInviteModal"
				search-placeholder="Введите никнейм Bedringh ID..."
				add-label="Пригласить"
				invite-label="Позвать"
				added-label="Отправлено"
				empty-friends-label="Список друзей пока пуст."
				@invite="handleInviteFromModal"
			/>

			<!-- Баннер отложенного приглашения в стиле Modrinth -->
			<div
				v-if="state.pendingPlayInvite"
				class="card-shadow flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-bg-raised border border-solid border-brand/40"
			>
				<div class="flex items-center gap-2.5 min-w-0">
					<ServerStackIcon class="w-5 h-5 text-brand shrink-0" />
					<span class="text-sm text-primary truncate">
						Приглашение для <strong class="text-contrast">{{ state.pendingPlayInvite.title }}</strong> будет отправлено автоматически, как только вы откроете мир для сети.
					</span>
				</div>
				<div class="flex items-center gap-2 shrink-0">
					<Button type="colored" color="brand" size="sm" @click="router.push('/hosting/manage/')">
						<PlayIcon />
						Открыть серверы
					</Button>
					<IconButton
						type="quiet"
						label="Отменить приглашение"
						@click="setPendingPlayInvite(null)"
					>
						<XIcon />
					</IconButton>
				</div>
			</div>

			<!-- Двухпанельный макет в стиле карточек Modrinth -->
			<div class="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-3.5 flex-1 min-h-0">
				<!-- Левая карточка: навигация, поиск и список диалогов/друзей -->
				<div
					class="flex flex-col bg-surface-2 border border-solid border-surface-5/70 rounded-2xl overflow-hidden min-h-0 shadow-sm"
					style="border-radius: 1rem; border-color: var(--color-divider);"
				>
					<!-- Верхняя шапка с родными Chips и кнопками действий (плавно скруглённая вверху) -->
					<div
						class="flex flex-col gap-3 p-4 border-0 border-b border-solid border-surface-5/70 rounded-t-2xl shrink-0"
						style="border-top-left-radius: 1rem; border-top-right-radius: 1rem; border-top: 0; border-left: 0; border-right: 0; border-bottom: 1px solid var(--color-divider);"
					>
						<div class="flex items-center justify-between gap-2 min-w-0">
							<Chips
								:model-value="activeTab"
								:items="leftTabs"
								:format-label="formatLeftTab"
								:capitalize="false"
								size="small"
								hide-checkmark-icon
								aria-label="Разделы социальной панели"
								@update:model-value="(v) => v && (activeTab = v)"
							/>
							<div class="flex items-center gap-1 shrink-0">
								<IconButton
									v-tooltip="'Пригласить друзей в игру'"
									type="outlined"
									size="sm"
									label="Пригласить друзей в игру"
									@click="invitePlayersModal?.show()"
								>
									<ShareIcon />
								</IconButton>
								<IconButton
									v-tooltip="'Создать групповую комнату'"
									type="outlined"
									size="sm"
									label="Создать групповую комнату"
									@click="openCreateRoomModal"
								>
									<PlusIcon />
								</IconButton>
							</div>
						</div>

						<!-- Родной Input поиска из @modrinth/ui -->
						<Input
							v-model="searchQuery"
							:icon="SearchIcon"
							type="text"
							placeholder="Поиск друзей или ник в Bedringh ID..."
							clearable
							@keyup.esc="searchQuery = ''"
							@keyup.enter="canDirectAddNick && handleAddFriendByNick(canDirectAddNick)"
						/>

						<!-- Выпадающие подсказки поиска игроков Bedringh ID -->
						<div
							v-if="searchQuery.trim().length >= 2 && (canDirectAddNick || searchResults.length > 0 || similarResults.length > 0)"
							class="flex flex-col gap-1.5 p-2.5 rounded-xl bg-surface-2 border border-solid border-surface-5/70"
							style="border-color: var(--color-divider);"
						>
							<div
								v-if="canDirectAddNick"
								class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-button-bg"
							>
								<span class="text-xs text-primary truncate">
									Отправить заявку: <strong class="text-contrast">{{ canDirectAddNick }}</strong>
								</span>
								<Button
									type="colored"
									color="brand"
									size="sm"
									@click="handleAddFriendByNick(canDirectAddNick)"
								>
									<UserPlusIcon />
									Добавить
								</Button>
							</div>

							<div v-if="searchResults.length > 0" class="flex flex-col gap-1">
								<span class="text-[11px] font-semibold text-secondary px-1">Игроки Bedringh ID</span>
								<div
									v-for="u in searchResults"
									:key="u.username"
									class="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-button-bg transition-colors"
								>
									<div class="flex items-center gap-2 min-w-0">
										<Avatar :src="getAvatarUrl(u.username)" size="24px" circle no-shadow />
										<span class="text-sm font-medium text-contrast truncate">{{ u.username }}</span>
									</div>
									<Button type="quiet" size="sm" @click="handleAddFriendByNick(u.username)">
										<UserPlusIcon />
										Добавить
									</Button>
								</div>
							</div>

							<div v-if="similarResults.length > 0" class="flex flex-col gap-1">
								<span class="text-[11px] font-semibold text-secondary px-1">Похожие ники</span>
								<div
									v-for="u in similarResults"
									:key="u.username"
									class="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-button-bg transition-colors"
								>
									<div class="flex items-center gap-2 min-w-0">
										<Avatar :src="getAvatarUrl(u.username)" size="24px" circle no-shadow />
										<span class="text-sm text-primary truncate">{{ u.username }}</span>
									</div>
									<Button type="quiet" size="sm" @click="handleAddFriendByNick(u.username)">
										<UserPlusIcon />
										Добавить
									</Button>
								</div>
							</div>
						</div>
					</div>

					<!-- 1) Вкладка: ЧАТЫ -->
					<div v-if="activeTab === 'chats'" class="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
						<div
							v-if="unifiedDialogs.length === 0"
							class="m-auto text-center p-6 text-secondary flex flex-col items-center gap-2"
						>
							<UsersIcon class="w-8 h-8 opacity-40" />
							<span class="text-sm">У вас пока нет активных диалогов.</span>
							<span class="text-xs">Найдите друга по нику в строке поиска выше!</span>
						</div>

						<div
							v-for="d in unifiedDialogs"
							:key="d.key"
							class="group flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors select-none"
							:class="
								state.activeChatTarget?.type === d.type &&
								state.activeChatTarget?.id.toLowerCase() === d.id.toLowerCase()
									? 'bg-button-bg border border-solid border-surface-5'
									: 'hover:bg-button-bg/60 border border-solid border-transparent'
							"
							@click="handleSelectDialog({ type: d.type, id: d.id })"
						>
							<div class="flex items-center gap-3 min-w-0 flex-1">
								<div
									v-if="d.type === 'room'"
									class="w-10 h-10 rounded-full bg-brand/15 text-brand flex items-center justify-center shrink-0"
								>
									<UsersIcon class="w-5 h-5" />
								</div>
								<UserAvatar
									v-else
									:src="d.avatarUrl"
									size="40px"
									:badge="d.status === 'online' || d.status === 'in_game'"
									:grayscale="d.status === 'offline' || !d.status"
								>
									<span
										v-if="d.status === 'in_game'"
										class="block size-full rounded-full bg-purple-500"
									/>
								</UserAvatar>

								<div class="flex flex-col min-w-0 flex-1">
									<div class="flex items-center justify-between gap-1">
										<span class="text-sm font-semibold text-contrast truncate">{{ d.title }}</span>
										<span v-if="d.lastMessageAt" class="text-xs text-secondary shrink-0">
											{{ new Date(d.lastMessageAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }}
										</span>
									</div>
									<div class="flex items-center justify-between gap-1.5 mt-0.5">
										<span
											v-if="d.status === 'in_game' && !d.lastMessage"
											class="text-xs text-brand truncate flex items-center gap-1"
										>
											<GameIcon class="w-3 h-3 shrink-0" />
											<span class="truncate">{{ d.gameInfo?.serverName || d.gameInfo?.instanceName || 'В игре' }}</span>
										</span>
										<span v-else class="text-xs text-secondary truncate">
											{{ d.lastMessage || (d.type === 'room' ? 'Групповая комната' : 'Нажмите, чтобы написать') }}
										</span>
										<span
											v-if="d.unread > 0"
											class="px-1.5 rounded-full bg-brand text-brand-inverted text-[10px] font-bold shrink-0"
										>
											{{ d.unread > 9 ? '9+' : d.unread }}
										</span>
									</div>
								</div>
							</div>
						</div>
					</div>

					<!-- 2) Вкладка: ДРУЗЬЯ -->
					<div v-else-if="activeTab === 'friends'" class="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
						<div class="flex items-center justify-between gap-2 px-1">
							<span class="text-xs font-medium text-secondary">
								В игре: {{ inGameFriends.length }} · В сети: {{ onlineFriends.length }}
							</span>
							<Chips
								:model-value="sortMode"
								:items="sortOptions"
								:format-label="formatSortOption"
								:capitalize="false"
								aria-label="Сортировка друзей"
								@update:model-value="(v) => v && (sortMode = v)"
							/>
						</div>

						<div
							v-if="sortedFriendsForTab.length === 0"
							class="m-auto text-center p-6 text-secondary flex flex-col items-center gap-2"
						>
							<UsersIcon class="w-8 h-8 opacity-40" />
							<span class="text-sm">Список друзей пуст</span>
						</div>

						<div
							v-for="fr in sortedFriendsForTab"
							:key="fr.username"
							class="flex flex-col gap-2.5 p-3 rounded-xl bg-surface-2 border border-solid border-surface-5/70"
							style="border-color: var(--color-divider);"
						>
							<div class="flex items-center justify-between gap-2">
								<div class="flex items-center gap-2.5 min-w-0">
									<UserAvatar
										:src="getAvatarUrl(fr)"
										size="36px"
										:badge="fr.status === 'online' || fr.status === 'in_game'"
										:grayscale="fr.status === 'offline' || !fr.status"
									>
										<span
											v-if="fr.status === 'in_game'"
											class="block size-full rounded-full bg-purple-500"
										/>
									</UserAvatar>
									<div class="flex flex-col min-w-0">
										<div class="flex items-center gap-1.5">
											<span class="text-sm font-semibold text-contrast truncate">{{ fr.username }}</span>
											<span
												v-if="fr.totalHours"
												class="px-1.5 py-0.5 rounded-md bg-button-bg text-[10px] font-semibold text-secondary shrink-0"
											>
												{{ fr.totalHours }} ч
											</span>
										</div>
										<span v-if="fr.status === 'in_game'" class="text-xs text-brand truncate flex items-center gap-1">
											<GameIcon class="w-3 h-3 shrink-0" />
											<span class="truncate">{{ fr.gameInfo?.serverName || fr.gameInfo?.instanceName || 'В игре' }}</span>
										</span>
										<span v-else-if="fr.status === 'online'" class="text-xs text-secondary">
											В сети
										</span>
										<span v-else class="text-xs text-secondary truncate">
											{{
												fr.lastSeen
													? `Был(а) ${formatRelativeTime(new Date(fr.lastSeen).toISOString())}`
													: 'Не в сети'
											}}
										</span>
									</div>
								</div>

								<TeleportOverflowMenu
									type="quiet"
									label="Действия"
									:options="[
										{
											id: 'remove-friend',
											label: 'Удалить из друзей',
											icon: TrashIcon,
											tone: 'red',
											action: () => removeFriend(fr.username),
										},
									]"
								>
									<MoreVerticalIcon />
								</TeleportOverflowMenu>
							</div>

							<div class="grid grid-cols-2 gap-2">
								<Button
									v-if="fr.status === 'in_game' && fr.gameInfo?.serverAddress"
									type="colored"
									color="brand"
									size="sm"
									class="w-full justify-center"
									@click="handleJoinFriend(fr)"
								>
									<PlayIcon />
									Присоединиться
								</Button>
								<Button
									v-else
									type="outlined"
									size="sm"
									class="w-full justify-center"
									@click="handleInviteFriend(fr)"
								>
									<ServerStackIcon />
									Позвать в игру
								</Button>

								<Button
									type="outlined"
									size="sm"
									class="w-full justify-center"
									@click="
										handleSelectDialog({ type: 'dm', id: fr.username });
										activeTab = 'chats'
									"
								>
									<SendIcon />
									Написать
								</Button>
							</div>
						</div>
					</div>

					<!-- 3) Вкладка: ЗАЯВКИ -->
					<div v-else class="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
						<div class="flex flex-col gap-2">
							<h4 class="m-0 text-xs font-semibold uppercase tracking-wider text-secondary px-1">
								Входящие заявки ({{ state.incomingRequests.length }})
							</h4>
							<div
								v-if="state.incomingRequests.length === 0"
								class="p-4 rounded-xl bg-surface-2 text-center text-sm text-secondary"
							>
								Новых входящих заявок нет
							</div>
							<div
								v-for="req in state.incomingRequests"
								:key="req.id"
								class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-surface-2 border border-solid border-surface-5/70"
								style="border-color: var(--color-divider);"
							>
								<div class="flex items-center gap-2.5 min-w-0">
									<Avatar :src="getAvatarUrl(req.username)" size="32px" circle no-shadow />
									<div class="flex flex-col min-w-0">
										<span class="text-sm font-semibold text-contrast truncate">{{ req.username }}</span>
										<span class="text-xs text-secondary">
											{{ formatRelativeTime(new Date(req.createdAt).toISOString()) }}
										</span>
									</div>
								</div>
								<div class="flex items-center gap-1.5">
									<Button
										type="colored"
										color="brand"
										size="sm"
										@click="handleAcceptRequest(req.id, req.username)"
									>
										<UserPlusIcon />
										Принять
									</Button>
									<IconButton
										type="quiet"
										label="Отклонить"
										@click="respondFriendRequest(req.id, 'reject')"
									>
										<XIcon />
									</IconButton>
								</div>
							</div>
						</div>

						<div v-if="state.outgoingRequests.length > 0" class="flex flex-col gap-2">
							<h4 class="m-0 text-xs font-semibold uppercase tracking-wider text-secondary px-1">
								Отправленные ({{ state.outgoingRequests.length }})
							</h4>
							<div
								v-for="req in state.outgoingRequests"
								:key="req.id"
								class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-surface-2 border border-solid border-surface-5/70"
								style="border-color: var(--color-divider);"
							>
								<div class="flex items-center gap-2.5 min-w-0">
									<Avatar :src="getAvatarUrl(req.username)" size="32px" circle no-shadow />
									<span class="text-sm font-medium text-contrast truncate">{{ req.username }}</span>
								</div>
								<Button type="outlined" size="sm" @click="cancelFriendRequest(req.id)">
									<XIcon />
									Отменить
								</Button>
							</div>
						</div>
					</div>
				</div>

				<!-- Правая карточка: Активный чат BedringhChatThread или родной EmptyState -->
				<div class="flex flex-col min-h-0 h-full rounded-2xl overflow-hidden shadow-sm" style="border-radius: 1rem;">
					<BedringhChatThread
						v-if="state.activeChatTarget"
						:target="state.activeChatTarget"
					/>
					<div
						v-else
						class="h-full bg-surface-2 border border-solid border-surface-5/70 rounded-2xl flex flex-col items-center justify-center text-center p-8 gap-4 text-secondary shadow-sm"
						style="border-radius: 1rem; border-color: var(--color-divider);"
					>
						<NoMessagesIllustration class="w-36 h-36 opacity-80" />
						<div class="flex flex-col gap-1 max-w-sm">
							<h3 class="m-0 text-lg font-semibold text-contrast">Выберите диалог</h3>
							<p class="m-0 text-sm text-secondary">
								Выберите друга или групповую комнату слева, чтобы начать общение, обменяться скриншотами или отправить приглашение на сервер.
							</p>
						</div>
						<Button type="outlined" @click="invitePlayersModal?.show()">
							<ShareIcon />
							Пригласить друзей в игру
						</Button>
					</div>
				</div>
			</div>
		</template>
	</div>
</template>
