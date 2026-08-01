import { ref } from 'vue'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

export function useProjectTranslation() {
	const isTranslated = ref(false)
	const isTranslating = ref(false)
	const originalSummary = ref<string | null>(null)
	const originalBody = ref<string | null>(null)

	function getTargetLang(): string {
		try {
			const saved = localStorage.getItem('locale') || localStorage.getItem('lang')
			if (saved) return saved.split('-')[0].split('_')[0]
			if (typeof navigator !== 'undefined' && navigator.language) {
				return navigator.language.split('-')[0].split('_')[0]
			}
		} catch (e) {}
		return 'ru'
	}

	async function translateChunk(text: string): Promise<string> {
		if (!text || !text.trim()) return text
		const targetLang = getTargetLang()
		const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`
		try {
			const res = await tauriFetch(url).catch(() => fetch(url))
			if (!res.ok) return text
			const json = await res.json()
			if (Array.isArray(json) && Array.isArray(json[0])) {
				return json[0].map((item: any) => item[0] || '').join('')
			}
			return text
		} catch (e) {
			console.error('Translation failed:', e)
			return text
		}
	}

	async function translateHtmlOrText(content: string): Promise<string> {
		if (!content || !content.trim()) return content

		const tokens = content.split(/(<[^>]+>)/g)
		const translatedTokens = await Promise.all(
			tokens.map(async (token) => {
				if (token.startsWith('<') && token.endsWith('>')) {
					return token
				}
				if (!token.trim()) return token
				return await translateChunk(token)
			}),
		)

		return translatedTokens.join('')
	}

	async function toggleTranslation(projectRef: { value: any }) {
		if (!projectRef.value) return

		if (isTranslated.value) {
			if (originalSummary.value !== null && originalBody.value !== null) {
				projectRef.value = {
					...projectRef.value,
					summary: originalSummary.value,
					description: originalSummary.value,
					body: originalBody.value,
				}
			}
			isTranslated.value = false
			return
		}

		isTranslating.value = true
		try {
			if (originalSummary.value === null) {
				originalSummary.value = projectRef.value.summary || projectRef.value.description || ''
			}
			if (originalBody.value === null) {
				originalBody.value = projectRef.value.body || projectRef.value.description || ''
			}

			const [translatedSum, translatedBdy] = await Promise.all([
				translateChunk(originalSummary.value),
				translateHtmlOrText(originalBody.value),
			])

			projectRef.value = {
				...projectRef.value,
				summary: translatedSum,
				description: translatedSum,
				body: translatedBdy,
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
