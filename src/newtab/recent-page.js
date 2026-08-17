import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';
import { isHttpUrl } from '../shared/utils/link-utils.js';

const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Resolves the "recent page" the user was viewing before the new tab page.
 *
 * Previously this was tracked continuously by the background service worker via
 * chrome.tabs.onActivated/onUpdated. The background worker is intentionally
 * removed (Chromium browsers on Android cannot always register an extension
 * service worker), so the page now resolves the recent page at click time:
 *  1. A fresh snapshot previously stored under STORAGE_KEYS.recentPage is used.
 *  2. Otherwise fall back to the most recently accessed http(s) tab in the
 *     window, excluding the new tab page itself.
 *
 * Dependencies are injectable for tests.
 */
export async function resolveRecentPage({
  getStorage = (key) => chrome.storage.local.get(key),
  queryTabs = (info) => chrome.tabs.query(info)
} = {}) {
  try {
    const stored = await getStorage(STORAGE_KEYS.recentPage);
    const recent = stored?.[STORAGE_KEYS.recentPage];
    if (recent && isHttpUrl(recent.url) && Date.now() - (recent.updatedAt || 0) < STALE_AFTER_MS) {
      return recent;
    }

    const [activeTab] = await queryTabs({ active: true, currentWindow: true });
    const tabs = await queryTabs({ currentWindow: true });

    const best = (tabs || [])
      .filter((tab) => tab.id !== activeTab?.id && isHttpUrl(tab.url))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];

    if (best && isHttpUrl(best.url)) {
      return { url: best.url, title: best.title || '' };
    }
  } catch {
    // No background worker: this is best-effort only, never surface errors.
  }
  return null;
}
