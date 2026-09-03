export function createSettingsController({
  applySettings,
  clearFaviconCache,
  dom,
  getSettings,
  loadSyncCredentials,
  render,
  saveData
}) {
  const {
    cleanupFaviconsBtn,
    grantFaviconPermsBtn,
    faviconPermHint,
    settingIconSize,
    settingIconSizeVal,
    settingsBtn,
    settingsClose,
    settingsOverlay
  } = dom;

  function checkFaviconPermissions() {
    const ext =
      typeof chrome !== 'undefined' ? chrome : typeof browser !== 'undefined' ? browser : null;
    const origins = [
      'https://www.google.com/*',
      'https://*.gstatic.com/*',
      'https://icons.duckduckgo.com/*'
    ];
    if (ext?.permissions?.contains && grantFaviconPermsBtn) {
      ext.permissions.contains({ origins }, (hasPerms) => {
        if (hasPerms) {
          grantFaviconPermsBtn.classList.add('hidden');
          faviconPermHint?.classList.add('hidden');
        } else {
          grantFaviconPermsBtn.classList.remove('hidden');
          faviconPermHint?.classList.remove('hidden');
        }
      });
    }
  }

  function refreshControls() {
    const settings = getSettings();
    settingIconSize.value = settings.iconSize;
    settingIconSizeVal.textContent = settings.iconSize + 'px';
    checkFaviconPermissions();
  }

  function open() {
    settingsOverlay.classList.remove('hidden');
    refreshControls();
    loadSyncCredentials();
  }

  function close() {
    settingsOverlay.classList.add('hidden');
  }

  grantFaviconPermsBtn?.addEventListener('click', () => {
    const ext =
      typeof chrome !== 'undefined' ? chrome : typeof browser !== 'undefined' ? browser : null;
    if (!ext?.permissions?.request) return;
    const origins = [
      'https://www.google.com/*',
      'https://*.gstatic.com/*',
      'https://icons.duckduckgo.com/*'
    ];
    ext.permissions.request({ origins }, (granted) => {
      if (granted) {
        grantFaviconPermsBtn.classList.add('hidden');
        faviconPermHint?.classList.add('hidden');
        clearFaviconCache();
        render();
      }
    });
  });

  settingsBtn.addEventListener('click', open);
  settingsClose.addEventListener('click', close);
  settingsOverlay.addEventListener('click', (event) => {
    if (event.target === settingsOverlay) close();
  });

  settingIconSize.addEventListener('input', () => {
    const value = Number.parseInt(settingIconSize.value, 10);
    settingIconSizeVal.textContent = value + 'px';
    getSettings().iconSize = value;
    saveData();
    applySettings();
  });

  cleanupFaviconsBtn.addEventListener('click', () => {
    clearFaviconCache();
    render();
  });

  return { close, refreshControls };
}
