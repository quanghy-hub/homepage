import { DEFAULT_PROFILE_ID } from '../shared/constants/home-defaults.js';
import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';

export const DEFAULT_WORKER_URL = 'https://extension.quavav15-6.workers.dev';
export const PROFILE_IDS = ['macbook', 'mobile'];
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
  browser.storage.local.set({
    [STORAGE_KEYS.syncStatus]: msg,
    [STORAGE_KEYS.syncStatusType]: type
  });
}

export function setVerifyStatus(dom, msg, type = '') {
  if (!dom.syncVerifyStatus) return;
  dom.syncVerifyStatus.textContent = msg;
  dom.syncVerifyStatus.className = 'sync-status' + (type ? ' ' + type : '');
  browser.storage.local.set({
    [STORAGE_KEYS.syncVerifyStatus]: msg,
    [STORAGE_KEYS.syncVerifyStatusType]: type
  });
}

export async function loadSavedSyncStatuses(dom) {
  const result = await browser.storage.local.get([
    STORAGE_KEYS.syncStatus,
    STORAGE_KEYS.syncStatusType,
    STORAGE_KEYS.syncVerifyStatus,
    STORAGE_KEYS.syncVerifyStatusType
  ]);
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
    browser.storage.local.set({ [STORAGE_KEYS.syncReady]: false });
    if (onConfigChange) onConfigChange();
  }

  dom.syncWorkerUrlInput.addEventListener('input', () => {
    browser.storage.local.set({
      [STORAGE_KEYS.syncWorkerUrl]: dom.syncWorkerUrlInput.value.trim()
    });
    markSyncConfigChanged();
  });

  dom.syncApiCodeInput.addEventListener('input', () => {
    browser.storage.local.set({ [STORAGE_KEYS.syncApiCode]: dom.syncApiCodeInput.value.trim() });
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
    browser.storage.local.set({ [STORAGE_KEYS.syncDelaySeconds]: delaySeconds });
    if (onDelayChange) onDelayChange();
  };
  dom.syncDelayInput?.addEventListener('change', saveSyncDelay);
  dom.syncDelayInput?.addEventListener('blur', saveSyncDelay);
}

export async function loadSavedSyncCredentials(dom) {
  const result = await browser.storage.local.get([
    STORAGE_KEYS.syncWorkerUrl,
    STORAGE_KEYS.syncApiCode,
    STORAGE_KEYS.syncProfile,
    STORAGE_KEYS.syncDelaySeconds
  ]);
  dom.syncWorkerUrlInput.value = result[STORAGE_KEYS.syncWorkerUrl] || DEFAULT_WORKER_URL;
  dom.syncApiCodeInput.value = result[STORAGE_KEYS.syncApiCode] || '';
  dom.syncProfileSelect.value = PROFILE_IDS.includes(result[STORAGE_KEYS.syncProfile])
    ? result[STORAGE_KEYS.syncProfile]
    : DEFAULT_PROFILE_ID;
  if (dom.syncDelayInput) {
    const savedDelay = Number(result[STORAGE_KEYS.syncDelaySeconds]);
    dom.syncDelayInput.value = String(normalizeDelaySeconds(savedDelay));
  }
}

export async function loadSavedSyncRevision() {
  const result = await browser.storage.local.get([STORAGE_KEYS.syncRevision]);
  const revision = result[STORAGE_KEYS.syncRevision];
  return Number.isSafeInteger(revision) ? revision : null;
}

export function saveSyncRevision(revision) {
  if (!Number.isSafeInteger(revision)) return;
  browser.storage.local.set({ [STORAGE_KEYS.syncRevision]: revision });
}

export async function loadSyncReady() {
  const result = await browser.storage.local.get([STORAGE_KEYS.syncReady]);
  return result[STORAGE_KEYS.syncReady] === true;
}

export function saveSyncReady(isReady) {
  browser.storage.local.set({ [STORAGE_KEYS.syncReady]: isReady === true });
}
