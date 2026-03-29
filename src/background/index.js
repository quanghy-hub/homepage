const RECENT_PAGE_KEY = 'recentPage';

function isTrackableUrl(url) {
  return !!url && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://');
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
  chrome.storage.local.set({
    [RECENT_PAGE_KEY]: {
      url: tab.url,
      title: tab.title || extractTitle(tab.url),
      updatedAt: Date.now()
    }
  }, () => void chrome.runtime.lastError);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    rememberRecentPage(tab);
  } catch (_) {
    // ignore
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    rememberRecentPage(tab);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'fetch-favicon' || !message.url) return;

  (async () => {
    try {
      const res = await fetch(message.url, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const dataUrl = await blobToDataUrl(blob);
      sendResponse({ ok: true, dataUrl });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true;
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/newtab/index.html') });
});
