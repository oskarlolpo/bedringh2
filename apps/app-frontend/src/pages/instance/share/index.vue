<template>
	<div v-if="instance && !instance.quarantined" class="flex flex-col gap-5 max-w-4xl mx-auto w-full pb-8">
		<ExportModal ref="exportModal" :instance="instance" />

		<!-- 1. Главная карточка: Живая облачная сборка Bedringh -->
		<div class="card-shadow rounded-2xl border border-solid border-surface-4 bg-bg-raised p-6 flex flex-col gap-5">
			<div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
				<div class="flex items-center gap-3.5">
					<div class="flex size-12 items-center justify-center rounded-xl bg-brand/15 text-brand shrink-0 border border-solid border-brand/25">
						<CloudIcon class="size-6" />
					</div>
					<div>
						<div class="flex flex-wrap items-center gap-2">
							<h2 class="m-0 text-lg font-bold text-contrast">
								Живая сборка Bedringh
							</h2>
							<span
								v-if="cloudMeta"
								class="px-2 py-0.5 text-xs font-bold rounded-md bg-brand/20 text-brand border border-solid border-brand/30"
							>
								v{{ cloudMeta.version }}
							</span>
							<span
								v-if="cloudMeta"
								class="px-2 py-0.5 text-xs rounded-md font-medium"
								:class="isAuthor ? 'bg-brand/15 text-brand border border-solid border-brand/30' : 'bg-surface-3 text-secondary'"
							>
								{{ isAuthor ? 'Вы создатель' : `Подписка (${cloudMeta.author ?? 'автор'})` }}
							</span>
							<span
								v-if="activeBedringhUser?.username"
								class="px-2 py-0.5 text-xs rounded-md font-medium bg-purple-500/15 text-purple-300 border border-solid border-purple-500/25"
							>
								{{ activeBedringhUser.username }}
							</span>
						</div>
						<p class="m-0 mt-0.5 text-xs text-secondary">
							{{
								isAuthor
									? 'Сборка опубликована в облаке. Друзья могут установить её по коду сборки.'
									: isSubscriber
									? `Синхронизировано с автором (${cloudMeta?.author ?? 'автор'}).`
									: 'Опубликуйте сборку в облако, чтобы друзья могли установить её по коду.'
							}}
						</p>
					</div>
				</div>

				<div class="flex items-center gap-2.5 shrink-0 w-full md:w-auto">
					<!-- Кнопка первой публикации -->
					<Button
						v-if="!cloudMeta"
						type="colored"
						color="brand"
						size="md"
						:disabled="isPublishing"
						class="w-full md:w-auto font-bold"
						@click="handlePublishPack"
					>
						<SpinnerIcon v-if="isPublishing" class="animate-spin size-4" aria-hidden="true" />
						<ShareIcon v-else class="size-4" aria-hidden="true" />
						Поделиться сборкой
					</Button>

					<!-- Кнопки для автора -->
					<template v-else-if="isAuthor">
						<!-- Если есть изменения -->
						<Button
							v-if="hasChangesToPublish"
							type="colored"
							color="brand"
							size="md"
							:disabled="isPublishing"
							class="w-full md:w-auto font-bold"
							@click="handlePublishPack"
						>
							<SpinnerIcon v-if="isPublishing" class="animate-spin size-4" aria-hidden="true" />
							<RotateClockwiseIcon v-else class="size-4" aria-hidden="true" />
							Опубликовать обновление (v{{ cloudMeta.version + 1 }})
						</Button>

						<!-- Если сборка актуальна (нет изменений) -->
						<Button
							v-else
							type="outlined"
							size="md"
							:disabled="isPublishing"
							class="w-full md:w-auto font-medium"
							@click="handlePublishPack"
						>
							<CheckIcon class="size-4 text-brand" aria-hidden="true" />
							Сборка актуальна (v{{ cloudMeta.version }})
						</Button>
					</template>

					<!-- Кнопки для подписчика -->
					<template v-else-if="isSubscriber">
						<Button
							v-if="hasCloudUpdate"
							type="colored"
							color="brand"
							size="md"
							:disabled="isUpdating"
							class="w-full md:w-auto font-bold"
							@click="handleSyncPack"
						>
							<SpinnerIcon v-if="isUpdating" class="animate-spin size-4" aria-hidden="true" />
							<DownloadIcon v-else class="size-4" aria-hidden="true" />
							Обновить моды до v{{ cloudUpdateDetails?.latestVersion }}
						</Button>
						<Button
							v-else
							type="outlined"
							size="md"
							:disabled="isCheckingUpdates"
							class="w-full md:w-auto"
							@click="handleCheckUpdate(true)"
						>
							<SpinnerIcon v-if="isCheckingUpdates" class="animate-spin size-4" aria-hidden="true" />
							<RotateClockwiseIcon v-else class="size-4" aria-hidden="true" />
							Проверить обновления
						</Button>
					</template>
				</div>
			</div>

			<!-- Баннер если вышло обновление для подписчика -->
			<div
				v-if="isSubscriber && hasCloudUpdate"
				class="p-3.5 bg-brand/15 border border-solid border-brand/40 rounded-xl flex items-center justify-between gap-3 text-sm"
			>
				<div class="flex items-center gap-2.5 min-w-0">
					<DownloadIcon class="size-5 text-brand shrink-0" />
					<div class="truncate text-xs">
						<span class="font-bold text-contrast">Доступна новая версия: v{{ cloudUpdateDetails?.latestVersion }}!</span>
						<span class="text-secondary ml-1.5 hidden sm:inline">Автор обновил список модов.</span>
					</div>
				</div>
				<Button type="colored" color="brand" size="sm" :disabled="isUpdating" @click="handleSyncPack">
					<SpinnerIcon v-if="isUpdating" class="animate-spin size-4" aria-hidden="true" />
					<DownloadIcon v-else class="size-4" aria-hidden="true" />
					Обновить
				</Button>
			</div>

			<!-- Код сборки для отправки друзьям (только код!) -->
			<div
				v-if="cloudMeta"
				class="flex items-center justify-between p-4 rounded-xl bg-surface-2 border border-solid border-surface-4"
			>
				<div class="flex flex-col min-w-0">
					<span class="text-[11px] text-secondary font-semibold uppercase tracking-wider">Код сборки для друзей</span>
					<span class="text-xl font-mono font-bold text-brand select-all tracking-wide mt-0.5">{{ cloudMeta.packId }}</span>
				</div>
				<Button
					type="colored"
					color="brand"
					size="sm"
					class="font-semibold shrink-0"
					@click="copyText(cloudMeta.packId, 'Код сборки скопирован')"
				>
					<CopyIcon class="size-4" />
					Скопировать код
				</Button>
			</div>
		</div>

		<!-- 2. Автономный экспорт сборки (.mrpack) -->
		<div class="card-shadow rounded-2xl border border-solid border-surface-4 bg-bg-raised p-6">
			<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
				<div class="flex items-center gap-3.5">
					<div class="flex size-12 items-center justify-center rounded-xl bg-surface-3 text-contrast shrink-0 border border-solid border-surface-4">
						<FolderOpenIcon class="size-6 text-contrast" />
					</div>
					<div>
						<h3 class="m-0 text-lg font-bold text-contrast">Экспорт сборки (.mrpack)</h3>
						<p class="m-0 mt-0.5 text-xs text-secondary">
							Локальный файл сборки для бэкапа или передачи файлом через мессенджеры.
						</p>
					</div>
				</div>

				<div class="flex items-center gap-2.5 shrink-0 w-full sm:w-auto">
					<Button type="colored" color="brand" size="md" class="w-full sm:w-auto" @click="exportModal?.show()">
						<DownloadIcon class="size-4" aria-hidden="true" />
						Экспорт в .mrpack
					</Button>
					<Button type="outlined" size="md" class="w-full sm:w-auto" @click="copyModList">
						<CopyIcon class="size-4" aria-hidden="true" />
						Список модов
					</Button>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import {
	CheckIcon,
	CloudIcon,
	CopyIcon,
	DownloadIcon,
	FolderOpenIcon,
	LogInIcon,
	RotateClockwiseIcon,
	ShareIcon,
	SpinnerIcon,
	UserPlusIcon,
} from '@modrinth/assets'
import {
	Avatar,
	Button,
	ConfirmUnlinkModal,
	defineMessages,
	injectAuth,
	injectNotificationManager,
	type InvitePlayersInvitePayload,
	InvitePlayersModal,
	type InvitePlayersUser,
	useVIntl,
} from '@modrinth/ui'
import { useQueryClient } from '@tanstack/vue-query'
import { computed, onMounted, ref, watch } from 'vue'

import ExportModal from '@/components/ui/ExportModal.vue'
import ModrinthAccountRequiredModal from '@/components/ui/modal/ModrinthAccountRequiredModal.vue'
import SharedInstancePublishModal from '@/components/ui/shared-instances/SharedInstancePublishModal.vue'
import {
	getSharedInstanceUnavailableReason,
	isSharedInstancesApiError,
	isSharedInstanceUnavailableError,
} from '@/helpers/install'
import { edit } from '@/helpers/instance'
import type { ModrinthAuthFlow } from '@/helpers/mr_auth.ts'
import {
	sharedInstanceErrorMessages,
	useSharedInstanceErrors,
} from '@/helpers/shared-instance-errors'
import { loadInstanceContentData } from '@/helpers/instance-content'
import {
	checkAuthorHasChanges,
	checkInstanceCloudPackUpdate,
	getLocalInstancePackMeta,
	publishInstanceAsCloudPack,
	syncSubscriberPackUpdate,
	type CloudPackMeta,
} from '@/services/bedringh-cloud-packs'
import { getActiveBedringhUser, resolveActiveBedringhUser } from '@/services/bedringh-settings-sync'

import { injectInstancePage } from '../instance-context'
import { injectSharedInstance } from '../shared-instance-context'
import { provideSharedInstanceManagement } from './shared-instance-management-context'
import SharedInstanceMembersTable from './shared-instance-members-table.vue'
import SharedInstanceRemoveMemberModal from './shared-instance-remove-member-modal.vue'
import SharedInstanceShareEmptyState from './shared-instance-share-empty-state.vue'
import { SHARED_INSTANCE_USER_LIMIT, type ShareRow } from './shared-instance-share-types'
import { useSharedInstanceInviteCandidates } from './use-shared-instance-invite-candidates'
import { useSharedInstanceInviteLink } from './use-shared-instance-invite-link'
import { useSharedInstanceMembers } from './use-shared-instance-members'
import type { GameInstance } from '@/helpers/types'

const props = defineProps<{
	instance?: GameInstance
	offline?: boolean
}>()

const instancePage = injectInstancePage()
const auth = injectAuth()
const queryClient = useQueryClient()
const { formatMessage } = useVIntl()
const {
	formatSharedInstanceUnavailable,
	notifySharedInstanceError,
	notifySharedInstanceUnavailable,
} = useSharedInstanceErrors()
const sharedInstanceState = injectSharedInstance()
const instance = computed(() => props.instance ?? instancePage.instance.value!)
const offline = computed(() => props.offline ?? instancePage.offline.value)
const actionsLocked = sharedInstanceState.shareActionsLocked
const sharedInstanceActionsLocked = actionsLocked
const currentUserId = computed(() => auth.user.value?.id ?? null)
const isSignedIn = computed(() => !!auth.session_token.value)
const exportModal = ref<InstanceType<typeof ExportModal>>()
const { addNotification, handleError } = injectNotificationManager()
const sharedInstancesApiUnavailable = ref(false)

const activeBedringhUser = ref<{ username: string; token?: string } | null>(getActiveBedringhUser())
const hasChangesToPublish = ref(true)

async function refreshAuthorChangesStatus() {
	if (instance.value && cloudMeta.value?.role === 'author') {
		hasChangesToPublish.value = await checkAuthorHasChanges(instance.value).catch(() => true)
	} else {
		hasChangesToPublish.value = true
	}
}

onMounted(async () => {
	if (!activeBedringhUser.value?.username) {
		activeBedringhUser.value = await resolveActiveBedringhUser()
	}
	void refreshAuthorChangesStatus()
})

const cloudMeta = ref<CloudPackMeta | null>(
	instance.value?.path ? getLocalInstancePackMeta(instance.value.path) : null,
)
const isPublishing = ref(false)
const isUpdating = ref(false)
const isCheckingUpdates = ref(false)
const hasCloudUpdate = ref(false)
const cloudUpdateDetails = ref<{ latestVersion?: number; currentVersion?: number; author?: string } | null>(null)

const isAuthor = computed(() => cloudMeta.value?.role === 'author')
const isSubscriber = computed(() => cloudMeta.value?.role === 'subscriber')

watch(
	() => instance.value?.path,
	(newPath) => {
		if (!newPath) return
		cloudMeta.value = getLocalInstancePackMeta(newPath)
		hasCloudUpdate.value = false
		cloudUpdateDetails.value = null
		void refreshAuthorChangesStatus()
		if (cloudMeta.value?.role === 'subscriber') {
			void handleCheckUpdate(false)
		}
	},
	{ immediate: true },
)

async function copyText(text: string, title: string) {
	try {
		await navigator.clipboard.writeText(text)
		addNotification({
			type: 'success',
			title,
			text: text,
		})
	} catch (e) {
		handleError(e as Error)
	}
}

async function handlePublishPack() {
	let user = activeBedringhUser.value ?? getActiveBedringhUser()
	if (!user?.username) {
		user = await resolveActiveBedringhUser()
		if (user) {
			activeBedringhUser.value = user
		}
	}

	if (!user?.username) {
		addNotification({
			type: 'warning',
			title: 'Требуется Bedringh ID',
			text: 'Чтобы делиться живыми сборками через облако, войдите в аккаунт Bedringh ID в настройках лаунчера.',
		})
		return
	}

	try {
		isPublishing.value = true
		const result = await publishInstanceAsCloudPack(instance.value)
		cloudMeta.value = getLocalInstancePackMeta(instance.value.path)
		await refreshAuthorChangesStatus()

		await copyText(result.shareCode, 'Код сборки скопирован')
		if (result.noChanges) {
			addNotification({
				type: 'info',
				title: 'Сборка актуальна',
				text: `Состав модов не менялся. Текущая версия: v${result.version}. Код: ${result.shareCode}`,
			})
		} else {
			addNotification({
				type: 'success',
				title: isAuthor.value ? 'Сборка обновлена в облаке!' : 'Сборка успешно опубликована!',
				text: `Код сборки: ${result.shareCode}. Отправьте его друзьям для установки!`,
			})
		}
	} catch (err: any) {
		addNotification({
			type: 'error',
			title: 'Ошибка публикации сборки',
			text: err?.message || 'Не удалось опубликовать сборку',
		})
	} finally {
		isPublishing.value = false
	}
}

async function handleCheckUpdate(notifyIfUpToDate = false) {
	if (!cloudMeta.value?.packId) return
	try {
		isCheckingUpdates.value = true
		const update = await checkInstanceCloudPackUpdate(instance.value.path)
		if (update?.hasUpdate) {
			hasCloudUpdate.value = true
			cloudUpdateDetails.value = update
			addNotification({
				type: 'info',
				title: 'Доступно обновление сборки!',
				text: `Автор выпустил версию v${update.latestVersion}. Вы можете обновить её прямо сейчас.`,
			})
		} else {
			hasCloudUpdate.value = false
			if (notifyIfUpToDate) {
				addNotification({
					type: 'success',
					title: 'Сборка актуальна',
					text: `У вас установлена последняя версия (v${cloudMeta.value.version}).`,
				})
			}
		}
	} catch (err) {
		console.warn('Failed to check cloud pack update:', err)
	} finally {
		isCheckingUpdates.value = false
	}
}

async function handleSyncPack() {
	try {
		isUpdating.value = true
		await syncSubscriberPackUpdate(instance.value, (text) => {
			console.log('[SyncPack]', text)
		})
		cloudMeta.value = getLocalInstancePackMeta(instance.value.path)
		hasCloudUpdate.value = false
		cloudUpdateDetails.value = null
		addNotification({
			type: 'success',
			title: 'Сборка обновлена!',
			text: `Моды синхронизированы с версией автора (v${cloudMeta.value?.version}).`,
		})
	} catch (err: any) {
		addNotification({
			type: 'error',
			title: 'Ошибка обновления сборки',
			text: err?.message || 'Не удалось синхронизировать сборку',
		})
	} finally {
		isUpdating.value = false
	}
}

async function copyModList() {
	try {
		const targetId = instance.value.id || instance.value.path
		const contentData = await loadInstanceContentData(targetId)
		const allItems = contentData.contentItems ?? []
		const mods = allItems.filter((i) => !i.project_type || i.project_type === 'mod')
		const itemsToCopy = mods.length > 0 ? mods : allItems

		if (itemsToCopy.length === 0) {
			addNotification({
				type: 'info',
				title: 'Список модов пуст',
				text: 'В этой сборке еще нет установленных модов.',
			})
			return
		}
		const lines = itemsToCopy.map((m, i) => {
			const title = m.project?.title ?? m.file_name.replace(/\.jar$/i, '')
			const version = m.version?.version_number ? ` (v${m.version.version_number})` : ''
			return `${i + 1}. ${title}${version}`
		})
		const text = `Сборка: ${instance.value.name}\nВсего модов: ${itemsToCopy.length}\n\n${lines.join('\n')}`
		await navigator.clipboard.writeText(text)
		addNotification({
			type: 'success',
			title: 'Список модов скопирован',
			text: `Скопировано ${itemsToCopy.length} модов в буфер обмена!`,
		})
	} catch (e) {
		handleError(e as Error)
	}
}

const accountRequiredModal = ref<InstanceType<typeof ModrinthAccountRequiredModal>>()
const invitePlayersModal = ref<InstanceType<typeof InvitePlayersModal>>()
const unlinkModal = ref<InstanceType<typeof ConfirmUnlinkModal>>()
const removeMemberModal = ref<InstanceType<typeof SharedInstanceRemoveMemberModal>>()
const publishModal = ref<InstanceType<typeof SharedInstancePublishModal>>()
const publishState = ref<'idle' | 'reviewing' | 'publishing'>('idle')
const pendingRemovalRow = ref<ShareRow | null>(null)
const importedModpackUnlinked = ref(false)

function notifyOperationError(error: unknown) {
	if (isSharedInstanceUnavailableError(error)) {
		notifySharedInstanceUnavailable(
			getSharedInstanceUnavailableReason(error),
			sharedInstanceState.unavailableManager.value,
		)
	} else {
		if (isSharedInstancesApiError(error)) sharedInstancesApiUnavailable.value = true
		notifySharedInstanceError(error)
	}
}

const eligibilityQuery = sharedInstanceState.eligibilityQuery

const members = useSharedInstanceMembers({
	instance,
	currentUserId,
	isSignedIn,
	actionsLocked,
	onError: notifyOperationError,
})
const remainingUserSlots = computed(() =>
	Math.max(0, SHARED_INSTANCE_USER_LIMIT - members.rows.value.length),
)
const hasRemainingUserSlots = computed(() => remainingUserSlots.value > 0)
const {
	inviteFriends,
	search: searchInviteUsers,
	requestFriend,
} = useSharedInstanceInviteCandidates({
	rows: members.rows,
	currentUserId,
	isSignedIn,
	actionsLocked,
})
const inviteLink = useSharedInstanceInviteLink(
	computed(() => instance.value?.id ?? ''),
	remainingUserSlots,
	notifyOperationError,
)

const linkedAccount = computed(() => {
	const manager = sharedInstanceState.manager.value
	return manager?.type === 'user'
		? { username: manager.name, avatarUrl: manager.avatarUrl, tintBy: manager.tintBy }
		: null
})
const lockedEmptyHeading = computed(() =>
	isSignedIn.value ? messages.lockedWrongAccountHeading : messages.lockedSignedOutHeading,
)
const lockedActionButton = computed(() =>
	isSignedIn.value ? messages.switchAccountButton : messages.signInButton,
)
const sharedInstanceUnavailableReason = sharedInstanceState.unavailableReason
const sharedInstanceUnavailable = computed(() => !!sharedInstanceUnavailableReason.value)
const sharedInstanceUnavailableManager = sharedInstanceState.unavailableManager
const unableToConnect = computed(
	() =>
		sharedInstancesApiUnavailable.value ||
		isSharedInstancesApiError(eligibilityQuery.error.value) ||
		isSharedInstancesApiError(members.query.error.value),
)
const membersTableLoading = computed(
	() =>
		members.rows.value.length === 0 &&
		!!instance.value.shared_instance &&
		(members.query.data.value === undefined || members.query.isFetching.value) &&
		!sharedInstanceUnavailable.value &&
		!sharedInstanceActionsLocked.value,
)
const showMembersTable = computed(
	() =>
		members.rows.value.length > 0 ||
		(!!instance.value.shared_instance &&
			members.query.data.value !== undefined &&
			!members.query.isFetching.value &&
			!sharedInstanceUnavailable.value &&
			!sharedInstanceActionsLocked.value),
)
const requiresUnlink = computed(
	() =>
		instance.value.link?.type === 'imported_modpack' &&
		!instance.value.shared_instance &&
		!importedModpackUnlinked.value,
)
const importedModpackBackupTip = computed(() =>
	instance.value.link?.type === 'imported_modpack'
		? (instance.value.link.name ?? instance.value.link.filename ?? undefined)
		: undefined,
)

const messages = defineMessages({
	signInButton: { id: 'app.instance.share.sign-in.button', defaultMessage: 'Sign in' },
	unableToConnectHeading: {
		id: 'app.instance.share.unable-to-connect.heading',
		defaultMessage: 'Unable to connect',
	},
	unableToConnectDescription: {
		id: 'app.instance.share.unable-to-connect.description',
		defaultMessage:
			'The shared instances service is not accessible at the moment, please try again later',
	},
	noFriendsInvitedHeading: {
		id: 'app.instance.share.empty.heading',
		defaultMessage: 'No friends invited',
	},
	noFriendsInvitedDescription: {
		id: 'app.instance.share.empty.description',
		defaultMessage: 'You can share this instance with your friends!',
	},
	inviteFriendsButton: {
		id: 'app.instance.share.empty.invite-friends-button',
		defaultMessage: 'Invite friends',
	},
	userLimitReached: {
		id: 'app.instance.share.invite-modal.user-limit-reached',
		defaultMessage: 'This instance has reached the {limit}-user limit.',
	},
	shareModalHeader: {
		id: 'app.instance.share.invite-modal.heading',
		defaultMessage: 'Share {name}',
	},
	lockedWrongAccountHeading: {
		id: 'app.instance.share.locked.wrong-account-heading',
		defaultMessage: 'Wrong account',
	},
	lockedSignedOutHeading: {
		id: 'app.instance.share.locked.signed-out-heading',
		defaultMessage: 'Not signed in',
	},
	lockedEmptyDescriptionPrefix: {
		id: 'app.instance.share.locked.empty-description-prefix',
		defaultMessage: 'You need to sign in as',
	},
	lockedEmptyDescriptionSuffix: {
		id: 'app.instance.share.locked.empty-description-suffix',
		defaultMessage: 'to access this page.',
	},
	linkedAccountFallback: {
		id: 'app.instance.share.locked.linked-account-fallback',
		defaultMessage: 'the linked account',
	},
	switchAccountButton: {
		id: 'app.instance.share.locked.switch-account-button',
		defaultMessage: 'Switch account',
	},
	unlinkForShareHeader: {
		id: 'app.instance.share.unlink.header',
		defaultMessage: 'Sharing requires unlinking',
	},
	unlinkForShareBody: {
		id: 'app.instance.share.unlink.body',
		defaultMessage: 'You must unlink this modpack to share your instance',
	},
})

function invitePlayer(payload: InvitePlayersInvitePayload) {
	if (actionsLocked.value || !hasRemainingUserSlots.value) return
	if (payload.source === 'search') void requestFriend(payload.user)
	members.invite(payload.user)
}
function cancelInvite(user: InvitePlayersUser) {
	const row = members.find(user.id, user.username)
	if (row) members.remove(row.id)
}
async function showInvitePlayers(event?: MouseEvent) {
	if (actionsLocked.value) return
	if (!isSignedIn.value) return signInToShare(event)
	if (!hasRemainingUserSlots.value) return
	if (requiresUnlink.value) return unlinkModal.value?.show()
	if (await inviteLink.ensure()) invitePlayersModal.value?.show(event)
}
async function unlinkImportedModpack() {
	try {
		await edit(instance.value.id, { link: null as unknown as undefined })
		importedModpackUnlinked.value = true
		await queryClient.invalidateQueries({ queryKey: ['linkedModpackInfo', instance.value.id] })
		if (await inviteLink.ensure()) invitePlayersModal.value?.show()
	} catch (error) {
		notifyOperationError(error)
	}
}
function showRemoveMemberModal(row: ShareRow) {
	if (!actionsLocked.value) {
		pendingRemovalRow.value = row
		removeMemberModal.value?.show()
	}
}
function reviewUpdate(event: MouseEvent) {
	publishModal.value?.show(event)
}
function removeMember(row: ShareRow) {
	members.remove(row.id)
}
function userProfileLink(username: string) {
	return !username || username.includes('@') ? undefined : `/user/${encodeURIComponent(username)}`
}
async function requestAuth(flow: ModrinthAuthFlow) {
	await auth.requestSignIn(`/instance/${encodeURIComponent(instance.value.id)}/share`, flow, {
		showModal: false,
	})
	return !!auth.session_token.value
}
function signInToShare(event?: MouseEvent) {
	void accountRequiredModal.value?.show(event)
}

provideSharedInstanceManagement({
	rows: members.rows,
	actionsLocked: sharedInstanceActionsLocked,
	inviteDisabled: computed(() => !hasRemainingUserSlots.value),
	invitePending: inviteLink.pending,
	pushUpdateDisabled: computed(
		() =>
			instance.value?.install_stage !== 'installed' ||
			publishState.value !== 'idle' ||
			offline.value,
	),
	pushUpdatePending: computed(() => publishState.value !== 'idle'),
	invite: (event) => void showInvitePlayers(event),
	remove: showRemoveMemberModal,
	pushUpdate: reviewUpdate,
})

watch(
	[eligibilityQuery.error, members.query.error],
	(errors) => {
		for (const error of errors) {
			if (isSharedInstancesApiError(error)) notifyOperationError(error)
		}
	},
	{ immediate: true },
)
watch([eligibilityQuery.data, members.query.data], ([eligibility, memberRows]) => {
	if (eligibility !== undefined && memberRows !== undefined) {
		sharedInstancesApiUnavailable.value = false
	}
})
watch(
	() => instance.value?.id,
	() => {
		importedModpackUnlinked.value = false
	},
)
// In Bedringh, sharing works via Bedringh ID / Cloud Modpacks or Export .mrpack, so do not force Modrinth auth popup on mount
</script>
