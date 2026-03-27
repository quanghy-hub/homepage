/* ========== CONTEXT MENU: Add to Homepage ========== */

const HOMEPAGE_MENU_ID = 'add-to-homepage';
const HOMEPAGE_LINK_MENU_ID = 'add-link-to-homepage';

function safeBadge(tabId, text, color) {
  if (typeof tabId !== 'number') return;
  chrome.action.setBadgeText({ text, tabId }, () => void chrome.runtime.lastError);
  if (color) {
    chrome.action.setBadgeBackgroundColor({ color, tabId }, () => void chrome.runtime.lastError);
  }
}

function clearBadgeLater(tabId, delay = 2000) {
  if (typeof tabId !== 'number') return;
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '', tabId }, () => void chrome.runtime.lastError);
  }, delay);
}

function createHomepageContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: HOMEPAGE_MENU_ID,
      title: 'Thêm trang này vào Homepage',
      contexts: ['page']
    }, () => void chrome.runtime.lastError);

    chrome.contextMenus.create({
      id: HOMEPAGE_LINK_MENU_ID,
      title: 'Thêm link này vào Homepage',
      contexts: ['link']
    }, () => void chrome.runtime.lastError);
  });
}

// Create context menu item on install/update/startup
chrome.runtime.onInstalled.addListener(createHomepageContextMenu);
chrome.runtime.onStartup.addListener(createHomepageContextMenu);

// Default data (same as newtab.js) for first-time fallback
const BG_DEFAULT_GROUPS = {
  list: ['A', '☓ ', 'D', 'C', 'B', 'E'],
  pinned: ['A'],
  selected: '☓ '
};

function getTargetGroup(groups) {
  if (typeof groups.pinned === 'string') {
    groups.pinned = [groups.pinned];
  }

  if (Array.isArray(groups.pinned) && groups.pinned.length > 0) {
    return groups.pinned[0];
  }

  if (Array.isArray(groups.list) && groups.list.length > 0) {
    return groups.list[0];
  }

  return BG_DEFAULT_GROUPS.pinned[0];
}

function insertLinkAtTop(links, targetGroup, link) {
  const nextLinks = links.map(existing =>
    existing.parent === targetGroup
      ? { ...existing, order: (Number.isFinite(existing.order) ? existing.order : 0) + 1 }
      : existing
  );

  nextLinks.push({
    _id: 'links' + Math.random().toString(36).slice(2, 10),
    order: 0,
    parent: targetGroup,
    title: link.title,
    url: link.url
  });

  return nextLinks;
}

function addUrlToHomepage({ url, title, tabId }, callback = () => {}) {
  console.log('[Homepage] addUrlToHomepage called:', { url, title, tabId });

  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    console.warn('[Homepage] URL rejected:', url);
    safeBadge(tabId, '✗', '#f85149');
    clearBadgeLater(tabId);
    callback({ ok: false, reason: 'invalid-url' });
    return;
  }

  chrome.storage.local.get(['links', 'groups'], result => {
    console.log('[Homepage] storage.get result:', { linksCount: result.links?.length, hasGroups: !!result.groups });
    const links = result.links || [];
    const groups = result.groups || JSON.parse(JSON.stringify(BG_DEFAULT_GROUPS));
    const targetGroup = getTargetGroup(groups);
    console.log('[Homepage] targetGroup:', targetGroup);

    const isDuplicate = links.some(l => l.url === url && l.parent === targetGroup);
    if (isDuplicate) {
      console.warn('[Homepage] Duplicate URL:', url, 'in group:', targetGroup);
      safeBadge(tabId, '✗', '#f85149');
      clearBadgeLater(tabId);
      callback({ ok: false, reason: 'duplicate', group: targetGroup });
      return;
    }

    const nextLinks = insertLinkAtTop(links, targetGroup, {
      title: extractTitle(url, title),
      url
    });

    console.log('[Homepage] Saving', nextLinks.length, 'links...');
    chrome.storage.local.set({ links: nextLinks, groups }, () => {
      if (chrome.runtime.lastError) {
        console.error('[Homepage] Storage error:', chrome.runtime.lastError.message);
        safeBadge(tabId, '✗', '#f85149');
        clearBadgeLater(tabId);
        callback({ ok: false, reason: 'storage-error' });
        return;
      }

      console.log('[Homepage] ✓ Link saved successfully to group:', targetGroup);
      safeBadge(tabId, '✓', '#3fb950');
      clearBadgeLater(tabId);
      callback({ ok: true, group: targetGroup });
    });
  });
}

// Handle click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== HOMEPAGE_MENU_ID && info.menuItemId !== HOMEPAGE_LINK_MENU_ID) return;

  const isLinkMenu = info.menuItemId === HOMEPAGE_LINK_MENU_ID;
  let url, title;
  const tabId = tab?.id;

  if (isLinkMenu) {
    url = info.linkUrl;
    title = info.selectionText?.trim() || info.linkText?.trim() || tab?.title || '';
  } else {
    // Lấy URL trang: thử nhiều nguồn (Kiwi Android có thể thiếu info.pageUrl hoặc tab.url)
    url = info.pageUrl || tab?.url;
    title = tab?.title || '';

    // Fallback 1: chrome.tabs.get
    if (!url && typeof tabId === 'number') {
      try {
        const freshTab = await chrome.tabs.get(tabId);
        url = freshTab?.url;
        title = title || freshTab?.title || '';
      } catch (_) { /* ignore */ }
    }

    // Fallback 2: query active tab
    if (!url) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        url = activeTab?.url;
        title = title || activeTab?.title || '';
      } catch (_) { /* ignore */ }
    }
  }

  console.log('[Homepage] contextMenu clicked:', { menuItemId: info.menuItemId, url, title, pageUrl: info.pageUrl, tabUrl: tab?.url, tabId });

  if (!url) {
    console.warn('[Homepage] Không lấy được URL');
    safeBadge(tabId, '✗', '#f85149');
    clearBadgeLater(tabId);
    return;
  }

  title = title || extractTitle(url);

  addUrlToHomepage({ url, title, tabId }, result => {
    console.log('[Homepage] addUrlToHomepage result:', result);
  });
});

// Extract a clean title from URL
function extractTitle(url, fallbackTitle) {
  if (fallbackTitle && fallbackTitle.length > 0 && fallbackTitle.length < 30) {
    return fallbackTitle;
  }
  // Shorten long titles
  if (fallbackTitle && fallbackTitle.length >= 30) {
    // Use first meaningful part
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

// ========== ACTION: Click vào icon Extension ==========
// Android/Kiwi thường không có context menu extension ổn định,
// nên click icon sẽ cố thêm tab hiện tại vào Homepage trước.
// Không tự mở tab mới ở đây để tránh vòng lặp/crash trên mobile browsers.
chrome.action.onClicked.addListener(async (tab) => {
  let url = tab?.url;
  let title = tab?.title;
  const tabId = tab?.id;

  // Fallback: trên Kiwi/Android, tab.url có thể undefined
  // nếu activeTab không kích hoạt đúng qua menu trình duyệt.
  if (!url && typeof tabId === 'number') {
    try {
      const freshTab = await chrome.tabs.get(tabId);
      url = freshTab?.url;
      title = freshTab?.title || title;
    } catch (_) { /* ignore */ }
  }

  // Fallback 2: query active tab
  if (!url) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      url = activeTab?.url;
      title = activeTab?.title || title;
    } catch (_) { /* ignore */ }
  }

  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    safeBadge(tabId, '✗', '#f85149');
    clearBadgeLater(tabId);
    return;
  }

  addUrlToHomepage({ url, title, tabId }, () => {});
});
