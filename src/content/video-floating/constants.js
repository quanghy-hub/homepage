import { VIDEO_DEFAULT_SETTINGS } from '../../shared/constants/video-settings.js';
import { STORAGE_KEYS } from '../../shared/constants/storage-keys.js';

export const FIT_MODES = ['contain', 'cover', 'fill'];
export const FIT_ICONS = ['⤢', '🔍', '↔'];
export const ZOOM_LEVELS = [1, 1.5, 2, 3];
export const ZOOM_ICONS = ['+', '++', '+++', '-'];
export const IDLE_TIMEOUT = 3000;
export const VIDEO_CHECK_INTERVAL = 2000;

export const VF_STORE = STORAGE_KEYS.videoSettings;
export const VF_DEF = VIDEO_DEFAULT_SETTINGS;

export const STORAGE_KEY_LAYOUT = 'fvp-layout';
export const STORAGE_KEY_ICON = 'fvp-icon-pos';
