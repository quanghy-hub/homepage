import {
  FAVICON_SOURCES,
  getDefaultFaviconUrl,
  getFaviconCacheKey,
  getFaviconCandidates,
  getFaviconUrl,
  normalizeFaviconSource
} from '../shared/utils/link-utils.js';
import { fetchFaviconDataUrl } from './favicon-fetch.js';

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

    const pending = fetchFaviconDataUrl(urls)
      .then(({ dataUrl, sourceUrl }) => {
        getFaviconCache()[key] = {
          dataUrl,
          sourceUrl: sourceUrl || '',
          updatedAt: Date.now()
        };
        persistFaviconCache();
        updateVisibleImages(key, dataUrl, target);
      })
      .catch(() => {
        // When fetching data: URL fails (e.g. CORS/host permissions blocked in Firefox MV3),
        // try setting the direct favicon URL if not already tried, or fall back to letter.
        const directUrl = link.faviconUrl || getDefaultFaviconUrl(link.url);
        if (directUrl && (!target.img.src || target.img.src !== directUrl)) {
          getFaviconCache()[key] = {
            dataUrl: directUrl,
            sourceUrl: directUrl,
            updatedAt: Date.now()
          };
          persistFaviconCache();
          updateVisibleImages(key, directUrl, target);
        } else {
          getFaviconCache()[key] = {
            fallback: true,
            updatedAt: Date.now()
          };
          persistFaviconCache();
          showFallback(target.element, target.iconWrap, target.img, link.title);
        }
      })
      .finally(() => pendingByKey.delete(key));

    pendingByKey.set(key, pending);
  }

  function attach({ element, iconWrap, img, link }) {
    const faviconSource = normalizeFaviconSource(link.faviconSource);
    const key = getFaviconCacheKey(link.url);

    img.alt = '';
    img.loading = 'eager';
    img.decoding = 'async';
    img.onerror = () => {
      if (key) {
        getFaviconCache()[key] = {
          fallback: true,
          updatedAt: Date.now()
        };
        persistFaviconCache();
      }
      showFallback(element, iconWrap, img, link.title);
    };

    if (faviconSource === FAVICON_SOURCES.chrome) {
      img.src = getFaviconUrl(link.url, FAVICON_SOURCES.chrome);
      iconWrap.appendChild(img);
      return;
    }

    img.dataset.faviconKey = key;
    img.onload = () => {
      // Check if image is Google's 16x16 placeholder globe:
      // When a site has no favicon, Google returns a 16x16 icon even when sz=256 was requested.
      const isGoogleHost =
        typeof img.src === 'string' &&
        (img.src.includes('google.com') || img.src.includes('gstatic.com'));
      if (isGoogleHost && img.naturalWidth <= 16 && img.naturalHeight <= 16) {
        if (key) {
          getFaviconCache()[key] = {
            fallback: true,
            updatedAt: Date.now()
          };
          persistFaviconCache();
        }
        showFallback(element, iconWrap, img, link.title);
        fetchAndCache({ element, iconWrap, img, link }, true);
        return;
      }

      if (img.dataset.refreshedLowRes || !img.naturalWidth || !img.naturalHeight) return;
      if (Math.min(img.naturalWidth, img.naturalHeight) >= 48) return;
      img.dataset.refreshedLowRes = '1';
      fetchAndCache({ element, iconWrap, img, link }, true);
    };

    const entry = getCacheEntry(link.url);
    const isFresh =
      entry &&
      Date.now() - (entry.updatedAt || 0) <= FAVICON_CACHE_TTL &&
      (entry.dataUrl || entry.fallback);

    if (entry?.fallback) {
      showFallback(element, iconWrap, img, link.title);
    } else if (entry?.dataUrl) {
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
