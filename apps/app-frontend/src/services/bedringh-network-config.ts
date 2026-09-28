/**
 * Конфигурация сети и VDS-эндпоинтов для Bedringh Хостинга.
 * Используется публичный домен bedringh.duckdns.org без раскрытия прямого IP VDS в коде.
 */

const STORAGE_RELAY_KEY = 'bedringh_vds_relay_endpoint_v1'
const DEFAULT_DOMAIN_RELAY = 'http://bedringh.duckdns.org:7700'

/**
 * Получить активный базовый URL сигнального/relay сервера.
 */
export function getRelayApiBase(): string {
	// 1. Проверяем локальное хранилище разработчика
	try {
		const custom = localStorage.getItem(STORAGE_RELAY_KEY)
		if (custom) return custom
	} catch {
		// ignore
	}

	// 2. Проверяем локальные env переменные (.env.local не попадает в Git)
	const envUrl = (import.meta as any).env?.VITE_BEDRINGH_RELAY_URL
	if (envUrl) return envUrl

	// 3. Доменный адрес по умолчанию
	return DEFAULT_DOMAIN_RELAY
}

/**
 * Установить кастомный адрес relay-сервера (сохраняется в localStorage)
 */
export function setRelayApiBase(url: string) {
	try {
		localStorage.setItem(STORAGE_RELAY_KEY, url)
	} catch {
		// ignore
	}
}

/**
 * Формирует публичный доменный адрес туннеля для подключения в Minecraft
 */
export function formatSafeConnectAddress(port: string | number): string {
	return `bedringh.duckdns.org:${port}`
}
