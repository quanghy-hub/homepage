import { DEFAULT_PROFILE_ID } from '../shared/constants/home-defaults.js';
import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';
import { getProfileFromState, loadAppData, normalizeLinks, normalizeProfile, saveAppData } from './storage.js';

export class StateStore {
  constructor() {
    this.links = [];
    this.groups = {};
    this.settings = {};
    this.profiles = {};
    this.profileId = DEFAULT_PROFILE_ID;
    this.selectedGroup = '';
    this.faviconCache = {};
    this.suppressStorageSync = false;
    this.isEditMode = false;
    this.syncRevision = null;

    // Callbacks to notify UI coordinator
    this.onRender = () => {};
    this.onRefreshSettings = () => {};
    this.onScheduleSync = () => {};
  }

  loadData() {
    const state = {
      links: this.links,
      groups: this.groups,
      settings: this.settings,
      profiles: this.profiles,
      profileId: this.profileId,
      selectedGroup: this.selectedGroup
    };
    return loadAppData(state).then(() => {
      this.links = state.links;
      this.groups = state.groups;
      this.settings = state.settings;
      this.profiles = state.profiles;
      this.profileId = state.profileId;
      this.selectedGroup = state.selectedGroup;
    });
  }

  loadFaviconCache() {
    return new Promise(resolve => {
      chrome.storage.local.get([STORAGE_KEYS.faviconCache], result => {
        this.faviconCache = result[STORAGE_KEYS.faviconCache] || {};
        resolve();
      });
    });
  }

  saveData(options = {}) {
    this.suppressStorageSync = true;
    saveAppData({
      links: this.links,
      groups: this.groups,
      settings: this.settings,
      profiles: this.profiles,
      profileId: this.profileId
    });
    setTimeout(() => {
      this.suppressStorageSync = false;
    }, 0);
    if (!options.skipAutoSync) {
      this.onScheduleSync();
    }
  }

  persistFaviconCache() {
    chrome.storage.local.set({
      [STORAGE_KEYS.faviconCache]: this.faviconCache
    });
  }

  persistCurrentProfile() {
    this.profiles[this.profileId] = getProfileFromState({
      groups: this.groups,
      settings: this.settings
    });
  }

  applyActiveProfileToGroups() {
    const activeProfile = normalizeProfile(this.profiles[this.profileId], this.groups, this.settings);
    this.profiles[this.profileId] = activeProfile;
    this.groups.pinned = activeProfile.pinned;
    this.groups.selected = activeProfile.selected;
    this.settings = activeProfile.settings;
    this.selectedGroup = this.groups.selected;
  }

  switchProfile(nextProfileId) {
    if (!nextProfileId || nextProfileId === this.profileId) return;
    this.persistCurrentProfile();
    this.profileId = nextProfileId;

    const nextProfile = normalizeProfile(this.profiles[this.profileId], this.groups, this.settings);
    this.profiles[this.profileId] = nextProfile;
    this.groups.pinned = nextProfile.pinned;
    this.groups.selected = nextProfile.selected;
    this.settings = nextProfile.settings;
    this.selectedGroup = this.groups.selected;

    this.saveData({ skipAutoSync: true });
    this.onRefreshSettings();
    this.onRender();
  }

  getLinksForGroup(groupName) {
    return this.links
      .filter(l => l.parent === groupName)
      .sort((a, b) => a.order - b.order);
  }

  normalizeGroupOrders(...groupNames) {
    [...new Set(groupNames.filter(Boolean))].forEach(groupName => {
      this.getLinksForGroup(groupName).forEach((link, index) => {
        link.order = index;
      });
    });
  }

  getFallbackSelected(pinned = this.groups.pinned) {
    return this.groups.list.find(g => !pinned.includes(g)) || this.groups.list[0] || '';
  }

  setSelectedGroup(groupName) {
    this.selectedGroup = groupName;
    this.groups.selected = groupName;
  }

  renameGroupInProfiles(oldName, newName) {
    Object.keys(this.profiles).forEach(id => {
      const profile = this.profiles[id] || {};
      const pinned = Array.isArray(profile.pinned)
        ? profile.pinned.map(groupName => groupName === oldName ? newName : groupName)
        : this.groups.pinned;
      const selected = profile.selected === oldName ? newName : profile.selected;
      this.profiles[id] = normalizeProfile({ ...profile, pinned, selected }, this.groups, profile.settings || this.settings);
    });
  }

  removeGroupFromProfiles(groupName) {
    Object.keys(this.profiles).forEach(id => {
      const profile = this.profiles[id] || {};
      const pinned = Array.isArray(profile.pinned)
        ? profile.pinned.filter(name => name !== groupName)
        : this.groups.pinned;
      const selected = profile.selected === groupName ? '' : profile.selected;
      this.profiles[id] = normalizeProfile({ ...profile, pinned, selected }, this.groups, profile.settings || this.settings);
    });
  }

  setEditMode(nextValue) {
    this.isEditMode = !!nextValue;
    document.body.classList.toggle('edit-mode', this.isEditMode);
  }

  reorderLink(draggedId, targetId, targetGroup) {
    const dragged = this.links.find(l => l._id === draggedId);
    const target = this.links.find(l => l._id === targetId);
    if (!dragged || !target) return;
    const sourceGroup = dragged.parent;

    dragged.parent = targetGroup || target.parent;

    const groupLinks = this.getLinksForGroup(dragged.parent);
    const filtered = groupLinks.filter(l => l._id !== draggedId);
    const targetIdx = filtered.findIndex(l => l._id === targetId);

    if (targetIdx !== -1) {
      filtered.splice(targetIdx, 0, dragged);
    } else {
      filtered.push(dragged);
    }

    filtered.forEach((l, i) => l.order = i);
    this.normalizeGroupOrders(sourceGroup, dragged.parent);

    this.saveData();
    this.onRender();
  }

  reorderGroup(draggedName, targetName) {
    const draggedIdx = this.groups.list.indexOf(draggedName);
    const targetIdx = this.groups.list.indexOf(targetName);
    if (draggedIdx === -1 || targetIdx === -1) return;

    this.groups.list.splice(draggedIdx, 1);
    this.groups.list.splice(targetIdx, 0, draggedName);

    this.saveData();
    this.onRender();
  }

  reorderPinnedGroup(draggedName, targetName) {
    const draggedIdx = this.groups.pinned.indexOf(draggedName);
    const targetIdx = this.groups.pinned.indexOf(targetName);
    if (draggedIdx === -1 || targetIdx === -1) return;

    this.groups.pinned.splice(draggedIdx, 1);
    this.groups.pinned.splice(targetIdx, 0, draggedName);

    this.saveData();
    this.onRender();
  }

  togglePinGroup(groupName) {
    if (!groupName) return;

    if (this.groups.pinned.includes(groupName)) {
      this.groups.pinned = this.groups.pinned.filter(p => p !== groupName);
      if (this.selectedGroup === groupName || !this.selectedGroup) {
        this.selectedGroup = this.getFallbackSelected();
      }
    } else {
      this.groups.pinned.push(groupName);
      if (this.selectedGroup === groupName) {
        this.selectedGroup = this.getFallbackSelected();
      }
    }

    this.groups.selected = this.selectedGroup;
    this.saveData();
    this.onRender();
  }

  deleteGroup(groupName) {
    if (!groupName || this.groups.list.length <= 2) return;

    this.groups.list = this.groups.list.filter(x => x !== groupName);
    this.groups.pinned = this.groups.pinned.filter(x => x !== groupName);
    this.links = this.links.filter(l => l.parent !== groupName);

    if (this.selectedGroup === groupName) {
      this.selectedGroup = this.getFallbackSelected();
    }

    this.groups.selected = this.selectedGroup;
    this.removeGroupFromProfiles(groupName);
    this.saveData();
    this.onRender();
  }

  deleteLink(linkId) {
    if (!linkId) return;
    const target = this.links.find(l => l._id === linkId);
    if (!target) return;

    this.links = this.links.filter(l => l._id !== linkId);
    const sameGroup = this.getLinksForGroup(target.parent);
    sameGroup.forEach((item, idx) => { item.order = idx; });
    this.saveData();
    this.onRender();
  }

  applyImportedState(imported) {
    if (!imported || typeof imported !== 'object') return;

    if (Array.isArray(imported.links)) {
      this.links = normalizeLinks(imported.links);
    }

    if (Array.isArray(imported.groups?.list)) {
      this.groups.list = imported.groups.list;
    }

    this.profiles = Object.assign({}, this.profiles, imported.profiles || {});
    const activeProfile = normalizeProfile(this.profiles[this.profileId], imported.groups || this.groups, this.settings);
    this.profiles[this.profileId] = activeProfile;
    this.groups.pinned = activeProfile.pinned;
    this.groups.selected = activeProfile.selected;
    this.settings = activeProfile.settings;
    this.selectedGroup = this.groups.selected;
  }
}
