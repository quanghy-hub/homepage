// ============================================
// FLOATING VIDEO PLAYER + VIDEO CONTROLS
// Chromium Extension - Content Script
// ============================================
(function () {
    'use strict';

    const isInIframe = window !== window.top;
    const FVP_IFRAME_BRIDGE = 'fvp-page-bridge';

    // ============================================
    // CONSTANTS
    // ============================================
    const FIT_MODES = ['contain', 'cover', 'fill'];
    const FIT_ICONS = ['⤢', '🔍', '↔'];
    const ZOOM_LEVELS = [1, 1.5, 2, 3];
    const ZOOM_ICONS = ['+', '++', '+++', '-'];
    const IDLE_TIMEOUT = 3000;
    const VIDEO_CHECK_INTERVAL = 2000;

    // ============================================
    // UTILITIES
    // ============================================
    const $ = id => document.getElementById(id);
    const el = (tag, cls, html) => Object.assign(document.createElement(tag), { className: cls || '', innerHTML: html || '' });
    const getCoord = e => { const t = e.touches?.[0] || e.changedTouches?.[0] || e; return { x: t.clientX, y: t.clientY }; };
    const formatTime = s => `${Math.floor(s / 60)}.${(Math.floor(s) % 60).toString().padStart(2, '0')}`;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const onPointer = (el, fn, passive = false) => { el?.addEventListener('touchstart', fn, { passive }); el?.addEventListener('mousedown', fn); };
    const getRect = node => node?.getBoundingClientRect?.() || { width: 0, height: 0, left: 0, right: 0, top: 0, bottom: 0 };
    const hasVisibleSize = node => {
        const rect = getRect(node);
        const width = Math.max(node?.offsetWidth || 0, node?.clientWidth || 0, rect.width || 0);
        const height = Math.max(node?.offsetHeight || 0, node?.clientHeight || 0, rect.height || 0);
        return width > 0 && height > 0;
    };
    const isDetectableVideo = video => !!video && video.isConnected && hasVisibleSize(video);

    // ============================================
    // CONFIGURATION (chrome.storage.local)
    // ============================================
    const VF_STORE = 'VF_FINAL_V2';
    const VF_DEF = {
        swipeLong: 0.3, swipeShort: 0.15, shortThreshold: 200,
        minSwipeDistance: 30, verticalTolerance: 80, diagonalThreshold: 1.5,
        realtimePreview: true, throttle: 15,
        forwardStep: 5, hotkeys: true,
        boost: true, boostLevel: 1, maxBoost: 5,
        noticeFontSize: 14
    };

    const cfg = {};
    Object.keys(VF_DEF).forEach(k => cfg[k] = VF_DEF[k]);

    const loadConfig = () => {
        try {
            chrome.storage.local.get(VF_STORE, data => {
                const saved = data[VF_STORE];
                if (saved) Object.keys(VF_DEF).forEach(k => { if (saved[k] !== undefined) cfg[k] = saved[k]; });
            });
        } catch (e) { }
    };

    const saveCfg = (k, v) => {
        cfg[k] = v;
        try {
            chrome.storage.local.get(VF_STORE, data => {
                const saved = data[VF_STORE] || {};
                saved[k] = v;
                chrome.storage.local.set({ [VF_STORE]: saved });
            });
        } catch (e) { }
    };

    loadConfig();
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes[VF_STORE]) {
                const newVal = changes[VF_STORE].newValue;
                if (newVal) Object.keys(VF_DEF).forEach(k => { if (newVal[k] !== undefined) cfg[k] = newVal[k]; });
            }
        });
    } catch (e) { }

    // ============================================
    // SHARED: VIDEO CONTROLS (swipe seek, keyboard, audio boost)
    // Works in both top frame and iframes
    // ============================================
    const getFullscreenEl = () =>
        document.fullscreenElement || document.webkitFullscreenElement || null;

    const getVideo = () => {
        const fs = getFullscreenEl();
        if (fs) {
            if (fs.tagName === 'VIDEO') return fs;
            const v = fs.querySelector('video');
            if (v) return v;
        }
        if (!isInIframe) {
            const fvp = document.getElementById('fvp-container');
            if (fvp && fvp.style.display !== 'none') {
                const v = fvp.querySelector('#fvp-wrapper video');
                if (v) return v;
            }
        }
        return [...document.querySelectorAll('video')]
            .find(v => isDetectableVideo(v) && !v.closest('#fvp-wrapper')) || null;
    };

    const getVideoAtPoint = (x, y) => {
        for (const v of document.querySelectorAll('video')) {
            if (!isDetectableVideo(v)) continue;
            if (v.closest('#fvp-wrapper')) continue;
            const r = getRect(v);
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return v;
        }
        return null;
    };

    /* ─── SEEK NOTICE ─── */
    let noticeEl, hideTimer;
    const showSeekNotice = (video, delta) => {
        if (!video) return;
        const fs = getFullscreenEl();
        const container = (fs && (fs === video || fs.contains(video)))
            ? fs : (video.parentElement || document.body);
        if (!noticeEl || !container.contains(noticeEl)) {
            noticeEl?.remove();
            noticeEl = document.createElement('div');
            noticeEl.className = 'vf-notice';
            noticeEl.style.fontSize = cfg.noticeFontSize + 'px';
            if (getComputedStyle(container).position === 'static')
                container.style.position = 'relative';
            container.appendChild(noticeEl);
        }
        noticeEl.textContent = `${delta >= 0 ? '▶ +' : '◀ '}${delta}s`;
        noticeEl.classList.add('show');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => noticeEl.classList.remove('show'), 700);
    };

    /* ─── AUDIO BOOST ─── */
    let audioCtx;
    const boostMap = new WeakMap();
    const getAudioCtx = () => audioCtx || (audioCtx = new (window.AudioContext || window.webkitAudioContext)());

    const applyBoost = video => {
        if (!cfg.boost || boostMap.has(video)) return;
        try {
            const ctx = getAudioCtx();
            ctx.resume?.();
            const src = ctx.createMediaElementSource(video);
            const gain = ctx.createGain();
            gain.gain.value = clamp(cfg.boostLevel, 1, cfg.maxBoost);
            src.connect(gain).connect(ctx.destination);
            boostMap.set(video, gain);
        } catch (e) { }
    };

    /* ─── KEYBOARD ─── */
    document.addEventListener('keydown', e => {
        if (!cfg.hotkeys || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        const v = getVideo();
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
                saveCfg('boostLevel', cfg.boostLevel);
                applyBoost(v);
                const g = boostMap.get(v);
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
            try {
                window.parent.postMessage({
                    type: 'fvp-iframe-state',
                    state: video ? {
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
                    }
                }, '*');
            } catch (e) { }
        };

        const getTotalVideoCount = () => {
            pruneDisconnectedChildFrames();
            return getOwnVideoCount() + [...childFrameVideoMap.values()].reduce((sum, count) => sum + count, 0);
        };

        const findChildIframeBySource = source => {
            const iframes = Array.from(document.querySelectorAll('iframe'));
            for (const iframe of iframes) {
                try {
                    if (iframe.contentWindow === source) return iframe;
                } catch (e) { }
            }
            for (let i = 0; i < window.frames.length; i++) {
                try {
                    if (window.frames[i] === source) return iframes[i] || null;
                } catch (e) { }
            }
            return null;
        };

        const reportVideos = () => {
            const count = getTotalVideoCount();
            try { window.parent.postMessage({ type: 'fvp-iframe-videos', count }, '*'); } catch (e) { }
        };

        const requestPageQualityBridge = () => {
            try {
                window.postMessage({ source: FVP_IFRAME_BRIDGE, type: 'fvp-page-get-quality' }, '*');
            } catch (e) { }
        };

        const setPageQualityBridge = item => {
            try {
                window.postMessage({ source: FVP_IFRAME_BRIDGE, type: 'fvp-page-set-quality', item }, '*');
            } catch (e) { }
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

            if (e.source === window && e.data?.source === FVP_IFRAME_BRIDGE) {
                if (e.data.type === 'fvp-page-quality-result') {
                    try {
                        window.parent.postMessage({ type: 'fvp-iframe-quality-result', detail: e.data.detail || [] }, '*');
                    } catch (err) { }
                }
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
                    requestPageQualityBridge();
                    break;
                case 'set-quality':
                    setPageQualityBridge(e.data.item);
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
    const STORAGE_KEY_LAYOUT = 'fvp-layout';
    const STORAGE_KEY_ICON = 'fvp-icon-pos';

    // ============================================
    // PERSISTENCE (localStorage)
    // ============================================
    const saveLayout = () => {
        if (!box || box.style.display === 'none') return;
        try {
            localStorage.setItem(STORAGE_KEY_LAYOUT, JSON.stringify({
                top: box.style.top, left: box.style.left,
                width: box.style.width, height: box.style.height,
                borderRadius: box.style.borderRadius
            }));
        } catch (e) { }
    };

    const loadLayout = () => {
        try {
            const d = JSON.parse(localStorage.getItem(STORAGE_KEY_LAYOUT));
            if (d && d.width && d.height) return d;
        } catch (e) { }
        return null;
    };

    const saveIconPos = () => {
        if (!icon) return;
        try {
            localStorage.setItem(STORAGE_KEY_ICON, JSON.stringify({
                top: icon.style.top, left: icon.style.left
            }));
        } catch (e) { }
    };

    const loadIconPos = () => {
        try {
            const d = JSON.parse(localStorage.getItem(STORAGE_KEY_ICON));
            if (d && d.top && d.left) return d;
        } catch (e) { }
        return null;
    };

    // ============================================
    // STATE
    // ============================================
    let box, icon, menu, curVid, origPar, ph;
    let fitIdx = 0, zoomIdx = 0, rotationAngle = 0;

    // Iframe floating state
    let floatedIframe = null, iframeOrigPar = null, iframePh = null, iframeOrigStyle = '';
    const iframeVideoMap = new Map(); // iframe element -> aggregated video count
    let iframeStatePollTimer = 0;
    const iframePlaybackState = {
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
    };

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

    const state = {
        isDrag: false, isResize: false, isIconDrag: false,
        startX: 0, startY: 0, initX: 0, initY: 0, initW: 0, initH: 0, resizeDir: '',
        idleTimer: null, rafId: null, isSeeking: false, origW: 0, origH: 0
    };

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
    const getVideos = () => Array.from(document.querySelectorAll('video, .fvp-ph')).reduce((arr, v) => {
        if (v.classList.contains('fvp-ph')) { if (curVid) arr.push(curVid); }
        else if (v !== curVid && !v.closest('#fvp-wrapper')) arr.push(v);
        return arr;
    }, []);

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
        iframePh = el('div', 'fvp-ph', '<div style="font-size:20px;opacity:.5">📺</div>');
        iframePh.style.cssText = `width:${iframe.offsetWidth || 300}px;height:${iframe.offsetHeight || 200}px`;
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
            let matched = false;
            for (const iframe of iframes) {
                try {
                    if (iframe.contentWindow === e.source) {
                        if (e.data.count > 0) iframeVideoMap.set(iframe, e.data.count);
                        else iframeVideoMap.delete(iframe);
                        scheduleVideoDetectionUI();
                        matched = true;
                        break;
                    }
                } catch (ex) { }
            }
            // Fallback: match via window.frames for cross-origin iframes
            if (!matched) {
                for (let i = 0; i < window.frames.length; i++) {
                    try {
                        if (window.frames[i] === e.source) {
                            if (iframes[i]) {
                                if (e.data.count > 0) iframeVideoMap.set(iframes[i], e.data.count);
                                else iframeVideoMap.delete(iframes[i]);
                                scheduleVideoDetectionUI();
                            }
                            break;
                        }
                    } catch (ex) { }
                }
            }
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

        ph = el('div', 'fvp-ph', '<div style="font-size:20px;opacity:.5">📺</div>');
        ph.style.cssText = `width:${v.offsetWidth || 300}px;height:${v.offsetHeight || 200}px`;
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

        const updateTimeDisplay = () => {
            const cur = curVid.currentTime || 0;
            const dur = curVid.duration || 0;
            $('fvp-time-display').textContent = `${formatTime(cur)}/${formatTime(dur)}`;
        };
        const updateLoop = () => {
            if (!curVid) return;
            if (!state.isSeeking && curVid.duration && !isNaN(curVid.duration)) {
                $('fvp-seek').value = (curVid.currentTime / curVid.duration) * 10000;
                updateTimeDisplay();
            }
            if (curVid.buffered.length > 0 && curVid.duration) {
                $('fvp-buffer').style.width = `${(curVid.buffered.end(curVid.buffered.length - 1) / curVid.duration) * 100}%`;
            }
            state.rafId = requestAnimationFrame(updateLoop);
        };
        state.rafId = requestAnimationFrame(updateLoop);

        v.onloadedmetadata = () => {
            if (v.duration && !isNaN(v.duration)) updateTimeDisplay();
        };
        if (v.readyState >= 1 && v.duration) updateTimeDisplay();

        v.onplay = v.onpause = updatePlayPauseUI;
        v.onended = () => switchVid(1);
        v.play().catch(() => { });
        updatePlayPauseUI();
    };

    // ============================================
    // MENU
    // ============================================
    const toggleMenu = () => {
        resetIdle();
        const show = menu.style.display !== 'flex';
        menu.style.display = show ? 'flex' : 'none';
        if (show) {
            const r = icon.getBoundingClientRect();
            menu.style.left = `${clamp(r.left, 10, innerWidth - 290)}px`;
            menu.style.top = innerHeight - r.bottom < 300 ? 'auto' : `${r.bottom + 10}px`;
            menu.style.bottom = innerHeight - r.bottom < 300 ? `${innerHeight - r.top + 10}px` : 'auto';
            renderMenu();
        }
    };

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
    const setupEvents = () => {
        // Icon Drag
        const startIconDrag = e => {
            e.preventDefault(); e.stopPropagation(); resetIdle();
            const c = getCoord(e), r = icon.getBoundingClientRect();
            state.isIconDrag = true;
            state.startX = c.x; state.startY = c.y;
            state.initX = r.left; state.initY = r.top;
        };
        onPointer(icon, startIconDrag);

        // Global Move/End
        const move = e => {
            if (!state.isDrag && !state.isResize && !state.isIconDrag) return;
            if (e.cancelable) e.preventDefault();
            const c = getCoord(e);
            const dx = c.x - state.startX, dy = c.y - state.startY;

            if (state.isIconDrag) {
                icon.style.left = `${clamp(state.initX + dx, 10, innerWidth - 58)}px`;
                icon.style.top = `${clamp(state.initY + dy, 10, innerHeight - 58)}px`;
                icon.style.bottom = icon.style.right = 'auto';
                resetIdle();
            } else if (state.isDrag) {
                const minVisible = 60;
                box.style.left = `${clamp(state.initX + dx, -box.offsetWidth + minVisible, innerWidth - minVisible)}px`;
                box.style.top = `${clamp(state.initY + dy, -box.offsetHeight + minVisible, innerHeight - minVisible)}px`;
            } else if (state.isResize) {
                if (state.resizeDir === 'bl') {
                    const newW = Math.max(200, state.initW - dx);
                    box.style.width = `${newW}px`;
                    box.style.left = `${state.initX + (state.initW - newW)}px`;
                    box.style.height = `${Math.max(120, state.initH + dy)}px`;
                } else {
                    box.style.width = `${Math.max(200, state.initW + dx)}px`;
                    box.style.height = `${Math.max(120, state.initH + dy)}px`;
                }
            }
        };

        const end = e => {
            const wasActive = state.isDrag || state.isResize || state.isIconDrag;
            if (wasActive && e.cancelable) e.preventDefault();
            if (state.isIconDrag) {
                if (Math.hypot(getCoord(e).x - state.startX, getCoord(e).y - state.startY) < 8) toggleMenu();
                else saveIconPos();
            }
            if (state.isDrag || state.isResize) saveLayout();
            state.isDrag = state.isResize = state.isIconDrag = false;
        };

        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', end);

        icon.addEventListener('touchmove', e => {
            if (state.isIconDrag && e.cancelable) e.preventDefault();
            move(e);
        }, { passive: false });
        icon.addEventListener('touchend', e => { end(e); }, { passive: false });

        // Player Drag
        const startDrag = e => {
            e.preventDefault(); e.stopPropagation();
            const c = getCoord(e);
            state.isDrag = true;
            state.startX = c.x; state.startY = c.y;
            state.initX = box.offsetLeft; state.initY = box.offsetTop;
        };
        onPointer($('fvp-left-drag'), startDrag);

        // Resize Handles
        box.querySelectorAll('.fvp-resize-handle').forEach(h => {
            const startResize = e => {
                e.preventDefault(); e.stopPropagation();
                const c = getCoord(e);
                state.isResize = true;
                state.resizeDir = h.className.includes('bl') ? 'bl' : 'br';
                state.startX = c.x; state.startY = c.y;
                state.initW = box.offsetWidth; state.initH = box.offsetHeight;
                state.initX = box.offsetLeft;
            };
            onPointer(h, startResize);
        });

        box.addEventListener('touchstart', e => {
            e.stopPropagation();
            if (!e.target.closest('input, button, .fvp-res-item')) e.preventDefault();
        }, { passive: false });
        box.addEventListener('touchmove', e => {
            e.preventDefault();
            e.stopPropagation();
            move(e);
        }, { capture: true, passive: false });
        box.addEventListener('touchend', e => {
            e.stopPropagation();
            end(e);
        }, { passive: false });

        // Button Handlers
        const btn = (id, fn) => $(id)?.addEventListener('click', e => { e.stopPropagation(); fn(); });
        btn('fvp-close', restore);
        btn('fvp-prev', () => switchVid(-1));
        btn('fvp-next', () => switchVid(1));
        btn('fvp-fit', () => {
            if (floatedIframe) {
                postToFloatedIframe({ command: 'cycle-fit' });
                return;
            }
            fitIdx = (fitIdx + 1) % FIT_MODES.length;
            if (curVid) curVid.style.objectFit = FIT_MODES[fitIdx];
            $('fvp-fit').textContent = FIT_ICONS[fitIdx];
        });
        btn('fvp-zoom', () => {
            if (floatedIframe) {
                postToFloatedIframe({ command: 'cycle-zoom' });
                return;
            }
            if (!curVid) return;
            zoomIdx = (zoomIdx + 1) % ZOOM_LEVELS.length;
            applyTransform();
            $('fvp-zoom').textContent = ZOOM_ICONS[zoomIdx];
        });
        btn('fvp-rotate', () => {
            if (floatedIframe) {
                postToFloatedIframe({ command: 'rotate' });
                return;
            }
            if (!curVid) return;
            rotationAngle = (rotationAngle + 90) % 360;
            applyTransform();
            adjustForRotation();
            $('fvp-rotate').style.transform = `rotate(${rotationAngle}deg)`;
        });
        btn('fvp-full', toggleFullscreen);
        btn('fvp-vol-btn', () => {
            if (floatedIframe) {
                postToFloatedIframe({ command: 'toggle-mute' });
                return;
            }
            if (curVid) { curVid.muted = !curVid.muted; updateVolUI(); }
        });
        btn('fvp-play-pause', () => {
            if (floatedIframe) {
                postToFloatedIframe({ command: 'play-pause' });
                return;
            }
            if (!curVid) return;
            curVid.paused ? curVid.play().catch(() => { }) : curVid.pause();
        });
        btn('fvp-res', () => toggleResPopup());

        $('fvp-prev')?.addEventListener('click', e => {
            if (!floatedIframe) return;
            e.stopPropagation();
            postToFloatedIframe({ command: 'prev-video' });
        });

        $('fvp-next')?.addEventListener('click', e => {
            if (!floatedIframe) return;
            e.stopPropagation();
            postToFloatedIframe({ command: 'next-video' });
        });

        // Seek Bar
        const seek = $('fvp-seek');
        const seekTo = val => {
            if (floatedIframe) {
                const duration = iframePlaybackState.duration || 0;
                if (duration > 0) postToFloatedIframe({ command: 'seek-to-ratio', ratio: val / 10000 });
                return;
            }
            if (curVid?.duration) {
                curVid.currentTime = (val / 10000) * curVid.duration;
                const cur = curVid.currentTime || 0;
                const dur = curVid.duration || 0;
                $('fvp-time-display').textContent = `${formatTime(cur)}/${formatTime(dur)}`;
            }
        };
        seek?.addEventListener('input', e => { state.isSeeking = true; seekTo(e.target.value); });
        seek?.addEventListener('touchstart', e => {
            state.isSeeking = true;
            const rect = seek.getBoundingClientRect();
            const pos = clamp((e.touches[0].clientX - rect.left) / rect.width, 0, 1);
            seek.value = pos * 10000;
            seekTo(seek.value);
        }, { passive: true });
        seek?.addEventListener('change', () => { state.isSeeking = false; });
        seek?.addEventListener('touchend', () => { state.isSeeking = false; }, { passive: true });
    };

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

    const renderResPopup = (levels) => {
        const popup = $('fvp-res-popup');
        if (!popup) return;
        popup.innerHTML = '';
        if (!levels.length) {
            const noItem = el('div', 'fvp-res-item', 'N/A');
            noItem.style.opacity = '0.5';
            popup.appendChild(noItem);
        } else {
            levels.forEach(lv => {
                const item = el('div', `fvp-res-item${lv.active ? ' active' : ''}`, lv.label);
                item.onclick = e => { e.stopPropagation(); setQuality(lv); };
                popup.appendChild(item);
            });
        }
        popup.style.display = 'flex';
    };

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
