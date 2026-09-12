import { performance } from 'node:perf_hooks';
import { loadApp, product, sale } from '../tests/render-fixture.mjs';
const originalPath = process.argv[2];
if (!originalPath) throw new Error('Uso: node scripts/benchmark-render.mjs /ruta/index-original.html');

function benchmark(path) {
  const app = loadApp(path), { w } = app;
  const products = Array.from({ length: 300 }, (_, i) => product(i + 1));
  w.inventory = products;
  let scannedSales = 0;
  w.salesHistory = Array.from({ length: 12000 }, (_, i) => {
    const entry = sale(i, products[i % products.length], 1);
    const items = entry.items;
    Object.defineProperty(entry, 'items', { get() { scannedSales++; return items; } });
    return entry;
  });
  const ledgerStart = performance.now();
  const pending = products.reduce((total, p) => total + w.getPendingEnvaseLots(p).pending, 0);
  const ledgerMs = performance.now() - ledgerStart;
  w.inventory = products.slice(0, 100);
  w.renderPosProducts(); app.frame();
  const initialNodes = [...w.document.getElementById('productsGrid').children];
  const cartStart = performance.now();
  for (let i = 0; i < 12; i++) w.addToCart('1');
  const cartMs = performance.now() - cartStart;
  const stableUnrelatedCards = initialNodes.slice(1).filter(node => node.isConnected).length;
  app.close();
  return { products: products.length, sales: 12000, pending, ledgerItemReads: scannedSales, ledgerMs: +ledgerMs.toFixed(2), cartProducts: 100, cartTaps: 12, cartMs: +cartMs.toFixed(2), stableUnrelatedCards };
}
console.log(JSON.stringify({ original: benchmark(originalPath), optimized: benchmark(new URL('../index.html', import.meta.url)), environment: 'Node + JSDOM; datos ficticios; sin red; tiempo CPU/DOM, no latencia Firebase' }, null, 2));
