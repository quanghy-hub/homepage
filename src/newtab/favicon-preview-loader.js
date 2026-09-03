import {
  FAVICON_SOURCES,
  getFaviconCandidates,
  getFaviconUrl,
  normalizeFaviconSource
} from '../shared/utils/link-utils.js';
import { fetchFaviconDataUrl } from './favicon-fetch.js';

function requestFaviconDataUrl(urls) {
  if (!urls.length) return Promise.resolve('');
  return fetchFaviconDataUrl(urls)
    .then(({ dataUrl }) => dataUrl)
    .catch(() => urls[0] || '');
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
