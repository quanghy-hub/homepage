import { DEFAULT_GROUPS, DEFAULT_LINKS, DEFAULT_SETTINGS } from '../shared/constants/home-defaults.js';
import { VIDEO_DEFAULT_SETTINGS } from '../shared/constants/video-settings.js';

export function createInitialState() {
    return {
        defaults: {
            groups: DEFAULT_GROUPS,
            links: DEFAULT_LINKS,
            settings: DEFAULT_SETTINGS,
            videoSettings: VIDEO_DEFAULT_SETTINGS
        },
        links: [],
        groups: {},
        settings: {},
        videoSettings: { ...VIDEO_DEFAULT_SETTINGS },
        selectedGroup: '',
        editingLinkId: null,
        editingGroupName: null,
        contextLinkId: null,
        contextGroup: null,
        modalMode: null
    };
}
