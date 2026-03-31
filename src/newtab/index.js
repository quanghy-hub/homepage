import { DEFAULT_SETTINGS } from '../shared/constants/home-defaults.js';
import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';
import { getFavicon, getHostname, autoTitle } from '../shared/utils/link-utils.js';
import { getDomRefs } from './dom.js';
import { loadAppData, saveAppData } from './storage.js';
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
  let modalMode = null; // 'add-link', 'edit-link', 'add-group'
  let suppressStorageSync = false;
  let isEditMode = false;

  /* ========== DOM REFS ========== */
  const dom = getDomRefs();
  const {
    addCurrentBtn,
    quickActionStatus,
    pinnedGrid,
    groupTabs,
    selectedGrid,
    editModeBtn,
    settingsBtn,
    modalOverlay,
    modalTitle,
    modalBodyLink,
    modalBodyGroup,
    inputUrl,
    inputName,
    inputGroup,
    inputGroupName,
    modalPin,
    modalDelete,
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
  const IS_TOUCH_DEVICE = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

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
    suppressStorageSync = true;
    saveAppData({ links, groups, settings });
    setTimeout(() => {
      suppressStorageSync = false;
    }, 0);
  }

  function persistFaviconCache() {
    chrome.storage.local.set({
      [STORAGE_KEYS.faviconCache]: faviconCache
    });
  }

  function queueIdleTask(task, timeout = 250) {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(task, { timeout });
      return;
    }
    window.setTimeout(task, 32);
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

  function setEditMode(nextValue) {
    isEditMode = !!nextValue;
    document.body.classList.toggle('edit-mode', isEditMode);
    editModeBtn.title = isEditMode ? 'Thoát chỉnh sửa' : 'Chỉnh sửa';
  }

  function enterEditMode() {
    if (isEditMode) return;
    setEditMode(true);
    render();
  }

  function exitEditMode() {
    if (!isEditMode) return;
    setEditMode(false);
    render();
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
        faviconCache[hostname] = {
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
    el.draggable = isEditMode;
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
      groupTabs.appendChild(tab);
    });

    if (isEditMode) {
      const addTab = document.createElement('button');
      addTab.className = 'tab tab-add-group';
      addTab.type = 'button';
      addTab.textContent = '+';
      addTab.dataset.action = 'add-group';
      groupTabs.appendChild(addTab);
    }

    // Selected group
    selectedGrid.innerHTML = '';
    const selectedGroupLinks = getLinksForGroup(selectedGroup);
    selectedGroupLinks.forEach(l => {
      selectedGrid.appendChild(createLinkEl(l));
    });
  }

  /* ========== CONTEXT MENU ========== */
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

  function deleteLink(linkId) {
    if (!linkId) return;
    const target = links.find(l => l._id === linkId);
    if (!target) return;
    if (!confirm(`Xoá link "${target.title || target.url}"?`)) return;

    links = links.filter(l => l._id !== linkId);
    const sameGroup = getLinksForGroup(target.parent);
    sameGroup.forEach((item, idx) => { item.order = idx; });
    saveData();
    render();
  }

  function openLinkEditor(linkId) {
    if (!linkId) return;
    const link = links.find(item => item._id === linkId);
    if (link) openModal('edit-link', link);
  }

  function openGroupEditor(groupName) {
    if (!groupName) return;
    openModal('edit-group', groupName);
  }

  function bindGridInteractions() {
    document.addEventListener('click', e => {
      const deleteBadge = e.target.closest('.link-edit-badge');
      if (deleteBadge && isEditMode) {
        e.preventDefault();
        e.stopPropagation();
        const link = deleteBadge.closest('.link-item');
        if (link) deleteLink(link.dataset.id);
        return;
      }

      const link = e.target.closest('.link-item');
      if (link && isEditMode) {
        e.preventDefault();
        openLinkEditor(link.dataset.id);
        return;
      }

      const groupTarget = e.target.closest('.group-context-target');
      if (groupTarget && isEditMode) {
        e.preventDefault();
        openGroupEditor(groupTarget.dataset.groupName || selectedGroup);
        return;
      }

      const tab = e.target.closest('#group-tabs .tab');
      if (tab) {
        if (tab.dataset.action === 'add-group') {
          e.preventDefault();
          enterEditMode();
          openModal('add-group');
          return;
        }
        if (isEditMode) return;
        selectedGroup = tab.dataset.groupName;
        groups.selected = selectedGroup;
        saveData();
        render();
        return;
      }
    });

    document.addEventListener('dragstart', e => {
      if (!isEditMode) {
        e.preventDefault();
        return;
      }
      const item = e.target.closest('.link-item');
      if (!item) return;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.id);
      e.dataTransfer.setData('application/group', item.dataset.parent);
    });

    document.addEventListener('dragend', e => {
      const item = e.target.closest('.link-item');
      item?.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(node => node.classList.remove('drag-over'));
    });

    document.addEventListener('dragover', e => {
      if (!isEditMode) return;
      const item = e.target.closest('.link-item');
      const grid = e.target.closest('.links-grid');
      if (!item && !grid) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.drag-over').forEach(node => node.classList.remove('drag-over'));
      if (item) {
        const dragging = document.querySelector('.link-item.dragging');
        if (dragging && dragging.dataset.id !== item.dataset.id) {
          item.classList.add('drag-over');
        }
      }
    });

    document.addEventListener('dragleave', e => {
      const item = e.target.closest('.link-item');
      item?.classList.remove('drag-over');
    });

    document.addEventListener('drop', e => {
      if (!isEditMode) return;
      const item = e.target.closest('.link-item');
      const grid = e.target.closest('.links-grid');
      if (!item && !grid) return;
      e.preventDefault();
      document.querySelectorAll('.drag-over').forEach(node => node.classList.remove('drag-over'));
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId) return;

      if (item) {
        if (draggedId !== item.dataset.id) {
          reorderLink(draggedId, item.dataset.id, item.dataset.parent);
        }
        return;
      }

      if (grid && e.target === grid && grid.dataset.group) {
        const dragged = links.find(l => l._id === draggedId);
        if (!dragged) return;
        dragged.parent = grid.dataset.group;
        dragged.order = getLinksForGroup(grid.dataset.group).length;
        saveData();
        render();
      }
    });
  }

  function bindLongPressEditMode() {
    let longPressTimer = null;
    let longPressStartX = 0;
    let longPressStartY = 0;
    let longPressTarget = null;
    let longPressTouch = null;
    let longPressConsumed = false;

    document.addEventListener('click', e => {
      if (!longPressConsumed) return;
      const linkEl = e.target.closest('.link-item');
      if (!linkEl) return;
      e.preventDefault();
      e.stopPropagation();
      longPressConsumed = false;
    }, true);

    document.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      const target = e.target;
      if (target.closest('.modal') || target.closest('.settings-modal')) return;

      const touch = e.touches[0];
      longPressStartX = touch.clientX;
      longPressStartY = touch.clientY;
      longPressTarget = target;
      longPressTouch = { pageX: touch.pageX, pageY: touch.pageY };
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        const linkEl = longPressTarget?.closest('.link-item');
        if (linkEl) {
          if (IS_TOUCH_DEVICE) {
            longPressConsumed = true;
            enterEditMode();
            return;
          }
          enterEditMode();
          return;
        }

        const groupEl = longPressTarget?.closest('.group-context-target');
        if (groupEl) {
          if (IS_TOUCH_DEVICE) {
            longPressConsumed = true;
            enterEditMode();
            return;
          }
          enterEditMode();
          return;
        }

        if (longPressTarget?.closest('#main-container')) {
          longPressConsumed = true;
          enterEditMode();
        }
      }, IS_TOUCH_DEVICE ? 380 : 480);
    }, { passive: true });

    document.addEventListener('touchmove', e => {
      if (!longPressTimer || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - longPressStartX);
      const dy = Math.abs(touch.clientY - longPressStartY);
      if (dx > 10 || dy > 10) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }, { passive: true });

    const clearLongPress = () => {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressTarget = null;
      longPressTouch = null;
      if (!IS_TOUCH_DEVICE) {
        longPressConsumed = false;
      } else {
        setTimeout(() => {
          longPressConsumed = false;
        }, 450);
      }
    };
    document.addEventListener('touchend', clearLongPress, { passive: true });
    document.addEventListener('touchcancel', clearLongPress, { passive: true });
  }

  /* ========== MODAL ========== */
  function openModal(mode, link = null, defaultGroup = null) {
    modalMode = mode;
    modalOverlay.classList.remove('hidden');
    modalPin.classList.add('hidden');
    modalDelete.classList.add('hidden');

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
      modalPin.textContent = groups.pinned.includes(link) ? 'Bỏ ghim' : 'Ghim';
      modalPin.classList.remove('hidden');
      modalDelete.classList.remove('hidden');
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
        modalDelete.classList.remove('hidden');
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
  modalPin.addEventListener('click', () => {
    if (modalMode !== 'edit-group' || !editingGroupName) return;
    const groupName = editingGroupName;
    closeModal();
    togglePinGroup(groupName);
  });
  modalDelete.addEventListener('click', () => {
    if (modalMode === 'edit-link' && editingLinkId) {
      const targetId = editingLinkId;
      closeModal();
      deleteLink(targetId);
      return;
    }

    if (modalMode === 'edit-group' && editingGroupName) {
      const groupName = editingGroupName;
      closeModal();
      deleteGroup(groupName);
    }
  });
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
  editModeBtn.addEventListener('click', () => {
    if (isEditMode) {
      exitEditMode();
      return;
    }
    enterEditMode();
  });

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

  async function findExistingSyncGistId(headers) {
    const res = await fetch('https://api.github.com/gists?per_page=100', {
      method: 'GET',
      headers
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const gists = await res.json();
    if (!Array.isArray(gists)) return '';

    const match = gists.find(g =>
      g?.files?.['quicklinks_data.json'] ||
      g?.description === 'QuickLinks Homepage Sync'
    );

    if (!match?.id) return '';

    chrome.storage.local.set({ gistId: match.id });
    return match.id;
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
      if (!gistId) {
        gistId = await findExistingSyncGistId(headers);
      }
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

    let gistId = await getStoredGistId();
    if (!gistId) {
      setSyncStatus('Đang dò Gist cũ...');
      try {
        gistId = await findExistingSyncGistId(headers);
      } catch (err) {
        setSyncStatus('✗ Không dò được Gist: ' + err.message, 'err');
        return;
      }
    }
    if (!gistId) { setSyncStatus('Chưa có gist để kéo về. Hãy đẩy lên trước.', 'err'); return; }

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
      exitEditMode();
    }
  });

  /* ========== AUTO-REFRESH ON EXTERNAL CHANGES ========== */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && suppressStorageSync) return;
    if (area === 'local' && (changes.links || changes.groups || changes.settings)) {
      if (changes.links) links = changes.links.newValue || [];
      if (changes.groups) {
        groups = changes.groups.newValue || groups;
        selectedGroup = groups.selected || selectedGroup;
      }
      if (changes.settings) {
        settings = Object.assign({}, DEFAULT_SETTINGS, changes.settings.newValue || {});
      }
      render();
    }
  });

  /* ========== INIT ========== */
  bindGistCredentialInputs(dom);
  bindGridInteractions();
  bindLongPressEditMode();
  setEditMode(false);
  Promise.all([loadData(), loadFaviconCache()]).then(() => {
    render();
    requestAnimationFrame(() => {
      document.body.classList.remove('app-loading');
    });
  });

})();
