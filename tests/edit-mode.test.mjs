import assert from 'node:assert/strict';
import test from 'node:test';

import { bindEditModeActivation } from '../src/newtab/edit-mode.js';
import { StateStore } from '../src/newtab/state.js';

// Setup minimal DOM mock if running in Node
function createDomMock() {
  const listeners = new Map();
  const classList = new Set();

  globalThis.document = {
    body: {
      classList: {
        add: (cls) => classList.add(cls),
        remove: (cls) => classList.delete(cls),
        toggle: (cls, force) => {
          if (force !== undefined) {
            if (force) classList.add(cls);
            else classList.delete(cls);
          } else {
            if (classList.has(cls)) classList.delete(cls);
            else classList.add(cls);
          }
          return classList.has(cls);
        },
        contains: (cls) => classList.has(cls)
      }
    },
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    }
  };

  return { listeners, classList };
}

test('StateStore setEditMode toggles state and body class', () => {
  const { classList } = createDomMock();
  const store = new StateStore();

  assert.equal(store.isEditMode, false);
  assert.equal(classList.has('edit-mode'), false);

  store.setEditMode(true);
  assert.equal(store.isEditMode, true);
  assert.equal(classList.has('edit-mode'), true);

  store.setEditMode(false);
  assert.equal(store.isEditMode, false);
  assert.equal(classList.has('edit-mode'), false);
});

test('StateStore setSelectedGroup updates active group state', () => {
  createDomMock();
  const store = new StateStore();
  store.setSelectedGroup('GroupA');

  assert.equal(store.selectedGroup, 'GroupA');
  assert.equal(store.groups.selected, 'GroupA');
});

test('bindEditModeActivation registers expected event listeners', () => {
  const { listeners } = createDomMock();
  let editState = false;

  bindEditModeActivation({
    enterEditMode: () => {
      editState = true;
    },
    exitEditMode: () => {
      editState = false;
    },
    isEditMode: () => editState,
    isTouchDevice: false
  });

  assert.ok(listeners.has('mousedown'));
  assert.ok(listeners.has('mousemove'));
  assert.ok(listeners.has('mouseup'));
  assert.ok(listeners.has('dblclick'));
  assert.ok(listeners.has('touchstart'));
  assert.ok(listeners.has('touchend'));
});
