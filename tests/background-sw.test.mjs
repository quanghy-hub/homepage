import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SW_PATH = path.resolve(HERE, '../src/background/index.js');
const swSource = readFileSync(SW_PATH, 'utf8');

/** Builds a desktop-like chrome API stub and a listener registry. */
function makeChrome() {
  const registries = new Map();
  const listeners = (name) => {
    if (!registries.has(name)) registries.set(name, new Set());
    return registries.get(name);
  };

  const chrome = {
    runtime: { getURL: (file) => `chrome-extension://test-id/${file}` },
    storage: { local: { set() {} } },
    tabs: { get: async () => ({ url: 'https://example.com/' }), create() {} },
    action: {}
  };
  chrome.tabs.onActivated = { addListener: (fn) => listeners('tabs.onActivated').add(fn) };
  chrome.tabs.onUpdated = { addListener: (fn) => listeners('tabs.onUpdated').add(fn) };
  chrome.runtime.onMessage = { addListener: (fn) => listeners('runtime.onMessage').add(fn) };
  chrome.action.onClicked = { addListener: (fn) => listeners('action.onClicked').add(fn) };

  return { chrome, listeners };
}

/** Evaluates the worker script in a service-worker-like sandbox. */
function runSw(chromeValue) {
  const context = {
    console,
    Date,
    Promise,
    URL,
    navigator: { userAgent: 'background-sw-test/1.0' },
    fetch: async () => ({ ok: true, blob: async () => ({}) }),
    FileReader: class {
      readAsDataURL() {
        this.result = 'data:image/png;base64,Zm9v';
        this.onloadend?.();
      }
    }
  };
  context.chrome = chromeValue;
  vm.createContext(context);
  vm.runInContext(swSource, context, { filename: 'src/background/index.js' });
  return context;
}

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

test('background worker is a self-contained classic script', () => {
  assert.doesNotMatch(swSource, /^\s*import\s/m);
  assert.doesNotMatch(swSource, /\bimportScripts\s*\(/);
});

test('registers all listeners when chrome APIs are available (desktop)', () => {
  const { chrome, listeners } = makeChrome();
  assert.doesNotThrow(() => runSw(chrome));

  assert.equal(listeners('tabs.onActivated').size, 1);
  assert.equal(listeners('tabs.onUpdated').size, 1);
  assert.equal(listeners('runtime.onMessage').size, 1);
  assert.equal(listeners('action.onClicked').size, 1);
});

test('does not throw when chrome.tabs/action are missing (Android Chromium)', () => {
  const chrome = { runtime: {}, storage: {} };
  assert.doesNotThrow(() => runSw(chrome));
});

test('does not throw when chrome is entirely missing', () => {
  assert.doesNotThrow(() => runSw(undefined));
});

test('fetch-favicon handler still decodes a data URL through FileReader', async () => {
  const { chrome, listeners } = makeChrome();
  runSw(chrome);

  let response = null;
  const handler = [...listeners('runtime.onMessage')][0];
  const returned = handler(
    { type: 'fetch-favicon', urls: ['https://example.com/icon.png'] },
    {},
    (res) => {
      response = res;
    }
  );

  assert.equal(returned, true);
  await wait();

  assert.equal(response.ok, true);
  assert.equal(response.dataUrl, 'data:image/png;base64,Zm9v');
  assert.equal(response.sourceUrl, 'https://example.com/icon.png');
});
