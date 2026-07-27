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
    settingIconSize,
    settingIconSizeVal,
    settingsBtn,
    settingsClose,
    settingsOverlay
  } = dom;

  function refreshControls() {
    const settings = getSettings();
    settingIconSize.value = settings.iconSize;
    settingIconSizeVal.textContent = settings.iconSize + 'px';
  }

  function open() {
    settingsOverlay.classList.remove('hidden');
    refreshControls();
    loadSyncCredentials();
  }

  function close() {
    settingsOverlay.classList.add('hidden');
  }

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
