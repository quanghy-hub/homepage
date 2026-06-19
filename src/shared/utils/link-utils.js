export function isHttpUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

export function getDefaultFaviconUrl(url) {
    if (!isHttpUrl(url)) return '';
    try {
        const parsed = new URL(url);
        return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(parsed.href)}&sz=256`;
    } catch {
        return '';
    }
}

export function getFaviconCandidates(url) {
    if (!isHttpUrl(url)) return [];
    try {
        const parsed = new URL(url);
        const candidates = [];

        if (parsed.hostname === 'mail.google.com') {
            candidates.push('https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico');
        }

        candidates.push(getDefaultFaviconUrl(parsed.href));
        candidates.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=256`);

        if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
            candidates.push(`chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(parsed.href)}&size=1024`);
        }

        return candidates;
    } catch {
        return [];
    }
}

export function getFaviconCacheKey(url) {
    try {
        const parsed = new URL(url);
        const firstPathSegment = parsed.pathname.split('/').filter(Boolean)[0] || '';
        return firstPathSegment
            ? `${parsed.origin}/${firstPathSegment}`
            : parsed.origin;
    } catch {
        return '';
    }
}

export function autoTitle(url) {
    try {
        const parsed = new URL(url);
        const parts = parsed.hostname.replace(/^(www\.|m\.)/, '').split('.');
        const name = parts.length > 1 ? parts[parts.length - 2] : parts[0];
        return name.charAt(0).toUpperCase() + name.slice(1);
    } catch {
        return 'Link';
    }
}
