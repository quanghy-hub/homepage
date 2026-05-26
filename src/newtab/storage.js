import { DEFAULT_GROUPS, DEFAULT_LINKS, DEFAULT_PROFILE_ID, DEFAULT_PROFILES, DEFAULT_SETTINGS } from '../shared/constants/home-defaults.js';
import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';
import { deepClone } from '../shared/utils/clone.js';

function normalizePinned(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value) return [value];
    return deepClone(DEFAULT_GROUPS.pinned);
}

function normalizeSelected(value, list, pinned) {
    if (typeof value === 'string' && list.includes(value)) return value;
    return list.find(g => !pinned.includes(g)) || list[0] || '';
}

export function normalizeProfile(profile, fallbackGroups = DEFAULT_GROUPS, fallbackSettings = DEFAULT_SETTINGS) {
    const list = Array.isArray(fallbackGroups.list) ? fallbackGroups.list : DEFAULT_GROUPS.list;
    const fallbackPinned = normalizePinned(fallbackGroups.pinned);
    const source = profile && typeof profile === 'object' ? profile : {};
    const pinned = normalizePinned(source.pinned || fallbackPinned).filter(g => list.includes(g));
    const defaultPinned = normalizePinned(DEFAULT_GROUPS.pinned).filter(g => list.includes(g));
    const safePinned = pinned.length ? pinned : (defaultPinned.length ? defaultPinned : [list[0]].filter(Boolean));

    return {
        pinned: safePinned,
        selected: normalizeSelected(source.selected || fallbackGroups.selected, list, safePinned),
        settings: Object.assign({}, DEFAULT_SETTINGS, fallbackSettings || {}, source.settings || {})
    };
}

export function getProfileFromState(state) {
    return normalizeProfile({
        pinned: state.groups?.pinned,
        selected: state.groups?.selected,
        settings: state.settings
    }, state.groups, state.settings);
}

export function loadAppData(state) {
    return new Promise(resolve => {
        chrome.storage.local.get([
            STORAGE_KEYS.links,
            STORAGE_KEYS.groups,
            STORAGE_KEYS.settings,
            STORAGE_KEYS.profiles,
            STORAGE_KEYS.syncProfile
        ], result => {
            state.profileId = result[STORAGE_KEYS.syncProfile] || DEFAULT_PROFILE_ID;

            if (result[STORAGE_KEYS.links] && result[STORAGE_KEYS.links].length > 0) {
                state.links = result[STORAGE_KEYS.links];
                state.groups = result[STORAGE_KEYS.groups] || deepClone(DEFAULT_GROUPS);
                if (typeof state.groups.pinned === 'string') {
                    state.groups.pinned = [state.groups.pinned];
                }
            } else {
                state.links = deepClone(DEFAULT_LINKS);
                state.groups = deepClone(DEFAULT_GROUPS);
            }

            state.settings = Object.assign({}, DEFAULT_SETTINGS, result[STORAGE_KEYS.settings] || {});
            const savedProfiles = result[STORAGE_KEYS.profiles] || {};
            state.profiles = Object.assign(deepClone(DEFAULT_PROFILES), savedProfiles);

            const activeProfile = normalizeProfile(
                savedProfiles[state.profileId] || null,
                state.groups,
                state.settings
            );
            state.profiles[state.profileId] = activeProfile;
            state.groups.pinned = activeProfile.pinned;
            state.groups.selected = activeProfile.selected;
            state.settings = activeProfile.settings;
            state.selectedGroup = activeProfile.selected;
            resolve();
        });
    });
}

export function saveAppData(state) {
    const profiles = Object.assign({}, state.profiles || {});
    profiles[state.profileId || DEFAULT_PROFILE_ID] = getProfileFromState(state);

    chrome.storage.local.set({
        [STORAGE_KEYS.links]: state.links,
        [STORAGE_KEYS.groups]: {
            list: state.groups.list,
            pinned: state.groups.pinned,
            selected: state.groups.selected
        },
        [STORAGE_KEYS.settings]: state.settings,
        [STORAGE_KEYS.profiles]: profiles,
        [STORAGE_KEYS.syncProfile]: state.profileId || DEFAULT_PROFILE_ID
    });

    state.profiles = profiles;
}
