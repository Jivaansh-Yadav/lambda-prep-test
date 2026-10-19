/**
 * Returns a stable, per-browser anonymous voter id used to let a student
 * rate a resource file (and later see/update their own rating) without any
 * sign-in system in this app. Generated once with crypto.randomUUID() and
 * persisted in localStorage; a fresh id is minted if storage is unavailable
 * (private browsing, SSR) or empty.
 */
const STORAGE_KEY = 'lambda.voterId';

export function getVoterId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const next = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, next);
    return next;
  } catch {
    // localStorage unavailable (private mode, disabled storage) — fall
    // back to a per-mount id; ratings just won't persist across reloads.
    return crypto.randomUUID();
  }
}
