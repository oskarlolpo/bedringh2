import { isRef, ref } from 'vue'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import i18n from '@/i18n.config'

function targetLanguage(): string {
	const locale = i18n.global.locale.value || 'ru-RU'
	return locale.split('-')[0].toLowerCase() || 'ru'
}

export function useProjectTranslation() {
	const isTranslated = ref(false)
	const isTranslating = ref(false)
	const originalSummary = ref<string | null>(null)
	const originalDescription = ref<string | null>(null)
	const originalBody = ref<string | null>(null)

	const TRANSLATE_HEADERS = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
		Accept: 'application/json, text/plain, */*',
	}

	async function fetchSingleChunk(text: string): Promise<{ text: string; ok: boolean }> {
		if (!text || !text.trim()) return { text, ok: true }
		const tl = targetLanguage()
		const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`
		try {
			let res: any = null
			if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
				res = await tauriFetch(url, { headers: TRANSLATE_HEADERS }).catch((e) => {
					console.error('tauriFetch threw for translate chunk:', e)
					return null
				})
			}
			if (!res || !res.ok) {
				res = await fetch(url, { headers: TRANSLATE_HEADERS }).catch((e) => {
					console.error('browser fetch failed for translate chunk:', e)
					return null
				})
			}
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

	async function translateChunk(text: string): Promise<{ text: string; ok: boolean }> {
		if (!text || !text.trim()) return { text, ok: true }
		return fetchSingleChunk(text)
	}

	async function translateHtmlOrText(content: string): Promise<{ text: string; anyOk: boolean }> {
		if (!content || !content.trim()) return { text: content, anyOk: false }

		const parts = content.split(/(<[^>]+>)/g)
		const snippets: { partIndex: number; text: string }[] = []

		parts.forEach((part, idx) => {
			if (part.startsWith('<') && part.endsWith('>')) return
			const cleanText = part.replace(/&nbsp;/gi, ' ').trim()
			if (
				!cleanText ||
				/^&nbsp;$/i.test(cleanText) ||
				/^https?:\/\/[^\s]+$/i.test(cleanText) ||
				/^```/.test(cleanText) ||
				/^[0-9\s\-_.,:;!@#$%^&*()+=?/\\|<>'"~`]*$/.test(cleanText)
			) {
				return
			}
			snippets.push({ partIndex: idx, text: cleanText })
		})

		if (snippets.length === 0) {
			return { text: content, anyOk: false }
		}

		const DELIMITER = ' ¶¶ '
		let currentBatchText = ''
		let currentSnippetIndices: number[] = []
		const batches: { snippetIndices: number[]; textPayload: string }[] = []

		snippets.forEach((snip, i) => {
			if (currentBatchText.length + snip.text.length > 1000) {
				if (currentBatchText) batches.push({ snippetIndices: [...currentSnippetIndices], textPayload: currentBatchText })
				currentBatchText = snip.text
				currentSnippetIndices = [i]
			} else {
				currentBatchText = currentBatchText ? `${currentBatchText}${DELIMITER}${snip.text}` : snip.text
				currentSnippetIndices.push(i)
			}
		})
		if (currentBatchText) {
			batches.push({ snippetIndices: [...currentSnippetIndices], textPayload: currentBatchText })
		}

		let anyOk = false
		const translatedParts = [...parts]

		for (const batch of batches) {
			const { text: translatedBatch, ok } = await fetchSingleChunk(batch.textPayload)
			if (ok) {
				anyOk = true
				const translatedItems = translatedBatch.split(/\s*¶¶\s*/).map((s) => s.trim())
				for (let k = 0; k < batch.snippetIndices.length; k++) {
					const snip = snippets[batch.snippetIndices[k]]
					const item = translatedItems[k]
					if (item && snip) {
						const origPart = parts[snip.partIndex]
						const leadingSpace = origPart.match(/^\s*/)?.[0] || ''
						const trailingSpace = origPart.match(/\s*$/)?.[0] || ''
						translatedParts[snip.partIndex] = `${leadingSpace}${item}${trailingSpace}`
					}
				}
			}
		}

		return { text: translatedParts.join(''), anyOk }
	}

	async function toggleTranslation(projectRef: any) {
		const proj = projectRef && 'value' in projectRef ? projectRef.value : projectRef
		if (!proj) return

		if (isTranslated.value) {
			const restored = {
				...proj,
				summary: originalSummary.value !== null ? originalSummary.value : proj.summary,
				description: originalDescription.value !== null ? originalDescription.value : proj.description,
				body: originalBody.value !== null ? originalBody.value : proj.body,
			}
			if (isRef(projectRef)) {
				projectRef.value = restored
			} else {
				Object.assign(proj, restored)
			}
			isTranslated.value = false
			return
		}

		isTranslating.value = true
		try {
			if (originalSummary.value === null) {
				originalSummary.value = proj.summary ?? ''
			}
			if (originalDescription.value === null) {
				originalDescription.value = proj.description ?? ''
			}
			if (originalBody.value === null) {
				originalBody.value = proj.body || proj.description || ''
			}

			const [summaryResult, descriptionResult, bodyResult] = await Promise.all([
				translateChunk(originalSummary.value),
				translateChunk(originalDescription.value),
				translateHtmlOrText(originalBody.value),
			])

			const anyTranslated = summaryResult.ok || descriptionResult.ok || bodyResult.anyOk
			if (!anyTranslated) {
				throw new Error(
					'Translation service unreachable - no text was translated. Check that translate.googleapis.com is allowed in the app HTTP scope and CSP.',
				)
			}

			const updated = {
				...proj,
				summary: summaryResult.text,
				description: descriptionResult.text,
				body: bodyResult.text,
			}

			if (isRef(projectRef)) {
				projectRef.value = updated
			} else {
				Object.assign(proj, updated)
			}
			isTranslated.value = true
		} catch (e) {
			console.error('Translation error:', e)
		} finally {
			isTranslating.value = false
		}
	}

	return {
		isTranslated,
		isTranslating,
		toggleTranslation,
	}
}
