<script setup lang="ts">
import {
	CopyIcon,
	ExternalIcon,
	GameIcon,
	MailIcon,
	MessagesSquareIcon,
	MoreVerticalIcon,
	PlayIcon,
	SearchIcon,
	SendIcon,
	ServerStackIcon,
	TrashIcon,
	UserIcon,
	UserPlusIcon,
	XIcon,
} from '@modrinth/assets'
import type { ButtonMenuOption } from '@modrinth/ui'
import {
	Accordion,
	Avatar,
	Button,
	ContextMenu,
	defineMessages,
	IconButton,
	injectNotificationManager,
	Input,
	TeleportOverflowMenu,
	UserAvatar,
	useRelativeTime,
	useVIntl,
} from '@modrinth/ui'
import { computed, inject, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useRouter } from 'vue-router'

import BedringhChatThread from '@/components/ui/friends/BedringhChatThread.vue'
import ModalWrapper from '@/components/ui/modal/ModalWrapper.vue'
import { useAppSettings } from '@/composables/use-app-settings.ts'
import { get as getSettings, set as setSettings } from '@/helpers/settings.ts'
import {
	type BedringhFriend,
	cancelFriendRequest,
	type FriendRequest,
	openChatTarget,
	refreshFriendsList,
	removeFriend as removeFriendApi,
	respondFriendRequest,
	searchBedringhUsers,
	sendFriendRequest,
	startFriendsPolling,
	useBedringhFriends,
} from '@/services/bedringh-friends'
import { quickJoinServer, triggerPlayInvite } from '@/services/bedringh-play-invite'
import { resolveActiveBedringhUser } from '@/services/bedringh-settings-sync'

const props = defineProps<{
	signIn?: () => void
}>()

const openBedringhAuthModal = inject<(mode?: 'login' | 'register') => void>(
	'openBedringhAuthModal',
	() => {},
)

function handleSignIn() {
	if (props.signIn) {
		props.signIn()
	} else {
		openBedringhAuthModal('login')
	}
}

const router = useRouter()
const { formatMessage } = useVIntl()
const { handleError, addNotification } = injectNotificationManager()
const formatRelativeTime = useRelativeTime()
const appSettings = useAppSettings()
const friendOptions = useTemplateRef('friendOptions')

const {
	state,
	totalUnreadMessages,
} = useBedringhFriends()

// Мини-чат прямо внутри правого сайдбара
const inlineChatTarget = ref<{ type: 'dm' | 'room'; id: string } | null>(null)

onMounted(async () => {
	await resolveActiveBedringhUser()
	startFriendsPolling()
})

watch(
	() => state.activeUsername,
	(active) => {
		if (!active) {
			inlineChatTarget.value = null
		}
	},
)

type FriendsSectionCollapsedFlag =
	| 'friends_active_collapsed'
	| 'friends_online_collapsed'
	| 'friends_offline_collapsed'
	| 'friends_pending_collapsed'

function isFriendsSectionCollapsed(flag: FriendsSectionCollapsedFlag) {
	return appSettings.getFeatureFlag(flag)
}

function setFriendsSectionCollapsed(flag: FriendsSectionCollapsedFlag, collapsed: boolean) {
	appSettings.featureFlags[flag] = collapsed
	getSettings()
		.then((settings) => {
			settings.feature_flags[flag] = collapsed
			return setSettings(settings)
		})
		.catch(handleError)
}

const search = ref('')
const modalSearchSuggestions = ref<{ username: string; avatarUrl?: string }[]>([])
let lookupTimer: ReturnType<typeof setTimeout> | null = null

const friendInvitesModal = ref()
const addFriendModal = ref()
const username = ref('')
const addingFriendLoading = ref(false)

watch(username, (q) => {
	if (lookupTimer) clearTimeout(lookupTimer)
	const trimmed = q.trim()
	if (trimmed.length < 2) {
		modalSearchSuggestions.value = []
		return
	}
	lookupTimer = setTimeout(async () => {
		const res = await searchBedringhUsers(trimmed)
		const existingSet = new Set(state.friends.map((f) => f.username.toLowerCase()))
		modalSearchSuggestions.value = [...res.users, ...res.similar].filter(
			(u) => !existingSet.has(u.username.toLowerCase()),
		)
	}, 280)
})

const sortedFriends = computed<BedringhFriend[]>(() => {
	return state.friends.slice().sort((a, b) => {
		if ((b.unread || 0) !== (a.unread || 0)) return (b.unread || 0) - (a.unread || 0)
		return a.username.localeCompare(b.username)
	})
})

const filteredFriends = computed<BedringhFriend[]>(() => {
	const q = search.value.trim().toLowerCase()
	if (!q) return sortedFriends.value
	return sortedFriends.value.filter((x) => x.username.toLowerCase().includes(q))
})

const activeFriends = computed<BedringhFriend[]>(() =>
	filteredFriends.value.filter((x) => x.status === 'in_game'),
)

const onlineFriends = computed<BedringhFriend[]>(() =>
	filteredFriends.value.filter((x) => x.status === 'online'),
)

const offlineFriends = computed<BedringhFriend[]>(() =>
	filteredFriends.value.filter((x) => x.status === 'offline' || !x.status),
)

const incomingRequests = computed<FriendRequest[]>(() => state.incomingRequests)

const pendingFriends = computed<FriendRequest[]>(() => {
	const q = search.value.trim().toLowerCase()
	if (!q) return state.outgoingRequests
	return state.outgoingRequests.filter((x) => x.username.toLowerCase().includes(q))
})

async function quickAddFriend(targetNick: string) {
	const target = targetNick.trim()
	if (!target || addingFriendLoading.value) return

	addingFriendLoading.value = true
	try {
		const res = await sendFriendRequest(target)
		addNotification({
			type: 'success',
			title: formatMessage(messages.addingAFriend),
			text: res.message || `Заявка в друзья отправлена игроку ${target}`,
		})
		addFriendModal.value?.hide()
		username.value = ''
		modalSearchSuggestions.value = []
		await refreshFriendsList(true)
	} catch (e: any) {
		addNotification({
			type: 'error',
			title: 'Ошибка',
			text: e?.message || 'Не удалось отправить заявку в друзья',
		})
	} finally {
		addingFriendLoading.value = false
	}
}

async function addFriendFromModal() {
	await quickAddFriend(username.value)
}

function showAddFriendModal() {
	if (!state.activeUsername) {
		handleSignIn()
		return
	}
	username.value = ''
	modalSearchSuggestions.value = []
	addFriendModal.value?.show()
}

async function openInlineChat(friend: BedringhFriend) {
	const target = { type: 'dm' as const, id: friend.username }
	inlineChatTarget.value = target
	await openChatTarget(target)
}

function openFullMessenger(peerUsername?: string) {
	if (peerUsername) {
		void router.push({ path: '/chats', query: { peer: peerUsername } })
	} else {
		void router.push('/chats')
	}
}

async function handleJoinFriendServer(friend: BedringhFriend) {
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

async function handleInviteFriend(friend: BedringhFriend) {
	await triggerPlayInvite(
		{
			type: 'dm',
			id: friend.username,
			title: friend.username,
		},
		{
			navigateToServers: () => void router.push('/hosting/manage/'),
			openChat: (target) => {
				inlineChatTarget.value = target
				void openChatTarget(target)
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

async function acceptIncomingRequest(request: FriendRequest) {
	const ok = await respondFriendRequest(request.id, 'accept')
	if (ok) {
		addNotification({
			type: 'success',
			title: formatMessage(messages.friends),
			text: `Вы и ${request.username} теперь друзья!`,
		})
		await refreshFriendsList(true)
	}
}

async function rejectIncomingRequest(request: FriendRequest) {
	await respondFriendRequest(request.id, 'reject')
	await refreshFriendsList(true)
}

async function cancelOutgoingRequest(request: FriendRequest) {
	await cancelFriendRequest(request.id)
	await refreshFriendsList(true)
}

async function removeFriendRecord(friend: BedringhFriend) {
	const ok = await removeFriendApi(friend.username)
	if (ok) {
		addNotification({
			type: 'info',
			title: formatMessage(messages.friends),
			text: `${friend.username} удален из списка друзей`,
		})
	}
}

function handleCopyServer(friend: BedringhFriend) {
	if (!friend.gameInfo?.serverAddress) return
	navigator.clipboard.writeText(friend.gameInfo.serverAddress)
	addNotification({
		type: 'success',
		title: 'Скопировано',
		text: `Адрес сервера скопирован: ${friend.gameInfo.serverAddress}`,
	})
}

function getAvatarUrl(userOrName: string | BedringhFriend | FriendRequest): string {
	const name = typeof userOrName === 'string' ? userOrName : userOrName.username
	const customAvatar =
		typeof userOrName !== 'string' && 'avatarUrl' in userOrName ? userOrName.avatarUrl : undefined
	return customAvatar || `https://mc-heads.net/avatar/${encodeURIComponent(name)}/32`
}

function getFriendSubtitle(friend: BedringhFriend): string {
	if (friend.status === 'in_game') {
		return `Играет в ${friend.gameInfo?.serverName || friend.gameInfo?.instanceName || 'Minecraft'}`
	}
	if (friend.lastMessage) {
		return friend.lastMessage
	}
	return friend.status === 'online' ? 'В сети' : ''
}

function createFriendMenuOptions(friend: BedringhFriend): ButtonMenuOption[] {
	const options: ButtonMenuOption[] = [
		{
			id: 'open-chat',
			label: 'Написать сообщение',
			icon: SendIcon,
			action: () => void openInlineChat(friend),
		},
		{
			id: 'open-full-chat',
			label: 'Открыть в мессенджере',
			icon: MessagesSquareIcon,
			action: () => openFullMessenger(friend.username),
		},
	]

	if (friend.gameInfo?.serverAddress) {
		options.push(
			{
				id: 'join-server',
				label: 'Присоединиться к игре',
				icon: PlayIcon,
				action: () => void handleJoinFriendServer(friend),
			},
			{
				id: 'copy-ip',
				label: 'Скопировать IP сервера',
				icon: CopyIcon,
				action: () => handleCopyServer(friend),
			},
		)
	} else {
		options.push({
			id: 'invite-game',
			label: 'Позвать в игру',
			icon: ServerStackIcon,
			action: () => void handleInviteFriend(friend),
		})
	}

	options.push({
		id: 'remove-friend',
		label: formatMessage(messages.removeFriend),
		icon: TrashIcon,
		tone: 'red',
		hoverFilledOnly: true,
		action: () => void removeFriendRecord(friend),
	})

	return options
}

defineExpose({ showAddFriendModal })

const messages = defineMessages({
	addFriend: {
		id: 'friends.action.add-friend',
		defaultMessage: 'Add a friend',
	},
	addingAFriend: {
		id: 'friends.add-friend.title',
		defaultMessage: 'Adding a friend',
	},
	usernameTitle: {
		id: 'bedringh.friends.add-friend.username.title',
		defaultMessage: 'Введите никнейм друга в Bedringh ID',
	},
	usernameDescription: {
		id: 'friends.add-friend.username.description',
		defaultMessage: 'Вы можете найти друга по его нику в системе Bedringh ID.',
	},
	usernamePlaceholder: {
		id: 'bedringh.friends.add-friend.username.placeholder',
		defaultMessage: 'Введите ник Bedringh ID...',
	},
	sendFriendRequest: {
		id: 'friends.add-friend.submit',
		defaultMessage: 'Send friend request',
	},
	viewFriendRequests: {
		id: 'friends.action.view-friend-requests',
		defaultMessage: '{count} friend {count, plural, one {request} other {requests}}',
	},
	searchFriends: {
		id: 'friends.search-friends-placeholder',
		defaultMessage: 'Search friends...',
	},
	friends: {
		id: 'friends.heading',
		defaultMessage: 'Friends',
	},
	pending: {
		id: 'friends.heading.pending',
		defaultMessage: 'Pending',
	},
	active: {
		id: 'friends.heading.active',
		defaultMessage: 'Active',
	},
	online: {
		id: 'friends.heading.online',
		defaultMessage: 'Online',
	},
	offline: {
		id: 'friends.heading.offline',
		defaultMessage: 'Offline',
	},
	noFriendsMatch: {
		id: 'friends.no-friends-match',
		defaultMessage: `No friends matching ''{query}''`,
	},
	heading: {
		id: 'friends.section.heading',
		defaultMessage: '{title} - {count}',
	},
	removeFriend: {
		id: 'friends.friend.remove-friend',
		defaultMessage: 'Remove friend',
	},
	cancelRequest: {
		id: 'friends.friend.cancel-request',
		defaultMessage: 'Cancel request',
	},
	friendRequestSent: {
		id: 'friends.friend.request-sent',
		defaultMessage: 'Friend request sent',
	},
	friendActionsLabel: {
		id: 'friends.friend.actions.label',
		defaultMessage: 'Friend actions',
	},
})
</script>

<template>
	<ContextMenu ref="friendOptions" :label="formatMessage(messages.friendActionsLabel)" />

	<!-- Модалка входящих заявок (в точном стиле оригинального FriendsList.vue) -->
	<ModalWrapper ref="friendInvitesModal" header="Заявки в друзья">
		<p v-if="incomingRequests.length === 0" class="m-0 text-secondary">
			У вас нет ожидающих заявок в друзья.
		</p>
		<div v-else class="flex flex-col gap-4 min-w-[34rem]">
			<div v-for="req in incomingRequests" :key="req.id" class="flex gap-3 items-center">
				<Avatar :src="getAvatarUrl(req)" class="w-12 h-12 rounded-full" size="2.25rem" circle />
				<div class="grid grid-cols-[1fr_auto] w-full gap-4 items-center">
					<div>
						<p class="m-0">
							<span class="text-contrast font-semibold">{{ req.username }}</span> отправил вам заявку в друзья
						</p>
						<p class="m-0 text-sm text-secondary">
							{{ formatRelativeTime(new Date(req.createdAt).toISOString()) }}
						</p>
					</div>
					<div class="flex gap-2">
						<Button type="colored" color="brand" @click="acceptIncomingRequest(req)">
							<UserPlusIcon />
							Принять
						</Button>
						<Button @click="rejectIncomingRequest(req)">
							<XIcon />
							Отклонить
						</Button>
					</div>
				</div>
			</div>
		</div>
	</ModalWrapper>

	<!-- Модалка добавления друга (в точном стиле оригинального FriendsList.vue) -->
	<ModalWrapper ref="addFriendModal" header="Добавление в друзья">
		<div class="min-w-[30rem]">
			<h2 class="m-0 text-base font-medium text-primary">
				Какой никнейм у друга в Bedringh ID?
			</h2>
			<p class="m-0 mt-1 text-sm text-secondary leading-tight">
				Укажите имя аккаунта игрока, зарегистрированного в системе Bedringh ID.
			</p>
			<div class="flex items-center gap-2 mt-4">
				<Input
					v-model="username"
					:icon="UserIcon"
					type="text"
					placeholder="Введите ник Bedringh ID..."
					wrapper-class="flex-1"
					:disabled="addingFriendLoading"
					@keyup.enter="addFriendFromModal"
				/>
				<Button
					type="colored"
					color="brand"
					:disabled="username.trim().length === 0 || addingFriendLoading"
					@click="addFriendFromModal"
				>
					<SendIcon />
					Отправить запрос дружбы
				</Button>
			</div>

			<!-- Автодополнение / похожие пользователи Bedringh ID -->
			<div v-if="modalSearchSuggestions.length > 0" class="mt-3 flex flex-col gap-1">
				<span class="text-xs font-medium text-secondary">Найденные игроки Bedringh ID:</span>
				<div
					v-for="u in modalSearchSuggestions.slice(0, 5)"
					:key="u.username"
					class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl hover:bg-button-bg transition-colors"
				>
					<div class="flex items-center gap-2 min-w-0">
						<Avatar :src="getAvatarUrl(u.username)" size="24px" circle no-shadow />
						<span class="text-sm font-medium text-contrast truncate">{{ u.username }}</span>
					</div>
					<Button type="quiet" size="sm" @click="quickAddFriend(u.username)">
						<UserPlusIcon />
						Добавить
					</Button>
				</div>
			</div>
		</div>
	</ModalWrapper>

	<!-- Встроенный мини-чат в правом сайдбаре -->
	<div v-if="state.activeUsername && inlineChatTarget" class="flex flex-col gap-2 h-[420px]">
		<div class="flex items-center justify-between">
			<Button type="quiet" size="sm" @click="inlineChatTarget = null">
				Назад к друзьям
			</Button>
			<IconButton
				v-tooltip="'Развернуть на весь экран'"
				type="quiet"
				label="Развернуть на весь экран"
				@click="openFullMessenger(inlineChatTarget.id)"
			>
				<ExternalIcon />
			</IconButton>
		</div>
		<BedringhChatThread
			:target="inlineChatTarget"
			compact
			show-back-button
			@back="inlineChatTarget = null"
		/>
	</div>

	<template v-else>
		<!-- Верхняя панель управления (только когда выполнен вход в Bedringh ID) -->
		<div v-if="state.activeUsername" class="flex gap-1 items-center mb-3 -ml-1">
			<template v-if="sortedFriends.length > 0 || pendingFriends.length > 0">
				<IconButton
					v-tooltip="formatMessage(messages.addFriend)"
					type="quiet"
					:label="formatMessage(messages.addFriend)"
					@click="showAddFriendModal"
				>
					<UserPlusIcon />
				</IconButton>
				<Input
					v-model="search"
					:icon="SearchIcon"
					type="text"
					appearance="transparent"
					:placeholder="formatMessage(messages.searchFriends)"
					clearable
					input-class="!text-primary !placeholder:text-primary"
					wrapper-class="flex-1 !border-button-bg [&>span:first-child]:!text-primary [&>span:first-child]:!opacity-100"
					@keyup.esc="search = ''"
				/>
			</template>
			<template v-else>
				<h3 class="w-full text-base text-primary font-medium m-0 pl-1">
					{{ formatMessage(messages.friends) }}
				</h3>
				<IconButton
					v-tooltip="formatMessage(messages.addFriend)"
					type="quiet"
					:label="formatMessage(messages.addFriend)"
					@click="showAddFriendModal"
				>
					<UserPlusIcon />
				</IconButton>
			</template>

			<IconButton
				v-tooltip="'Чаты и сообщения'"
				type="quiet"
				label="Чаты и сообщения"
				class="relative"
				@click="openFullMessenger()"
			>
				<MessagesSquareIcon />
				<span
					v-if="totalUnreadMessages > 0"
					aria-hidden="true"
					class="absolute bg-brand text-brand-inverted text-[8px] top-0.5 px-1 right-0.5 min-w-3 h-3 rounded-full flex items-center justify-center font-bold"
				>
					{{ totalUnreadMessages }}
				</span>
			</IconButton>

			<IconButton
				v-if="incomingRequests.length > 0"
				v-tooltip="formatMessage(messages.viewFriendRequests, { count: incomingRequests.length })"
				type="quiet"
				:label="formatMessage(messages.viewFriendRequests, { count: incomingRequests.length })"
				class="relative"
				@click="friendInvitesModal.show"
			>
				<MailIcon />
				<span
					aria-hidden="true"
					class="absolute bg-brand text-brand-inverted text-[8px] top-0.5 px-1 right-0.5 min-w-3 h-3 rounded-full flex items-center justify-center font-bold"
				>
					{{ incomingRequests.length }}
				</span>
			</IconButton>
		</div>

		<div class="flex flex-col gap-3">
			<h3 v-if="!state.activeUsername" class="text-base text-primary font-medium m-0">
				{{ formatMessage(messages.friends) }}
			</h3>

			<!-- Скелетон загрузки (только один раз при первичной инициализации) -->
			<template v-if="state.loading && state.lastUpdated === 0 && sortedFriends.length === 0">
				<div v-for="n in 5" :key="n" class="flex gap-2 items-center animate-pulse">
					<div class="min-w-9 min-h-9 bg-button-bg rounded-full"></div>
					<div class="flex flex-col w-full">
						<div class="h-3 bg-button-bg rounded-full w-1/2 mb-1"></div>
						<div class="h-2.5 bg-button-bg rounded-full w-3/4"></div>
					</div>
				</div>
			</template>

			<!-- Не авторизован в Bedringh ID или пустой список (из оригинального FriendsList.vue) -->
			<template v-else-if="!state.activeUsername || (sortedFriends.length === 0 && pendingFriends.length === 0)">
				<div class="text-sm">
					<div v-if="!state.activeUsername">
						<span class="font-semibold text-brand cursor-pointer hover:underline" @click="handleSignIn">
							Войдите в аккаунт Bedringh ID
						</span>, чтобы добавлять друзей, переписываться в чате и видеть, во что они играют!
					</div>
					<div v-else>
						<span class="font-semibold text-brand cursor-pointer hover:underline" @click="showAddFriendModal">
							Добавьте друзей
						</span>, чтобы общаться и видеть, во что они играют!
					</div>
				</div>
			</template>

			<!-- Секции друзей (в стиле оригинального FriendsSection.vue) -->
			<template v-else>
				<!-- 1. В игре (Active) -->
				<Accordion
					v-if="activeFriends.length > 0"
					:open-by-default="!isFriendsSectionCollapsed('friends_active_collapsed')"
					:force-open="!!search"
					:button-class="
						'flex w-full items-center bg-transparent border-0 p-0' +
						(search
							? ''
							: ' cursor-pointer hover:brightness-[--hover-brightness] active:scale-[0.98] transition-all')
					"
					@on-open="setFriendsSectionCollapsed('friends_active_collapsed', false)"
					@on-close="setFriendsSectionCollapsed('friends_active_collapsed', true)"
				>
					<template #title>
						<h3 class="text-base text-primary font-medium m-0">
							{{ formatMessage(messages.heading, { title: formatMessage(messages.active), count: activeFriends.length }) }}
						</h3>
					</template>
					<template #default>
						<div class="pt-3 flex flex-col gap-1">
							<div
								v-for="friend in activeFriends"
								:key="friend.username"
								class="group grid items-center grid-cols-[1fr_auto] gap-2 hover:bg-button-bg transition-colors rounded-full mr-1 select-none"
								@contextmenu.prevent.stop="
									(event) => friendOptions?.open(event, createFriendMenuOptions(friend))
								"
							>
								<div
									class="grid min-w-0 grid-cols-[auto_1fr] items-center gap-2 text-inherit no-underline group cursor-pointer"
									@click="openInlineChat(friend)"
								>
									<UserAvatar :src="getAvatarUrl(friend)" size="32px" badge>
										<span class="block size-full rounded-full bg-purple-500" />
									</UserAvatar>
									<div class="flex flex-col min-w-0">
										<div class="flex items-center gap-1.5 min-w-0">
											<span class="text-sm m-0 group-hover:underline text-contrast truncate">
												{{ friend.username }}
											</span>
											<span
												v-if="friend.unread"
												class="px-1.5 rounded-full bg-brand text-brand-inverted text-[10px] font-bold shrink-0"
											>
												{{ friend.unread }}
											</span>
										</div>
										<span class="m-0 text-xs text-secondary truncate flex items-center gap-1">
											<GameIcon class="w-3 h-3 shrink-0 text-brand" />
											<span class="truncate">{{ getFriendSubtitle(friend) }}</span>
										</span>
									</div>
								</div>
								<div class="flex items-center">
									<IconButton
										v-if="friend.gameInfo?.serverAddress"
										v-tooltip="'Присоединиться к серверу'"
										type="quiet"
										label="Присоединиться к серверу"
										@click.stop="handleJoinFriendServer(friend)"
									>
										<PlayIcon class="text-brand" />
									</IconButton>
									<TeleportOverflowMenu
										type="quiet"
										label="More options"
										class="opacity-0 group-hover:opacity-100 transition-opacity"
										:options="createFriendMenuOptions(friend)"
									>
										<MoreVerticalIcon />
									</TeleportOverflowMenu>
								</div>
							</div>
						</div>
					</template>
				</Accordion>

				<!-- 2. В сети (Online) -->
				<Accordion
					v-if="onlineFriends.length > 0"
					:open-by-default="!isFriendsSectionCollapsed('friends_online_collapsed')"
					:force-open="!!search"
					:button-class="
						'flex w-full items-center bg-transparent border-0 p-0' +
						(search
							? ''
							: ' cursor-pointer hover:brightness-[--hover-brightness] active:scale-[0.98] transition-all')
					"
					@on-open="setFriendsSectionCollapsed('friends_online_collapsed', false)"
					@on-close="setFriendsSectionCollapsed('friends_online_collapsed', true)"
				>
					<template #title>
						<h3 class="text-base text-primary font-medium m-0">
							{{ formatMessage(messages.heading, { title: formatMessage(messages.online), count: onlineFriends.length }) }}
						</h3>
					</template>
					<template #default>
						<div class="pt-3 flex flex-col gap-1">
							<div
								v-for="friend in onlineFriends"
								:key="friend.username"
								class="group grid items-center grid-cols-[1fr_auto] gap-2 hover:bg-button-bg transition-colors rounded-full mr-1 select-none"
								@contextmenu.prevent.stop="
									(event) => friendOptions?.open(event, createFriendMenuOptions(friend))
								"
							>
								<div
									class="grid min-w-0 grid-cols-[auto_1fr] items-center gap-2 text-inherit no-underline group cursor-pointer"
									@click="openInlineChat(friend)"
								>
									<UserAvatar :src="getAvatarUrl(friend)" size="32px" badge />
									<div class="flex flex-col min-w-0">
										<div class="flex items-center gap-1.5 min-w-0">
											<span class="text-sm m-0 group-hover:underline text-contrast truncate">
												{{ friend.username }}
											</span>
											<span
												v-if="friend.unread"
												class="px-1.5 rounded-full bg-brand text-brand-inverted text-[10px] font-bold shrink-0"
											>
												{{ friend.unread }}
											</span>
										</div>
										<span v-if="friend.lastMessage" class="m-0 text-xs text-secondary truncate">
											{{ friend.lastMessage }}
										</span>
									</div>
								</div>
								<TeleportOverflowMenu
									type="quiet"
									label="More options"
									class="opacity-0 group-hover:opacity-100 transition-opacity"
									:options="createFriendMenuOptions(friend)"
								>
									<MoreVerticalIcon />
								</TeleportOverflowMenu>
							</div>
						</div>
					</template>
				</Accordion>

				<!-- 3. Не в сети (Offline) -->
				<Accordion
					v-if="offlineFriends.length > 0"
					:open-by-default="!isFriendsSectionCollapsed('friends_offline_collapsed')"
					:force-open="!!search"
					:button-class="
						'flex w-full items-center bg-transparent border-0 p-0' +
						(search
							? ''
							: ' cursor-pointer hover:brightness-[--hover-brightness] active:scale-[0.98] transition-all')
					"
					@on-open="setFriendsSectionCollapsed('friends_offline_collapsed', false)"
					@on-close="setFriendsSectionCollapsed('friends_offline_collapsed', true)"
				>
					<template #title>
						<h3 class="text-base text-primary font-medium m-0">
							{{ formatMessage(messages.heading, { title: formatMessage(messages.offline), count: offlineFriends.length }) }}
						</h3>
					</template>
					<template #default>
						<div class="pt-3 flex flex-col gap-1">
							<div
								v-for="friend in offlineFriends"
								:key="friend.username"
								class="group grid items-center grid-cols-[1fr_auto] gap-2 hover:bg-button-bg transition-colors rounded-full mr-1 select-none"
								@contextmenu.prevent.stop="
									(event) => friendOptions?.open(event, createFriendMenuOptions(friend))
								"
							>
								<div
									class="grid min-w-0 grid-cols-[auto_1fr] items-center gap-2 text-inherit no-underline group cursor-pointer"
									@click="openInlineChat(friend)"
								>
									<UserAvatar :src="getAvatarUrl(friend)" size="32px" :badge="false" grayscale />
									<div class="flex flex-col min-w-0">
										<div class="flex items-center gap-1.5 min-w-0">
											<span class="text-sm m-0 group-hover:underline text-primary truncate">
												{{ friend.username }}
											</span>
											<span
												v-if="friend.unread"
												class="px-1.5 rounded-full bg-brand text-brand-inverted text-[10px] font-bold shrink-0"
											>
												{{ friend.unread }}
											</span>
										</div>
										<span v-if="friend.lastMessage" class="m-0 text-xs text-secondary truncate">
											{{ friend.lastMessage }}
										</span>
									</div>
								</div>
								<TeleportOverflowMenu
									type="quiet"
									label="More options"
									class="opacity-0 group-hover:opacity-100 transition-opacity"
									:options="createFriendMenuOptions(friend)"
								>
									<MoreVerticalIcon />
								</TeleportOverflowMenu>
							</div>
						</div>
					</template>
				</Accordion>

				<!-- 4. Ожидание (Pending) -->
				<Accordion
					v-if="pendingFriends.length > 0"
					:open-by-default="!isFriendsSectionCollapsed('friends_pending_collapsed')"
					:force-open="!!search"
					:button-class="
						'flex w-full items-center bg-transparent border-0 p-0' +
						(search
							? ''
							: ' cursor-pointer hover:brightness-[--hover-brightness] active:scale-[0.98] transition-all')
					"
					@on-open="setFriendsSectionCollapsed('friends_pending_collapsed', false)"
					@on-close="setFriendsSectionCollapsed('friends_pending_collapsed', true)"
				>
					<template #title>
						<h3 class="text-base text-primary font-medium m-0">
							{{ formatMessage(messages.heading, { title: formatMessage(messages.pending), count: pendingFriends.length }) }}
						</h3>
					</template>
					<template #default>
						<div class="pt-3 flex flex-col gap-1">
							<div
								v-for="req in pendingFriends"
								:key="req.id"
								class="group grid items-center grid-cols-[1fr_auto] gap-2 hover:bg-button-bg transition-colors rounded-full mr-1 select-none"
							>
								<div class="grid min-w-0 grid-cols-[auto_1fr] items-center gap-2">
									<UserAvatar :src="getAvatarUrl(req)" size="32px" :badge="false" />
									<div class="flex flex-col min-w-0">
										<span class="text-sm m-0 text-contrast truncate">
											{{ req.username }}
										</span>
										<span class="m-0 text-xs text-secondary truncate">
											{{ formatMessage(messages.friendRequestSent) }}
										</span>
									</div>
								</div>
								<IconButton
									v-tooltip="formatMessage(messages.cancelRequest)"
									type="quiet"
									:label="formatMessage(messages.cancelRequest)"
									@click="cancelOutgoingRequest(req)"
								>
									<XIcon />
								</IconButton>
							</div>
						</div>
					</template>
				</Accordion>

				<p
					v-if="filteredFriends.length === 0 && pendingFriends.length === 0 && search"
					class="text-sm text-secondary my-1 mx-4"
				>
					{{ formatMessage(messages.noFriendsMatch, { query: search }) }}
				</p>
			</template>
		</div>
	</template>
</template>
