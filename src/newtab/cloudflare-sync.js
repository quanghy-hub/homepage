import { DEFAULT_PROFILE_ID } from '../shared/constants/home-defaults.js';
import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';

export const SYNC_APP_ID = 'homepage';
export const DEFAULT_WORKER_URL = 'https://extension.quavav15-6.workers.dev';
export const PROFILE_IDS = ['macbook', 'mobile'];
export const SYNC_MODES = ['manual', 'auto'];
export const DEFAULT_SYNC_MODE = 'manual';

export function setSyncStatus(dom, msg, type = '') {
    dom.syncStatus.textContent = msg;
    dom.syncStatus.className = 'sync-status' + (type ? ' ' + type : '');
}

export function setVerifyStatus(dom, msg, type = '') {
    if (!dom.syncVerifyStatus) return;
    dom.syncVerifyStatus.textContent = msg;
    dom.syncVerifyStatus.className = 'sync-status' + (type ? ' ' + type : '');
}

export function getSyncSettings(dom) {
    const workerUrl = dom.syncWorkerUrlInput.value.trim().replace(/\/+$/, '');
    const apiCode = dom.syncApiCodeInput.value.trim();
    const profileId = PROFILE_IDS.includes(dom.syncProfileSelect.value)
        ? dom.syncProfileSelect.value
        : DEFAULT_PROFILE_ID;
    const syncMode = SYNC_MODES.includes(dom.syncModeSelect?.value)
        ? dom.syncModeSelect.value
        : DEFAULT_SYNC_MODE;

    return { workerUrl, apiCode, profileId, syncMode };
}

export function getStateEndpoint(workerUrl) {
    if (!workerUrl) return '';
    return `${workerUrl.replace(/\/+$/, '')}/sync/${SYNC_APP_ID}/state`;
}

export function getSyncHeaders(apiCode) {
    if (!apiCode) return null;
    return {
        Authorization: 'Bearer ' + apiCode,
        'Content-Type': 'application/json'
    };
}

function buildConfiguredSync(dom) {
    const config = getSyncSettings(dom);
    const endpoint = getStateEndpoint(config.workerUrl);
    const headers = getSyncHeaders(config.apiCode);

    if (!config.workerUrl) throw new Error('Nhập Worker URL trước');
    if (!headers) throw new Error('Nhập API code trước');

    return { ...config, endpoint, headers };
}

export function bindSyncCredentialInputs(dom, handlers = {}) {
    const onProfileChange = typeof handlers === 'function' ? handlers : handlers.onProfileChange;
    const onConfigChange = typeof handlers === 'object' ? handlers.onConfigChange : null;
    const onModeChange = typeof handlers === 'object' ? handlers.onModeChange : null;

    function markNeedsInitialPull() {
        chrome.storage.local.set({ [STORAGE_KEYS.syncReady]: false });
        if (onConfigChange) onConfigChange();
    }

    dom.syncWorkerUrlInput.addEventListener('input', () => {
        chrome.storage.local.set({ [STORAGE_KEYS.syncWorkerUrl]: dom.syncWorkerUrlInput.value.trim() });
        markNeedsInitialPull();
    });

    dom.syncApiCodeInput.addEventListener('input', () => {
        chrome.storage.local.set({ [STORAGE_KEYS.syncApiCode]: dom.syncApiCodeInput.value.trim() });
        markNeedsInitialPull();
    });

    dom.syncProfileSelect.addEventListener('change', () => {
        const profileId = PROFILE_IDS.includes(dom.syncProfileSelect.value)
            ? dom.syncProfileSelect.value
            : DEFAULT_PROFILE_ID;
        if (onProfileChange) onProfileChange(profileId);
    });

    dom.syncModeSelect?.addEventListener('change', () => {
        const syncMode = SYNC_MODES.includes(dom.syncModeSelect.value)
            ? dom.syncModeSelect.value
            : DEFAULT_SYNC_MODE;
        chrome.storage.local.set({ [STORAGE_KEYS.syncMode]: syncMode });
        if (onModeChange) onModeChange(syncMode);
    });
}

export function loadSavedSyncCredentials(dom) {
    chrome.storage.local.get([
        STORAGE_KEYS.syncWorkerUrl,
        STORAGE_KEYS.syncApiCode,
        STORAGE_KEYS.syncProfile,
        STORAGE_KEYS.syncMode
    ], result => {
        dom.syncWorkerUrlInput.value = result[STORAGE_KEYS.syncWorkerUrl] || DEFAULT_WORKER_URL;
        dom.syncApiCodeInput.value = result[STORAGE_KEYS.syncApiCode] || '';
        dom.syncProfileSelect.value = PROFILE_IDS.includes(result[STORAGE_KEYS.syncProfile])
            ? result[STORAGE_KEYS.syncProfile]
            : DEFAULT_PROFILE_ID;
        if (dom.syncModeSelect) {
            dom.syncModeSelect.value = SYNC_MODES.includes(result[STORAGE_KEYS.syncMode])
                ? result[STORAGE_KEYS.syncMode]
                : DEFAULT_SYNC_MODE;
        }
    });
}

export function loadSavedSyncRevision() {
    return new Promise(resolve => {
        chrome.storage.local.get([STORAGE_KEYS.syncRevision], result => {
            const revision = result[STORAGE_KEYS.syncRevision];
            resolve(Number.isSafeInteger(revision) ? revision : null);
        });
    });
}

export function saveSyncRevision(revision) {
    if (!Number.isSafeInteger(revision)) return;
    chrome.storage.local.set({ [STORAGE_KEYS.syncRevision]: revision });
}

export function loadSyncReady() {
    return new Promise(resolve => {
        chrome.storage.local.get([STORAGE_KEYS.syncReady], result => {
            resolve(result[STORAGE_KEYS.syncReady] === true);
        });
    });
}

export function saveSyncReady(isReady) {
    chrome.storage.local.set({ [STORAGE_KEYS.syncReady]: isReady === true });
}

export function buildExportData(state, baseRevision = null) {
    return {
        version: 1,
        appId: SYNC_APP_ID,
        profileId: state.profileId,
        baseRevision,
        links: state.links,
        groups: {
            list: state.groups.list
        },
        profile: {
            settings: state.settings,
            pinned: state.groups.pinned,
            selected: state.groups.selected
        }
    };
}

export async function verifyCloudflareSync(dom) {
    const { endpoint, headers } = buildConfiguredSync(dom);
    const res = await fetch(endpoint, {
        method: 'GET',
        headers
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function pullCloudflareState(dom) {
    const { endpoint, headers } = buildConfiguredSync(dom);
    const res = await fetch(endpoint, {
        method: 'GET',
        headers
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
}

export async function pushCloudflareState(dom, state, baseRevision = null) {
    const { endpoint, headers } = buildConfiguredSync(dom);
    const res = await fetch(endpoint, {
        method: 'PUT',
        headers,
        body: JSON.stringify(buildExportData(state, baseRevision))
    });

    if (res.status === 409) {
        throw new Error('Cloud đã có dữ liệu mới hơn. Hãy kéo về rồi kiểm tra lại trước khi đẩy.');
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
}
