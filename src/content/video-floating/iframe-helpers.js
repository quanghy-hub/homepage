export function syncIframeVideoMapFromSource({ iframes, source, count, iframeVideoMap, scheduleVideoDetectionUI }) {
    let matched = false;

    for (const iframe of iframes) {
        try {
            if (iframe.contentWindow === source) {
                if (count > 0) iframeVideoMap.set(iframe, count);
                else iframeVideoMap.delete(iframe);
                scheduleVideoDetectionUI();
                matched = true;
                break;
            }
        } catch (ex) { }
    }

    if (!matched) {
        for (let i = 0; i < window.frames.length; i++) {
            try {
                if (window.frames[i] === source) {
                    if (iframes[i]) {
                        if (count > 0) iframeVideoMap.set(iframes[i], count);
                        else iframeVideoMap.delete(iframes[i]);
                        scheduleVideoDetectionUI();
                    }
                    break;
                }
            } catch (ex) { }
        }
    }
}
