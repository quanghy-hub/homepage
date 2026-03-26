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

function addUrlToHomepage({ url, title, tabId }, callback = () => {}) {
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    safeBadge(tabId, '✗', '#f85149');
    clearBadgeLater(tabId);
    callback({ ok: false, reason: 'invalid-url' });
    return;
  }

  chrome.storage.local.get(['links', 'groups'], result => {
    const links = result.links || [];
    const groups = result.groups || JSON.parse(JSON.stringify(BG_DEFAULT_GROUPS));
    const targetGroup = getTargetGroup(groups);

    const isDuplicate = links.some(l => l.url === url && l.parent === targetGroup);
    if (isDuplicate) {
      safeBadge(tabId, '✗', '#f85149');
      clearBadgeLater(tabId);
      callback({ ok: false, reason: 'duplicate', group: targetGroup });
      return;
    }

    const groupLinks = links.filter(l => l.parent === targetGroup);
    links.push({
      _id: 'links' + Math.random().toString(36).slice(2, 10),
      order: groupLinks.length,
      parent: targetGroup,
      title: extractTitle(url, title),
      url
    });

    chrome.storage.local.set({ links }, () => {
      if (chrome.runtime.lastError) {
        safeBadge(tabId, '✗', '#f85149');
        clearBadgeLater(tabId);
        callback({ ok: false, reason: 'storage-error' });
        return;
      }

      safeBadge(tabId, '✓', '#3fb950');
      clearBadgeLater(tabId);
      callback({ ok: true, group: targetGroup });
    });
  });
}

// Handle click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== HOMEPAGE_MENU_ID && info.menuItemId !== HOMEPAGE_LINK_MENU_ID) return;

  const isLinkMenu = info.menuItemId === HOMEPAGE_LINK_MENU_ID;
  const url = isLinkMenu ? info.linkUrl : (info.pageUrl || tab?.url);
  const title = isLinkMenu
    ? (info.selectionText?.trim() || info.linkText?.trim() || tab?.title || extractTitle(url))
    : (tab?.title || extractTitle(url));

  addUrlToHomepage({
    url,
    title,
    tabId: tab?.id
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
// Nếu trang hiện tại không thêm được thì fallback mở Homepage/new tab.
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
    chrome.tabs.create({ url: 'src/newtab/index.html' });
    return;
  }

  addUrlToHomepage({ url, title, tabId }, result => {
    if (!result?.ok) {
      chrome.tabs.create({ url: 'src/newtab/index.html' });
    }
  });
});
