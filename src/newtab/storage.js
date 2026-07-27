import {
  DEFAULT_GROUPS,
  DEFAULT_LINKS,
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILES,
  DEFAULT_SETTINGS
} from '../shared/constants/home-defaults.js';
import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';
import { deepClone } from '../shared/utils/clone.js';
import {
  getDefaultFaviconUrl,
  getFaviconUrl,
  isHttpUrl,
  normalizeFaviconSource
} from '../shared/utils/link-utils.js';

export function normalizeSettings(settings) {
  const iconSize = Number(settings?.iconSize);
  return {
    iconSize: Number.isFinite(iconSize) ? iconSize : DEFAULT_SETTINGS.iconSize
  };
}

export function normalizeLinks(links) {
  if (!Array.isArray(links)) return [];
  return links
    .filter((link) => link && typeof link === 'object' && isHttpUrl(link.url))
    .map((link) => {
      const faviconSource = normalizeFaviconSource(link.faviconSource);
      return {
        ...link,
        faviconSource,
        faviconUrl: getFaviconUrl(link.url, faviconSource) || getDefaultFaviconUrl(link.url)
      };
    });
}

function normalizePinned(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value) return [value];
  return deepClone(DEFAULT_GROUPS.pinned);
}

function normalizeSelected(value, list, pinned) {
  if (typeof value === 'string' && list.includes(value)) return value;
  return list.find((g) => !pinned.includes(g)) || list[0] || '';
}

export function normalizeProfile(
  profile,
  fallbackGroups = DEFAULT_GROUPS,
  fallbackSettings = DEFAULT_SETTINGS
) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const groupList = Array.isArray(fallbackGroups?.list) ? fallbackGroups.list : DEFAULT_GROUPS.list;
  const fallbackPinned = Array.isArray(fallbackGroups?.pinned)
    ? fallbackGroups.pinned
    : DEFAULT_GROUPS.pinned;
  const pinned = normalizePinned(source.pinned ?? fallbackPinned).filter((g) =>
    groupList.includes(g)
  );
  const safePinned = pinned.length
    ? pinned
    : deepClone(fallbackPinned).filter((g) => groupList.includes(g));

  return {
    pinned: safePinned,
    selected: normalizeSelected(source.selected ?? fallbackGroups?.selected, groupList, safePinned),
    settings: normalizeSettings(Object.assign({}, fallbackSettings || {}, source.settings || {}))
  };
}

export function getProfileFromState(state) {
  return normalizeProfile(
    {
      pinned: state.groups.pinned,
      selected: state.groups.selected,
      settings: state.settings
    },
    state.groups,
    state.settings
  );
}

export function loadAppData(state) {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        STORAGE_KEYS.links,
        STORAGE_KEYS.groups,
        STORAGE_KEYS.settings,
        STORAGE_KEYS.profiles,
        STORAGE_KEYS.syncProfile
      ],
      (result) => {
        state.profileId = result[STORAGE_KEYS.syncProfile] || DEFAULT_PROFILE_ID;

        if (result[STORAGE_KEYS.links] && result[STORAGE_KEYS.links].length > 0) {
          state.links = normalizeLinks(result[STORAGE_KEYS.links]);
          state.groups = result[STORAGE_KEYS.groups] || deepClone(DEFAULT_GROUPS);
          if (typeof state.groups.pinned === 'string') {
            state.groups.pinned = [state.groups.pinned];
          }
        } else {
          state.links = normalizeLinks(deepClone(DEFAULT_LINKS));
          state.groups = deepClone(DEFAULT_GROUPS);
        }

        state.settings = normalizeSettings(result[STORAGE_KEYS.settings]);
        const savedProfiles = result[STORAGE_KEYS.profiles] || {};
        state.profiles = Object.assign(deepClone(DEFAULT_PROFILES), savedProfiles);

        const activeProfile = normalizeProfile(
          savedProfiles[state.profileId] || state.profiles[state.profileId] || null,
          state.groups,
          state.settings
        );
        state.profiles[state.profileId] = activeProfile;
        state.groups.pinned = activeProfile.pinned;
        state.groups.selected = activeProfile.selected;
        state.settings = activeProfile.settings;
        state.selectedGroup = state.groups.selected;
        resolve();
      }
    );
  });
}

export function saveAppData(state) {
  const profiles = Object.assign({}, state.profiles || {});
  profiles[state.profileId || DEFAULT_PROFILE_ID] = getProfileFromState(state);

  chrome.storage.local.set({
    [STORAGE_KEYS.links]: state.links,
    [STORAGE_KEYS.groups]: {
      list: state.groups.list
    },
    [STORAGE_KEYS.settings]: state.settings,
    [STORAGE_KEYS.profiles]: profiles,
    [STORAGE_KEYS.syncProfile]: state.profileId || DEFAULT_PROFILE_ID
  });

  state.profiles = profiles;
}
