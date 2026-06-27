<script setup>
import { ref, computed } from 'vue'

const ctx = {
  showSnapshots: ref(false)
}

const list = computed(() => {
  return ctx.showSnapshots.value ? ['A', 'B'] : ['A']
})
</script>

<template>
  <div>
    <div id="out">{{ list }}</div>
    <button id="btn" @click="ctx.showSnapshots.value = !ctx.showSnapshots.value">Toggle</button>
  </div>
</template>
