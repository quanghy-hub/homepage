export function createFloatingRuntimeState() {
    return {
        isDrag: false,
        isResize: false,
        isIconDrag: false,
        startX: 0,
        startY: 0,
        initX: 0,
        initY: 0,
        initW: 0,
        initH: 0,
        resizeDir: '',
        idleTimer: null,
        rafId: null,
        isSeeking: false,
        origW: 0,
        origH: 0
    };
}

export function createIframePlaybackState() {
    return {
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
}
