<script setup lang="ts">
import { HomeIcon } from '@modrinth/assets'
import { injectNotificationManager } from '@modrinth/ui'
import dayjs from 'dayjs'
import { computed, onUnmounted, ref } from 'vue'

import RowDisplay from '@/components/RowDisplay.vue'
import RecentWorldsList from '@/components/ui/world/RecentWorldsList.vue'
import { instance_listener } from '@/helpers/events'
import { list } from '@/helpers/instance'
import type { GameInstance } from '@/helpers/types'
import { useRootBreadcrumb } from '@/providers/breadcrumbs'

const { handleError } = injectNotificationManager()

useRootBreadcrumb({
	slot: 'root',
	id: 'home',
	label: 'Home',
	to: '/',
	visual: { type: 'icon', component: HomeIcon },
})

const instances = ref<GameInstance[]>([])

const recentInstances = computed(() =>
	instances.value
		.filter((x) => x.last_played)
		.slice()
		.sort((a, b) => dayjs(b.last_played).diff(dayjs(a.last_played))),
)

async function fetchInstances() {
	instances.value = (await list().catch(handleError)) || []
}

await fetchInstances()

const unlistenInstance = await instance_listener(async () => {
	await fetchInstances()
})

onUnmounted(() => {
	unlistenInstance()
})
</script>

<template>
	<div class="p-6 flex flex-col gap-4">
		<h1 v-if="recentInstances?.length > 0" class="m-0 text-2xl font-extrabold">Welcome back!</h1>
		<h1 v-else class="m-0 text-2xl font-extrabold">Welcome to Bedringh!</h1>
		<RecentWorldsList :recent-instances="recentInstances" />
		<RowDisplay
			v-if="instances.length > 0"
			:instances="[
				{
					label: 'Ваши сборки',
					route: '/library',
					instances: instances,
					instance: true,
				},
			]"
			:can-paginate="true"
		/>
	</div>
</template>
