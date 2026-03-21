// ============================================
// PAGE CONTEXT API (runs in MAIN world)
// Provides access to YouTube/HLS player APIs
// that are not available from isolated world
// ============================================
(function () {
    'use strict';

    const getFloatingVideo = () => document.querySelector('#fvp-wrapper video');
    const emitQualityResult = levels => {
        window.dispatchEvent(new CustomEvent('fvp-quality-result', { detail: levels }));
    };

    // Listen for quality level requests from content script
    window.addEventListener('fvp-get-quality', () => {
        const levels = [];

        try {
            // YouTube player API
            const ytPlayer = document.querySelector('#movie_player');
            if (ytPlayer?.getAvailableQualityLevels) {
                const ytLevels = ytPlayer.getAvailableQualityLevels();
                const ytLabels = {
                    highres: '4K+', hd2160: '2160p', hd1440: '1440p',
                    hd1080: '1080p', hd720: '720p', large: '480p',
                    medium: '360p', small: '240p', tiny: '144p'
                };
                const curQ = ytPlayer.getPlaybackQuality?.() || '';
                ytLevels.forEach(q => {
                    if (q === 'auto') return;
                    levels.push({ label: ytLabels[q] || q, value: q, active: q === curQ, type: 'yt' });
                });
                if (levels.length) {
                    emitQualityResult(levels);
                    return;
                }
            }
        } catch (e) { }

        try {
            // HLS.js - find instance attached to video
            const fvpVideo = getFloatingVideo();
            if (fvpVideo) {
                const hls = fvpVideo._hls || fvpVideo.hls || window.hls;
                if (hls?.levels?.length) {
                    hls.levels.forEach((lv, i) => {
                        const h = lv.height || lv.attrs?.RESOLUTION?.split('x')[1];
                        levels.push({
                            label: h ? `${h}p` : `Level ${i}`,
                            value: i,
                            active: hls.currentLevel === i || hls.loadLevel === i,
                            type: 'hls'
                        });
                    });
                    levels.sort((a, b) => parseInt(b.label) - parseInt(a.label));
                    levels.unshift({ label: 'Auto', value: -1, active: hls.currentLevel === -1, type: 'hls' });
                    if (levels.length > 1) {
                        emitQualityResult(levels);
                        return;
                    }
                }
            }
        } catch (e) { }

        try {
            // Generic <source> elements
            const fvpVideo = getFloatingVideo();
            if (fvpVideo) {
                const sources = fvpVideo.querySelectorAll('source');
                if (sources.length > 1) {
                    sources.forEach((src, i) => {
                        const label = src.getAttribute('label') || src.getAttribute('size') ||
                            src.getAttribute('data-quality') || `Source ${i + 1}`;
                        levels.push({ label, value: src.src, active: fvpVideo.currentSrc === src.src, type: 'src' });
                    });
                }
            }
        } catch (e) { }

        emitQualityResult(levels);
    });

    // Listen for quality set requests
    window.addEventListener('fvp-set-quality', e => {
        const item = e.detail;
        if (!item) return;

        try {
            if (item.type === 'yt') {
                const ytPlayer = document.querySelector('#movie_player');
                ytPlayer?.setPlaybackQualityRange?.(item.value, item.value);
                ytPlayer?.setPlaybackQuality?.(item.value);
            } else if (item.type === 'hls') {
                const fvpVideo = getFloatingVideo();
                const hls = fvpVideo?._hls || fvpVideo?.hls || window.hls;
                if (hls) hls.currentLevel = item.value;
            } else if (item.type === 'src') {
                const fvpVideo = getFloatingVideo();
                if (fvpVideo) {
                    const t = fvpVideo.currentTime;
                    const playing = !fvpVideo.paused;
                    fvpVideo.src = item.value;
                    fvpVideo.currentTime = t;
                    if (playing) fvpVideo.play().catch(() => { });
                }
            }
        } catch (e) { }
    });
})();
