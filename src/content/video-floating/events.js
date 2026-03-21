import { $, clamp, getCoord, onPointer } from './utils.js';
import { FIT_ICONS, FIT_MODES, ZOOM_ICONS, ZOOM_LEVELS } from './constants.js';

export function bindFloatingEvents(deps) {
    const {
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
        fitIdxRef,
        zoomIdxRef,
        rotationAngleRef,
        curVidRef,
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
        setSeeking,
        setCurVideoTime,
        getCurVideo,
        getFloatedIframe,
        setFitIdx,
        setZoomIdx,
        setRotationAngle
    } = deps;

    const startIconDrag = e => {
        e.preventDefault();
        e.stopPropagation();
        resetIdle();
        const c = getCoord(e);
        const r = icon.getBoundingClientRect();
        state.isIconDrag = true;
        state.startX = c.x;
        state.startY = c.y;
        state.initX = r.left;
        state.initY = r.top;
    };
    onPointer(icon, startIconDrag);

    const move = e => {
        if (!state.isDrag && !state.isResize && !state.isIconDrag) return;
        if (e.cancelable) e.preventDefault();
        const c = getCoord(e);
        const dx = c.x - state.startX;
        const dy = c.y - state.startY;

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
            else saveIconPos(icon);
        }
        if (state.isDrag || state.isResize) saveLayout(box);
        state.isDrag = state.isResize = state.isIconDrag = false;
    };

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);

    icon.addEventListener('touchmove', e => {
        if (state.isIconDrag && e.cancelable) e.preventDefault();
        move(e);
    }, { passive: false });
    icon.addEventListener('touchend', e => { end(e); }, { passive: false });

    const startDrag = e => {
        e.preventDefault();
        e.stopPropagation();
        const c = getCoord(e);
        state.isDrag = true;
        state.startX = c.x;
        state.startY = c.y;
        state.initX = box.offsetLeft;
        state.initY = box.offsetTop;
    };
    onPointer($('fvp-left-drag'), startDrag);

    box.querySelectorAll('.fvp-resize-handle').forEach(h => {
        const startResize = e => {
            e.preventDefault();
            e.stopPropagation();
            const c = getCoord(e);
            state.isResize = true;
            state.resizeDir = h.className.includes('bl') ? 'bl' : 'br';
            state.startX = c.x;
            state.startY = c.y;
            state.initW = box.offsetWidth;
            state.initH = box.offsetHeight;
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

    const btn = (id, fn) => $(id)?.addEventListener('click', e => { e.stopPropagation(); fn(); });
    btn('fvp-close', restore);
    btn('fvp-prev', () => switchVid(-1));
    btn('fvp-next', () => switchVid(1));
    btn('fvp-fit', () => {
        if (getFloatedIframe()) {
            postToFloatedIframe({ command: 'cycle-fit' });
            return;
        }
        const nextFitIdx = (fitIdxRef() + 1) % FIT_MODES.length;
        setFitIdx(nextFitIdx);
        const curVid = getCurVideo();
        if (curVid) curVid.style.objectFit = FIT_MODES[nextFitIdx];
        $('fvp-fit').textContent = FIT_ICONS[nextFitIdx];
    });
    btn('fvp-zoom', () => {
        if (getFloatedIframe()) {
            postToFloatedIframe({ command: 'cycle-zoom' });
            return;
        }
        const curVid = getCurVideo();
        if (!curVid) return;
        const nextZoomIdx = (zoomIdxRef() + 1) % ZOOM_LEVELS.length;
        setZoomIdx(nextZoomIdx);
        applyTransform();
        $('fvp-zoom').textContent = ZOOM_ICONS[nextZoomIdx];
    });
    btn('fvp-rotate', () => {
        if (getFloatedIframe()) {
            postToFloatedIframe({ command: 'rotate' });
            return;
        }
        if (!getCurVideo()) return;
        const nextRotation = (rotationAngleRef() + 90) % 360;
        setRotationAngle(nextRotation);
        applyTransform();
        adjustForRotation();
        $('fvp-rotate').style.transform = `rotate(${nextRotation}deg)`;
    });
    btn('fvp-full', toggleFullscreen);
    btn('fvp-vol-btn', () => {
        if (getFloatedIframe()) {
            postToFloatedIframe({ command: 'toggle-mute' });
            return;
        }
        const curVid = getCurVideo();
        if (curVid) { curVid.muted = !curVid.muted; updateVolUI(); }
    });
    btn('fvp-play-pause', () => {
        if (getFloatedIframe()) {
            postToFloatedIframe({ command: 'play-pause' });
            return;
        }
        const curVid = getCurVideo();
        if (!curVid) return;
        curVid.paused ? curVid.play().catch(() => { }) : curVid.pause();
    });
    btn('fvp-res', () => toggleResPopup());

    $('fvp-prev')?.addEventListener('click', e => {
        if (!getFloatedIframe()) return;
        e.stopPropagation();
        postToFloatedIframe({ command: 'prev-video' });
    });

    $('fvp-next')?.addEventListener('click', e => {
        if (!getFloatedIframe()) return;
        e.stopPropagation();
        postToFloatedIframe({ command: 'next-video' });
    });

    const seek = $('fvp-seek');
    const seekTo = val => {
        if (getFloatedIframe()) {
            const duration = iframePlaybackState.duration || 0;
            if (duration > 0) postToFloatedIframe({ command: 'seek-to-ratio', ratio: val / 10000 });
            return;
        }
        const curVid = getCurVideo();
        if (curVid?.duration) {
            curVid.currentTime = (val / 10000) * curVid.duration;
            const cur = curVid.currentTime || 0;
            const dur = curVid.duration || 0;
            $('fvp-time-display').textContent = `${formatTime(cur)}/${formatTime(dur)}`;
        }
    };

    seek?.addEventListener('input', e => {
        setSeeking(true);
        seekTo(e.target.value);
    });
    seek?.addEventListener('touchstart', e => {
        setSeeking(true);
        const rect = seek.getBoundingClientRect();
        const pos = clamp((e.touches[0].clientX - rect.left) / rect.width, 0, 1);
        seek.value = pos * 10000;
        seekTo(seek.value);
    }, { passive: true });
    seek?.addEventListener('change', () => { setSeeking(false); });
    seek?.addEventListener('touchend', () => { setSeeking(false); }, { passive: true });
}
