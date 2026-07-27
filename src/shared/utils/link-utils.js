export function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export const FAVICON_SOURCES = Object.freeze({
  google: 'google',
  chrome: 'chrome'
});

export function normalizeFaviconSource(source) {
  return source === FAVICON_SOURCES.chrome ? FAVICON_SOURCES.chrome : FAVICON_SOURCES.google;
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

export function getFaviconUrl(url, source = FAVICON_SOURCES.google) {
  if (!isHttpUrl(url)) return '';
  const selectedSource = normalizeFaviconSource(source);
  if (selectedSource === FAVICON_SOURCES.google) return getDefaultFaviconUrl(url);
  const parsed = new URL(url);

  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return '';
  return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(parsed.href)}&size=1024`;
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
    candidates.push(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=256`
    );

    return candidates;
  } catch {
    return [];
  }
}

export function getFaviconCacheKey(url) {
  try {
    const parsed = new URL(url);
    const firstPathSegment = parsed.pathname.split('/').filter(Boolean)[0] || '';
    return firstPathSegment ? `${parsed.origin}/${firstPathSegment}` : parsed.origin;
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
