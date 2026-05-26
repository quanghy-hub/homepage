import { autoTitle, getFavicon, getHostname } from '../shared/utils/link-utils.js';

export const FAVICON_CACHE_TTL = 1000 * 60 * 60 * 24 * 14;

export function createHomeRenderer({
  dom,
  getFaviconCache,
  getGroups,
  getLinksForGroup,
  getSelectedGroup,
  getSettings,
  isEditMode,
  persistFaviconCache,
  queueIdleTask
}) {
  const faviconPending = new Map();

  function applySettings() {
    const settings = getSettings();
    const sz = settings.iconSize || 56;
    const cell = sz + 20;
    document.documentElement.style.setProperty('--icon-size', sz + 'px');
    document.documentElement.style.setProperty('--icon-cell', cell + 'px');
  }

  function getCachedFavicon(url) {
    const hostname = getHostname(url);
    if (!hostname) return '';

    const entry = getFaviconCache()[hostname];
    if (!entry?.dataUrl) return '';

    return entry.dataUrl;
  }

  function isFaviconExpired(url) {
    const hostname = getHostname(url);
    if (!hostname) return true;
    const entry = getFaviconCache()[hostname];
    if (!entry?.dataUrl) return true;
    return Date.now() - (entry.updatedAt || 0) > FAVICON_CACHE_TTL;
  }

  async function ensureFaviconCached(url, img) {
    const hostname = getHostname(url);
    const faviconUrl = getFavicon(url);
    if (!hostname || !faviconUrl) return;
    if (faviconPending.has(hostname)) return;

    const pending = new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'fetch-favicon', url: faviconUrl }, async response => {
        if (chrome.runtime.lastError || !response?.ok || !response.dataUrl) {
          resolve();
          return;
        }

        const dataUrl = response.dataUrl;
        getFaviconCache()[hostname] = {
          dataUrl,
          updatedAt: Date.now()
        };
        persistFaviconCache();
        const relatedImgs = document.querySelectorAll(`img[data-hostname="${hostname}"]`);
        relatedImgs.forEach(node => {
          if (!node.isConnected) return;
          node.src = dataUrl;
          const item = node.closest('.link-item');
          const wrap = node.closest('.icon-wrap');
          item?.classList.remove('fallback-ready');
          if (wrap) {
            wrap.textContent = '';
            wrap.appendChild(node);
          }
        });
        if (img?.isConnected && !relatedImgs.length) {
          img.src = dataUrl;
        }
        resolve();
      });
    }).finally(() => {
      faviconPending.delete(hostname);
    });

    faviconPending.set(hostname, pending);
  }

  function createLinkEl(link) {
    const el = document.createElement('a');
    el.className = 'link-item';
    el.href = link.url;
    el.dataset.id = link._id;
    el.dataset.parent = link.parent;
    el.draggable = isEditMode();
    el.title = link.title || link.url;

    const iconWrap = document.createElement('div');
    iconWrap.className = 'icon-wrap';

    const img = document.createElement('img');
    const hostname = getHostname(link.url);
    const cachedFavicon = getCachedFavicon(link.url);
    img.dataset.hostname = hostname;
    img.alt = '';
    img.loading = 'eager';
    img.decoding = 'async';
    img.onerror = () => {
      img.style.display = 'none';
      iconWrap.textContent = (link.title || '?')[0].toUpperCase();
      el.classList.add('fallback-ready');
    };
    if (cachedFavicon) {
      img.src = cachedFavicon;
      iconWrap.appendChild(img);
    } else {
      iconWrap.textContent = (link.title || '?')[0].toUpperCase();
      el.classList.add('fallback-ready');
    }
    if (!cachedFavicon || isFaviconExpired(link.url)) {
      queueIdleTask(() => ensureFaviconCached(link.url, img));
    }

    const label = document.createElement('span');
    label.className = 'icon-label';
    label.textContent = link.title || autoTitle(link.url);

    const editBadge = document.createElement('span');
    editBadge.className = 'link-edit-badge';
    editBadge.textContent = 'X';

    el.appendChild(iconWrap);
    el.appendChild(label);
    el.appendChild(editBadge);

    return el;
  }

  function render() {
    const groups = getGroups();
    const selectedGroup = getSelectedGroup();
    applySettings();

    dom.pinnedGrid.innerHTML = '';
    groups.pinned.forEach(groupName => {
      const groupLinks = getLinksForGroup(groupName);
      if (groupLinks.length === 0 && groupName !== groups.pinned[0]) return;

      const grid = document.createElement('div');
      grid.className = 'links-grid';
      grid.dataset.group = groupName;
      groupLinks.forEach(link => {
        grid.appendChild(createLinkEl(link));
      });

      const header = document.createElement('div');
      header.className = 'pinned-group-header';
      header.textContent = groupName;
      header.dataset.groupName = groupName;
      header.classList.add('group-context-target');

      dom.pinnedGrid.appendChild(grid);

      if (groupName === groups.pinned[0]) {
        const firstPinnedRow = document.createElement('div');
        firstPinnedRow.className = 'pinned-group-row';
        firstPinnedRow.appendChild(header);
        firstPinnedRow.appendChild(dom.quickActions);
        dom.pinnedGrid.appendChild(firstPinnedRow);
      } else {
        dom.pinnedGrid.appendChild(header);
      }
    });

    dom.groupTabs.innerHTML = '';
    groups.list.filter(groupName => !groups.pinned.includes(groupName)).forEach(groupName => {
      const tab = document.createElement('button');
      tab.className = 'tab' + (groupName === selectedGroup ? ' active' : '');
      tab.textContent = groupName;
      tab.dataset.groupName = groupName;
      tab.classList.add('group-context-target');
      dom.groupTabs.appendChild(tab);
    });

    if (isEditMode()) {
      const addTab = document.createElement('button');
      addTab.className = 'tab tab-add-group';
      addTab.type = 'button';
      addTab.textContent = '+';
      addTab.dataset.action = 'add-group';
      dom.groupTabs.appendChild(addTab);
    }

    dom.selectedGrid.innerHTML = '';
    dom.selectedGrid.dataset.group = selectedGroup || '';
    getLinksForGroup(selectedGroup).forEach(link => {
      dom.selectedGrid.appendChild(createLinkEl(link));
    });
  }

  return {
    applySettings,
    render
  };
}
