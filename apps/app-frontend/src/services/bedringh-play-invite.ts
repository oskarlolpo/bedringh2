import { list as listInstances } from '@/helpers/instance'
import { start_join_server } from '@/helpers/worlds'
import {
	type McInvitePayload,
	sendServerInviteToTarget,
	setPendingPlayInvite,
	state as socialState,
	updatePresence,
} from './bedringh-friends'
import { formatSafeConnectAddress } from './bedringh-network-config'
import { connectClientBridge } from './bedringh-tunnel'

const STORAGE_HOSTS_KEY = 'bedringh_hosted_servers_v1'

/**
 * Проверить, есть ли у текущего игрока уже запущенный хост или активный сервер
 */
export function getMyActiveHostInvite(): McInvitePayload | null {
	try {
		const raw = localStorage.getItem(STORAGE_HOSTS_KEY)
		if (raw) {
			const parsed = JSON.parse(raw)
			if (Array.isArray(parsed) && parsed.length > 0) {
				const h = parsed[0]
				const port = h.publicPort || h.localPort || 25565
				return {
					addr: formatSafeConnectAddress(port),
					name: h.name || `Мир игрока ${h.host || ''}`.trim(),
					version: h.version || '1.21.4',
					edition: h.edition || 'java',
				}
			}
		}
	} catch {}

	const g = socialState.currentPresence.gameInfo
	if (socialState.currentPresence.status === 'in_game' && g?.serverAddress) {
		return {
			addr: g.serverAddress,
			name: g.serverName || g.instanceName || 'Сервер Minecraft',
			version: g.mcVersion,
			loader: g.loader,
			packCode: g.packCode,
		}
	}

	return null
}

/**
 * 1-клик подключение к серверу или LAN-туннелю друга (из карточки друга или из ⟪mc-invite⟫ в чате)
 */
export async function quickJoinServer(
	invite: McInvitePayload,
	notify?: (n: { title: string; text: string; type?: 'success' | 'info' | 'warning' | 'error' }) => void,
	openCloudPack?: (code: string) => void,
): Promise<boolean> {
	const address = invite.addr.trim()
	if (!address) return false

	try {
		await navigator.clipboard.writeText(address)
	} catch {}

	// Если указан код облачной сборки Bedringh (BP-XXXXXX) и нет подходящего инстанса
	const instances = await listInstances().catch(() => [])
	const installedInstances = instances.filter((i) => i.install_stage === 'installed')

	let bestInstance = installedInstances.find(
		(i) =>
			invite.version &&
			i.game_version === invite.version &&
			(!invite.loader || i.loader === invite.loader),
	)

	if (!bestInstance && invite.version) {
		bestInstance = installedInstances.find((i) => i.game_version === invite.version)
	}

	// Если точной версии нет и есть код облачной сборки — предлагаем установить сборку друга
	if (!bestInstance && invite.packCode && openCloudPack) {
		openCloudPack(invite.packCode)
		notify?.({
			title: 'Требуется сборка друга',
			text: `Адрес ${address} скопирован. Установите сборку ${invite.packCode} для входа.`,
			type: 'info',
		})
		return false
	}

	// Иначе берём последний запущенный инстанс Java
	if (!bestInstance && installedInstances.length > 0) {
		const sorted = [...installedInstances].sort((a, b) => {
			const ta = a.last_played ? new Date(a.last_played).getTime() : 0
			const tb = b.last_played ? new Date(b.last_played).getTime() : 0
			return tb - ta
		})
		bestInstance = sorted[0]
	}

	if (!bestInstance) {
		notify?.({
			title: 'Адрес сервера скопирован',
			text: `Создайте сборку версии ${invite.version || '1.21.4'} для подключения к ${address}`,
			type: 'info',
		})
		return false
	}

	try {
		const portPart = parseInt(address.split(':')[1] || '25565', 10)
		void connectClientBridge(`join-${portPart}`, portPart)
	} catch {}

	try {
		notify?.({
			title: `Запуск ${bestInstance.name}`,
			text: `Подключаемся к серверу ${invite.name} (${address})...`,
			type: 'success',
		})

		void updatePresence('in_game', {
			instanceName: bestInstance.name,
			loader: bestInstance.loader,
			mcVersion: bestInstance.game_version,
			serverAddress: address,
			serverName: invite.name,
			startedAt: Date.now(),
		})

		await start_join_server(bestInstance.path, address)
		return true
	} catch (e: any) {
		notify?.({
			title: 'Адрес скопирован',
			text: `Адрес ${address} скопирован в буфер обмена (${e?.message || 'запустите игру вручную'})`,
			type: 'warning',
		})
		return false
	}
}

/**
 * Умная кнопка «Позвать играть» (как в Millida playInvite.ts):
 * - Если у игрока уже открыт хост/туннель -> сразу отправляет карточку ⟪mc-invite⟫ в чат.
 * - Если хост ещё не открыт -> вешает плашку отложенного приглашения (InviteChip) и открывает страницу серверов.
 */
export async function triggerPlayInvite(
	target: { type: 'dm' | 'room'; id: string; title: string },
	options: {
		navigateToServers?: () => void
		openChat?: (target: { type: 'dm' | 'room'; id: string }) => void
		notify?: (n: { title: string; text: string; type?: 'success' | 'info' | 'warning' | 'error' }) => void
	} = {},
): Promise<'sent_immediately' | 'queued_pending'> {
	const activeInvite = getMyActiveHostInvite()
	if (activeInvite) {
		await sendServerInviteToTarget({ type: target.type, id: target.id }, activeInvite)
		options.notify?.({
			title: 'Приглашение отправлено!',
			text: `${target.title} получил карточку входа на ${activeInvite.name}`,
			type: 'success',
		})
		options.openChat?.({ type: target.type, id: target.id })
		return 'sent_immediately'
	}

	setPendingPlayInvite({
		type: target.type,
		id: target.id,
		title: target.title,
		createdAt: Date.now(),
	})

	options.notify?.({
		title: `Позовём ${target.title}`,
		text: 'Откройте мир для сети или создайте хост — приглашение отправится автоматически!',
		type: 'info',
	})

	options.navigateToServers?.()
	return 'queued_pending'
}
