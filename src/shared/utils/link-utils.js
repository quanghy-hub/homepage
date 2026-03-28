export function getHostname(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname;
    } catch {
        return '';
    }
}

export function getFavicon(url) {
    const hostname = getHostname(url);
    return hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=128` : '';
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
