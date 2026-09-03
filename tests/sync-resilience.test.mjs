import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getBackupEndpoint,
  getStateEndpoint,
  mergeLocalAddsIntoRemote,
  mergeDeletedMaps,
  normalizeWorkerUrl
} from '../src/newtab/sync-api.js';
import {
  normalizeDeletedMap,
  normalizeLinks,
  normalizeProfile,
  normalizeSettings
} from '../src/newtab/storage.js';
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

test('keeps the local version of a shared link when it was edited more recently', () => {
  const remote = {
    links: [{ _id: 'l1', url: 'https://a.com', title: 'Remote title', updatedAt: 1000 }],
    groups: { list: ['G1'] }
  };
  const local = {
    links: [{ _id: 'l1', url: 'https://a.com', title: 'Local title', updatedAt: 2000 }],
    groups: { list: ['G1'] }
  };

  const result = mergeLocalAddsIntoRemote(remote, local);

  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].title, 'Local title');
});

test('keeps the remote version of a shared link when it is newer', () => {
  const remote = {
    links: [{ _id: 'l1', url: 'https://a.com', title: 'Remote title', updatedAt: 2000 }],
    groups: { list: ['G1'] }
  };
  const local = {
    links: [{ _id: 'l1', url: 'https://a.com', title: 'Local title', updatedAt: 1000 }],
    groups: { list: ['G1'] }
  };

  const result = mergeLocalAddsIntoRemote(remote, local);

  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].title, 'Remote title');
});

test('drops local-only links that were deleted on the remote side (tombstone)', () => {
  const remote = {
    links: [],
    groups: { list: [] },
    deletedMap: { l1: 3000 }
  };
  const local = {
    links: [{ _id: 'l1', url: 'https://a.com', updatedAt: 1000 }],
    groups: { list: ['G1'] }
  };

  const result = mergeLocalAddsIntoRemote(remote, local);

  assert.deepEqual(result.links, []);
  assert.deepEqual(result.deletedMap, { l1: 3000 });
});

test('keeps a link edited after a remote deletion (edit-after-delete wins)', () => {
  const remote = {
    links: [{ _id: 'l9', url: 'https://z.com', updatedAt: 5000 }],
    groups: { list: ['G2'] },
    deletedMap: { l1: 3000 }
  };
  const local = {
    links: [{ _id: 'l1', url: 'https://a.com', title: 'Edited later', updatedAt: 4000 }],
    groups: { list: ['G1'] }
  };

  const result = mergeLocalAddsIntoRemote(remote, local);

  assert.equal(result.links.length, 2);
  assert.equal(result.links.find((l) => l._id === 'l1').title, 'Edited later');
});

test('merges deletedMap tombstones from both sides keeping the newest timestamp', () => {
  const remote = { links: [], groups: { list: [] }, deletedMap: { l1: 100, l2: 100 } };
  const local = { links: [], groups: { list: [] }, deletedMap: { l2: 200 } };

  const result = mergeLocalAddsIntoRemote(remote, local);

  assert.deepEqual(result.deletedMap, { l1: 100, l2: 200 });
});

test('mergeDeletedMaps unions maps and ignores invalid entries', () => {
  assert.deepEqual(mergeDeletedMaps({ a: 1 }, { a: 3, b: 2 }, { b: 'x' }), { a: 3, b: 2 });
  assert.deepEqual(mergeDeletedMaps(null, undefined), {});
});

test('normalizeDeletedMap keeps only recent integer tombstones', () => {
  const now = 1_700_000_000_000;
  const result = normalizeDeletedMap(
    { fresh: now - 1000, stale: now - 31 * 24 * 3600 * 1000, bad: 'x', nul: null },
    now
  );

  assert.deepEqual(result, { fresh: now - 1000 });
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

/* ========== UN-PUSHED EDIT PROTECTION (syncPending) ========== */

function mockChromeStorage(initial = {}) {
  const backing = { ...initial };
  const setCalls = [];
  globalThis.chrome = {
    storage: {
      local: {
        get(keys, cb) {
          const list = Array.isArray(keys) ? keys : [keys];
          const result = {};
          list.forEach((key) => {
            if (key in backing) result[key] = backing[key];
          });
          setTimeout(() => cb(result), 0);
        },
        set(obj) {
          setCalls.push(obj);
          Object.assign(backing, obj);
        }
      }
    }
  };
  return { backing, setCalls };
}

function mockSyncFetch(remoteState, options = {}) {
  const calls = [];
  const jsonResponse = (obj) => ({ ok: true, status: 200, json: async () => obj });
  globalThis.fetch = async (_url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ method, body: opts.body ? JSON.parse(opts.body) : null });
    if (method === 'GET') return jsonResponse(remoteState);
    if (options.interceptPut) return options.interceptPut(calls);
    return jsonResponse({ ...remoteState, revision: remoteState.revision + 1 });
  };
  return calls;
}

const LOCAL_STATE = {
  links: [{ _id: 'local-1', parent: 'G1', url: 'https://local.app' }],
  groups: { list: ['G1'], pinned: [], selected: '' },
  settings: {},
  profileId: 'macbook',
  deletedMap: {},
  deletedGroupsMap: {}
};

const REMOTE_STATE = {
  revision: 7,
  links: [{ _id: 'remote-1', parent: 'G1', url: 'https://remote.app' }],
  groups: { list: ['G1'], pinned: [], selected: '' },
  profiles: {},
  deletedMap: {},
  deletedGroupsMap: {}
};

function buildController(dom, hooks = {}) {
  let revision = hooks.initialRevision ?? null;
  return createSyncController({
    applyImportedState: hooks.applyImportedState || (() => {}),
    dom,
    getRevision: () => revision,
    getState: () => LOCAL_STATE,
    persistCurrentProfile: () => {},
    refreshSettingsControls: () => {},
    render: () => {},
    saveData: () => {},
    setRevision: (next) => {
      revision = next;
      hooks.onSetRevision?.(next);
    },
    switchProfile: () => {}
  });
}

test('bootstrapCloud flushes un-pushed local edits to the cloud before pulling', async () => {
  const { setCalls } = mockChromeStorage({ syncPending: true });
  const calls = mockSyncFetch(REMOTE_STATE);

  const appliedSnapshots = [];
  const controller = buildController(
    {
      syncWorkerUrlInput: { value: 'https://worker.dev' },
      syncApiCodeInput: { value: 'secret' },
      syncStatus: { textContent: '', className: '' }
    },
    { applyImportedState: (imported) => appliedSnapshots.push(imported) }
  );

  assert.equal(await controller.loadSavedPending(), true);
  assert.equal(await controller.bootstrapCloud({ force: true }), true);

  // The flush must PUT a merge of local + remote links before any restore.
  const putCall = calls.find((call) => call.method === 'PUT');
  assert.ok(putCall, 'expected a push during bootstrap');
  const pushedIds = putCall.body.links.map((link) => link._id);
  assert.ok(pushedIds.includes('local-1'), 'local edit must reach the cloud');
  assert.ok(pushedIds.includes('remote-1'), 'remote links must be preserved');

  // Confirmed push clears the persisted pending flag.
  const pendingWrites = setCalls.filter((entry) => 'syncPending' in entry);
  assert.equal(pendingWrites.at(-1).syncPending, false);

  // After the flush the remote snapshot is not older than ours — no clobber.
  assert.equal(appliedSnapshots.length, 1);

  delete globalThis.fetch;
  delete globalThis.chrome;
});

test('bootstrapCloud keeps the newer local revision when the cloud is behind', async () => {
  mockChromeStorage();
  mockSyncFetch({ ...REMOTE_STATE, revision: 2 });

  const revisionsSet = [];
  const controller = buildController(
    {
      syncWorkerUrlInput: { value: 'https://worker.dev' },
      syncApiCodeInput: { value: 'secret' },
      syncStatus: { textContent: '', className: '' }
    },
    { initialRevision: 10, onSetRevision: (revision) => revisionsSet.push(revision) }
  );

  assert.equal(await controller.bootstrapCloud({ force: true }), true);
  assert.deepEqual(revisionsSet, [], 'must never adopt an older remote revision');

  delete globalThis.fetch;
  delete globalThis.chrome;
});

test('edits landing mid-push keep the pending flag so nothing is lost', async () => {
  const { setCalls } = mockChromeStorage({ syncPending: true });
  let resolvePut;
  const calls = mockSyncFetch(REMOTE_STATE, {
    interceptPut: () =>
      new Promise((resolve) => {
        resolvePut = resolve;
      })
  });

  const dom = {
    syncWorkerUrlInput: { value: 'https://worker.dev' },
    syncApiCodeInput: { value: 'secret' },
    syncStatus: { textContent: '', className: '' }
  };
  const controller = buildController(dom);

  assert.equal(await controller.loadSavedPending(), true);
  const bootPromise = controller.bootstrapCloud({ force: true });

  while (!resolvePut) await new Promise((resolve) => setTimeout(resolve, 5));
  // Simulates an edit whose saveData fires onScheduleSync while pushing.
  controller.scheduleAutoSync();
  resolvePut({
    ok: true,
    status: 200,
    json: async () => ({ ...REMOTE_STATE, revision: REMOTE_STATE.revision + 1 })
  });

  assert.equal(await bootPromise, true);
  assert.ok(calls.some((call) => call.method === 'PUT'));
  assert.equal(
    setCalls.filter((entry) => 'syncPending' in entry).length,
    0,
    'pending flag must stay set until the newer edit is confirmed pushed'
  );

  delete globalThis.fetch;
  delete globalThis.chrome;
});
