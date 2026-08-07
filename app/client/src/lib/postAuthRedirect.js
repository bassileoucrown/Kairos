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
