import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

function isExternalHttpUrl(url: string): boolean {
	return /^https?:\/\//i.test(url);
}

/**
 * Canvas cannot safely read a cross-origin image unless its server sends CORS
 * headers. Fetch through Tauri's HTTP plugin and use a local object URL so a
 * texture can be copied into a canvas for frame animation.
 */
export async function fetchExternalImageObjectUrl(url: string): Promise<string> {
	if (!isExternalHttpUrl(url)) return url;

	const response = await tauriFetch(url);
	if (!response.ok) {
		throw new Error(`Could not fetch image: ${response.status} ${response.statusText}`);
	}

	return URL.createObjectURL(await response.blob());
}

export async function fetchExternalJson<T>(url: string): Promise<T> {
	if (!isExternalHttpUrl(url)) {
		throw new Error(`fetchExternalJson requires an HTTP URL: ${url}`);
	}

	const response = await tauriFetch(url);
	if (!response.ok) {
		throw new Error(`Could not fetch JSON: ${response.status} ${response.statusText}`);
	}

	return response.json();
}
