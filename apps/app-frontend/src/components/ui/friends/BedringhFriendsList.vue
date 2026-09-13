<script setup lang="ts">
import {
	CopyIcon,
	MailIcon,
	MoreVerticalIcon,
	SearchIcon,
	SendIcon,
	TrashIcon,
	UserIcon,
	UserPlusIcon,
	XIcon,
} from '@modrinth/assets'
import {
	Accordion,
	Avatar,
	Button,
	defineMessages,
	IconButton,
	injectNotificationManager,
	Input,
	IntlFormatted,
	TeleportOverflowMenu,
	useRelativeTime,
	useVIntl,
} from '@modrinth/ui'
import { computed, ref } from 'vue'

import ModalWrapper from '@/components/ui/modal/ModalWrapper.vue'
import { useAppSettings } from '@/composables/use-app-settings.ts'
import { useBedringhAccount } from '@/composables/use-bedringh-account'
import {
	cancelFriendRequest,
	refreshFriendsList,
	removeFriend as removeFriendApi,
	respondFriendRequest,
	sendFriendRequest,
	useBedringhFriends,
	type BedringhFriend,
	type FriendRequest,
} from '@/services/bedringh-friends'
import { get as getSettings, set as setSettings } from '@/helpers/settings.ts'

const props = defineProps<{
	signIn: () => void
}>()

const { formatMessage } = useVIntl()
const { handleError, addNotification } = injectNotificationManager()
const formatRelativeTime = useRelativeTime()
const appSettings = useAppSettings()
const { isBedringhAuthenticated } = useBedringhAccount()

const {
	state,
	totalIncoming,
} = useBedringhFriends()

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
const friendInvitesModal = ref()
const addFriendModal = ref()
const username = ref('')
const addingFriendLoading = ref(false)

const sortedFriends = computed<BedringhFriend[]>(() => {
	return state.friends.slice().sort((a, b) => a.username.localeCompare(b.username))
})

const filteredFriends = computed<BedringhFriend[]>(() => {
	const q = search.value.trim().toLowerCase()
	if (!q) return sortedFriends.value
	return sortedFriends.value.filter((x) =>
		x.username.toLowerCase().includes(q),
	)
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
	return state.outgoingRequests.filter((x) =>
		x.username.toLowerCase().includes(q),
	)
})

async function addFriendFromModal() {
	const target = username.value.trim()
	if (!target || addingFriendLoading.value) return

	addingFriendLoading.value = true
	try {
		const res = await sendFriendRequest(target)
		addNotification({
			type: 'success',
			title: formatMessage(messages.addingAFriend),
			text: res.message || `Запрос дружбы пользователю ${target} отправлен`,
		})
		addFriendModal.value?.hide()
		username.value = ''
		await refreshFriendsList(true)
	} catch (e: any) {
		addNotification({
			type: 'error',
			title: 'Ошибка',
			text: e?.message || 'Не удалось отправить запрос в друзья',
		})
	} finally {
		addingFriendLoading.value = false
	}
}

function showAddFriendModal() {
	username.value = ''
	addFriendModal.value?.show()
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
	const customAvatar = typeof userOrName !== 'string' && 'avatarUrl' in userOrName ? userOrName.avatarUrl : undefined
	return customAvatar || `https://mc-heads.net/avatar/${encodeURIComponent(name)}/32`
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
		defaultMessage: "What's your friend's Bedringh ID username?",
	},
	usernameDescription: {
		id: 'friends.add-friend.username.description',
		defaultMessage: 'It may be different from their Minecraft username!',
	},
	usernamePlaceholder: {
		id: 'bedringh.friends.add-friend.username.placeholder',
		defaultMessage: 'Enter Bedringh ID username...',
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
	signInToAddFriends: {
		id: 'bedringh.friends.sign-in-to-add-friends',
		defaultMessage:
			"<link>Sign in to a Bedringh ID account</link> to add friends and see what they're playing!",
	},
	addFriendsToShare: {
		id: 'friends.add-friends-to-share',
		defaultMessage: "<link>Add friends</link> to see what they're playing!",
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
})
</script>

<template>
	<!-- Модальное окно просмотра запросов в друзья -->
	<ModalWrapper ref="friendInvitesModal" header="View friend requests">
		<p v-if="incomingRequests.length === 0">You have no pending friend requests :C</p>
		<div v-else class="flex flex-col gap-4 min-w-[36rem]">
			<div v-for="req in incomingRequests" :key="req.id" class="flex gap-2">
				<Avatar :src="getAvatarUrl(req)" class="w-12 h-12 rounded-full" size="2.25rem" circle />
				<div class="grid grid-cols-[1fr_auto] w-full gap-4">
					<div>
						<p class="m-0">
							<span class="text-contrast font-medium">{{ req.username }}</span> sent you a friend request
						</p>
						<p class="m-0 text-sm text-secondary">
							{{ formatRelativeTime(new Date(req.createdAt).toISOString()) }}
						</p>
					</div>
					<div class="flex gap-2">
						<Button type="colored" color="brand" @click="acceptIncomingRequest(req)">
							<UserPlusIcon />
							Accept
						</Button>
						<Button @click="rejectIncomingRequest(req)">
							<XIcon />
							Ignore
						</Button>
					</div>
				</div>
			</div>
		</div>
	</ModalWrapper>

	<!-- Модальное окно добавления друга -->
	<ModalWrapper ref="addFriendModal" :header="formatMessage(messages.addingAFriend)">
		<div class="min-w-[30rem]">
			<h2 class="m-0 text-base font-medium text-primary">
				{{ formatMessage(messages.usernameTitle) }}
			</h2>
			<p class="m-0 mt-1 text-sm text-secondary leading-tight">
				{{ formatMessage(messages.usernameDescription) }}
			</p>
			<div class="flex items-center gap-2 mt-4">
				<Input
					v-model="username"
					:icon="UserIcon"
					type="text"
					:placeholder="formatMessage(messages.usernamePlaceholder)"
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
					{{ formatMessage(messages.sendFriendRequest) }}
				</Button>
			</div>
		</div>
	</ModalWrapper>

	<!-- Шапка списка друзей -->
	<div v-if="isBedringhAuthenticated && !state.loading" class="flex gap-1 items-center mb-3 -ml-1">
		<template v-if="sortedFriends.length > 0">
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
		<h3 v-else class="w-full text-base text-primary font-medium m-0">
			{{ formatMessage(messages.friends) }}
		</h3>
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
				v-if="incomingRequests.length > 0"
				aria-hidden="true"
				class="absolute bg-brand text-brand-inverted text-[8px] top-0.5 px-1 right-0.5 min-w-3 h-3 rounded-full flex items-center justify-center font-bold"
			>
				{{ incomingRequests.length }}
			</span>
		</IconButton>
	</div>

	<!-- Содержимое списка друзей -->
	<div class="flex flex-col gap-3">
		<h3 v-if="state.loading" class="text-base text-primary font-medium m-0">
			{{ formatMessage(messages.friends) }}
		</h3>
		<template v-if="state.loading">
			<div v-for="n in 5" :key="n" class="flex gap-2 items-center animate-pulse">
				<div class="min-w-9 min-h-9 bg-button-bg rounded-full"></div>
				<div class="flex flex-col w-full">
					<div class="h-3 bg-button-bg rounded-full w-1/2 mb-1"></div>
					<div class="h-2.5 bg-button-bg rounded-full w-3/4"></div>
				</div>
			</div>
		</template>
		<template v-else-if="sortedFriends.length === 0">
			<div class="text-sm">
				<div v-if="!isBedringhAuthenticated">
					<IntlFormatted :message-id="messages.signInToAddFriends">
						<template #link="{ children }">
							<span class="font-semibold text-brand cursor-pointer" @click="props.signIn">
								<component :is="() => children" />
							</span>
						</template>
					</IntlFormatted>
				</div>
				<div v-else>
					<IntlFormatted :message-id="messages.addFriendsToShare">
						<template #link="{ children }">
							<span class="font-semibold text-brand cursor-pointer" @click="showAddFriendModal">
								<component :is="() => children" />
							</span>
						</template>
					</IntlFormatted>
				</div>
			</div>
		</template>
		<template v-else>
			<!-- Секция Active (В игре) -->
			<Accordion
				v-if="activeFriends.length > 0"
				:open-by-default="!isFriendsSectionCollapsed('friends_active_collapsed')"
				:force-open="!!search"
				button-class="flex w-full items-center bg-transparent border-0 p-0 cursor-pointer hover:brightness-[--hover-brightness] active:scale-[0.98] transition-all"
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
						>
							<div class="grid min-w-0 grid-cols-[auto_1fr] items-center gap-2">
								<div class="relative">
									<Avatar :src="getAvatarUrl(friend)" size="32px" circle />
									<span class="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-solid border-bg-raised"></span>
								</div>
								<div class="flex flex-col min-w-0">
									<span class="text-sm text-contrast m-0 truncate">
										{{ friend.username }}
									</span>
									<span class="text-xs text-purple-400 m-0 truncate">
										{{ friend.gameInfo?.instanceName || friend.gameInfo?.serverAddress || formatMessage(messages.active) }}
									</span>
								</div>
							</div>
							<TeleportOverflowMenu
								type="quiet"
								label="More options"
								class="opacity-0 group-hover:opacity-100 transition-opacity"
								:options="[
									...(friend.gameInfo?.serverAddress ? [{
										id: 'copy-server',
										label: 'Скопировать сервер',
										icon: CopyIcon,
										action: () => handleCopyServer(friend),
									}] : []),
									{
										id: 'remove-friend',
										label: formatMessage(messages.removeFriend),
										icon: TrashIcon,
										tone: 'red',
										action: () => removeFriendRecord(friend),
									}
								]"
							>
								<MoreVerticalIcon />
							</TeleportOverflowMenu>
						</div>
					</div>
				</template>
			</Accordion>

			<!-- Секция Online (В сети) -->
			<Accordion
				v-if="onlineFriends.length > 0"
				:open-by-default="!isFriendsSectionCollapsed('friends_online_collapsed')"
				:force-open="!!search"
				button-class="flex w-full items-center bg-transparent border-0 p-0 cursor-pointer hover:brightness-[--hover-brightness] active:scale-[0.98] transition-all"
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
						>
							<div class="grid min-w-0 grid-cols-[auto_1fr] items-center gap-2">
								<div class="relative">
									<Avatar :src="getAvatarUrl(friend)" size="32px" circle />
									<span class="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-solid border-bg-raised"></span>
								</div>
								<div class="flex flex-col min-w-0">
									<span class="text-sm text-contrast m-0 truncate">
										{{ friend.username }}
									</span>
								</div>
							</div>
							<TeleportOverflowMenu
								type="quiet"
								label="More options"
								class="opacity-0 group-hover:opacity-100 transition-opacity"
								:options="[
									{
										id: 'remove-friend',
										label: formatMessage(messages.removeFriend),
										icon: TrashIcon,
										tone: 'red',
										action: () => removeFriendRecord(friend),
									}
								]"
							>
								<MoreVerticalIcon />
							</TeleportOverflowMenu>
						</div>
					</div>
				</template>
			</Accordion>

			<!-- Секция Offline (Не в сети) -->
			<Accordion
				v-if="offlineFriends.length > 0"
				:open-by-default="!isFriendsSectionCollapsed('friends_offline_collapsed')"
				:force-open="!!search"
				button-class="flex w-full items-center bg-transparent border-0 p-0 cursor-pointer hover:brightness-[--hover-brightness] active:scale-[0.98] transition-all"
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
						>
							<div class="grid min-w-0 grid-cols-[auto_1fr] items-center gap-2">
								<Avatar :src="getAvatarUrl(friend)" size="32px" circle class="grayscale opacity-60" />
								<div class="flex flex-col min-w-0">
									<span class="text-sm text-primary m-0 truncate">
										{{ friend.username }}
									</span>
								</div>
							</div>
							<TeleportOverflowMenu
								type="quiet"
								label="More options"
								class="opacity-0 group-hover:opacity-100 transition-opacity"
								:options="[
									{
										id: 'remove-friend',
										label: formatMessage(messages.removeFriend),
										icon: TrashIcon,
										tone: 'red',
										action: () => removeFriendRecord(friend),
									}
								]"
							>
								<MoreVerticalIcon />
							</TeleportOverflowMenu>
						</div>
					</div>
				</template>
			</Accordion>

			<!-- Секция Pending (Отправленные заявки) -->
			<Accordion
				v-if="pendingFriends.length > 0"
				:open-by-default="!isFriendsSectionCollapsed('friends_pending_collapsed')"
				:force-open="!!search"
				button-class="flex w-full items-center bg-transparent border-0 p-0 cursor-pointer hover:brightness-[--hover-brightness] active:scale-[0.98] transition-all"
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
								<Avatar :src="getAvatarUrl(req)" size="32px" circle />
								<div class="flex flex-col min-w-0">
									<span class="text-sm text-contrast m-0 truncate">
										{{ req.username }}
									</span>
									<span class="m-0 text-xs text-secondary">
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

			<p v-if="filteredFriends.length === 0 && search" class="text-sm text-secondary my-1 mx-4">
				{{ formatMessage(messages.noFriendsMatch, { query: search }) }}
			</p>
		</template>
	</div>
</template>
