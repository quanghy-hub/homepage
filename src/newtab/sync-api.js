export const SYNC_APP_ID = 'homepage';
export const BACKUP_SLOTS = ['a', 'b'];

export function normalizeWorkerUrl(workerUrl) {
  if (!workerUrl) return '';
  const trimmed = String(workerUrl).trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export function getStateEndpoint(workerUrl) {
  const normalized = normalizeWorkerUrl(workerUrl);
  if (!normalized) return '';
  return `${normalized}/sync/${SYNC_APP_ID}/state`;
}

export function getBackupEndpoint(workerUrl, slot) {
  const normalized = normalizeWorkerUrl(workerUrl);
  if (!normalized) return '';
  return `${normalized}/sync/${SYNC_APP_ID}/backup/${slot}`;
}

export function getSyncHeaders(apiCode) {
  if (!apiCode) return null;
  return {
    Authorization: 'Bearer ' + apiCode,
    'Content-Type': 'application/json'
  };
}

export function buildConfiguredSync(workerUrl, apiCode) {
  if (!workerUrl) throw new Error('Please enter Worker URL first');
  const headers = getSyncHeaders(apiCode);
  if (!headers) throw new Error('Please enter API code first');
  const endpoint = getStateEndpoint(workerUrl);

  return { endpoint, headers };
}

export function buildExportData(state, baseRevision = null) {
  return {
    version: 1,
    appId: SYNC_APP_ID,
    profileId: state.profileId,
    baseRevision,
    links: state.links,
    groups: {
      list: state.groups.list
    },
    profile: {
      pinned: state.groups.pinned,
      selected: state.groups.selected,
      settings: state.settings
    },
    deletedMap: state.deletedMap || {},
    deletedGroupsMap: state.deletedGroupsMap || {}
  };
}

/**
 * Merges two deleted-link tombstones maps, keeping the newest timestamp per id.
 */
export function mergeDeletedMaps(...maps) {
  const out = {};
  maps.forEach((map) => {
    Object.entries(map && typeof map === 'object' ? map : {}).forEach(([id, ts]) => {
      if (id && Number.isSafeInteger(ts)) out[id] = Math.max(out[id] || 0, ts);
    });
  });
  return out;
}

/**
 * Merges the remote state with local changes before pushing.
 *
 * - New links/groups from either side are added (additive merge).
 * - Shared links use last-write-wins by `updatedAt` so local edits are not lost.
 * - Deletions recorded in either `deletedMap` (tombstones) win unless the live
 *   copy on the other side was edited after the deletion.
 */
export function mergeLocalAddsIntoRemote(remote, localState) {
  const remoteLinks = Array.isArray(remote?.links) ? remote.links : [];
  const localLinks = Array.isArray(localState?.links) ? localState.links : [];
  const deletedMap = mergeDeletedMaps(remote?.deletedMap, localState?.deletedMap);
  const deletedGroupsMap = mergeDeletedMaps(remote?.deletedGroupsMap, localState?.deletedGroupsMap);

  const isDeleted = (link) => {
    const ts = deletedMap[link?._id];
    return ts != null && (!link?.updatedAt || ts >= link.updatedAt);
  };

  const isGroupDeleted = (groupName) => Boolean(deletedGroupsMap[groupName]);

  const remoteById = new Map(
    remoteLinks.filter((link) => link?._id && !isDeleted(link)).map((link) => [link._id, link])
  );
  const localById = new Map(
    localLinks.filter((link) => link?._id && !isDeleted(link)).map((link) => [link._id, link])
  );

  const mergedLinks = [];
  const mergedIds = new Set();

  for (const [id, remoteLink] of remoteById) {
    const localLink = localById.get(id);
    const localUpdatedAt = localLink?.updatedAt || 0;
    const remoteUpdatedAt = remoteLink.updatedAt || 0;
    mergedLinks.push(localUpdatedAt > remoteUpdatedAt ? localLink : remoteLink);
    mergedIds.add(id);
  }

  localById.forEach((link, id) => {
    if (!mergedIds.has(id)) {
      mergedLinks.push(link);
      mergedIds.add(id);
    }
  });

  // Tombstoned groups (deleted/renamed on any device) are dropped up front.
  const mergedGroups = (Array.isArray(remote?.groups?.list) ? remote.groups.list : []).filter(
    (groupName) => !isGroupDeleted(groupName)
  );
  const groupNames = new Set(mergedGroups);

  (Array.isArray(localState?.groups?.list) ? localState.groups.list : []).forEach((groupName) => {
    if (typeof groupName === 'string' && !groupNames.has(groupName) && !isGroupDeleted(groupName)) {
      mergedGroups.push(groupName);
      groupNames.add(groupName);
    }
  });

  mergedLinks.forEach((link) => {
    if (
      typeof link?.parent === 'string' &&
      !groupNames.has(link.parent) &&
      !isGroupDeleted(link.parent)
    ) {
      mergedGroups.push(link.parent);
      groupNames.add(link.parent);
    }
  });

  return {
    ...localState,
    links: mergedLinks,
    groups: {
      ...(localState?.groups || {}),
      list: mergedGroups
    },
    deletedMap,
    deletedGroupsMap
  };
}

export async function verifyCloudflareSync(workerUrl, apiCode) {
  const { endpoint, headers } = buildConfiguredSync(workerUrl, apiCode);
  const res = await fetch(endpoint, {
    method: 'GET',
    headers
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function pullCloudflareState(workerUrl, apiCode) {
  const { endpoint, headers } = buildConfiguredSync(workerUrl, apiCode);
  const res = await fetch(endpoint, {
    method: 'GET',
    headers
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function pullCloudflareBackup(workerUrl, apiCode, slot) {
  const normalizedSlot = String(slot || '').toLowerCase();
  if (!BACKUP_SLOTS.includes(normalizedSlot)) {
    throw new Error('Invalid backup slot');
  }
  const endpoint = getBackupEndpoint(workerUrl, normalizedSlot);
  const headers = getSyncHeaders(apiCode);

  if (!workerUrl) throw new Error('Please enter Worker URL first');
  if (!headers) throw new Error('Please enter API code first');

  const res = await fetch(endpoint, {
    method: 'GET',
    headers
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function pushCloudflareBackup(workerUrl, apiCode, slot) {
  const normalizedSlot = String(slot || '').toLowerCase();
  if (!BACKUP_SLOTS.includes(normalizedSlot)) {
    throw new Error('Invalid backup slot');
  }
  const endpoint = getBackupEndpoint(workerUrl, normalizedSlot);
  const headers = getSyncHeaders(apiCode);

  if (!workerUrl) throw new Error('Please enter Worker URL first');
  if (!headers) throw new Error('Please enter API code first');

  const res = await fetch(endpoint, {
    method: 'PUT',
    headers
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function pushCloudflareState(workerUrl, apiCode, state, baseRevision = null) {
  const { endpoint, headers } = buildConfiguredSync(workerUrl, apiCode);
  const putState = async (revision, nextState = state) =>
    fetch(endpoint, {
      method: 'PUT',
      headers,
      body: JSON.stringify(buildExportData(nextState, revision))
    });
  const fetchLatestState = async () => {
    const latest = await fetch(endpoint, {
      method: 'GET',
      headers
    });
    if (!latest.ok) throw new Error(`HTTP ${latest.status}: ${latest.statusText}`);
    return latest.json();
  };

  if (!Number.isSafeInteger(baseRevision)) {
    const latestState = await fetchLatestState();
    const res = await putState(latestState.revision, mergeLocalAddsIntoRemote(latestState, state));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return {
      ...(await res.json()),
      syncMerged: true
    };
  }

  let res = await putState(baseRevision);
  if (res.status === 409) {
    const latestState = await fetchLatestState();
    res = await putState(latestState.revision, mergeLocalAddsIntoRemote(latestState, state));
    if (res.status === 409) {
      return {
        ...latestState,
        syncConflict: true
      };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return {
      ...(await res.json()),
      syncMerged: true
    };
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}
