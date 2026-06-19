import { DEFAULT_SETTINGS } from '../shared/constants/home-defaults.js';
import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';
import { autoTitle, isHttpUrl } from '../shared/utils/link-utils.js';
import { getDomRefs } from './dom.js';
import { bindDragDrop } from './drag-drop.js';
import { bindEditModeActivation } from './edit-mode.js';
import { createHomeRenderer } from './home-renderer.js';
import { createModalController } from './modal-controller.js';
import { createSyncController } from './sync-controller.js';
import { StateStore } from './state.js';

(() => {
  'use strict';

  /* ========== STATE STORE ========== */
  const store = new StateStore();

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

  /* ========== BIND STATE CALLBACKS ========== */
  store.onRender = render;
  store.onRefreshSettings = refreshSettingsControls;
  store.onScheduleSync = scheduleAutoSync;

  function refreshSettingsControls() {
    settingIconSize.value = store.settings.iconSize;
    settingIconSizeVal.textContent = store.settings.iconSize + 'px';
    syncProfileSelect.value = store.profileId;
  }

  function scheduleAutoSync() {
    syncController?.scheduleAutoSync();
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
    getFaviconCache: () => store.faviconCache,
    getGroups: () => store.groups,
    getLinksForGroup: groupName => store.getLinksForGroup(groupName),
    getSelectedGroup: () => store.selectedGroup,
    getSettings: () => store.settings,
    isEditMode: () => store.isEditMode,
    persistFaviconCache: () => store.persistFaviconCache(),
    queueIdleTask
  });

  function applySettings() {
    homeRenderer.applySettings();
  }

  /* ========== RENDERING ========== */
  function render() {
    homeRenderer.render();
  }

  function setQuickActionStatus(message, type = '') {
    if (!quickActionStatus) return;
    quickActionStatus.textContent = message;
    quickActionStatus.className = 'quick-action-status' + (type ? ` ${type}` : '');
  }

  function setEditMode(nextValue) {
    store.setEditMode(nextValue);
  }

  function enterEditMode() {
    if (store.isEditMode) return;
    setEditMode(true);
    render();
  }

  function exitEditMode() {
    if (!store.isEditMode) return;
    setEditMode(false);
    render();
  }

  const modalController = createModalController({
    dom,
    deleteGroup: groupName => store.deleteGroup(groupName),
    deleteLink: linkId => store.deleteLink(linkId),
    getGroups: () => store.groups,
    getLinks: () => store.links,
    getLinksForGroup: groupName => store.getLinksForGroup(groupName),
    getSelectedGroup: () => store.selectedGroup,
    normalizeGroupOrders: (...groupNames) => store.normalizeGroupOrders(...groupNames),
    renameGroupInProfiles: (oldName, newName) => store.renameGroupInProfiles(oldName, newName),
    render,
    saveData: options => store.saveData(options),
    setSelectedGroup: groupName => store.setSelectedGroup(groupName),
    togglePinGroup: groupName => store.togglePinGroup(groupName)
  });

  function openLinkEditor(linkId) {
    if (!linkId) return;
    const link = store.links.find(item => item._id === linkId);
    if (link) modalController.openModal('edit-link', link);
  }

  function openGroupEditor(groupName) {
    if (!groupName) return;
    modalController.openModal('edit-group', groupName);
  }

  function bindGridInteractions() {
    document.addEventListener('click', e => {
      const deleteBadge = e.target.closest('.link-edit-badge');
      if (deleteBadge && store.isEditMode) {
        e.preventDefault();
        e.stopPropagation();
        const link = deleteBadge.closest('.link-item');
        if (link) store.deleteLink(link.dataset.id);
        return;
      }

      const link = e.target.closest('.link-item');
      if (link && store.isEditMode) {
        e.preventDefault();
        openLinkEditor(link.dataset.id);
        return;
      }

      const groupTarget = e.target.closest('.group-context-target');
      if (groupTarget && store.isEditMode) {
        e.preventDefault();
        openGroupEditor(groupTarget.dataset.groupName || store.selectedGroup);
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
        store.selectedGroup = tab.dataset.groupName;
        store.groups.selected = store.selectedGroup;
        store.saveData();
        render();
        return;
      }
    });

    document.addEventListener('contextmenu', e => {
      if (!store.isEditMode) return;
      const draggableTarget = e.target.closest('.link-item, .pinned-group-header, #group-tabs .tab:not(.tab-add-group)');
      if (draggableTarget && IS_TOUCH_DEVICE) {
        e.preventDefault();
        return;
      }

      const groupTarget = e.target.closest('.group-context-target');
      if (!groupTarget) return;
      e.preventDefault();
      openGroupEditor(groupTarget.dataset.groupName || store.selectedGroup);
    });
  }

  addCurrentBtn.addEventListener('click', () => {
    chrome.storage.local.get([STORAGE_KEYS.recentPage], result => {
      const recent = result[STORAGE_KEYS.recentPage];
      if (!recent || !isHttpUrl(recent.url)) {
        setQuickActionStatus('No recent page to add. Please open a website first, then return.', 'err');
        modalController.fillAddLinkModal('', '', store.selectedGroup);
        return;
      }

      setQuickActionStatus(`Retrieved: ${recent.title || recent.url}`, 'ok');
      modalController.fillAddLinkModal(recent.url, recent.title || autoTitle(recent.url), store.selectedGroup);
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
    store.settings.iconSize = val;
    store.saveData();
    applySettings();
  });

  cleanupFaviconsBtn.addEventListener('click', () => {
    store.faviconCache = {};
    store.persistFaviconCache();
    render();
  });

  const syncController = createSyncController({
    applyImportedState: imported => store.applyImportedState(imported),
    dom,
    getRevision: () => store.syncRevision,
    getState: () => ({ links: store.links, groups: store.groups, settings: store.settings, profileId: store.profileId }),
    persistCurrentProfile: () => store.persistCurrentProfile(),
    refreshSettingsControls,
    render,
    saveData: options => store.saveData(options),
    setRevision: revision => { store.syncRevision = revision; },
    switchProfile: nextProfileId => store.switchProfile(nextProfileId)
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
    if (area === 'local' && store.suppressStorageSync) return;
    if (area === 'local' && (changes.links || changes.groups || changes.settings || changes.profiles || changes.syncProfile)) {
      let shouldApplyActiveProfile = false;
      if (changes.links) store.links = changes.links.newValue || [];
      if (changes.groups) {
        store.groups = Object.assign({}, store.groups, changes.groups.newValue || {});
        shouldApplyActiveProfile = true;
      }
      if (changes.settings) {
        store.settings = Object.assign({}, DEFAULT_SETTINGS, changes.settings.newValue || {});
      }
      if (changes.profiles) {
        store.profiles = changes.profiles.newValue || store.profiles;
        shouldApplyActiveProfile = true;
      }
      if (changes.syncProfile) {
        store.profileId = changes.syncProfile.newValue || store.profileId;
        shouldApplyActiveProfile = true;
      }
      if (shouldApplyActiveProfile) {
        store.applyActiveProfileToGroups();
      }
      render();
    }
  });

  /* ========== INIT ========== */
  syncController.bind();
  bindGridInteractions();
  bindDragDrop({
    getLinks: () => store.links,
    getLinksForGroup: groupName => store.getLinksForGroup(groupName),
    isEditMode: () => store.isEditMode,
    normalizeGroupOrders: (...groupNames) => store.normalizeGroupOrders(...groupNames),
    render,
    reorderLink: (draggedId, targetId, targetGroup) => store.reorderLink(draggedId, targetId, targetGroup),
    reorderGroup: (draggedName, targetName) => store.reorderGroup(draggedName, targetName),
    reorderPinnedGroup: (draggedName, targetName) => store.reorderPinnedGroup(draggedName, targetName),
    saveData: options => store.saveData(options)
  });
  bindEditModeActivation({
    enterEditMode,
    exitEditMode,
    isEditMode: () => store.isEditMode,
    isTouchDevice: IS_TOUCH_DEVICE,
  });
  setEditMode(false);
  Promise.all([
    store.loadData(),
    store.loadFaviconCache(),
    syncController.loadSavedRevision(),
    syncController.loadSavedReady(),
    syncController.loadSavedCredentials(),
    syncController.loadSavedStatuses()
  ]).then(([, , savedRevision]) => {
    store.syncRevision = savedRevision;
    render();
    requestAnimationFrame(() => {
      document.body.classList.remove('app-loading');
    });
    syncController.bootstrapCloud({ force: true });
    syncController.startAutoRestore();
  });

})();
