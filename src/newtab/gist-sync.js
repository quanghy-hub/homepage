export function setSyncStatus(dom, msg, type = '') {
    dom.syncStatus.textContent = msg;
    dom.syncStatus.className = 'sync-status' + (type ? ' ' + type : '');
}

export function setVerifyStatus(dom, msg, type = '') {
    if (!dom.gistVerifyStatus) return;
    dom.gistVerifyStatus.textContent = msg;
    dom.gistVerifyStatus.className = 'sync-status' + (type ? ' ' + type : '');
}

export function getGistHeaders(dom) {
    const token = dom.gistTokenInput.value.trim();
    if (!token) return null;
    return {
        Authorization: 'token ' + token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
    };
}

export function bindGistCredentialInputs(dom) {
    dom.gistTokenInput.addEventListener('input', () => {
        chrome.storage.local.set({ gistToken: dom.gistTokenInput.value.trim() });
    });
}

export function loadSavedGistCredentials(dom) {
    chrome.storage.local.get(['gistToken', 'gistId'], result => {
        if (result.gistToken) dom.gistTokenInput.value = result.gistToken;
    });
}

export function buildExportData(state) {
    return {
        links: state.links,
        groups: state.groups,
        settings: state.settings
    };
}
