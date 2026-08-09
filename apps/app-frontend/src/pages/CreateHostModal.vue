<!--
	CreateHostModal.vue — ТОЛЬКО ВИЗУАЛ (без реального API)

	Построен на базовом NewModal (packages/ui/src/components/modal/NewModal.vue) —
	том же компоненте, на котором держится большинство модалок в лаунчере
	(ConfirmModal, ShareModal и т.д.), поэтому анимации/оверлей/эскейп совпадут
	с остальным приложением "из коробки".

	Что нужно будет доделать при интеграции:
	- handleAutoPort — сейчас просто подставляет случайный свободный на вид порт,
	  реальное сканирование портов должно идти через Rust-команду
	- handleStartHosting — сейчас просто закрывает модалку через setTimeout
-->
<script setup lang="ts">
import { CheckIcon, GlobeIcon, PlugIcon, RefreshCwIcon } from '@modrinth/assets'
import { ButtonStyled, NewModal, StyledInput } from '@modrinth/ui'
import { computed, ref } from 'vue'

type Edition = 'java' | 'bedrock'

const modal = ref<InstanceType<typeof NewModal> | null>(null)

const edition = ref<Edition>('java')
const worldName = ref('')
const port = ref<string>('25565')
const isFindingPort = ref(false)
const isStarting = ref(false)
const started = ref(false)

const portPlaceholder = computed(() => (edition.value === 'java' ? '25565' : '19132'))

function selectEdition(next: Edition) {
	edition.value = next
	// у Java и Bedrock разные дефолтные порты — подставляем плейсхолдер сами,
	// но не трогаем то, что пользователь уже ввёл руками
	if (!port.value || port.value === '25565' || port.value === '19132') {
		port.value = next === 'java' ? '25565' : '19132'
	}
}

function handleAutoPort() {
	isFindingPort.value = true
	setTimeout(() => {
		// визуальная заглушка — реальный подбор порта делает Rust-бэкенд
		port.value = String(40000 + Math.floor(Math.random() * 20000))
		isFindingPort.value = false
	}, 600)
}

function handleStartHosting() {
	isStarting.value = true
	setTimeout(() => {
		isStarting.value = false
		started.value = true
		setTimeout(() => {
			started.value = false
			modal.value?.hide()
		}, 900)
	}, 900)
}

function show() {
	edition.value = 'java'
	worldName.value = ''
	port.value = '25565'
	started.value = false
	modal.value?.show()
}

function hide() {
	modal.value?.hide()
}

defineExpose({ show, hide })
</script>

<template>
	<NewModal ref="modal" header="Создать хост" width="32rem" actions-divider>
		<div class="flex flex-col gap-5">
				<!-- Выбор редакции -->
				<div class="flex flex-col gap-2">
					<label class="text-sm font-semibold text-contrast">Редакция игры</label>
					<div class="grid grid-cols-2 gap-2">
						<button
							type="button"
							class="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold border-2 border-solid cursor-pointer transition-colors"
							:class="
								edition === 'java'
									? 'border-brand bg-brand-highlight text-contrast'
									: 'border-surface-4 bg-bg-raised text-secondary hover:border-surface-5'
							"
							@click="selectEdition('java')"
						>
							Java Edition
						</button>
						<button
							type="button"
							class="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold border-2 border-solid cursor-pointer transition-colors"
							:class="
								edition === 'bedrock'
									? 'border-blue bg-blue-highlight text-contrast'
									: 'border-surface-4 bg-bg-raised text-secondary hover:border-surface-5'
							"
							@click="selectEdition('bedrock')"
						>
							Bedrock Edition
						</button>
					</div>
					<p class="m-0 text-xs text-secondary">
						Определяет, как будут маршрутизироваться пакеты внутри релея.
					</p>
				</div>

				<!-- Название / MOTD -->
				<div class="flex flex-col gap-2">
					<label class="text-sm font-semibold text-contrast" for="world-motd">
						Название мира / MOTD
					</label>
					<StyledInput
						id="world-motd"
						v-model="worldName"
						:icon="GlobeIcon"
						placeholder="Например: Заброшенный Континент"
						:maxlength="64"
					/>
					<p class="m-0 text-xs text-secondary">
						Это увидят другие игроки в общем списке серверов.
					</p>
				</div>

				<!-- Порт -->
				<div class="flex flex-col gap-2">
					<label class="text-sm font-semibold text-contrast" for="host-port">
						Локальный порт
					</label>
					<div class="flex gap-2">
						<StyledInput
							id="host-port"
							v-model="port"
							:placeholder="portPlaceholder"
							wrapper-class="flex-1"
							inputmode="numeric"
						/>
						<ButtonStyled>
							<button type="button" :disabled="isFindingPort" @click="handleAutoPort">
								<RefreshCwIcon aria-hidden="true" :class="{ 'animate-spin': isFindingPort }" />
								Автопорт
							</button>
						</ButtonStyled>
					</div>
					<p class="m-0 text-xs text-secondary">
						Порт, на котором у вас уже открыт локальный мир Minecraft.
					</p>
				</div>
			</div>

		<template #actions>
			<div class="flex items-center justify-end gap-2">
				<ButtonStyled type="transparent">
					<button type="button" @click="hide">Отмена</button>
				</ButtonStyled>
				<ButtonStyled color="brand" size="large">
					<button
						type="button"
						:disabled="!worldName || !port || isStarting || started"
						@click="handleStartHosting"
					>
						<CheckIcon v-if="started" aria-hidden="true" />
						<PlugIcon v-else aria-hidden="true" :class="{ 'animate-pulse': isStarting }" />
						{{ started ? 'Хостинг запущен' : isStarting ? 'Запускаем…' : 'Начать хостинг' }}
					</button>
				</ButtonStyled>
			</div>
		</template>
	</NewModal>
</template>
