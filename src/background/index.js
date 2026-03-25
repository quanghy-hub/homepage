/* ========== CONTEXT MENU: Add to Homepage ========== */

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
      id: 'add-to-homepage',
      title: 'Thêm vào Homepage',
      contexts: ['page', 'link']
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

// Handle click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'add-to-homepage') return;

  // Determine URL and title
  const url = info.linkUrl || info.pageUrl || tab?.url;
  if (!url) {
    safeBadge(tab?.id, '✗', '#f85149');
    clearBadgeLater(tab?.id);
    return;
  }

  const title = info.selectionText?.trim() || tab?.title || extractTitle(url);

  chrome.storage.local.get(['links', 'groups'], result => {
    const links = result.links || [];
    const groups = result.groups || JSON.parse(JSON.stringify(BG_DEFAULT_GROUPS));

    // Migrate pinned from string to array if needed
    if (typeof groups.pinned === 'string') {
      groups.pinned = [groups.pinned];
    }

    // Target: first pinned group
    const targetGroup = (groups.pinned && groups.pinned.length > 0)
      ? groups.pinned[0]
      : groups.list[0];

    // Check for duplicate URL in same group
    const isDuplicate = links.some(l => l.url === url && l.parent === targetGroup);
    if (isDuplicate) {
      safeBadge(tab?.id, '✗', '#f85149');
      clearBadgeLater(tab?.id);
      return;
    }

    // Count existing links in target group for order
    const groupLinks = links.filter(l => l.parent === targetGroup);
    const newId = 'links' + Math.random().toString(36).slice(2, 10);

    links.push({
      _id: newId,
      order: groupLinks.length,
      parent: targetGroup,
      title: extractTitle(url, title),
      url: url
    });

    chrome.storage.local.set({ links }, () => {
      if (chrome.runtime.lastError) {
        safeBadge(tab?.id, '✗', '#f85149');
        clearBadgeLater(tab?.id);
        return;
      }

      // Show success badge
      safeBadge(tab?.id, '✓', '#3fb950');
      clearBadgeLater(tab?.id);
    });
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
// Mobile thường không hỗ trợ context menu của extension,
// nên click icon sẽ thêm luôn tab hiện tại vào Homepage.
chrome.action.onClicked.addListener((tab) => {
  const url = tab?.url;
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    chrome.tabs.create({ url: 'src/newtab/index.html' });
    return;
  }

  chrome.storage.local.get(['links', 'groups'], result => {
    const links = result.links || [];
    const groups = result.groups || JSON.parse(JSON.stringify(BG_DEFAULT_GROUPS));

    if (typeof groups.pinned === 'string') {
      groups.pinned = [groups.pinned];
    }

    const targetGroup = (groups.pinned && groups.pinned.length > 0)
      ? groups.pinned[0]
      : groups.list[0];

    const isDuplicate = links.some(l => l.url === url && l.parent === targetGroup);
    if (isDuplicate) {
      safeBadge(tab.id, '✗', '#f85149');
      clearBadgeLater(tab.id);
      return;
    }

    const groupLinks = links.filter(l => l.parent === targetGroup);
    links.push({
      _id: 'links' + Math.random().toString(36).slice(2, 10),
      order: groupLinks.length,
      parent: targetGroup,
      title: extractTitle(url, tab.title),
      url
    });

    chrome.storage.local.set({ links }, () => {
      if (chrome.runtime.lastError) {
        safeBadge(tab.id, '✗', '#f85149');
        clearBadgeLater(tab.id);
        return;
      }
      safeBadge(tab.id, '✓', '#3fb950');
      clearBadgeLater(tab.id);
    });
  });
});
