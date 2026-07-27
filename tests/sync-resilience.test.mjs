import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getBackupEndpoint,
  getStateEndpoint,
  mergeLocalAddsIntoRemote,
  normalizeWorkerUrl
} from '../src/newtab/sync-api.js';
import { normalizeLinks, normalizeProfile, normalizeSettings } from '../src/newtab/storage.js';
import { createSyncController } from '../src/newtab/sync-controller.js';

test('normalizeWorkerUrl handles various edge cases correctly', () => {
  assert.equal(normalizeWorkerUrl(null), '');
  assert.equal(normalizeWorkerUrl(undefined), '');
  assert.equal(normalizeWorkerUrl('   '), '');
  assert.equal(normalizeWorkerUrl('my-worker.workers.dev///'), 'https://my-worker.workers.dev');
  assert.equal(normalizeWorkerUrl('  http://localhost:8787/  '), 'http://localhost:8787');
  assert.equal(
    normalizeWorkerUrl('https://my-worker.workers.dev'),
    'https://my-worker.workers.dev'
  );
});

test('getStateEndpoint and getBackupEndpoint format valid URLs', () => {
  assert.equal(getStateEndpoint('worker.dev'), 'https://worker.dev/sync/homepage/state');
  assert.equal(getStateEndpoint(''), '');
  assert.equal(getBackupEndpoint('worker.dev', 'a'), 'https://worker.dev/sync/homepage/backup/a');
  assert.equal(getBackupEndpoint('worker.dev', 'b'), 'https://worker.dev/sync/homepage/backup/b');
  assert.equal(getBackupEndpoint('', 'a'), '');
});

test('mergeLocalAddsIntoRemote handles null/undefined and merges non-duplicate links', () => {
  // Test with null remote state
  const mergedNullRemote = mergeLocalAddsIntoRemote(null, {
    links: [{ _id: 'l1', parent: 'G1', url: 'https://a.com' }],
    groups: { list: ['G1'] }
  });
  assert.equal(mergedNullRemote.links.length, 1);
  assert.equal(mergedNullRemote.links[0]._id, 'l1');
  assert.deepEqual(mergedNullRemote.groups.list, ['G1']);

  // Test merging remote and local without duplicating
  const remote = {
    links: [{ _id: 'l1', parent: 'G1', url: 'https://a.com' }],
    groups: { list: ['G1'] }
  };
  const local = {
    links: [
      { _id: 'l1', parent: 'G1', url: 'https://a.com' },
      { _id: 'l2', parent: 'G2', url: 'https://b.com' }
    ],
    groups: { list: ['G1'] }
  };
  const result = mergeLocalAddsIntoRemote(remote, local);

  assert.equal(result.links.length, 2);
  assert.deepEqual(
    result.links.map((l) => l._id),
    ['l1', 'l2']
  );
  // G2 should be automatically added to groups list because l2 belongs to G2
  assert.ok(result.groups.list.includes('G2'));
});

test('normalizeSettings sanitizes invalid or missing icon sizes', () => {
  assert.deepEqual(normalizeSettings(null), { iconSize: 56 });
  assert.deepEqual(normalizeSettings({ iconSize: 'invalid' }), { iconSize: 56 });
  assert.deepEqual(normalizeSettings({ iconSize: NaN }), { iconSize: 56 });
  assert.deepEqual(normalizeSettings({ iconSize: 48 }), { iconSize: 48 });
});

test('normalizeLinks filters out invalid schemes like javascript: or chrome:', () => {
  const input = [
    { _id: '1', url: 'https://example.com' },
    { _id: '2', url: 'javascript:alert(1)' },
    { _id: '3', url: 'chrome://settings' },
    { _id: '4', url: 'file:///etc/passwd' },
    null,
    undefined
  ];
  const normalized = normalizeLinks(input);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]._id, '1');
});

test('normalizeProfile ensures fallback to valid default pinned and selected groups', () => {
  const DEFAULT_GROUPS = {
    list: ['Mạng xã hội', 'Công cụ'],
    pinned: ['Mạng xã hội'],
    selected: 'Mạng xã hội'
  };
  const result = normalizeProfile(
    { pinned: ['NonExistent'], selected: 'InvalidGroup', settings: { iconSize: 'bad' } },
    DEFAULT_GROUPS
  );

  assert.deepEqual(result.pinned, ['Mạng xã hội']);
  assert.equal(result.selected, 'Công cụ');
  assert.equal(result.settings.iconSize, 56);
});

test('bootstrapCloud handles network failure cleanly without throwing', async () => {
  globalThis.chrome = {
    storage: {
      local: {
        set: () => {}
      }
    }
  };

  let statusMsg = '';
  let statusType = '';
  const dom = {
    syncWorkerUrlInput: { value: 'https://worker.dev' },
    syncApiCodeInput: { value: 'secret' },
    syncStatus: {
      get textContent() {
        return statusMsg;
      },
      set textContent(val) {
        statusMsg = val;
      },
      get className() {
        return statusType;
      },
      set className(val) {
        statusType = val;
      }
    }
  };

  // Mock global fetch to throw network error
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  const controller = createSyncController({
    applyImportedState: () => {},
    dom,
    getRevision: () => 0,
    getState: () => ({}),
    persistCurrentProfile: () => {},
    refreshSettingsControls: () => {},
    render: () => {},
    saveData: () => {},
    setRevision: () => {},
    switchProfile: () => {}
  });

  const result = await controller.bootstrapCloud({ force: true });
  assert.equal(result, false);
  assert.ok(statusMsg.includes('Cloud check failed'));

  globalThis.fetch = originalFetch;
  delete globalThis.chrome;
});
