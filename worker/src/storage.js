import { asArray, asObject, getLocalDateParts } from './utils.js';
import {
  APP_ID_PATTERN,
  DEFAULT_BACKUP_A_HOUR,
  STATE_VERSION,
  normalizeProfile,
  normalizeStoredState,
  normalizeTimeZone
} from './normalizers.js';

export function getStateKey(appId) {
  return `apps/${appId}/state.v1.json`;
}

export function getBackupKey(appId, slot) {
  return `apps/${appId}/backup-${slot}.v1.json`;
}

export async function readState(bucket, appId) {
  const object = await bucket.get(getStateKey(appId));
  if (!object) return normalizeStoredState(null, appId);

  try {
    const state = normalizeStoredState(await object.json(), appId);
    state._etag = object.etag;
    return state;
  } catch {
    return normalizeStoredState(null, appId);
  }
}

export async function readBackup(bucket, appId, slot) {
  const object = await bucket.get(getBackupKey(appId, slot));
  if (!object) return null;

  try {
    return normalizeStoredState(await object.json(), appId);
  } catch {
    return null;
  }
}

export async function writeObject(bucket, key, state, options = {}) {
  await bucket.put(key, JSON.stringify(state, null, 2), {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8'
    },
    ...options
  });
}

export async function writeBackup(bucket, appId, slot, sourceState = null, now = new Date()) {
  const current = sourceState || (await readState(bucket, appId));
  if (!current || current.revision <= 0) {
    const err = new Error('State not found');
    err.status = 404;
    throw err;
  }
  const timeZone = normalizeTimeZone(current.backupATimeZone);
  const { dateKey } = getLocalDateParts(now, timeZone);

  const backup = {
    ...current,
    backupSlot: slot,
    backupUpdatedAt: now.toISOString(),
    backupADateKey: slot === 'a' ? dateKey : current.backupADateKey
  };
  await writeObject(bucket, getBackupKey(appId, slot), backup);
  return backup;
}

export async function maybeRunScheduledBackupA(bucket, appId, snapshot, now = new Date()) {
  const existingBackup = await readBackup(bucket, appId, 'a');
  const timeZone = normalizeTimeZone(snapshot.backupATimeZone);
  const { dateKey, hour } = getLocalDateParts(now, timeZone);
  if (hour !== DEFAULT_BACKUP_A_HOUR) {
    return;
  }
  if (existingBackup?.backupADateKey === dateKey) return;

  await writeBackup(bucket, appId, 'a', snapshot, now);
}

export async function writeState(bucket, appId, incoming) {
  const existing = await readState(bucket, appId);
  const payload = asObject(incoming);
  const groups = asObject(payload.groups);
  const profileId = String(payload.profileId || '').toLowerCase();

  if (profileId && !APP_ID_PATTERN.test(profileId)) {
    throw new Error('Invalid profileId');
  }

  if (Number.isSafeInteger(payload.baseRevision) && payload.baseRevision !== existing.revision) {
    const err = new Error('Revision conflict');
    err.status = 409;
    throw err;
  }

  const next = {
    version: STATE_VERSION,
    appId,
    links: Object.prototype.hasOwnProperty.call(payload, 'links')
      ? asArray(payload.links)
      : existing.links,
    groups: Object.prototype.hasOwnProperty.call(payload, 'groups')
      ? {
          list: asArray(groups.list),
          pinned: asArray(groups.pinned),
          selected: typeof groups.selected === 'string' ? groups.selected : ''
        }
      : existing.groups,
    profiles: { ...existing.profiles },
    revision: existing.revision + 1,
    updatedAt: new Date().toISOString(),
    backupAHour: DEFAULT_BACKUP_A_HOUR,
    backupATimeZone: normalizeTimeZone(existing.backupATimeZone)
  };

  if (profileId) {
    next.profiles[profileId] = normalizeProfile(payload.profile, groups);
  } else {
    Object.entries(asObject(payload.profiles)).forEach(([id, profile]) => {
      if (APP_ID_PATTERN.test(id)) {
        next.profiles[id] = normalizeProfile(profile, groups);
      }
    });
  }

  const options = existing._etag ? { onlyIf: { etagMatches: existing._etag } } : {};
  delete next._etag;

  try {
    await writeObject(bucket, getStateKey(appId), next, options);
  } catch (err) {
    if (err.message && err.message.includes('Precondition Failed')) {
      const conflict = new Error('Revision conflict (ETag mismatch)');
      conflict.status = 409;
      throw conflict;
    }
    throw err;
  }

  await writeBackup(bucket, appId, 'b', next);
  await maybeRunScheduledBackupA(bucket, appId, next);

  return next;
}

export async function listAppIds(bucket) {
  const ids = new Set();
  let cursor;
  do {
    const listed = await bucket.list({ prefix: 'apps/', cursor });
    asArray(listed.objects).forEach((object) => {
      const match = object.key.match(/^apps\/([^/]+)\/state\.v1\.json$/);
      if (match && APP_ID_PATTERN.test(match[1])) ids.add(match[1]);
    });
    cursor = listed.truncated ? listed.cursor : null;
  } while (cursor);
  return [...ids];
}

export async function runScheduledBackups(bucket, now = new Date()) {
  const appIds = await listAppIds(bucket);
  const results = [];
  for (const appId of appIds) {
    const state = await readState(bucket, appId);
    if (state.revision > 0) {
      const backupB = await readBackup(bucket, appId, 'b');
      await maybeRunScheduledBackupA(bucket, appId, backupB || state, now);
      results.push(appId);
    }
  }
  return results;
}
