import { createId } from '../shared/utils/id.js';
import {
  autoTitle,
  FAVICON_SOURCES,
  getFaviconUrl,
  isHttpUrl
} from '../shared/utils/link-utils.js';
import { createFaviconSourcePicker } from './favicon-source-picker.js';

export function createModalController({
  dom,
  deleteGroup,
  deleteLink,
  getGroups,
  getLinks,
  getLinksForGroup,
  getSelectedGroup,
  normalizeGroupOrders,
  recordDeletedGroups,
  renameGroupInProfiles,
  render,
  saveData,
  setSelectedGroup,
  togglePinGroup
}) {
  const {
    modalOverlay,
    modalTitle,
    modalBodyLink,
    modalBodyGroup,
    inputUrl,
    inputName,
    inputGroup,
    faviconSourceOptions,
    faviconSourceInputs,
    faviconPreviewGoogle,
    faviconPreviewChrome,
    inputGroupName,
    modalPin,
    modalDelete,
    modalCancel,
    modalSave
  } = dom;

  let editingLinkId = null;
  let editingGroupName = null;
  let modalMode = null;

  const faviconPicker = createFaviconSourcePicker({
    inputs: faviconSourceInputs,
    previews: [
      { element: faviconPreviewGoogle, source: FAVICON_SOURCES.google },
      { element: faviconPreviewChrome, source: FAVICON_SOURCES.chrome }
    ]
  });

  function openModal(mode, link = null, defaultGroup = null) {
    const groups = getGroups();
    modalMode = mode;
    modalOverlay.classList.remove('hidden');
    modalPin.classList.add('hidden');
    modalDelete.classList.add('hidden');

    if (mode === 'add-group') {
      modalTitle.textContent = 'Add Group';
      modalBodyLink.classList.add('hidden');
      modalBodyGroup.classList.remove('hidden');
      inputGroupName.value = '';
      inputGroupName.focus();
    } else if (mode === 'edit-group') {
      modalTitle.textContent = 'Rename Group';
      modalBodyLink.classList.add('hidden');
      modalBodyGroup.classList.remove('hidden');
      inputGroupName.value = link;
      editingGroupName = link;
      modalPin.textContent = groups.pinned.includes(link) ? 'Unpin' : 'Pin';
      modalPin.classList.remove('hidden');
      modalDelete.classList.remove('hidden');
      inputGroupName.focus();
    } else {
      modalBodyLink.classList.remove('hidden');
      modalBodyGroup.classList.add('hidden');

      inputGroup.innerHTML = '';
      groups.list.forEach((groupName) => {
        const opt = document.createElement('option');
        opt.value = groupName;
        opt.textContent = groupName;
        inputGroup.appendChild(opt);
      });

      if (mode === 'edit-link' && link) {
        modalTitle.textContent = 'Edit Link';
        inputUrl.value = link.url;
        inputName.value = link.title;
        inputGroup.value = link.parent;
        faviconPicker.setSelected(link.faviconSource);
        faviconSourceOptions.classList.remove('hidden');
        faviconPicker.refresh(link.url);
        editingLinkId = link._id;
        modalDelete.classList.remove('hidden');
      } else {
        modalTitle.textContent = 'Add Link';
        inputUrl.value = '';
        inputName.value = '';
        inputGroup.value = defaultGroup || getSelectedGroup();
        faviconPicker.setSelected(FAVICON_SOURCES.google);
        faviconSourceOptions.classList.add('hidden');
        editingLinkId = null;
      }
      inputUrl.focus();
    }
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
    editingLinkId = null;
    editingGroupName = null;
    modalMode = null;
  }

  function fillAddLinkModal(url = '', title = '', group = getSelectedGroup()) {
    openModal('add-link', null, group);
    inputUrl.value = url;
    inputName.value = title || (url ? autoTitle(url) : '');
    inputGroup.value = group;
    inputUrl.focus();
  }

  function saveGroup() {
    const groups = getGroups();
    const links = getLinks();
    const name = inputGroupName.value.trim();
    if (!name) return;
    if (groups.list.includes(name) && name !== editingGroupName) return;

    if (modalMode === 'edit-group' && editingGroupName) {
      const now = Date.now();
      groups.list = groups.list.map((groupName) =>
        groupName === editingGroupName ? name : groupName
      );
      groups.pinned = groups.pinned.map((groupName) =>
        groupName === editingGroupName ? name : groupName
      );
      links.forEach((link) => {
        if (link.parent === editingGroupName) {
          link.parent = name;
          // Bump updatedAt so the rename wins the last-write-wins merge and
          // the old group copy on the cloud does not resurrect the links.
          link.updatedAt = now;
        }
      });
      // Tombstone the old group name so remote devices drop it on merge.
      recordDeletedGroups?.(editingGroupName);
      if (getSelectedGroup() === editingGroupName) setSelectedGroup(name);
      groups.selected = getSelectedGroup();
      renameGroupInProfiles(editingGroupName, name);
    } else {
      groups.list.push(name);
      setSelectedGroup(name);
      groups.selected = name;
    }

    saveData();
    closeModal();
    render();
  }

  function saveLink() {
    const links = getLinks();
    const url = inputUrl.value.trim();
    if (!isHttpUrl(url)) {
      inputUrl.setCustomValidity('Enter a valid http:// or https:// URL.');
      inputUrl.reportValidity();
      return;
    }
    inputUrl.setCustomValidity('');

    const title = inputName.value.trim() || autoTitle(url);
    const group = inputGroup.value;
    const faviconSource = faviconPicker.getSelected();
    if (editingLinkId) {
      const link = links.find((item) => item._id === editingLinkId);
      if (link) {
        const previousGroup = link.parent;
        link.url = url;
        link.faviconSource = faviconSource;
        link.faviconUrl = getFaviconUrl(url, faviconSource);
        link.title = title;
        link.parent = group;
        link.updatedAt = Date.now();
        normalizeGroupOrders(previousGroup, group);
      }
    } else {
      const groupLinks = getLinksForGroup(group);
      const newId = createId('links');
      links.push({
        _id: newId,
        order: groupLinks.length,
        parent: group,
        title,
        url,
        faviconSource: FAVICON_SOURCES.google,
        faviconUrl: getFaviconUrl(url, FAVICON_SOURCES.google),
        updatedAt: Date.now()
      });
    }

    saveData();
    closeModal();
    render();
  }

  modalCancel.addEventListener('click', closeModal);
  modalPin.addEventListener('click', () => {
    if (modalMode !== 'edit-group' || !editingGroupName) return;
    const groupName = editingGroupName;
    closeModal();
    togglePinGroup(groupName);
  });
  modalDelete.addEventListener('click', () => {
    if (modalMode === 'edit-link' && editingLinkId) {
      const targetId = editingLinkId;
      closeModal();
      deleteLink(targetId);
      return;
    }

    if (modalMode === 'edit-group' && editingGroupName) {
      const groupName = editingGroupName;
      closeModal();
      deleteGroup(groupName);
    }
  });
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  modalSave.addEventListener('click', () => {
    if (modalMode === 'add-group' || modalMode === 'edit-group') {
      saveGroup();
      return;
    }

    saveLink();
  });

  [inputUrl, inputName, inputGroupName, inputGroup].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      modalSave.click();
    });
  });

  inputUrl.addEventListener('blur', () => {
    if (inputUrl.value && !inputName.value) {
      inputName.value = autoTitle(inputUrl.value);
    }
  });
  inputUrl.addEventListener('input', () => {
    inputUrl.setCustomValidity('');
    if (modalMode === 'edit-link') faviconPicker.refresh(inputUrl.value.trim());
  });

  return {
    closeModal,
    fillAddLinkModal,
    openModal
  };
}
