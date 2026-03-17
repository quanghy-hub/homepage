/* ========== CONTEXT MENU: Add to Homepage ========== */

// Create context menu item on install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'add-to-homepage',
    title: 'Thêm vào Homepage',
    contexts: ['page', 'link']
  });
});

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
  const url = info.linkUrl || info.pageUrl || tab.url;
  const title = tab.title || extractTitle(url);

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
      chrome.action.setBadgeText({ text: '✗', tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#f85149', tabId: tab.id });
      setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 2000);
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
      // Show success badge
      chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#3fb950', tabId: tab.id });
      setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 2000);
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
// Mở trang Homepage (newtab.html) khi click vào icon trên thanh Toolbar,
// rất hữu ích cho chế độ Incognito vì Chrome chặn override newtab ở chế độ này.
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ url: "newtab.html" });
});
