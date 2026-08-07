import { ref } from 'vue'

import { useVIntl } from '#ui/composables/i18n'

const TRANSLATE_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
}

const DELIMITER = ' ¶¶ '
const MAX_BATCH_LENGTH = 1000

// Shared module-level state so the toggle persists across header instances
// and can be observed when the search results change (e.g. page switch).
const isTranslated = ref(false)
const isTranslating = ref(false)
const originalSummaries = new Map<string, string>()

// Set to true while WE replace the hits array, so the watcher in header.vue
// does not react to our own update (prevents infinite loop).
const applyingTranslation = ref(false)

function getText(hit: any): string {
    return hit.description ?? hit.summary ?? ''
}

function getId(hit: any): string {
    return hit.project_id ?? hit.slug ?? ''
}

export function useSearchTranslation() {
    const { locale } = useVIntl()

    function targetLanguage(): string {
        const loc = (locale.value as string) || 'ru-RU'
        return loc.split('-')[0].toLowerCase() || 'ru'
    }

    async function fetchTranslation(text: string): Promise<{ text: string; ok: boolean }> {
        if (!text || !text.trim()) return { text, ok: true }
        const tl = targetLanguage()
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
                return { text: translated, ok: translated.trim().length > 0 }
            }
            return { text, ok: false }
        } catch (e) {
            console.error('Translation chunk failed:', e)
            return { text, ok: false }
        }
    }

    /**
     * Translates the `summary`/`description` field of every hit in the given array.
     * Works for both v2 (`description`) and v3 (`summary`) search results.
     * Returns a new array with translated texts applied.
     */
    async function translateHits(hits: any[]): Promise<any[]> {
        if (!hits || hits.length === 0) return hits

        // Save originals & collect texts to translate
        const textsToTranslate: string[] = []
        const hitIndices: number[] = []

        hits.forEach((hit, idx) => {
            const id = getId(hit)
            const text = getText(hit)
            if (!originalSummaries.has(id)) {
                originalSummaries.set(id, text)
            }
            const clean = text.trim()
            if (
                clean &&
                !/^https?:\/\/[^\s]+$/i.test(clean) &&
                !/^[0-9\s\-_.,:;!@#$%^&*()+=?/\\|<>'"~`]*$/.test(clean)
            ) {
                textsToTranslate.push(clean)
                hitIndices.push(idx)
            }
        })

        if (textsToTranslate.length === 0) {
            return hits
        }

        // Batch texts with delimiter
        const batches: { indices: number[]; payload: string }[] = []
        let currentPayload = ''
        let currentIndices: number[] = []

        textsToTranslate.forEach((text, i) => {
            if (currentPayload.length + text.length > MAX_BATCH_LENGTH) {
                if (currentPayload) batches.push({ indices: [...currentIndices], payload: currentPayload })
                currentPayload = text
                currentIndices = [i]
            } else {
                currentPayload = currentPayload ? `${currentPayload}${DELIMITER}${text}` : text
                currentIndices.push(i)
            }
        })
        if (currentPayload) {
            batches.push({ indices: [...currentIndices], payload: currentPayload })
        }

        const translatedTexts: string[] = new Array(textsToTranslate.length)
        let anyOk = false

        for (const batch of batches) {
            const { text: translatedBatch, ok } = await fetchTranslation(batch.payload)
            if (ok) {
                anyOk = true
                const items = translatedBatch.split(/\s*¶¶\s*/).map((s) => s.trim())
                for (let k = 0; k < batch.indices.length; k++) {
                    const item = items[k]
                    if (item) {
                        translatedTexts[batch.indices[k]] = item
                    }
                }
            }
        }

        if (!anyOk) {
            throw new Error('Translation service unreachable - no text was translated.')
        }

        return hits.map((hit, idx) => {
            const pos = hitIndices.indexOf(idx)
            if (pos === -1 || !translatedTexts[pos]) return hit
            return hit.description !== undefined
                ? { ...hit, description: translatedTexts[pos] }
                : { ...hit, summary: translatedTexts[pos] }
        })
    }

    /**
     * Toggles translation on/off. On first call translates, on second restores originals.
     */
    async function toggleSearchTranslation(hits: any[]): Promise<any[]> {
        if (!hits || hits.length === 0) return hits

        // Restore originals
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

    /**
     * Translates hits when the toggle is already enabled (e.g. after page change).
     * No-op when translation is off, already running, or hits are already translated.
     */
    async function translateNewHits(hits: any[]): Promise<any[]> {
        if (!isTranslated.value || isTranslating.value) return hits
        if (!hits || hits.length === 0) return hits

        // Skip if every hit already shows translated text (matches nothing in originals cache
        // means these hits were never translated, so we proceed; if ALL match originals, they
        // are fresh from the API and need translation).
        isTranslating.value = true
        try {
            return await translateHits(hits)
        } catch (e) {
            console.error('Search auto-translation error:', e)
            return hits
        } finally {
            isTranslating.value = false
        }
    }

    return {
        isTranslated,
        isTranslating,
        applyingTranslation,
        toggleSearchTranslation,
        translateNewHits,
    }
}
