import { STORAGE_KEYS } from '../shared/constants/storage-keys.js';
import { VIDEO_DEFAULT_SETTINGS } from '../shared/constants/video-settings.js';

export function setVideoSettingsStatus(dom, message, type = '') {
    if (!dom.videoSettingsStatus) {
        return;
    }

    dom.videoSettingsStatus.textContent = message;
    dom.videoSettingsStatus.className = 'settings-note' + (type ? ` ${type}` : '');
}

export function renderVideoSettings(dom, state) {
    Object.entries(dom.videoSettingInputs).forEach(([key, input]) => {
        if (input) {
            input.value = state.videoSettings[key];
        }
    });

    Object.entries(dom.videoSettingToggles).forEach(([key, input]) => {
        if (input) {
            input.checked = Boolean(state.videoSettings[key]);
        }
    });

    setVideoSettingsStatus(dom, 'Thiết lập video sẽ được áp dụng ngay cho các trang đang mở mới hoặc khi content script nhận thay đổi.');
}

export function bindVideoSettingsControls(dom, state, saveVideoSettingsHandler) {
    Object.entries(dom.videoSettingInputs).forEach(([key, input]) => {
        if (!input) {
            return;
        }

        input.addEventListener('change', () => {
            const value = parseFloat(input.value);
            if (Number.isNaN(value)) {
                input.value = state.videoSettings[key];
                return;
            }

            state.videoSettings[key] = value;
            saveVideoSettingsHandler();
        });
    });

    Object.entries(dom.videoSettingToggles).forEach(([key, input]) => {
        if (!input) {
            return;
        }

        input.addEventListener('change', () => {
            state.videoSettings[key] = input.checked;
            saveVideoSettingsHandler();
        });
    });
}

export function handleVideoStorageChange(state, changes) {
    state.videoSettings = Object.assign({}, VIDEO_DEFAULT_SETTINGS, changes[STORAGE_KEYS.videoSettings].newValue || {});
}
