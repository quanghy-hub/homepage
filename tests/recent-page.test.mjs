import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRecentPage } from '../src/newtab/recent-page.js';

test('returns a fresh stored recent page without querying tabs', async () => {
  const stored = { url: 'https://example.com/', title: 'Example', updatedAt: Date.now() };
  const result = await resolveRecentPage({
    getStorage: async () => ({ recentPage: stored }),
    queryTabs: async () => {
      throw new Error('should not query tabs');
    }
  });
  assert.equal(result, stored);
});

test('ignores a stale stored page and falls back to the most recently accessed tab', async () => {
  const tabs = [
    { id: 1, url: 'https://example.com/', title: 'Active Tab', lastAccessed: 100 },
    {
      id: 2,
      url: 'chrome-extension://id/src/newtab/index.html',
      title: 'Homepage',
      lastAccessed: 400
    },
    { id: 3, url: 'https://newer.com/', title: 'Newer', lastAccessed: 300 }
  ];
  const result = await resolveRecentPage({
    getStorage: async () => ({
      recentPage: {
        url: 'https://stale.com/',
        title: 'Stale',
        updatedAt: Date.now() - 10 * 60 * 1000
      }
    }),
    queryTabs: async (info) => (info.active ? [tabs[0]] : tabs)
  });
  assert.deepEqual(result, { url: 'https://newer.com/', title: 'Newer' });
});

test('excludes non-http tabs such as chrome:// and the new tab page itself', async () => {
  const tabs = [
    { id: 1, url: 'chrome://newtab/', title: 'New Tab', lastAccessed: 500 },
    { id: 2, url: 'https://only-valid.com/', title: 'Valid', lastAccessed: 100 }
  ];
  const result = await resolveRecentPage({
    getStorage: async () => ({ recentPage: null }),
    queryTabs: async (info) => (info.active ? [tabs[0]] : tabs)
  });
  assert.deepEqual(result, { url: 'https://only-valid.com/', title: 'Valid' });
});

test('returns null when no stored page and no usable tab exists', async () => {
  const result = await resolveRecentPage({
    getStorage: async () => ({ recentPage: null }),
    queryTabs: async () => []
  });
  assert.equal(result, null);
});

test('returns null when chrome APIs are unavailable (no background worker)', async () => {
  const result = await resolveRecentPage({
    getStorage: async () => {
      throw new Error('chrome.storage unavailable');
    }
  });
  assert.equal(result, null);
});
