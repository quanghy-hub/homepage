import { asArray, asObject } from './utils.js';

export const STATE_VERSION = 1;
export const DEFAULT_BACKUP_A_HOUR = 1;
export const DEFAULT_BACKUP_A_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const APP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const DELETED_MAP_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export function normalizeBackupAHour(_value) {
  return DEFAULT_BACKUP_A_HOUR;
}

export function normalizeTimeZone(_value) {
  return DEFAULT_BACKUP_A_TIME_ZONE;
}

export function normalizeDeletedMap(value, now = Date.now()) {
  const out = {};
  Object.entries(asObject(value)).forEach(([id, ts]) => {
    if (APP_ID_PATTERN.test(id) && Number.isSafeInteger(ts) && ts > now - DELETED_MAP_TTL_MS) {
      out[id] = ts;
    }
  });
  return out;
}

export function normalizeProfile(value, fallbackGroups = {}) {
  const profile = asObject(value);
  const normalized = {};
  const groupList = asArray(fallbackGroups.list);

  if (Object.prototype.hasOwnProperty.call(profile, 'settings')) {
    normalized.settings = asObject(profile.settings);
  }
  if (
    Object.prototype.hasOwnProperty.call(profile, 'pinned') ||
    asArray(fallbackGroups.pinned).length
  ) {
    const rawPinned = asArray(profile.pinned).length
      ? asArray(profile.pinned)
      : asArray(fallbackGroups.pinned);
    normalized.pinned = groupList.length
      ? rawPinned.filter((name) => groupList.includes(name))
      : rawPinned;
  }
  if (typeof profile.selected === 'string' || typeof fallbackGroups.selected === 'string') {
    const selected =
      typeof profile.selected === 'string' ? profile.selected : fallbackGroups.selected;
    normalized.selected = groupList.length && !groupList.includes(selected) ? '' : selected;
  }

  return normalized;
}

export function normalizeStoredState(value, appId) {
  const state = asObject(value);
  const groups = asObject(state.groups);
  const rawProfiles = asObject(state.profiles);
  const profiles = {};

  Object.entries(rawProfiles).forEach(([profileId, profile]) => {
    if (APP_ID_PATTERN.test(profileId)) {
      profiles[profileId] = normalizeProfile(profile, groups);
    }
  });

  const legacyProfileId = String(state.profileId || '').toLowerCase();
  if (!Object.keys(profiles).length && APP_ID_PATTERN.test(legacyProfileId)) {
    profiles[legacyProfileId] = normalizeProfile(null, groups);
  }

  return {
    version: STATE_VERSION,
    appId,
    links: asArray(state.links),
    groups: {
      list: asArray(groups.list),
      pinned: asArray(groups.pinned),
      selected: typeof groups.selected === 'string' ? groups.selected : ''
    },
    profiles,
    deletedMap: normalizeDeletedMap(state.deletedMap),
    revision: Number.isSafeInteger(state.revision) ? state.revision : 0,
    updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : null,
    backupAHour: normalizeBackupAHour(state.backupAHour),
    backupATimeZone: normalizeTimeZone(state.backupATimeZone),
    backupSlot: typeof state.backupSlot === 'string' ? state.backupSlot : null,
    backupUpdatedAt: typeof state.backupUpdatedAt === 'string' ? state.backupUpdatedAt : null,
    backupADateKey: typeof state.backupADateKey === 'string' ? state.backupADateKey : null
  };
}
