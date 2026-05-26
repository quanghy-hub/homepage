export function bindEditModeActivation({ enterEditMode, exitEditMode, isEditMode, isTouchDevice }) {
    let longPressTimer = null;
    let longPressStartX = 0;
    let longPressStartY = 0;
    let longPressTarget = null;
    let longPressConsumed = false;

    function canStartLongPress(target) {
        return !!target &&
            !target.closest('.modal') &&
            !target.closest('.settings-modal') &&
            !target.closest('#settings-btn');
    }

    function triggerLongPressTarget() {
        const linkEl = longPressTarget?.closest('.link-item');
        const groupEl = longPressTarget?.closest('.group-context-target');
        const mainEl = longPressTarget?.closest('#main-container');
        if (!linkEl && !groupEl && !mainEl) return;

        longPressConsumed = true;
        if (isEditMode()) {
            exitEditMode();
        } else {
            enterEditMode();
        }
    }

    function startLongPress(target, clientX, clientY, delay) {
        if (!canStartLongPress(target)) return;
        longPressStartX = clientX;
        longPressStartY = clientY;
        longPressTarget = target;
        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(triggerLongPressTarget, delay);
    }

    function cancelLongPress() {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        longPressTarget = null;
    }

    function cancelLongPressOnMove(clientX, clientY) {
        if (!longPressTimer) return;
        const dx = Math.abs(clientX - longPressStartX);
        const dy = Math.abs(clientY - longPressStartY);
        if (dx > 10 || dy > 10) {
            cancelLongPress();
        }
    }

    document.addEventListener('click', e => {
        if (!longPressConsumed) return;
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => {
            longPressConsumed = false;
        }, 0);
    }, true);

    document.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        startLongPress(e.target, touch.clientX, touch.clientY, isTouchDevice ? 380 : 480);
    }, { passive: true });

    document.addEventListener('touchmove', e => {
        if (!longPressTimer || e.touches.length !== 1) return;
        const touch = e.touches[0];
        cancelLongPressOnMove(touch.clientX, touch.clientY);
    }, { passive: true });

    const clearLongPress = () => {
        cancelLongPress();
        setTimeout(() => {
            longPressConsumed = false;
        }, 450);
    };
    document.addEventListener('touchend', clearLongPress, { passive: true });
    document.addEventListener('touchcancel', clearLongPress, { passive: true });

    document.addEventListener('mousedown', e => {
        if (e.button !== 0 || isTouchDevice) return;
        startLongPress(e.target, e.clientX, e.clientY, 480);
    });

    document.addEventListener('mousemove', e => {
        if (isTouchDevice) return;
        cancelLongPressOnMove(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', () => {
        if (isTouchDevice) return;
        cancelLongPress();
    });
}
