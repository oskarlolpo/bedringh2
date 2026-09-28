<script lang="ts">
export { SERVER_CATEGORIES, type Edition, type ServerCategory } from '@/services/bedringh-server-categories'
</script>

<script setup lang="ts">
import { CheckIcon, GlobeIcon, PlugIcon, RefreshCwIcon, ServerIcon, UserIcon } from '@modrinth/assets'
import { ButtonStyled, defineMessages, NewModal, StyledInput, useVIntl } from '@modrinth/ui'
import { computed, ref } from 'vue'

import { detectAllActiveLanGames, type DetectedLanGame } from '@/services/bedringh-lan-detect'
import { getActiveBedringhUser } from '@/services/bedringh-settings-sync'
import { SERVER_CATEGORIES, type Edition } from '@/services/bedringh-server-categories'

const { formatMessage } = useVIntl()
const messages = defineMessages({
	title: { id: 'servers.create.title', defaultMessage: 'Создать хост' },
	gameEdition: { id: 'servers.create.core_label', defaultMessage: 'Редакция Minecraft' },
	worldName: { id: 'servers.create.name_label', defaultMessage: 'Название сервера / мира' },
	worldNamePlaceholder: { id: 'servers.create.name_placeholder', defaultMessage: 'Например: Выживание с друзьями' },
	port: { id: 'servers.create.port_label', defaultMessage: 'Локальный порт мира' },
	cancel: { id: 'servers.create.cancel_btn', defaultMessage: 'Отмена' },
	startHost: { id: 'server.view.action.start', defaultMessage: 'Запустить хост' },
	hostStarted: { id: 'server.view.metric.running', defaultMessage: 'Хост запущен' },
})

const modal = ref<InstanceType<typeof NewModal> | null>(null)

const edition = ref<Edition>('java')
const worldName = ref('')
const port = ref<string>('25565')
const selectedCategories = ref<string[]>(['survival'])
const isAutoDetecting = ref(false)
const detectedGames = ref<DetectedLanGame[]>([])
const selectedWorldId = ref<string | null>(null)
const isStarting = ref(false)
const started = ref(false)

const openWorlds = computed(() => detectedGames.value.filter((g) => g.found && g.port))
const runningWithoutPort = computed(() => detectedGames.value.filter((g) => !g.found && g.instanceName))

const activeUser = computed(() => getActiveBedringhUser()?.username || 'Вы')
const portPlaceholder = computed(() => (edition.value === 'java' ? '25565' : '19132'))

function selectEdition(next: Edition) {
	edition.value = next
	if (!port.value || port.value === '25565' || port.value === '19132') {
		port.value = next === 'java' ? '25565' : '19132'
	}
}

function toggleCategory(catId: string) {
	if (selectedCategories.value.includes(catId)) {
		if (selectedCategories.value.length > 1) {
			selectedCategories.value = selectedCategories.value.filter((id) => id !== catId)
		}
	} else {
		selectedCategories.value.push(catId)
	}
}

function selectDetectedWorld(world: DetectedLanGame) {
	selectedWorldId.value = world.id || world.port
	port.value = world.port
	worldName.value = world.worldName
	edition.value = world.edition
}

async function handleAutoDetect() {
	isAutoDetecting.value = true
	try {
		const all = await detectAllActiveLanGames()
		detectedGames.value = all

		const open = all.filter((g) => g.found && g.port)
		if (open.length > 0) {
			// Если ранее выбранный мир всё ещё открыт — оставляем его, иначе выбираем первый
			const current = open.find((w) => (w.id || w.port) === selectedWorldId.value) || open[0]
			if (current) {
				selectDetectedWorld(current)
			}
		} else {
			selectedWorldId.value = null
			const running = all.find((g) => g.instanceName)
			if (running) {
				edition.value = running.edition
				if (!worldName.value && running.worldName) {
					worldName.value = running.worldName
				}
			}
		}
	} finally {
		isAutoDetecting.value = false
	}
}

const emit = defineEmits<{
	(
		e: 'create',
		hostData: {
			name: string
			edition: Edition
			port: string
			categories: string[]
			host: string
		},
	): void
}>()

function handleStartHosting() {
	isStarting.value = true
	setTimeout(() => {
		isStarting.value = false
		started.value = true
		emit('create', {
			name: worldName.value,
			edition: edition.value,
			port: port.value,
			categories: selectedCategories.value,
			host: activeUser.value,
		})
		setTimeout(() => {
			started.value = false
			modal.value?.hide()
		}, 500)
	}, 500)
}

function show() {
	edition.value = 'java'
	worldName.value = ''
	port.value = ''
	selectedCategories.value = ['survival']
	started.value = false
	detectedGames.value = []
	selectedWorldId.value = null
	modal.value?.show()
	// При открытии окна сразу пытаемся автоопределить открытые миры
	void handleAutoDetect()
}

function hide() {
	modal.value?.hide()
}

defineExpose({ show, hide })
</script>

<template>
	<NewModal ref="modal" :header="formatMessage(messages.title)" width="34rem" actions-divider>
		<div class="flex flex-col gap-4">
			<!-- Блок обнаружения открытых локальных миров (поддержка выбора из 2-4+ миров) -->
			<div class="flex flex-col gap-2.5 p-3 rounded-2xl bg-surface-2 border border-solid border-surface-4">
				<div class="flex items-center justify-between gap-2">
					<div class="flex items-center gap-2">
						<span
							class="size-2 rounded-full shrink-0"
							:class="openWorlds.length > 0 ? 'bg-green animate-pulse' : 'bg-surface-5'"
						/>
						<span class="text-xs font-bold text-contrast">
							{{
								openWorlds.length > 1
									? `Открытые миры (${openWorlds.length}) — выберите для хоста`
									: openWorlds.length === 1
										? 'Обнаружен открытый локальный мир'
										: 'Локальный мир в игре'
							}}
						</span>
					</div>
					<button
						type="button"
						:disabled="isAutoDetecting"
						class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-3 hover:bg-surface-4 border border-solid border-surface-4 text-xs font-semibold text-contrast cursor-pointer transition-colors"
						@click="handleAutoDetect"
					>
						<RefreshCwIcon class="size-3.5 text-brand" :class="{ 'animate-spin': isAutoDetecting }" />
						<span>Обновить</span>
					</button>
				</div>

				<!-- Карточки найденных открытых миров (1 или несколько) -->
				<div v-if="openWorlds.length > 0" class="flex flex-col gap-1.5 max-h-44 overflow-y-auto">
					<button
						v-for="world in openWorlds"
						:key="world.id || world.port"
						type="button"
						class="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-solid text-left cursor-pointer transition-all"
						:class="
							(world.id || world.port) === selectedWorldId || port === world.port
								? 'bg-brand/10 border-brand'
								: 'bg-surface-3/60 border-surface-4 hover:border-surface-5'
						"
						@click="selectDetectedWorld(world)"
					>
						<div class="flex items-center gap-2.5 min-w-0">
							<div
								class="size-8 rounded-lg flex items-center justify-center shrink-0"
								:class="
									(world.id || world.port) === selectedWorldId || port === world.port
										? 'bg-brand text-brand-inverted'
										: 'bg-surface-4 text-secondary'
								"
							>
								<CheckIcon
									v-if="(world.id || world.port) === selectedWorldId || port === world.port"
									class="size-4"
								/>
								<ServerIcon v-else class="size-4" />
							</div>
							<div class="flex flex-col min-w-0">
								<div class="flex items-center gap-1.5">
									<span class="text-sm font-bold text-contrast truncate">{{ world.worldName }}</span>
									<span class="px-1.5 py-0.5 rounded-md bg-surface-4 text-[10px] font-bold text-secondary shrink-0">
										{{ world.version }}
									</span>
								</div>
								<span v-if="world.instanceName" class="text-[11px] text-secondary truncate">
									Сборка: {{ world.instanceName }}
								</span>
							</div>
						</div>

						<div
							class="px-2.5 py-1 rounded-lg font-mono text-xs font-bold shrink-0"
							:class="
								(world.id || world.port) === selectedWorldId || port === world.port
									? 'bg-brand/20 text-brand'
									: 'bg-surface-4 text-contrast'
							"
						>
							:{{ world.port }}
						</div>
					</button>
				</div>

				<!-- Игра запущена, но мир ещё не открыт для сети (или игрок вышел из мира) -->
				<div
					v-else-if="runningWithoutPort.length > 0"
					class="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-surface-3/60 border border-solid border-surface-4 text-xs text-secondary"
				>
					<GlobeIcon class="size-4 text-brand shrink-0" />
					<span>
						Запущена сборка <strong class="text-contrast">{{ runningWithoutPort[0].instanceName }}</strong>, но открытый мир не найден. В игре нажмите <strong>ESC → Открыть для сети</strong> и нажмите «Обновить».
					</span>
				</div>

				<!-- Игра вообще не запущена -->
				<div
					v-else
					class="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-surface-3/60 border border-solid border-surface-4 text-xs text-secondary"
				>
					<GlobeIcon class="size-4 text-secondary shrink-0" />
					<span>
						Запущенных локальных миров сейчас нет. Зайдите в мир Minecraft, откройте его для сети и нажмите «Обновить».
					</span>
				</div>
			</div>

			<!-- Создатель и Редакция в один ряд -->
			<div class="grid grid-cols-2 gap-3">
				<!-- Создатель -->
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-semibold text-secondary">Создатель хоста</label>
					<div class="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-3 border border-solid border-surface-4 text-sm font-bold text-contrast">
						<UserIcon class="size-4 text-brand shrink-0" />
						<span class="truncate">{{ activeUser }}</span>
					</div>
				</div>

				<!-- Выбор редакции -->
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-semibold text-secondary">{{ formatMessage(messages.gameEdition) }}</label>
					<div class="grid grid-cols-2 gap-1.5">
						<button
							type="button"
							class="py-2 rounded-xl text-xs font-bold border border-solid cursor-pointer transition-colors"
							:class="
								edition === 'java'
									? 'border-brand bg-brand-highlight text-brand'
									: 'border-surface-4 bg-bg-raised text-secondary hover:border-surface-5'
							"
							@click="selectEdition('java')"
						>
							Java
						</button>
						<button
							type="button"
							class="py-2 rounded-xl text-xs font-bold border border-solid cursor-pointer transition-colors"
							:class="
								edition === 'bedrock'
									? 'border-brand bg-brand-highlight text-brand'
									: 'border-surface-4 bg-bg-raised text-secondary hover:border-surface-5'
							"
							@click="selectEdition('bedrock')"
						>
							Bedrock
						</button>
					</div>
				</div>
			</div>

			<!-- Название мира / сервера -->
			<div class="flex flex-col gap-1.5">
				<div class="flex items-center justify-between">
					<label class="text-xs font-semibold text-contrast" for="world-motd">
						{{ formatMessage(messages.worldName) }}
					</label>
					<span class="text-[11px] text-secondary">Поддерживает коды цветов (&a, §a)</span>
				</div>
				<StyledInput
					id="world-motd"
					v-model="worldName"
					:icon="GlobeIcon"
					:placeholder="formatMessage(messages.worldNamePlaceholder)"
					:maxlength="64"
				/>
			</div>

			<!-- Порт с кнопкой Auto -->
			<div class="flex flex-col gap-1.5">
				<label class="text-xs font-semibold text-contrast" for="host-port">
					{{ formatMessage(messages.port) }}
				</label>
				<div class="flex gap-2">
					<StyledInput
						id="host-port"
						v-model="port"
						:placeholder="portPlaceholder"
						wrapper-class="flex-1"
						inputmode="numeric"
					/>
					<ButtonStyled color="brand">
						<button type="button" :disabled="isAutoDetecting" @click="handleAutoDetect">
							<RefreshCwIcon aria-hidden="true" :class="{ 'animate-spin': isAutoDetecting }" class="size-4" />
							<span>Auto</span>
						</button>
					</ButtonStyled>
				</div>
			</div>

			<!-- Категории сервера (вместо описания) -->
			<div class="flex flex-col gap-2 pt-1">
				<div class="flex items-center justify-between">
					<label class="text-xs font-semibold text-contrast">Категории сервера</label>
					<span class="text-[11px] text-secondary">Можно выбрать несколько</span>
				</div>
				<div class="flex flex-wrap gap-1.5">
					<button
						v-for="cat in SERVER_CATEGORIES"
						:key="cat.id"
						type="button"
						class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-solid text-xs font-medium cursor-pointer transition-all active:scale-[0.97]"
						:class="
							selectedCategories.includes(cat.id)
								? 'border-brand bg-brand-highlight text-brand font-bold'
								: 'border-surface-4 bg-surface-2 text-secondary hover:border-surface-5 hover:text-contrast'
						"
						@click="toggleCategory(cat.id)"
					>
						<component :is="cat.icon" class="size-3.5 shrink-0" />
						<span>{{ cat.name }}</span>
					</button>
				</div>
			</div>
		</div>

		<template #actions>
			<div class="flex items-center justify-end gap-2">
				<ButtonStyled type="transparent">
					<button type="button" @click="hide">{{ formatMessage(messages.cancel) }}</button>
				</ButtonStyled>
				<ButtonStyled color="brand" size="large">
					<button
						type="button"
						:disabled="!worldName || !port || isStarting || started"
						@click="handleStartHosting"
					>
						<CheckIcon v-if="started" aria-hidden="true" />
						<PlugIcon v-else aria-hidden="true" :class="{ 'animate-pulse': isStarting }" />
						{{ started ? formatMessage(messages.hostStarted) : formatMessage(messages.startHost) }}
					</button>
				</ButtonStyled>
			</div>
		</template>
	</NewModal>
</template>
