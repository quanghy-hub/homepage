import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDefaultFaviconUrl,
  getFaviconCandidates,
  isHttpUrl
} from '../src/shared/utils/link-utils.js';
import {
  createFaviconController,
  FAVICON_CACHE_TTL
} from '../src/newtab/favicon-controller.js';
import { buildExportData } from '../src/newtab/sync-api.js';
import { normalizeLinks } from '../src/newtab/storage.js';

test('uses Google S2 before the internal Chrome favicon API', () => {
  globalThis.chrome = { runtime: { id: 'extension-id' } };
  const candidates = getFaviconCandidates('https://example.com/path');

  assert.equal(
    candidates[0],
    'https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Fexample.com%2Fpath&sz=256'
  );
  assert.equal(
    candidates.at(-1),
    'chrome-extension://extension-id/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fpath&size=1024'
  );
  delete globalThis.chrome;
});

test('fills missing favicon URLs with the default 256px source', () => {
  const [link] = normalizeLinks([{ _id: 'one', url: 'https://example.com/path' }]);

  assert.equal(link.faviconUrl, getDefaultFaviconUrl(link.url));
  assert.match(link.faviconUrl, /[?&]sz=256$/);
});

test('keeps Google favicon URLs in the shared synchronized links payload', () => {
  const faviconUrl = getDefaultFaviconUrl('https://example.com/');
  const state = {
    groups: { list: ['A'], pinned: ['A'], selected: 'A' },
    links: [{ _id: 'one', faviconUrl, parent: 'A', url: 'https://example.com/' }],
    profileId: 'mobile',
    settings: { iconSize: 52 }
  };

  const exported = buildExportData(state, 3);

  assert.equal(exported.links[0].faviconUrl, faviconUrl);
  assert.equal(exported.profileId, 'mobile');
});

test('rejects invalid page URLs', () => {
  assert.deepEqual(getFaviconCandidates('not a URL'), []);
  assert.deepEqual(getFaviconCandidates('javascript:alert(1)'), []);
});

test('accepts only http and https quicklinks', () => {
  assert.equal(isHttpUrl('https://example.com'), true);
  assert.equal(isHttpUrl('http://localhost:8787/path'), true);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('chrome://settings'), false);
});

test('drops invalid synchronized links during normalization', () => {
  const links = normalizeLinks([
    { _id: 'safe', url: 'https://example.com/' },
    { _id: 'unsafe', url: 'javascript:alert(1)' },
    null
  ]);

  assert.deepEqual(links.map(link => link._id), ['safe']);
});

test('uses a fresh local favicon cache for 14 days without fetching', () => {
  const pageUrl = 'https://example.com/';
  const sourceUrl = getDefaultFaviconUrl(pageUrl);
  const cache = {
    'https://example.com': {
      dataUrl: 'data:image/png;base64,Y2FjaGVk',
      sourceUrl,
      updatedAt: Date.now()
    }
  };
  const controller = createFaviconController({
    getFaviconCache: () => cache,
    persistFaviconCache: () => { throw new Error('fresh cache must not be rewritten'); },
    queueIdleTask: () => { throw new Error('fresh cache must not fetch'); }
  });
  const img = { dataset: {} };
  const iconWrap = { appendChild() {}, textContent: '' };

  controller.attach({
    element: { classList: { add() {} } },
    iconWrap,
    img,
    link: { title: 'Example', url: pageUrl }
  });

  assert.equal(FAVICON_CACHE_TTL, 14 * 24 * 60 * 60 * 1000);
  assert.equal(img.src, cache['https://example.com'].dataUrl);
});

test('shows an uppercase letter while image sources are unavailable', () => {
  let idleTask;
  let fallbackClass = '';
  const controller = createFaviconController({
    getFaviconCache: () => ({}),
    persistFaviconCache: () => {},
    queueIdleTask: task => { idleTask = task; }
  });
  const iconWrap = { appendChild() {}, textContent: '' };

  controller.attach({
    element: { classList: { add: value => { fallbackClass = value; } } },
    iconWrap,
    img: { dataset: {}, style: {} },
    link: { title: 'Example', url: 'https://example.com/' }
  });

  assert.equal(iconWrap.textContent, 'E');
  assert.equal(fallbackClass, 'fallback-ready');
  assert.equal(typeof idleTask, 'function');
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
      sendMessage: (_message, callback) => callback({
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
    queueIdleTask: task => { idleTask = task; }
  });
  const img = { dataset: {}, isConnected: false, style: {} };
  const iconWrap = {
    appendChild: node => { appendedNode = node; },
    textContent: ''
  };

  controller.attach({
    element: {
      classList: {
        add() {},
        remove: value => { removedClass = value; }
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

test('refreshes an expired cache from Google before Chrome fallback', async () => {
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
    persistFaviconCache: () => { persisted = true; },
    queueIdleTask: task => { idleTask = task; }
  });

  controller.attach({
    element: { classList: { add() {} } },
    iconWrap: { appendChild() {}, textContent: '' },
    img: { dataset: {} },
    link: { faviconUrl: googleUrl, title: 'Example', url: pageUrl }
  });
  idleTask();
  await Promise.resolve();

  assert.equal(cache['https://example.com'].dataUrl, 'data:image/svg+xml;base64,bmV3');
  assert.equal(cache['https://example.com'].sourceUrl, googleUrl);
  assert.equal(persisted, true);
  delete globalThis.chrome;
  delete globalThis.document;
});
