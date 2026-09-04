<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const emit = defineEmits<{
	(e: 'select'): void
}>()

const props = withDefaults(
	defineProps<{
		name: string | undefined
		id: string
		texture: string
		animatedUrl?: string
		animatedTexture?: string
		frameDurationMs?: number
		isEquipped?: boolean
		selected?: boolean
		faded?: boolean
	}>(),
	{
		animatedUrl: undefined,
		animatedTexture: undefined,
		frameDurationMs: undefined,
		isEquipped: false,
		selected: undefined,
		faded: false,
	},
)

const effectiveTexture = computed(
	() => props.animatedUrl || props.animatedTexture || props.texture,
)
const highlighted = computed(() => props.selected ?? props.isEquipped)

type CapeButtonLayoutType = 'standard-2-1' | 'optifine-46-22' | 'square-1-1' | 'flat-preview'

const layoutType = ref<CapeButtonLayoutType>('standard-2-1')
const frameCount = ref(1)
const currentFrame = ref(0)
let animationTimer: ReturnType<typeof setInterval> | null = null

function stopAnimation() {
	if (animationTimer !== null) {
		clearInterval(animationTimer)
		animationTimer = null
	}
}

function startAnimation() {
	stopAnimation()
	if (frameCount.value <= 1) return

	const duration = props.frameDurationMs || 100
	animationTimer = setInterval(() => {
		currentFrame.value = (currentFrame.value + 1) % frameCount.value
	}, duration)
}

function detectCapeLayout(
	width: number,
	height: number,
): {
	layout: CapeButtonLayoutType
	frameCount: number
} {
	if (!width || !height) return { layout: 'standard-2-1', frameCount: 1 }

	// 1. Check if it's already a flat preview (e.g. 200x320, 10:16 aspect ratio, or height > width and not a multiple of width/2)
	const ratio = width / height
	if (
		Math.abs(ratio - 10 / 16) < 0.05 ||
		(ratio < 0.8 &&
			height % Math.round(width / 2) !== 0 &&
			height % Math.round((width * 22) / 46) !== 0)
	) {
		return { layout: 'flat-preview', frameCount: 1 }
	}

	// 2. Single square 1:1 cape (e.g. 64x64 or 512x512)
	if (width === height) {
		return { layout: 'square-1-1', frameCount: 1 }
	}

	// 3. Optifine 46:22 format (e.g. 46x22, 92x44, 736x352 or animated vertical strip)
	for (let count = 1; count <= 240; count++) {
		const rawFrameH = height / count
		if (Math.abs(width / rawFrameH - 46 / 22) < 0.05) {
			return { layout: 'optifine-46-22', frameCount: count }
		}
	}

	// 4. Standard 2:1 Minecraft cape format (e.g. 64x32, 1024x512 or N frames of 2:1)
	const frameHeight = Math.round(width / 2)
	if (frameHeight > 0 && height >= frameHeight) {
		const count = Math.round(height / frameHeight)
		if (count >= 1 && Math.abs(height - count * frameHeight) <= count * 2) {
			return { layout: 'standard-2-1', frameCount: count }
		}
	}

	return { layout: 'standard-2-1', frameCount: 1 }
}

const preferredRegion = ref<'left' | 'right'>('left')

function analyzeArtworkRegion(img: HTMLImageElement): 'left' | 'right' {
	try {
		const canvas = document.createElement('canvas')
		const w = img.naturalWidth || img.width
		const h = img.naturalHeight || img.height
		if (!w || !h) return 'left'

		const scale = w / 64
		const r1X = Math.round(1 * scale)
		const r2X = Math.round(12 * scale)
		const rY = Math.round(1 * scale)
		const rW = Math.round(10 * scale)
		const rH = Math.round(16 * scale)

		canvas.width = Math.max(r2X + rW, w)
		canvas.height = Math.max(rY + rH, Math.round(w / 2))
		const ctx = canvas.getContext('2d', { willReadFrequently: true })
		if (!ctx) return 'left'

		ctx.drawImage(img, 0, 0)
		const p1 = ctx.getImageData(r1X, rY, rW, rH).data
		const p2 = ctx.getImageData(r2X, rY, rW, rH).data
		const sampleStep = Math.max(1, Math.floor(p1.length / 500))

		const c1 = new Set<number>()
		const c2 = new Set<number>()

		for (let i = 0; i < p1.length; i += 4 * sampleStep) {
			if (p1[i + 3] > 20) {
				c1.add(((p1[i] >> 3) << 10) | ((p1[i + 1] >> 3) << 5) | (p1[i + 2] >> 3))
			}
			if (p2[i + 3] > 20) {
				c2.add(((p2[i] >> 3) << 10) | ((p2[i + 1] >> 3) << 5) | (p2[i + 2] >> 3))
			}
		}

		// В стандартном формате Minecraft плащей (в т.ч. лицензионных Mojang)
		// лицевая сторона (рисунок) находится в Region 1 (left).
		// Переключаемся на Region 2 (right) только если в Region 2 явно больше деталей,
		// что бывает на некоторых кастомных пиратских скинах.
		if (c2.size > c1.size + 2 && c2.size > 5) return 'right'
		return 'left'
	} catch {
		return 'left'
	}
}

function updateImageDimensions(url: string | undefined) {
	if (!url) {
		layoutType.value = 'standard-2-1'
		frameCount.value = 1
		preferredRegion.value = 'left'
		stopAnimation()
		return
	}

	const img = new Image()
	img.onload = () => {
		if (effectiveTexture.value !== url) return
		const detected = detectCapeLayout(img.naturalWidth, img.naturalHeight)
		layoutType.value = detected.layout
		frameCount.value = detected.frameCount
		preferredRegion.value = analyzeArtworkRegion(img)
		if (detected.frameCount > 1) {
			startAnimation()
		} else {
			stopAnimation()
		}
	}

	img.src = url
	if (img.complete && img.naturalWidth) {
		img.onload(new Event('load'))
	}
}

function onImageLoad(event: Event) {
	const img = event.target as HTMLImageElement
	if (!img || !img.naturalWidth || !img.naturalHeight) return

	const detected = detectCapeLayout(img.naturalWidth, img.naturalHeight)
	layoutType.value = detected.layout
	frameCount.value = detected.frameCount
	preferredRegion.value = analyzeArtworkRegion(img)
	if (detected.frameCount > 1) {
		startAnimation()
	} else {
		stopAnimation()
	}
}

watch(
	effectiveTexture,
	(newUrl) => {
		currentFrame.value = 0
		frameCount.value = 1
		layoutType.value = 'standard-2-1'
		preferredRegion.value = 'left'
		stopAnimation()
		if (newUrl) {
			updateImageDimensions(newUrl)
		}
	},
	{ immediate: true },
)

watch(
	() => props.frameDurationMs,
	() => {
		if (frameCount.value > 1) {
			startAnimation()
		}
	},
)

onMounted(() => {
	if (effectiveTexture.value) {
		updateImageDimensions(effectiveTexture.value)
	}
})

onUnmounted(() => {
	stopAnimation()
})

const imgStyle = computed(() => {
	const count = frameCount.value
	const frame = currentFrame.value
	const leftOffset = preferredRegion.value === 'left' ? '-10%' : '-120%'

	if (layoutType.value === 'flat-preview') {
		return {
			width: '100%',
			height: '100%',
			left: '0',
			top: '0',
			maxWidth: '100%',
			maxHeight: '100%',
			objectFit: 'cover',
		}
	}

	if (layoutType.value === 'optifine-46-22') {
		const topPercent = -(frame * (22 / 16) + 1 / 16) * 100
		const heightPercent = (22 / 16) * count * 100

		return {
			width: '460%',
			height: `${heightPercent}%`,
			left: leftOffset,
			top: `${topPercent}%`,
			maxWidth: 'none',
			maxHeight: 'none',
		}
	}

	if (layoutType.value === 'square-1-1') {
		return {
			width: '640%',
			height: '400%',
			left: leftOffset,
			top: '-6.25%',
			maxWidth: 'none',
			maxHeight: 'none',
		}
	}

	// Standard 2:1 Minecraft cape format (single frame or vertical sprite sheet)
	const topPercent = -(frame * 2 + 1 / 16) * 100
	const heightPercent = 200 * count

	return {
		width: '640%',
		height: `${heightPercent}%`,
		left: leftOffset,
		top: `${topPercent}%`,
		maxWidth: 'none',
		maxHeight: 'none',
	}
})
</script>

<template>
	<button
		v-tooltip="name"
		class="block border-0 m-0 p-0 bg-transparent group cursor-pointer"
		:aria-label="name"
		@click="emit('select')"
	>
		<span
			:class="
				highlighted
					? `bg-brand highlighted-outer-glow`
					: `bg-button-bg brightness-95 group-hover:brightness-100`
			"
			class="relative block p-[3px] rounded-lg border-0 group-active:scale-95 transition-all"
		>
			<span
				class="block magical-cape-transform rounded-[5px]"
				:class="{
					'highlighted-inner-shadow': highlighted,
					'brightness-[0.3] contrast-[0.8]': faded,
				}"
			>
				<img
					:src="effectiveTexture"
					:style="imgStyle"
					alt=""
					class="pointer-events-none select-none"
					@load="onImageLoad"
				/>
			</span>
			<span
				v-if="$slots.default || $slots.icon"
				class="p-4 absolute inset-0 flex items-center justify-center text-primary font-medium"
			>
				<span class="mb-1">
					<slot name="icon"></slot>
				</span>
				<span class="text-xs">
					<slot></slot>
				</span>
			</span>
		</span>
	</button>
</template>

<style lang="scss" scoped>
.magical-cape-transform {
	aspect-ratio: 10 / 16;
	position: relative;
	overflow: hidden;
	box-sizing: content-box;
	width: 60px;
	min-height: 96px;
}

.magical-cape-transform img {
	position: absolute;
	object-fit: fill;
	image-rendering: pixelated;
}

.highlighted-inner-shadow::before {
	content: '';
	position: absolute;
	inset: 0;
	box-shadow: inset 0 0 4px 4px rgba(0, 0, 0, 0.4);
	z-index: 2;
}

@supports (background-color: color-mix(in srgb, transparent, transparent)) {
	.highlighted-glow::before {
		box-shadow: inset 0 0 2px 4px color-mix(in srgb, var(--color-brand), transparent 10%);
	}
}
</style>
