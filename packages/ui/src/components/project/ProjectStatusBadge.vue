<template>
	<Badge :icon="metadata.icon" :formatted-name="metadata.formattedName" />
</template>

<script setup lang="ts">
import type { ProjectStatus } from '@modrinth/utils'
import { computed } from 'vue'

import { defineMessage, type MessageDescriptor, useVIntl } from '../../composables/i18n'
import { PROJECT_STATUS_ICONS } from '../../utils'
import Badge from '../base/SimpleBadge.vue'

const props = defineProps<{
	status: ProjectStatus
}>()

const { formatMessage } = useVIntl()

const metadata = computed(() => {
	const currentStatus = props.status && statusMetadata[props.status] ? props.status : 'approved'
	return {
		icon: PROJECT_STATUS_ICONS[currentStatus] ?? PROJECT_STATUS_ICONS.approved,
		formattedName: formatMessage(statusMetadata[currentStatus].message),
	}
})

const statusMetadata: Record<ProjectStatus, { message: MessageDescriptor }> = {
	approved: {
		message: defineMessage({
			id: 'project.visibility.public',
			defaultMessage: 'Public',
		}),
	},
	unlisted: {
		message: defineMessage({
			id: 'project.visibility.unlisted',
			defaultMessage: 'Unlisted',
		}),
	},
	withheld: {
		message: defineMessage({
			id: 'project.visibility.unlisted-by-staff',
			defaultMessage: 'Unlisted by staff',
		}),
	},
	private: {
		message: defineMessage({
			id: 'project.visibility.private',
			defaultMessage: 'Private',
		}),
	},
	scheduled: {
		message: defineMessage({
			id: 'project.visibility.scheduled',
			defaultMessage: 'Scheduled',
		}),
	},
	draft: {
		message: defineMessage({
			id: 'project.visibility.draft',
			defaultMessage: 'Draft',
		}),
	},
	archived: {
		message: defineMessage({
			id: 'project.visibility.archived',
			defaultMessage: 'Archived',
		}),
	},
	rejected: {
		message: defineMessage({
			id: 'project.visibility.rejected',
			defaultMessage: 'Rejected',
		}),
	},
	processing: {
		message: defineMessage({
			id: 'project.visibility.under-review',
			defaultMessage: 'Under review',
		}),
	},
	unknown: {
		message: defineMessage({
			id: 'project.visibility.unknown',
			defaultMessage: 'Unknown',
		}),
	},
}
</script>
