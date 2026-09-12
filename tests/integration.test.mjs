import test from 'node:test';
import assert from 'node:assert/strict';
import { createBusinessHarness, product } from './business-harness.mjs';

async function fixture(t, seed) {
  const app = await createBusinessHarness(seed);
  t.after(() => app.close());
  return app;
}

test('venta por paquetes guarda importes originales y descuenta unidades una sola vez', async t => {
  const a = await fixture(t, { inventory: [product({ isGroup: true, unitsPerGroup: 6, costIsPackage: true, cost: 18, price: 30, unitPrice: 5.5 })] });
  a.cart(2, 'drink', 'package');
  await a.w.processCheckout();
  assert.equal(a.w.salesHistory.length, 1);
  assert.equal(a.w.salesHistory[0].total, 60);
  assert.equal(a.w.salesHistory[0].profit, 24);
  assert.equal(a.stock('drink'), 8);
  assert.equal(a.w.cart.length, 0);
});

test('doble toque durante el guardado crea una venta y un descuento de stock', async t => {
  const a = await fixture(t);
  a.cart(1);
  await Promise.all([a.w.processCheckout(), a.w.processCheckout()]);
  assert.equal(a.w.salesHistory.length, 1);
  assert.equal(a.stock('drink'), 19);
});

test('combo y venta marcada conservan precio, componentes y anotación', async t => {
  const a = await fixture(t, { inventory: [
    product({ promos: [{ id: 'combo', name: 'Combo', price: 10, items: [{ id: 'snack', qty: 2 }] }] }),
    product({ id: 'snack', name: 'Snack', cost: 1 }),
  ] });
  a.cart(1, 'drink', 'promo', { promoId: 'combo' });
  a.w.isMarcadoMode = true; a.value('marcadoNotaInput', 'Pedido del vecino');
  await a.w.processCheckout();
  assert.equal(a.w.salesHistory[0].total, 10);
  assert.equal(a.w.salesHistory[0].profit, 6);
  assert.equal(a.w.salesHistory[0].marcado, true);
  assert.equal(a.w.salesHistory[0].nota, 'Pedido del vecino');
  assert.equal(a.stock('drink'), 19);
  assert.equal(a.stock('snack'), 18);
});

test('pago dividido conserva caja, crédito y ganancia proporcional del abono', async t => {
  const a = await fixture(t);
  a.cart(2);
  a.element('chkPagoMixto').checked = true;
  a.value('mixMethod1', 'efectivo'); a.value('mixAmount1', 4);
  a.value('mixMethod2', 'fiado'); a.value('mixAmount2', 6);
  a.value('creditoClienteInput', 'Cliente Luz');
  await a.w.processCheckout();
  assert.equal(a.w.salesHistory[0].total, 10);
  assert.equal(a.w.salesHistory[0].mixedDetails.efectivo, 4);
  assert.equal(a.w.creditos.length, 1);
  assert.equal(a.w.creditos[0].total, 6);
  assert.ok(Math.abs(a.w.creditos[0].profit - 3.6) < 0.000001);
  a.element('pc_clienteName').textContent = 'Cliente Luz';
  a.value('pc_montoInput', 3); a.value('pc_ticketId', a.w.creditos[0].id);
  await a.w.confirmarPagoCredito();
  assert.equal(a.w.creditos[0].paidAmount, 3);
  assert.equal(a.w.creditos[0].status, 'pendiente');
  const receipt = a.w.salesHistory.find(s => s.type === 'PAGO_FIADO');
  assert.equal(receipt.total, 3);
  assert.ok(Math.abs(receipt.profit - 1.8) < 0.000001);
  assert.equal(a.stock('drink'), 18);
});

test('consumo interno registra costo y stock sin crear una venta', async t => {
  const a = await fixture(t);
  a.w.isConsumoMode = true;
  a.cart(3);
  await a.w.processCheckout();
  assert.equal(a.w.salesHistory.length, 0);
  assert.equal(a.w.gastosHistory.length, 1);
  assert.equal(a.w.gastosHistory[0].type, 'CONSUMO_INTERNO');
  assert.equal(a.w.gastosHistory[0].monto, 6);
  assert.equal(a.stock('drink'), 17);
});

test('ingreso de dos paquetes conserva costo de paquete y gasto total', async t => {
  const a = await fixture(t, { inventory: [product({ isGroup: true, unitsPerGroup: 6, costIsPackage: true, cost: 12, price: 30, unitPrice: 5.5 })] });
  a.w.restockRows = [{ productId: 'drink', qty: 2, format: 'pack', cost: 36 }];
  a.value('restockTotalGasto', 36);
  await a.w.processRestock();
  assert.equal(a.stock('drink'), 32);
  assert.equal(a.w.inventory[0].cost, 18);
  assert.equal(a.w.gastosHistory[0].monto, 36);
  assert.equal(a.w.gastosHistory[0].type, 'INGRESO_STOCK');
});

const paperSeed = () => ({
  inventory: [product({ id: 'paper-sale', paperRefId: 'paper', stock: 100, name: 'Hoja: Bond' })],
  paperInventory: [{ id: 'paper', name: 'Bond', cost: 0.1, stock: 100, _collection: 'paper' }],
});
function fillPrint(a, qty = 4, total = 2) {
  a.value('srv_tipo', 'Copias'); a.value('srv_paper', 'paper'); a.value('srv_color', 'B/N');
  a.value('srv_qty', qty); a.value('srv_precio', total);
  a.element('srvPaymentWrapper').classList.remove('hidden');
}

test('impresiones descuentan papel y copia de almacén una vez', async t => {
  const a = await fixture(t, paperSeed());
  fillPrint(a);
  await a.w.registerPrint();
  assert.equal(a.w.salesHistory[0].total, 2);
  assert.equal(a.w.salesHistory[0].profit, 1.6);
  assert.equal(a.w.paperInventory[0].stock, 96);
  assert.equal(a.stock('paper-sale'), 96);
});

const detailSeed = () => ({
  inventory: [product({ id: 'ribbon', name: 'Cinta' }), product({ id: 'flower', name: 'Flor' })],
  detallesInventory: [{ id: 'gift', nombre: 'Arreglo', tipo: 'Arreglo Floral', desc: '', precio: 10, costo: 6,
    components: [{ id: 'ribbon', qty: 2 }, { id: 'flower', qty: 3 }], _collection: 'detalles' }],
});
function fillDetail(a, qty = 2) {
  a.value('detVen_producto', 'gift'); a.value('detVen_qty', qty);
  a.element('detPaymentWrapper').classList.remove('hidden');
}

test('detalles conserva ganancia y descuenta cada componente una vez', async t => {
  const a = await fixture(t, detailSeed());
  fillDetail(a);
  await a.w.registerDetalleSale();
  assert.equal(a.w.salesHistory[0].total, 20);
  assert.equal(a.w.salesHistory[0].profit, 8);
  assert.equal(a.stock('ribbon'), 16);
  assert.equal(a.stock('flower'), 14);
});

test('abrir y cancelar edición POS no altera inventario ni borra el movimiento', async t => {
  const a = await fixture(t);
  a.cart(2); await a.w.processCheckout();
  const id = a.w.salesHistory[0].id;
  a.w.editTransaction(id, 'POS');
  assert.equal(a.stock('drink'), 18);
  assert.equal(a.w.salesHistory.length, 1);
  a.w.cancelEditPos();
  assert.equal(a.stock('drink'), 18);
  assert.equal(a.w.salesHistory.length, 1);
  assert.equal(a.w.salesHistory[0].total, 10);
});

test('editar POS aplica sólo diferencia de stock y eliminar restaura el saldo', async t => {
  const a = await fixture(t);
  a.cart(2); await a.w.processCheckout();
  const id = a.w.salesHistory[0].id;
  a.w.editTransaction(id, 'POS');
  a.w.cart[0].qty = 1;
  await a.w.processCheckout();
  assert.equal(a.stock('drink'), 19);
  assert.equal(a.w.salesHistory.length, 1);
  assert.equal(a.w.salesHistory[0].total, 5);
  await a.w.deleteTransaction(id, 'POS'); await a.confirm();
  assert.equal(a.stock('drink'), 20);
  assert.equal(a.w.salesHistory.length, 0);
});

test('editar impresiones conserva ambas existencias usando la cantidad anterior', async t => {
  const a = await fixture(t, paperSeed());
  fillPrint(a); await a.w.registerPrint();
  const id = a.w.salesHistory[0].id;
  a.w.editTransaction(id, 'SERVICIO');
  assert.equal(a.w.paperInventory[0].stock, 96);
  fillPrint(a, 2, 1); await a.w.registerPrint();
  assert.equal(a.w.paperInventory[0].stock, 98);
  assert.equal(a.stock('paper-sale'), 98);
  assert.equal(a.w.salesHistory.length, 1);
  assert.equal(a.w.salesHistory[0].total, 1);
});

test('editar y eliminar detalle repone componentes de la venta anterior', async t => {
  const a = await fixture(t, detailSeed());
  fillDetail(a); await a.w.registerDetalleSale();
  const id = a.w.salesHistory[0].id;
  a.w.editTransaction(id, 'DETALLE'); fillDetail(a, 1); await a.w.registerDetalleSale();
  assert.equal(a.stock('ribbon'), 18);
  assert.equal(a.stock('flower'), 17);
  assert.equal(a.w.salesHistory.length, 1);
  assert.equal(a.w.salesHistory[0].total, 10);
  await a.w.deleteTransaction(id, 'DETALLE'); await a.confirm();
  assert.equal(a.stock('ribbon'), 20);
  assert.equal(a.stock('flower'), 20);
});

test('fallo de persistencia local conserva carrito y no anuncia venta exitosa', async t => {
  const a = await fixture(t);
  a.cart(2);
  const writeBatch = a.w.fs.writeBatch;
  a.w.fs.writeBatch = (...args) => {
    const batch = writeBatch(...args);
    batch.commit = async () => { throw new Error('QuotaExceededError'); };
    return batch;
  };
  try { await a.w.processCheckout(); } catch (error) { assert.match(error.message, /QuotaExceededError/); }
  assert.equal(a.w.cart.length, 1);
  assert.equal(a.stock('drink'), 20);
  assert.equal(a.w.salesHistory.length, 0);
  assert.equal(a.messages.some(m => m.title === '¡Venta Exitosa!'), false);
});

test('respaldo conserva ventas, gastos y productos después del guardado local', async t => {
  const a = await fixture(t);
  a.cart(2); await a.w.processCheckout();
  a.value('gastoDesc', 'Movilidad'); a.value('gastoMonto', 3);
  await a.w.registrarGasto();
  for (const id of ['chkExpAlmacen', 'chkExpServicios', 'chkExpDetalles', 'chkExpHist', 'chkExpConf']) a.element(id).checked = true;
  let saved;
  a.w.Blob = Blob;
  a.w.URL.createObjectURL = blob => { saved = blob; return 'blob:https://sulmi.test/backup'; };
  a.w.URL.revokeObjectURL = () => {};
  a.w.HTMLAnchorElement.prototype.click = () => {};
  await a.w.exportBackup();
  const backup = JSON.parse(await saved.text());
  assert.equal(backup.inventory[0].stock, 18);
  assert.equal(backup.salesHistory[0].total, 10);
  assert.equal(backup.gastosHistory[0].monto, 3);
  assert.equal(backup.currentVendedor, 'Ana');
  assert.equal(typeof backup.salesHistory[0].date, 'number');
  assert.ok(backup.appConfig.categories.includes('Bebidas'));
});

test('fallo local al cobrar crédito conserva el saldo pendiente original', async t => {
  const a = await fixture(t);
  a.w.isCreditoMode = true; a.cart(2); a.value('creditoClienteInput', 'Cliente Luz');
  await a.w.processCheckout();
  const debtId = a.w.creditos[0].id;
  a.element('pc_clienteName').textContent = 'Cliente Luz';
  a.value('pc_montoInput', 5); a.value('pc_ticketId', debtId);
  const writeBatch = a.w.fs.writeBatch;
  a.w.fs.writeBatch = (...args) => {
    const batch = writeBatch(...args);
    batch.commit = async () => { throw new Error('QuotaExceededError'); };
    return batch;
  };
  await a.w.confirmarPagoCredito();
  assert.equal(a.w.creditos[0].paidAmount || 0, 0);
  assert.equal(a.w.creditos[0].status, 'pendiente');
  assert.equal(a.w.salesHistory.some(s => s.type === 'PAGO_FIADO'), false);
});

test('restaurar respaldo completo no pierde listas durante la proyección de borrados', async t => {
  const a = await fixture(t);
  a.cart(1); await a.w.processCheckout();
  const backup = {
    inventory: [product({ id: 'restored', name: 'Arroz restaurado', stock: 87 })],
    paperInventory: [{ id: 'bond-restored', name: 'Papel restaurado', cost: 0.2, stock: 45, _collection: 'paper' }],
    detallesInventory: [{ id: 'gift-restored', nombre: 'Regalo restaurado', tipo: 'Box de Regalo', precio: 15, costo: 5, _collection: 'detalles' }],
    salesHistory: [{ id: 'sale-restored', date: 1700000000000, type: 'POS', total: 15, profit: 10, method: 'yape', items: [] }],
    gastosHistory: [{ id: 'expense-restored', date: 1700000000000, desc: 'Movilidad restaurada', monto: 3, method: 'efectivo' }],
    creditos: [{ id: 'debt-restored', date: 1700000000000, client: 'Luz', total: 5, profit: 2, status: 'pendiente' }],
    auditLog: [], currentIdCounter: 77, vendedores: [{ name: 'Rosa', start: '', end: '' }], currentVendedor: 'Rosa',
    appConfig: { ...a.w.appConfig, tarjetaMargin: 4 },
  };
  let imported;
  a.w.FileReader = class {
    readAsText(file) { imported = this.onload({ target: { result: file } }); }
  };
  a.w.handleImportBackup({ target: { files: [JSON.stringify(backup)], value: 'backup.json' } });
  await imported;
  assert.equal(a.w.inventory.length, 1);
  assert.equal(a.w.inventory[0].id, 'restored');
  assert.equal(a.w.inventory[0].stock, 87);
  assert.equal(a.w.paperInventory[0].stock, 45);
  assert.equal(a.w.detallesInventory[0].nombre, 'Regalo restaurado');
  assert.equal(a.w.salesHistory.length, 1);
  assert.equal(a.w.salesHistory[0].id, 'sale-restored');
  assert.equal(a.w.gastosHistory[0].monto, 3);
  assert.equal(a.w.creditos[0].total, 5);
  assert.equal(a.w.currentVendedor, 'Rosa');
});
