<script setup lang="ts">
import { ServerStackIcon } from '@modrinth/assets'

import { useRootBreadcrumb } from '@/providers/breadcrumbs'

import ServersBrowse from './ServersBrowse.vue'

useRootBreadcrumb({
	slot: 'root',
	id: 'servers',
	label: 'Servers',
	to: '/hosting/manage/',
	visual: { type: 'icon', component: ServerStackIcon },
})
</script>

<template>
	<ServersBrowse />
</template>
