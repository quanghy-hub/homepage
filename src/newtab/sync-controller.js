import {
  bindSyncCredentialInputs,
  getSyncSettings,
  loadSyncReady,
  loadSavedSyncCredentials,
  loadSavedSyncRevision,
  loadSavedSyncStatuses,
  saveSyncReady,
  saveSyncRevision,
  setSyncStatus as updateSyncStatus,
  setVerifyStatus as updateVerifyStatus
} from './cloudflare-sync.js';

import {
  pullCloudflareBackup,
  pullCloudflareState,
  pushCloudflareBackup,
  pushCloudflareState,
  verifyCloudflareSync
} from './sync-api.js';

export function createSyncController({
  applyImportedState,
  dom,
  getRevision,
  getState,
  persistCurrentProfile,
  refreshSettingsControls,
  render,
  saveData,
  setRevision,
  switchProfile
}) {
  let autoSyncTimer = null;
  let isPushing = false;
  let isRestoring = false;
  let isBootstrapping = false;
  let syncReady = false;

  // Auto-restore pulls are triggered by visibility changes instead of a fixed
  // interval: no network traffic while the tab stays hidden or closed.
  let lastAutoRestoreAt = 0;
  let autoRestoreErrorVisible = false;

  function setSyncStatus(msg, type = '') {
    updateSyncStatus(dom, msg, type);
  }

  function setVerifyStatus(msg, type = '') {
    updateVerifyStatus(dom, msg, type);
  }

  function formatSyncStamp(date = new Date()) {
    return date.toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  function revisionText(revision = getRevision()) {
    return Number.isSafeInteger(revision) ? `revision ${revision}` : 'revision -';
  }

  function applyRemoteState(imported) {
    applyImportedState(imported);
    if (Number.isSafeInteger(imported?.revision)) {
      setRevision(imported.revision);
      saveSyncRevision(imported.revision);
    }
  }

  function describeSyncResult(updated) {
    if (updated?.syncMerged) return 'B synced with newer cloud data';
    if (updated?.syncConflict) return 'B had newer update; restored';
    return 'B synced';
  }

  async function pushToCloudflare(showStatus = true) {
    persistCurrentProfile();
    if (showStatus) setSyncStatus('Pushing to B...');

    isPushing = true;
    let updated;
    try {
      const config = getSyncSettings(dom);
      updated = await pushCloudflareState(
        config.workerUrl,
        config.apiCode,
        getState(),
        getRevision()
      );
      applyRemoteState(updated);
      syncReady = true;
      saveSyncReady(true);
      saveData({ skipAutoSync: true });
      refreshSettingsControls();
    } finally {
      isPushing = false;
    }

    if (showStatus) {
      setSyncStatus(
        `✓ ${describeSyncResult(updated)} · ${revisionText(updated?.revision)} · ${formatSyncStamp()}`,
        'ok'
      );
    }
    return updated;
  }

  async function pushBackupA() {
    setSyncStatus('Syncing A...');
    const config = getSyncSettings(dom);
    const backup = await pushCloudflareBackup(config.workerUrl, config.apiCode, 'a');
    setSyncStatus(`✓ A synced · ${revisionText(backup?.revision)} · ${formatSyncStamp()}`, 'ok');
    return backup;
  }

  async function restoreFromBackup(slot) {
    const label = slot === 'a' ? 'A' : 'B';
    setSyncStatus(`Restoring backup ${label}...`);

    const config = getSyncSettings(dom);
    const imported = await pullCloudflareBackup(config.workerUrl, config.apiCode, slot);
    applyRemoteState(imported);
    saveData({ skipAutoSync: true });
    render();
    refreshSettingsControls();

    const updated = await pushCloudflareState(
      config.workerUrl,
      config.apiCode,
      getState(),
      getRevision()
    );
    applyRemoteState(updated);
    saveData({ skipAutoSync: true });
    setSyncStatus(
      `✓ Restored backup ${label} · ${revisionText(updated?.revision)} · ${formatSyncStamp()}`,
      'ok'
    );
  }

  function scheduleAutoSync() {
    clearTimeout(autoSyncTimer);
    const config = getSyncSettings(dom);
    if (!config.workerUrl || !config.apiCode) {
      return;
    }
    if (!syncReady) {
      bootstrapCloud()
        .then((isReady) => {
          if (isReady) scheduleAutoSync();
        })
        .catch((err) => {
          setSyncStatus('✗ Cloud check error: ' + err.message, 'err');
        });
      return;
    }
    const delayMs = Math.max(1, config.delaySeconds || 5) * 1000;

    autoSyncTimer = setTimeout(async () => {
      autoSyncTimer = null;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        // Defer network traffic while the tab is hidden; reschedule instead.
        scheduleAutoSync();
        return;
      }
      try {
        const updated = await pushToCloudflare(false);
        setSyncStatus(
          `✓ ${describeSyncResult(updated)} · ${revisionText(updated?.revision)} · ${formatSyncStamp()}`,
          'ok'
        );
      } catch (err) {
        setSyncStatus('✗ Auto sync error: ' + err.message, 'err');
        if (err.message === 'Failed to fetch' || err.message.toLowerCase().includes('network')) {
          setTimeout(() => scheduleAutoSync(), 15000);
        }
      }
    }, delayMs);
  }

  async function restoreLatestFromB(_showStatus = false) {
    if (autoSyncTimer || isPushing || isRestoring) return false;

    isRestoring = true;
    try {
      const config = getSyncSettings(dom);
      const remote = await pullCloudflareState(config.workerUrl, config.apiCode);

      // A previous auto-restore error is now stale — clear it.
      if (autoRestoreErrorVisible) {
        autoRestoreErrorVisible = false;
        setSyncStatus('');
      }

      const remoteRevision = Number.isSafeInteger(remote?.revision) ? remote.revision : 0;
      const localRevision = Number.isSafeInteger(getRevision()) ? getRevision() : 0;

      if (remoteRevision <= localRevision) return false;

      applyRemoteState(remote);
      syncReady = true;
      saveSyncReady(true);
      saveData({ skipAutoSync: true });
      render();
      refreshSettingsControls();

      const msg = `B restored · ${revisionText(remoteRevision)} · ${formatSyncStamp()}`;
      setSyncStatus('✓ ' + msg, 'ok');
      return true;
    } finally {
      isRestoring = false;
    }
  }

  async function bootstrapCloud(options = {}) {
    const force = options?.force === true;
    if ((!force && syncReady) || isBootstrapping) return syncReady;

    const config = getSyncSettings(dom);
    if (!config.workerUrl || !config.apiCode) {
      return false;
    }

    isBootstrapping = true;
    try {
      const remote = await pullCloudflareState(config.workerUrl, config.apiCode);
      const remoteRevision = Number.isSafeInteger(remote?.revision) ? remote.revision : 0;
      const localRevision = Number.isSafeInteger(getRevision()) ? getRevision() : 0;

      if (remoteRevision > 0 && remoteRevision > localRevision) {
        applyRemoteState(remote);
        saveData({ skipAutoSync: true });
        render();
        refreshSettingsControls();
        setSyncStatus(
          `✓ B restored · ${revisionText(remoteRevision)} · ${formatSyncStamp()}`,
          'ok'
        );
      } else {
        setRevision(remoteRevision);
        saveSyncRevision(remoteRevision);
      }

      syncReady = true;
      saveSyncReady(true);
      return true;
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        setSyncStatus('✗ Cloud check failed (network/worker offline)', 'err');
      } else {
        setSyncStatus('✗ Cloud check error: ' + err.message, 'err');
      }
      return false;
    } finally {
      isBootstrapping = false;
    }
  }

  function autoRestoreFailure(err) {
    if (err.message === 'Failed to fetch' || err.message.toLowerCase().includes('network')) {
      return; // Transient network issues stay silent.
    }
    autoRestoreErrorVisible = true;
    setSyncStatus('✗ Auto restore error: ' + err.message, 'err');
  }

  function maybeAutoRestore() {
    const config = getSyncSettings(dom);
    if (!config.workerUrl || !config.apiCode) return;
    if (document.visibilityState === 'hidden') return;

    // delaySeconds doubles as the minimum spacing between background pulls.
    const minIntervalMs = Math.max(1, config.delaySeconds || 5) * 1000;
    if (Date.now() - lastAutoRestoreAt < minIntervalMs) return;
    lastAutoRestoreAt = Date.now();

    restoreLatestFromB(false).catch(autoRestoreFailure);
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      maybeAutoRestore();
    }
  }

  function startAutoRestore() {
    const config = getSyncSettings(dom);
    if (!config.workerUrl || !config.apiCode) return;

    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  function bind() {
    bindSyncCredentialInputs(dom, {
      onProfileChange: switchProfile,
      onConfigChange: () => {
        syncReady = false;
        bootstrapCloud()
          .then(() => startAutoRestore())
          .catch((err) => {
            setSyncStatus('✗ Cloud check error: ' + err.message, 'err');
          });
      },
      onDelayChange: () => {
        const hasPendingPush = !!autoSyncTimer;
        startAutoRestore();
        if (hasPendingPush) {
          scheduleAutoSync();
        }
      }
    });

    dom.verifySyncBtn.addEventListener('click', async () => {
      try {
        dom.verifySyncBtn.disabled = true;
        setVerifyStatus('Testing connection...');

        await bootstrapCloud({ force: true });
        const config = getSyncSettings(dom);
        const remote = await verifyCloudflareSync(config.workerUrl, config.apiCode);
        setVerifyStatus(
          `✓ Connected to Worker successfully · ${revisionText(remote.revision || 0)} · ${formatSyncStamp()}`,
          'ok'
        );
        startAutoRestore();
      } catch (err) {
        setVerifyStatus('✗ Connection failed · ' + err.message, 'err');
      } finally {
        dom.verifySyncBtn.disabled = false;
      }
    });

    dom.syncPush.addEventListener('click', async () => {
      dom.syncPush.disabled = true;
      try {
        await pushBackupA();
      } catch (err) {
        setSyncStatus('✗ Error: ' + err.message, 'err');
      } finally {
        dom.syncPush.disabled = false;
      }
    });

    dom.syncRestoreA?.addEventListener('click', async () => {
      dom.syncRestoreA.disabled = true;
      try {
        await restoreFromBackup('a');
      } catch (err) {
        setSyncStatus('✗ Restore A error: ' + err.message, 'err');
      } finally {
        dom.syncRestoreA.disabled = false;
      }
    });

    dom.syncRestoreB?.addEventListener('click', async () => {
      dom.syncRestoreB.disabled = true;
      try {
        await restoreFromBackup('b');
      } catch (err) {
        setSyncStatus('✗ Restore B error: ' + err.message, 'err');
      } finally {
        dom.syncRestoreB.disabled = false;
      }
    });
  }

  return {
    bind,
    loadSavedCredentials: () => loadSavedSyncCredentials(dom),
    loadSavedReady: async () => {
      syncReady = await loadSyncReady();
      return syncReady;
    },
    loadSavedRevision: loadSavedSyncRevision,
    loadSavedStatuses: () => loadSavedSyncStatuses(dom),
    scheduleAutoSync,
    bootstrapCloud,
    startAutoRestore
  };
}
