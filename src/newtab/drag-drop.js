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
  let touchDrag = null;

  function clearDragOver() {
    document.querySelectorAll('.drag-over').forEach(node => node.classList.remove('drag-over'));
  }

  function getTouchDropTarget(touch) {
    if (!touch) return null;
    return document.elementFromPoint(touch.clientX, touch.clientY);
  }

  function getTouchDragCandidate(target) {
    const header = target.closest('.pinned-group-header');
    if (header) {
      return {
        el: header,
        id: header.dataset.groupName,
        startClass: 'dragging-group-header',
        type: 'pinned-group'
      };
    }

    const tab = target.closest('#group-tabs .tab');
    if (tab && !tab.classList.contains('tab-add-group')) {
      return {
        el: tab,
        id: tab.dataset.groupName,
        startClass: 'dragging-group',
        type: 'group'
      };
    }

    const item = target.closest('.link-item');
    if (!item) return null;

    return {
      el: item,
      id: item.dataset.id,
      parent: item.dataset.parent,
      startClass: 'dragging',
      type: 'link'
    };
  }

  function markTouchDragOver(target) {
    clearDragOver();
    if (!touchDrag || !target) return;

    if (touchDrag.type === 'pinned-group') {
      const header = target.closest('.pinned-group-header');
      if (header && header.dataset.groupName !== touchDrag.id) {
        header.classList.add('drag-over');
      }
      return;
    }

    if (touchDrag.type === 'group') {
      const tab = target.closest('#group-tabs .tab');
      if (tab && !tab.classList.contains('tab-add-group') && tab.dataset.groupName !== touchDrag.id) {
        tab.classList.add('drag-over');
      }
      return;
    }

    const item = target.closest('.link-item');
    if (item && item.dataset.id !== touchDrag.id) {
      item.classList.add('drag-over');
    }
  }

  function finishTouchDrag(target) {
    if (!touchDrag || !touchDrag.active || !target) return;

    if (touchDrag.type === 'pinned-group') {
      const header = target.closest('.pinned-group-header');
      if (header && header.dataset.groupName !== touchDrag.id) {
        reorderPinnedGroup(touchDrag.id, header.dataset.groupName);
      }
      return;
    }

    if (touchDrag.type === 'group') {
      const tab = target.closest('#group-tabs .tab');
      if (tab && !tab.classList.contains('tab-add-group') && tab.dataset.groupName !== touchDrag.id) {
        reorderGroup(touchDrag.id, tab.dataset.groupName);
      }
      return;
    }

    const item = target.closest('.link-item');
    if (item) {
      if (item.dataset.id !== touchDrag.id) {
        reorderLink(touchDrag.id, item.dataset.id, item.dataset.parent);
      }
      return;
    }

    const grid = target.closest('.links-grid[data-group]');
    if (!grid) return;

    const dragged = getLinks().find(link => link._id === touchDrag.id);
    if (!dragged) return;

    const sourceGroup = dragged.parent;
    const targetGroup = grid.dataset.group;
    const targetLinks = getLinksForGroup(targetGroup).filter(link => link._id !== touchDrag.id);
    dragged.parent = targetGroup;
    dragged.order = targetLinks.length;
    normalizeGroupOrders(sourceGroup, targetGroup);
    saveData();
    render();
  }

  document.addEventListener('touchstart', e => {
    if (!isEditMode() || e.touches.length !== 1) return;

    const candidate = getTouchDragCandidate(e.target);
    if (!candidate) return;

    const touch = e.touches[0];
    touchDrag = {
      ...candidate,
      active: false,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY
    };
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!touchDrag || e.touches.length !== 1) return;

    const touch = e.touches[0];
    touchDrag.lastX = touch.clientX;
    touchDrag.lastY = touch.clientY;

    const dx = Math.abs(touch.clientX - touchDrag.startX);
    const dy = Math.abs(touch.clientY - touchDrag.startY);
    if (!touchDrag.active && dx < 8 && dy < 8) return;

    if (!touchDrag.active) {
      touchDrag.active = true;
      touchDrag.el.classList.add(touchDrag.startClass);
    }

    e.preventDefault();
    markTouchDragOver(getTouchDropTarget(touch));
  }, { passive: false });

  document.addEventListener('touchend', e => {
    if (!touchDrag) return;

    const dropTouch = e.changedTouches[0] || { clientX: touchDrag.lastX, clientY: touchDrag.lastY };
    const dropTarget = getTouchDropTarget(dropTouch);
    const wasActive = touchDrag.active;

    if (wasActive) {
      e.preventDefault();
      finishTouchDrag(dropTarget);
    }

    touchDrag.el.classList.remove(touchDrag.startClass);
    clearDragOver();
    touchDrag = null;
  }, { passive: false });

  document.addEventListener('touchcancel', () => {
    if (!touchDrag) return;
    touchDrag.el.classList.remove(touchDrag.startClass);
    clearDragOver();
    touchDrag = null;
  }, { passive: true });

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
    clearDragOver();
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
        clearDragOver();
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
        clearDragOver();
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
    clearDragOver();
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
        clearDragOver();
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
        clearDragOver();
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
    clearDragOver();
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
