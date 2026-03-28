import { DEFAULT_SETTINGS } from '../shared/constants/home-defaults.js';
import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';
import { getFavicon, getHostname, autoTitle } from '../shared/utils/link-utils.js';
import { getDomRefs } from './dom.js';
import { loadAppData, saveAppData } from './storage.js';
import { bindContextMenu } from './context-menu.js';
import {
  setSyncStatus as updateSyncStatus,
  setVerifyStatus as updateVerifyStatus,
  getGistHeaders,
  bindGistCredentialInputs,
  loadSavedGistCredentials,
  buildExportData
} from './gist-sync.js';

(() => {
  'use strict';

  /* ========== STATE ========== */
  let links = [];
  let groups = {};
  let settings = {};
  let selectedGroup = '';
  let faviconCache = {};
  let editingLinkId = null;
  let editingGroupName = null; // group name being renamed
  let contextLinkId = null; // link right-clicked on (null if clicked on empty area)
  let contextGroup = null;  // which group area was right-clicked
  let contextMenuMode = 'general';
  let modalMode = null; // 'add-link', 'edit-link', 'add-group'

  /* ========== DOM REFS ========== */
  const dom = getDomRefs();
  const {
    addCurrentBtn,
    quickActionStatus,
    pinnedGrid,
    groupTabs,
    selectedGrid,
    settingsBtn,
    contextMenu,
    modalOverlay,
    modalTitle,
    modalBodyLink,
    modalBodyGroup,
    inputUrl,
    inputName,
    inputGroup,
    inputGroupName,
    modalCancel,
    modalSave,
    settingsOverlay,
    settingIconSize,
    settingIconSizeVal,
    cleanupFaviconsBtn,
    settingsClose,
    gistTokenInput,
    verifyGistTokenBtn,
    gistVerifyStatus,
    syncPush,
    syncPull,
    syncStatus
  } = dom;
  const FAVICON_CACHE_TTL = 1000 * 60 * 60 * 24 * 14;
  const faviconPending = new Map();

  /* ========== STORAGE HELPERS ========== */
  function loadData() {
    const state = { links, groups, settings, selectedGroup };
    return loadAppData(state).then(() => {
      links = state.links;
      groups = state.groups;
      settings = state.settings;
      selectedGroup = state.selectedGroup;
    });
  }

  function loadFaviconCache() {
    return new Promise(resolve => {
      chrome.storage.local.get([STORAGE_KEYS.faviconCache], result => {
        faviconCache = result[STORAGE_KEYS.faviconCache] || {};
        resolve();
      });
    });
  }

  function saveData() {
    saveAppData({ links, groups, settings });
  }

  function persistFaviconCache() {
    chrome.storage.local.set({
      [STORAGE_KEYS.faviconCache]: faviconCache
    });
  }

  /* ========== CSS VARS ========== */
  function applySettings() {
    const sz = settings.iconSize || 56;
    const cell = sz + 20;
    document.documentElement.style.setProperty('--icon-size', sz + 'px');
    document.documentElement.style.setProperty('--icon-cell', cell + 'px');
  }

  /* ========== RENDERING ========== */
  function getLinksForGroup(groupName) {
    return links
      .filter(l => l.parent === groupName)
      .sort((a, b) => a.order - b.order);
  }

  function setQuickActionStatus(message, type = '') {
    if (!quickActionStatus) return;
    quickActionStatus.textContent = message;
    quickActionStatus.className = 'quick-action-status' + (type ? ` ${type}` : '');
  }

  function fillAddLinkModal(url = '', title = '', group = selectedGroup) {
    openModal('add-link', null, group);
    inputUrl.value = url;
    inputName.value = title || (url ? autoTitle(url) : '');
    inputGroup.value = group;
    inputUrl.focus();
  }

  function isNormalUrl(url) {
    return !!url && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://');
  }

  function getCachedFavicon(url) {
    const hostname = getHostname(url);
    if (!hostname) return '';

    const entry = faviconCache[hostname];
    if (!entry?.dataUrl) return '';

    return entry.dataUrl;
  }

  function isFaviconExpired(url) {
    const hostname = getHostname(url);
    if (!hostname) return true;
    const entry = faviconCache[hostname];
    if (!entry?.dataUrl) return true;
    return Date.now() - (entry.updatedAt || 0) > FAVICON_CACHE_TTL;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function ensureFaviconCached(url, img) {
    const hostname = getHostname(url);
    const faviconUrl = getFavicon(url);
    if (!hostname || !faviconUrl) return;
    if (faviconPending.has(hostname)) return;

    const pending = fetch(faviconUrl, { cache: 'force-cache' })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const dataUrl = await blobToDataUrl(blob);
        faviconCache[hostname] = {
          dataUrl,
          updatedAt: Date.now()
        };
        persistFaviconCache();
        if (img?.isConnected) {
          img.src = dataUrl;
        }
      })
      .catch(() => {})
      .finally(() => {
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
    el.draggable = true;
    el.title = link.title || link.url;

    const iconWrap = document.createElement('div');
    iconWrap.className = 'icon-wrap';

    const img = document.createElement('img');
    const cachedFavicon = getCachedFavicon(link.url);
    img.src = cachedFavicon || getFavicon(link.url);
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => {
      img.style.display = 'none';
      iconWrap.textContent = (link.title || '?')[0].toUpperCase();
      iconWrap.style.fontSize = '18px';
      iconWrap.style.fontWeight = '700';
      iconWrap.style.color = '#58a6ff';
    };
    iconWrap.appendChild(img);
    if (!cachedFavicon || isFaviconExpired(link.url)) {
      ensureFaviconCached(link.url, img);
    }

    const label = document.createElement('span');
    label.className = 'icon-label';
    label.textContent = link.title || autoTitle(link.url);

    el.appendChild(iconWrap);
    el.appendChild(label);

    // Click navigates (prevent if dragging)
    el.addEventListener('click', e => {
      if (el.classList.contains('dragging')) { e.preventDefault(); }
    });

    // Context menu
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.pageX, e.pageY, link._id, link.parent);
    });

    // Drag events – only within same group
    el.addEventListener('dragstart', e => {
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', link._id);
      e.dataTransfer.setData('application/group', link.parent);
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(d => d.classList.remove('drag-over'));
    });

    el.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const draggedParent = document.querySelector('.link-item.dragging');
      if (draggedParent && draggedParent.dataset.id !== link._id) {
        el.classList.add('drag-over');
      }
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });

    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === link._id) return;
      reorderLink(draggedId, link._id, link.parent);
    });

    // Touch drag
    setupTouchDrag(el, link);

    return el;
  }

  /* ========== TOUCH DRAG ========== */
  function setupTouchDrag(el, link) {
    let touchTimeout = null;
    let isDragging = false;
    let clone = null;
    let startX, startY;

    el.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      touchTimeout = setTimeout(() => {
        isDragging = true;
        e.preventDefault();
        el.classList.add('dragging');

        clone = el.cloneNode(true);
        clone.style.position = 'fixed';
        clone.style.pointerEvents = 'none';
        clone.style.zIndex = '500';
        clone.style.opacity = '0.8';
        clone.style.transform = 'scale(1.1)';
        clone.style.transition = 'none';
        const rect = el.getBoundingClientRect();
        clone.style.left = rect.left + 'px';
        clone.style.top = rect.top + 'px';
        clone.style.width = rect.width + 'px';
        document.body.appendChild(clone);
      }, 400);
    }, { passive: false });

    el.addEventListener('touchmove', e => {
      if (!isDragging) {
        const dx = Math.abs(e.touches[0].clientX - startX);
        const dy = Math.abs(e.touches[0].clientY - startY);
        if (dx > 10 || dy > 10) clearTimeout(touchTimeout);
        return;
      }
      e.preventDefault();
      const touch = e.touches[0];
      if (clone) {
        const offset = (settings.iconSize || 56) / 2;
        clone.style.left = (touch.clientX - offset) + 'px';
        clone.style.top = (touch.clientY - offset) + 'px';
      }

      if (clone) clone.style.display = 'none';
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      if (clone) clone.style.display = '';
      document.querySelectorAll('.drag-over').forEach(d => d.classList.remove('drag-over'));
      if (target) {
        const targetItem = target.closest('.link-item');
        if (targetItem && targetItem.dataset.id !== link._id) {
          targetItem.classList.add('drag-over');
        }
      }
    }, { passive: false });

    el.addEventListener('touchend', e => {
      clearTimeout(touchTimeout);
      if (!isDragging) return;
      isDragging = false;

      if (clone) {
        const touch = e.changedTouches[0];
        clone.style.display = 'none';
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        document.body.removeChild(clone);
        clone = null;

        if (target) {
          const targetItem = target.closest('.link-item');
          if (targetItem && targetItem.dataset.id !== link._id) {
            reorderLink(link._id, targetItem.dataset.id, targetItem.dataset.parent);
          } else {
            // Check if dropped directly on a grid
            const grid = target.closest('.links-grid');
            if (grid && grid.dataset.group) {
              const dragged = links.find(l => l._id === link._id);
              if (dragged) {
                dragged.parent = grid.dataset.group;
                dragged.order = getLinksForGroup(grid.dataset.group).length;
                saveData();
                render();
              }
            }
          }
        }
      }

      el.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(d => d.classList.remove('drag-over'));
      e.preventDefault();
    });

    el.addEventListener('touchcancel', () => {
      clearTimeout(touchTimeout);
      isDragging = false;
      if (clone) { document.body.removeChild(clone); clone = null; }
      el.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(d => d.classList.remove('drag-over'));
    });
  }

  /* ========== REORDER (can change group) ========== */
  function reorderLink(draggedId, targetId, targetGroup) {
    const dragged = links.find(l => l._id === draggedId);
    const target = links.find(l => l._id === targetId);
    if (!dragged || !target) return;

    // Move dragged to target group
    dragged.parent = targetGroup || target.parent;

    const groupLinks = getLinksForGroup(dragged.parent);
    const filtered = groupLinks.filter(l => l._id !== draggedId);
    const targetIdx = filtered.findIndex(l => l._id === targetId);

    if (targetIdx !== -1) {
      filtered.splice(targetIdx, 0, dragged);
    } else {
      filtered.push(dragged);
    }

    filtered.forEach((l, i) => l.order = i);

    saveData();
    render();
  }

  /* ========== RENDER ========== */
  function render() {
    applySettings();

    // Pinned groups
    pinnedGrid.innerHTML = '';
    groups.pinned.forEach(groupName => {
      const groupLinks = getLinksForGroup(groupName);
      if (groupLinks.length === 0 && groupName !== groups.pinned[0]) return;

      const grid = document.createElement('div');
      grid.className = 'links-grid';
      grid.dataset.group = groupName;
      groupLinks.forEach(l => {
        grid.appendChild(createLinkEl(l));
      });

      const header = document.createElement('div');
      header.className = 'pinned-group-header';
      header.textContent = groupName;
      header.dataset.groupName = groupName;
      header.classList.add('group-context-target');

      // Drop zone for empty grid or general grid area
      grid.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      grid.addEventListener('drop', e => {
        if (e.target !== grid) return;
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId) return;
        const dragged = links.find(l => l._id === draggedId);
        if (dragged) {
          dragged.parent = groupName;
          dragged.order = getLinksForGroup(groupName).length;
          saveData();
          render();
        }
      });

      pinnedGrid.appendChild(grid);

      if (groupName === groups.pinned[0]) {
        const firstPinnedRow = document.createElement('div');
        firstPinnedRow.className = 'pinned-group-row';
        firstPinnedRow.appendChild(header);
        firstPinnedRow.appendChild(dom.quickActions);
        pinnedGrid.appendChild(firstPinnedRow);
      } else {
        pinnedGrid.appendChild(header);
      }
    });

    // Group tabs (below icons)
    groupTabs.innerHTML = '';
    groups.list.filter(g => !groups.pinned.includes(g)).forEach(g => {
      const tab = document.createElement('button');
      tab.className = 'tab' + (g === selectedGroup ? ' active' : '');
      tab.textContent = g;
      tab.dataset.groupName = g;
      tab.classList.add('group-context-target');
      tab.addEventListener('click', () => {
        selectedGroup = g;
        groups.selected = g;
        saveData();
        render();
      });
      groupTabs.appendChild(tab);
    });

    // Selected group
    selectedGrid.innerHTML = '';
    const selectedGroupLinks = getLinksForGroup(selectedGroup);
    selectedGroupLinks.forEach(l => {
      selectedGrid.appendChild(createLinkEl(l));
    });
  }

  /* ========== CONTEXT MENU ========== */
  function showContextMenu(x, y, linkId, group) {
    contextLinkId = linkId;
    contextGroup = group || selectedGroup;
    contextMenu.classList.remove('hidden');

    // Show/hide link-specific items
    const addLinkBtn = contextMenu.querySelector('[data-action="add-link"]');
    const addGroupBtn = contextMenu.querySelector('[data-action="add-group"]');
    const linkOnlyBtns = contextMenu.querySelectorAll('.ctx-link-only');
    const groupOnlyBtns = contextMenu.querySelectorAll('.ctx-group-only');
    const pinGroupBtn = contextMenu.querySelector('[data-action="pin-group"]');
    const deleteGroupBtn = contextMenu.querySelector('[data-action="delete-group"]');
    const sep = contextMenu.querySelector('.ctx-sep');
    if (contextMenuMode === 'group') {
      linkOnlyBtns.forEach(b => b.classList.add('hidden'));
      groupOnlyBtns.forEach(b => b.classList.remove('hidden'));
      if (addLinkBtn) addLinkBtn.classList.add('hidden');
      if (addGroupBtn) addGroupBtn.classList.remove('hidden');
      if (pinGroupBtn) {
        pinGroupBtn.textContent = groups.pinned.includes(contextGroup) ? '📍 Bỏ ghim nhóm' : '📌 Ghim nhóm';
      }
      if (deleteGroupBtn && groups.list.length <= 2) {
        deleteGroupBtn.classList.add('hidden');
      }
      if (sep) sep.classList.add('hidden');
    } else if (linkId) {
      linkOnlyBtns.forEach(b => b.classList.remove('hidden'));
      groupOnlyBtns.forEach(b => b.classList.add('hidden'));
      if (addLinkBtn) addLinkBtn.classList.remove('hidden');
      if (addGroupBtn) addGroupBtn.classList.remove('hidden');
      if (sep) sep.classList.remove('hidden');
    } else {
      linkOnlyBtns.forEach(b => b.classList.add('hidden'));
      groupOnlyBtns.forEach(b => b.classList.add('hidden'));
      if (addGroupBtn) addGroupBtn.classList.remove('hidden');
      if (sep) sep.classList.add('hidden');
    }

    contextMenu.style.left = Math.min(x, window.innerWidth - 170) + 'px';
    contextMenu.style.top = Math.min(y, window.innerHeight - 160) + 'px';
  }

  function hideContextMenu() {
    contextMenu.classList.add('hidden');
    contextLinkId = null;
    contextGroup = null;
    contextMenuMode = 'general';
  }

  function togglePinGroup(groupName) {
    if (!groupName) return;

    if (groups.pinned.includes(groupName)) {
      groups.pinned = groups.pinned.filter(p => p !== groupName);
      if (selectedGroup === groupName || !selectedGroup) {
        selectedGroup = groups.list.find(x => !groups.pinned.includes(x)) || groups.list[0];
      }
    } else {
      groups.pinned.push(groupName);
      if (selectedGroup === groupName) {
        selectedGroup = groups.list.find(x => !groups.pinned.includes(x)) || groups.list[0];
      }
    }

    groups.selected = selectedGroup;
    saveData();
    render();
  }

  function deleteGroup(groupName) {
    if (!groupName || groups.list.length <= 2) return;
    if (!confirm(`Xoá nhóm "${groupName}"? Các link trong nhóm cũng sẽ bị xoá.`)) return;

    groups.list = groups.list.filter(x => x !== groupName);
    groups.pinned = groups.pinned.filter(x => x !== groupName);
    links = links.filter(l => l.parent !== groupName);

    if (selectedGroup === groupName) {
      selectedGroup = groups.list.find(x => !groups.pinned.includes(x)) || groups.list[0];
    }

    groups.selected = selectedGroup;
    saveData();
    render();
  }

  bindContextMenu({
    documentRef: document,
    contextMenu,
    getSelectedGroup: () => contextGroup || selectedGroup,
    getGroups: () => groups,
    showContextMenu,
    hideContextMenu,
    setContextMenuMode: value => { contextMenuMode = value; },
    setContextLinkId: value => { contextLinkId = value; },
    getContextLinkId: () => contextLinkId,
    setLinks: value => { links = value; },
    getLinks: () => links,
    saveData,
    render,
    openModal,
    togglePinGroup,
    deleteGroup
  });

  /* ========== MODAL ========== */
  function openModal(mode, link = null, defaultGroup = null) {
    modalMode = mode;
    modalOverlay.classList.remove('hidden');

    if (mode === 'add-group') {
      modalTitle.textContent = 'Thêm nhóm';
      modalBodyLink.classList.add('hidden');
      modalBodyGroup.classList.remove('hidden');
      inputGroupName.value = '';
      inputGroupName.focus();
    } else if (mode === 'edit-group') {
      modalTitle.textContent = 'Đổi tên nhóm';
      modalBodyLink.classList.add('hidden');
      modalBodyGroup.classList.remove('hidden');
      inputGroupName.value = link; // reusing link param for group name
      editingGroupName = link;
      inputGroupName.focus();
    } else {
      modalBodyLink.classList.remove('hidden');
      modalBodyGroup.classList.add('hidden');

      // Populate group selector
      inputGroup.innerHTML = '';
      groups.list.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        inputGroup.appendChild(opt);
      });

      if (mode === 'edit-link' && link) {
        modalTitle.textContent = 'Sửa liên kết';
        inputUrl.value = link.url;
        inputName.value = link.title;
        inputGroup.value = link.parent;
        editingLinkId = link._id;
      } else {
        modalTitle.textContent = 'Thêm liên kết';
        inputUrl.value = '';
        inputName.value = '';
        inputGroup.value = defaultGroup || selectedGroup;
        editingLinkId = null;
      }
      inputUrl.focus();
    }
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
    editingLinkId = null;
    editingGroupName = null;
    modalMode = null;
  }

  modalCancel.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', e => {
    if (e.target === modalOverlay) closeModal();
  });

  modalSave.addEventListener('click', () => {
    if (modalMode === 'add-group' || modalMode === 'edit-group') {
      const name = inputGroupName.value.trim();
      if (!name) return;
      if (groups.list.includes(name) && name !== editingGroupName) return; // duplicate

      if (modalMode === 'edit-group' && editingGroupName) {
        // Update list
        groups.list = groups.list.map(g => g === editingGroupName ? name : g);
        // Update pinned
        groups.pinned = groups.pinned.map(p => p === editingGroupName ? name : p);
        // Update links
        links.forEach(l => {
          if (l.parent === editingGroupName) l.parent = name;
        });
        if (selectedGroup === editingGroupName) selectedGroup = name;
        groups.selected = selectedGroup;
      } else {
        // Add new
        groups.list.push(name);
        selectedGroup = name;
        groups.selected = name;
      }

      saveData();
      closeModal();
      render();
      return;
    }

    // add-link / edit-link
    const url = inputUrl.value.trim();
    if (!url) return;

    const title = inputName.value.trim() || autoTitle(url);
    const group = inputGroup.value;

    if (editingLinkId) {
      const link = links.find(l => l._id === editingLinkId);
      if (link) {
        link.url = url;
        link.title = title;
        link.parent = group;
      }
    } else {
      const groupLinks = getLinksForGroup(group);
      const newId = 'links' + Math.random().toString(36).slice(2, 10);
      links.push({
        _id: newId,
        order: groupLinks.length,
        parent: group,
        title,
        url
      });
    }

    saveData();
    closeModal();
    render();
  });

  // Enter key saves
  [inputUrl, inputName, inputGroupName].forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') modalSave.click(); });
  });

  // Auto-fill name when URL blurs
  inputUrl.addEventListener('blur', () => {
    if (inputUrl.value && !inputName.value) {
      inputName.value = autoTitle(inputUrl.value);
    }
  });

  addCurrentBtn.addEventListener('click', () => {
    chrome.storage.local.get([STORAGE_KEYS.recentPage], result => {
      const recent = result[STORAGE_KEYS.recentPage];
      if (!recent || !isNormalUrl(recent.url)) {
        setQuickActionStatus('Chưa có trang gần nhất để thêm. Hãy mở web rồi quay lại.', 'err');
        fillAddLinkModal('', '', selectedGroup);
        return;
      }

      setQuickActionStatus(`Đã lấy: ${recent.title || recent.url}`, 'ok');
      fillAddLinkModal(recent.url, recent.title || autoTitle(recent.url), selectedGroup);
    });
  });

  /* ========== SETTINGS PANEL ========== */
  settingsBtn.addEventListener('click', openSettings);

  function openSettings() {
    settingsOverlay.classList.remove('hidden');
    settingIconSize.value = settings.iconSize;
    settingIconSizeVal.textContent = settings.iconSize + 'px';
    loadSavedGistCredentials(dom);
    updateVerifyStatus(dom, '');
  }

  function closeSettings() {
    settingsOverlay.classList.add('hidden');
  }

  settingsClose.addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', e => {
    if (e.target === settingsOverlay) closeSettings();
  });

  settingIconSize.addEventListener('input', () => {
    const val = parseInt(settingIconSize.value);
    settingIconSizeVal.textContent = val + 'px';
    settings.iconSize = val;
    saveData();
    applySettings();
  });

  cleanupFaviconsBtn.addEventListener('click', () => {
    const now = Date.now();
    faviconCache = Object.fromEntries(
      Object.entries(faviconCache).filter(([, entry]) =>
        entry?.dataUrl && now - (entry.updatedAt || 0) <= FAVICON_CACHE_TTL
      )
    );
    persistFaviconCache();
  });

  /* ========== GIST SYNC ========== */

  function setSyncStatus(msg, type = '') {
    updateSyncStatus(dom, msg, type);
  }

  function setVerifyStatus(msg, type = '') {
    updateVerifyStatus(dom, msg, type);
  }

  function getStoredGistId() {
    return new Promise(resolve => {
      chrome.storage.local.get(['gistId'], result => {
        resolve((result.gistId || '').trim());
      });
    });
  }

  verifyGistTokenBtn.addEventListener('click', async () => {
    const headers = getGistHeaders(dom);
    if (!headers) {
      setVerifyStatus('Nhập token trước', 'err');
      return;
    }

    verifyGistTokenBtn.disabled = true;
    setVerifyStatus('Đang kiểm tra token...');

    try {
      const res = await fetch('https://api.github.com/user', {
        method: 'GET',
        headers
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVerifyStatus(`✓ Token hợp lệ · ${data.login}`, 'ok');
    } catch (err) {
      setVerifyStatus(`✗ Token không hợp lệ · ${err.message}`, 'err');
    } finally {
      verifyGistTokenBtn.disabled = false;
    }
  });

  // Push to Gist
  syncPush.addEventListener('click', async () => {
    const headers = getGistHeaders(dom);
    if (!headers) { setSyncStatus('Nhập token trước', 'err'); return; }

    syncPush.disabled = true;
    setSyncStatus('Đang đẩy lên...');

    const payload = {
      description: 'QuickLinks Homepage Sync',
      public: false,
      files: {
        'quicklinks_data.json': {
          content: JSON.stringify(buildExportData({ links, groups, settings }), null, 2)
        }
      }
    };

    try {
      let gistId = await getStoredGistId();
      let res;

      if (gistId) {
        // Update existing gist
        res = await fetch(`https://api.github.com/gists/${gistId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ files: payload.files })
        });
      } else {
        // Create new gist
        res = await fetch('https://api.github.com/gists', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

      const data = await res.json();

      // Save token & gist id for later syncs
      chrome.storage.local.set({
        gistToken: gistTokenInput.value.trim(),
        gistId: data.id
      });

      setSyncStatus('✓ Đẩy thành công · ' + new Date().toLocaleTimeString(), 'ok');
    } catch (err) {
      setSyncStatus('✗ Lỗi: ' + err.message, 'err');
    } finally {
      syncPush.disabled = false;
    }
  });

  // Pull from Gist
  syncPull.addEventListener('click', async () => {
    const headers = getGistHeaders(dom);
    if (!headers) { setSyncStatus('Nhập token trước', 'err'); return; }

    const gistId = await getStoredGistId();
    if (!gistId) { setSyncStatus('Chưa có Gist để kéo về. Hãy đẩy lên trước.', 'err'); return; }

    syncPull.disabled = true;
    setSyncStatus('Đang kéo về...');

    try {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'GET',
        headers
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

      const data = await res.json();
      const file = data.files['quicklinks_data.json'];
      if (!file) throw new Error('Không tìm thấy file quicklinks_data.json trong Gist');

      const imported = JSON.parse(file.content);

      if (imported.links) links = imported.links;
      if (imported.groups) {
        groups = imported.groups;
        selectedGroup = groups.selected || groups.list.find(g => !groups.pinned.includes(g)) || groups.list[0];
      }
      if (imported.settings) settings = Object.assign({}, DEFAULT_SETTINGS, imported.settings);

      saveData();
      render();

      // Update settings UI
      settingIconSize.value = settings.iconSize;
      settingIconSizeVal.textContent = settings.iconSize + 'px';

      setSyncStatus('✓ Kéo về thành công · ' + new Date().toLocaleTimeString(), 'ok');
    } catch (err) {
      setSyncStatus('✗ Lỗi: ' + err.message, 'err');
    } finally {
      syncPull.disabled = false;
    }
  });


  /* ========== KEYBOARD ========== */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal();
      closeSettings();
      hideContextMenu();
    }
  });

  /* ========== SELECTED GRID DROP ZONE (registered once) ========== */
  selectedGrid.addEventListener('dragover', e => { e.preventDefault(); });
  selectedGrid.addEventListener('drop', e => {
    if (e.target !== selectedGrid) return;
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId) {
      const dragged = links.find(l => l._id === draggedId);
      if (dragged) {
        dragged.parent = selectedGroup;
        dragged.order = getLinksForGroup(selectedGroup).length;
        saveData();
        render();
      }
    }
  });

  /* ========== AUTO-REFRESH ON EXTERNAL CHANGES ========== */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.links) {
      links = changes.links.newValue || [];
      render();
    }
  });

  /* ========== INIT ========== */
  bindGistCredentialInputs(dom);
  Promise.all([loadData(), loadFaviconCache()]).then(() => {
    render();
    requestAnimationFrame(() => {
      document.body.classList.remove('app-loading');
    });
  });

})();
