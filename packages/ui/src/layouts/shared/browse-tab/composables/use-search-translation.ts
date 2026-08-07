import { LRUCache } from 'lru-cache'
import { ref, watch, type Ref } from 'vue'

import { useVIntl } from '#ui/composables/i18n'

const TRANSLATE_HEADERS = {
	'User-Agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
	Accept: 'application/json, text/plain, */*',
}

const DELIMITER = ''
const MAX_BATCH_LENGTH = 1000
const MAX_ORIGINAL_ENTRIES = 500
const MAX_TRANSLATION_CACHE_ENTRIES = 400
const DEBOUNCE_MS = 350

const isTranslated = ref(false)
const isTranslating = ref(false)
const applyingTranslation = ref(false)

const originalSummaries = new LRUCache<string, string>({
	max: MAX_ORIGINAL_ENTRIES,
})

const translationCache = new LRUCache<string, string>({
	max: MAX_TRANSLATION_CACHE_ENTRIES,
	ttl: 1000 * 60 * 60 * 6,
})

function getText(hit: Record<string, any>): string {
	return hit.description ?? hit.summary ?? ''
}

function getId(hit: Record<string, any>): string {
	return hit.project_id ?? hit.slug ?? ''
}

export function useSearchTranslation(queryRef?: Ref<string>) {
	const { locale } = useVIntl()

	if (queryRef) {
		watch(queryRef, () => {
			isTranslated.value = false
			isTranslating.value = false
			originalSummaries.clear()
			translationCache.clear()
		})
	}

	function targetLanguage(): string {
		const loc = (locale.value as string) || 'ru-RU'
		return loc.split('-')[0].toLowerCase() || 'ru'
	}

	async function fetchTranslation(text: string): Promise<{ text: string; ok: boolean }> {
		if (!text || !text.trim()) return { text, ok: true }
		const tl = targetLanguage()

		const cached = translationCache.get(text)
		if (cached !== undefined) {
			return { text: cached, ok: true }
		}

		const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`
		try {
			const res: Response | null = await fetch(url, { headers: TRANSLATE_HEADERS }).catch((e) => {
				console.error('fetch failed for translate chunk:', e)
				return null
			})
			if (!res || !res.ok) {
				console.error('Translation request failed. Final status:', res?.status, res?.statusText)
				return { text, ok: false }
			}

			const json = await res.json()
			if (Array.isArray(json) && Array.isArray(json[0])) {
				const translated = json[0].map((item: any) => item[0] || '').join('')
				if (translated.trim().length > 0) {
					translationCache.set(text, translated)
					return { text: translated, ok: true }
				}
				return { text, ok: false }
			}
			return { text, ok: false }
		} catch (e) {
			console.error('Translation chunk failed:', e)
			return { text, ok: false }
		}
	}

	async function translateHits(hits: Record<string, any>[]): Promise<Record<string, any>[]> {
		if (!hits || hits.length === 0) return hits

		const updatedHits = await Promise.all(
			hits.map(async (hit) => {
				const id = getId(hit)
				const text = getText(hit)
				if (!originalSummaries.has(id)) {
					originalSummaries.set(id, text)
				}
				const clean = text.trim()
				if (
					!clean ||
					/^https?:\/\/[^\s]+$/i.test(clean) ||
					/^[0-9\s\-_.,:;!@#$%^&*()+=?/\\|<>'"~`]*$/.test(clean)
				) {
					return hit
				}

				const { text: translated, ok } = await fetchTranslation(clean)
				if (!ok || !translated) return hit

				return hit.description !== undefined
					? { ...hit, description: translated }
					: { ...hit, summary: translated }
			}),
		)

		return updatedHits
	}

	async function toggleSearchTranslation(hits: Record<string, any>[]): Promise<Record<string, any>[]> {
		if (!hits || hits.length === 0) return hits

		if (isTranslated.value) {
			const restored = hits.map((hit) => {
				const id = getId(hit)
				const original = originalSummaries.get(id)
				if (original === undefined) return hit
				return hit.description !== undefined
					? { ...hit, description: original }
					: { ...hit, summary: original }
			})
			isTranslated.value = false
			return restored
		}

		isTranslating.value = true
		try {
			const updated = await translateHits(hits)
			isTranslated.value = true
			return updated
		} catch (e) {
			console.error('Search translation error:', e)
			return hits
		} finally {
			isTranslating.value = false
		}
	}

	let debounceTimer: ReturnType<typeof setTimeout> | null = null
	async function translateNewHits(hits: Record<string, any>[]): Promise<Record<string, any>[]> {
		if (!isTranslated.value || isTranslating.value) return hits
		if (!hits || hits.length === 0) return hits

		return new Promise((resolve) => {
			if (debounceTimer) clearTimeout(debounceTimer)
			debounceTimer = setTimeout(async () => {
				isTranslating.value = true
				try {
					const result = await translateHits(hits)
					resolve(result)
				} catch (e) {
					console.error('Search auto-translation error:', e)
					resolve(hits)
				} finally {
					isTranslating.value = false
				}
			}, DEBOUNCE_MS)
		})
	}

	return {
		isTranslated,
		isTranslating,
		applyingTranslation,
		toggleSearchTranslation,
		translateNewHits,
	}
}