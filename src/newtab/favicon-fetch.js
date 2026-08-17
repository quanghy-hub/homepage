/**
 * Fetches favicon bytes directly from the extension page and converts them to
 * a data: URL. This replaces the background service worker message handler so
 * the extension works without a background worker (which Chromium browsers on
 * Android cannot always register reliably).
 */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read image blob'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Tries each candidate favicon URL in order and resolves with the first
 * successful image data URL along with its source URL.
 *
 * @param {string[]} urls Candidate favicon URLs (http/https).
 * @returns {Promise<{ dataUrl: string, sourceUrl: string }>}
 */
export async function fetchFaviconDataUrl(urls) {
  for (const url of (urls || []).filter(Boolean)) {
    try {
      const res = await fetch(url, {
        cache: 'force-cache',
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dataUrl = await blobToDataUrl(await res.blob());
      if (dataUrl?.startsWith('data:image/')) {
        return { dataUrl, sourceUrl: url };
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('No favicon candidates resolved');
}
