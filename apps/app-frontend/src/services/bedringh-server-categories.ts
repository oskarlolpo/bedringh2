import {
	HeartIcon,
	ShieldIcon,
	PaletteIcon,
	SparklesIcon,
	WrenchIcon,
	StarIcon,
	SkullIcon,
} from '@modrinth/assets'
import type { Component } from 'vue'

export type Edition = 'java' | 'bedrock'

export interface ServerCategory {
	id: string
	name: string
	icon: Component
}

export const SERVER_CATEGORIES: ServerCategory[] = [
	{ id: 'survival', name: 'Выживание', icon: HeartIcon },
	{ id: 'pvp', name: 'ПВП / Анархия', icon: ShieldIcon },
	{ id: 'creative', name: 'Креатив', icon: PaletteIcon },
	{ id: 'minigames', name: 'Мини-игры', icon: SparklesIcon },
	{ id: 'modded', name: 'С модами', icon: WrenchIcon },
	{ id: 'vanilla', name: 'Ванилла / РП', icon: StarIcon },
	{ id: 'hardcore', name: 'Хардкор', icon: SkullIcon },
]

export const CATEGORY_ICONS: Record<string, Component> = {
	survival: HeartIcon,
	pvp: ShieldIcon,
	creative: PaletteIcon,
	minigames: SparklesIcon,
	modded: WrenchIcon,
	vanilla: StarIcon,
	hardcore: SkullIcon,
}
