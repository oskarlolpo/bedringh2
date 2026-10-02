<template>
	<EmptyState
		v-if="!isSignedIn"
		type="empty"
		class="[&>div:last-child]:!mt-6"
		heading="Требуется аккаунт Bedringh ID"
		description="Войдите в аккаунт Bedringh ID, чтобы настроить приватность заявок в друзья, приглашений на сервер и управлять списком друзей."
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
			<Button type="colored" color="brand" size="xl" native-type="button" @click="openBedringhAuth">
				<LogInIcon aria-hidden="true" />
				Войти в Bedringh ID
			</Button>
		</template>
	</EmptyState>

	<div v-else class="flex flex-col gap-8">
		<section class="flex flex-col gap-6">
			<div class="flex items-center justify-between gap-4 p-4 rounded-2xl bg-button-bg">
				<div class="flex items-center gap-3 min-w-0">
					<UserAvatar
						:src="`https://mc-heads.net/avatar/${encodeURIComponent(activeUsername || 'Steve')}/64`"
						size="40px"
						badge
						badge-color="green"
					/>
					<div class="flex flex-col min-w-0">
						<span class="font-bold text-contrast truncate">{{ activeUsername }}</span>
						<span class="text-xs text-secondary">
							Аккаунт Bedringh ID активен · Друзей: {{ state.friends.length }}
						</span>
					</div>
				</div>
				<Button type="outlined" color="brand" size="sm" @click="goToSocialChats">
					<MessagesSquareIcon class="w-4 h-4" />
					Открыть чаты и друзей
				</Button>
			</div>

			<div class="flex flex-col gap-2.5">
				<h2 class="m-0 text-lg font-semibold text-contrast">Заявки в друзья</h2>
				<Chips
					v-model="friendPrivacy"
					:items="friendPrivacyOptions"
					:format-label="formatPrivacyOption"
					:capitalize="false"
					aria-label="Заявки в друзья"
				/>
				<p class="m-0 text-secondary">
					Укажите, кто может отправлять вам заявки в друзья через Bedringh ID.
				</p>
			</div>

			<div class="flex flex-col gap-2.5">
				<h2 class="m-0 text-lg font-semibold text-contrast">Приглашения в мир и на сервер</h2>
				<Chips
					v-model="invitePrivacy"
					:items="invitePrivacyOptions"
					:format-label="formatPrivacyOption"
					:capitalize="false"
					aria-label="Приглашения в мир и на сервер"
				/>
				<p class="m-0 text-secondary">
					Укажите, кто может присылать вам карточки быстрого подключения к серверу или LAN-миру.
				</p>
			</div>

			<div class="flex flex-col gap-2.5">
				<h2 class="m-0 text-lg font-semibold text-contrast">Статус активности в игре</h2>
				<Chips
					v-model="activityPrivacy"
					:items="invitePrivacyOptions"
					:format-label="formatPrivacyOption"
					:capitalize="false"
					aria-label="Статус активности в игре"
				/>
				<p class="m-0 text-secondary">
					Укажите, кто видит ваш текущий сервер, сборку и количество наигранных часов.
				</p>
			</div>
		</section>

		<section class="flex flex-col gap-4">
			<div class="flex flex-col gap-1">
				<h2 class="m-0 text-lg font-semibold text-contrast">
					Друзья Bedringh ID ({{ state.friends.length }})
				</h2>
				<p class="m-0 text-secondary">
					Список ваших друзей в экосистеме Bedringh ID.
				</p>
			</div>

			<div class="relative overflow-hidden rounded-2xl border border-solid border-surface-4">
				<div class="max-h-[20.5rem] overflow-y-auto">
					<Table
						class="!rounded-none !border-0"
						:columns="columns"
						:data="friendRows"
						row-key="username"
					>
						<template #empty-state>
							<div class="flex h-36 items-center justify-center px-4 text-center text-secondary">
								<span>У вас пока нет добавленных друзей в Bedringh ID.</span>
							</div>
						</template>

						<template #cell-user="{ row }">
							<div class="flex min-w-0 items-center gap-3">
								<UserAvatar
									:src="`https://mc-heads.net/avatar/${encodeURIComponent(row.username)}/64`"
									size="32px"
									badge
									:badge-color="
										row.status === 'in_game'
											? 'purple'
											: row.status === 'online'
												? 'green'
												: 'gray'
									"
									:grayscale="row.status === 'offline'"
								/>
								<div class="flex min-w-0 flex-col">
									<span class="truncate font-semibold text-contrast">
										{{ row.username }}
									</span>
									<span class="truncate text-xs text-secondary">
										{{
											row.status === 'in_game'
												? `В игре · ${row.gameInfo?.serverName || row.gameInfo?.instanceName || 'Minecraft'}`
												: row.status === 'online'
													? 'В сети'
													: 'Не в сети'
										}}
									</span>
								</div>
							</div>
						</template>

						<template #cell-actions="{ row }">
							<div class="flex justify-end gap-2">
								<Button
									type="outlined"
									color="red"
									size="sm"
									native-type="button"
									@click="removeFriend(row.username)"
								>
									Удалить
								</Button>
							</div>
						</template>
					</Table>
				</div>
			</div>
		</section>
	</div>
</template>

<script setup lang="ts">
import { LogInIcon, MessagesSquareIcon, ThinkingRinthbot } from '@modrinth/assets'
import { Button, Chips, EmptyState, Table, type TableColumn, UserAvatar } from '@modrinth/ui'
import { computed, inject, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import {
	initFriendsService,
	removeFriend,
	useBedringhFriends,
} from '@/services/bedringh-friends'
import { getActiveBedringhUser } from '@/services/bedringh-settings-sync'

type PrivacyOption = 'everyone' | 'friends' | 'none'

const STORAGE_PRIVACY_KEY = 'bedringh_social_privacy_v1'

const router = useRouter()
const { state } = useBedringhFriends()
const openBedringhAuthModal = inject<(() => void) | null>('openBedringhAuthModal', null)

const activeUsername = computed(() => state.activeUsername || getActiveBedringhUser()?.username || null)
const isSignedIn = computed(() => Boolean(activeUsername.value))

const friendPrivacyOptions: PrivacyOption[] = ['everyone', 'friends', 'none']
const invitePrivacyOptions: PrivacyOption[] = ['everyone', 'friends', 'none']

const friendPrivacy = ref<PrivacyOption>('everyone')
const invitePrivacy = ref<PrivacyOption>('friends')
const activityPrivacy = ref<PrivacyOption>('friends')

function loadPrivacySettings() {
	try {
		const raw = localStorage.getItem(STORAGE_PRIVACY_KEY)
		if (!raw) return
		const parsed = JSON.parse(raw)
		if (parsed.friendPrivacy) friendPrivacy.value = parsed.friendPrivacy
		if (parsed.invitePrivacy) invitePrivacy.value = parsed.invitePrivacy
		if (parsed.activityPrivacy) activityPrivacy.value = parsed.activityPrivacy
	} catch {
		// ignore
	}
}

watch([friendPrivacy, invitePrivacy, activityPrivacy], () => {
	try {
		localStorage.setItem(
			STORAGE_PRIVACY_KEY,
			JSON.stringify({
				friendPrivacy: friendPrivacy.value,
				invitePrivacy: invitePrivacy.value,
				activityPrivacy: activityPrivacy.value,
			}),
		)
	} catch {
		// ignore
	}
})

function formatPrivacyOption(option: PrivacyOption): string {
	switch (option) {
		case 'everyone':
			return 'Все пользователи Bedringh ID'
		case 'friends':
			return 'Только друзья'
		case 'none':
			return 'Никто'
	}
}

const columns = computed<TableColumn<'user' | 'actions'>[]>(() => [
	{
		key: 'user',
		label: 'Игрок',
	},
	{
		key: 'actions',
		label: 'Действия',
		align: 'right',
		width: '8rem',
	},
])

const friendRows = computed(() =>
	state.friends.map((f) => ({
		...f,
		user: f.username,
		actions: null,
	})),
)

function openBedringhAuth() {
	if (openBedringhAuthModal) {
		openBedringhAuthModal()
	} else {
		window.dispatchEvent(new CustomEvent('open-bedringh-auth'))
	}
}

function goToSocialChats() {
	void router.push('/chats')
}

onMounted(() => {
	loadPrivacySettings()
	initFriendsService()
})
</script>
