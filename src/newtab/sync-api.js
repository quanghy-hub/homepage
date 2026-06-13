export const SYNC_APP_ID = 'homepage';
export const BACKUP_SLOTS = ['a', 'b'];

export function getStateEndpoint(workerUrl) {
    if (!workerUrl) return '';
    return `${workerUrl.replace(/\/+$/, '')}/sync/${SYNC_APP_ID}/state`;
}

export function getBackupEndpoint(workerUrl, slot) {
    if (!workerUrl) return '';
    return `${workerUrl.replace(/\/+$/, '')}/sync/${SYNC_APP_ID}/backup/${slot}`;
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
        }
    };
}

export function mergeLocalAddsIntoRemote(remote, localState) {
    const remoteLinks = Array.isArray(remote?.links) ? remote.links : [];
    const localLinks = Array.isArray(localState?.links) ? localState.links : [];
    const mergedLinks = remoteLinks.slice();
    const remoteLinkIds = new Set(remoteLinks.map(link => link?._id).filter(Boolean));

    localLinks.forEach(link => {
        if (link?._id && !remoteLinkIds.has(link._id)) {
            mergedLinks.push(link);
            remoteLinkIds.add(link._id);
        }
    });

    const remoteGroups = Array.isArray(remote?.groups?.list) ? remote.groups.list : [];
    const localGroups = Array.isArray(localState?.groups?.list) ? localState.groups.list : [];
    const mergedGroups = remoteGroups.slice();
    const groupNames = new Set(mergedGroups);

    localGroups.forEach(groupName => {
        if (typeof groupName === 'string' && !groupNames.has(groupName)) {
            mergedGroups.push(groupName);
            groupNames.add(groupName);
        }
    });

    mergedLinks.forEach(link => {
        if (typeof link?.parent === 'string' && !groupNames.has(link.parent)) {
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
        }
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
    const putState = async (revision, nextState = state) => fetch(endpoint, {
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
            ...await res.json(),
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
            ...await res.json(),
            syncMerged: true
        };
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
}
