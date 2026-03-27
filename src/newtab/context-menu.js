export function bindContextMenu(deps) {
    const {
        documentRef,
        contextMenu,
        getSelectedGroup,
        getGroups,
        showContextMenu,
        hideContextMenu,
        setContextMenuMode,
        setContextLinkId,
        getContextLinkId,
        setLinks,
        getLinks,
        saveData,
        render,
        openModal,
        togglePinGroup,
        deleteGroup
    } = deps;

    let touchTimer = null;
    let touchMoved = false;
    let lastTouchTarget = null;
    let openedFromTouch = false;
    const addLinkButton = contextMenu.querySelector('[data-action="add-link"]');
    const pinGroupButton = contextMenu.querySelector('[data-action="pin-group"]');
    const deleteGroupButton = contextMenu.querySelector('[data-action="delete-group"]');

    function getPoint(event) {
        if (event.touches && event.touches[0]) return event.touches[0];
        if (event.changedTouches && event.changedTouches[0]) return event.changedTouches[0];
        return event;
    }

    function updateMenuForInputMode() {
        if (!addLinkButton) return;
        if (openedFromTouch) {
            addLinkButton.classList.add('hidden');
        } else {
            addLinkButton.classList.remove('hidden');
        }
    }

    function resolveGroupFromTarget(target) {
        let group = getSelectedGroup();
        const gridEl = target.closest('.links-grid[data-group]');
        const groups = getGroups();
        if (gridEl && groups.pinned.includes(gridEl.dataset.group)) {
            group = gridEl.dataset.group;
        }
        return group;
    }

    function clearTouchTimer() {
        if (touchTimer) {
            clearTimeout(touchTimer);
            touchTimer = null;
        }
    }

    documentRef.addEventListener('contextmenu', e => {
        const groupTarget = e.target.closest('.group-context-target');
        if (groupTarget && !e.target.closest('.context-menu') && !e.target.closest('.modal') && !e.target.closest('.settings-modal')) {
            e.preventDefault();
            openedFromTouch = false;
            updateMenuForInputMode();
            setContextMenuMode('group');
            showContextMenu(e.pageX, e.pageY, null, groupTarget.dataset.groupName);
            return;
        }

        if (!e.target.closest('.link-item') && !e.target.closest('.context-menu') && !e.target.closest('.modal') && !e.target.closest('.settings-modal')) {
            e.preventDefault();
            openedFromTouch = false;
            updateMenuForInputMode();
            setContextMenuMode('general');
            showContextMenu(e.pageX, e.pageY, null, resolveGroupFromTarget(e.target));
        }
    });

    documentRef.addEventListener('touchstart', e => {
        const target = e.target;
        if (target.closest('.context-menu') || target.closest('.modal') || target.closest('.settings-modal') || target.closest('.link-item')) {
            return;
        }

        touchMoved = false;
        lastTouchTarget = target;
        const point = getPoint(e);
        const startX = point.clientX;
        const startY = point.clientY;

        clearTouchTimer();
        touchTimer = setTimeout(() => {
            const currentTarget = documentRef.elementFromPoint(startX, startY) || lastTouchTarget;
            if (!currentTarget || currentTarget.closest('.context-menu') || currentTarget.closest('.modal') || currentTarget.closest('.settings-modal') || currentTarget.closest('.link-item')) {
                return;
            }
            touchTimer = null;
            openedFromTouch = true;
            updateMenuForInputMode();
            const groupTarget = currentTarget.closest('.group-context-target');
            if (groupTarget) {
                setContextMenuMode('group');
                showContextMenu(startX, startY, null, groupTarget.dataset.groupName);
                return;
            }
            setContextMenuMode('general');
            showContextMenu(startX, startY, null, resolveGroupFromTarget(currentTarget));
        }, 450);
    }, { passive: true });

    documentRef.addEventListener('touchmove', e => {
        if (!touchTimer) return;
        const point = getPoint(e);
        const currentTarget = documentRef.elementFromPoint(point.clientX, point.clientY);
        if (currentTarget !== lastTouchTarget) {
            touchMoved = true;
            clearTouchTimer();
        }
    }, { passive: true });

    documentRef.addEventListener('touchend', () => {
        clearTouchTimer();
    }, { passive: true });

    documentRef.addEventListener('touchcancel', clearTouchTimer, { passive: true });

    documentRef.addEventListener('click', e => {
        if (!contextMenu.contains(e.target)) hideContextMenu();
    });

    addLinkButton.addEventListener('click', () => {
        hideContextMenu();
        openModal('add-link', null, getSelectedGroup());
    });

    contextMenu.querySelector('[data-action="add-group"]').addEventListener('click', () => {
        hideContextMenu();
        openModal('add-group');
    });

    pinGroupButton.addEventListener('click', () => {
        const group = getSelectedGroup();
        hideContextMenu();
        if (group) togglePinGroup(group);
    });

    deleteGroupButton.addEventListener('click', () => {
        const group = getSelectedGroup();
        hideContextMenu();
        if (group) deleteGroup(group);
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
