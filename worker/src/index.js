import { CORS_HEADERS, errorResponse, isAuthorized, jsonResponse } from './utils.js';
import { APP_ID_PATTERN } from './normalizers.js';
import { readBackup, readState, runScheduledBackups, writeBackup, writeState } from './storage.js';

const BACKUP_SLOT_PATTERN = /^[ab]$/;

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

export default {
  async scheduled(_event, env, _ctx) {
    await runScheduledBackups(env.EXTENSION_BUCKET);
  },

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
