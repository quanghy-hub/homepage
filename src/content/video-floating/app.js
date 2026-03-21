import {
    FIT_MODES,
    FIT_ICONS,
    ZOOM_LEVELS,
    ZOOM_ICONS,
    IDLE_TIMEOUT,
    VIDEO_CHECK_INTERVAL,
} from './constants.js';
import {
    $,
    el,
    getCoord,
    formatTime,
    clamp,
    onPointer,
    getRect,
    hasVisibleSize,
    isDetectableVideo
} from './utils.js';
import {
    createConfigState,
    loadConfig,
    saveConfigValue,
    bindConfigSync
} from './config.js';
import {
    getFullscreenEl,
    getVideo,
    getVideoAtPoint,
    createSeekNotice,
    createAudioBoostController
} from './controls-core.js';
import { loadLayout, loadIconPos, saveIconPos, saveLayout } from './persistence.js';
import { toggleMenu as toggleFloatingMenu, renderResPopup as renderResPopupUI } from './menu-quality.js';
import { createFloatingRuntimeState, createIframePlaybackState } from './state.js';
import { syncIframeVideoMapFromSource } from './iframe-helpers.js';
import { getManagedVideos, createPlaceholder, bindFloatingVideoLoop } from './video-management.js';
import { bindFloatingEvents } from './events.js';
import {
    findChildIframeBySource,
    getTotalVideoCount,
    reportVideosToParent,
    postIframeStateToParent
} from './iframe-mode.js';

// ============================================
// FLOATING VIDEO PLAYER + VIDEO CONTROLS
// Chromium Extension - Content Script
// ============================================
(function () {
    'use strict';

    const isInIframe = window !== window.top;

    // ============================================
    // CONFIGURATION (chrome.storage.local)
    // ============================================

    const cfg = createConfigState();

    loadConfig();
    bindConfigSync(cfg);

    // ============================================
    // SHARED: VIDEO CONTROLS (swipe seek, keyboard, audio boost)
    // Works in both top frame and iframes
    // ============================================
    const resolveVideo = () => getVideo({ isInIframe });

    /* ─── SEEK NOTICE ─── */
    const showSeekNotice = createSeekNotice(cfg);

    /* ─── AUDIO BOOST ─── */
    const { applyBoost, getBoostNode } = createAudioBoostController(cfg);

    /* ─── KEYBOARD ─── */
    document.addEventListener('keydown', e => {
        if (!cfg.hotkeys || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        const v = resolveVideo();
        if (!v) return;
        switch (e.key) {
            case 'ArrowRight':
                v.currentTime += cfg.forwardStep;
                showSeekNotice(v, cfg.forwardStep);
                break;
            case 'ArrowLeft':
                v.currentTime -= cfg.forwardStep;
                showSeekNotice(v, -cfg.forwardStep);
                break;
            case 'b': case 'B':
                cfg.boostLevel = cfg.boostLevel >= cfg.maxBoost ? 1 : cfg.boostLevel + 1;
                saveConfigValue(cfg, 'boostLevel', cfg.boostLevel);
                applyBoost(v);
                const g = getBoostNode(v);
                if (g) g.gain.value = cfg.boostLevel;
                break;
        }
    }, true);

    /* ─── TOUCH SWIPE SEEK ─── */
    const swipe = { active: false, video: null, startX: 0, startY: 0, startTime: 0, lastUpdate: 0, cancelled: false };
    const resetSwipe = () => {
        swipe.active = false;
        swipe.cancelled = false;
        swipe.video = null;
    };
    const calcDelta = (dx, duration) => {
        const effectiveDx = dx > 0 ? dx - cfg.minSwipeDistance : dx + cfg.minSwipeDistance;
        const sens = duration <= cfg.shortThreshold ? cfg.swipeShort : cfg.swipeLong;
        return Math.round(effectiveDx * sens);
    };

    const onTouchStart = e => {
        resetSwipe();
        const t = e.touches?.length === 1 ? e.touches[0] : null;
        if (!t) return;
        try {
            let video;
            if (!isInIframe) {
                const fvp = document.getElementById('fvp-container');
                if (fvp && fvp.style.display !== 'none') {
                    const fr = getRect(fvp);
                    if (t.clientX >= fr.left && t.clientX <= fr.right &&
                        t.clientY >= fr.top && t.clientY <= fr.bottom) {
                        video = fvp.querySelector('#fvp-wrapper video');
                    }
                }
            }
            if (!video) video = getVideoAtPoint(t.clientX, t.clientY);
            if (!video?.isConnected || !Number.isFinite(video.duration) || video.duration <= 0) return;
            const rect = getRect(video);
            if (!rect.width || !rect.height) return;
            if (t.clientY > rect.bottom - rect.height * 0.15) return;
            Object.assign(swipe, {
                video, active: true,
                startX: t.clientX, startY: t.clientY,
                startTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
                lastUpdate: performance.now()
            });
        } catch (e) {
            resetSwipe();
        }
    };

    const onTouchMove = e => {
        if (!swipe.active || !swipe.video || swipe.cancelled) return;
        const t = e.touches?.length === 1 ? e.touches[0] : null;
        if (!t || !swipe.video.isConnected || !Number.isFinite(swipe.video.duration) || swipe.video.duration <= 0) {
            swipe.cancelled = true;
            return;
        }
        try {
            const dx = t.clientX - swipe.startX, dy = t.clientY - swipe.startY;
            const absDx = Math.abs(dx), absDy = Math.abs(dy);
            if (absDx < 5 && absDy < 5) return;
            if (absDy > cfg.verticalTolerance || (absDx > 0 && absDx / (absDy + 1) < cfg.diagonalThreshold)) {
                swipe.cancelled = true; return;
            }
            if (absDx < cfg.minSwipeDistance) return;
            if (absDx > absDy && e.cancelable) e.preventDefault();
            const delta = calcDelta(dx, swipe.video.duration);
            showSeekNotice(swipe.video, delta);
            if (cfg.realtimePreview) {
                const now = performance.now();
                if (now - swipe.lastUpdate > cfg.throttle) {
                    swipe.lastUpdate = now;
                    swipe.video.currentTime = clamp(swipe.startTime + delta, 0, swipe.video.duration);
                }
            }
        } catch (e) {
            swipe.cancelled = true;
        }
    };

    const onTouchEnd = e => {
        if (!swipe.active || !swipe.video) return;
        try {
            const t = e.changedTouches?.length === 1 ? e.changedTouches[0] : null;
            if (!swipe.cancelled && t && swipe.video.isConnected && Number.isFinite(swipe.video.duration) && swipe.video.duration > 0) {
                const dx = t.clientX - swipe.startX, dy = t.clientY - swipe.startY;
                const absDx = Math.abs(dx), absDy = Math.abs(dy);
                const isValid = absDx > absDy && absDx / (absDy + 1) >= cfg.diagonalThreshold
                    && absDx >= cfg.minSwipeDistance && absDy <= cfg.verticalTolerance;
                if (isValid) {
                    const delta = calcDelta(dx, swipe.video.duration);
                    if (!cfg.realtimePreview)
                        swipe.video.currentTime = clamp(swipe.startTime + delta, 0, swipe.video.duration);
                    showSeekNotice(swipe.video, delta);
                }
            }
        } catch (e) { }
        finally {
            resetSwipe();
        }
    };

    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    document.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });

    // ============================================
    // IFRAME MODE: aggregate direct + nested iframe videos, then report upward
    // ============================================
    if (isInIframe) {
        const childFrameVideoMap = new Map(); // direct child iframe element -> aggregated video count
        const iframeUiState = { fitIdx: 0, zoomIdx: 0, rotationAngle: 0 };
        let activeIframeVideo = null;
        let styledIframeVideo = null;

        const pruneDisconnectedChildFrames = () => {
            for (const iframe of [...childFrameVideoMap.keys()]) {
                if (!iframe?.isConnected) childFrameVideoMap.delete(iframe);
            }
        };

        const getOwnVideoCount = () => document.querySelectorAll('video').length;

        const getIframeVideos = () => [...document.querySelectorAll('video')].filter(isDetectableVideo);

        const clearIframeVideoPresentation = video => {
            if (!video) return;
            Object.assign(video.style, { objectFit: '', transform: '' });
        };

        const getCurrentIframeVideo = () => {
            if (activeIframeVideo?.isConnected) return activeIframeVideo;
            activeIframeVideo = getVideo() || getIframeVideos()[0] || null;
            return activeIframeVideo;
        };

        const applyIframeVideoPresentation = (video = getCurrentIframeVideo()) => {
            if (!video) return;
            if (styledIframeVideo && styledIframeVideo !== video) clearIframeVideoPresentation(styledIframeVideo);
            styledIframeVideo = video;
            const zoom = ZOOM_LEVELS[iframeUiState.zoomIdx];
            const transforms = [];
            if (iframeUiState.rotationAngle) transforms.push(`rotate(${iframeUiState.rotationAngle}deg)`);
            if (zoom !== 1) transforms.push(`scale(${zoom})`);
            video.style.transform = transforms.join(' ');
            video.style.objectFit = (iframeUiState.rotationAngle === 90 || iframeUiState.rotationAngle === 270)
                ? 'contain'
                : FIT_MODES[iframeUiState.fitIdx];
        };

        const switchIframeVideo = dir => {
            const list = getIframeVideos();
            if (!list.length) return null;
            const current = getCurrentIframeVideo();
            const idx = Math.max(0, list.indexOf(current));
            activeIframeVideo = list[(idx + dir + list.length) % list.length];
            iframeUiState.fitIdx = 0;
            iframeUiState.zoomIdx = 0;
            iframeUiState.rotationAngle = 0;
            applyIframeVideoPresentation(activeIframeVideo);
            return activeIframeVideo;
        };

        const getIframeBufferedEnd = video => {
            try {
                return video?.buffered?.length ? video.buffered.end(video.buffered.length - 1) : 0;
            } catch (e) {
                return 0;
            }
        };

        const postIframeState = () => {
            const video = getCurrentIframeVideo();
            postIframeStateToParent(video ? {
                hasVideo: true,
                paused: !!video.paused,
                muted: !!video.muted,
                volume: Number.isFinite(video.volume) ? video.volume : 1,
                currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
                duration: Number.isFinite(video.duration) ? video.duration : 0,
                bufferedEnd: getIframeBufferedEnd(video),
                fitIdx: iframeUiState.fitIdx,
                zoomIdx: iframeUiState.zoomIdx,
                rotationAngle: iframeUiState.rotationAngle
            } : {
                hasVideo: false,
                paused: true,
                muted: false,
                volume: 1,
                currentTime: 0,
                duration: 0,
                bufferedEnd: 0,
                fitIdx: iframeUiState.fitIdx,
                zoomIdx: iframeUiState.zoomIdx,
                rotationAngle: iframeUiState.rotationAngle
            });
        };

        const reportVideos = () => {
            const count = getTotalVideoCount({ pruneDisconnectedChildFrames, getOwnVideoCount, childFrameVideoMap });
            reportVideosToParent(count);
        };

        window.addEventListener('fvp-quality-result', e => {
            try {
                window.parent.postMessage({ type: 'fvp-iframe-quality-result', detail: e.detail || [] }, '*');
            } catch (e) { }
        });

        window.addEventListener('message', e => {
            if (e.data?.type === 'fvp-iframe-videos') {
                const childIframe = findChildIframeBySource(e.source);
                if (!childIframe) return;
                if (e.data.count > 0) childFrameVideoMap.set(childIframe, e.data.count);
                else childFrameVideoMap.delete(childIframe);
                reportVideos();
                return;
            }

            if (e.data?.type !== 'fvp-iframe-command') return;

            const video = getCurrentIframeVideo();
            switch (e.data.command) {
                case 'get-state':
                    break;
                case 'play-pause':
                    if (video) video.paused ? video.play().catch(() => { }) : video.pause();
                    break;
                case 'toggle-mute':
                    if (video) video.muted = !video.muted;
                    break;
                case 'seek-to-ratio':
                    if (video && Number.isFinite(video.duration) && video.duration > 0) {
                        video.currentTime = clamp((e.data.ratio || 0) * video.duration, 0, video.duration);
                    }
                    break;
                case 'prev-video':
                    switchIframeVideo(-1);
                    break;
                case 'next-video':
                    switchIframeVideo(1);
                    break;
                case 'cycle-fit':
                    iframeUiState.fitIdx = (iframeUiState.fitIdx + 1) % FIT_MODES.length;
                    applyIframeVideoPresentation();
                    break;
                case 'cycle-zoom':
                    iframeUiState.zoomIdx = (iframeUiState.zoomIdx + 1) % ZOOM_LEVELS.length;
                    applyIframeVideoPresentation();
                    break;
                case 'rotate':
                    iframeUiState.rotationAngle = (iframeUiState.rotationAngle + 90) % 360;
                    applyIframeVideoPresentation();
                    break;
                case 'get-quality':
                    window.dispatchEvent(new CustomEvent('fvp-get-quality'));
                    break;
                case 'set-quality':
                    window.dispatchEvent(new CustomEvent('fvp-set-quality', { detail: e.data.item }));
                    break;
            }

            postIframeState();
            setTimeout(postIframeState, 80);
        });

        const observerRoot = document.documentElement || document.body;
        if (observerRoot) {
            new MutationObserver(() => {
                pruneDisconnectedChildFrames();
                reportVideos();
            }).observe(observerRoot, { childList: true, subtree: true });
        }

        reportVideos();
        setInterval(reportVideos, VIDEO_CHECK_INTERVAL);
        console.log('🎬 FVP iframe mode: nested video controls active');
        return; // Exit - no floating player UI in iframes
    }

    // ============================================
    // TOP FRAME ONLY: Everything below runs only in the top frame
    // ============================================

    // ============================================
    // PERSISTENCE (localStorage)
    // ============================================
    // ============================================
    // STATE
    // ============================================
    let box, icon, menu, curVid, origPar, ph;
    let fitIdx = 0, zoomIdx = 0, rotationAngle = 0;

    // Iframe floating state
    let floatedIframe = null, iframeOrigPar = null, iframePh = null, iframeOrigStyle = '';
    const iframeVideoMap = new Map(); // iframe element -> aggregated video count
    let iframeStatePollTimer = 0;
    const iframePlaybackState = createIframePlaybackState();

    const pruneDisconnectedIframeEntries = () => {
        for (const iframe of [...iframeVideoMap.keys()]) {
            if (!iframe?.isConnected) iframeVideoMap.delete(iframe);
        }
    };

    const isVisibleVideoCandidate = video => {
        if (video === curVid) return true;
        if (!isDetectableVideo(video)) return false;
        const rect = getRect(video);
        const width = Math.max(video.offsetWidth || 0, video.clientWidth || 0, rect.width || 0);
        const height = Math.max(video.offsetHeight || 0, video.clientHeight || 0, rect.height || 0);
        return width > 50 && height > 50;
    };

    const updateVideoDetectionUI = () => {
        pruneDisconnectedIframeEntries();
        const list = getVideos().filter(isVisibleVideoCandidate);
        const totalCount = list.length + iframeVideoMap.size;
        if (icon) icon.style.display = totalCount ? 'flex' : 'none';
        const badge = $('fvp-badge');
        if (badge) {
            badge.textContent = totalCount;
            badge.style.display = totalCount > 1 ? 'flex' : 'none';
        }
    };

    let detectionRafId = 0;
    const scheduleVideoDetectionUI = () => {
        if (detectionRafId) return;
        detectionRafId = requestAnimationFrame(() => {
            detectionRafId = 0;
            updateVideoDetectionUI();
        });
    };

    const state = createFloatingRuntimeState();

    // ============================================
    // UI FUNCTIONS
    // ============================================
    const updateVolUI = () => {
        if (floatedIframe) {
            const v = iframePlaybackState.muted ? 0 : iframePlaybackState.volume;
            $('fvp-vol-btn').textContent = v === 0 ? '🔇' : v < 0.5 ? '🔉' : '🔊';
            return;
        }
        if (!curVid) return;
        const v = curVid.muted ? 0 : curVid.volume;
        $('fvp-vol-btn').textContent = v === 0 ? '🔇' : v < 0.5 ? '🔉' : '🔊';
    };

    const updatePlayPauseUI = () => {
        if (floatedIframe) {
            $('fvp-play-pause').textContent = iframePlaybackState.paused ? '▶' : '⏸';
            return;
        }
        if (curVid) $('fvp-play-pause').textContent = curVid.paused ? '▶' : '⏸';
    };

    const updateIframeTransformUI = () => {
        $('fvp-fit').textContent = FIT_ICONS[iframePlaybackState.fitIdx] || FIT_ICONS[0];
        $('fvp-zoom').textContent = ZOOM_ICONS[iframePlaybackState.zoomIdx] || ZOOM_ICONS[0];
        $('fvp-rotate').style.transform = `rotate(${iframePlaybackState.rotationAngle || 0}deg)`;
    };

    const postToFloatedIframe = payload => {
        try { floatedIframe?.contentWindow?.postMessage({ type: 'fvp-iframe-command', ...payload }, '*'); } catch (e) { }
    };

    const requestFloatedIframeState = () => {
        if (!floatedIframe) return;
        postToFloatedIframe({ command: 'get-state' });
    };

    const stopIframeStatePolling = () => {
        clearInterval(iframeStatePollTimer);
        iframeStatePollTimer = 0;
    };

    const startIframeStatePolling = () => {
        stopIframeStatePolling();
        requestFloatedIframeState();
        iframeStatePollTimer = setInterval(requestFloatedIframeState, 350);
    };

    const syncFloatedIframeUI = () => {
        const seek = $('fvp-seek');
        const duration = iframePlaybackState.duration || 0;
        const currentTime = iframePlaybackState.currentTime || 0;
        if (seek && duration > 0 && !state.isSeeking) seek.value = (currentTime / duration) * 10000;
        $('fvp-time-display').textContent = `${formatTime(currentTime)}/${formatTime(duration)}`;
        $('fvp-buffer').style.width = duration > 0 ? `${(iframePlaybackState.bufferedEnd / duration) * 100}%` : '0%';
        updateVolUI();
        updatePlayPauseUI();
        updateIframeTransformUI();
    };

    const applyTransform = () => {
        if (!curVid) return;
        const zoom = ZOOM_LEVELS[zoomIdx];
        const transforms = [];
        if (rotationAngle) transforms.push(`rotate(${rotationAngle}deg)`);
        if (zoom !== 1) transforms.push(`scale(${zoom})`);
        curVid.style.transform = transforms.join(' ');
        curVid.style.objectFit = (rotationAngle === 90 || rotationAngle === 270) ? 'contain' : FIT_MODES[fitIdx];
    };

    const adjustForRotation = () => {
        if (!box || !curVid || document.fullscreenElement === box) return;
        if (!state.origW) { state.origW = box.offsetWidth; state.origH = box.offsetHeight; }
        if (rotationAngle === 90 || rotationAngle === 270) {
            box.style.width = `${Math.min(state.origH, innerWidth - 40)}px`;
            box.style.height = `${Math.min(state.origW, innerHeight - 100)}px`;
            const r = box.getBoundingClientRect();
            if (r.right > innerWidth) box.style.left = `${innerWidth - r.width - 10}px`;
            if (r.bottom > innerHeight) box.style.top = `${innerHeight - r.height - 10}px`;
        } else {
            box.style.width = `${state.origW}px`;
            box.style.height = `${state.origH}px`;
        }
    };

    const resetIdle = () => {
        if (!icon) return;
        icon.classList.remove('fvp-idle');
        clearTimeout(state.idleTimer);
        state.idleTimer = setTimeout(() => icon?.classList.add('fvp-idle'), IDLE_TIMEOUT);
    };

    // Show/hide video-specific controls
    const setVideoControlsVisible = (visible) => {
        const display = visible ? '' : 'none';
        ['fvp-play-pause', 'fvp-vol-btn', 'fvp-res', 'fvp-zoom', 'fvp-fit', 'fvp-rotate', 'fvp-prev', 'fvp-next'].forEach(id => {
            const e = $(id);
            if (e) e.style.display = display;
        });
        const ctrl = $('fvp-ctrl');
        if (ctrl) ctrl.style.display = display;
        const resPopup = $('fvp-res-popup');
        if (resPopup) resPopup.style.display = 'none';
    };

    // ============================================
    // VIDEO MANAGEMENT
    // ============================================
    const getVideos = () => getManagedVideos(curVid);

    const switchVid = dir => {
        const list = getVideos();
        if (!curVid || list.length < 2) return;
        const idx = list.indexOf(curVid);
        if (idx >= 0) float(list[(idx + dir + list.length) % list.length]);
    };

    const restore = () => {
        if (floatedIframe) { restoreIframe(); return; }
        if (!curVid) return;
        cancelAnimationFrame(state.rafId);
        origPar?.replaceChild(curVid, ph);
        Object.assign(curVid.style, { width: '', height: '', objectFit: '', objectPosition: '', transform: '' });
        curVid.onloadedmetadata = curVid.onended = curVid.onplay = curVid.onpause = null;
        box.style.display = 'none';
        zoomIdx = 0; rotationAngle = 0; state.origW = state.origH = 0;
        curVid = null;
        setVideoControlsVisible(true);
    };

    // ============================================
    // IFRAME FLOATING
    // ============================================
    const floatIframe = (iframe) => {
        if (curVid) restore();
        if (floatedIframe === iframe) return;
        if (floatedIframe) restoreIframe();
        if (!box) init();

        floatedIframe = iframe;
        iframeOrigPar = iframe.parentNode;
        iframeOrigStyle = iframe.getAttribute('style') || '';

        // Create placeholder
        iframePh = createPlaceholder(iframe);
        iframeOrigPar?.replaceChild(iframePh, iframe);

        // Put iframe in the wrapper
        const wrapper = $('fvp-wrapper');
        wrapper.innerHTML = '';
        iframe.style.cssText = 'width:100%!important;height:100%!important;border:none!important;position:absolute;top:0;left:0;pointer-events:auto;';
        wrapper.appendChild(iframe);

        // Keep video-specific controls visible for iframe full-control mode
        Object.assign(iframePlaybackState, {
            hasVideo: false,
            paused: true,
            muted: false,
            volume: 1,
            currentTime: 0,
            duration: 0,
            bufferedEnd: 0,
            fitIdx: 0,
            zoomIdx: 0,
            rotationAngle: 0
        });
        setVideoControlsVisible(true);
        $('fvp-buffer').style.width = '0%';
        $('fvp-time-display').textContent = '0.00/0.00';
        updatePlayPauseUI();
        updateVolUI();
        updateIframeTransformUI();

        box.style.display = 'flex';
        menu.style.display = 'none';
        startIframeStatePolling();

        // Layout
        const saved = loadLayout();
        if (saved) {
            box.style.width = saved.width;
            box.style.height = saved.height;
            box.style.top = saved.top;
            box.style.left = saved.left;
            box.style.borderRadius = saved.borderRadius || '12px';
        } else {
            const isPortrait = innerHeight > innerWidth;
            if (isPortrait) {
                box.style.width = `${innerWidth}px`;
                box.style.height = `${innerHeight}px`;
                box.style.top = '0px';
                box.style.left = '0px';
                box.style.borderRadius = '0';
            } else {
                const w = Math.floor(innerWidth * 0.6);
                const h = innerHeight - 40;
                box.style.width = `${w}px`;
                box.style.height = `${h}px`;
                box.style.top = '20px';
                box.style.left = `${Math.floor((innerWidth - w) / 2)}px`;
                box.style.borderRadius = '12px';
            }
        }
    };

    const restoreIframe = () => {
        if (!floatedIframe) return;
        stopIframeStatePolling();
        floatedIframe.setAttribute('style', iframeOrigStyle);
        iframeOrigPar?.replaceChild(floatedIframe, iframePh);
        box.style.display = 'none';
        setVideoControlsVisible(true);
        floatedIframe = null;
        iframeOrigPar = null;
        iframePh = null;
        iframeOrigStyle = '';
    };

    // Listen for iframe video reports
    window.addEventListener('message', e => {
        if (e.data?.type === 'fvp-iframe-videos') {
            pruneDisconnectedIframeEntries();
            const iframes = document.querySelectorAll('iframe');
            syncIframeVideoMapFromSource({
                iframes,
                source: e.source,
                count: e.data.count,
                iframeVideoMap,
                scheduleVideoDetectionUI
            });
        }

        if (e.data?.type === 'fvp-iframe-state' && floatedIframe?.contentWindow === e.source) {
            Object.assign(iframePlaybackState, e.data.state || {});
            syncFloatedIframeUI();
        }

        if (e.data?.type === 'fvp-iframe-quality-result' && floatedIframe?.contentWindow === e.source) {
            renderResPopup(e.data.detail || []);
        }
    });

    // ============================================
    // FLOAT VIDEO
    // ============================================
    const float = v => {
        if (floatedIframe) restoreIframe();
        if (curVid && curVid !== v) restore();
        if (curVid === v) return;
        if (!box) init();

        origPar = v.parentNode;
        curVid = v;

        ph = createPlaceholder(v);
        origPar?.replaceChild(ph, v);

        const wrapper = $('fvp-wrapper');
        wrapper.innerHTML = '';
        wrapper.appendChild(v);

        v.style.objectFit = FIT_MODES[fitIdx];
        zoomIdx = 0; rotationAngle = 0;
        applyTransform();

        // Ensure video controls are visible
        setVideoControlsVisible(true);

        $('fvp-zoom').textContent = ZOOM_ICONS[0];
        $('fvp-rotate').style.transform = '';
        updateVolUI();

        box.style.display = 'flex';
        menu.style.display = 'none';

        const saved = loadLayout();
        if (saved) {
            box.style.width = saved.width;
            box.style.height = saved.height;
            box.style.top = saved.top;
            box.style.left = saved.left;
            box.style.borderRadius = saved.borderRadius || '12px';
        } else {
            const isPortrait = innerHeight > innerWidth;
            if (isPortrait) {
                box.style.width = `${innerWidth}px`;
                box.style.height = `${innerHeight}px`;
                box.style.top = '0px';
                box.style.left = '0px';
                box.style.borderRadius = '0';
            } else {
                const w = Math.floor(innerWidth * 0.5);
                const h = innerHeight - 40;
                box.style.width = `${w}px`;
                box.style.height = `${h}px`;
                box.style.top = '20px';
                box.style.left = `${Math.floor((innerWidth - w) / 2)}px`;
                box.style.borderRadius = '12px';
            }
        }

        bindFloatingVideoLoop({
            video: curVid,
            seekEl: $('fvp-seek'),
            timeDisplayEl: $('fvp-time-display'),
            bufferEl: $('fvp-buffer'),
            state
        });

        v.onplay = v.onpause = updatePlayPauseUI;
        v.onended = () => switchVid(1);
        v.play().catch(() => { });
        updatePlayPauseUI();
    };

    // ============================================
    // MENU
    // ============================================
    const toggleMenu = () => toggleFloatingMenu({ icon, menu, innerWidth, innerHeight, resetIdle, renderMenu });

    const renderMenu = () => {
        pruneDisconnectedIframeEntries();
        const list = getVideos();
        const iframeList = [...iframeVideoMap.entries()];
        const totalCount = list.length + iframeList.length;

        menu.innerHTML = `<div style="padding:10px 16px;font-size:12px;color:#888;font-weight:600">VIDEOS (${totalCount})</div>`;

        if (!totalCount) {
            const empty = el('div', 'fvp-menu-item', '<span>📹</span><span style="flex:1">No videos found</span>');
            empty.style.opacity = '0.5';
            menu.appendChild(empty);
            return;
        }

        // Regular videos
        list.forEach((v, i) => {
            const active = v === curVid;
            const item = el('div', `fvp-menu-item${active ? ' active' : ''}`,
                `<span>${active ? '▶' : '🎬'}</span><span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Video ${i + 1}${active ? ' (Current)' : ''}</span>`);
            item.onclick = () => float(v);
            menu.appendChild(item);
        });

        // Iframe videos
        iframeList.forEach(([iframe]) => {
            const active = floatedIframe === iframe;
            const src = iframe.src || '';
            const domain = (() => { try { return new URL(src).hostname; } catch { return 'iframe'; } })();
            const item = el('div', `fvp-menu-item${active ? ' active' : ''}`,
                `<span>${active ? '▶' : '🖼️'}</span><span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">iFrame: ${domain}${active ? ' (Current)' : ''}</span>`);
            item.onclick = () => floatIframe(iframe);
            menu.appendChild(item);
        });
    };

    // ============================================
    // FULLSCREEN
    // ============================================
    const toggleFullscreen = () => {
        const fs = document.fullscreenElement || document.webkitFullscreenElement;
        if (!fs) (box.requestFullscreen || box.webkitRequestFullscreen || box.mozRequestFullScreen)?.call(box);
        else (document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen)?.call(document);
    };

    // ============================================
    // EVENTS
    // ============================================
    const setupEvents = () => bindFloatingEvents({
        icon,
        box,
        state,
        innerWidth,
        innerHeight,
        resetIdle,
        toggleMenu,
        saveIconPos,
        saveLayout,
        floatedIframe,
        postToFloatedIframe,
        fitIdxRef: () => fitIdx,
        zoomIdxRef: () => zoomIdx,
        rotationAngleRef: () => rotationAngle,
        curVidRef: () => curVid,
        updateVolUI,
        applyTransform,
        adjustForRotation,
        toggleFullscreen,
        updatePlayPauseUI,
        toggleResPopup,
        switchVid,
        restore,
        iframePlaybackState,
        formatTime,
        setSeeking: value => { state.isSeeking = value; },
        setCurVideoTime: value => { if (curVid) curVid.currentTime = value; },
        getCurVideo: () => curVid,
        getFloatedIframe: () => floatedIframe,
        setFitIdx: value => { fitIdx = value; },
        setZoomIdx: value => { zoomIdx = value; },
        setRotationAngle: value => { rotationAngle = value; }
    });

    // ============================================
    // RESOLUTION SELECTOR (via CustomEvent bridge to page_api.js MAIN world)
    // ============================================
    const setQuality = (item) => {
        if (floatedIframe) {
            postToFloatedIframe({ command: 'set-quality', item });
            $('fvp-res-popup').style.display = 'none';
            return;
        }
        window.dispatchEvent(new CustomEvent('fvp-set-quality', { detail: item }));
        $('fvp-res-popup').style.display = 'none';
    };

    const renderResPopup = levels => renderResPopupUI({
        popup: $('fvp-res-popup'),
        levels,
        onSelect: setQuality
    });

    window.addEventListener('fvp-quality-result', e => {
        renderResPopup(e.detail || []);
    });

    const toggleResPopup = () => {
        const popup = $('fvp-res-popup');
        if (!popup) return;
        const isShown = popup.style.display === 'flex';
        if (isShown) { popup.style.display = 'none'; return; }
        if (floatedIframe) {
            postToFloatedIframe({ command: 'get-quality' });
            return;
        }
        window.dispatchEvent(new CustomEvent('fvp-get-quality'));
    };

    // ============================================
    // INITIALIZATION
    // ============================================
    const init = () => {
        // Icon
        icon = el('div', 'fvp-idle', `
            <svg viewBox="0 0 24 24" style="width:24px;fill:#fff">
                <path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/>
            </svg>
            <span id="fvp-badge" style="display:none">0</span>
        `);
        icon.id = 'fvp-master-icon';
        const savedIcon = loadIconPos();
        const iconTop = savedIcon ? savedIcon.top : `${(innerHeight - 48) / 2}px`;
        const iconLeft = savedIcon ? savedIcon.left : '12px';
        Object.assign(icon.style, { top: iconTop, left: iconLeft, display: document.querySelectorAll('video').length || iframeVideoMap.size ? 'flex' : 'none' });
        document.body.appendChild(icon);

        // Menu
        menu = el('div');
        menu.id = 'fvp-menu';
        document.body.appendChild(menu);

        // Player Box
        box = el('div', '', `
            <div id="fvp-wrapper"></div>
            <div id="fvp-left-drag"></div>
            <div id="fvp-left-panel">
                <button id="fvp-vol-btn" class="fvp-btn" title="Mute/Unmute">🔊</button>
                <button id="fvp-res" class="fvp-btn" title="Quality" style="font-size:11px;font-weight:700">HD</button>
                <div id="fvp-res-popup"></div>
                <button id="fvp-rotate" class="fvp-btn" title="Rotate 90°">↻</button>
                <button id="fvp-zoom" class="fvp-btn" title="Zoom video">+</button>
                <button id="fvp-fit" class="fvp-btn" title="Fit mode">⤢</button>
                <button id="fvp-full" class="fvp-btn" title="Fullscreen">⛶</button>
                <button id="fvp-close" class="fvp-btn" title="Close">✕</button>
                <button id="fvp-play-pause" class="fvp-btn" title="Play/Pause">▶</button>
                <button id="fvp-prev" class="fvp-btn" title="Previous">⏮</button>
                <button id="fvp-next" class="fvp-btn" title="Next">⏭</button>
            </div>
            <div class="fvp-resize-handle fvp-resize-br"></div>
            <div class="fvp-resize-handle fvp-resize-bl"></div>
            <div id="fvp-ctrl" class="fvp-overlay">
                <div id="fvp-seek-row">
                    <span id="fvp-time-display">0.00/0.00</span>
                    <div id="fvp-seek-container">
                        <div id="fvp-seek-track"><div id="fvp-buffer"></div></div>
                        <input type="range" id="fvp-seek" min="0" max="10000" step="1" value="0" title="Seek">
                    </div>
                </div>
            </div>
        `);
        box.id = 'fvp-container';
        box.style.display = 'none';
        document.body.appendChild(box);

        setupEvents();
        resetIdle();
        scheduleVideoDetectionUI();
    };

    const detectionObserverRoot = document.documentElement || document.body;
    if (detectionObserverRoot) {
        new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.target?.id?.startsWith?.('fvp-')) continue;
                if ([...mutation.addedNodes, ...mutation.removedNodes].some(node => node?.id?.startsWith?.('fvp-'))) continue;
                scheduleVideoDetectionUI();
                break;
            }
        }).observe(detectionObserverRoot, { childList: true, subtree: true });
    }

    window.addEventListener('resize', scheduleVideoDetectionUI, { passive: true });
    window.addEventListener('orientationchange', scheduleVideoDetectionUI, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) scheduleVideoDetectionUI();
    });

    // Video detection (includes iframe tracking)
    setInterval(() => {
        updateVideoDetectionUI();
    }, VIDEO_CHECK_INTERVAL);

    // Start
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
    console.log('🎬 Floating Video Player + Video Controls Extension Loaded');
})();
