import type { AbstractWebNotificationManager } from '@modrinth/ui'
import { provideInstanceImport } from '@modrinth/ui'
import { open } from '@tauri-apps/plugin-dialog'

import {
	detect_external_instances,
	get_default_launcher_path,
	get_importable_instances,
	import_external_launcher_instance,
	import_instance,
} from '@/helpers/import.js'

export function setupInstanceImportProvider(notificationManager: AbstractWebNotificationManager) {
	const { handleError } = notificationManager

	provideInstanceImport({
		async getDetectedLaunchers() {
			const launcherNames = ['MultiMC', 'GDLauncher', 'ATLauncher', 'Curseforge', 'PrismLauncher']
			const launchers: Array<{ name: string; path: string; instances: string[] }> = []
			for (const name of launcherNames) {
				try {
					const path = await get_default_launcher_path(name)
					if (!path) continue
					const instances = await get_importable_instances(name, path)
					if (instances?.length > 0) {
						launchers.push({ name, path, instances })
					}
				} catch {
					// Skip launchers that fail detection
				}
			}

			try {
				const ext = (await detect_external_instances()) as Array<any>
				for (const item of ext) {
					let l = launchers.find((x) => x.name.toLowerCase() === item.launcher_name.toLowerCase())
					if (!l) {
						l = { name: item.launcher_name, path: item.root_path, instances: [] }
						launchers.push(l)
					}
					if (!l.instances.includes(item.original_name)) {
						l.instances.push(item.original_name)
					}
				}
			} catch {
				// Ignore
			}

			return launchers
		},
		async getImportableInstances(launcherName: string, path: string) {
			return (await get_importable_instances(launcherName, path)) ?? []
		},
		async importInstances(selections) {
			for (const sel of selections) {
				for (const instanceName of sel.instanceNames) {
					if (
						sel.launcher.toLowerCase().includes('legacy') ||
						sel.launcher.toLowerCase().includes('tlauncher')
					) {
						const ext = ((await detect_external_instances().catch(() => [])) as Array<any>) || []
						const found = ext.find((x: any) => x.original_name === instanceName)
						if (found) {
							await import_external_launcher_instance(found).catch(handleError)
							continue
						}
					}
					await import_instance(sel.launcher, sel.path, instanceName).catch(handleError)
				}
			}
		},
		async selectDirectory() {
			const result = await open({ multiple: false, directory: true })
			return result?.toString() ?? null
		},
	})
}

