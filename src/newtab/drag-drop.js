export function bindDragDrop({
  getLinks,
  getLinksForGroup,
  isEditMode,
  normalizeGroupOrders,
  render,
  reorderLink,
  reorderGroup,
  reorderPinnedGroup,
  saveData
}) {
  document.addEventListener('dragstart', e => {
    if (!isEditMode()) {
      e.preventDefault();
      return;
    }

    // Pinned group headers
    const header = e.target.closest('.pinned-group-header');
    if (header) {
      header.classList.add('dragging-group-header');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/pinned-group-name', header.dataset.groupName);
      return;
    }

    // Group tabs
    const tab = e.target.closest('#group-tabs .tab');
    if (tab && !tab.classList.contains('tab-add-group')) {
      tab.classList.add('dragging-group');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/group-name', tab.dataset.groupName);
      return;
    }

    // Link items
    const item = e.target.closest('.link-item');
    if (!item) return;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.dataset.id);
    e.dataTransfer.setData('application/group', item.dataset.parent);
  });

  document.addEventListener('dragend', e => {
    const header = e.target.closest('.pinned-group-header');
    if (header) {
      header.classList.remove('dragging-group-header');
    }
    const tab = e.target.closest('#group-tabs .tab');
    if (tab) {
      tab.classList.remove('dragging-group');
    }
    const item = e.target.closest('.link-item');
    item?.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(node => node.classList.remove('drag-over'));
  });

  document.addEventListener('dragover', e => {
    if (!isEditMode()) return;

    // Check if dragging pinned group header
    const header = e.target.closest('.pinned-group-header');
    if (header) {
      const draggingPinned = document.querySelector('.pinned-group-header.dragging-group-header');
      if (draggingPinned) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.drag-over').forEach(node => node.classList.remove('drag-over'));
        if (draggingPinned.dataset.groupName !== header.dataset.groupName) {
          header.classList.add('drag-over');
        }
        return;
      }
    }

    // Check if dragging group tab
    const tab = e.target.closest('#group-tabs .tab');
    if (tab && !tab.classList.contains('tab-add-group')) {
      const draggingGroup = document.querySelector('#group-tabs .tab.dragging-group');
      if (draggingGroup) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.drag-over').forEach(node => node.classList.remove('drag-over'));
        if (draggingGroup.dataset.groupName !== tab.dataset.groupName) {
          tab.classList.add('drag-over');
        }
        return;
      }
    }

    // Check if dragging links
    const item = e.target.closest('.link-item');
    const grid = e.target.closest('.links-grid');
    if (!item && !grid) return;

    const draggingGroup = document.querySelector('#group-tabs .tab.dragging-group');
    const draggingPinned = document.querySelector('.pinned-group-header.dragging-group-header');
    if (draggingGroup || draggingPinned) return; // Prevent group dragging on links

    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.drag-over').forEach(node => node.classList.remove('drag-over'));
    if (item) {
      const dragging = document.querySelector('.link-item.dragging');
      if (dragging && dragging.dataset.id !== item.dataset.id) {
        item.classList.add('drag-over');
      }
    }
  });

  document.addEventListener('dragleave', e => {
    const header = e.target.closest('.pinned-group-header');
    if (header) {
      header.classList.remove('drag-over');
      return;
    }
    const tab = e.target.closest('#group-tabs .tab');
    if (tab) {
      tab.classList.remove('drag-over');
      return;
    }
    const item = e.target.closest('.link-item');
    item?.classList.remove('drag-over');
  });

  document.addEventListener('drop', e => {
    if (!isEditMode()) return;

    // Handle dropped pinned group header
    const header = e.target.closest('.pinned-group-header');
    if (header) {
      const draggedPinnedName = e.dataTransfer.getData('text/pinned-group-name');
      if (draggedPinnedName && draggedPinnedName !== header.dataset.groupName) {
        e.preventDefault();
        document.querySelectorAll('.drag-over').forEach(node => node.classList.remove('drag-over'));
        reorderPinnedGroup(draggedPinnedName, header.dataset.groupName);
        return;
      }
    }

    // Handle dropped group tab
    const tab = e.target.closest('#group-tabs .tab');
    if (tab && !tab.classList.contains('tab-add-group')) {
      const draggedGroupName = e.dataTransfer.getData('text/group-name');
      if (draggedGroupName && draggedGroupName !== tab.dataset.groupName) {
        e.preventDefault();
        document.querySelectorAll('.drag-over').forEach(node => node.classList.remove('drag-over'));
        reorderGroup(draggedGroupName, tab.dataset.groupName);
        return;
      }
    }

    // Handle dropped links
    const item = e.target.closest('.link-item');
    const grid = e.target.closest('.links-grid');
    if (!item && !grid) return;

    const draggedGroupName = e.dataTransfer.getData('text/group-name');
    const draggedPinnedName = e.dataTransfer.getData('text/pinned-group-name');
    if (draggedGroupName || draggedPinnedName) return;

    e.preventDefault();
    document.querySelectorAll('.drag-over').forEach(node => node.classList.remove('drag-over'));
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId) return;

    if (item) {
      if (draggedId !== item.dataset.id) {
        reorderLink(draggedId, item.dataset.id, item.dataset.parent);
      }
      return;
    }

    if (grid && e.target === grid && grid.dataset.group) {
      const dragged = getLinks().find(l => l._id === draggedId);
      if (!dragged) return;
      const sourceGroup = dragged.parent;
      const targetGroup = grid.dataset.group;
      const targetLinks = getLinksForGroup(targetGroup).filter(l => l._id !== draggedId);
      dragged.parent = targetGroup;
      dragged.order = targetLinks.length;
      normalizeGroupOrders(sourceGroup, targetGroup);
      saveData();
      render();
    }
  });
}
