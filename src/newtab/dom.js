export function getDomRefs() {
    return {
        pinnedGrid: document.getElementById('pinned-grid'),
        groupTabs: document.getElementById('group-tabs'),
        selectedGrid: document.getElementById('selected-grid'),
        settingsBtn: document.getElementById('settings-btn'),
        contextMenu: document.getElementById('context-menu'),
        modalOverlay: document.getElementById('modal-overlay'),
        modalTitle: document.getElementById('modal-title'),
        modalBodyLink: document.getElementById('modal-body-link'),
        modalBodyGroup: document.getElementById('modal-body-group'),
        inputUrl: document.getElementById('input-url'),
        inputName: document.getElementById('input-name'),
        inputGroup: document.getElementById('input-group'),
        inputGroupName: document.getElementById('input-group-name'),
        modalCancel: document.getElementById('modal-cancel'),
        modalSave: document.getElementById('modal-save'),
        settingsOverlay: document.getElementById('settings-overlay'),
        settingIconSize: document.getElementById('setting-icon-size'),
        settingIconSizeVal: document.getElementById('setting-icon-size-val'),
        settingsGroupList: document.getElementById('settings-group-list'),
        settingsAddGroup: document.getElementById('settings-add-group'),
        settingsClose: document.getElementById('settings-close'),
        videoSettingsStatus: document.getElementById('video-settings-status'),
        gistTokenInput: document.getElementById('setting-gist-token'),
        gistIdInput: document.getElementById('setting-gist-id'),
        syncPush: document.getElementById('sync-push'),
        syncPull: document.getElementById('sync-pull'),
        syncStatus: document.getElementById('sync-status'),
        videoSettingInputs: {
            swipeLong: document.getElementById('setting-video-swipe-long'),
            swipeShort: document.getElementById('setting-video-swipe-short'),
            minSwipeDistance: document.getElementById('setting-video-min-swipe-distance'),
            verticalTolerance: document.getElementById('setting-video-vertical-tolerance'),
            diagonalThreshold: document.getElementById('setting-video-diagonal-threshold'),
            shortThreshold: document.getElementById('setting-video-short-threshold'),
            throttle: document.getElementById('setting-video-throttle'),
            forwardStep: document.getElementById('setting-video-forward-step'),
            boostLevel: document.getElementById('setting-video-boost-level'),
            maxBoost: document.getElementById('setting-video-max-boost'),
            noticeFontSize: document.getElementById('setting-video-notice-font-size')
        },
        videoSettingToggles: {
            realtimePreview: document.getElementById('setting-video-realtime-preview'),
            hotkeys: document.getElementById('setting-video-hotkeys'),
            boost: document.getElementById('setting-video-boost')
        }
    };
}
