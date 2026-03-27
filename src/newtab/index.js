import { DEFAULT_SETTINGS } from '../shared/constants/home-defaults.js';
import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';
import { getFavicon, autoTitle } from '../shared/utils/link-utils.js';
import { getDomRefs } from './dom.js';
import { loadAppData, saveAppData } from './storage.js';
import { bindContextMenu } from './context-menu.js';
import {
  setSyncStatus as updateSyncStatus,
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
  let editingLinkId = null;
  let editingGroupName = null; // group name being renamed
  let contextLinkId = null; // link right-clicked on (null if clicked on empty area)
  let contextGroup = null;  // which group area was right-clicked
  let modalMode = null; // 'add-link', 'edit-link', 'add-group'

  /* ========== DOM REFS ========== */
  const dom = getDomRefs();
  const {
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
    settingsGroupList,
    settingsAddGroup,
    settingsClose,
    gistTokenInput,
    gistIdInput,
    syncPush,
    syncPull,
    syncStatus
  } = dom;

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

  function saveData() {
    saveAppData({ links, groups, settings });
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
    img.src = getFavicon(link.url);
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
      pinnedGrid.appendChild(header);
    });

    // Group tabs (below icons)
    groupTabs.innerHTML = '';
    groups.list.filter(g => !groups.pinned.includes(g)).forEach(g => {
      const tab = document.createElement('button');
      tab.className = 'tab' + (g === selectedGroup ? ' active' : '');
      tab.textContent = g;
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
    const linkOnlyBtns = contextMenu.querySelectorAll('.ctx-link-only');
    const sep = contextMenu.querySelector('.ctx-sep');
    if (linkId) {
      linkOnlyBtns.forEach(b => b.classList.remove('hidden'));
      if (sep) sep.classList.remove('hidden');
    } else {
      linkOnlyBtns.forEach(b => b.classList.add('hidden'));
      if (sep) sep.classList.add('hidden');
    }

    contextMenu.style.left = Math.min(x, window.innerWidth - 170) + 'px';
    contextMenu.style.top = Math.min(y, window.innerHeight - 160) + 'px';
  }

  function hideContextMenu() {
    contextMenu.classList.add('hidden');
    contextLinkId = null;
    contextGroup = null;
  }

  bindContextMenu({
    documentRef: document,
    contextMenu,
    getSelectedGroup: () => contextGroup || selectedGroup,
    getGroups: () => groups,
    showContextMenu,
    hideContextMenu,
    setContextLinkId: value => { contextLinkId = value; },
    getContextLinkId: () => contextLinkId,
    setLinks: value => { links = value; },
    getLinks: () => links,
    saveData,
    render,
    openModal
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

  /* ========== SETTINGS PANEL ========== */
  settingsBtn.addEventListener('click', openSettings);

  function openSettings() {
    settingsOverlay.classList.remove('hidden');
    settingIconSize.value = settings.iconSize;
    settingIconSizeVal.textContent = settings.iconSize + 'px';
    renderGroupList();
    loadSavedGistCredentials(dom);
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

  function renderGroupList() {
    settingsGroupList.innerHTML = '';
    groups.list.forEach(g => {
      const item = document.createElement('div');
      item.className = 'settings-group-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'group-name';
      nameSpan.textContent = g;
      item.appendChild(nameSpan);

      // Pin toggle button
      const pinBtn = document.createElement('button');
      const isPinned = groups.pinned.includes(g);
      pinBtn.className = 'btn-pin-group' + (isPinned ? ' active' : '');
      pinBtn.innerHTML = isPinned ? '📌' : '📍';
      pinBtn.title = isPinned ? 'Bỏ ghim' : 'Ghim nhóm này';
      pinBtn.addEventListener('click', () => {
        if (isPinned) {
          // Unpin (only if at least 1 pinned remaining or we allow 0)
          groups.pinned = groups.pinned.filter(p => p !== g);
          if (selectedGroup === g || !selectedGroup) {
            selectedGroup = groups.list.find(x => !groups.pinned.includes(x)) || groups.list[0];
          }
        } else {
          // Pin
          if (!groups.pinned.includes(g)) {
            groups.pinned.push(g);
          }
          if (selectedGroup === g) {
            selectedGroup = groups.list.find(x => !groups.pinned.includes(x)) || groups.list[0];
          }
        }
        groups.selected = selectedGroup;
        saveData();
        render();
        renderGroupList();
      });
      item.appendChild(pinBtn);

      // Rename button
      const renBtn = document.createElement('button');
      renBtn.className = 'btn-ren-group';
      renBtn.innerHTML = '✏️';
      renBtn.title = 'Đổi tên nhóm';
      renBtn.addEventListener('click', () => {
        closeSettings();
        openModal('edit-group', g);
      });
      item.appendChild(renBtn);

      // Delete button (can't delete pinned or if only 2 groups left)
      if (!groups.pinned.includes(g) && groups.list.length > 2) {
        const delBtn = document.createElement('button');
        delBtn.className = 'btn-del-group';
        delBtn.textContent = '✕';
        delBtn.title = 'Xoá nhóm';
        delBtn.addEventListener('click', () => {
          if (!confirm(`Xoá nhóm "${g}"? Các link trong nhóm cũng sẽ bị xoá.`)) return;
          groups.list = groups.list.filter(x => x !== g);
          links = links.filter(l => l.parent !== g);
          if (selectedGroup === g) {
            selectedGroup = groups.list.find(x => !groups.pinned.includes(x)) || groups.list[0];
            groups.selected = selectedGroup;
          }
          saveData();
          render();
          renderGroupList();
        });
        item.appendChild(delBtn);
      }

      settingsGroupList.appendChild(item);
    });
  }

  settingsAddGroup.addEventListener('click', () => {
    closeSettings();
    openModal('add-group');
  });

  /* ========== GIST SYNC ========== */

  function setSyncStatus(msg, type = '') {
    updateSyncStatus(dom, msg, type);
  }

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
      let gistId = gistIdInput.value.trim();
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
      gistIdInput.value = data.id;

      // Save token & gist id
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

    const gistId = gistIdInput.value.trim();
    if (!gistId) { setSyncStatus('Nhập Gist ID trước', 'err'); return; }

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
      renderGroupList();

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
  loadData().then(() => {
    render();
  });

})();
