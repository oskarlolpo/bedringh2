// Ads are disabled in Bedringh — all functions are stubbed out.
export async function init_ads_window(overrideShown = false) {
	return null
}

export async function show_ads_window() {
	return null
}

export async function hide_ads_window(reset) {
	return null
}

export async function should_show_ads_consent_popup() {
	return false
}

export async function perform_ads_consent_action(action) {
	return null
}

export async function open_ads_consent_preferences() {
	return null
}

export async function ads_consent_listener(callback) {
	return () => { }
}

export async function record_ads_click() {
	return null
}

export async function open_ads_link(path, origin) {
	return null
}
