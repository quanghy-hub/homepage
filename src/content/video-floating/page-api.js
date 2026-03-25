// ============================================
// PAGE CONTEXT API (runs in MAIN world)
// Provides access to YouTube/HLS/player APIs
// that are not available from isolated world
// ============================================
(function () {
    'use strict';

    const FVP_IFRAME_BRIDGE = 'fvp-page-bridge';

    const getFloatingVideo = () => document.querySelector('#fvp-wrapper video') || document.querySelector('video');
    const emitQualityResult = levels => {
        window.dispatchEvent(new CustomEvent('fvp-quality-result', { detail: levels }));
    };

    const postBridgeMessage = payload => {
        try {
            window.postMessage({ source: FVP_IFRAME_BRIDGE, ...payload }, '*');
        } catch (e) { }
    };

    const uniqueLevels = levels => {
        const seen = new Set();
        return levels.filter(level => {
            const key = `${level.type}:${String(level.value)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };

    const parseResolutionLabel = value => {
        const match = String(value || '').match(/(\d{3,4})p?/i);
        return match ? `${match[1]}p` : String(value || 'Auto');
    };

    const detectYouTubePlayer = () => {
        const player = document.querySelector('#movie_player');
        if (!player?.getAvailableQualityLevels) return null;
        return {
            type: 'yt',
            getLevels() {
                const ytLabels = {
                    highres: '4K+', hd2160: '2160p', hd1440: '1440p',
                    hd1080: '1080p', hd720: '720p', large: '480p',
                    medium: '360p', small: '240p', tiny: '144p'
                };
                const current = player.getPlaybackQuality?.() || '';
                const levels = [];
                (player.getAvailableQualityLevels?.() || []).forEach(q => {
                    if (q === 'auto') return;
                    levels.push({ label: ytLabels[q] || q, value: q, active: q === current, type: 'yt' });
                });
                return levels;
            },
            setQuality(item) {
                player.setPlaybackQualityRange?.(item.value, item.value);
                player.setPlaybackQuality?.(item.value);
            }
        };
    };

    const detectVideoJsPlayer = video => {
        const player = video?.player || video?.__player || window.videojs?.getPlayer?.(video.id || video.getAttribute('id'));
        if (!player?.qualityLevels) return null;
        return {
            type: 'videojs',
            getLevels() {
                const qualityLevels = player.qualityLevels?.();
                const levels = [];
                if (!qualityLevels?.length) return levels;
                for (let i = 0; i < qualityLevels.length; i++) {
                    const level = qualityLevels[i];
                    const label = level.height ? `${level.height}p` : level.label || `Level ${i + 1}`;
                    levels.push({
                        label,
                        value: i,
                        active: level.enabled === true,
                        type: 'videojs'
                    });
                }
                return levels;
            },
            setQuality(item) {
                const qualityLevels = player.qualityLevels?.();
                if (!qualityLevels?.length) return;
                for (let i = 0; i < qualityLevels.length; i++) {
                    qualityLevels[i].enabled = i === item.value;
                }
            }
        };
    };

    const detectHlsPlayer = video => {
        const hls = video?._hls || video?.hls || window.hls || window.Hls?.instances?.[0];
        if (!hls?.levels?.length) return null;
        return {
            type: 'hls',
            getLevels() {
                const levels = hls.levels.map((lv, i) => {
                    const h = lv.height || lv.attrs?.RESOLUTION?.split('x')[1] || lv.name;
                    return {
                        label: h ? `${String(h).replace(/p$/i, '')}p` : `Level ${i}`,
                        value: i,
                        active: hls.currentLevel === i || hls.loadLevel === i,
                        type: 'hls'
                    };
                });
                levels.sort((a, b) => parseInt(b.label) - parseInt(a.label));
                levels.unshift({ label: 'Auto', value: -1, active: hls.currentLevel === -1, type: 'hls' });
                return levels;
            },
            setQuality(item) {
                hls.currentLevel = item.value;
            }
        };
    };

    const detectShakaPlayer = video => {
        const player = video?.shakaPlayer || window.shakaPlayer || window.player;
        if (!player?.getVariantTracks) return null;
        return {
            type: 'shaka',
            getLevels() {
                const tracks = player.getVariantTracks() || [];
                return tracks
                    .filter(track => !track.audioOnly)
                    .map(track => ({
                        label: track.height ? `${track.height}p` : `${Math.round((track.bandwidth || 0) / 1000)}kbps`,
                        value: track.id,
                        active: !!track.active,
                        type: 'shaka'
                    }));
            },
            setQuality(item) {
                const tracks = player.getVariantTracks?.() || [];
                const track = tracks.find(entry => entry.id === item.value);
                if (!track) return;
                player.configure?.({ abr: { enabled: false } });
                player.selectVariantTrack?.(track, true);
            }
        };
    };

    const detectPlyrPlayer = video => {
        const player = video?.plyr || window.plyr || window.player;
        const quality = player?.quality;
        if (!player || !quality || !Array.isArray(quality.options)) return null;
        return {
            type: 'plyr',
            getLevels() {
                return quality.options.map(value => ({
                    label: parseResolutionLabel(value),
                    value,
                    active: quality.current === value,
                    type: 'plyr'
                }));
            },
            setQuality(item) {
                quality.current = item.value;
            }
        };
    };

    const detectSourceLevels = video => {
        if (!video) return null;
        const sources = [...video.querySelectorAll('source')];
        if (sources.length <= 1) return null;
        return {
            type: 'src',
            getLevels() {
                return sources.map((src, i) => ({
                    label: src.getAttribute('label') || src.getAttribute('size') || src.getAttribute('data-quality') || `Source ${i + 1}`,
                    value: src.src,
                    active: video.currentSrc === src.src,
                    type: 'src'
                }));
            },
            setQuality(item) {
                const t = video.currentTime;
                const playing = !video.paused;
                video.src = item.value;
                video.currentTime = t;
                if (playing) video.play().catch(() => { });
            }
        };
    };

    const resolveQualityController = () => {
        const video = getFloatingVideo();
        return detectYouTubePlayer()
            || detectVideoJsPlayer(video)
            || detectHlsPlayer(video)
            || detectShakaPlayer(video)
            || detectPlyrPlayer(video)
            || detectSourceLevels(video);
    };

    const handleGetQuality = () => {
        const controller = resolveQualityController();
        const levels = controller ? uniqueLevels(controller.getLevels() || []) : [];
        emitQualityResult(levels);
        postBridgeMessage({ type: 'fvp-page-quality-result', detail: levels });
    };

    const handleSetQuality = item => {
        if (!item) return;
        const controller = resolveQualityController();
        if (!controller) return;
        try {
            controller.setQuality(item);
        } catch (e) { }
        setTimeout(handleGetQuality, 120);
    };

    // Listen for quality level requests from content script
    window.addEventListener('fvp-get-quality', handleGetQuality);

    // Listen for quality set requests
    window.addEventListener('fvp-set-quality', e => {
        handleSetQuality(e.detail);
    });

    window.addEventListener('message', e => {
        if (e.source !== window || e.data?.source !== FVP_IFRAME_BRIDGE) return;
        if (e.data?.type === 'fvp-page-get-quality') {
            handleGetQuality();
        } else if (e.data?.type === 'fvp-page-set-quality') {
            handleSetQuality(e.data.item);
        }
    });
})();
