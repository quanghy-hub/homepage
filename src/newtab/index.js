import { DEFAULT_PROFILE_ID, DEFAULT_SETTINGS } from '../shared/constants/home-defaults.js';
import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';
import { autoTitle } from '../shared/utils/link-utils.js';
import { getDomRefs } from './dom.js';
import { bindDragDrop } from './drag-drop.js';
import { bindEditModeActivation } from './edit-mode.js';
import { createHomeRenderer, FAVICON_CACHE_TTL } from './home-renderer.js';
import { createModalController } from './modal-controller.js';
import { createSyncController } from './sync-controller.js';
import { getProfileFromState, loadAppData, normalizeProfile, saveAppData } from './storage.js';

(() => {
  'use strict';

  /* ========== STATE ========== */
  let links = [];
  let groups = {};
  let settings = {};
  let profiles = {};
  let profileId = DEFAULT_PROFILE_ID;
  let selectedGroup = '';
  let faviconCache = {};
  let suppressStorageSync = false;
  let isEditMode = false;
  let syncRevision = null;
  let syncController = null;

  /* ========== DOM REFS ========== */
  const dom = getDomRefs();
  const {
    addCurrentBtn,
    quickActionStatus,
    settingsBtn,
    settingsOverlay,
    settingIconSize,
    settingIconSizeVal,
    cleanupFaviconsBtn,
    settingsClose,
    syncProfileSelect
  } = dom;
  const IS_TOUCH_DEVICE = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

  /* ========== STORAGE HELPERS ========== */
  function loadData() {
    const state = { links, groups, settings, profiles, profileId, selectedGroup };
    return loadAppData(state).then(() => {
      links = state.links;
      groups = state.groups;
      settings = state.settings;
      profiles = state.profiles;
      profileId = state.profileId;
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

  function saveData(options = {}) {
    suppressStorageSync = true;
    saveAppData({ links, groups, settings, profiles, profileId });
    setTimeout(() => {
      suppressStorageSync = false;
    }, 0);
    if (!options.skipAutoSync) {
      scheduleAutoSync();
    }
  }

  function scheduleAutoSync() {
    syncController?.scheduleAutoSync();
  }

  function persistFaviconCache() {
    chrome.storage.local.set({
      [STORAGE_KEYS.faviconCache]: faviconCache
    });
  }

  function persistCurrentProfile() {
    profiles[profileId] = getProfileFromState({ groups, settings });
  }

  function applyActiveProfileToGroups() {
    const activeProfile = normalizeProfile(profiles[profileId], groups, settings);
    profiles[profileId] = activeProfile;
    groups.pinned = activeProfile.pinned;
    groups.selected = activeProfile.selected;
    settings = activeProfile.settings;
    selectedGroup = groups.selected;
  }

  function refreshSettingsControls() {
    settingIconSize.value = settings.iconSize;
    settingIconSizeVal.textContent = settings.iconSize + 'px';
    syncProfileSelect.value = profileId;
  }

  function switchProfile(nextProfileId) {
    if (!nextProfileId || nextProfileId === profileId) return;
    persistCurrentProfile();
    profileId = nextProfileId;

    const nextProfile = normalizeProfile(profiles[profileId], groups, settings);
    profiles[profileId] = nextProfile;
    groups.pinned = nextProfile.pinned;
    groups.selected = nextProfile.selected;
    settings = nextProfile.settings;
    selectedGroup = groups.selected;

    saveData({ skipAutoSync: true });
    refreshSettingsControls();
    render();
  }

  function queueIdleTask(task, timeout = 250) {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(task, { timeout });
      return;
    }
    window.setTimeout(task, 32);
  }

  const homeRenderer = createHomeRenderer({
    dom,
    getFaviconCache: () => faviconCache,
    getGroups: () => groups,
    getLinksForGroup,
    getSelectedGroup: () => selectedGroup,
    getSettings: () => settings,
    isEditMode: () => isEditMode,
    persistFaviconCache,
    queueIdleTask
  });

  function applySettings() {
    homeRenderer.applySettings();
  }

  /* ========== RENDERING ========== */
  function getLinksForGroup(groupName) {
    return links
      .filter(l => l.parent === groupName)
      .sort((a, b) => a.order - b.order);
  }

  function normalizeGroupOrders(...groupNames) {
    [...new Set(groupNames.filter(Boolean))].forEach(groupName => {
      getLinksForGroup(groupName).forEach((link, index) => {
        link.order = index;
      });
    });
  }

  function getFallbackSelected(pinned = groups.pinned) {
    return groups.list.find(g => !pinned.includes(g)) || groups.list[0] || '';
  }

  function setSelectedGroup(groupName) {
    selectedGroup = groupName;
    groups.selected = groupName;
  }

  function renameGroupInProfiles(oldName, newName) {
    Object.keys(profiles).forEach(id => {
      const profile = profiles[id] || {};
      const pinned = Array.isArray(profile.pinned)
        ? profile.pinned.map(groupName => groupName === oldName ? newName : groupName)
        : groups.pinned;
      const selected = profile.selected === oldName ? newName : profile.selected;
      profiles[id] = normalizeProfile({ ...profile, pinned, selected }, groups, profile.settings || settings);
    });
  }

  function removeGroupFromProfiles(groupName) {
    Object.keys(profiles).forEach(id => {
      const profile = profiles[id] || {};
      const pinned = Array.isArray(profile.pinned)
        ? profile.pinned.filter(name => name !== groupName)
        : groups.pinned;
      const selected = profile.selected === groupName ? '' : profile.selected;
      profiles[id] = normalizeProfile({ ...profile, pinned, selected }, groups, profile.settings || settings);
    });
  }

  function setQuickActionStatus(message, type = '') {
    if (!quickActionStatus) return;
    quickActionStatus.textContent = message;
    quickActionStatus.className = 'quick-action-status' + (type ? ` ${type}` : '');
  }

  function setEditMode(nextValue) {
    isEditMode = !!nextValue;
    document.body.classList.toggle('edit-mode', isEditMode);
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

  function isNormalUrl(url) {
    return !!url && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://');
  }

  /* ========== REORDER (can change group) ========== */
  function reorderLink(draggedId, targetId, targetGroup) {
    const dragged = links.find(l => l._id === draggedId);
    const target = links.find(l => l._id === targetId);
    if (!dragged || !target) return;
    const sourceGroup = dragged.parent;

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
    normalizeGroupOrders(sourceGroup, dragged.parent);

    saveData();
    render();
  }

  function reorderGroup(draggedName, targetName) {
    const draggedIdx = groups.list.indexOf(draggedName);
    const targetIdx = groups.list.indexOf(targetName);
    if (draggedIdx === -1 || targetIdx === -1) return;

    groups.list.splice(draggedIdx, 1);
    groups.list.splice(targetIdx, 0, draggedName);

    saveData();
    render();
  }

  function reorderPinnedGroup(draggedName, targetName) {
    const draggedIdx = groups.pinned.indexOf(draggedName);
    const targetIdx = groups.pinned.indexOf(targetName);
    if (draggedIdx === -1 || targetIdx === -1) return;

    groups.pinned.splice(draggedIdx, 1);
    groups.pinned.splice(targetIdx, 0, draggedName);

    saveData();
    render();
  }

  /* ========== RENDER ========== */
  function render() {
    homeRenderer.render();
  }

  /* ========== CONTEXT MENU ========== */
  function togglePinGroup(groupName) {
    if (!groupName) return;

    if (groups.pinned.includes(groupName)) {
      groups.pinned = groups.pinned.filter(p => p !== groupName);
      if (selectedGroup === groupName || !selectedGroup) {
        selectedGroup = getFallbackSelected();
      }
    } else {
      groups.pinned.push(groupName);
      if (selectedGroup === groupName) {
        selectedGroup = getFallbackSelected();
      }
    }

    groups.selected = selectedGroup;
    saveData();
    render();
  }

  function deleteGroup(groupName) {
    if (!groupName || groups.list.length <= 2) return;

    groups.list = groups.list.filter(x => x !== groupName);
    groups.pinned = groups.pinned.filter(x => x !== groupName);
    links = links.filter(l => l.parent !== groupName);

    if (selectedGroup === groupName) {
      selectedGroup = getFallbackSelected();
    }

    groups.selected = selectedGroup;
    removeGroupFromProfiles(groupName);
    saveData();
    render();
  }

  function deleteLink(linkId) {
    if (!linkId) return;
    const target = links.find(l => l._id === linkId);
    if (!target) return;

    links = links.filter(l => l._id !== linkId);
    const sameGroup = getLinksForGroup(target.parent);
    sameGroup.forEach((item, idx) => { item.order = idx; });
    saveData();
    render();
  }

  const modalController = createModalController({
    dom,
    deleteGroup,
    deleteLink,
    getGroups: () => groups,
    getLinks: () => links,
    getLinksForGroup,
    getSelectedGroup: () => selectedGroup,
    normalizeGroupOrders,
    renameGroupInProfiles,
    render,
    saveData,
    setSelectedGroup,
    togglePinGroup
  });

  function openLinkEditor(linkId) {
    if (!linkId) return;
    const link = links.find(item => item._id === linkId);
    if (link) modalController.openModal('edit-link', link);
  }

  function openGroupEditor(groupName) {
    if (!groupName) return;
    modalController.openModal('edit-group', groupName);
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

      const tab = e.target.closest('#group-tabs .tab');
      if (tab) {
        if (tab.dataset.action === 'add-group') {
          e.preventDefault();
          enterEditMode();
          modalController.openModal('add-group');
          return;
        }
        selectedGroup = tab.dataset.groupName;
        groups.selected = selectedGroup;
        saveData();
        render();
        return;
      }

      const groupTarget = e.target.closest('.group-context-target');
      if (groupTarget && isEditMode) {
        e.preventDefault();
        openGroupEditor(groupTarget.dataset.groupName || selectedGroup);
        return;
      }
    });

    document.addEventListener('contextmenu', e => {
      if (!isEditMode) return;
      const groupTarget = e.target.closest('.group-context-target');
      if (!groupTarget) return;
      e.preventDefault();
      openGroupEditor(groupTarget.dataset.groupName || selectedGroup);
    });

  }

  addCurrentBtn.addEventListener('click', () => {
    chrome.storage.local.get([STORAGE_KEYS.recentPage], result => {
      const recent = result[STORAGE_KEYS.recentPage];
      if (!recent || !isNormalUrl(recent.url)) {
        setQuickActionStatus('No recent page to add. Please open a website first, then return.', 'err');
        modalController.fillAddLinkModal('', '', selectedGroup);
        return;
      }

      setQuickActionStatus(`Retrieved: ${recent.title || recent.url}`, 'ok');
      modalController.fillAddLinkModal(recent.url, recent.title || autoTitle(recent.url), selectedGroup);
    });
  });

  /* ========== SETTINGS PANEL ========== */
  settingsBtn.addEventListener('click', openSettings);

  function openSettings() {
    settingsOverlay.classList.remove('hidden');
    refreshSettingsControls();
    syncController.loadSavedCredentials();
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

  function applyImportedState(imported) {
    if (!imported || typeof imported !== 'object') return;

    if (Array.isArray(imported.links)) {
      links = imported.links;
    }

    if (Array.isArray(imported.groups?.list)) {
      groups.list = imported.groups.list;
    }

    profiles = Object.assign({}, profiles, imported.profiles || {});
    const activeProfile = normalizeProfile(profiles[profileId], imported.groups || groups, settings);
    profiles[profileId] = activeProfile;
    groups.pinned = activeProfile.pinned;
    groups.selected = activeProfile.selected;
    settings = activeProfile.settings;
    selectedGroup = groups.selected;
  }

  syncController = createSyncController({
    applyImportedState,
    dom,
    getRevision: () => syncRevision,
    getState: () => ({ links, groups, settings, profileId }),
    persistCurrentProfile,
    refreshSettingsControls,
    render,
    saveData,
    setRevision: revision => { syncRevision = revision; },
    switchProfile
  });

  /* ========== KEYBOARD ========== */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      modalController.closeModal();
      closeSettings();
      exitEditMode();
    }
  });

  /* ========== AUTO-REFRESH ON EXTERNAL CHANGES ========== */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && suppressStorageSync) return;
    if (area === 'local' && (changes.links || changes.groups || changes.settings || changes.profiles || changes.syncProfile)) {
      let shouldApplyActiveProfile = false;
      if (changes.links) links = changes.links.newValue || [];
      if (changes.groups) {
        groups = Object.assign({}, groups, changes.groups.newValue || {});
        shouldApplyActiveProfile = true;
      }
      if (changes.settings) {
        settings = Object.assign({}, DEFAULT_SETTINGS, changes.settings.newValue || {});
      }
      if (changes.profiles) {
        profiles = changes.profiles.newValue || profiles;
        shouldApplyActiveProfile = true;
      }
      if (changes.syncProfile) {
        profileId = changes.syncProfile.newValue || profileId;
        shouldApplyActiveProfile = true;
      }
      if (shouldApplyActiveProfile) {
        applyActiveProfileToGroups();
      }
      render();
    }
  });

  /* ========== INIT ========== */
  syncController.bind();
  bindGridInteractions();
  bindDragDrop({
    getLinks: () => links,
    getLinksForGroup,
    isEditMode: () => isEditMode,
    normalizeGroupOrders,
    render,
    reorderLink,
    reorderGroup,
    reorderPinnedGroup,
    saveData
  });
  bindEditModeActivation({
    enterEditMode,
    exitEditMode,
    isEditMode: () => isEditMode,
    isTouchDevice: IS_TOUCH_DEVICE,
  });
  setEditMode(false);
  Promise.all([
    loadData(),
    loadFaviconCache(),
    syncController.loadSavedRevision(),
    syncController.loadSavedReady(),
    syncController.loadSavedCredentials()
  ]).then(([, , savedRevision]) => {
    syncRevision = savedRevision;
    render();
    requestAnimationFrame(() => {
      document.body.classList.remove('app-loading');
    });
    syncController.refreshStatus();
    syncController.bootstrapCloud();
    syncController.startAutoRestore();
  });

})();
