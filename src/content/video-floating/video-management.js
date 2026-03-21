import { el, formatTime } from './utils.js';

export function getManagedVideos(curVid) {
    return Array.from(document.querySelectorAll('video, .fvp-ph')).reduce((arr, node) => {
        if (node.classList.contains('fvp-ph')) {
            if (curVid) arr.push(curVid);
        } else if (node !== curVid && !node.closest('#fvp-wrapper')) {
            arr.push(node);
        }
        return arr;
    }, []);
}

export function createPlaceholder(target) {
    const placeholder = el('div', 'fvp-ph', '<div style="font-size:20px;opacity:.5">📺</div>');
    placeholder.style.cssText = `width:${target.offsetWidth || 300}px;height:${target.offsetHeight || 200}px`;
    return placeholder;
}

export function bindFloatingVideoLoop({ video, seekEl, timeDisplayEl, bufferEl, state }) {
    const updateTimeDisplay = () => {
        const cur = video.currentTime || 0;
        const dur = video.duration || 0;
        timeDisplayEl.textContent = `${formatTime(cur)}/${formatTime(dur)}`;
    };

    const updateLoop = () => {
        if (!video.isConnected) return;
        if (!state.isSeeking && video.duration && !isNaN(video.duration)) {
            seekEl.value = (video.currentTime / video.duration) * 10000;
            updateTimeDisplay();
        }
        if (video.buffered.length > 0 && video.duration) {
            bufferEl.style.width = `${(video.buffered.end(video.buffered.length - 1) / video.duration) * 100}%`;
        }
        state.rafId = requestAnimationFrame(updateLoop);
    };

    state.rafId = requestAnimationFrame(updateLoop);

    video.onloadedmetadata = () => {
        if (video.duration && !isNaN(video.duration)) updateTimeDisplay();
    };

    if (video.readyState >= 1 && video.duration) updateTimeDisplay();
}
