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

    let touchTimer = null;
    let touchMoved = false;
    let lastTouchTarget = null;

    function getPoint(event) {
        if (event.touches && event.touches[0]) return event.touches[0];
        if (event.changedTouches && event.changedTouches[0]) return event.changedTouches[0];
        return event;
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
        if (!e.target.closest('.link-item') && !e.target.closest('.context-menu') && !e.target.closest('.modal') && !e.target.closest('.settings-modal')) {
            e.preventDefault();
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
