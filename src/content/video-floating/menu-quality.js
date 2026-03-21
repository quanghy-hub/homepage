import { clamp, el } from './utils.js';

export function toggleMenu({ icon, menu, innerWidth, innerHeight, resetIdle, renderMenu }) {
    resetIdle();
    const show = menu.style.display !== 'flex';
    menu.style.display = show ? 'flex' : 'none';
    if (show) {
        const rect = icon.getBoundingClientRect();
        menu.style.left = `${clamp(rect.left, 10, innerWidth - 290)}px`;
        menu.style.top = innerHeight - rect.bottom < 300 ? 'auto' : `${rect.bottom + 10}px`;
        menu.style.bottom = innerHeight - rect.bottom < 300 ? `${innerHeight - rect.top + 10}px` : 'auto';
        renderMenu();
    }
}

export function renderResPopup({ popup, levels, onSelect }) {
    if (!popup) return;
    popup.innerHTML = '';
    if (!levels.length) {
        const noItem = el('div', 'fvp-res-item', 'N/A');
        noItem.style.opacity = '0.5';
        popup.appendChild(noItem);
    } else {
        levels.forEach(level => {
            const item = el('div', `fvp-res-item${level.active ? ' active' : ''}`, level.label);
            item.onclick = event => {
                event.stopPropagation();
                onSelect(level);
            };
            popup.appendChild(item);
        });
    }
    popup.style.display = 'flex';
}
