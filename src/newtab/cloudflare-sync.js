import { DEFAULT_PROFILE_ID } from '../shared/constants/home-defaults.js';
import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';

// Personal defaults live in an optional git-ignored file so they never leak
// into a published build. Copy worker-config.local.example.js to enable them.
export const DEFAULT_WORKER_URL = '';
export const PROFILE_IDS = ['macbook', 'mobile'];
export const DEFAULT_SYNC_DELAY_SECONDS = 5;
const MIN_SYNC_DELAY_SECONDS = 1;
const MAX_SYNC_DELAY_SECONDS = 3600;

function normalizeDelaySeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SYNC_DELAY_SECONDS;
  return Math.min(MAX_SYNC_DELAY_SECONDS, Math.max(MIN_SYNC_DELAY_SECONDS, Math.round(parsed)));
}

// Status text is persisted so a freshly opened new tab can show the last
// sync outcome. Skip identical writes (e.g. repeated background pulls) to
// keep chrome.storage.local write churn low.
const lastPersistedStatus = { sync: null, verify: null };

export function setSyncStatus(dom, msg, type = '') {
  dom.syncStatus.textContent = msg;
  dom.syncStatus.className = 'sync-status' + (type ? ' ' + type : '');
  if (lastPersistedStatus.sync === msg + '\u0000' + type) return;
  lastPersistedStatus.sync = msg + '\u0000' + type;
  chrome.storage.local.set({
    [STORAGE_KEYS.syncStatus]: msg,
    [STORAGE_KEYS.syncStatusType]: type
  });
}

export function setVerifyStatus(dom, msg, type = '') {
  if (!dom.syncVerifyStatus) return;
  dom.syncVerifyStatus.textContent = msg;
  dom.syncVerifyStatus.className = 'sync-status' + (type ? ' ' + type : '');
  if (lastPersistedStatus.verify === msg + '\u0000' + type) return;
  lastPersistedStatus.verify = msg + '\u0000' + type;
  chrome.storage.local.set({
    [STORAGE_KEYS.syncVerifyStatus]: msg,
    [STORAGE_KEYS.syncVerifyStatusType]: type
  });
}

export function loadSavedSyncStatuses(dom) {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        STORAGE_KEYS.syncStatus,
        STORAGE_KEYS.syncStatusType,
        STORAGE_KEYS.syncVerifyStatus,
        STORAGE_KEYS.syncVerifyStatusType
      ],
      (result) => {
        if (result[STORAGE_KEYS.syncStatus]) {
          dom.syncStatus.textContent = result[STORAGE_KEYS.syncStatus];
          dom.syncStatus.className =
            'sync-status' +
            (result[STORAGE_KEYS.syncStatusType] ? ' ' + result[STORAGE_KEYS.syncStatusType] : '');
        }
        if (dom.syncVerifyStatus && result[STORAGE_KEYS.syncVerifyStatus]) {
          dom.syncVerifyStatus.textContent = result[STORAGE_KEYS.syncVerifyStatus];
          dom.syncVerifyStatus.className =
            'sync-status' +
            (result[STORAGE_KEYS.syncVerifyStatusType]
              ? ' ' + result[STORAGE_KEYS.syncVerifyStatusType]
              : '');
        }
        resolve();
      }
    );
  });
}

export function getSyncSettings(dom) {
  const workerUrl = dom.syncWorkerUrlInput.value.trim().replace(/\/+$/, '');
  const apiCode = dom.syncApiCodeInput.value.trim();
  const delaySeconds = normalizeDelaySeconds(dom.syncDelayInput?.value);
  return { workerUrl, apiCode, delaySeconds };
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
    if (onDelayChange) onDelayChange();
  };
  dom.syncDelayInput?.addEventListener('change', saveSyncDelay);
  dom.syncDelayInput?.addEventListener('blur', saveSyncDelay);
}

async function loadLocalDefaultWorkerUrl() {
  try {
    const config = await import('../shared/constants/worker-config.local.js');
    return typeof config.DEFAULT_WORKER_URL === 'string' ? config.DEFAULT_WORKER_URL.trim() : '';
  } catch {
    return ''; // Optional config absent — start with an empty Worker URL.
  }
}

export async function loadSavedSyncCredentials(dom) {
  const localDefaultWorkerUrl = await loadLocalDefaultWorkerUrl();
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        STORAGE_KEYS.syncWorkerUrl,
        STORAGE_KEYS.syncApiCode,
        STORAGE_KEYS.syncProfile,
        STORAGE_KEYS.syncDelaySeconds
      ],
      (result) => {
        dom.syncWorkerUrlInput.value = result[STORAGE_KEYS.syncWorkerUrl] || localDefaultWorkerUrl;
        dom.syncApiCodeInput.value = result[STORAGE_KEYS.syncApiCode] || '';
        dom.syncProfileSelect.value = PROFILE_IDS.includes(result[STORAGE_KEYS.syncProfile])
          ? result[STORAGE_KEYS.syncProfile]
          : DEFAULT_PROFILE_ID;
        if (dom.syncDelayInput) {
          const savedDelay = Number(result[STORAGE_KEYS.syncDelaySeconds]);
          dom.syncDelayInput.value = String(normalizeDelaySeconds(savedDelay));
        }
        resolve();
      }
    );
  });
}

export function loadSavedSyncRevision() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.syncRevision], (result) => {
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
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.syncReady], (result) => {
      resolve(result[STORAGE_KEYS.syncReady] === true);
    });
  });
}

export function saveSyncReady(isReady) {
  chrome.storage.local.set({ [STORAGE_KEYS.syncReady]: isReady === true });
}

// Tracks local edits that may not have reached the cloud yet (push debounced,
// tab hidden, browser killed...). Persisted so an un-pushed edit survives a
// page reload and is flushed before any pull can overwrite it.
export function loadSyncPending() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.syncPending], (result) => {
      resolve(result[STORAGE_KEYS.syncPending] === true);
    });
  });
}

export function saveSyncPending(isPending) {
  chrome.storage.local.set({ [STORAGE_KEYS.syncPending]: isPending === true });
}
