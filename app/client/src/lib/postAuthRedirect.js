const KEY = 'kairos_post_onboarding_redirect';

export function stashPostOnboardingRedirect(path) {
  if (!path) return;
  try { localStorage.setItem(KEY, path); } catch { /* ignore */ }
}

export function consumePostOnboardingRedirect() {
  try {
    const path = localStorage.getItem(KEY);
    if (path) localStorage.removeItem(KEY);
    return path;
  } catch {
    return null;
  }
}

// Non-destructive read — used by onboarding screens that want to react to
// the stashed destination (e.g. show invite context) without clearing it,
// since Dashboard's mount effect is what actually consumes it later.
export function peekPostOnboardingRedirect() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
