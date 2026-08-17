/**
 * Extension background service worker.
 *
 * This worker is intentionally a self-contained CLASSIC script (no `import`
 * statements and no `"type": "module"` in manifest.json). Module-type extension
 * service workers are not reliably registrable on Chromium browsers for
 * Android, which surfaces as a generic "Service worker registration failed".
 *
 * Every `chrome.*` namespace is guarded before use so a missing API on a given
 * platform (e.g. Android) can never throw during top-level evaluation, which
 * would also prevent the worker from registering.
 */
'use strict';

const RECENT_PAGE_KEY = 'recentPage';

function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isTrackableUrl(url) {
  return isHttpUrl(url);
}

function extractTitle(url, fallbackTitle) {
  if (fallbackTitle && fallbackTitle.length > 0 && fallbackTitle.length < 30) {
    return fallbackTitle;
  }
  if (fallbackTitle && fallbackTitle.length >= 30) {
    const short = fallbackTitle.split(/[|\-–—]/)[0].trim();
    if (short.length > 0 && short.length <= 25) return short;
    return fallbackTitle.substring(0, 25).trim();
  }
  try {
    const u = new URL(url);
    const parts = u.hostname.replace(/^(www\.|m\.)/, '').split('.');
    const name = parts.length > 1 ? parts[parts.length - 2] : parts[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return 'Link';
  }
}

function rememberRecentPage(tab) {
  if (!tab || !isTrackableUrl(tab.url)) return;
  const storageArea = typeof chrome !== 'undefined' && chrome.storage?.local;
  if (!storageArea?.set) return;
  storageArea.set(
    {
      [RECENT_PAGE_KEY]: {
        url: tab.url,
        title: tab.title || extractTitle(tab.url),
        updatedAt: Date.now()
      }
    },
    () => void chrome?.runtime?.lastError
  );
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/* Resolve API namespaces safely (may be partially unavailable on Android). */
const root = typeof chrome !== 'undefined' ? chrome : {};
const runtime = root.runtime || {};
const tabs = root.tabs || {};
const action = root.action || {};

if (tabs.onActivated?.addListener) {
  tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await tabs.get(tabId);
      rememberRecentPage(tab);
    } catch (_) {
      // The tab may already be closed; nothing to remember.
    }
  });
}

if (tabs.onUpdated?.addListener) {
  tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
      rememberRecentPage(tab);
    }
  });
}

if (runtime.onMessage?.addListener) {
  runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'fetch-favicon' || (!message.url && !Array.isArray(message.urls))) return;

    (async () => {
      try {
        const urls = Array.isArray(message.urls) ? message.urls : [message.url];
        let lastError = null;

        for (const url of urls.filter(Boolean)) {
          if (!isHttpUrl(url)) continue;
          try {
            const res = await fetch(url, {
              cache: 'force-cache',
              headers: {
                Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'User-Agent': navigator.userAgent
              }
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const dataUrl = await blobToDataUrl(blob);
            sendResponse({ ok: true, dataUrl, sourceUrl: url });
            return;
          } catch (err) {
            lastError = err;
          }
        }

        throw lastError || new Error('No favicon candidates');
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();

    return true;
  });
}

if (action.onClicked?.addListener && tabs.create && runtime.getURL) {
  action.onClicked.addListener(() => {
    tabs.create({ url: runtime.getURL('src/newtab/index.html') });
  });
}
