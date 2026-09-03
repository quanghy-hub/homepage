/**
 * Generates a collision-resistant id. Prefers the Web Crypto UUID and falls
 * back to a timestamp + random suffix where crypto.randomUUID is unavailable.
 */
export function createId(prefix = '') {
  const scoped =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}-${scoped}` : scoped;
}
