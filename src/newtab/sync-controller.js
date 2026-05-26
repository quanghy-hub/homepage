import {
  bindSyncCredentialInputs,
  getSyncSettings,
  loadSyncReady,
  loadSavedSyncCredentials,
  loadSavedSyncRevision,
  pullCloudflareState,
  saveSyncReady,
  pushCloudflareState,
  saveSyncRevision,
  setSyncStatus as updateSyncStatus,
  setVerifyStatus as updateVerifyStatus,
  verifyCloudflareSync
} from './cloudflare-sync.js';

const AUTO_SYNC_DELAY = 1200;

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

  function applyRemoteState(imported) {
    applyImportedState(imported);
    if (Number.isSafeInteger(imported?.revision)) {
      setRevision(imported.revision);
      saveSyncRevision(imported.revision);
    }
  }

  async function pullFromCloudflare(showStatus = true) {
    if (showStatus) setSyncStatus('Đang kéo về...');

    const imported = await pullCloudflareState(dom);
    applyRemoteState(imported);
    syncReady = true;
    saveSyncReady(true);
    saveData({ skipAutoSync: true });
    render();
    refreshSettingsControls();

    if (showStatus) {
      setSyncStatus('✓ Kéo về thành công · ' + new Date().toLocaleTimeString(), 'ok');
    }
  }

  async function pushToCloudflare(showStatus = true) {
    if (!syncReady) {
      throw new Error('Máy này chưa kéo cloud về lần đầu. Hãy bấm Kéo về trước để tránh ghi đè dữ liệu.');
    }

    persistCurrentProfile();
    if (showStatus) setSyncStatus('Đang đẩy lên...');

    const updated = await pushCloudflareState(dom, getState(), getRevision());
    applyRemoteState(updated);
    saveData({ skipAutoSync: true });
    refreshSettingsControls();

    if (showStatus) {
      setSyncStatus('✓ Đẩy thành công · ' + new Date().toLocaleTimeString(), 'ok');
    }
  }

  function scheduleAutoSync() {
    clearTimeout(autoSyncTimer);
    const config = getSyncSettings(dom);
    if (!config.workerUrl || !config.apiCode) return;
    if (config.syncMode !== 'auto') return;
    if (!syncReady || !Number.isSafeInteger(getRevision())) {
      setSyncStatus('Auto sync đang chờ bạn Kéo về lần đầu.', '');
      return;
    }

    autoSyncTimer = setTimeout(async () => {
      try {
        await pushToCloudflare(false);
        setSyncStatus('✓ Tự đồng bộ · ' + new Date().toLocaleTimeString(), 'ok');
      } catch (err) {
        setSyncStatus('✗ Tự đồng bộ lỗi: ' + err.message, 'err');
      }
    }, AUTO_SYNC_DELAY);
  }

  function bind() {
    bindSyncCredentialInputs(dom, {
      onProfileChange: switchProfile,
      onConfigChange: () => {
        syncReady = false;
        setSyncStatus('Đã đổi cấu hình sync. Hãy Kéo về một lần trước khi auto-sync.', '');
      },
      onModeChange: syncMode => {
        if (syncMode === 'auto' && !syncReady) {
          setSyncStatus('Auto sync sẽ bật sau khi Kéo về thành công lần đầu.', '');
        } else if (syncMode === 'manual') {
          setSyncStatus('Đang ở chế độ thủ công: dùng Đẩy lên / Kéo về.', '');
        }
      }
    });

    dom.verifySyncBtn.addEventListener('click', async () => {
      try {
        dom.verifySyncBtn.disabled = true;
        setVerifyStatus('Đang kiểm tra kết nối...');

        const remote = await verifyCloudflareSync(dom);
        if (Number.isSafeInteger(remote.revision)) {
          setRevision(remote.revision);
          saveSyncRevision(remote.revision);
        }
        setVerifyStatus('✓ Kết nối được Worker', 'ok');
      } catch (err) {
        setVerifyStatus('✗ Không kết nối được · ' + err.message, 'err');
      } finally {
        dom.verifySyncBtn.disabled = false;
      }
    });

    dom.syncPush.addEventListener('click', async () => {
      dom.syncPush.disabled = true;
      try {
        await pushToCloudflare(true);
      } catch (err) {
        setSyncStatus('✗ Lỗi: ' + err.message, 'err');
      } finally {
        dom.syncPush.disabled = false;
      }
    });

    dom.syncPull.addEventListener('click', async () => {
      dom.syncPull.disabled = true;
      try {
        await pullFromCloudflare(true);
      } catch (err) {
        setSyncStatus('✗ Lỗi: ' + err.message, 'err');
      } finally {
        dom.syncPull.disabled = false;
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
    setVerifyStatus
  };
}
