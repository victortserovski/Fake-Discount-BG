const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const clone = structuredClone;

function harness(initial = {}, hooks = {}) {
  const state = clone(initial), listeners = [], badges = [], updates = [];
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} }, URL, Date, Promise, Map, Set,
    Uint8Array, TextEncoder, AbortSignal, crypto: webcrypto, setTimeout, clearTimeout,
    navigator: { userAgent: 'regression-test' },
    fetch: (...args) => { if (!hooks.fetch) throw Error('Network prohibited'); return hooks.fetch(...args); },
    chrome: {
      alarms: { onAlarm: { addListener() {} }, get: async () => undefined, create: async () => {} },
      storage: { local: {
        async get(keys) {
          const value = keys === null ? clone(state) : Object.fromEntries(keys.filter(k => Object.hasOwn(state, k)).map(k => [k, clone(state[k])]));
          await hooks.get?.(keys, value);
          return value;
        },
        async set(data) { const value = clone(data); await hooks.set?.(value); Object.assign(state, value); },
        async remove(keys) { await hooks.remove?.(keys); keys.forEach(k => delete state[k]); }
      } },
      runtime: {
        id: 'test', getURL: p => 'chrome-extension://test/' + p,
        getManifest: () => JSON.parse(read('manifest.json')),
        onMessage: { addListener: fn => listeners.push(fn) }
      },
      tabs: { onUpdated: { addListener: fn => updates.push(fn) }, sendMessage: async () => {} },
      action: { setBadgeText: async args => badges.push(args), setBadgeBackgroundColor: async () => {} }
    }
  });
  context.self = context;
  const load = p => vm.runInContext(read(p), context, { filename: p });
  context.importScripts = url => load(url.replace('chrome-extension://test/', ''));
  return { state, context, load, badges, updates,
    send: (request, sender = { url: 'chrome-extension://test/popup/popup.html' }) => new Promise(resolve => listeners[0](request, sender, resolve)) };
}

const observation = (price = 10, id = 'a') => ({ url: 'https://www.ozone.bg/product/' + id + '/', site: 'ozone', title: id, price });
const product = (price = 10, id = 'a') => ({ ...observation(price, id), history: [{ date: '2026-09-01', price }], isActive: true });
module.exports = { harness, observation, product, root, read };
