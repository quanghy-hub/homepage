import assert from 'node:assert/strict';
import test from 'node:test';

import { createFaviconController, FAVICON_CACHE_TTL } from '../src/newtab/favicon-controller.js';
import {
  FAVICON_SOURCES,
  getDefaultFaviconUrl,
  getFaviconCandidates
} from '../src/shared/utils/link-utils.js';

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
  globalThis.chrome = {
    runtime: {
      id: 'extension-id',
      lastError: null,
      sendMessage: (_message, callback) =>
        callback({
          dataUrl: 'data:image/png;base64,aWNvbg==',
          ok: true,
          sourceUrl: getDefaultFaviconUrl('https://example.com/')
        })
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
  await Promise.resolve();

  assert.equal(img.src, 'data:image/png;base64,aWNvbg==');
  assert.equal(appendedNode, img);
  assert.equal(removedClass, 'fallback-ready');
  delete globalThis.chrome;
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
  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage: (message, callback) => {
        assert.deepEqual(message, {
          type: 'fetch-favicon',
          urls: getFaviconCandidates(pageUrl)
        });
        callback({
          dataUrl: 'data:image/svg+xml;base64,bmV3',
          ok: true,
          sourceUrl: googleUrl
        });
      }
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
  await Promise.resolve();

  assert.equal(cache['https://example.com'].dataUrl, 'data:image/svg+xml;base64,bmV3');
  assert.equal(cache['https://example.com'].sourceUrl, googleUrl);
  assert.equal(persisted, true);
  delete globalThis.chrome;
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
