import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeLocalAddsIntoRemote } from '../src/newtab/sync-api.js';
import { createId } from '../src/shared/utils/id.js';
import { readState, writeState } from '../worker/src/storage.js';
import { normalizeDeletedNamesMap, normalizeStoredState } from '../worker/src/normalizers.js';

class MemoryBucket {
  constructor() {
    this.objects = new Map();
  }

  async get(key) {
    const value = this.objects.get(key);
    return value === undefined ? null : { json: async () => JSON.parse(value), etag: 'e1' };
  }

  async put(key, value) {
    this.objects.set(key, value);
  }
}

test('worker writeState merges and persists group tombstones', async () => {
  const bucket = new MemoryBucket();
  const now = Date.now();

  await writeState(bucket, 'homepage', {
    baseRevision: 0,
    groups: { list: ['A', 'B'] },
    deletedGroupsMap: { A: now }
  });

  const updated = await writeState(bucket, 'homepage', {
    baseRevision: 1,
    groups: { list: ['A', 'B'] },
    deletedGroupsMap: { B: now + 5 }
  });
  assert.equal(updated.deletedGroupsMap.A, now);
  assert.equal(updated.deletedGroupsMap.B, now + 5);

  const stored = await readState(bucket, 'homepage');
  assert.equal(stored.deletedGroupsMap.A, now);
});

test('createId produces unique, prefixed identifiers', () => {
  const ids = new Set(Array.from({ length: 500 }, () => createId('links')));
  assert.equal(ids.size, 500);
  for (const id of ids) {
    assert.ok(id.startsWith('links-'));
    assert.ok(id.length > 'links-'.length);
  }
});

test('normalizeDeletedNamesMap keeps bounded non-empty string keys with fresh timestamps', () => {
  const now = Date.now();
  const map = normalizeDeletedNamesMap(
    {
      'Work Stuff': now,
      '': now, // empty name dropped
      ok: now - 1000,
      stale: now - 31 * 24 * 60 * 60 * 1000, // older than TTL dropped
      badType: 'nope', // non-integer timestamp dropped
      longName: 'x'.repeat(201) // over 200 chars dropped
    },
    now
  );
  assert.deepEqual(map, { 'Work Stuff': now, ok: now - 1000 });
});

test('group tombstones drop deleted and renamed groups from the merged list', () => {
  const remote = {
    links: [
      { _id: 'l1', parent: 'Old', url: 'https://a.com', updatedAt: 10 },
      { _id: 'l2', parent: 'Keep', url: 'https://b.com', updatedAt: 10 }
    ],
    groups: { list: ['Old', 'Keep'] }
  };
  const local = {
    links: [{ _id: 'l2', parent: 'Keep', url: 'https://b.com', updatedAt: 10 }],
    groups: { list: ['Keep'] },
    deletedGroupsMap: { Old: Date.now() }
  };

  const merged = mergeLocalAddsIntoRemote(remote, local);
  assert.deepEqual(merged.groups.list, ['Keep']);
  assert.equal(merged.deletedGroupsMap.Old, local.deletedGroupsMap.Old);
});

test('a link edited after its group rename wins LWW and does not resurrect the old group', () => {
  const now = Date.now();
  const remote = {
    links: [{ _id: 'l1', parent: 'Old', url: 'https://a.com/', updatedAt: now - 5000 }],
    groups: { list: ['Old', 'New'] }
  };
  const local = {
    links: [{ _id: 'l1', parent: 'New', url: 'https://a.com/', updatedAt: now }],
    groups: { list: ['New'] },
    deletedGroupsMap: { Old: now - 1000 }
  };

  const merged = mergeLocalAddsIntoRemote(remote, local);

  // The newer local copy (renamed parent) must win the merge...
  assert.equal(merged.links[0].parent, 'New');
  // ...and the tombstoned "Old" group must not come back.
  assert.deepEqual(merged.groups.list, ['New']);
});

test('worker normalizer preserves deletedGroupsMap on stored state round-trip', () => {
  const now = Date.now();
  const state = normalizeStoredState(
    {
      revision: 3,
      groups: { list: ['A'] },
      deletedGroupsMap: { A: now }
    },
    'homepage'
  );
  assert.deepEqual(state.deletedGroupsMap, { A: now });
});
