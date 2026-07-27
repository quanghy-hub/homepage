import { autoTitle } from '../shared/utils/link-utils.js';
import { createFaviconController } from './favicon-controller.js';

export function createHomeRenderer({
  dom,
  getFaviconCache,
  getGroups,
  getLinksForGroup,
  getSelectedGroup,
  getSettings,
  isEditMode,
  persistFaviconCache,
  queueIdleTask
}) {
  const faviconController = createFaviconController({
    getFaviconCache,
    persistFaviconCache,
    queueIdleTask
  });

  function applySettings() {
    const settings = getSettings();
    const sz = settings.iconSize || 56;
    const cell = sz + 20;
    document.documentElement.style.setProperty('--icon-size', sz + 'px');
    document.documentElement.style.setProperty('--icon-cell', cell + 'px');
  }

  function createLinkEl(link) {
    const el = document.createElement('a');
    el.className = 'link-item';
    el.href = link.url;
    el.dataset.id = link._id;
    el.dataset.parent = link.parent;
    el.draggable = isEditMode();
    el.title = link.title || link.url;

    const iconWrap = document.createElement('div');
    iconWrap.className = 'icon-wrap';

    const img = document.createElement('img');
    faviconController.attach({ element: el, iconWrap, img, link });

    const label = document.createElement('span');
    label.className = 'icon-label';
    label.textContent = link.title || autoTitle(link.url);

    const editBadge = document.createElement('span');
    editBadge.className = 'link-edit-badge';
    editBadge.textContent = 'X';

    el.appendChild(iconWrap);
    el.appendChild(label);
    el.appendChild(editBadge);

    return el;
  }

  function render() {
    const sourceGroups = getGroups() || {};
    const groupList = Array.isArray(sourceGroups.list) ? sourceGroups.list : [];
    const pinnedGroups = Array.isArray(sourceGroups.pinned) ? sourceGroups.pinned : [];
    const groups = {
      ...sourceGroups,
      list: groupList,
      pinned: pinnedGroups
    };
    const selectedGroup = getSelectedGroup();
    applySettings();

    dom.pinnedGrid.innerHTML = '';
    groups.pinned.forEach((groupName) => {
      const groupLinks = getLinksForGroup(groupName);
      if (groupLinks.length === 0 && groupName !== groups.pinned[0]) return;

      const grid = document.createElement('div');
      grid.className = 'links-grid';
      grid.dataset.group = groupName;
      groupLinks.forEach((link) => {
        grid.appendChild(createLinkEl(link));
      });

      const header = document.createElement('div');
      header.className = 'pinned-group-header';
      header.textContent = groupName;
      header.dataset.groupName = groupName;
      header.classList.add('group-context-target');
      header.draggable = isEditMode();

      dom.pinnedGrid.appendChild(grid);

      if (groupName === groups.pinned[0]) {
        const firstPinnedRow = document.createElement('div');
        firstPinnedRow.className = 'pinned-group-row';
        firstPinnedRow.appendChild(header);
        firstPinnedRow.appendChild(dom.quickActions);
        dom.pinnedGrid.appendChild(firstPinnedRow);
      } else {
        dom.pinnedGrid.appendChild(header);
      }
    });

    dom.groupTabs.innerHTML = '';
    groups.list
      .filter((groupName) => !groups.pinned.includes(groupName))
      .forEach((groupName) => {
        const tab = document.createElement('button');
        tab.className = 'tab' + (groupName === selectedGroup ? ' active' : '');
        tab.textContent = groupName;
        tab.dataset.groupName = groupName;
        tab.classList.add('group-context-target');
        tab.draggable = isEditMode();
        dom.groupTabs.appendChild(tab);
      });

    if (isEditMode()) {
      const addTab = document.createElement('button');
      addTab.className = 'tab tab-add-group';
      addTab.type = 'button';
      addTab.textContent = '+';
      addTab.dataset.action = 'add-group';
      dom.groupTabs.appendChild(addTab);
    }

    dom.selectedGrid.innerHTML = '';
    dom.selectedGrid.dataset.group = selectedGroup || '';
    getLinksForGroup(selectedGroup).forEach((link) => {
      dom.selectedGrid.appendChild(createLinkEl(link));
    });
  }

  return {
    applySettings,
    render
  };
}
