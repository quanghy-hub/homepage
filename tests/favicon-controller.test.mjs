import assert from 'node:assert/strict';
import test from 'node:test';

import { createFaviconController, FAVICON_CACHE_TTL } from '../src/newtab/favicon-controller.js';
import { FAVICON_SOURCES, getDefaultFaviconUrl } from '../src/shared/utils/link-utils.js';

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

test('uses a fresh local favicon cache for 14 days without fetching', () => {
  const pageUrl = 'https://example.com/';
  const cache = {
    'https://example.com': {
      dataUrl: 'data:image/png;base64,Y2FjaGVk',
      sourceUrl: getDefaultFaviconUrl(pageUrl),
      updatedAt: Date.now()
    }
  };
  const controller = createFaviconController({
    getFaviconCache: () => cache,
    persistFaviconCache: () => {
      throw new Error('fresh cache must not be rewritten');
    },
    queueIdleTask: () => {
      throw new Error('fresh cache must not fetch');
    }
  });
  const img = { dataset: {} };

  controller.attach({
    element: { classList: { add() {} } },
    iconWrap: { appendChild() {}, textContent: '' },
    img,
    link: { title: 'Example', url: pageUrl }
  });

  assert.equal(FAVICON_CACHE_TTL, 14 * 24 * 60 * 60 * 1000);
  assert.equal(img.src, cache['https://example.com'].dataUrl);
});

test('shows a useful letter while image sources are unavailable', () => {
  const testCases = [
    { title: '  Google', expected: 'G' },
    { title: '🚀 Rocket', expected: '🚀' },
    { title: '', expected: '?' },
    { title: null, expected: '?' }
  ];

  testCases.forEach(({ title, expected }) => {
    let idleTask;
    let fallbackClass = '';
    const controller = createFaviconController({
      getFaviconCache: () => ({}),
      persistFaviconCache: () => {},
      queueIdleTask: (task) => {
        idleTask = task;
      }
    });
    const iconWrap = { appendChild() {}, textContent: '' };

    controller.attach({
      element: {
        classList: {
          add: (value) => {
            fallbackClass = value;
          }
        }
      },
      iconWrap,
      img: { dataset: {}, style: {} },
      link: { title, url: 'https://example.com/' }
    });

    assert.equal(iconWrap.textContent, expected);
    assert.equal(fallbackClass, 'fallback-ready');
    assert.equal(typeof idleTask, 'function');
  });
});

test('replaces the letter fallback immediately after a successful fetch', async () => {
  let idleTask;
  let appendedNode = null;
  let removedClass = '';
  const cache = {};
  globalThis.fetch = async () => ({ ok: true, status: 200, blob: async () => ({}) });
  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = 'data:image/png;base64,aWNvbg==';
      this.onloadend?.();
    }
  };
  globalThis.document = { querySelectorAll: () => [] };
  const controller = createFaviconController({
    getFaviconCache: () => cache,
    persistFaviconCache: () => {},
    queueIdleTask: (task) => {
      idleTask = task;
    }
  });
  const img = { dataset: {}, isConnected: false, style: {} };
  const iconWrap = {
    appendChild: (node) => {
      appendedNode = node;
    },
    textContent: ''
  };

  controller.attach({
    element: {
      classList: {
        add() {},
        remove: (value) => {
          removedClass = value;
        }
      }
    },
    iconWrap,
    img,
    link: { title: 'Example', url: 'https://example.com/' }
  });
  idleTask();
  await flush();

  assert.equal(img.src, 'data:image/png;base64,aWNvbg==');
  assert.equal(appendedNode, img);
  assert.equal(removedClass, 'fallback-ready');
  delete globalThis.fetch;
  delete globalThis.FileReader;
  delete globalThis.document;
});

test('refreshes an expired Google cache with Google candidates', async () => {
  const pageUrl = 'https://example.com/';
  const googleUrl = getDefaultFaviconUrl(pageUrl);
  const cache = {
    'https://example.com': {
      dataUrl: 'data:image/png;base64,b2xk',
      sourceUrl: googleUrl,
      updatedAt: Date.now() - FAVICON_CACHE_TTL - 1
    }
  };
  let idleTask;
  let persisted = false;
  const fetchedUrls = [];
  globalThis.fetch = async (url) => {
    fetchedUrls.push(url);
    return { ok: true, status: 200, blob: async () => ({}) };
  };
  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = 'data:image/svg+xml;base64,bmV3';
      this.onloadend?.();
    }
  };
  globalThis.document = { querySelectorAll: () => [] };
  const controller = createFaviconController({
    getFaviconCache: () => cache,
    persistFaviconCache: () => {
      persisted = true;
    },
    queueIdleTask: (task) => {
      idleTask = task;
    }
  });

  controller.attach({
    element: { classList: { add() {} } },
    iconWrap: { appendChild() {}, textContent: '' },
    img: { dataset: {} },
    link: { title: 'Example', url: pageUrl }
  });
  idleTask();
  await flush();

  assert.equal(cache['https://example.com'].dataUrl, 'data:image/svg+xml;base64,bmV3');
  assert.equal(cache['https://example.com'].sourceUrl, googleUrl);
  assert.equal(persisted, true);
  assert.ok(fetchedUrls.length > 0);
  assert.equal(fetchedUrls[0], googleUrl);
  delete globalThis.fetch;
  delete globalThis.FileReader;
  delete globalThis.document;
});

test('handles Chrome source directly without fetching or caching', () => {
  globalThis.chrome = { runtime: { id: 'extension-id' } };
  let idleTaskScheduled = false;
  const controller = createFaviconController({
    getFaviconCache: () => {
      throw new Error('Chrome source must not check cache');
    },
    persistFaviconCache: () => {
      throw new Error('Chrome source must not persist cache');
    },
    queueIdleTask: () => {
      idleTaskScheduled = true;
    }
  });
  const img = { dataset: {} };
  let appendedImg = null;

  controller.attach({
    element: { classList: { add() {} } },
    iconWrap: {
      appendChild: (node) => {
        appendedImg = node;
      },
      textContent: ''
    },
    img,
    link: {
      faviconSource: FAVICON_SOURCES.chrome,
      title: 'Example',
      url: 'https://example.com/'
    }
  });

  assert.equal(
    img.src,
    'chrome-extension://extension-id/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2F&size=1024'
  );
  assert.equal(appendedImg, img);
  assert.equal(idleTaskScheduled, false);
  delete globalThis.chrome;
});

test('falls back to direct favicon URL when fetchFaviconDataUrl fails (e.g. CORS in Firefox)', async () => {
  let idleTask;
  let appendedNode = null;
  let removedClass = '';
  const cache = {};
  // Simulate fetch failure (e.g. CORS or network error)
  globalThis.fetch = async () => ({ ok: false, status: 0 });
  globalThis.document = { querySelectorAll: () => [] };

  let persisted = false;
  const controller = createFaviconController({
    getFaviconCache: () => cache,
    persistFaviconCache: () => {
      persisted = true;
    },
    queueIdleTask: (task) => {
      idleTask = task;
    }
  });

  const pageUrl = 'https://example.com/';
  const expectedDirectUrl = getDefaultFaviconUrl(pageUrl);
  const element = {
    classList: {
      add: () => {},
      remove: (cls) => {
        removedClass = cls;
      }
    }
  };
  const iconWrap = {
    appendChild: (node) => {
      appendedNode = node;
    },
    textContent: 'E'
  };
  const img = {
    dataset: {},
    isConnected: false,
    style: {}
  };

  controller.attach({
    element,
    iconWrap,
    img,
    link: { title: 'Example', url: pageUrl }
  });

  idleTask();
  await flush();

  assert.equal(img.src, expectedDirectUrl);
  assert.equal(appendedNode, img);
  assert.equal(removedClass, 'fallback-ready');
  assert.equal(iconWrap.textContent, '');
  assert.equal(cache['https://example.com'].dataUrl, expectedDirectUrl);
  assert.equal(persisted, true);

  delete globalThis.fetch;
  delete globalThis.document;
});

test('detects Google 16x16 placeholder globe and switches to letter fallback', () => {
  let addedClass = '';
  const cache = {};
  let persisted = false;

  const controller = createFaviconController({
    getFaviconCache: () => cache,
    persistFaviconCache: () => {
      persisted = true;
    },
    queueIdleTask: () => {}
  });

  const pageUrl = 'https://best.local/';
  const element = {
    classList: {
      add: (cls) => {
        addedClass = cls;
      }
    }
  };
  const iconWrap = {
    appendChild: () => {},
    textContent: ''
  };
  const img = {
    dataset: {},
    src: 'https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Fbest.local&sz=256',
    naturalWidth: 16,
    naturalHeight: 16,
    style: {}
  };

  controller.attach({
    element,
    iconWrap,
    img,
    link: { title: 'Best Local', url: pageUrl }
  });

  // Trigger onload with the 16x16 Google globe
  img.onload();

  assert.equal(iconWrap.textContent, 'B');
  assert.equal(addedClass, 'fallback-ready');
  assert.equal(cache['https://best.local'].fallback, true);
  assert.equal(cache['https://best.local'].dataUrl, undefined);
  assert.equal(persisted, true);
});
