import {
  FAVICON_SOURCES,
  getFaviconCandidates,
  getFaviconUrl,
  normalizeFaviconSource
} from '../shared/utils/link-utils.js';

function requestFaviconDataUrl(urls) {
  if (!urls.length) return Promise.resolve('');
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'fetch-favicon', urls }, (response) => {
        if (
          chrome.runtime.lastError ||
          !response?.ok ||
          !response.dataUrl?.startsWith('data:image/')
        ) {
          resolve('');
          return;
        }
        resolve(response.dataUrl);
      });
    } catch {
      resolve('');
    }
  });
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
