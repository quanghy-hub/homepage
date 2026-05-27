import {
  bindSyncCredentialInputs,
  getSyncSettings,
  loadSyncReady,
  loadSavedSyncCredentials,
  loadSavedSyncRevision,
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
  let syncReady = false;

  function setSyncStatus(msg, type = '') {
    updateSyncStatus(dom, msg, type);
  }

  function setVerifyStatus(msg, type = '') {
    updateVerifyStatus(dom, msg, type);
  }

  function setLiveStatus(msg) {
    if (dom.syncLiveStatus) dom.syncLiveStatus.textContent = msg;
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
      setSyncStatus('✓ Pulled successfully · ' + new Date().toLocaleTimeString(), 'ok');
    }
  }

  async function pushToCloudflare(showStatus = true) {
    persistCurrentProfile();
    if (showStatus) setSyncStatus('Pushing to B...');

    const updated = await pushCloudflareState(dom, getState(), getRevision());
    applyRemoteState(updated);
    syncReady = true;
    saveSyncReady(true);
    saveData({ skipAutoSync: true });
    refreshSettingsControls();

    if (showStatus) {
      setSyncStatus('✓ B synced · ' + new Date().toLocaleTimeString(), 'ok');
    }
  }

  async function pushBackupA() {
    setSyncStatus('Syncing A...');
    const backup = await pushCloudflareBackup(dom, 'a');
    setSyncStatus('✓ A synced · ' + new Date().toLocaleTimeString(), 'ok');
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
    setSyncStatus(`✓ Restored backup ${label} · ` + new Date().toLocaleTimeString(), 'ok');
  }

  function scheduleAutoSync() {
    clearTimeout(autoSyncTimer);
    const config = getSyncSettings(dom);
    if (!config.workerUrl || !config.apiCode) {
      setLiveStatus('B paused: missing sync config');
      return;
    }
    const delayMs = Math.max(1, config.delaySeconds || 5) * 1000;
    setLiveStatus(`B in ${config.delaySeconds || 5}s`);

    autoSyncTimer = setTimeout(async () => {
      try {
        setLiveStatus('B syncing...');
        await pushToCloudflare(false);
        setLiveStatus('B synced ' + new Date().toLocaleTimeString());
      } catch (err) {
        setLiveStatus('B error');
        setSyncStatus('✗ Auto sync error: ' + err.message, 'err');
      }
    }, delayMs);
  }

  function refreshStatus() {
    const config = getSyncSettings(dom);
    if (!config.workerUrl || !config.apiCode) {
      setLiveStatus('B paused: missing sync config');
      return;
    }
    setLiveStatus(`B ready · ${config.delaySeconds || 5}s`);
  }

  function bind() {
    bindSyncCredentialInputs(dom, {
      onProfileChange: switchProfile,
      onConfigChange: () => {
        syncReady = false;
        setLiveStatus('settings updated');
      },
      onDelayChange: (delaySeconds) => {
        setLiveStatus(`delay updated to ${delaySeconds}s`);
        scheduleAutoSync();
      }
    });

    dom.verifySyncBtn.addEventListener('click', async () => {
      try {
        dom.verifySyncBtn.disabled = true;
        setVerifyStatus('Testing connection...');

        const remote = await verifyCloudflareSync(dom);
        if (Number.isSafeInteger(remote.revision)) {
          setRevision(remote.revision);
          saveSyncRevision(remote.revision);
        }
        syncReady = true;
        saveSyncReady(true);
        setVerifyStatus('✓ Connected to Worker successfully', 'ok');
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
    scheduleAutoSync,
    refreshStatus,
    setVerifyStatus,
    pull: pullFromCloudflare
  };
}
