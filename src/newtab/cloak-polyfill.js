/**
 * Polyfill for mobile Chromium forks that inject CloakJavaScriptBridge
 * (Cốc Cốc, Quetta, Kiwi và các fork khác).
 *
 * Quetta/Cốc Cốc trên Android inject `window.CloakJavaScriptBridge` vào mọi
 * trang. Ở một số bản object tồn tại nhưng `setMediaContentSettingsAllowed`
 * bị thiếu. Script của browser tự gọi:
 *   window?.CloakJavaScriptBridge?.setMediaContentSettingsAllowed()
 * optional chain trả về `undefined` rồi gọi `undefined()` nên throw
 * "is not a function". Chrome gom lỗi uncaught trên `chrome://newtab/`
 * và hiển thị ở `Tiện ích -> Lỗi` như screenshot `src/newtab/index.html:1`.
 *
 * File này phải load TRƯỚC mọi script khác (và trước content script
 * mà browser inject nếu có thể). Nó:
 *  1. Ensures `window.CloakJavaScriptBridge` always exposes
 *     `setMediaContentSettingsAllowed` as a no-op function.
 *  2. Wraps the bridge in a Proxy so any future missing method also
 *     degrades to a no-op instead of throwing.
 *  3. Intercepts future assignments to `window.CloakJavaScriptBridge` via
 *     a getter/setter, so a late injection by the browser is patched too.
 *  4. Suppresses `error` / `unhandledrejection` events that contain the
 *     bridge name, so the `chrome://extensions` error badge does not appear.
 */
(() => {
  'use strict';

  const stub = () => {};
  const PATCHED = '__cloakPatched';

  function ensureBridge(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    try {
      if (obj[PATCHED]) return obj;
    } catch {
      // ignore
    }
    try {
      if (typeof obj.setMediaContentSettingsAllowed !== 'function') {
        obj.setMediaContentSettingsAllowed = stub;
      }
    } catch {
      // read-only object, will be handled by Proxy below
    }
    try {
      const proxied = new Proxy(obj, {
        get(target, prop, receiver) {
          if (prop === PATCHED) return true;
          const val = Reflect.get(target, prop, receiver);
          if (typeof val === 'function') return val.bind(target);
          if (prop in target) return val;
          if (typeof prop === 'string') return stub;
          return val;
        }
      });
      try {
        proxied[PATCHED] = true;
      } catch {
        // ignore
      }
      return proxied;
    } catch {
      try {
        obj[PATCHED] = true;
      } catch {
        // ignore
      }
      return obj;
    }
  }

  let stored = null;
  const existing = window.CloakJavaScriptBridge;
  if (existing) {
    stored = ensureBridge(existing);
  } else {
    stored = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === PATCHED) return true;
          return stub;
        }
      }
    );
  }

  try {
    Object.defineProperty(window, 'CloakJavaScriptBridge', {
      configurable: true,
      enumerable: true,
      get() {
        return stored;
      },
      set(val) {
        stored = ensureBridge(val) || val;
      }
    });
  } catch {
    window.CloakJavaScriptBridge = stored;
  }

  window.addEventListener(
    'error',
    (e) => {
      const msg = `${e.message || ''} ${e.error && e.error.message ? e.error.message : ''}`;
      if (msg.includes('CloakJavaScriptBridge') || msg.includes('setMediaContentSettingsAllowed')) {
        e.preventDefault();
      }
    },
    true
  );

  window.addEventListener('unhandledrejection', (e) => {
    const msg = String((e.reason && e.reason.message) || e.reason || '');
    if (msg.includes('CloakJavaScriptBridge') || msg.includes('setMediaContentSettingsAllowed')) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
    }
  });

  const patchLater = () => {
    try {
      const bridge = window.CloakJavaScriptBridge;
      if (bridge && typeof bridge.setMediaContentSettingsAllowed !== 'function') {
        bridge.setMediaContentSettingsAllowed = stub;
      }
    } catch {
      // ignore
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchLater);
  }
  setTimeout(patchLater, 0);
  setTimeout(patchLater, 100);
})();
