import { DEFAULT_PROFILE_ID } from '../shared/constants/home-defaults.js';
import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';

export const SYNC_APP_ID = 'homepage';
export const DEFAULT_WORKER_URL = 'https://extension.quavav15-6.workers.dev';
export const PROFILE_IDS = ['macbook', 'mobile'];
export const BACKUP_SLOTS = ['a', 'b'];
export const DEFAULT_SYNC_DELAY_SECONDS = 5;
const MIN_SYNC_DELAY_SECONDS = 1;
const MAX_SYNC_DELAY_SECONDS = 3600;

function normalizeDelaySeconds(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_SYNC_DELAY_SECONDS;
    return Math.min(MAX_SYNC_DELAY_SECONDS, Math.max(MIN_SYNC_DELAY_SECONDS, Math.round(parsed)));
}

export function setSyncStatus(dom, msg, type = '') {
    dom.syncStatus.textContent = msg;
    dom.syncStatus.className = 'sync-status' + (type ? ' ' + type : '');
    chrome.storage.local.set({
        [STORAGE_KEYS.syncStatus]: msg,
        [STORAGE_KEYS.syncStatusType]: type
    });
}

export function setVerifyStatus(dom, msg, type = '') {
    if (!dom.syncVerifyStatus) return;
    dom.syncVerifyStatus.textContent = msg;
    dom.syncVerifyStatus.className = 'sync-status' + (type ? ' ' + type : '');
    chrome.storage.local.set({
        [STORAGE_KEYS.syncVerifyStatus]: msg,
        [STORAGE_KEYS.syncVerifyStatusType]: type
    });
}

export function loadSavedSyncStatuses(dom) {
    return new Promise(resolve => {
        chrome.storage.local.get([
            STORAGE_KEYS.syncStatus,
            STORAGE_KEYS.syncStatusType,
            STORAGE_KEYS.syncVerifyStatus,
            STORAGE_KEYS.syncVerifyStatusType
        ], result => {
            if (result[STORAGE_KEYS.syncStatus]) {
                dom.syncStatus.textContent = result[STORAGE_KEYS.syncStatus];
                dom.syncStatus.className = 'sync-status' + (result[STORAGE_KEYS.syncStatusType] ? ' ' + result[STORAGE_KEYS.syncStatusType] : '');
            }
            if (dom.syncVerifyStatus && result[STORAGE_KEYS.syncVerifyStatus]) {
                dom.syncVerifyStatus.textContent = result[STORAGE_KEYS.syncVerifyStatus];
                dom.syncVerifyStatus.className = 'sync-status' + (result[STORAGE_KEYS.syncVerifyStatusType] ? ' ' + result[STORAGE_KEYS.syncVerifyStatusType] : '');
            }
            resolve();
        });
    });
}

export function getSyncSettings(dom) {
    const workerUrl = dom.syncWorkerUrlInput.value.trim().replace(/\/+$/, '');
    const apiCode = dom.syncApiCodeInput.value.trim();
    const profileId = PROFILE_IDS.includes(dom.syncProfileSelect.value)
        ? dom.syncProfileSelect.value
        : DEFAULT_PROFILE_ID;
    const delaySeconds = normalizeDelaySeconds(dom.syncDelayInput?.value);
    return { workerUrl, apiCode, profileId, syncMode: 'auto', delaySeconds };
}

export function getStateEndpoint(workerUrl) {
    if (!workerUrl) return '';
    return `${workerUrl.replace(/\/+$/, '')}/sync/${SYNC_APP_ID}/state`;
}

export function getBackupEndpoint(workerUrl, slot) {
    if (!workerUrl) return '';
    return `${workerUrl.replace(/\/+$/, '')}/sync/${SYNC_APP_ID}/backup/${slot}`;
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

    if (!config.workerUrl) throw new Error('Please enter Worker URL first');
    if (!headers) throw new Error('Please enter API code first');

    return { ...config, endpoint, headers };
}

export function bindSyncCredentialInputs(dom, handlers = {}) {
    const onProfileChange = typeof handlers === 'function' ? handlers : handlers.onProfileChange;
    const onConfigChange = typeof handlers === 'object' ? handlers.onConfigChange : null;
    const onDelayChange = typeof handlers === 'object' ? handlers.onDelayChange : null;

    function markSyncConfigChanged() {
        chrome.storage.local.set({ [STORAGE_KEYS.syncReady]: false });
        if (onConfigChange) onConfigChange();
    }

    dom.syncWorkerUrlInput.addEventListener('input', () => {
        chrome.storage.local.set({ [STORAGE_KEYS.syncWorkerUrl]: dom.syncWorkerUrlInput.value.trim() });
        markSyncConfigChanged();
    });

    dom.syncApiCodeInput.addEventListener('input', () => {
        chrome.storage.local.set({ [STORAGE_KEYS.syncApiCode]: dom.syncApiCodeInput.value.trim() });
        markSyncConfigChanged();
    });

    dom.syncProfileSelect.addEventListener('change', () => {
        const profileId = PROFILE_IDS.includes(dom.syncProfileSelect.value)
            ? dom.syncProfileSelect.value
            : DEFAULT_PROFILE_ID;
        if (onProfileChange) onProfileChange(profileId);
    });

    const saveSyncDelay = () => {
        const delaySeconds = normalizeDelaySeconds(dom.syncDelayInput?.value);
        if (dom.syncDelayInput) dom.syncDelayInput.value = String(delaySeconds);
        chrome.storage.local.set({ [STORAGE_KEYS.syncDelaySeconds]: delaySeconds });
        if (onDelayChange) onDelayChange(delaySeconds);
    };
    dom.syncDelayInput?.addEventListener('change', saveSyncDelay);
    dom.syncDelayInput?.addEventListener('blur', saveSyncDelay);

    chrome.storage.local.set({ [STORAGE_KEYS.syncMode]: 'auto' });
}

export function loadSavedSyncCredentials(dom) {
    return new Promise(resolve => {
        chrome.storage.local.get([
            STORAGE_KEYS.syncWorkerUrl,
            STORAGE_KEYS.syncApiCode,
            STORAGE_KEYS.syncProfile,
            STORAGE_KEYS.syncDelaySeconds
        ], result => {
            dom.syncWorkerUrlInput.value = result[STORAGE_KEYS.syncWorkerUrl] || DEFAULT_WORKER_URL;
            dom.syncApiCodeInput.value = result[STORAGE_KEYS.syncApiCode] || '';
            dom.syncProfileSelect.value = PROFILE_IDS.includes(result[STORAGE_KEYS.syncProfile])
                ? result[STORAGE_KEYS.syncProfile]
                : DEFAULT_PROFILE_ID;
            if (dom.syncModeSelect) dom.syncModeSelect.value = 'auto';
            if (dom.syncDelayInput) {
                const savedDelay = Number(result[STORAGE_KEYS.syncDelaySeconds]);
                dom.syncDelayInput.value = String(normalizeDelaySeconds(savedDelay));
            }
            resolve();
        });
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

export function buildExportData(state, baseRevision = null, options = {}) {
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
            pinned: state.groups.pinned,
            selected: state.groups.selected,
            settings: state.settings
        }
    };
}

function mergeLocalAddsIntoRemote(remote, localState) {
    const remoteLinks = Array.isArray(remote?.links) ? remote.links : [];
    const localLinks = Array.isArray(localState?.links) ? localState.links : [];
    const mergedLinks = remoteLinks.slice();
    const remoteLinkIds = new Set(remoteLinks.map(link => link?._id).filter(Boolean));

    localLinks.forEach(link => {
        if (link?._id && !remoteLinkIds.has(link._id)) {
            mergedLinks.push(link);
            remoteLinkIds.add(link._id);
        }
    });

    const remoteGroups = Array.isArray(remote?.groups?.list) ? remote.groups.list : [];
    const localGroups = Array.isArray(localState?.groups?.list) ? localState.groups.list : [];
    const mergedGroups = remoteGroups.slice();
    const groupNames = new Set(mergedGroups);

    localGroups.forEach(groupName => {
        if (typeof groupName === 'string' && !groupNames.has(groupName)) {
            mergedGroups.push(groupName);
            groupNames.add(groupName);
        }
    });

    mergedLinks.forEach(link => {
        if (typeof link?.parent === 'string' && !groupNames.has(link.parent)) {
            mergedGroups.push(link.parent);
            groupNames.add(link.parent);
        }
    });

    return {
        ...localState,
        links: mergedLinks,
        groups: {
            ...(localState?.groups || {}),
            list: mergedGroups
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

export async function pullCloudflareBackup(dom, slot) {
    const normalizedSlot = String(slot || '').toLowerCase();
    if (!BACKUP_SLOTS.includes(normalizedSlot)) {
        throw new Error('Invalid backup slot');
    }
    const config = getSyncSettings(dom);
    const endpoint = getBackupEndpoint(config.workerUrl, normalizedSlot);
    const headers = getSyncHeaders(config.apiCode);

    if (!config.workerUrl) throw new Error('Please enter Worker URL first');
    if (!headers) throw new Error('Please enter API code first');

    const res = await fetch(endpoint, {
        method: 'GET',
        headers
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
}

export async function pushCloudflareBackup(dom, slot) {
    const normalizedSlot = String(slot || '').toLowerCase();
    if (!BACKUP_SLOTS.includes(normalizedSlot)) {
        throw new Error('Invalid backup slot');
    }
    const config = getSyncSettings(dom);
    const endpoint = getBackupEndpoint(config.workerUrl, normalizedSlot);
    const headers = getSyncHeaders(config.apiCode);

    if (!config.workerUrl) throw new Error('Please enter Worker URL first');
    if (!headers) throw new Error('Please enter API code first');

    const res = await fetch(endpoint, {
        method: 'PUT',
        headers
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
}

export async function pushCloudflareState(dom, state, baseRevision = null) {
    const { endpoint, headers } = buildConfiguredSync(dom);
    const putState = async (revision, nextState = state) => fetch(endpoint, {
        method: 'PUT',
        headers,
        body: JSON.stringify(buildExportData(nextState, revision))
    });
    const fetchLatestState = async () => {
        const latest = await fetch(endpoint, {
            method: 'GET',
            headers
        });
        if (!latest.ok) throw new Error(`HTTP ${latest.status}: ${latest.statusText}`);
        return latest.json();
    };

    if (!Number.isSafeInteger(baseRevision)) {
        const latestState = await fetchLatestState();
        const res = await putState(latestState.revision, mergeLocalAddsIntoRemote(latestState, state));
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return {
            ...await res.json(),
            syncMerged: true
        };
    }

    let res = await putState(baseRevision);
    if (res.status === 409) {
        const latestState = await fetchLatestState();
        res = await putState(latestState.revision, mergeLocalAddsIntoRemote(latestState, state));
        if (res.status === 409) {
            return {
                ...latestState,
                syncConflict: true
            };
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return {
            ...await res.json(),
            syncMerged: true
        };
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
}
