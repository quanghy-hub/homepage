import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FAVICON_SOURCES,
  getDefaultFaviconUrl,
  getFaviconCandidates,
  isHttpUrl
} from '../src/shared/utils/link-utils.js';
import { loadFaviconPreview } from '../src/newtab/favicon-preview-loader.js';
import { buildExportData } from '../src/newtab/sync-api.js';
import { normalizeLinks, normalizeSettings } from '../src/newtab/storage.js';

test('builds candidate set for Google favicon source', () => {
  const googleCandidates = getFaviconCandidates('https://example.com/path');

  assert.equal(
    googleCandidates[0],
    'https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Fexample.com%2Fpath&sz=256'
  );
  assert.equal(
    googleCandidates.some((url) => url.startsWith('chrome-extension://')),
    false
  );
});

test('fills missing favicon URLs with the default 256px source', () => {
  const [link] = normalizeLinks([{ _id: 'one', url: 'https://example.com/path' }]);

  assert.equal(link.faviconUrl, getDefaultFaviconUrl(link.url));
  assert.equal(link.faviconSource, FAVICON_SOURCES.google);
  assert.match(link.faviconUrl, /[?&]sz=256$/);
});

test('keeps Google favicon URLs in the shared synchronized links payload', () => {
  const faviconUrl = getDefaultFaviconUrl('https://example.com/');
  const state = {
    groups: { list: ['A'], pinned: ['A'], selected: 'A' },
    links: [
      {
        _id: 'one',
        faviconSource: FAVICON_SOURCES.google,
        faviconUrl,
        parent: 'A',
        url: 'https://example.com/'
      }
    ],
    profileId: 'mobile',
    settings: { iconSize: 52 }
  };

  const exported = buildExportData(state, 3);

  assert.equal(exported.links[0].faviconUrl, faviconUrl);
  assert.equal(exported.links[0].faviconSource, FAVICON_SOURCES.google);
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

  assert.deepEqual(
    links.map((link) => link._id),
    ['safe']
  );
});

test('preserves a selected Chrome favicon source during normalization', () => {
  globalThis.browser = { runtime: { id: 'extension-id' } };
  const [link] = normalizeLinks([
    {
      _id: 'chrome',
      faviconSource: FAVICON_SOURCES.chrome,
      url: 'https://example.com/'
    }
  ]);

  assert.equal(link.faviconSource, FAVICON_SOURCES.chrome);
  assert.match(link.faviconUrl, /^chrome-extension:\/\/extension-id\/_favicon\//);
  delete globalThis.browser;
});

test('migrates a removed favicon source back to Google', () => {
  const [link] = normalizeLinks([
    {
      _id: 'legacy',
      faviconSource: 'removed-provider',
      faviconUrl: 'https://stale.example/logo.png',
      url: 'https://example.com/'
    }
  ]);

  assert.equal(link.faviconSource, FAVICON_SOURCES.google);
  assert.equal(link.faviconUrl, getDefaultFaviconUrl(link.url));
});

test('keeps only supported settings fields', () => {
  assert.deepEqual(
    normalizeSettings({ removedProviderCredential: 'legacy-client-id', iconSize: 52 }),
    { iconSize: 52 }
  );
});

test('loadFaviconPreview resolves Chrome source directly without messaging', async () => {
  globalThis.browser = { runtime: { id: 'extension-id' } };

  const pageUrl = 'https://example.com/';
  const result = await loadFaviconPreview(
    {
      pageUrl,
      source: FAVICON_SOURCES.chrome
    },
    {
      requestDataUrl: () => {
        throw new Error('Should not request data URL for chrome source');
      }
    }
  );

  assert.equal(
    result,
    'chrome-extension://extension-id/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2F&size=1024'
  );
  delete globalThis.browser;
});
