import { clamp, getRect, isDetectableVideo } from './utils.js';

export function getFullscreenEl() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export function getVideo({ isInIframe }) {
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
}

export function getVideoAtPoint(x, y) {
    for (const v of document.querySelectorAll('video')) {
        if (!isDetectableVideo(v)) continue;
        if (v.closest('#fvp-wrapper')) continue;
        const r = getRect(v);
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return v;
    }
    return null;
}

export function createSeekNotice(cfg) {
    let noticeEl;
    let hideTimer;

    return function showSeekNotice(video, delta) {
        if (!video) return;
        const fs = getFullscreenEl();
        const container = (fs && (fs === video || fs.contains(video)))
            ? fs
            : (video.parentElement || document.body);

        if (!noticeEl || !container.contains(noticeEl)) {
            noticeEl?.remove();
            noticeEl = document.createElement('div');
            noticeEl.className = 'vf-notice';
            noticeEl.style.fontSize = cfg.noticeFontSize + 'px';
            if (getComputedStyle(container).position === 'static') {
                container.style.position = 'relative';
            }
            container.appendChild(noticeEl);
        }

        noticeEl.textContent = `${delta >= 0 ? '▶ +' : '◀ '}${delta}s`;
        noticeEl.classList.add('show');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => noticeEl.classList.remove('show'), 700);
    };
}

export function createAudioBoostController(cfg) {
    let audioCtx;
    const boostMap = new WeakMap();

    function getAudioCtx() {
        return audioCtx || (audioCtx = new (window.AudioContext || window.webkitAudioContext)());
    }

    function applyBoost(video) {
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
    }

    function getBoostNode(video) {
        return boostMap.get(video);
    }

    return { applyBoost, getBoostNode };
}
