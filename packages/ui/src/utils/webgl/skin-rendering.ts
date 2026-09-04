import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export interface SkinRendererConfig {
	textureColorSpace?: THREE.ColorSpace
	textureFlipY?: boolean
	textureMagFilter?: THREE.MagnificationTextureFilter
	textureMinFilter?: THREE.MinificationTextureFilter
}

const modelCache: Map<string, GLTF> = new Map()
const modelPromiseCache: Map<string, Promise<GLTF>> = new Map()
const textureCache: Map<string, THREE.Texture> = new Map()
const texturePromiseCache: Map<string, Promise<THREE.Texture>> = new Map()

export async function loadModel(modelUrl: string): Promise<GLTF> {
	if (modelCache.has(modelUrl)) {
		return modelCache.get(modelUrl)!
	}

	if (modelPromiseCache.has(modelUrl)) {
		return modelPromiseCache.get(modelUrl)!
	}

	const loader = new GLTFLoader()
	const promise = new Promise<GLTF>((resolve, reject) => {
		loader.load(
			modelUrl,
			(gltf) => {
				modelCache.set(modelUrl, gltf)
				resolve(gltf)
			},
			undefined,
			reject,
		)
	}).finally(() => {
		modelPromiseCache.delete(modelUrl)
	})

	modelPromiseCache.set(modelUrl, promise)
	return promise
}

export async function loadTexture(
	textureUrl: string,
	config: SkinRendererConfig = {},
): Promise<THREE.Texture> {
	const cacheKey = `${textureUrl}_${JSON.stringify(config)}`

	if (textureCache.has(cacheKey)) {
		return textureCache.get(cacheKey)!
	}

	if (texturePromiseCache.has(cacheKey)) {
		return texturePromiseCache.get(cacheKey)!
	}

	const textureLoader = new THREE.TextureLoader()
	const promise = new Promise<THREE.Texture>((resolve, reject) => {
		textureLoader.load(
			textureUrl,
			(texture) => {
				texture.colorSpace = config.textureColorSpace ?? THREE.SRGBColorSpace
				texture.flipY = config.textureFlipY ?? false
				texture.magFilter = config.textureMagFilter ?? THREE.NearestFilter
				texture.minFilter = config.textureMinFilter ?? THREE.NearestFilter

				textureCache.set(cacheKey, texture)
				resolve(texture)
			},
			undefined,
			reject,
		)
	}).finally(() => {
		texturePromiseCache.delete(cacheKey)
	})

	texturePromiseCache.set(cacheKey, promise)
	return promise
}

function applyMap(mat: THREE.MeshStandardMaterial, texture: THREE.Texture | null): boolean {
	const hadMap = mat.map !== null
	const hasMap = texture !== null
	const mapChanged = mat.map !== texture

	if (mapChanged) {
		mat.map = texture
	}

	return hadMap !== hasMap || mapChanged
}

function setShaderMaterialProperties(
	mat: THREE.MeshStandardMaterial,
	properties: {
		alphaTest: number
		flatShading: boolean
		side: THREE.Side
		toneMapped: boolean
		transparent?: boolean
	},
): boolean {
	let needsUpdate = false

	if (mat.alphaTest !== properties.alphaTest) {
		mat.alphaTest = properties.alphaTest
		needsUpdate = true
	}

	if (mat.flatShading !== properties.flatShading) {
		mat.flatShading = properties.flatShading
		needsUpdate = true
	}

	if (mat.side !== properties.side) {
		mat.side = properties.side
		needsUpdate = true
	}

	if (mat.toneMapped !== properties.toneMapped) {
		mat.toneMapped = properties.toneMapped
		needsUpdate = true
	}

	if (properties.transparent !== undefined && mat.transparent !== properties.transparent) {
		mat.transparent = properties.transparent
		needsUpdate = true
	}

	return needsUpdate
}

function setCommonMaterialProperties(mat: THREE.MeshStandardMaterial): void {
	if (mat.metalness !== 0) {
		mat.metalness = 0
	}

	if (mat.color.getHex() !== 0xffffff) {
		mat.color.set(0xffffff)
	}

	if (mat.roughness !== 1) {
		mat.roughness = 1
	}

	if (!mat.depthTest) {
		mat.depthTest = true
	}

	if (!mat.depthWrite) {
		mat.depthWrite = true
	}
}

export function applyTexture(model: THREE.Object3D, texture: THREE.Texture): void {
	configureFrameStrip(texture, SKIN_FRAME_ASPECT)

	model.traverse((child) => {
		if ((child as THREE.Mesh).isMesh) {
			const mesh = child as THREE.Mesh
			const isSkinLayer = mesh.name.endsWith('_Layer')
			const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

			materials.forEach((mat: THREE.Material) => {
				if (mat instanceof THREE.MeshStandardMaterial) {
					if (mat.name !== 'cape') {
						const mapNeedsUpdate = applyMap(mat, texture)
						const propertiesNeedUpdate = setShaderMaterialProperties(mat, {
							alphaTest: 0.1,
							flatShading: true,
							side: THREE.FrontSide,
							toneMapped: false,
							transparent: isSkinLayer,
						})

						setCommonMaterialProperties(mat)

						if (mapNeedsUpdate || propertiesNeedUpdate) {
							mat.needsUpdate = true
						}
					}
				}
			})
		}
	})
}

export function applyCapeTexture(
	model: THREE.Object3D,
	texture: THREE.Texture | null,
	transparentTexture?: THREE.Texture,
	frameDurationMs?: number,
): void {
	if (texture) {
		configureFrameStrip(texture, CAPE_FRAME_ASPECT_CANDIDATES, frameDurationMs)
	}

	model.traverse((child) => {
		if ((child as THREE.Mesh).isMesh) {
			const mesh = child as THREE.Mesh
			const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

			materials.forEach((mat: THREE.Material) => {
				if (mat instanceof THREE.MeshStandardMaterial) {
					if (mat.name === 'cape') {
						const nextMap = texture || transparentTexture || null
						const mapNeedsUpdate = applyMap(mat, nextMap)
						const propertiesNeedUpdate = setShaderMaterialProperties(mat, {
							alphaTest: 0.1,
							flatShading: true,
							side: THREE.DoubleSide,
							toneMapped: false,
							transparent: !texture || !!transparentTexture,
						})

						setCommonMaterialProperties(mat)

						if (mapNeedsUpdate || propertiesNeedUpdate) {
							mat.needsUpdate = true
						}

						mat.visible = !!texture
					}
				}
			})
		}
	})
}

export function findBodyNode(model: THREE.Object3D): THREE.Object3D | null {
	let bodyNode: THREE.Object3D | null = null

	model.traverse((node) => {
		if (node.name === 'Body') {
			bodyNode = node
		}
	})

	return bodyNode
}

export function createTransparentTexture(): THREE.Texture {
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = 1
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
	ctx.clearRect(0, 0, 1, 1)

	const texture = new THREE.CanvasTexture(canvas)
	texture.needsUpdate = true
	texture.colorSpace = THREE.SRGBColorSpace
	texture.flipY = false
	texture.magFilter = THREE.NearestFilter
	texture.minFilter = THREE.NearestFilter

	return texture
}

export async function setupSkinModel(
	modelUrl: string,
	textureUrl: string,
	capeTextureUrl?: string,
	config: SkinRendererConfig = {},
	capeFrameDurationMs?: number,
): Promise<{
	model: THREE.Object3D
	bodyNode: THREE.Object3D | null
}> {
	const [gltf, texture] = await Promise.all([loadModel(modelUrl), loadTexture(textureUrl, config)])

	const model = gltf.scene.clone()
	applyTexture(model, texture)

	if (capeTextureUrl) {
		const capeTexture = await loadCapeTexture(capeTextureUrl, config, capeFrameDurationMs)
		applyCapeTexture(model, capeTexture, undefined, capeFrameDurationMs)
	}

	const bodyNode = findBodyNode(model)

	return { model, bodyNode }
}

export function disposeCaches(): void {
	Array.from(textureCache.values()).forEach((texture) => {
		texture.dispose()
	})

	textureCache.clear()
	texturePromiseCache.clear()
	modelCache.clear()
	modelPromiseCache.clear()
}

/**
 * Поддержка анимированных скинов/плащей.
 *
 * HD-скины и анимированные плащи хранятся как вертикальная "плёнка" кадров:
 * один кадр скина — это квадрат (ширина = высота, как у обычного 64x64 скина,
 * просто с большим разрешением), один кадр плаща — прямоугольник 2:1 (как
 * у ванильного 64x32 плаща). Если высота картинки — это N кадров подряд,
 * настоящая ширина/высота одного кадра всё равно считается от ширины файла,
 * поэтому HD-разрешение (хоть 256, хоть 2000+) работает само по себе —
 * достаточно понять, сколько кадров "вшито" по вертикали.
 */

export const SKIN_FRAME_ASPECT = 1 // один кадр скина квадратный (W == H)
export const CAPE_FRAME_ASPECT_CANDIDATES = [2, 1, 46 / 22] // 2:1 ванильный, 1:1 квадратный, ~46:22 (частый формат HD-плащей)

/**
 * Нормализует изображение плаща к стандартной пропорции 2:1 (64x32 на кадр),
 * если передан нестандартный формат (например, OptiFine 46x22, 1:1 квадрат или плоское preview 10:16).
 */
export function normalizeCapeImage(
	img: HTMLImageElement | HTMLCanvasElement,
): HTMLCanvasElement | HTMLImageElement {
	const width = (img as HTMLImageElement).naturalWidth || img.width
	const height = (img as HTMLImageElement).naturalHeight || img.height
	if (!width || !height) return img

	const frameHeight2to1 = width / 2
	if (height >= frameHeight2to1 && height % frameHeight2to1 === 0) {
		return img
	}

	for (let count = 1; count <= 240; count++) {
		const rawFrameH = height / count
		if (Math.abs(width / rawFrameH - 46 / 22) < 0.05) {
			const s = width / 46
			const targetFrameW = Math.round(64 * s)
			const targetFrameH = Math.round(32 * s)
			const canvas = document.createElement('canvas')
			canvas.width = targetFrameW
			canvas.height = count * targetFrameH
			const ctx = canvas.getContext('2d')
			if (!ctx) return img

			ctx.imageSmoothingEnabled = false
			const srcFrameH = height / count
			for (let i = 0; i < count; i++) {
				ctx.drawImage(img, 0, i * srcFrameH, width, srcFrameH, 0, i * targetFrameH, width, srcFrameH)
			}
			return canvas
		}
	}

	if (width === height) {
		const canvas = document.createElement('canvas')
		canvas.width = width
		canvas.height = Math.round(width / 2)
		const ctx = canvas.getContext('2d')
		if (!ctx) return img
		ctx.imageSmoothingEnabled = false
		ctx.drawImage(img, 0, 0, width, Math.round(width / 2), 0, 0, width, Math.round(width / 2))
		return canvas
	}

	return img
}

interface AnimatedCanvasState {
	source: HTMLImageElement | HTMLCanvasElement
	srcWidth: number
	srcHeight: number
	srcFrameH: number
	frameCount: number
	currentFrame: number
	elapsedMs: number
	frameDurationMs: number
	targetCanvas: HTMLCanvasElement
	targetCtx: CanvasRenderingContext2D
	layout: '2:1' | '46:22' | '1:1' | 'flat-10:16'
	targetFrameW: number
	targetFrameH: number
	texture: THREE.CanvasTexture
}

const textureToAnimatedState = new WeakMap<THREE.Texture, AnimatedCanvasState>()

function renderAnimatedFrame(state: AnimatedCanvasState, frameIndex: number): void {
	const { targetCtx, targetCanvas, source, srcWidth, srcFrameH, layout, targetFrameW, targetFrameH } =
		state

	targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height)
	targetCtx.imageSmoothingEnabled = false

	const srcY = frameIndex * srcFrameH

	if (layout === 'flat-10:16') {
		const scale = targetFrameW / 64
		const faceW = 10 * scale
		const faceH = 16 * scale
		targetCtx.drawImage(source, 0, 0, srcWidth, state.srcHeight, 12 * scale, 1 * scale, faceW, faceH)
		targetCtx.drawImage(source, 0, 0, srcWidth, state.srcHeight, 1 * scale, 1 * scale, faceW, faceH)
		targetCtx.drawImage(source, 0, 0, srcWidth, 1, 1 * scale, 0, 21 * scale, 1 * scale)
	} else if (layout === '46:22') {
		targetCtx.drawImage(source, 0, srcY, srcWidth, srcFrameH, 0, 0, srcWidth, srcFrameH)
	} else if (layout === '1:1') {
		targetCtx.drawImage(source, 0, 0, srcWidth, Math.round(srcWidth / 2), 0, 0, srcWidth, targetFrameH)
	} else {
		targetCtx.drawImage(source, 0, srcY, srcWidth, srcFrameH, 0, 0, targetFrameW, targetFrameH)
	}

	// Smart Face Sync for this frame:
	// В стандартном формате Minecraft плащей (в т.ч. лицензионных Mojang)
	// лицевая сторона (рисунок) находится в Region 1 (x: 1..11),
	// а внутренняя подкладка — в Region 2 (x: 12..22).
	// Если это нестандартный/пиратский плащ, где рисунок ошибочно помещен
	// на Region 2, а на Region 1 пусто или сплошной фон, копируем рисунок на Region 1.
	const scale = targetFrameW / 64
	const r1X = Math.round(1 * scale)
	const r2X = Math.round(12 * scale)
	const rY = Math.round(1 * scale)
	const rW = Math.round(10 * scale)
	const rH = Math.round(16 * scale)

	try {
		const imgData1 = targetCtx.getImageData(r1X, rY, rW, rH)
		const imgData2 = targetCtx.getImageData(r2X, rY, rW, rH)

		const p1 = imgData1.data
		const p2 = imgData2.data
		const sampleStep = Math.max(1, Math.floor(p1.length / 1000))

		const colors1 = new Set<number>()
		const colors2 = new Set<number>()

		for (let i = 0; i < p1.length; i += 4 * sampleStep) {
			if (p1[i + 3] > 20) {
				colors1.add(((p1[i] >> 3) << 10) | ((p1[i + 1] >> 3) << 5) | (p1[i + 2] >> 3))
			}
			if (p2[i + 3] > 20) {
				colors2.add(((p2[i] >> 3) << 10) | ((p2[i + 1] >> 3) << 5) | (p2[i + 2] >> 3))
			}
		}

		if (colors2.size > colors1.size + 2 && colors2.size > 5) {
			targetCtx.putImageData(imgData2, r1X, rY)
		}
	} catch {
		// Canvas security fallback
	}

	state.texture.needsUpdate = true
}

export async function loadCapeTexture(
	textureUrl: string,
	config: SkinRendererConfig = {},
	frameDurationMs?: number,
): Promise<THREE.Texture> {
	const rawTexture = await loadTexture(textureUrl, config)
	if (!rawTexture.image) return rawTexture

	const img = rawTexture.image as HTMLImageElement | HTMLCanvasElement
	const width = (img as HTMLImageElement).naturalWidth || img.width
	const height = (img as HTMLImageElement).naturalHeight || img.height
	if (!width || !height) return rawTexture

	// 1. Определение формата и количества кадров
	let frameCount = 1
	let layout: '2:1' | '46:22' | '1:1' | 'flat-10:16' = '2:1'

	const ratio = width / height
	if (
		Math.abs(ratio - 10 / 16) < 0.05 ||
		(ratio < 0.8 &&
			height % Math.round(width / 2) !== 0 &&
			height % Math.round((width * 22) / 46) !== 0)
	) {
		layout = 'flat-10:16'
		frameCount = 1
	} else if (width === height) {
		layout = '1:1'
		frameCount = 1
	} else {
		let found46_22 = false
		for (let count = 1; count <= 240; count++) {
			const rawFrameH = height / count
			if (Math.abs(width / rawFrameH - 46 / 22) < 0.05) {
				layout = '46:22'
				frameCount = count
				found46_22 = true
				break
			}
		}
		if (!found46_22) {
			const frameHeight2to1 = Math.round(width / 2)
			if (frameHeight2to1 > 0 && height >= frameHeight2to1) {
				const count = Math.round(height / frameHeight2to1)
				if (count >= 1 && Math.abs(height - count * frameHeight2to1) <= count * 2) {
					layout = '2:1'
					frameCount = count
				}
			}
		}
	}

	let targetFrameW = width
	let targetFrameH = Math.round(width / 2)

	if (layout === '46:22') {
		const s = width / 46
		targetFrameW = Math.round(64 * s)
		targetFrameH = Math.round(32 * s)
	} else if (layout === '1:1') {
		targetFrameW = width
		targetFrameH = Math.round(width / 2)
	} else if (layout === 'flat-10:16') {
		targetFrameW = Math.round((width / 10) * 64)
		targetFrameH = Math.round((height / 16) * 32)
	}

	const canvas = document.createElement('canvas')
	canvas.width = targetFrameW
	canvas.height = targetFrameH
	const ctx = canvas.getContext('2d', { willReadFrequently: true })
	if (!ctx) return rawTexture

	const srcFrameH = height / frameCount
	let validDuration = frameDurationMs
	if (!validDuration || !Number.isFinite(validDuration) || validDuration <= 0) {
		validDuration = DEFAULT_FRAME_DURATION_MS
	} else if (validDuration <= 10) {
		validDuration = validDuration * 50
	}

	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = config.textureColorSpace ?? THREE.SRGBColorSpace
	texture.flipY = config.textureFlipY ?? false
	texture.magFilter = config.textureMagFilter ?? THREE.NearestFilter
	texture.minFilter = config.textureMinFilter ?? THREE.NearestFilter
	texture.wrapS = THREE.ClampToEdgeWrapping
	texture.wrapT = THREE.ClampToEdgeWrapping
	texture.repeat.set(1, 1)
	texture.offset.set(0, 0)

	const state: AnimatedCanvasState = {
		source: img,
		srcWidth: width,
		srcHeight: height,
		srcFrameH,
		frameCount,
		currentFrame: 0,
		elapsedMs: 0,
		frameDurationMs: validDuration,
		targetCanvas: canvas,
		targetCtx: ctx,
		layout,
		targetFrameW,
		targetFrameH,
		texture,
	}

	textureToAnimatedState.set(texture, state)

	renderAnimatedFrame(state, 0)

	return texture
}

const FRAME_STRIP_TOLERANCE = 0.15 // допуск на неровно экспортированные кадры
const DEFAULT_FRAME_DURATION_MS = 120
const MAX_DECODED_BYTES = 96 * 1024 * 1024
const MAX_FRAME_COUNT = 240

interface FrameStripState {
	frameCount: number
	elapsedMs: number
}

const frameStripState = new WeakMap<THREE.Texture, FrameStripState>()

function getTextureImageSize(texture: THREE.Texture): { width: number; height: number } | null {
	const image = texture.image as
		| (Partial<HTMLImageElement> & Partial<HTMLCanvasElement> & { width?: number; height?: number })
		| undefined
	if (!image) return null

	const width = image.naturalWidth || image.width
	const height = image.naturalHeight || image.height
	if (!width || !height) return null

	return { width, height }
}

export function configureFrameStrip(
	texture: THREE.Texture | null | undefined,
	frameAspectCandidates: number | number[],
	frameDurationMs: number = DEFAULT_FRAME_DURATION_MS,
): void {
	if (!texture) return
	if (textureToAnimatedState.has(texture)) return

	const size = getTextureImageSize(texture)
	if (!size) return

	const decodedBytes = size.width * size.height * 4
	if (decodedBytes > MAX_DECODED_BYTES) {
		texture.wrapS = THREE.ClampToEdgeWrapping
		texture.wrapT = THREE.ClampToEdgeWrapping
		texture.repeat.set(1, 1)
		texture.offset.set(0, 0)
		texture.updateMatrix()
		frameStripState.delete(texture)
		return
	}

	const candidates = Array.isArray(frameAspectCandidates)
		? frameAspectCandidates
		: [frameAspectCandidates]

	let best: { frameCount: number; error: number } | null = null

	for (const aspect of candidates) {
		if (!aspect) continue
		const expectedFrameHeight = size.width / aspect
		if (expectedFrameHeight <= 0) continue

		const rawFrameCount = size.height / expectedFrameHeight
		const frameCount = Math.round(rawFrameCount)
		if (frameCount < 1) continue

		const error = Math.abs(rawFrameCount - frameCount) / frameCount

		if (!best || error < best.error) {
			best = { frameCount, error }
		}
	}

	const isFrameStrip =
		!!best && best.frameCount > 1 && best.error < FRAME_STRIP_TOLERANCE && best.frameCount <= MAX_FRAME_COUNT

	texture.wrapS = THREE.ClampToEdgeWrapping
	texture.wrapT = THREE.ClampToEdgeWrapping

	if (!isFrameStrip || !best) {
		texture.repeat.set(1, 1)
		texture.offset.set(0, 0)
		texture.updateMatrix()
		frameStripState.delete(texture)
		return
	}

	const { frameCount } = best
	let validDuration = frameDurationMs
	if (!validDuration || !Number.isFinite(validDuration) || validDuration <= 0) {
		validDuration = DEFAULT_FRAME_DURATION_MS
	} else if (validDuration <= 10) {
		validDuration = validDuration * 50
	}

	texture.repeat.set(1, 1 / frameCount)
	texture.offset.set(0, texture.flipY ? 1 - 1 / frameCount : 0)
	texture.updateMatrix()
	texture.userData.frameDurationMs = validDuration
	frameStripState.set(texture, { frameCount, elapsedMs: 0 })
}

/**
 * Вызывать каждый кадр рендера (из onLoop) со списком активных текстур
 * (скин, плащ). Для текстур без анимации — no-op.
 */
export function advanceFrameStripTextures(
	textures: (THREE.Texture | null | undefined)[],
	deltaSeconds: number,
): void {
	const processed = new Set<THREE.Texture>()

	for (const texture of textures) {
		if (!texture || processed.has(texture)) continue
		processed.add(texture)

		const state = frameStripState.get(texture)
		if (!state || state.frameCount <= 1) continue

		let frameDurationMs =
			(texture.userData.frameDurationMs as number | undefined) ||
			DEFAULT_FRAME_DURATION_MS
		if (!frameDurationMs || !Number.isFinite(frameDurationMs) || frameDurationMs <= 0) {
			frameDurationMs = DEFAULT_FRAME_DURATION_MS
		} else if (frameDurationMs <= 10) {
			frameDurationMs = frameDurationMs * 50
		}

		state.elapsedMs += (deltaSeconds || 0.016) * 1000
		const frameIndex = Math.floor(state.elapsedMs / frameDurationMs) % state.frameCount
		const v = frameIndex / state.frameCount
		const offsetY = texture.flipY ? 1 - 1 / state.frameCount - v : v

		if (Math.abs(texture.offset.y - offsetY) > 0.00001) {
			texture.offset.y = offsetY
			texture.updateMatrix()
		}
	}
}
