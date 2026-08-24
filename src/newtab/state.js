import { DEFAULT_PROFILE_ID } from '../shared/constants/home-defaults.js';
import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';
import {
  getProfileFromState,
  loadAppData,
  normalizeLinks,
  normalizeProfile,
  saveAppData
} from './storage.js';
import { mergeDeletedMaps } from './sync-api.js';
import { saveSyncPending } from './cloudflare-sync.js';

const FAVICON_CACHE_MAX_CHARS = 2_500_000; // keep storage.local writes well under quota
// The UI relies on at least one pinned + one unpinned group to stay navigable.
const MIN_GROUP_COUNT = 2;

export class StateStore {
  constructor() {
    this.links = [];
    this.groups = {};
    this.settings = {};
    this.profiles = {};
    this.profileId = DEFAULT_PROFILE_ID;
    this.selectedGroup = '';
    this.faviconCache = {};
    this.deletedMap = {};
    this.deletedGroupsMap = {};
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
      this.deletedMap = state.deletedMap || {};
      this.deletedGroupsMap = state.deletedGroupsMap || {};
    });
  }

  loadFaviconCache() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEYS.faviconCache], (result) => {
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
      profileId: this.profileId,
      deletedMap: this.deletedMap,
      deletedGroupsMap: this.deletedGroupsMap
    }).finally(() => {
      this.suppressStorageSync = false;
    });
    if (!options.skipAutoSync) {
      // Remember that the cloud may be stale until a push confirms otherwise,
      // so a reload/kill before the debounce fires cannot silently lose edits.
      saveSyncPending(true);
      this.onScheduleSync();
    }
  }

  persistFaviconCache() {
    chrome.storage.local.set({ [STORAGE_KEYS.faviconCache]: this.faviconCache }, () => {
      if (!chrome.runtime?.lastError) return;
      // Quota exceeded (or another write error): evict the oldest entries and retry once.
      this.pruneFaviconCache(FAVICON_CACHE_MAX_CHARS / 2);
      chrome.storage.local.set({ [STORAGE_KEYS.faviconCache]: this.faviconCache }, () => {});
    });
  }

  pruneFaviconCache(maxChars = FAVICON_CACHE_MAX_CHARS) {
    const cache = this.faviconCache || {};
    const size = () => JSON.stringify(cache).length;
    if (size() <= maxChars) return;

    const entries = Object.entries(cache)
      .filter(([, entry]) => entry && Number.isFinite(entry.updatedAt))
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);

    for (const [key] of entries) {
      delete cache[key];
      if (size() <= maxChars) break;
    }
  }

  persistCurrentProfile() {
    this.profiles[this.profileId] = getProfileFromState({
      groups: this.groups,
      settings: this.settings
    });
  }

  applyActiveProfileToGroups() {
    const activeProfile = normalizeProfile(
      this.profiles[this.profileId],
      this.groups,
      this.settings
    );
    this.profiles[this.profileId] = activeProfile;
    this.groups.pinned = [...activeProfile.pinned];
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
    this.groups.pinned = [...nextProfile.pinned];
    this.groups.selected = nextProfile.selected;
    this.settings = nextProfile.settings;
    this.selectedGroup = this.groups.selected;

    this.saveData({ skipAutoSync: true });
    this.onRefreshSettings();
    this.onRender();
  }

  getLinksForGroup(groupName) {
    return this.links.filter((l) => l.parent === groupName).sort((a, b) => a.order - b.order);
  }

  normalizeGroupOrders(...groupNames) {
    [...new Set(groupNames.filter(Boolean))].forEach((groupName) => {
      this.getLinksForGroup(groupName).forEach((link, index) => {
        link.order = index;
      });
    });
  }

  getFallbackSelected(pinned = this.groups.pinned) {
    return this.groups.list.find((g) => !pinned.includes(g)) || this.groups.list[0] || '';
  }

  setSelectedGroup(groupName) {
    this.selectedGroup = groupName;
    this.groups.selected = groupName;
  }

  renameGroupInProfiles(oldName, newName) {
    Object.keys(this.profiles).forEach((id) => {
      const profile = this.profiles[id] || {};
      const pinned = Array.isArray(profile.pinned)
        ? profile.pinned.map((groupName) => (groupName === oldName ? newName : groupName))
        : this.groups.pinned;
      const selected = profile.selected === oldName ? newName : profile.selected;
      this.profiles[id] = normalizeProfile(
        { ...profile, pinned, selected },
        this.groups,
        profile.settings || this.settings
      );
    });
  }

  removeGroupFromProfiles(groupName) {
    Object.keys(this.profiles).forEach((id) => {
      const profile = this.profiles[id] || {};
      const pinned = Array.isArray(profile.pinned)
        ? profile.pinned.filter((name) => name !== groupName)
        : this.groups.pinned;
      const selected = profile.selected === groupName ? '' : profile.selected;
      this.profiles[id] = normalizeProfile(
        { ...profile, pinned, selected },
        this.groups,
        profile.settings || this.settings
      );
    });
  }

  /**
   * Records group-name tombstones so two-way sync drops the names instead of
   * resurrecting them (deletion and rename both funnel through here).
   */
  recordDeletedGroups(...groupNames) {
    const now = Date.now();
    groupNames.filter(Boolean).forEach((groupName) => {
      if (!this.deletedGroupsMap[groupName]) {
        this.deletedGroupsMap[groupName] = now;
      }
    });
  }

  setEditMode(nextValue) {
    this.isEditMode = !!nextValue;
    document.body.classList.toggle('edit-mode', this.isEditMode);
  }

  reorderLink(draggedId, targetId, targetGroup) {
    const dragged = this.links.find((l) => l._id === draggedId);
    const target = this.links.find((l) => l._id === targetId);
    if (!dragged || !target) return;
    const sourceGroup = dragged.parent;

    if (targetGroup && dragged.parent !== targetGroup) {
      // Moving across groups must bump updatedAt so LWW sync keeps the move.
      dragged.updatedAt = Date.now();
    }
    dragged.parent = targetGroup || target.parent;

    const groupLinks = this.getLinksForGroup(dragged.parent);
    const filtered = groupLinks.filter((l) => l._id !== draggedId);
    const targetIdx = filtered.findIndex((l) => l._id === targetId);

    if (targetIdx !== -1) {
      filtered.splice(targetIdx, 0, dragged);
    } else {
      filtered.push(dragged);
    }

    filtered.forEach((l, i) => (l.order = i));
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
      this.groups.pinned = this.groups.pinned.filter((p) => p !== groupName);
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
    if (!groupName || this.groups.list.length <= MIN_GROUP_COUNT) return;

    const deletedAt = Date.now();
    this.recordDeletedGroups(groupName);
    this.groups.list = this.groups.list.filter((x) => x !== groupName);
    this.groups.pinned = this.groups.pinned.filter((x) => x !== groupName);

    const remaining = [];
    this.links.forEach((link) => {
      if (link.parent === groupName) {
        this.deletedMap[link._id] = deletedAt;
      } else {
        remaining.push(link);
      }
    });
    this.links = remaining;

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
    const target = this.links.find((l) => l._id === linkId);
    if (!target) return;

    this.deletedMap[linkId] = Date.now();
    this.links = this.links.filter((l) => l._id !== linkId);
    const sameGroup = this.getLinksForGroup(target.parent);
    sameGroup.forEach((item, idx) => {
      item.order = idx;
    });
    this.saveData();
    this.onRender();
  }

  applyImportedState(imported) {
    if (!imported || typeof imported !== 'object') return;

    this.deletedMap = mergeDeletedMaps(this.deletedMap, imported.deletedMap);
    this.deletedGroupsMap = mergeDeletedMaps(this.deletedGroupsMap, imported.deletedGroupsMap);

    if (Array.isArray(imported.links)) {
      this.links = normalizeLinks(imported.links).filter((link) => {
        const ts = this.deletedMap[link._id];
        return !ts || (link.updatedAt && link.updatedAt > ts);
      });
    }

    const isGroupDeleted = (groupName) => Boolean(this.deletedGroupsMap[groupName]);

    if (Array.isArray(imported.groups?.list)) {
      // Drop groups tombstoned on any device so deletions/renames stick.
      this.groups.list = imported.groups.list.filter((name) => !isGroupDeleted(name));
    }

    this.profiles = Object.assign({}, this.profiles, imported.profiles || {});
    const activeProfile = normalizeProfile(
      this.profiles[this.profileId],
      imported.groups || this.groups,
      this.settings
    );
    this.profiles[this.profileId] = activeProfile;
    this.groups.pinned = [...activeProfile.pinned];
    this.groups.selected = activeProfile.selected;
    this.settings = activeProfile.settings;
    this.selectedGroup = this.groups.selected;
  }
}
