import { ref } from 'vue'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import i18n from '@/i18n.config'

function targetLanguage(): string {
	// Follow the launcher's own configured language rather than a hardcoded one.
	// Locale codes here are like 'ru-RU', 'en-US' - Google's translate endpoint
	// wants a bare language code ('ru', 'en'), so take the part before the dash.
	const locale = i18n.global.locale.value || 'en-US'
	return locale.split('-')[0].toLowerCase() || 'en'
}

export function useProjectTranslation() {
	const isTranslated = ref(false)
	const isTranslating = ref(false)
	const originalSummary = ref<string | null>(null)
	const originalDescription = ref<string | null>(null)
	const originalBody = ref<string | null>(null)

	async function translateChunk(text: string): Promise<{ text: string; ok: boolean }> {
		if (!text || !text.trim()) return { text, ok: true }
		const tl = targetLanguage()
		const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`
		try {
			const res = await tauriFetch(url)
			if (!res.ok) return { text, ok: false }
			const json = await res.json()
			if (Array.isArray(json) && Array.isArray(json[0])) {
				const translated = json[0].map((item: any) => item[0] || '').join('')
				return { text: translated, ok: translated.trim().length > 0 }
			}
			return { text, ok: false }
		} catch (e) {
			console.error('Translation failed:', e)
			return { text, ok: false }
		}
	}

	async function translateHtmlOrText(content: string): Promise<{ text: string; anyOk: boolean }> {
		if (!content || !content.trim()) return { text: content, anyOk: false }

		let anyOk = false
		if (!/<[a-z][\s\S]*>/i.test(content)) {
			const paragraphs = content.split('\n\n')
			const translatedParas = await Promise.all(
				paragraphs.map(async (p) => {
					if (!p.trim()) return p
					const { text: tr, ok } = await translateChunk(p)
					if (ok) anyOk = true
					return tr
				}),
			)
			return { text: translatedParas.join('\n\n'), anyOk }
		}

		const matches: string[] = []
		content.replace(/(>)([^<]+)(<)/g, (_, _p1, p2) => {
			if (p2 && p2.trim()) {
				matches.push(p2)
			}
			return ''
		})

		const translationsMap = new Map<string, string>()
		for (const textSnippet of matches) {
			if (!translationsMap.has(textSnippet)) {
				const trimmed = textSnippet.trim()
				const { text: tr, ok } = await translateChunk(trimmed)
				if (ok) {
					anyOk = true
					const leadingSpace = textSnippet.match(/^\s*/)?.[0] || ''
					const trailingSpace = textSnippet.match(/\s*$/)?.[0] || ''
					translationsMap.set(textSnippet, `${leadingSpace}${tr}${trailingSpace}`)
				}
			}
		}

		const resultHtml = content.replace(/(>)([^<]+)(<)/g, (full, p1, p2, p3) => {
			if (!p2 || !p2.trim()) return full
			const translated = translationsMap.get(p2)
			return translated ? `${p1}${translated}${p3}` : full
		})

		return { text: resultHtml, anyOk }
	}

	async function toggleTranslation(projectRef: { value: any }) {
		if (!projectRef.value) return

		if (isTranslated.value) {
			if (originalSummary.value !== null) {
				projectRef.value.summary = originalSummary.value
			}
			if (originalDescription.value !== null) {
				projectRef.value.description = originalDescription.value
			}
			if (originalBody.value !== null) {
				projectRef.value.body = originalBody.value
			}
			isTranslated.value = false
			return
		}

		isTranslating.value = true
		try {
			if (originalSummary.value === null) {
				originalSummary.value = projectRef.value.summary ?? ''
			}
			if (originalDescription.value === null) {
				originalDescription.value = projectRef.value.description ?? ''
			}
			if (originalBody.value === null) {
				originalBody.value = projectRef.value.body || projectRef.value.description || ''
			}

			const [summaryResult, descriptionResult, bodyResult] = await Promise.all([
				translateChunk(originalSummary.value),
				translateChunk(originalDescription.value),
				translateHtmlOrText(originalBody.value),
			])

			const anyTranslated = summaryResult.ok || descriptionResult.ok || bodyResult.anyOk
			if (!anyTranslated) {
				// Every chunk failed (network/CSP/plugin-scope issue) - don't flip into
				// a "translated" state that shows unchanged text, and don't overwrite
				// the originals with themselves.
				throw new Error('Translation service unreachable - no text was translated.')
			}

			projectRef.value.summary = summaryResult.text
			projectRef.value.description = descriptionResult.text
			projectRef.value.body = bodyResult.text
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
