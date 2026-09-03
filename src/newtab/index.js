import { autoTitle, isHttpUrl } from '../shared/utils/link-utils.js';
import { getDomRefs } from './dom.js';
import { bindDragDrop } from './drag-drop.js';
import { bindEditModeActivation } from './edit-mode.js';
import { createHomeRenderer } from './home-renderer.js';
import { createModalController } from './modal-controller.js';
import { resolveRecentPage } from './recent-page.js';
import { createSettingsController } from './settings-controller.js';
import { createSyncController } from './sync-controller.js';
import { normalizeSettings } from './storage.js';
import { StateStore } from './state.js';

(() => {
  'use strict';

  /* ========== STATE STORE ========== */
  const store = new StateStore();

  /* ========== DOM REFS ========== */
  const dom = getDomRefs();
  const { addCurrentBtn, editModeBtn, quickActionStatus, syncProfileSelect } = dom;
  const IS_TOUCH_DEVICE =
    window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

  editModeBtn?.addEventListener('click', () => {
    if (store.isEditMode) {
      exitEditMode();
    } else {
      enterEditMode();
    }
  });

  /* ========== BIND STATE CALLBACKS ========== */
  store.onRender = render;
  store.onRefreshSettings = refreshSettingsControls;
  store.onScheduleSync = scheduleAutoSync;

  function refreshSettingsControls() {
    settingsController?.refreshControls();
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
    getLinksForGroup: (groupName) => store.getLinksForGroup(groupName),
    getSelectedGroup: () => store.selectedGroup,
    getSettings: () => store.settings,
    isEditMode: () => store.isEditMode,
    persistFaviconCache: () => store.persistFaviconCache(),
    queueIdleTask
  });

  function applySettings() {
    homeRenderer.applySettings();
  }

  const settingsController = createSettingsController({
    applySettings,
    clearFaviconCache: () => {
      store.faviconCache = {};
      store.persistFaviconCache();
    },
    dom,
    getSettings: () => store.settings,
    loadSyncCredentials: () => syncController.loadSavedCredentials(),
    render,
    saveData: () => store.saveData()
  });

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
    deleteGroup: (groupName) => store.deleteGroup(groupName),
    deleteLink: (linkId) => store.deleteLink(linkId),
    getGroups: () => store.groups,
    getLinks: () => store.links,
    getLinksForGroup: (groupName) => store.getLinksForGroup(groupName),
    getSelectedGroup: () => store.selectedGroup,
    normalizeGroupOrders: (...groupNames) => store.normalizeGroupOrders(...groupNames),
    recordDeletedGroups: (...groupNames) => store.recordDeletedGroups(...groupNames),
    renameGroupInProfiles: (oldName, newName) => store.renameGroupInProfiles(oldName, newName),
    render,
    saveData: (options) => store.saveData(options),
    setSelectedGroup: (groupName) => store.setSelectedGroup(groupName),
    togglePinGroup: (groupName) => store.togglePinGroup(groupName)
  });

  function openLinkEditor(linkId) {
    if (!linkId) return;
    const link = store.links.find((item) => item._id === linkId);
    if (link) modalController.openModal('edit-link', link);
  }

  function openGroupEditor(groupName) {
    if (!groupName) return;
    modalController.openModal('edit-group', groupName);
  }

  function bindGridInteractions() {
    document.addEventListener('click', (e) => {
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

      const tab = e.target.closest('#group-tabs .tab');
      if (tab) {
        if (tab.dataset.action === 'add-group') {
          e.preventDefault();
          enterEditMode();
          modalController.openModal('add-group');
          return;
        }

        const groupName = tab.dataset.groupName;
        if (!groupName) return;

        if (store.isEditMode && groupName === store.selectedGroup) {
          e.preventDefault();
          openGroupEditor(groupName);
          return;
        }

        e.preventDefault();
        store.setSelectedGroup(groupName);
        store.saveData();
        render();
        return;
      }

      const pinnedHeader = e.target.closest('.pinned-group-header');
      if (pinnedHeader && store.isEditMode) {
        e.preventDefault();
        openGroupEditor(pinnedHeader.dataset.groupName);
        return;
      }
    });
  }

  addCurrentBtn.addEventListener('click', async () => {
    const recent = await resolveRecentPage();
    if (!recent || !isHttpUrl(recent.url)) {
      setQuickActionStatus(
        'No recent page to add. Please open a website first, then return.',
        'err'
      );
      modalController.fillAddLinkModal('', '', store.selectedGroup);
      return;
    }

    setQuickActionStatus(`Retrieved: ${recent.title || recent.url}`, 'ok');
    modalController.fillAddLinkModal(
      recent.url,
      recent.title || autoTitle(recent.url),
      store.selectedGroup
    );
  });

  const syncController = createSyncController({
    applyImportedState: (imported) => store.applyImportedState(imported),
    dom,
    getRevision: () => store.syncRevision,
    getState: () => ({
      links: store.links,
      groups: store.groups,
      settings: store.settings,
      profileId: store.profileId,
      deletedMap: store.deletedMap,
      deletedGroupsMap: store.deletedGroupsMap
    }),
    persistCurrentProfile: () => store.persistCurrentProfile(),
    refreshSettingsControls,
    render,
    saveData: (options) => store.saveData(options),
    setRevision: (revision) => {
      store.syncRevision = revision;
    },
    switchProfile: (nextProfileId) => store.switchProfile(nextProfileId)
  });

  /* ========== KEYBOARD ========== */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      modalController.closeModal();
      settingsController.close();
      exitEditMode();
      return;
    }

    if (e.key === 'e' || e.key === 'E') {
      const activeEl = document.activeElement;
      const isInput =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.isContentEditable);
      const isModalOpen =
        !dom.modalOverlay.classList.contains('hidden') ||
        !dom.settingsOverlay.classList.contains('hidden');

      if (!isInput && !isModalOpen) {
        e.preventDefault();
        if (store.isEditMode) {
          exitEditMode();
        } else {
          enterEditMode();
        }
      }
    }
  });

  /* ========== AUTO-REFRESH ON EXTERNAL CHANGES ========== */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && store.suppressStorageSync) return;
    if (
      area === 'local' &&
      (changes.links ||
        changes.groups ||
        changes.settings ||
        changes.profiles ||
        changes.syncProfile)
    ) {
      let shouldApplyActiveProfile = false;
      if (changes.links) store.links = changes.links.newValue || [];
      if (changes.groups) {
        store.groups = Object.assign({}, store.groups, changes.groups.newValue || {});
        shouldApplyActiveProfile = true;
      }
      if (changes.settings) {
        store.settings = normalizeSettings(changes.settings.newValue);
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
    getLinksForGroup: (groupName) => store.getLinksForGroup(groupName),
    isEditMode: () => store.isEditMode,
    normalizeGroupOrders: (...groupNames) => store.normalizeGroupOrders(...groupNames),
    render,
    reorderLink: (draggedId, targetId, targetGroup) =>
      store.reorderLink(draggedId, targetId, targetGroup),
    reorderGroup: (draggedName, targetName) => store.reorderGroup(draggedName, targetName),
    reorderPinnedGroup: (draggedName, targetName) =>
      store.reorderPinnedGroup(draggedName, targetName),
    saveData: (options) => store.saveData(options)
  });
  bindEditModeActivation({
    enterEditMode,
    exitEditMode,
    isEditMode: () => store.isEditMode,
    isTouchDevice: IS_TOUCH_DEVICE
  });
  setEditMode(false);
  Promise.all([
    store.loadData(),
    store.loadFaviconCache(),
    syncController.loadSavedRevision(),
    syncController.loadSavedReady(),
    syncController.loadSavedPending(),
    syncController.loadSavedCredentials(),
    syncController.loadSavedStatuses()
  ]).then(([, , savedRevision]) => {
    store.syncRevision = savedRevision;
    render();
    requestAnimationFrame(() => {
      document.body.classList.remove('app-loading');
    });
    syncController.bootstrapCloud({ force: true }).catch(() => {});
    syncController.startAutoRestore();
  });
})();
