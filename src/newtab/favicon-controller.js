import {
  FAVICON_SOURCES,
  getFaviconCacheKey,
  getFaviconCandidates,
  getFaviconUrl,
  normalizeFaviconSource
} from '../shared/utils/link-utils.js';

export const FAVICON_CACHE_TTL = 1000 * 60 * 60 * 24 * 14;

export function createFaviconController({ getFaviconCache, persistFaviconCache, queueIdleTask }) {
  const pendingByKey = new Map();

  function getCacheEntry(url) {
    const key = getFaviconCacheKey(url);
    return key ? getFaviconCache()[key] : null;
  }

  function showFallback(element, iconWrap, img, title) {
    if (img.style) img.style.display = 'none';
    const cleanTitle = (title || '').trim() || '?';
    iconWrap.textContent = [...cleanTitle][0].toUpperCase();
    element.classList.add('fallback-ready');
  }

  function updateVisibleImages(key, dataUrl, fallbackTarget) {
    const relatedImages =
      typeof document === 'undefined'
        ? []
        : document.querySelectorAll(`img[data-favicon-key="${key}"]`);

    relatedImages.forEach((node) => {
      if (!node.isConnected) return;
      node.style.display = '';
      node.src = dataUrl;
      const item = node.closest('.link-item');
      const wrap = node.closest('.icon-wrap');
      item?.classList.remove('fallback-ready');
      if (wrap) {
        wrap.textContent = '';
        wrap.appendChild(node);
      }
    });

    const { element, iconWrap, img } = fallbackTarget;
    if (img && !img.isConnected) {
      if (img.style) img.style.display = '';
      img.src = dataUrl;
      element.classList.remove?.('fallback-ready');
      iconWrap.textContent = '';
      iconWrap.appendChild(img);
    }
  }

  function fetchAndCache(target, force = false) {
    const { link } = target;
    const key = getFaviconCacheKey(link.url);
    const urls = getFaviconCandidates(link.url);
    if (!key || !urls.length || (!force && pendingByKey.has(key))) return;

    const pending = (async () => {
      try {
        const response = await browser.runtime.sendMessage({ type: 'fetch-favicon', urls });
        if (!response?.ok || !response.dataUrl) {
          return;
        }

        getFaviconCache()[key] = {
          dataUrl: response.dataUrl,
          sourceUrl: response.sourceUrl || '',
          updatedAt: Date.now()
        };
        persistFaviconCache();
        updateVisibleImages(key, response.dataUrl, target);
      } catch {
        // ignore
      } finally {
        pendingByKey.delete(key);
      }
    })();

    pendingByKey.set(key, pending);
  }

  function attach({ element, iconWrap, img, link }) {
    const faviconSource = normalizeFaviconSource(link.faviconSource);

    img.alt = '';
    img.loading = 'eager';
    img.decoding = 'async';
    img.onerror = () => showFallback(element, iconWrap, img, link.title);

    if (faviconSource === FAVICON_SOURCES.chrome) {
      img.src = getFaviconUrl(link.url, FAVICON_SOURCES.chrome);
      iconWrap.appendChild(img);
      return;
    }

    const key = getFaviconCacheKey(link.url);
    img.dataset.faviconKey = key;
    img.onload = () => {
      if (img.dataset.refreshedLowRes || !img.naturalWidth || !img.naturalHeight) return;
      if (Math.min(img.naturalWidth, img.naturalHeight) >= 48) return;
      img.dataset.refreshedLowRes = '1';
      fetchAndCache({ element, iconWrap, img, link }, true);
    };

    const entry = getCacheEntry(link.url);
    const isFresh = entry?.dataUrl && Date.now() - (entry.updatedAt || 0) <= FAVICON_CACHE_TTL;

    if (entry?.dataUrl) {
      img.src = entry.dataUrl;
      iconWrap.appendChild(img);
    } else {
      showFallback(element, iconWrap, img, link.title);
    }

    if (!isFresh) {
      queueIdleTask(() => fetchAndCache({ element, iconWrap, img, link }));
    }
  }

  return { attach };
}
