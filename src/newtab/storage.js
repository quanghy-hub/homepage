import { DEFAULT_GROUPS, DEFAULT_LINKS, DEFAULT_SETTINGS } from '../shared/constants/home-defaults.js';
import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';
import { deepClone } from '../shared/utils/clone.js';

export function loadAppData(state) {
    return new Promise(resolve => {
        chrome.storage.local.get([
            STORAGE_KEYS.links,
            STORAGE_KEYS.groups,
            STORAGE_KEYS.settings
        ], result => {
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
            state.selectedGroup = state.groups.selected || state.groups.list.find(g => !state.groups.pinned.includes(g)) || state.groups.list[0];
            resolve();
        });
    });
}

export function saveAppData(state) {
    chrome.storage.local.set({
        [STORAGE_KEYS.links]: state.links,
        [STORAGE_KEYS.groups]: state.groups,
        [STORAGE_KEYS.settings]: state.settings
    });
}
