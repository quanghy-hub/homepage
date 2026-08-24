import {
  bindSyncCredentialInputs,
  getSyncSettings,
  loadSyncPending,
  loadSyncReady,
  loadSavedSyncCredentials,
  loadSavedSyncRevision,
  loadSavedSyncStatuses,
  saveSyncPending,
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
  let autoRestoreTimer = null;
  let isPushing = false;
  let isRestoring = false;
  let isBootstrapping = false;
  let syncReady = false;

  // Mirror of the persisted syncPending flag: set by saveData on every edit,
  // cleared only after a confirmed push. Covers edits whose debounced push
  // never ran (tab closed, mobile browser killed the frozen page...).
  let hasPendingLocalChanges = false;

  // Bumped whenever a sync is scheduled (i.e. new local edits exist). Lets a
  // finishing push tell whether its snapshot already included every edit.
  let pendingEpoch = 0;

  // Auto-restore pulls happen immediately when a tab becomes visible and on a
  // light interval while it stays visible; nothing runs while hidden or closed.
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
    const pushedEpoch = pendingEpoch;
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
      if (pendingEpoch === pushedEpoch) {
        // No edits landed while pushing — the cloud now has everything.
        hasPendingLocalChanges = false;
        saveSyncPending(false);
      }
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

  function hasUnpushedChanges() {
    return Boolean(autoSyncTimer) || hasPendingLocalChanges;
  }

  // Pushes local edits immediately instead of waiting out the debounce. Used
  // when the tab hides/unloads and before any pull applies remote state, so
  // un-pushed edits are never lost or overwritten by an older cloud copy.
  async function flushPendingPush() {
    if (!hasUnpushedChanges()) return false;
    const config = getSyncSettings(dom);
    if (!config.workerUrl || !config.apiCode) return false;

    clearTimeout(autoSyncTimer);
    autoSyncTimer = null;
    await pushToCloudflare(false);
    return true;
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
    pendingEpoch += 1; // New (or not-yet-confirmed) local edits exist.
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
    if (isPushing || isRestoring) return false;

    isRestoring = true;
    try {
      // Never let a remote snapshot overwrite edits that have not been pushed
      // yet — merge them into the cloud first.
      await flushPendingPush();

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
      // Flush un-pushed local edits first so the revision comparison below
      // cannot clobber them with an older remote snapshot.
      await flushPendingPush();

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
      }
      // When the cloud is at or behind the local revision, keep the local one:
      // adopting a smaller remote revision (e.g. after a worker/bucket reset)
      // would let stale cloud data overwrite newer local state later.

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
      return;
    }
    // Hidden: stop waiting for the debounce and flush pending edits now,
    // while the page can still finish the request. If it cannot (mobile may
    // freeze the page), the persisted pending flag retries on next open.
    flushPendingPush().catch(() => {});
  }

  function startAutoRestore() {
    const config = getSyncSettings(dom);
    if (!config.workerUrl || !config.apiCode) return;

    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('visibilitychange', onVisibilityChange);

    // A tab that stays visible never fires visibilitychange again, so keep a
    // light interval as a safety net for long-lived tabs. maybeAutoRestore
    // still spaces out actual pulls; hidden tabs do nothing here.
    clearInterval(autoRestoreTimer);
    autoRestoreTimer = setInterval(
      () => {
        if (document.visibilityState === 'visible') maybeAutoRestore();
      },
      Math.max(1, config.delaySeconds || 5) * 1000
    );
  }

  function bind() {
    // Closing/reloading the page kills the debounced push — flush first.
    // Best effort: if the request cannot finish, the persisted pending flag
    // makes the next open push before pulling.
    window.addEventListener('pagehide', () => {
      flushPendingPush().catch(() => {});
    });

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
    loadSavedPending: async () => {
      hasPendingLocalChanges = await loadSyncPending();
      return hasPendingLocalChanges;
    },
    loadSavedRevision: loadSavedSyncRevision,
    loadSavedStatuses: () => loadSavedSyncStatuses(dom),
    scheduleAutoSync,
    bootstrapCloud,
    startAutoRestore
  };
}
