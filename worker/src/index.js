const STATE_VERSION = 1;
const DAILY_BACKUP_MS = 24 * 60 * 60 * 1000;
const MIN_BACKUP_A_INTERVAL_HOURS = 1;
const MAX_BACKUP_A_INTERVAL_HOURS = 24;
const APP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const BACKUP_SLOT_PATTERN = /^[ab]$/;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400'
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function errorResponse(message, status) {
  return jsonResponse({ ok: false, error: message }, status);
}

function getAppId(pathname) {
  const match = pathname.match(/^\/sync\/([^/]+)\/state\/?$/);
  if (!match) return '';
  return decodeURIComponent(match[1]).toLowerCase();
}

function getBackupRoute(pathname) {
  const match = pathname.match(/^\/sync\/([^/]+)\/backup\/([^/]+)\/?$/);
  if (!match) return null;
  return {
    appId: decodeURIComponent(match[1]).toLowerCase(),
    slot: decodeURIComponent(match[2]).toLowerCase()
  };
}

function getStateKey(appId) {
  return `apps/${appId}/state.v1.json`;
}

function getBackupKey(appId, slot) {
  return `apps/${appId}/backup-${slot}.v1.json`;
}

function getBearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function encodeText(value) {
  return new TextEncoder().encode(value);
}

async function isAuthorized(request, env) {
  const expected = env.SYNC_API_KEY || '';
  const actual = getBearerToken(request);
  if (!expected || !actual) return false;

  const expectedBytes = encodeText(expected);
  const actualBytes = encodeText(actual);
  if (expectedBytes.length !== actualBytes.length) return false;

  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(expectedBytes, actualBytes);
  }

  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i += 1) {
    diff |= expectedBytes[i] ^ actualBytes[i];
  }
  return diff === 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeBackupAIntervalMs(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) return DAILY_BACKUP_MS;
  const safeHours = Math.min(MAX_BACKUP_A_INTERVAL_HOURS, Math.max(MIN_BACKUP_A_INTERVAL_HOURS, Math.round(hours)));
  return safeHours * 60 * 60 * 1000;
}

function normalizeSession(session, index) {
  const s = asObject(session);
  return {
    name: typeof s.name === 'string' ? s.name : `Session ${index + 1}`,
    updatedAt: Number.isSafeInteger(s.updatedAt) ? s.updatedAt : null,
    cookies: asArray(s.cookies),
    localStorage: asObject(s.localStorage),
    sessionStorage: asObject(s.sessionStorage)
  };
}

function normalizeSite(site) {
  const s = asObject(site);
  return {
    id: typeof s.id === 'string' ? s.id : '',
    origin: typeof s.origin === 'string' ? s.origin : '',
    host: typeof s.host === 'string' ? s.host : '',
    activeSlot: Number.isInteger(s.activeSlot) ? s.activeSlot : null,
    sessions: asArray(s.sessions).map((session, index) => normalizeSession(session, index))
  };
}

function normalizeProfile(value, fallbackGroups = {}) {
  const profile = asObject(value);
  const normalized = {};
  const groupList = asArray(fallbackGroups.list);

  if (Object.prototype.hasOwnProperty.call(profile, 'sites')) {
    normalized.sites = asArray(profile.sites).map(normalizeSite);
  }
  if (Object.prototype.hasOwnProperty.call(profile, 'settings')) {
    normalized.settings = asObject(profile.settings);
  }
  if (Object.prototype.hasOwnProperty.call(profile, 'pinned') || asArray(fallbackGroups.pinned).length) {
    const rawPinned = asArray(profile.pinned).length ? asArray(profile.pinned) : asArray(fallbackGroups.pinned);
    normalized.pinned = groupList.length ? rawPinned.filter(name => groupList.includes(name)) : rawPinned;
  }
  if (typeof profile.selected === 'string' || typeof fallbackGroups.selected === 'string') {
    const selected = typeof profile.selected === 'string' ? profile.selected : fallbackGroups.selected;
    normalized.selected = groupList.length && !groupList.includes(selected) ? '' : selected;
  }

  return normalized;
}

function normalizeStoredState(value, appId) {
  const state = asObject(value);
  const groups = asObject(state.groups);
  const rawProfiles = asObject(state.profiles);
  const profiles = {};

  Object.entries(rawProfiles).forEach(([profileId, profile]) => {
    if (APP_ID_PATTERN.test(profileId)) {
      profiles[profileId] = normalizeProfile(profile, groups);
    }
  });

  const legacyProfileId = String(state.profileId || '').toLowerCase();
  if (!Object.keys(profiles).length && APP_ID_PATTERN.test(legacyProfileId)) {
    profiles[legacyProfileId] = normalizeProfile(null, groups);
  }

  return {
    version: STATE_VERSION,
    appId,
    links: asArray(state.links),
    groups: {
      list: asArray(groups.list),
      pinned: asArray(groups.pinned),
      selected: typeof groups.selected === 'string' ? groups.selected : ''
    },
    profiles,
    revision: Number.isSafeInteger(state.revision) ? state.revision : 0,
    updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : null,
    backupSlot: typeof state.backupSlot === 'string' ? state.backupSlot : null,
    backupUpdatedAt: typeof state.backupUpdatedAt === 'string' ? state.backupUpdatedAt : null
  };
}

async function readState(bucket, appId) {
  const object = await bucket.get(getStateKey(appId));
  if (!object) return normalizeStoredState(null, appId);

  try {
    return normalizeStoredState(await object.json(), appId);
  } catch {
    return normalizeStoredState(null, appId);
  }
}

async function readBackup(bucket, appId, slot) {
  const object = await bucket.get(getBackupKey(appId, slot));
  if (!object) return null;

  try {
    return normalizeStoredState(await object.json(), appId);
  } catch {
    return null;
  }
}

async function writeBackup(bucket, appId, slot) {
  const current = await readState(bucket, appId);
  if (!current || current.revision <= 0) {
    const err = new Error('State not found');
    err.status = 404;
    throw err;
  }

  const backup = {
    ...current,
    backupSlot: slot,
    backupUpdatedAt: new Date().toISOString()
  };
  await writeObject(bucket, getBackupKey(appId, slot), backup);
  return backup;
}

async function writeObject(bucket, key, state) {
  await bucket.put(key, JSON.stringify(state, null, 2), {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8'
    }
  });
}

async function maybeRotateDailyBackup(bucket, appId, snapshot, intervalMs = DAILY_BACKUP_MS) {
  const existingBackup = await readBackup(bucket, appId, 'a');
  const lastUpdated = existingBackup?.backupUpdatedAt ? Date.parse(existingBackup.backupUpdatedAt) : 0;
  if (existingBackup && Number.isFinite(lastUpdated) && Date.now() - lastUpdated < intervalMs) {
    return;
  }

  await writeObject(bucket, getBackupKey(appId, 'a'), {
    ...snapshot,
    backupSlot: 'a',
    backupUpdatedAt: new Date().toISOString()
  });
}

async function writeState(bucket, appId, incoming) {
  const existing = await readState(bucket, appId);
  const payload = asObject(incoming);
  const groups = asObject(payload.groups);
  const profileId = String(payload.profileId || '').toLowerCase();
  const backupAIntervalMs = normalizeBackupAIntervalMs(payload.backupAIntervalHours);

  if (profileId && !APP_ID_PATTERN.test(profileId)) {
    throw new Error('Invalid profileId');
  }

  if (
    Number.isSafeInteger(payload.baseRevision) &&
    payload.baseRevision !== existing.revision
  ) {
    const err = new Error('Revision conflict');
    err.status = 409;
    throw err;
  }

  const next = {
    version: STATE_VERSION,
    appId,
    links: Object.prototype.hasOwnProperty.call(payload, 'links') ? asArray(payload.links) : existing.links,
    groups: Object.prototype.hasOwnProperty.call(payload, 'groups')
      ? {
          list: asArray(groups.list),
          pinned: asArray(groups.pinned),
          selected: typeof groups.selected === 'string' ? groups.selected : ''
        }
      : existing.groups,
    profiles: { ...existing.profiles },
    revision: existing.revision + 1,
    updatedAt: new Date().toISOString()
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

  await maybeRotateDailyBackup(bucket, appId, existing.revision > 0 ? existing : next, backupAIntervalMs);
  await writeObject(bucket, getStateKey(appId), next);
  await writeObject(bucket, getBackupKey(appId, 'b'), {
    ...next,
    backupSlot: 'b',
    backupUpdatedAt: new Date().toISOString()
  });

  return next;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const backupRoute = getBackupRoute(url.pathname);
    const appId = backupRoute?.appId || getAppId(url.pathname);
    if (!appId || !APP_ID_PATTERN.test(appId)) {
      return errorResponse('Not found', 404);
    }
    if (backupRoute && !BACKUP_SLOT_PATTERN.test(backupRoute.slot)) {
      return errorResponse('Not found', 404);
    }

    if (!(await isAuthorized(request, env))) {
      return errorResponse('Unauthorized', 401);
    }

    if (backupRoute) {
      if (request.method === 'GET') {
        const backup = await readBackup(env.EXTENSION_BUCKET, appId, backupRoute.slot);
        if (!backup) {
          return errorResponse('Backup not found', 404);
        }
        return jsonResponse(backup);
      }
      if (request.method === 'PUT' && backupRoute.slot === 'a') {
        try {
          return jsonResponse(await writeBackup(env.EXTENSION_BUCKET, appId, backupRoute.slot));
        } catch (err) {
          return errorResponse(err.message || 'Backup write failed', err.status || 400);
        }
      }
      if (request.method !== 'GET') {
        return errorResponse('Method not allowed', 405);
      }
    }

    if (request.method === 'GET') {
      return jsonResponse(await readState(env.EXTENSION_BUCKET, appId));
    }

    if (request.method === 'PUT') {
      let body;
      try {
        body = await request.json();
      } catch {
        return errorResponse('Invalid JSON body', 400);
      }

      try {
        return jsonResponse(await writeState(env.EXTENSION_BUCKET, appId, body));
      } catch (err) {
        return errorResponse(err.message || 'Invalid sync payload', err.status || 400);
      }
    }

    return errorResponse('Method not allowed', 405);
  }
};
