import assert from 'node:assert/strict';
import test from 'node:test';
import { blobToDataUrl, fetchFaviconDataUrl } from '../src/newtab/favicon-fetch.js';

/**
 * Installs fetch/FileReader stubs and returns a restore function.
 * readerResult may be a value or a function returning the next result.
 */
function installGlobals({ fetchImpl, readerResult }) {
  const originalFetch = globalThis.fetch;
  const originalFileReader = globalThis.FileReader;

  globalThis.fetch = fetchImpl;
  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = typeof readerResult === 'function' ? readerResult() : readerResult;
      this.onloadend?.();
    }
  };

  return () => {
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
    if (originalFileReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = originalFileReader;
  };
}

test('blobToDataUrl converts a blob through FileReader', async () => {
  const restore = installGlobals({
    fetchImpl: async () => {
      throw new Error('unused');
    },
    readerResult: 'data:image/png;base64,Zm9v'
  });
  try {
    const result = await blobToDataUrl({});
    assert.equal(result, 'data:image/png;base64,Zm9v');
  } finally {
    restore();
  }
});

test('fetchFaviconDataUrl returns the first successful image candidate', async () => {
  const restore = installGlobals({
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      blob: async () => ({ from: url })
    }),
    readerResult: 'data:image/png;base64,Zm9v'
  });
  try {
    const result = await fetchFaviconDataUrl(['https://example.com/a.png', 'https://b.png']);
    assert.equal(result.dataUrl, 'data:image/png;base64,Zm9v');
    assert.equal(result.sourceUrl, 'https://example.com/a.png');
  } finally {
    restore();
  }
});

test('skips a candidate when the fetched payload is not an image', async () => {
  const queue = ['text/html', 'data:image/png;base64,Zm9v'];
  const restore = installGlobals({
    fetchImpl: async () => ({ ok: true, status: 200, blob: async () => ({}) }),
    readerResult: () => queue.shift()
  });
  try {
    const result = await fetchFaviconDataUrl([
      'https://example.com/a.png',
      'https://example.com/b.png'
    ]);
    assert.equal(result.sourceUrl, 'https://example.com/b.png');
    assert.equal(result.dataUrl, 'data:image/png;base64,Zm9v');
  } finally {
    restore();
  }
});

test('falls back to the next candidate on HTTP errors', async () => {
  const restore = installGlobals({
    fetchImpl: async (url) =>
      url.includes('/bad')
        ? { ok: false, status: 404, blob: async () => ({}) }
        : { ok: true, status: 200, blob: async () => ({}) },
    readerResult: 'data:image/png;base64,Zm9v'
  });
  try {
    const result = await fetchFaviconDataUrl([
      'https://example.com/bad',
      'https://example.com/good'
    ]);
    assert.equal(result.sourceUrl, 'https://example.com/good');
  } finally {
    restore();
  }
});

test('rejects when every candidate fails', async () => {
  const restore = installGlobals({
    fetchImpl: async () => ({ ok: false, status: 500, blob: async () => ({}) }),
    readerResult: 'data:image/png;base64,Zm9v'
  });
  try {
    await assert.rejects(
      fetchFaviconDataUrl(['https://example.com/a.png']),
      /No favicon candidates/
    );
  } finally {
    restore();
  }
});

test('skips candidate when the fetched payload is the generic placeholder globe', async () => {
  const globePayload =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsSAAALEgHS3X78AAACiElEQVQ4EaVTzU8TURCf2tJuS7tQtlRb6UKBIkQwkRRSEzkQgyEc6lkOKgcOph78Y+CgjXjDs2i44FXY9AMTlQRUELZapVlouy3d7kKtb0Zr0MSLTvL2zb75eL838xtTvV6H/xELBptMJojeXLCXyobnyog4YhzXYvmCFi6qVSfaeRdXdrfaU1areV5KykmX06rcvzumjY/1ggkR3Jh+bNf1mr8v1D5bLuvR3qDgFbvbBJYIrE1mCIoCrKxsHuzK+Rzvsi29+6DEbTZz9unijEYI8ObBgXOzlcrx9OAlXyDYKUCzwwrDQx1wVDGg089Dt+gR3mxmhcUnaWeoxwMbm/vzDFzmDEKMMNhquRqduT1KwXiGt0vre6iSeAUHNDE0d26NBtAXY9BACQyjFusKuL2Ry+IPb/Y9ZglwuVscdHaknUChqLF/O4jn3V5dP4mhgRJgwSYm+gV0Oi3XrvYB30yvhGa7BS70eGFHPoTJyQHhMK+F0ZesRVVznvXw5Ixv7/C10moEo6OZXbWvlFAF9FVZDOqEABUMRIkMd8GnLwVWg9/RkJF9sA4oDfYQAuzzjqzwvnaRUFxn/X2ZlmGLXAE7AL52B4xHgqAUqrC1nSNuoJkQtLkdqReszz/9aRvq90NOKdOS1nch8TpL555WDp49f3uAMXhACRjD5j4ykuCtf5PP7Fm1b0DIsl/VHGezzP1KwOiZQobFF9YyjSRYQETRENSlVzI8iK9mWlzckpSSCQHVALmN9Az1euDho9Xo8vKGd2rqooA8yBcrwHgCqYR0kMkWci08t/R+W4ljDCanWTg9TJGwGNaNk3vYZ7VUdeKsYJGFNkfSzjXNrSX20s4/h6kB81/271ghG17l+rPTAAAAAElFTkSuQmCC';
  const queue = [globePayload, 'data:image/png;base64,Zm9v'];
  const restore = installGlobals({
    fetchImpl: async () => ({ ok: true, status: 200, blob: async () => ({}) }),
    readerResult: () => queue.shift()
  });
  try {
    const result = await fetchFaviconDataUrl([
      'https://example.com/globe.png',
      'https://example.com/real.png'
    ]);
    assert.equal(result.sourceUrl, 'https://example.com/real.png');
    assert.equal(result.dataUrl, 'data:image/png;base64,Zm9v');
  } finally {
    restore();
  }
});
