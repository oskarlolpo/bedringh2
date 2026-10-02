<script setup lang="ts">
import {
	CheckIcon,
	ChevronLeftIcon,
	CopyIcon,
	EditIcon,
	GameIcon,
	HeartIcon,
	MoreVerticalIcon,
	NoMessagesIllustration,
	PlayIcon,
	ReplyIcon,
	SearchIcon,
	SendIcon,
	ServerStackIcon,
	SparklesIcon,
	StarIcon,
	TrashIcon,
	UserIcon,
	UsersIcon,
	XIcon,
} from '@modrinth/assets'
import {
	Button,
	IconButton,
	injectNotificationManager,
	UserAvatar,
	useRelativeTime,
} from '@modrinth/ui'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import ModalWrapper from '@/components/ui/modal/ModalWrapper.vue'

import {
	type BedringhFriend,
	type ChatMessageReply,
	type ChatRoom,
	deleteChatMessage,
	dropFailedMessage,
	editChatMessage,
	fetchFriendProfile,
	type FriendProfileData,
	getChatKey,
	leaveChatRoom,
	loadChatHistory,
	type McInvitePayload,
	parseMcInvite,
	retryFailedMessage,
	sendChatMessage,
	sendTypingPing,
	toggleMessageReaction,
	useBedringhFriends,
} from '@/services/bedringh-friends'
import { quickJoinServer, triggerPlayInvite } from '@/services/bedringh-play-invite'
import { getActiveBedringhUser } from '@/services/bedringh-settings-sync'

const props = withDefaults(
	defineProps<{
		target: { type: 'dm' | 'room'; id: string }
		compact?: boolean
		showBackButton?: boolean
	}>(),
	{
		compact: false,
		showBackButton: false,
	},
)

const emit = defineEmits<{
	back: []
}>()

const router = useRouter()
const { addNotification } = injectNotificationManager()
const formatRelativeTime = useRelativeTime()
const { state } = useBedringhFriends()

const myUsername = computed(() => state.activeUsername || getActiveBedringhUser()?.username || 'Игрок')
const chatKey = computed(() => getChatKey(props.target))

const friendInfo = computed<BedringhFriend | undefined>(() => {
	if (props.target.type !== 'dm') return undefined
	return state.friends.find(
		(f) => f.username.toLowerCase() === props.target.id.toLowerCase(),
	)
})

const roomInfo = computed<ChatRoom | undefined>(() => {
	if (props.target.type !== 'room') return undefined
	return state.rooms.find((r) => r.id === props.target.id)
})

const rawMessages = computed(() => state.messagesByKey[chatKey.value] || [])
const peerReadAt = computed<number>(() => state.peerReadAtByKey[chatKey.value] || 0)
const activeTypers = computed<string[]>(() => {
	const entry = state.typingByKey[chatKey.value]
	if (!entry || Date.now() > entry.expiresAt) return []
	return entry.senders.filter((s) => s.toLowerCase() !== myUsername.value.toLowerCase())
})

const messagesContainer = ref<HTMLElement | null>(null)
const messageInputRef = ref<HTMLInputElement | null>(null)
const messageInput = ref('')
const replyTarget = ref<ChatMessageReply | null>(null)
const editingMessageId = ref<string | null>(null)
const highlightedMessageId = ref<string | null>(null)
const activeMenuMessageId = ref<string | null>(null)
const showEmojiPicker = ref(false)

// Модалка профиля друга
const profileModal = ref<InstanceType<typeof ModalWrapper> | null>(null)
const profileLoading = ref(false)
const friendProfile = ref<FriendProfileData | null>(null)

// Быстрые реакции в стиле Telegram
const TELEGRAM_QUICK_REACTIONS = ['👍', '❤️', '🔥', '🎉', '😂', '😮', '😢', '👏', '🙏', '💯'] as const

const LEGACY_REACTION_MAP: Record<string, string> = {
	heart: '❤️',
	fire: '🔥',
	sparkle: '✨',
	star: '⭐',
	check: '✅',
}

function getReactionEmoji(key: string): string {
	return LEGACY_REACTION_MAP[key] || key
}

interface EmojiCategory {
	id: string
	icon: string
	title: string
	emojis: string[]
}

const EMOJI_CATEGORIES: EmojiCategory[] = [
	{
		id: 'recent',
		icon: '🕒',
		title: 'Недавние',
		emojis: [],
	},
	{
		id: 'smileys',
		icon: '😀',
		title: 'Смайлы и эмоции',
		emojis: [
			'😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊',
			'😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪',
			'😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏',
			'😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕',
			'🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎',
			'🤓', '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😦', '😧',
			'😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫',
			'🥱', '😤', '😡', '😠', '🤬', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻',
			'👽', '👾', '🤖',
		],
	},
	{
		id: 'people',
		icon: '👋',
		title: 'Жесты и люди',
		emojis: [
			'👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟',
			'🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊',
			'🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪',
			'🦾', '🦿', '🦵', '🦶', '👂', '👃', '🧠', '👀', '👁️', '👅', '👄',
		],
	},
	{
		id: 'nature',
		icon: '🐻',
		title: 'Животные и природа',
		emojis: [
			'🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨', '🐯', '🦁',
			'🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇',
			'🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🕷️', '🦂',
			'🐢', '🐍', '🦎', '🐙', '🦑', '🦐', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳',
			'🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🦒',
			'🦘', '🌲', '🌳', '🌴', '🌱', '🌿', '☘️', '🍀', '🍄', '🌸', '🌺', '🌻',
			'🌹', '🌷', '🌼', '🌾', '🍂', '🍁',
		],
	},
	{
		id: 'food',
		icon: '🍔',
		title: 'Еда и напитки',
		emojis: [
			'🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑',
			'🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🥦', '🥬', '🥒', '🌶️', '🌽', '🥕',
			'🥔', '🥐', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🥞', '🧇', '🥓', '🥩',
			'🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🥪', '🥙', '🌮', '🌯', '🥗', '🍝',
			'🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🍤', '🍙', '🍚', '🍦', '🍧', '🍨',
			'🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍯', '☕',
			'🍵', '🧃', '🥤', '🧋', '🍺', '🍻', '🥂', '🍷', '🍹',
		],
	},
	{
		id: 'gaming',
		icon: '⛏️',
		title: 'Minecraft и Игры',
		emojis: [
			'⛏️', '🪓', '⚔️', '🛡️', '🏹', '💎', '🧱', '🪵', '📦', '🍖', '🍎', '🍞',
			'🧪', '🧭', '🗺️', '🪙', '👑', '🏆', '🎯', '🎮', '🕹️', '🎲', '🚀', '💣',
			'🔔', '🚪', '🪟', '🏠', '🏰', '🗿', '🧟', '🧙', '🧌', '🧝', '🧛', '🐉',
			'🌋', '🎣', '⛺', '🔮', '🪄', '📜', '🗝️', '🪝', '🪜', '🪣', '🏮',
		],
	},
	{
		id: 'activities',
		icon: '⚽',
		title: 'Спорт и активность',
		emojis: [
			'⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸', '🏒',
			'🥊', '🥋', '🛹', '🛼', '⛸️', '🎿', '🏂', '🏋️', '🧗', '🏄', '🏊', '🚴',
			'🏇', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🎫', '🎟️', '🎪', '🎭', '🎨',
			'🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻',
		],
	},
	{
		id: 'travel',
		icon: '🚗',
		title: 'Путешествия и места',
		emojis: [
			'🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚',
			'🚛', '🚜', '🛵', '🏍️', '🚲', '🛴', '🚨', '🚔', '🚍', '🚂', '🚆', '🚄',
			'🚅', '🚈', '✈️', '🛫', '🛬', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛳️',
			'⛴️', '🚢', '⚓', '⛽', '🚧', '🚦', '🚥', '🗺️', '🗿', '🗽', '🗼', '🏰',
		],
	},
	{
		id: 'objects',
		icon: '💡',
		title: 'Предметы и вещи',
		emojis: [
			'💡', '🔦', '🕯️', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '💾', '💿',
			'📀', '📷', '📸', '📹', '🎥', '📞', '☎️', '📺', '📻', '🎙️', '🧭', '⏰',
			'⏱️', '⏳', '📡', '🔋', '🔌', '💵', '💰', '💳', '💎', '⚖️', '🪜', '🧰',
			'🔧', '🔨', '⚒️', '🛠️', '🪛', '🔩', '⚙️', '🧲', '🔫', '💣', '🧨', '🪓',
			'🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🔮', '🧿', '💈', '🔭', '🔬', '💊', '💉',
			'🩸', '🩹',
		],
	},
	{
		id: 'symbols',
		icon: '🔣',
		title: 'Символы и знаки',
		emojis: [
			'❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕',
			'💞', '💓', '💗', '💖', '💘', '💝', '💟', '🔥', '✨', '💥', '💯', '🎉',
			'🎊', '⚡', '🌟', '💫', '☀️', '🌙', '⭐', '🎈', '🎁', '💤', '💢', '❗',
			'❓', '‼️', '⁉️', '⚠️', '⛔', '🚫', '✅', '❌', '⭕', '🛑', '♻️', '🌐',
			'💠', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🎵', '🎶', '➕', '➖',
			'✖️', '➗', '♾️', '💲', '🔝', '🔛', '🔜', '✔️', '☑️', '🔘', '🔴', '🟠',
			'🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤',
		],
	},
]

const DEFAULT_RECENT_EMOJIS = ['👍', '❤️', '🔥', '🎉', '😂', '😮', '👏', '🙏', '💯', '🤣', '✨', '😍', '😎', '💀', '⛏️', '💎']
const RECENT_EMOJIS_KEY = 'bedringh_recent_emojis'

const recentEmojis = ref<string[]>(loadRecentEmojis())
const activeEmojiTab = ref('smileys')
const emojiSearchQuery = ref('')

function loadRecentEmojis(): string[] {
	try {
		const raw = localStorage.getItem(RECENT_EMOJIS_KEY)
		if (raw) {
			const parsed = JSON.parse(raw)
			if (Array.isArray(parsed) && parsed.length > 0) return parsed
		}
	} catch {}
	return DEFAULT_RECENT_EMOJIS
}

function saveRecentEmoji(emoji: string) {
	const set = new Set([emoji, ...recentEmojis.value])
	recentEmojis.value = Array.from(set).slice(0, 24)
	try {
		localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(recentEmojis.value))
	} catch {}
}

const displayedEmojis = computed<string[]>(() => {
	const query = emojiSearchQuery.value.trim().toLowerCase()
	if (query) {
		const all = new Set<string>()
		for (const cat of EMOJI_CATEGORIES) {
			for (const em of cat.emojis) {
				all.add(em)
			}
		}
		return Array.from(all).filter((e) => e.includes(query))
	}
	if (activeEmojiTab.value === 'recent') {
		return recentEmojis.value
	}
	const cat = EMOJI_CATEGORIES.find((c) => c.id === activeEmojiTab.value)
	return cat ? cat.emojis : []
})

function onSelectEmoji(emoji: string) {
	saveRecentEmoji(emoji)
	insertEmoji(emoji)
}

function isMyReaction(msg: RenderedMessage, reactionKey: string): boolean {
	if (!msg.reactions) return false
	const directUsers = msg.reactions[reactionKey]
	if (directUsers && directUsers.some((u) => u.toLowerCase() === myUsername.value.toLowerCase())) {
		return true
	}
	for (const [legKey, emoji] of Object.entries(LEGACY_REACTION_MAP)) {
		if ((emoji === reactionKey || legKey === reactionKey) && msg.reactions[legKey]) {
			if (msg.reactions[legKey].some((u) => u.toLowerCase() === myUsername.value.toLowerCase())) {
				return true
			}
		}
	}
	return false
}

function toggleReaction(msgId: string, emojiOrKey: string) {
	saveRecentEmoji(emojiOrKey)
	void toggleMessageReaction(props.target, msgId, emojiOrKey)
}

function formatDayLabel(ts: number): string {
	const d = new Date(ts)
	const now = new Date()
	const isToday =
		d.getDate() === now.getDate() &&
		d.getMonth() === now.getMonth() &&
		d.getFullYear() === now.getFullYear()
	if (isToday) return 'Сегодня'

	const yest = new Date(now)
	yest.setDate(now.getDate() - 1)
	const isYesterday =
		d.getDate() === yest.getDate() &&
		d.getMonth() === yest.getMonth() &&
		d.getFullYear() === yest.getFullYear()
	if (isYesterday) return 'Вчера'

	return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

function formatTime(ts: number): string {
	return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

interface RenderedMessage {
	id: string
	localId?: string
	state?: 'sending' | 'sent' | 'failed'
	sender: string
	content: string
	replyTo?: ChatMessageReply
	reactions?: Record<string, string[]>
	editedAt?: number
	createdAt: number
	showDayDivider: boolean
	dayLabel: string
	isGrouped: boolean
	avatarUrl: string
	isMine: boolean
	formattedTime: string
	invite: McInvitePayload | null
}

const renderedMessages = computed<RenderedMessage[]>(() => {
	const list = rawMessages.value
	const myName = myUsername.value.toLowerCase()
	const avatarCache = new Map<string, string>()

	const getCachedAvatar = (username: string) => {
		const lower = username.toLowerCase()
		if (avatarCache.has(lower)) return avatarCache.get(lower)!
		const fr = state.friends.find((f) => f.username.toLowerCase() === lower)
		const url = fr?.avatarUrl || `https://mc-heads.net/avatar/${encodeURIComponent(username)}/64`
		avatarCache.set(lower, url)
		return url
	}

	const result: RenderedMessage[] = []
	let prevDate: Date | null = null
	let prevSender: string | null = null
	let prevTs = 0

	for (let i = 0; i < list.length; i++) {
		const m = list[i]
		const invite = parseMcInvite(m.content)
		const trimmedText = (m.content || '').trim()

		// Игнорируем полностью пустые сообщения без контента и без инвайтов (бывшие фото/битые записи)
		if (!trimmedText && !invite) {
			continue
		}

		const curDate = new Date(m.createdAt)
		let showDayDivider = false
		let dayLabel = ''

		if (
			!prevDate ||
			curDate.getFullYear() !== prevDate.getFullYear() ||
			curDate.getMonth() !== prevDate.getMonth() ||
			curDate.getDate() !== prevDate.getDate()
		) {
			showDayDivider = true
			dayLabel = formatDayLabel(m.createdAt)
			prevDate = curDate
		}

		const isMineUser = m.sender.toLowerCase() === myName
		const isGrouped =
			!showDayDivider &&
			prevSender !== null &&
			prevSender.toLowerCase() === m.sender.toLowerCase() &&
			m.createdAt - prevTs < 3 * 60 * 1000

		prevSender = m.sender
		prevTs = m.createdAt

		result.push({
			id: m.id,
			localId: m.localId,
			state: m.state,
			sender: m.sender,
			content: trimmedText,
			replyTo: m.replyTo,
			reactions: m.reactions,
			editedAt: m.editedAt,
			createdAt: m.createdAt,
			showDayDivider,
			dayLabel,
			isGrouped,
			avatarUrl: getCachedAvatar(m.sender),
			isMine: isMineUser,
			formattedTime: formatTime(m.createdAt),
			invite,
		})
	}

	return result
})

function scrollToBottom(smooth = false) {
	nextTick(() => {
		const el = messagesContainer.value
		if (!el) return
		if (smooth) {
			el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
		} else {
			el.scrollTop = el.scrollHeight
		}
	})
}

function scrollToMessage(msgId: string) {
	const el = document.getElementById(`chat-msg-${msgId}`)
	if (el) {
		el.scrollIntoView({ behavior: 'smooth', block: 'center' })
		highlightedMessageId.value = msgId
		setTimeout(() => {
			if (highlightedMessageId.value === msgId) {
				highlightedMessageId.value = null
			}
		}, 1800)
	}
}

watch(
	() => props.target,
	async (newTarget) => {
		replyTarget.value = null
		editingMessageId.value = null
		showEmojiPicker.value = false
		await loadChatHistory(newTarget)
		scrollToBottom(false)
	},
	{ immediate: true, deep: true },
)

watch(
	() => rawMessages.value.length,
	() => {
		scrollToBottom(true)
	},
)

let lastTypingTime = 0
function onInputKeydown(e: KeyboardEvent) {
	if (e.key === 'Enter' && !e.shiftKey) {
		e.preventDefault()
		void handleSend()
		return
	}
	if (e.key === 'Escape') {
		if (showEmojiPicker.value) {
			showEmojiPicker.value = false
			return
		}
		if (editingMessageId.value) {
			editingMessageId.value = null
			messageInput.value = ''
		} else if (replyTarget.value) {
			replyTarget.value = null
		}
		return
	}
	const now = Date.now()
	if (now - lastTypingTime > 3000) {
		lastTypingTime = now
		void sendTypingPing(props.target)
	}
}

function insertEmoji(emoji: string) {
	const el = messageInputRef.value
	if (!el) {
		messageInput.value += emoji
		return
	}
	const start = el.selectionStart ?? messageInput.value.length
	const end = el.selectionEnd ?? messageInput.value.length
	const text = messageInput.value
	messageInput.value = text.substring(0, start) + emoji + text.substring(end)
	nextTick(() => {
		el.focus()
		const newPos = start + emoji.length
		el.setSelectionRange(newPos, newPos)
	})
}

async function handleSend() {
	const text = messageInput.value.trim()
	if (!text) return

	showEmojiPicker.value = false

	if (editingMessageId.value) {
		const msgId = editingMessageId.value
		editingMessageId.value = null
		messageInput.value = ''
		await editChatMessage(props.target, msgId, text)
		return
	}

	const reply = replyTarget.value || undefined
	messageInput.value = ''
	replyTarget.value = null

	await sendChatMessage({
		target: props.target,
		content: text,
		replyTo: reply,
	})
	scrollToBottom(true)
}

function startReply(msg: RenderedMessage) {
	editingMessageId.value = null
	showEmojiPicker.value = false
	replyTarget.value = {
		id: msg.id,
		sender: msg.sender,
		preview: msg.invite ? `Приглашение: ${msg.invite.name}` : msg.content,
	}
	activeMenuMessageId.value = null
	nextTick(() => {
		messageInputRef.value?.focus()
	})
}

function startEdit(msg: RenderedMessage) {
	replyTarget.value = null
	showEmojiPicker.value = false
	editingMessageId.value = msg.id
	messageInput.value = msg.content
	activeMenuMessageId.value = null
	nextTick(() => {
		messageInputRef.value?.focus()
	})
}

async function handleDelete(msg: RenderedMessage) {
	activeMenuMessageId.value = null
	await deleteChatMessage(props.target, msg.id)
}

function handleCopyText(text: string) {
	activeMenuMessageId.value = null
	navigator.clipboard.writeText(text)
	addNotification({
		title: 'Скопировано',
		text: 'Текст скопирован в буфер обмена',
		type: 'success',
	})
}

async function handleInvitePlay() {
	const title =
		props.target.type === 'room'
			? roomInfo.value?.title || 'Группу'
			: friendInfo.value?.username || props.target.id

	await triggerPlayInvite(
		{
			type: props.target.type,
			id: props.target.id,
			title,
		},
		{
			navigateToServers: () => void router.push('/hosting/manage/'),
			notify: (n) =>
				addNotification({
					title: n.title,
					text: n.text,
					type: n.type || 'info',
				}),
		},
	)
}

async function handleQuickJoin(invite: McInvitePayload) {
	await quickJoinServer(invite, (n) =>
		addNotification({
			title: n.title,
			text: n.text,
			type: n.type || 'info',
		}),
	)
}

async function handleOpenFriendProfile() {
	if (props.target.type !== 'dm') return
	profileModal.value?.show()
	profileLoading.value = true
	friendProfile.value = await fetchFriendProfile(props.target.id)
	profileLoading.value = false
}

async function handleLeaveRoom() {
	if (props.target.type !== 'room') return
	const ok = await leaveChatRoom(props.target.id)
	if (ok) {
		emit('back')
	}
}

function handleGlobalClick(e: MouseEvent) {
	activeMenuMessageId.value = null
	const targetEl = e.target as HTMLElement | null
	if (showEmojiPicker.value && !targetEl?.closest('.emoji-picker-container')) {
		showEmojiPicker.value = false
	}
}

onMounted(() => {
	window.addEventListener('click', handleGlobalClick)
})

onUnmounted(() => {
	window.removeEventListener('click', handleGlobalClick)
})
</script>

<template>
	<div
		class="flex flex-col h-full min-h-0 bg-surface-2 border border-solid border-surface-5/70 rounded-2xl overflow-hidden select-text shadow-sm"
		style="border-radius: 1rem; border-color: var(--color-divider);"
	>
		<!-- Шапка чата: лаконичная, скругленная вверху -->
		<div
			class="flex items-center justify-between gap-3 px-4 py-3 bg-surface-2 border-0 border-b border-solid border-surface-5/70 shrink-0 rounded-t-2xl"
			style="border-top-left-radius: 1rem; border-top-right-radius: 1rem; border-top: 0; border-left: 0; border-right: 0; border-bottom: 1px solid var(--color-divider);"
		>
			<div class="flex items-center gap-3 min-w-0">
				<IconButton
					v-if="showBackButton"
					:icon="ChevronLeftIcon"
					type="transparent"
					size="sm"
					title="Назад"
					@click="emit('back')"
				/>

				<!-- Личный диалог -->
				<template v-if="target.type === 'dm'">
					<div class="relative shrink-0 cursor-pointer" @click="handleOpenFriendProfile">
						<UserAvatar
							:src="state.friends.find((f) => f.username.toLowerCase() === target.id.toLowerCase())?.avatarUrl || `https://mc-heads.net/avatar/${encodeURIComponent(target.id)}/64`"
							size="36px"
							badge
							:badge-color="
								friendInfo?.status === 'in_game'
									? 'purple'
									: friendInfo?.status === 'online'
										? 'green'
										: 'gray'
							"
							:grayscale="friendInfo?.status === 'offline' || !friendInfo"
						/>
					</div>
					<div class="flex flex-col min-w-0 cursor-pointer" @click="handleOpenFriendProfile">
						<div class="flex items-center gap-2">
							<span class="font-bold text-sm text-contrast truncate">{{ target.id }}</span>
							<span
								v-if="friendInfo?.totalHours"
								class="px-1.5 py-0.2 text-[10px] font-semibold rounded bg-surface-3 text-secondary"
							>
								{{ friendInfo.totalHours }} ч
							</span>
						</div>
						<span v-if="activeTypers.length > 0" class="text-xs text-brand font-medium animate-pulse">
							печатает...
						</span>
						<span
							v-else-if="friendInfo?.status === 'in_game'"
							class="text-xs text-purple-400 truncate flex items-center gap-1"
						>
							<GameIcon class="w-3 h-3 shrink-0" />
							<span>
								В игре · {{ friendInfo.gameInfo?.serverName || friendInfo.gameInfo?.instanceName || 'Minecraft' }}
							</span>
						</span>
						<span v-else-if="friendInfo?.status === 'online'" class="text-xs text-green-400 font-medium">
							В сети
						</span>
						<span v-else class="text-xs text-secondary truncate">
							{{
								friendInfo?.lastSeen
									? `Был(а) ${formatRelativeTime(new Date(friendInfo.lastSeen).toISOString())}`
									: 'Не в сети'
							}}
						</span>
					</div>
				</template>

				<!-- Групповая комната -->
				<template v-else>
					<div class="w-9 h-9 rounded-full bg-brand/15 text-brand flex items-center justify-center shrink-0">
						<UsersIcon class="w-5 h-5" />
					</div>
					<div class="flex flex-col min-w-0">
						<span class="font-bold text-sm text-contrast truncate">
							{{ roomInfo?.title || 'Групповой чат' }}
						</span>
						<span v-if="activeTypers.length > 0" class="text-xs text-brand font-medium animate-pulse">
							{{ activeTypers.join(', ') }} печатает...
						</span>
						<span v-else class="text-xs text-secondary truncate">
							{{ roomInfo?.members?.length || 1 }} участн. · {{ roomInfo?.members?.join(', ') }}
						</span>
					</div>
				</template>
			</div>

			<!-- Кнопки действий в шапке чата -->
			<div class="flex items-center gap-2 shrink-0">
				<Button
					v-if="target.type === 'dm' && friendInfo?.status === 'in_game' && friendInfo.gameInfo?.serverAddress"
					type="colored"
					color="purple"
					size="sm"
					@click="
						handleQuickJoin({
							addr: friendInfo.gameInfo.serverAddress,
							name: friendInfo.gameInfo.serverName || friendInfo.gameInfo.instanceName || friendInfo.username,
							version: friendInfo.gameInfo.mcVersion,
							loader: friendInfo.gameInfo.loader,
							packCode: friendInfo.gameInfo.packCode,
						})
					"
				>
					<PlayIcon class="w-3.5 h-3.5" />
					<span>Зайти</span>
				</Button>

				<IconButton
					:icon="ServerStackIcon"
					type="transparent"
					size="sm"
					title="Позвать играть на сервере"
					@click="handleInvitePlay"
				/>

				<IconButton
					v-if="target.type === 'dm'"
					:icon="UserIcon"
					type="transparent"
					size="sm"
					title="Профиль игрока"
					@click="handleOpenFriendProfile"
				/>

				<IconButton
					v-if="target.type === 'room'"
					:icon="TrashIcon"
					type="transparent"
					color="red"
					size="sm"
					title="Покинуть группу"
					@click="handleLeaveRoom"
				/>
			</div>
		</div>

		<!-- Лента сообщений: спокойная единая канва, без провалов в черноту -->
		<div
			ref="messagesContainer"
			class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-1.5 min-h-0 bg-surface-2"
		>
			<div
				v-if="renderedMessages.length === 0"
				class="m-auto flex flex-col items-center justify-center text-center p-6 text-secondary gap-3"
			>
				<component :is="NoMessagesIllustration" class="w-20 h-20 opacity-60" />
				<span class="text-sm font-semibold text-contrast">Начните общение!</span>
				<span class="text-xs max-w-[280px]">
					Отправляйте сообщения, смайлики или приглашения играть на вашем сервере.
				</span>
			</div>

			<template v-for="msg in renderedMessages" :key="msg.id">
				<!-- Разделитель по дням -->
				<div v-if="msg.showDayDivider" class="flex items-center justify-center my-3 select-none">
					<span
						class="px-3 py-0.5 rounded-full bg-surface-3/80 border border-solid border-surface-5/70 text-[11px] font-medium text-secondary"
						style="border-color: var(--color-divider);"
					>
						{{ msg.dayLabel }}
					</span>
				</div>

				<!-- Строка сообщения -->
				<div
					:id="`chat-msg-${msg.id}`"
					class="group relative flex gap-3 transition-colors rounded-xl px-1.5 py-0.5"
					:class="[
						msg.isMine ? 'flex-row-reverse' : 'flex-row',
						msg.isGrouped ? 'mt-0.5' : 'mt-2',
						highlightedMessageId === msg.id ? 'bg-brand/10' : '',
					]"
				>
					<!-- Аватар собеседника: прижат к ВЕРХУ сообщения -->
					<div v-if="!msg.isMine" class="w-8 shrink-0 flex flex-col justify-start">
						<img
							v-if="!msg.isGrouped"
							:src="msg.avatarUrl"
							alt=""
							class="w-8 h-8 rounded-lg object-cover image-pixelated bg-surface-3 mt-0.5"
						/>
						<div v-else class="w-8"></div>
					</div>

					<!-- Пузырь сообщения: полностью скруглённый без острых углов -->
					<div
						class="relative max-w-[75%] flex flex-col gap-1 rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed shadow-sm"
						style="border-radius: 1rem;"
						:class="
							msg.isMine
								? 'bg-brand/15 border border-solid border-brand/25 text-contrast'
								: 'bg-surface-3 border border-solid border-surface-5/70 text-contrast'
						"
						:style="!msg.isMine ? 'border-color: var(--color-divider);' : ''"
					>
						<!-- Имя автора в групповом чате -->
						<span
							v-if="target.type === 'room' && !msg.isMine && !msg.isGrouped"
							class="text-[11px] font-bold text-brand"
						>
							{{ msg.sender }}
						</span>

						<!-- Цитата Reply -->
						<div
							v-if="msg.replyTo"
							class="flex flex-col pl-2 border-l-2 border-solid border-brand bg-surface-4/40 rounded px-2.5 py-1 cursor-pointer hover:bg-surface-4/60 transition-colors select-none mb-1"
							@click="scrollToMessage(msg.replyTo.id)"
						>
							<span class="text-[10px] font-bold text-brand">{{ msg.replyTo.sender }}</span>
							<span class="text-[11px] text-secondary truncate">{{ msg.replyTo.preview }}</span>
						</div>

						<!-- Карточка приглашения на сервер ⟪mc-invite⟫ -->
						<div
							v-if="msg.invite"
							class="flex flex-col gap-2.5 p-3 rounded-xl bg-surface-2 border border-solid border-purple-500/30 min-w-[240px]"
						>
							<div class="flex items-center gap-2.5">
								<div class="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-300 flex items-center justify-center shrink-0">
									<ServerStackIcon class="w-4 h-4" />
								</div>
								<div class="flex flex-col min-w-0 flex-1">
									<span class="text-[10px] font-bold uppercase tracking-wider text-purple-300">
										Приглашение на сервер
									</span>
									<span class="text-sm font-bold text-contrast truncate">
										{{ msg.invite.name }}
									</span>
								</div>
							</div>

							<div class="flex items-center justify-between gap-2 text-xs text-secondary bg-surface-3 px-2.5 py-1.5 rounded-lg select-all font-mono">
								<span class="truncate">{{ msg.invite.addr }}</span>
								<span
									v-if="msg.invite.version"
									class="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-semibold shrink-0 text-[10px]"
								>
									{{ msg.invite.version }}
								</span>
							</div>

							<div class="flex items-center gap-2">
								<button
									type="button"
									class="flex-1 py-1.5 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs border-0 cursor-pointer transition-all flex items-center justify-center gap-1.5 shadow-sm"
									@click="handleQuickJoin(msg.invite)"
								>
									<PlayIcon class="w-3.5 h-3.5" />
									<span>Зайти на сервер</span>
								</button>
								<button
									type="button"
									class="p-1.5 rounded-lg bg-surface-3 hover:bg-surface-4 text-secondary hover:text-contrast border border-solid border-surface-5/70 cursor-pointer"
									style="border-color: var(--color-divider);"
									title="Скопировать адрес"
									@click="handleCopyText(msg.invite.addr)"
								>
									<CopyIcon class="w-3.5 h-3.5" />
								</button>
							</div>
						</div>

						<!-- Обычный текст сообщения -->
						<span v-else class="whitespace-pre-wrap break-words">{{ msg.content }}</span>

						<!-- Реакции под сообщением в стиле Telegram -->
						<div
							v-if="msg.reactions && Object.keys(msg.reactions).length > 0"
							class="flex flex-wrap items-center gap-1 mt-1.5 select-none"
						>
							<button
								v-for="(users, rKey) in msg.reactions"
								:key="rKey"
								type="button"
								class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border border-solid cursor-pointer select-none transition-all active:scale-95 shadow-2xs"
								:class="
									isMyReaction(msg, String(rKey))
										? 'bg-brand/20 border-brand/50 text-brand font-semibold'
										: 'bg-surface-3 hover:bg-surface-4 border-surface-5/70 text-secondary hover:text-contrast'
								"
								:style="!isMyReaction(msg, String(rKey)) ? 'border-color: var(--color-divider);' : ''"
								:title="`${users.join(', ')}`"
								@click.stop="toggleReaction(msg.id, String(rKey))"
							>
								<span class="text-sm leading-none">{{ getReactionEmoji(String(rKey)) }}</span>
								<span class="text-[11px] font-bold leading-none">{{ users.length }}</span>
							</button>
						</div>

						<!-- Мета-строка: время, пометка "изм.", статус доставки / галочки прочтения -->
						<div class="flex items-center justify-end gap-1 text-[10px] text-secondary/70 select-none mt-0.5">
							<span v-if="msg.editedAt">изм.</span>
							<span>{{ msg.formattedTime }}</span>
							<template v-if="msg.isMine">
								<span v-if="msg.state === 'sending'" class="text-secondary">...</span>
								<span v-else-if="msg.state === 'failed'" class="text-red-400 font-semibold flex items-center gap-1">
									Ошибка
									<button
										type="button"
										class="underline bg-transparent border-0 text-red-300 cursor-pointer p-0 text-[10px]"
										@click="retryFailedMessage(target, msg.localId!)"
									>
										Повторить
									</button>
									<button
										type="button"
										class="underline bg-transparent border-0 text-secondary cursor-pointer p-0 text-[10px]"
										@click="dropFailedMessage(target, msg.localId!)"
									>
										×
									</button>
								</span>
								<span
									v-else
									class="inline-flex items-center"
									:class="msg.createdAt <= peerReadAt ? 'text-brand' : 'text-secondary'"
									:title="msg.createdAt <= peerReadAt ? 'Прочитано' : 'Доставлено'"
								>
									<CheckIcon class="w-3 h-3" />
									<CheckIcon v-if="msg.createdAt <= peerReadAt" class="w-3 h-3 -ml-1.5" />
								</span>
							</template>
						</div>
					</div>

					<!-- Всплывающая плашка реакций и быстрых действий в стиле Telegram (Quick Reactions Bar) -->
					<div
						class="opacity-0 group-hover:opacity-100 transition-all duration-150 pointer-events-none group-hover:pointer-events-auto absolute -top-4.5 z-20 flex items-center gap-0.5 bg-surface-3/95 backdrop-blur-md border border-solid border-surface-5/80 rounded-full px-2 py-0.5 shadow-xl select-none"
						style="border-color: var(--color-divider);"
						:class="msg.isMine ? 'right-4' : 'left-11'"
					>
						<!-- Кнопки быстрых реакций Telegram -->
						<button
							v-for="reactionEmoji in TELEGRAM_QUICK_REACTIONS"
							:key="reactionEmoji"
							type="button"
							class="w-7 h-7 rounded-full text-base flex items-center justify-center bg-transparent hover:bg-surface-4 hover:scale-135 active:scale-95 transition-all duration-150 cursor-pointer border-0"
							:class="isMyReaction(msg, reactionEmoji) ? 'bg-brand/20 ring-1 ring-brand/60' : ''"
							:title="reactionEmoji"
							@click.stop="toggleReaction(msg.id, reactionEmoji)"
						>
							{{ reactionEmoji }}
						</button>

						<div class="w-px h-3.5 bg-surface-5/80 mx-1"></div>

						<!-- Ответить -->
						<button
							type="button"
							class="w-6 h-6 rounded-full flex items-center justify-center text-secondary hover:text-contrast hover:bg-surface-4 bg-transparent border-0 cursor-pointer transition-colors"
							title="Ответить"
							@click.stop="startReply(msg)"
						>
							<ReplyIcon class="w-3.5 h-3.5" />
						</button>

						<!-- Меню действий -->
						<div class="relative">
							<button
								type="button"
								class="w-6 h-6 rounded-full flex items-center justify-center text-secondary hover:text-contrast hover:bg-surface-4 bg-transparent border-0 cursor-pointer transition-colors"
								title="Ещё"
								@click.stop="activeMenuMessageId = activeMenuMessageId === msg.id ? null : msg.id"
							>
								<MoreVerticalIcon class="w-3.5 h-3.5" />
							</button>

							<!-- Выпадающее меню сообщения в стиле Modrinth PopoutMenu -->
							<div
								v-if="activeMenuMessageId === msg.id"
								class="absolute top-full mt-1.5 z-30 bg-surface-3 border border-solid border-surface-5/80 rounded-xl shadow-xl p-1.5 flex flex-col gap-0.5 min-w-[150px]"
								style="border-color: var(--color-divider);"
								:class="msg.isMine ? 'right-0' : 'left-0'"
								@click.stop
							>
								<!-- Быстрая строка реакций Telegram -->
								<div
									class="flex items-center justify-between gap-1 px-1 pb-1.5 mb-1 border-0 border-b border-solid border-surface-5/70"
									style="border-top: 0; border-left: 0; border-right: 0; border-bottom: 1px solid var(--color-divider);"
								>
									<button
										v-for="em in TELEGRAM_QUICK_REACTIONS.slice(0, 7)"
										:key="em"
										type="button"
										class="w-7 h-7 rounded-full text-base flex items-center justify-center hover:bg-surface-4 hover:scale-125 active:scale-95 transition-transform cursor-pointer border-0 bg-transparent"
										:class="isMyReaction(msg, em) ? 'bg-brand/20 ring-1 ring-brand' : ''"
										@click.stop="
											toggleReaction(msg.id, em);
											activeMenuMessageId = null
										"
									>
										{{ em }}
									</button>
								</div>

								<button
									type="button"
									class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-contrast hover:bg-surface-4 bg-transparent border-0 cursor-pointer text-left"
									@click="startReply(msg)"
								>
									<ReplyIcon class="w-3.5 h-3.5 text-secondary" />
									<span>Ответить</span>
								</button>
								<button
									v-if="msg.content"
									type="button"
									class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-contrast hover:bg-surface-4 bg-transparent border-0 cursor-pointer text-left"
									@click="handleCopyText(msg.content)"
								>
									<CopyIcon class="w-3.5 h-3.5 text-secondary" />
									<span>Копировать</span>
								</button>
								<button
									v-if="msg.isMine && !msg.invite"
									type="button"
									class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-contrast hover:bg-surface-4 bg-transparent border-0 cursor-pointer text-left"
									@click="startEdit(msg)"
								>
									<EditIcon class="w-3.5 h-3.5 text-secondary" />
									<span>Изменить</span>
								</button>
								<button
									v-if="msg.isMine"
									type="button"
									class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-500/15 bg-transparent border-0 cursor-pointer text-left"
									@click="handleDelete(msg)"
								>
									<TrashIcon class="w-3.5 h-3.5" />
									<span>Удалить</span>
								</button>
							</div>
						</div>
					</div>
				</div>
			</template>
		</div>

		<!-- Плашка активного ответа или редактирования над полем ввода -->
		<div
			v-if="replyTarget || editingMessageId"
			class="flex items-center justify-between gap-2 px-4 py-2 bg-surface-3 border-0 border-t border-solid border-surface-5/70 text-xs"
			style="border-left: 0; border-right: 0; border-bottom: 0; border-top: 1px solid var(--color-divider);"
		>
			<div class="flex items-center gap-2 min-w-0">
				<ReplyIcon v-if="replyTarget" class="w-3.5 h-3.5 text-brand shrink-0" />
				<EditIcon v-else class="w-3.5 h-3.5 text-brand shrink-0" />
				<div class="flex flex-col min-w-0">
					<span class="font-bold text-brand text-[11px]">
						{{ replyTarget ? `Ответ ${replyTarget.sender}` : 'Редактирование сообщения' }}
					</span>
					<span v-if="replyTarget" class="text-secondary truncate text-[11px]">
						{{ replyTarget.preview }}
					</span>
				</div>
			</div>
			<button
				type="button"
				class="p-1 rounded bg-transparent border-0 text-secondary hover:text-contrast cursor-pointer"
				@click="
					replyTarget = null;
					editingMessageId = null;
					messageInput = ''
				"
			>
				<XIcon class="w-3.5 h-3.5" />
			</button>
		</div>

		<!-- Лаконичный блок ввода в стиле StyledInput (со скруглённым низом) -->
		<div
			class="relative emoji-picker-container p-3 bg-surface-2 border-0 border-t border-solid border-surface-5/70 rounded-b-2xl"
			style="border-bottom-left-radius: 1rem; border-bottom-right-radius: 1rem; border-left: 0; border-right: 0; border-bottom: 0; border-top: 1px solid var(--color-divider);"
		>
			<!-- Всплывающая панель Emoji в стиле Telegram -->
			<div
				v-if="showEmojiPicker"
				class="absolute bottom-full left-3 mb-2 w-[340px] bg-surface-3 border border-solid border-surface-5/80 rounded-2xl shadow-2xl p-2.5 z-40 flex flex-col gap-2 overflow-hidden"
				style="border-radius: 1rem; border-color: var(--color-divider);"
				@click.stop
			>
				<!-- Категории смайликов (иконки как в Telegram) -->
				<div
					class="flex items-center justify-between gap-0.5 pb-1.5 border-0 border-b border-solid border-surface-5/70 select-none overflow-x-auto no-scrollbar"
					style="border-top: 0; border-left: 0; border-right: 0; border-bottom: 1px solid var(--color-divider);"
				>
					<button
						v-for="cat in EMOJI_CATEGORIES"
						:key="cat.id"
						type="button"
						class="w-7 h-7 rounded-lg text-base flex items-center justify-center shrink-0 border-0 cursor-pointer transition-all duration-150"
						:class="
							activeEmojiTab === cat.id && !emojiSearchQuery
								? 'bg-brand/20 text-brand ring-1 ring-brand/40 shadow-xs'
								: 'bg-transparent text-secondary hover:text-contrast hover:bg-surface-4'
						"
						:title="cat.title"
						@click="activeEmojiTab = cat.id; emojiSearchQuery = ''"
					>
						{{ cat.icon }}
					</button>
				</div>

				<!-- Поиск смайликов (как в Telegram) -->
				<div
					class="flex items-center gap-1.5 px-2.5 py-1 bg-surface-2 border border-solid border-surface-5/70 rounded-lg focus-within:border-brand/70 text-xs"
					style="border-color: var(--color-divider);"
				>
					<SearchIcon class="w-3.5 h-3.5 text-secondary shrink-0" />
					<input
						v-model="emojiSearchQuery"
						type="text"
						placeholder="Поиск смайликов..."
						class="bg-transparent border-0 outline-none text-xs text-contrast placeholder:text-secondary w-full"
					/>
					<button
						v-if="emojiSearchQuery"
						type="button"
						class="text-secondary hover:text-contrast bg-transparent border-0 cursor-pointer p-0 text-xs"
						@click="emojiSearchQuery = ''"
					>
						<XIcon class="w-3 h-3" />
					</button>
				</div>

				<!-- Сетка смайликов (8 колонок) -->
				<div class="grid grid-cols-8 gap-1 max-h-52 overflow-y-auto custom-scrollbars p-0.5 select-none">
					<button
						v-for="emoji in displayedEmojis"
						:key="emoji"
						type="button"
						class="w-8 h-8 rounded-lg flex items-center justify-center text-xl bg-transparent hover:bg-surface-4 border-0 cursor-pointer transition-transform hover:scale-130 active:scale-95 duration-150"
						@click="onSelectEmoji(emoji)"
					>
						{{ emoji }}
					</button>
					<div
						v-if="displayedEmojis.length === 0"
						class="col-span-8 py-6 text-center text-xs text-secondary"
					>
						Смайлики не найдены
					</div>
				</div>
			</div>

			<!-- Строка ввода: чистая, со скруглением rounded-xl и деликатным фокусом -->
			<div
				class="flex items-center gap-2 bg-surface-3 border border-solid border-surface-5/70 hover:border-surface-5 focus-within:border-brand/70 rounded-xl px-2.5 py-1.5 transition-all shadow-none"
				style="border-color: var(--color-divider);"
			>
				<!-- Кнопка смайликов -->
				<button
					type="button"
					class="p-1 rounded-lg bg-transparent border-0 text-secondary hover:text-contrast hover:bg-surface-4 cursor-pointer shrink-0 transition-colors flex items-center justify-center"
					:class="showEmojiPicker ? 'text-brand bg-brand/15' : ''"
					title="Смайлики"
					@click.stop="showEmojiPicker = !showEmojiPicker"
				>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="10" />
						<path d="M8 14s1.5 2 4 2 4-2 4-2" />
						<line x1="9" y1="9" x2="9.01" y2="9" />
						<line x1="15" y1="9" x2="15.01" y2="9" />
					</svg>
				</button>

				<input
					ref="messageInputRef"
					v-model="messageInput"
					type="text"
					placeholder="Написать сообщение..."
					class="flex-1 bg-transparent border-0 outline-none text-xs text-contrast placeholder:text-secondary/70 py-1"
					@keydown="onInputKeydown"
				/>

				<button
					type="button"
					class="w-7 h-7 rounded-lg bg-brand hover:brightness-110 text-white border-0 cursor-pointer disabled:opacity-30 disabled:pointer-events-none transition-all shrink-0 flex items-center justify-center shadow-sm"
					:disabled="!messageInput.trim()"
					title="Отправить (Enter)"
					@click="handleSend"
				>
					<SendIcon class="w-3.5 h-3.5" />
				</button>
			</div>
		</div>

		<!-- Модалка профиля друга -->
		<ModalWrapper ref="profileModal" header="Профиль игрока">
			<div class="flex flex-col gap-4 min-w-[320px]">
				<div class="flex items-center gap-3">
					<UserAvatar
						:src="state.friends.find((f) => f.username.toLowerCase() === target.id.toLowerCase())?.avatarUrl || `https://mc-heads.net/avatar/${encodeURIComponent(target.id)}/64`"
						size="48px"
						badge
						:badge-color="
							friendInfo?.status === 'in_game'
								? 'purple'
								: friendInfo?.status === 'online'
									? 'green'
									: 'gray'
						"
						:grayscale="friendInfo?.status === 'offline' || !friendInfo"
					/>
					<div class="flex flex-col">
						<span class="text-base font-extrabold text-contrast">{{ target.id }}</span>
						<span
							class="text-xs font-medium"
							:class="
								friendInfo?.status === 'in_game'
									? 'text-purple-400'
									: friendInfo?.status === 'online'
										? 'text-green-400'
										: 'text-secondary'
							"
						>
							{{
								friendInfo?.status === 'in_game'
									? 'Сейчас в игре'
									: friendInfo?.status === 'online'
										? 'В сети'
										: 'Не в сети'
							}}
						</span>
					</div>
				</div>

				<div v-if="profileLoading" class="py-4 text-center text-xs text-secondary">
					Загрузка статистики...
				</div>
				<div v-else class="grid grid-cols-2 gap-2.5 text-xs">
					<div class="p-3 rounded-xl bg-surface-3 flex flex-col gap-0.5">
						<span class="text-secondary text-[11px]">Часов в игре</span>
						<span class="text-sm font-extrabold text-contrast">
							{{ friendProfile?.totalHours ?? friendInfo?.totalHours ?? 0 }} ч
						</span>
					</div>
					<div class="p-3 rounded-xl bg-surface-3 flex flex-col gap-0.5">
						<span class="text-secondary text-[11px]">Друзей</span>
						<span class="text-sm font-extrabold text-contrast">
							{{ friendProfile?.friendsCount ?? 1 }}
						</span>
					</div>
					<div class="col-span-2 p-3 rounded-xl bg-surface-3 flex flex-col gap-0.5">
						<span class="text-secondary text-[11px]">Последняя сборка / мир</span>
						<span class="text-xs font-bold text-contrast truncate">
							{{
								friendInfo?.gameInfo?.instanceName ||
								friendProfile?.lastInstance ||
								'Не запускалась недавно'
							}}
						</span>
					</div>
					<div
						v-if="friendInfo?.gameInfo?.serverAddress || friendProfile?.lastServer"
						class="col-span-2 p-3 rounded-xl bg-surface-3 flex items-center justify-between gap-2"
					>
						<div class="flex flex-col min-w-0">
							<span class="text-secondary text-[11px]">Активный сервер</span>
							<span class="text-xs font-mono text-purple-300 truncate">
								{{ friendInfo?.gameInfo?.serverAddress || friendProfile?.lastServer }}
							</span>
						</div>
						<Button
							type="colored"
							color="purple"
							size="sm"
							@click="
								profileModal?.hide();
								handleQuickJoin({
									addr: (friendInfo?.gameInfo?.serverAddress || friendProfile?.lastServer)!,
									name: friendInfo?.gameInfo?.serverName || target.id,
									version: friendInfo?.gameInfo?.mcVersion,
								})
							"
						>
							Зайти
						</Button>
					</div>
				</div>
			</div>
		</ModalWrapper>
	</div>
</template>

<style scoped>
.image-pixelated {
	image-rendering: pixelated;
}
</style>
