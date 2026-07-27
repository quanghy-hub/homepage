import {
  FAVICON_SOURCES,
  getFaviconCandidates,
  getFaviconUrl,
  normalizeFaviconSource
} from '../shared/utils/link-utils.js';

async function requestFaviconDataUrl(urls) {
  if (!urls.length) return '';
  try {
    const response = await browser.runtime.sendMessage({ type: 'fetch-favicon', urls });
    if (!response?.ok || !response.dataUrl?.startsWith('data:image/')) {
      return '';
    }
    return response.dataUrl;
  } catch {
    return '';
  }
}

export function loadFaviconPreview(
  { pageUrl, source },
  { requestDataUrl = requestFaviconDataUrl } = {}
) {
  const selectedSource = normalizeFaviconSource(source);
  if (selectedSource === FAVICON_SOURCES.chrome) {
    return Promise.resolve(getFaviconUrl(pageUrl, selectedSource));
  }
  return requestDataUrl(getFaviconCandidates(pageUrl));
}
