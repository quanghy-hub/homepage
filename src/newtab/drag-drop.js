export function bindDragDrop({
  getLinks,
  getLinksForGroup,
  isEditMode,
  normalizeGroupOrders,
  render,
  reorderLink,
  saveData
}) {
  document.addEventListener('dragstart', e => {
    if (!isEditMode()) {
      e.preventDefault();
      return;
    }
    const item = e.target.closest('.link-item');
    if (!item) return;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.dataset.id);
    e.dataTransfer.setData('application/group', item.dataset.parent);
  });

  document.addEventListener('dragend', e => {
    const item = e.target.closest('.link-item');
    item?.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(node => node.classList.remove('drag-over'));
  });

  document.addEventListener('dragover', e => {
    if (!isEditMode()) return;
    const item = e.target.closest('.link-item');
    const grid = e.target.closest('.links-grid');
    if (!item && !grid) return;
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
    const item = e.target.closest('.link-item');
    item?.classList.remove('drag-over');
  });

  document.addEventListener('drop', e => {
    if (!isEditMode()) return;
    const item = e.target.closest('.link-item');
    const grid = e.target.closest('.links-grid');
    if (!item && !grid) return;
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
