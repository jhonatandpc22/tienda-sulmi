import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';

const root = new URL('../', import.meta.url);

export const product = (overrides = {}) => ({
  id: 'drink', name: 'Gaseosa', category: 'Bebidas', family: '', size: 'Unidad',
  price: 5, cost: 2, stock: 20, minStock: 2, isGroup: false, hasEnvase: false,
  color: 'bg-sky-700/20 text-sky-500', _collection: 'inventory', ...overrides,
});

/** Actual application functions and IndexedDB adapter; only animation/render work is stubbed. */
export async function createBusinessHarness(seed = {}, options = {}) {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const dom = new JSDOM(html.replace(/<script\b[\s\S]*?<\/script>/gi, ''), {
    url: 'https://sulmi.test/', runScripts: 'outside-only', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  const w = dom.window;
  w.indexedDB = options.indexedDB || new IDBFactory();
  w.structuredClone = structuredClone;
  w.fetch = () => { throw new Error('Business tests must never access the network'); };
  w.lucide = { createIcons() {} };
  w.scrollTo = () => {};
  const normalAdd = w.document.addEventListener.bind(w.document);
  w.document.addEventListener = (name, callback, ...rest) => {
    if (name !== 'DOMContentLoaded') normalAdd(name, callback, ...rest);
  };
  const main = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .find(match => match[2].includes('async function processCheckout'));
  if (!main) throw new Error('Application business script was not found');
  // The production adapter is a local classic script, with no Firebase imports in local mode.
  for (const match of html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi)) {
    if (!/^https?:/.test(match[1]) && /\.js$/.test(match[1]) && !/lucide/.test(match[1])) {
      w.eval(await readFile(new URL(match[1].replace(/^\.\//, ''), root), 'utf8'));
    }
  }
  w.eval(main[2] + (options.remoteHooks ? `
    window.__setTestRemoteReady = value => { firebaseReady = value; };
    window.__stopTestRemoteListeners = () => firebaseUnsubscribers.splice(0).forEach(fn => fn());
  ` : ''));
  const messages = [];
  w.showModal = (title, body) => messages.push({ title, body });
  const rendered = { calls: 0 };
  for (const name of ['renderActiveViewOnly', 'renderPosProducts', 'renderAlmacen', 'renderCreditos',
    'renderCaja', 'renderServiciosAnalysis', 'renderServiciosHistory', 'renderDetallesAnalysis',
    'renderDetallesProducts', 'renderPaperInventory', 'updateIcons']) {
    w[name] = () => { rendered.calls += 1; };
  }
  const fixture = {
    inventory: [product()], paperInventory: [], detallesInventory: [], salesHistory: [],
    gastosHistory: [], creditos: [], auditLog: [], vendedores: [{ name: 'Ana', start: '', end: '' }],
    currentVendedor: 'Ana', currentIdCounter: 10, hasFetchedHistory: true, ...seed,
  };
  w.localStorage.setItem('pos_cache_licoreria-sul-pos', JSON.stringify(fixture));
  await w.loadDataLocally();
  if (w.ensureLocalWritesReady) await w.ensureLocalWritesReady();
  if (!w.fs || !w.db || !w.userId) throw new Error('Durable local adapter did not initialize');
  let confirmation;
  w.showConfirmModal = (_title, _message, action) => { confirmation = action; };
  const element = id => {
    const node = w.document.getElementById(id);
    if (!node) throw new Error(`Missing real form element: ${id}`);
    return node;
  };
  const value = (id, text) => {
    const node = element(id);
    if (node.tagName === 'SELECT' && ![...node.options].some(option => option.value === String(text))) {
      node.add(new w.Option(String(text), String(text)));
    }
    node.value = String(text);
  };
  return {
    dom, w, element, value, messages, rendered,
    stock: id => w.inventory.find(p => p.id === id).stock,
    cart(qty = 1, id = 'drink', type = 'unit', extra = {}) {
      w.cart = [{ product: structuredClone(w.inventory.find(p => p.id === id)), qty, type, withEnvase: false, ...extra }];
      w.updateCartUI();
    },
    async confirm() {
      if (!confirmation) throw new Error('Application did not request confirmation');
      const action = confirmation; confirmation = null; await action();
    },
    async close() {
      w.__stopTestRemoteListeners?.();
      if (w.flushLocalCache) await w.flushLocalCache();
      if (w.sulmiLocalSync?.close) await w.sulmiLocalSync.close();
      dom.window.close();
    },
  };
}
