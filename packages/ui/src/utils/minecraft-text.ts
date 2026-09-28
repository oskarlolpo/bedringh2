const MC_COLORS: Record<string, string> = {
	'0': '#000000',
	'1': '#0000aa',
	'2': '#00aa00',
	'3': '#00aaaa',
	'4': '#aa0000',
	'5': '#aa00aa',
	'6': '#ffaa00',
	'7': '#aaaaaa',
	'8': '#555555',
	'9': '#5555ff',
	'a': '#55ff55',
	'b': '#55ffff',
	'c': '#ff5555',
	'd': '#ff55ff',
	'e': '#ffff55',
	'f': '#ffffff',
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

/**
 * Formats Minecraft color and style codes (§ and &) into HTML spans.
 * Supports bold (§l), italic (§o), underline (§n), strikethrough (§m),
 * reset (§r), standard colors (§0-§f), and hex colors (§#RRGGBB / &#RRGGBB).
 */
export function formatMinecraftText(input?: string | null): string {
	if (!input) return ''

	// Fast path: if no formatting tokens present, return escaped string
	if (!input.includes('§') && !/&[0-9a-fk-orA-FK-OR#]/.test(input)) {
		return escapeHtml(input)
	}

	// Normalize & codes to §
	let text = input.replace(/&([0-9a-fk-orA-FK-OR])/g, '§$1')
	text = text.replace(/&#([0-9a-fA-F]{6})/g, '§#$1')

	const parts = text.split('§')
	let result = escapeHtml(parts[0])

	let currentColor = ''
	let isBold = false
	let isItalic = false
	let isUnderline = false
	let isStrikethrough = false

	for (let i = 1; i < parts.length; i++) {
		const part = parts[i]
		if (!part) continue

		let rest = ''

		if (part.startsWith('#') && part.length >= 7) {
			currentColor = part.slice(0, 7)
			rest = part.slice(7)
		} else {
			const code = part[0].toLowerCase()
			rest = part.slice(1)

			if (MC_COLORS[code]) {
				currentColor = MC_COLORS[code]
				// Color code in Minecraft resets formatting
				isBold = false
				isItalic = false
				isUnderline = false
				isStrikethrough = false
			} else if (code === 'l') {
				isBold = true
			} else if (code === 'o') {
				isItalic = true
			} else if (code === 'n') {
				isUnderline = true
			} else if (code === 'm') {
				isStrikethrough = true
			} else if (code === 'r') {
				currentColor = ''
				isBold = false
				isItalic = false
				isUnderline = false
				isStrikethrough = false
			}
		}

		if (rest.length === 0) continue

		const styles: string[] = []
		if (currentColor) styles.push(`color: ${currentColor}`)
		if (isBold) styles.push('font-weight: bold')
		if (isItalic) styles.push('font-style: italic')

		const decorations: string[] = []
		if (isUnderline) decorations.push('underline')
		if (isStrikethrough) decorations.push('line-through')
		if (decorations.length > 0) {
			styles.push(`text-decoration: ${decorations.join(' ')}`)
		}

		const escapedRest = escapeHtml(rest)
		if (styles.length > 0) {
			result += `<span style="${styles.join('; ')}">${escapedRest}</span>`
		} else {
			result += escapedRest
		}
	}

	return result
}
