export const $ = id => document.getElementById(id);

export const el = (tag, cls, html) => Object.assign(document.createElement(tag), {
    className: cls || '',
    innerHTML: html || ''
});

export const getCoord = e => {
    const t = e.touches?.[0] || e.changedTouches?.[0] || e;
    return { x: t.clientX, y: t.clientY };
};

export const formatTime = s => `${Math.floor(s / 60)}.${(Math.floor(s) % 60).toString().padStart(2, '0')}`;

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export const onPointer = (target, fn, passive = false) => {
    target?.addEventListener('touchstart', fn, { passive });
    target?.addEventListener('mousedown', fn);
};

export const getRect = node => node?.getBoundingClientRect?.() || {
    width: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0
};

export const hasVisibleSize = node => {
    const rect = getRect(node);
    const width = Math.max(node?.offsetWidth || 0, node?.clientWidth || 0, rect.width || 0);
    const height = Math.max(node?.offsetHeight || 0, node?.clientHeight || 0, rect.height || 0);
    return width > 0 && height > 0;
};

export const isDetectableVideo = video => !!video && video.isConnected && hasVisibleSize(video);
