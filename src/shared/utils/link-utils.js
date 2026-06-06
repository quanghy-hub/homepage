export function getHostname(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname;
    } catch {
        return '';
    }
}

export function getFavicon(url) {
    try {
        const parsed = new URL(url);
        return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(parsed.href)}&sz=128`;
    } catch {
        return '';
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
