export function findChildIframeBySource(source) {
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
}

export function getTotalVideoCount({ pruneDisconnectedChildFrames, getOwnVideoCount, childFrameVideoMap }) {
    pruneDisconnectedChildFrames();
    return getOwnVideoCount() + [...childFrameVideoMap.values()].reduce((sum, count) => sum + count, 0);
}

export function reportVideosToParent(count) {
    try {
        window.parent.postMessage({ type: 'fvp-iframe-videos', count }, '*');
    } catch (e) { }
}

export function postIframeStateToParent(state) {
    try {
        window.parent.postMessage({ type: 'fvp-iframe-state', state }, '*');
    } catch (e) { }
}
