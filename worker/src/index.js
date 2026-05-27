const STATE_VERSION = 1;
const APP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

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

function getStateKey(appId) {
  return `apps/${appId}/state.v1.json`;
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

function normalizeProfile(value) {
  const profile = asObject(value);
  return {
    settings: asObject(profile.settings)
  };
}

function normalizeStoredState(value, appId) {
  const state = asObject(value);
  const groups = asObject(state.groups);
  const rawProfiles = asObject(state.profiles);
  const profiles = {};

  Object.entries(rawProfiles).forEach(([profileId, profile]) => {
    if (APP_ID_PATTERN.test(profileId)) {
      profiles[profileId] = normalizeProfile(profile);
    }
  });

  const firstLegacyProfile = asObject(Object.values(rawProfiles)[0]);

  return {
    version: STATE_VERSION,
    appId,
    links: asArray(state.links),
    groups: {
      list: asArray(groups.list),
      pinned: asArray(groups.pinned).length ? asArray(groups.pinned) : asArray(firstLegacyProfile.pinned),
      selected: typeof groups.selected === 'string'
        ? groups.selected
        : (typeof firstLegacyProfile.selected === 'string' ? firstLegacyProfile.selected : '')
    },
    profiles,
    revision: Number.isSafeInteger(state.revision) ? state.revision : 0,
    updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : null
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

async function writeState(bucket, appId, incoming) {
  const existing = await readState(bucket, appId);
  const payload = asObject(incoming);
  const groups = asObject(payload.groups);
  const profileId = String(payload.profileId || '').toLowerCase();

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
    links: asArray(payload.links),
    groups: {
      list: asArray(groups.list),
      pinned: asArray(groups.pinned),
      selected: typeof groups.selected === 'string' ? groups.selected : ''
    },
    profiles: { ...existing.profiles },
    revision: existing.revision + 1,
    updatedAt: new Date().toISOString()
  };

  if (profileId) {
    next.profiles[profileId] = normalizeProfile(payload.profile);
  } else {
    Object.entries(asObject(payload.profiles)).forEach(([id, profile]) => {
      if (APP_ID_PATTERN.test(id)) {
        next.profiles[id] = normalizeProfile(profile);
      }
    });
  }

  await bucket.put(getStateKey(appId), JSON.stringify(next, null, 2), {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8'
    }
  });

  return next;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const appId = getAppId(url.pathname);
    if (!appId || !APP_ID_PATTERN.test(appId)) {
      return errorResponse('Not found', 404);
    }

    if (!(await isAuthorized(request, env))) {
      return errorResponse('Unauthorized', 401);
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
