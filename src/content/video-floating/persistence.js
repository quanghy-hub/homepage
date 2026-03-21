import { STORAGE_KEY_ICON, STORAGE_KEY_LAYOUT } from './constants.js';

export function saveLayout(box) {
    if (!box || box.style.display === 'none') return;
    try {
        localStorage.setItem(STORAGE_KEY_LAYOUT, JSON.stringify({
            top: box.style.top,
            left: box.style.left,
            width: box.style.width,
            height: box.style.height,
            borderRadius: box.style.borderRadius
        }));
    } catch (e) { }
}

export function loadLayout() {
    try {
        const data = JSON.parse(localStorage.getItem(STORAGE_KEY_LAYOUT));
        if (data && data.width && data.height) return data;
    } catch (e) { }
    return null;
}

export function saveIconPos(icon) {
    if (!icon) return;
    try {
        localStorage.setItem(STORAGE_KEY_ICON, JSON.stringify({
            top: icon.style.top,
            left: icon.style.left
        }));
    } catch (e) { }
}

export function loadIconPos() {
    try {
        const data = JSON.parse(localStorage.getItem(STORAGE_KEY_ICON));
        if (data && data.top && data.left) return data;
    } catch (e) { }
    return null;
}
