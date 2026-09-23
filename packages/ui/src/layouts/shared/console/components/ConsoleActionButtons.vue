<template>
	<div class="flex items-center gap-1">
		<Button
			v-if="showClear && hasLogs"
			v-tooltip="clearDisabled ? clearDisabledTooltip : undefined"
			type="quiet"
			:disabled="clearDisabled"
			@click="emit('clear')"
		>
			<XIcon />
			Clear
		</Button>
		<Button
			v-if="showDelete"
			v-tooltip="deleteDisabled ? deleteDisabledTooltip : undefined"
			type="quiet"
			color="red"
			:disabled="deleteDisabled"
			class="hover:!bg-red focus-visible:!bg-red hover:!text-[var(--color-accent-contrast)] focus-visible:!text-[var(--color-accent-contrast)]"
			@click="emit('delete')"
		>
			<TrashIcon />
			Delete
		</Button>
		<Button
			v-if="hasLogs"
			v-tooltip="copyDisabled ? copyDisabledTooltip : (copied ? 'Скопировано в буфер обмена' : 'Копировать логи в буфер обмена')"
			type="quiet"
			:disabled="copyDisabled"
			@click="emit('copy')"
		>
			<CheckIcon v-if="copied" class="text-green" />
			<CopyIcon v-else />
			{{ copied ? 'Скопировано' : 'Копировать' }}
		</Button>
		<Button type="quiet" @click="emit('toggle-fullscreen')">
			<ContractIcon v-if="fullscreen" />
			<ExpandIcon v-else />
			{{ fullscreen ? 'Collapse' : 'Expand' }}
		</Button>
	</div>
</template>

<script setup lang="ts">
import {
	CheckIcon,
	ContractIcon,
	CopyIcon,
	ExpandIcon,
	TrashIcon,
	XIcon,
} from '@modrinth/assets'

import { Button } from '#ui/components/base/buttons'

defineProps<{
	showClear?: boolean
	hasLogs?: boolean
	copied?: boolean
	copyDisabled?: boolean
	copyDisabledTooltip?: string
	fullscreen?: boolean
	clearDisabled?: boolean
	clearDisabledTooltip?: string
	showDelete?: boolean
	deleteDisabled?: boolean
	deleteDisabledTooltip?: string
}>()

const emit = defineEmits<{
	clear: []
	copy: []
	'toggle-fullscreen': []
	delete: []
}>()
</script>
