// Deliberately fail closed. A layout preview is not approval or a consent manager.
export function adEligible({approved = false, reviewed = false, consentReady = false, contentType, hasContent = false, loading = false, error = false, overlay = false, background = false}) {
  return approved && reviewed && consentReady && contentType === 'editorial' && hasContent && !loading && !error && !overlay && !background
}

export function localAdPreview(enabled, siteUrl) {
  return enabled === '1' && (!siteUrl || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(siteUrl))
}
