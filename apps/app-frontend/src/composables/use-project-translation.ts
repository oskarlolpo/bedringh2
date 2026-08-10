import { isRef, ref, triggerRef } from 'vue'
import i18n from '@/i18n.config'

function targetLanguage(): string {
	const locale = i18n.global.locale.value || 'ru-RU'
	return locale.split('-')[0].toLowerCase() || 'ru'
}

export function useProjectTranslation() {
	const isTranslated = ref(false)
	const isTranslating = ref(false)
	const originalTitle = ref<string | null>(null)
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
			const res = await fetch(url, { headers: TRANSLATE_HEADERS }).catch((e) => {
				console.error('browser fetch failed for translate chunk:', e)
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

		let anyOk = false
		const translatedParts = [...parts]

		for (const snip of snippets) {
			const { text: translatedText, ok } = await fetchSingleChunk(snip.text)
			if (ok) {
				anyOk = true
				const origPart = parts[snip.partIndex]
				const leadingSpace = origPart.match(/^\s*/)?.[0] || ''
				const trailingSpace = origPart.match(/\s*$/)?.[0] || ''
				translatedParts[snip.partIndex] = `${leadingSpace}${translatedText}${trailingSpace}`
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
				title: originalTitle.value !== null ? originalTitle.value : proj.title,
				title_formatted: originalTitle.value !== null ? originalTitle.value : proj.title_formatted,
				summary: originalSummary.value !== null ? originalSummary.value : proj.summary,
				description: originalDescription.value !== null ? originalDescription.value : proj.description,
				body: originalBody.value !== null ? originalBody.value : proj.body,
			}
			if (isRef(projectRef)) {
				projectRef.value = restored
				triggerRef(projectRef)
			} else {
				Object.assign(proj, restored)
			}
			isTranslated.value = false
			return
		}

		isTranslating.value = true
		try {
			if (originalTitle.value === null) {
				originalTitle.value = proj.title ?? proj.title_formatted ?? ''
			}
			if (originalSummary.value === null) {
				originalSummary.value = proj.summary ?? ''
			}
			if (originalDescription.value === null) {
				originalDescription.value = proj.description ?? ''
			}
			if (originalBody.value === null) {
				originalBody.value = proj.body || proj.description || proj.summary || ''
			}

			const [titleResult, summaryResult, descriptionResult, bodyResult] = await Promise.all([
				translateChunk(originalTitle.value),
				translateChunk(originalSummary.value),
				translateChunk(originalDescription.value),
				translateHtmlOrText(originalBody.value),
			])

			const anyTranslated = titleResult.ok || summaryResult.ok || descriptionResult.ok || bodyResult.anyOk
			if (!anyTranslated) {
				throw new Error(
					'Translation service unreachable - no text was translated.',
				)
			}

			const updated = {
				...proj,
				title: titleResult.ok ? titleResult.text : proj.title,
				title_formatted: titleResult.ok ? titleResult.text : proj.title_formatted,
				summary: summaryResult.ok ? summaryResult.text : proj.summary,
				description: descriptionResult.ok ? descriptionResult.text : proj.description,
				body: bodyResult.anyOk ? bodyResult.text : proj.body,
			}

			if (isRef(projectRef)) {
				projectRef.value = updated
				triggerRef(projectRef)
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
