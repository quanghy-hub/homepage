import assert from 'node:assert/strict';
import test from 'node:test';

import { readState, writeState } from '../worker/src/storage.js';
import { getBackupEndpoint, getStateEndpoint, normalizeWorkerUrl } from '../src/newtab/sync-api.js';

class MemoryBucket {
  constructor() {
    this.objects = new Map();
  }

  async get(key) {
    const value = this.objects.get(key);
    return value === undefined ? null : { json: async () => JSON.parse(value) };
  }

  async put(key, value) {
    this.objects.set(key, value);
  }
}

test('worker stores the active profile and creates revisioned state', async () => {
  const bucket = new MemoryBucket();
  const state = await writeState(bucket, 'homepage', {
    baseRevision: 0,
    groups: { list: ['A'] },
    links: [{ _id: 'one', parent: 'A', url: 'https://example.com/' }],
    profile: {
      pinned: ['A'],
      selected: 'A',
      settings: { iconSize: 56 }
    },
    profileId: 'macbook'
  });

  assert.equal(state.revision, 1);
  assert.deepEqual(state.profiles.macbook.pinned, ['A']);
  assert.equal(state.profiles.macbook.settings.iconSize, 56);
  assert.equal((await readState(bucket, 'homepage')).links[0]._id, 'one');
  assert.equal(bucket.objects.has('apps/homepage/backup-b.v1.json'), true);
});

test('worker rejects writes based on a stale revision', async () => {
  const bucket = new MemoryBucket();
  await writeState(bucket, 'homepage', { baseRevision: 0, groups: { list: [] } });

  await assert.rejects(
    writeState(bucket, 'homepage', { baseRevision: 0, groups: { list: [] } }),
    (error) => error.message === 'Revision conflict' && error.status === 409
  );
});

test('normalizeWorkerUrl formats URL correctly with https protocol', () => {
  assert.equal(normalizeWorkerUrl(''), '');
  assert.equal(normalizeWorkerUrl('  my-worker.workers.dev/  '), 'https://my-worker.workers.dev');
  assert.equal(normalizeWorkerUrl('http://localhost:8787/'), 'http://localhost:8787');
  assert.equal(
    getStateEndpoint('my-worker.workers.dev'),
    'https://my-worker.workers.dev/sync/homepage/state'
  );
  assert.equal(
    getBackupEndpoint('my-worker.workers.dev', 'a'),
    'https://my-worker.workers.dev/sync/homepage/backup/a'
  );
});
