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
