import { VF_DEF, VF_STORE } from './constants.js';

export function createConfigState() {
    const cfg = {};
    Object.keys(VF_DEF).forEach(key => {
        cfg[key] = VF_DEF[key];
    });
    return cfg;
}

export function loadConfig(cfg) {
    try {
        chrome.storage.local.get(VF_STORE, data => {
            const saved = data[VF_STORE];
            if (saved) {
                Object.keys(VF_DEF).forEach(key => {
                    if (saved[key] !== undefined) cfg[key] = saved[key];
                });
            }
        });
    } catch (e) { }
}

export function saveConfigValue(cfg, key, value) {
    cfg[key] = value;
    try {
        chrome.storage.local.get(VF_STORE, data => {
            const saved = data[VF_STORE] || {};
            saved[key] = value;
            chrome.storage.local.set({ [VF_STORE]: saved });
        });
    } catch (e) { }
}

export function bindConfigSync(cfg) {
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes[VF_STORE]) {
                const newVal = changes[VF_STORE].newValue;
                if (newVal) {
                    Object.keys(VF_DEF).forEach(key => {
                        if (newVal[key] !== undefined) cfg[key] = newVal[key];
                    });
                }
            }
        });
    } catch (e) { }
}
