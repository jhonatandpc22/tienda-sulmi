import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

export function loadApp(path = new URL('../index.html', import.meta.url)) {
  const html = readFileSync(path, 'utf8');
  const dom = new JSDOM(html, { url: 'https://sulmi.test', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const frames = new Map();
  let sequence = 0;
  w.requestAnimationFrame = fn => { frames.set(++sequence, fn); return sequence; };
  w.cancelAnimationFrame = id => frames.delete(id);
  if (html.includes('assets/business-support.js')) {
    w.eval(readFileSync(new URL('../assets/business-support.js', import.meta.url), 'utf8'));
  }
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  let source = scripts.at(-1)[1];
  source = source.slice(0, source.indexOf('// Renderizado inicial sin bloqueos'));
  w.eval(source);
  w.appConfig = { tarjetaMargin: 5, categories: [], families: [] };
  w.inventory = []; w.cart = []; w.salesHistory = []; w.gastosHistory = [];
  w.envaseLedger = { sales: [], returns: [], salesLoaded: false, returnsLoaded: false };
  return {
    w, dom,
    frame() { const queue = [...frames.values()]; frames.clear(); queue.forEach(fn => fn()); },
    close() { dom.window.close(); },
  };
}

export const product = (id, extra = {}) => ({
  id: String(id), name: `Producto ${id}`, size: '500 ml', category: 'bebidas', family: '',
  price: 6, unitPrice: 6, cost: 3, stock: 100, minStock: 5, isGroup: false,
  unitsPerGroup: 6, hasEnvase: true, envasePrice: 1, color: 'bg-indigo-500/20', ...extra,
});

export const sale = (id, p, qty, price = 1, date = '2026-01-01') => ({
  id: String(id), type: 'POS', date: new Date(date),
  items: [{ product: { ...p, envasePrice: price }, qty, type: 'unit', withEnvase: true }],
});
