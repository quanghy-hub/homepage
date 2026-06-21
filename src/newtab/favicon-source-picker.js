import { FAVICON_SOURCES, normalizeFaviconSource } from '../shared/utils/link-utils.js';
import { loadFaviconPreview } from './favicon-preview-loader.js';

export function createFaviconSourcePicker({
  inputs,
  previews
}) {
  let requestId = 0;

  function getSelected() {
    return normalizeFaviconSource(inputs.find(input => input.checked)?.value);
  }

  function setSelected(source) {
    const selectedSource = normalizeFaviconSource(source);
    inputs.forEach(input => {
      input.checked = input.value === selectedSource;
    });
  }

  async function refresh(pageUrl) {
    const currentRequestId = ++requestId;
    previews.forEach(({ element }) => element.removeAttribute('src'));

    const results = await Promise.all(previews.map(async ({ element, source }) => ({
      element,
      source,
      url: await loadFaviconPreview({ pageUrl, source })
    })));
    if (currentRequestId !== requestId) return;

    results.forEach(({ element, url }) => {
      if (url) element.src = url;
    });
  }

  return {
    getSelected,
    refresh,
    setSelected
  };
}
