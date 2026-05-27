import {
  bindSyncCredentialInputs,
  getSyncSettings,
  loadSyncReady,
  loadSavedSyncCredentials,
  loadSavedSyncRevision,
  loadSavedSyncStatuses,
  pullCloudflareBackup,
  pullCloudflareState,
  pushCloudflareBackup,
  saveSyncReady,
  pushCloudflareState,
  saveSyncRevision,
  setSyncStatus as updateSyncStatus,
  setVerifyStatus as updateVerifyStatus,
  verifyCloudflareSync
} from './cloudflare-sync.js';

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
  let autoRestoreTimer = null;
  let isPushing = false;
  let isRestoring = false;
  let isBootstrapping = false;
  let syncReady = false;

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

  async function pullFromCloudflare(showStatus = true) {
    if (showStatus) setSyncStatus('Pulling from cloud...');

    const imported = await pullCloudflareState(dom);
    applyRemoteState(imported);
    syncReady = true;
    saveSyncReady(true);
    saveData({ skipAutoSync: true });
    render();
    refreshSettingsControls();

    if (showStatus) {
      setSyncStatus(`✓ Pulled successfully · ${revisionText(imported.revision)} · ${formatSyncStamp()}`, 'ok');
    }
  }

  async function pushToCloudflare(showStatus = true) {
    persistCurrentProfile();
    if (showStatus) setSyncStatus('Pushing to B...');

    isPushing = true;
    let updated;
    try {
      updated = await pushCloudflareState(dom, getState(), getRevision());
      applyRemoteState(updated);
      syncReady = true;
      saveSyncReady(true);
      saveData({ skipAutoSync: true });
      refreshSettingsControls();
    } finally {
      isPushing = false;
    }

    if (showStatus) {
      setSyncStatus(`✓ B synced · ${revisionText(updated?.revision)} · ${formatSyncStamp()}`, 'ok');
    }
    return updated;
  }

  async function pushBackupA() {
    setSyncStatus('Syncing A...');
    const backup = await pushCloudflareBackup(dom, 'a');
    setSyncStatus(`✓ A synced · ${revisionText(backup?.revision)} · ${formatSyncStamp()}`, 'ok');
    return backup;
  }

  async function restoreFromBackup(slot) {
    const label = slot === 'a' ? 'A' : 'B';
    setSyncStatus(`Restoring backup ${label}...`);

    const imported = await pullCloudflareBackup(dom, slot);
    applyRemoteState(imported);
    saveData({ skipAutoSync: true });
    render();
    refreshSettingsControls();

    const updated = await pushCloudflareState(dom, getState(), getRevision());
    applyRemoteState(updated);
    saveData({ skipAutoSync: true });
    setSyncStatus(`✓ Restored backup ${label} · ${revisionText(updated?.revision)} · ${formatSyncStamp()}`, 'ok');
  }

  function scheduleAutoSync() {
    clearTimeout(autoSyncTimer);
    const config = getSyncSettings(dom);
    if (!config.workerUrl || !config.apiCode) {
      return;
    }
    if (!syncReady) {
      bootstrapCloud()
        .then(isReady => {
          if (isReady) scheduleAutoSync();
        })
        .catch(err => {
          setSyncStatus('✗ Cloud check error: ' + err.message, 'err');
        });
      return;
    }
    const delayMs = Math.max(1, config.delaySeconds || 5) * 1000;

    autoSyncTimer = setTimeout(async () => {
      autoSyncTimer = null;
      try {
        const updated = await pushToCloudflare(false);
        setSyncStatus(`✓ B synced · ${revisionText(updated?.revision)} · ${formatSyncStamp()}`, 'ok');
      } catch (err) {
        setSyncStatus('✗ Auto sync error: ' + err.message, 'err');
      }
    }, delayMs);
  }

  async function restoreLatestFromB(showStatus = false) {
    if (autoSyncTimer || isPushing || isRestoring) return false;

    isRestoring = true;
    try {
      const remote = await pullCloudflareState(dom);
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

  async function bootstrapCloud() {
    if (syncReady || isBootstrapping) return syncReady;

    const config = getSyncSettings(dom);
    if (!config.workerUrl || !config.apiCode) {
      return false;
    }

    isBootstrapping = true;
    try {
      const remote = await pullCloudflareState(dom);
      const remoteRevision = Number.isSafeInteger(remote?.revision) ? remote.revision : 0;
      const localRevision = Number.isSafeInteger(getRevision()) ? getRevision() : 0;

      if (remoteRevision > 0 && remoteRevision > localRevision) {
        applyRemoteState(remote);
        saveData({ skipAutoSync: true });
        render();
        refreshSettingsControls();
        setSyncStatus(`✓ B restored · ${revisionText(remoteRevision)} · ${formatSyncStamp()}`, 'ok');
      } else {
        setRevision(remoteRevision);
        saveSyncRevision(remoteRevision);
      }

      syncReady = true;
      saveSyncReady(true);
      return true;
    } finally {
      isBootstrapping = false;
    }
  }

  function startAutoRestore() {
    clearInterval(autoRestoreTimer);
    const config = getSyncSettings(dom);
    if (!config.workerUrl || !config.apiCode) {
      refreshStatus();
      return;
    }

    const intervalMs = Math.max(1, config.delaySeconds || 5) * 1000;
    autoRestoreTimer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      restoreLatestFromB(false).catch(err => {
        setSyncStatus('✗ Auto restore error: ' + err.message, 'err');
      });
    }, intervalMs);
  }

  function refreshStatus() {
  }

  function bind() {
    bindSyncCredentialInputs(dom, {
      onProfileChange: switchProfile,
      onConfigChange: () => {
        syncReady = false;
        bootstrapCloud()
          .then(() => startAutoRestore())
          .catch(err => {
            setSyncStatus('✗ Cloud check error: ' + err.message, 'err');
          });
      },
      onDelayChange: (delaySeconds) => {
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

        await bootstrapCloud();
        const remote = await verifyCloudflareSync(dom);
        setVerifyStatus(`✓ Connected to Worker successfully · ${revisionText(remote.revision || 0)} · ${formatSyncStamp()}`, 'ok');
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

    dom.syncPull?.addEventListener('click', async () => {
      dom.syncPull.disabled = true;
      try {
        await pullFromCloudflare(true);
      } catch (err) {
        setSyncStatus('✗ Error: ' + err.message, 'err');
      } finally {
        dom.syncPull.disabled = false;
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
    refreshStatus,
    startAutoRestore,
    setVerifyStatus,
    pull: pullFromCloudflare
  };
}
