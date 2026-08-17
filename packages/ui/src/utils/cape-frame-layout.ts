export interface CapeFrameLayout {
	frameWidth: number;
	frameHeight: number;
	frameCount: number;
}

/**
 * Resolves the KLauncher/Minecraft cape-sheet format without assuming a fixed
 * pixel resolution. A source is valid when every vertical position is a full
 * 2:1 cape atlas: W × (N × W/2). Static capes have `frameCount === 1`.
 */
export function getCapeFrameLayout(width: number, height: number): CapeFrameLayout | null {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 2 ||
		height < 1 ||
		width % 2 !== 0
	) {
		return null;
	}

	const frameHeight = width / 2;
	if (height < frameHeight || height % frameHeight !== 0) return null;

	return {
		frameWidth: width,
		frameHeight,
		frameCount: height / frameHeight,
	};
}
