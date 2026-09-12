import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApp, product, sale } from './render-fixture.mjs';

test('a cart change preserves unrelated product nodes and updates available stock', t => {
  const app = loadApp(); t.after(() => app.close()); const { w } = app;
  w.inventory = [product(1, { stock: 1 }), product(2)];
  w.renderPosProducts();
  const unrelated = w.document.getElementById('prod-card-2');
  w.addToCart('1');
  assert.equal(w.cart.length, 1);
  assert.match(w.document.getElementById('prod-card-1').textContent, /Agotado/);
  assert.equal(w.document.getElementById('prod-card-2'), unrelated);
  w.changeCartItemQty(w.cart[0].id, -1);
  assert.match(w.document.getElementById('prod-card-1').textContent, /Stk: 1/);
  assert.equal(w.document.getElementById('prod-card-2'), unrelated);
});

test('snapshot rendering keeps unchanged nodes, updates changed products and respects search', t => {
  const app = loadApp(); t.after(() => app.close()); const { w } = app;
  w.inventory = [product(1), product(2), product(3, { name: 'Envases Vacíos - Vidrio' })];
  w.renderPosProducts();
  const first = w.document.getElementById('prod-card-1');
  w.inventory = w.inventory.map(p => ({ ...p, stock: p.id === '2' ? 45 : p.stock }));
  w.renderPosProducts();
  assert.equal(w.document.getElementById('prod-card-1'), first);
  assert.match(w.document.getElementById('prod-card-2').textContent, /Stk: 45/);
  assert.equal(w.document.getElementById('prod-card-3'), null);
  w.document.getElementById('searchInput').value = 'Producto 2';
  w.renderPosProducts();
  assert.equal(w.document.getElementById('prod-card-1'), null);
  assert.equal(w.document.getElementById('productsGrid').children.length, 1);
  w.document.getElementById('searchInput').value = '';
  w.renderPosProducts();
  assert.equal(w.document.getElementById('productsGrid').children.length, 2);
});

test('editing uses restored original quantities without changing physical stock and respects newer stock snapshots', t => {
  const app = loadApp(); t.after(() => app.close()); const { w } = app;
  w.inventory = [product(1, { stock: 0 })];
  w.getEditingStockAllowance = id => id === '1' ? 2 : 0;
  w.renderPosProducts();
  assert.match(w.document.getElementById('prod-card-1').textContent, /Stk: 2/);
  w.addToCart('1'); w.addToCart('1');
  assert.equal(w.cart[0].qty, 2);
  assert.equal(w.inventory[0].stock, 0);
  w.inventory = [product(1, { stock: 1 })];
  w.changeCartItemQty(w.cart[0].id, 1);
  assert.equal(w.cart[0].qty, 3);
  w.changeCartItemQty(w.cart[0].id, 1);
  assert.equal(w.cart[0].qty, 3);
});

test('package labels match the stored package prices without changing entered amounts', t => {
  const app = loadApp(); t.after(() => app.close()); const { w } = app;
  w.document.getElementById('p_cost').value = '18';
  w.document.getElementById('p_price').value = '25';
  for (const checked of [true, false]) {
    w.document.getElementById('p_isGroup').checked = checked;
    w.toggleGroupInputs();
    const unit = checked ? 'Paquete' : 'Unidad';
    assert.match(w.document.getElementById('p_costLabel').textContent, new RegExp(unit));
    assert.match(w.document.getElementById('p_price').previousElementSibling.textContent, new RegExp(unit));
    assert.equal(w.document.getElementById('p_cost').value, '18');
    assert.equal(w.document.getElementById('p_price').value, '25');
  }
});

test('several subscription notifications render the active view once per frame', t => {
  const app = loadApp(); t.after(() => app.close()); const { w } = app;
  let count = 0;
  w.renderPosProducts = () => count++;
  for (let n = 0; n < 5; n++) w.renderActiveViewOnly();
  assert.equal(count, 0);
  app.frame();
  assert.equal(count, 1);
  w.renderActiveViewOnly();
  w.renderActiveViewOnly('ventas');
  assert.equal(count, 2);
  app.frame();
  assert.equal(count, 2);
});

test('icons are batched and existing SVGs are not replaced on later updates', t => {
  const app = loadApp(); t.after(() => app.close()); const { w } = app;
  const scope = w.document.createElement('div');
  scope.innerHTML = '<i data-lucide="box"></i><svg data-lucide="old"></svg>';
  w.document.body.append(scope);
  const existing = scope.querySelector('svg');
  let calls = 0, converted = 0;
  w.lucide = { createIcons({ nameAttr }) {
    calls++;
    w.document.querySelectorAll(`[${nameAttr}]`).forEach(node => {
      converted++;
      const svg = w.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('data-lucide', node.getAttribute(nameAttr));
      node.replaceWith(svg);
    });
  } };
  w.updateIcons(scope); w.updateIcons(scope); app.frame();
  assert.equal(calls, 1); assert.equal(converted, 1);
  assert.equal(scope.querySelector('[data-lucide="old"]'), existing);
  w.updateIcons(scope); app.frame();
  assert.equal(calls, 1);
});

test('the pinned Lucide build converts new placeholders while retaining existing SVG identity', t => {
  const app = loadApp(); t.after(() => app.close()); const { w } = app;
  w.eval(readFileSync(new URL('../node_modules/lucide/dist/umd/lucide.js', import.meta.url), 'utf8'));
  const scope = w.document.createElement('div');
  scope.innerHTML = '<i id="test-icon" data-lucide="box" class="w-4"></i>';
  w.document.body.append(scope);
  w.updateIcons(scope); app.frame();
  const icon = scope.firstElementChild;
  assert.equal(icon.tagName.toLowerCase(), 'svg');
  assert.equal(icon.id, 'test-icon');
  assert.equal(icon.getAttribute('data-sulmi-icon'), null);
  w.updateIcons(scope); app.frame();
  assert.equal(scope.firstElementChild, icon);
});

test('envase index preserves historical prices, allocated returns and legacy product-name returns', t => {
  const app = loadApp(); t.after(() => app.close()); const { w } = app;
  const p = product(1); w.inventory = [p];
  w.salesHistory = [sale(1, p, 3, 1, '2026-01-01'), sale(2, p, 4, 2, '2026-01-02')];
  w.gastosHistory = [
    { id: 'a', type: 'DEVOLUCION_ENVASE', date: new Date('2026-01-03'), envaseProductId: '1', envaseQty: 2, envaseAllocations: [{ qty: 2, unitPrice: 2 }] },
    { id: 'b', type: 'DEVOLUCION_ENVASE', date: new Date('2026-01-04'), desc: 'Devolución Envases (1x Producto 1)' },
  ];
  const result = w.getPendingEnvaseLots(p);
  assert.equal(result.pending, 4);
  assert.equal(JSON.stringify(result.lots.map(l => [l.qty, l.unitPrice])), '[[2,1],[2,2]]');
  assert.equal(w.calculateEnvaseRefund('1', 3).total, 4);
  result.lots[0].qty = 99;
  assert.equal(w.getPendingEnvaseLots(p).pending, 4);
  assert.equal(w.getPendingEnvaseLots(p).lots[0].qty, 2);
});

test('envase index refreshes after append, same-size replacement, local edit and full-ledger switch', t => {
  const app = loadApp(); t.after(() => app.close()); const { w } = app;
  const p = product(1); w.inventory = [p]; w.salesHistory = [sale(1, p, 2)];
  assert.equal(w.getPendingEnvaseLots(p).pending, 2);
  w.salesHistory.push(sale(2, p, 3));
  assert.equal(w.getPendingEnvaseLots(p).pending, 5);
  w.salesHistory = [sale(1, p, 4), sale(2, p, 3)];
  assert.equal(w.getPendingEnvaseLots(p).pending, 7);
  w.salesHistory[0].items[0].qty = 6;
  w.invalidateEnvaseIndex();
  assert.equal(w.getPendingEnvaseLots(p).pending, 9);
  w.envaseLedger.sales = [sale(5, p, 10)]; w.envaseLedger.salesLoaded = true;
  assert.equal(w.getPendingEnvaseLots(p).pending, 10);
  w.removeEnvaseLedgerSale('5');
  assert.equal(w.getPendingEnvaseLots(p).pending, 0);
});
