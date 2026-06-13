import { asArray, asObject } from './utils.js';

export const STATE_VERSION = 1;
export const DEFAULT_BACKUP_A_HOUR = 1;
export const DEFAULT_BACKUP_A_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const APP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function normalizeBackupAHour(value) {
  return DEFAULT_BACKUP_A_HOUR;
}

export function normalizeTimeZone(value) {
  return DEFAULT_BACKUP_A_TIME_ZONE;
}

export function normalizeSession(session, index) {
  const s = asObject(session);
  return {
    name: typeof s.name === 'string' ? s.name : `Session ${index + 1}`,
    updatedAt: Number.isSafeInteger(s.updatedAt) ? s.updatedAt : null,
    cookies: asArray(s.cookies),
    localStorage: asObject(s.localStorage),
    sessionStorage: asObject(s.sessionStorage)
  };
}

export function normalizeSite(site) {
  const s = asObject(site);
  return {
    id: typeof s.id === 'string' ? s.id : '',
    origin: typeof s.origin === 'string' ? s.origin : '',
    host: typeof s.host === 'string' ? s.host : '',
    activeSlot: Number.isInteger(s.activeSlot) ? s.activeSlot : null,
    sessions: asArray(s.sessions).map((session, index) => normalizeSession(session, index))
  };
}

export function normalizeProfile(value, fallbackGroups = {}) {
  const profile = asObject(value);
  const normalized = {};
  const groupList = asArray(fallbackGroups.list);

  if (Object.prototype.hasOwnProperty.call(profile, 'sites')) {
    normalized.sites = asArray(profile.sites).map(normalizeSite);
  }
  if (Object.prototype.hasOwnProperty.call(profile, 'settings')) {
    normalized.settings = asObject(profile.settings);
  }
  if (Object.prototype.hasOwnProperty.call(profile, 'pinned') || asArray(fallbackGroups.pinned).length) {
    const rawPinned = asArray(profile.pinned).length ? asArray(profile.pinned) : asArray(fallbackGroups.pinned);
    normalized.pinned = groupList.length ? rawPinned.filter(name => groupList.includes(name)) : rawPinned;
  }
  if (typeof profile.selected === 'string' || typeof fallbackGroups.selected === 'string') {
    const selected = typeof profile.selected === 'string' ? profile.selected : fallbackGroups.selected;
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
    revision: Number.isSafeInteger(state.revision) ? state.revision : 0,
    updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : null,
    backupAHour: normalizeBackupAHour(state.backupAHour),
    backupATimeZone: normalizeTimeZone(state.backupATimeZone),
    backupSlot: typeof state.backupSlot === 'string' ? state.backupSlot : null,
    backupUpdatedAt: typeof state.backupUpdatedAt === 'string' ? state.backupUpdatedAt : null,
    backupADateKey: typeof state.backupADateKey === 'string' ? state.backupADateKey : null
  };
}
