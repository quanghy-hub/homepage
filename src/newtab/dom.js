export function getDomRefs() {
    const getRadioVal = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value || '';
    const setRadioVal = (name, val) => {
        const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
        if (el) el.checked = true;
    };
    const addRadioListener = (name, event, cb) => {
        document.querySelectorAll(`input[name="${name}"]`).forEach(el => {
            el.addEventListener(event, cb);
        });
    };

    return {
        quickActions: document.getElementById('quick-actions'),
        addCurrentBtn: document.getElementById('add-current-btn'),
        quickActionStatus: document.getElementById('quick-action-status'),
        pinnedGrid: document.getElementById('pinned-grid'),
        groupTabs: document.getElementById('group-tabs'),
        selectedGrid: document.getElementById('selected-grid'),
        settingsBtn: document.getElementById('settings-btn'),
        modalOverlay: document.getElementById('modal-overlay'),
        modalTitle: document.getElementById('modal-title'),
        modalBodyLink: document.getElementById('modal-body-link'),
        modalBodyGroup: document.getElementById('modal-body-group'),
        inputUrl: document.getElementById('input-url'),
        inputName: document.getElementById('input-name'),
        inputGroup: document.getElementById('input-group'),
        inputGroupName: document.getElementById('input-group-name'),
        modalPin: document.getElementById('modal-pin'),
        modalDelete: document.getElementById('modal-delete'),
        modalCancel: document.getElementById('modal-cancel'),
        modalSave: document.getElementById('modal-save'),
        settingsOverlay: document.getElementById('settings-overlay'),
        settingIconSize: document.getElementById('setting-icon-size'),
        settingIconSizeVal: document.getElementById('setting-icon-size-val'),
        cleanupFaviconsBtn: document.getElementById('cleanup-favicons'),
        settingsClose: document.getElementById('settings-close'),
        syncWorkerUrlInput: document.getElementById('setting-sync-worker-url'),
        syncApiCodeInput: document.getElementById('setting-sync-api-code'),
        syncProfileSelect: {
            get value() { return getRadioVal('sync-profile'); },
            set value(val) { setRadioVal('sync-profile', val); },
            addEventListener(event, cb) { addRadioListener('sync-profile', event, cb); }
        },
        syncModeSelect: {
            get value() { return getRadioVal('sync-mode') || 'auto'; },
            set value(val) { setRadioVal('sync-mode', val); },
            addEventListener(event, cb) { addRadioListener('sync-mode', event, cb); }
        },
        verifySyncBtn: document.getElementById('verify-sync'),
        syncVerifyStatus: document.getElementById('sync-verify-status'),
        syncPush: document.getElementById('sync-push'),
        syncPull: document.getElementById('sync-pull'),
        syncRestoreA: document.getElementById('sync-restore-a'),
        syncRestoreB: document.getElementById('sync-restore-b'),
        syncStatus: document.getElementById('sync-status')
    };
}
