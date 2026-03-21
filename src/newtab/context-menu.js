export function bindContextMenu(deps) {
    const {
        documentRef,
        contextMenu,
        getSelectedGroup,
        getGroups,
        showContextMenu,
        hideContextMenu,
        setContextLinkId,
        getContextLinkId,
        setLinks,
        getLinks,
        saveData,
        render,
        openModal
    } = deps;

    documentRef.addEventListener('contextmenu', e => {
        if (!e.target.closest('.link-item') && !e.target.closest('.context-menu') && !e.target.closest('.modal') && !e.target.closest('.settings-modal')) {
            e.preventDefault();
            let group = getSelectedGroup();
            const pinnedEl = e.target.closest('.links-grid[data-group]');
            const groups = getGroups();
            if (pinnedEl && groups.pinned.includes(pinnedEl.dataset.group)) {
                group = pinnedEl.dataset.group;
            }
            showContextMenu(e.pageX, e.pageY, null, group);
        }
    });

    documentRef.addEventListener('click', e => {
        if (!contextMenu.contains(e.target)) hideContextMenu();
    });

    contextMenu.querySelector('[data-action="add-link"]').addEventListener('click', () => {
        hideContextMenu();
        openModal('add-link', null, getSelectedGroup());
    });

    contextMenu.querySelector('[data-action="add-group"]').addEventListener('click', () => {
        hideContextMenu();
        openModal('add-group');
    });

    contextMenu.querySelector('[data-action="edit"]').addEventListener('click', () => {
        const link = getLinks().find(l => l._id === getContextLinkId());
        if (!link) return;
        hideContextMenu();
        openModal('edit-link', link);
    });

    contextMenu.querySelector('[data-action="delete"]').addEventListener('click', () => {
        setLinks(getLinks().filter(l => l._id !== getContextLinkId()));
        setContextLinkId(null);
        hideContextMenu();
        saveData();
        render();
    });
}
