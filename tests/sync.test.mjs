import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { IDBFactory } from 'fake-indexeddb';
const require = createRequire(import.meta.url);
const { DurableSync, increment } = require('../assets/sulmi-sync.js');
const until = async predicate => { for (let count = 0; count < 150; count++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('La cola no alcanzó el estado esperado.'); };
async function fixture(t, options = {}) {
 const changes = []; const statuses = []; const indexedDB = options.indexedDB || new IDBFactory();
 const sync = new DurableSync({ name: 'sync-test-' + Math.random(), indexedDB, onChange: value => changes.push(value), onStatus: status => statuses.push(status), ...options });
 await sync.open(); t.after(() => sync.close()); return { sync, changes, statuses, indexedDB };
}
const stock = (qty = 10) => ({ path: 'pos_inventory/p1', data: { id: 'p1', stock: qty, _collection: 'inventory' } });
const deduction = (amount = 1) => ({ type: 'update', path: 'pos_inventory/p1', data: { stock: increment(-amount) } });

test('el cobro queda durable sin conexión y reaparece tras cerrar el navegador', async t => {
 const { sync, indexedDB } = await fixture(t);
 await sync.seed([stock()]);
 await sync.enqueue([{ type: 'set', path: 'pos_sales/v1', data: { total: 12 } }, deduction(2)]);
 assert.equal(sync.records.get('pos_inventory/p1').value.stock, 8);
 assert.equal(sync.queue.length, 1);
 const other = new DurableSync({ name: sync.name, indexedDB }); await other.open(); t.after(() => other.close());
 assert.equal(other.records.get('pos_inventory/p1').value.stock, 8); assert.equal(other.queue[0].operations.length, 2);
});
test('la interfaz espera IndexedDB pero no espera la red', async t => {
 let release; const remoteWait = new Promise(resolve => { release = resolve; });
 const { sync } = await fixture(t); await sync.seed([stock()]);
 sync.setRemote({ sender: async () => { await remoteWait; return { 'pos_inventory/p1': { stock: 9 } }; } });
 await sync.enqueue([deduction()]);
 assert.equal(sync.records.get('pos_inventory/p1').value.stock, 9); assert.equal(sync.queue.length, 1);
 release(); await until(() => !sync.queue.length && !sync.running);
});
test('una escritura inválida aborta el lote completo y no muestra éxito falso', async t => {
 const { sync, changes } = await fixture(t); await sync.seed([stock()]); const count = changes.length;
 await assert.rejects(sync.enqueue([deduction(), { type: 'update', path: 'pos_inventory/missing', data: { stock: 1 } }]));
 assert.equal(sync.records.get('pos_inventory/p1').value.stock, 10); assert.equal(sync.queue.length, 0); assert.equal(changes.length, count);
 const tx = sync.db.transaction('outbox', 'readonly'); const result = await new Promise(resolve => { const req = tx.objectStore('outbox').getAll(); req.onsuccess = () => resolve(req.result); }); assert.deepEqual(result, []);
});
test('un snapshot atrasado no pisa el stock de ventas pendientes', async t => {
 const { sync } = await fixture(t); await sync.seed([stock()]); await sync.enqueue([deduction(3)]);
 await sync.ingest([{ path: 'pos_inventory/p1', data: { stock: 10 } }]);
 assert.equal(sync.records.get('pos_inventory/p1').value.stock, 7);
});
test('cola conserva el orden y combina incrementos, cambios y eliminación', async t => {
 const { sync } = await fixture(t); await sync.seed([stock()]);
 await sync.enqueue([deduction(2)]); await sync.enqueue([deduction(3)]);
 const sent = [];
 sync.setRemote({ sender: async operation => { sent.push(operation.id); const i = sent.length; return { 'pos_inventory/p1': { stock: i === 1 ? 8 : 5 } }; } });
 await until(() => !sync.queue.length && !sync.running);
 assert.equal(sent.length, 2); assert.equal(sync.records.get('pos_inventory/p1').value.stock, 5);
 await sync.enqueue([{ type: 'delete', path: 'pos_inventory/p1' }]);
 await until(() => !sync.queue.length && !sync.running);
});
test('fallo remoto conserva la operación y reintenta con el mismo identificador', async t => {
 const { sync } = await fixture(t); await sync.seed([stock()]); await sync.enqueue([deduction()]);
 const originalId = sync.queue[0].id; const ids = [];
 sync.setRemote({ sender: async operation => { ids.push(operation.id); throw new Error('sin conexión'); } });
 await until(() => !!sync.lastError && !sync.running); assert.equal(sync.queue.length, 1);
 sync.setRemote({ sender: async operation => { ids.push(operation.id); return { 'pos_inventory/p1': { stock: 9 } }; } });
 await until(() => !sync.queue.length && !sync.running);
 assert.deepEqual(ids, [originalId, originalId]); assert.equal(sync.records.get('pos_inventory/p1').value.stock, 9);
});
test('recibo remoto tras cierre evita aplicar dos veces un incremento', async t => {
 const { sync } = await fixture(t); await sync.seed([stock()]); await sync.enqueue([deduction(2)]);
 const receipts = new Set(); let serverStock = 10; let loseResponse = true;
 const sender = async operation => { if (!receipts.has(operation.id)) { serverStock -= 2; receipts.add(operation.id); } if (loseResponse) { loseResponse = false; throw new Error('respuesta perdida'); } return { 'pos_inventory/p1': { stock: serverStock } }; };
 sync.setRemote({ sender }); await until(() => !!sync.lastError && !sync.running); assert.equal(serverStock, 8);
 await sync.retry(); assert.equal(serverStock, 8); assert.equal(sync.queue.length, 0); assert.equal(sync.records.get('pos_inventory/p1').value.stock, 8);
});
test('la primera lista completa quita registros borrados en otro equipo y conserva pendientes', async t => {
 const { sync } = await fixture(t); await sync.seed([stock(), { path: 'pos_inventory/old', data: { stock: 1 } }]); await sync.enqueue([deduction()]);
 await sync.ingest([], { completeCollection: 'pos_inventory', ids: [] });
 assert.equal(sync.records.get('pos_inventory/old').value, null); assert.equal(sync.records.get('pos_inventory/p1').value.stock, 9);
});
test('dos pestañas guardan sin perder cantidades aunque sus cachés partan del mismo stock', async t => {
 const { sync, indexedDB } = await fixture(t); await sync.seed([stock()]);
 const other = new DurableSync({ name: sync.name, indexedDB }); await other.open(); t.after(() => other.close());
 await Promise.all([sync.enqueue([deduction(2)]), other.enqueue([deduction(3)])]);
 await sync.reload(); assert.equal(sync.records.get('pos_inventory/p1').value.stock, 5); assert.equal(sync.queue.length, 2);
});
test('actualizar un producto escribe únicamente su documento y no regraba todo el historial', async t => {
 const { sync } = await fixture(t);
 await sync.seed([stock(), ...Array.from({ length: 2000 }, (_, i) => ({ path: `pos_sales/${i}`, data: { total: i } }))]);
 let writes = 0; const originalTransaction = sync.db.transaction.bind(sync.db);
 sync.db.transaction = function (...args) { const tx = originalTransaction(...args); const objectStore = tx.objectStore.bind(tx); tx.objectStore = name => { const store = objectStore(name); if (name === 'records') { const originalPut = store.put.bind(store); store.put = (...params) => { writes++; return originalPut(...params); }; } return store; }; return tx; };
 await sync.enqueue([deduction()]); assert.equal(writes, 1); assert.equal(sync.records.size, 2001);
});


test('snapshot de otra pestaña no pisa una venta aunque el aviso entre pestañas todavía no llegue', async t => {
 const { sync, indexedDB } = await fixture(t); await sync.seed([stock()]);
 const other = new DurableSync({ name: sync.name, indexedDB }); await other.open(); t.after(() => other.close());
 other.channel?.close(); sync.channel?.close();
 await sync.enqueue([deduction(3)]);
 await other.ingest([{ path: 'pos_inventory/p1', data: { stock: 10 } }]);
 await sync.reload(); assert.equal(sync.records.get('pos_inventory/p1').value.stock, 7);
});
test('una pestaña que migra una caché antigua no reemplaza el stock ya guardado', async t => {
 const { sync, indexedDB } = await fixture(t); await sync.seed([stock()]);
 const other = new DurableSync({ name: sync.name, indexedDB }); await other.open(); t.after(() => other.close());
 other.channel?.close(); sync.channel?.close();
 await sync.enqueue([deduction(2)]); other.records.clear();
 await other.seed([stock(100)]); await sync.reload(); assert.equal(sync.records.get('pos_inventory/p1').value.stock, 8);
});
test('si el disco rechaza la escritura, no cambia el stock ni se encola un cobro', async t => {
 const { sync } = await fixture(t); await sync.seed([stock()]);
 const originalTransaction = sync.db.transaction.bind(sync.db);
 sync.db.transaction = function (...args) { const tx = originalTransaction(...args); const objectStore = tx.objectStore.bind(tx); tx.objectStore = name => { const store = objectStore(name); if (name === 'records' && args[1] === 'readwrite') store.put = () => { throw new DOMException('Sin espacio', 'QuotaExceededError'); }; return store; }; return tx; };
 await assert.rejects(sync.enqueue([deduction()]), { name: 'QuotaExceededError' });
 assert.equal(sync.records.get('pos_inventory/p1').value.stock, 10); assert.equal(sync.queue.length, 0);
});
test('un fallo transitorio reintenta automáticamente aunque el navegador siga en línea', async t => {
 const { sync } = await fixture(t); await sync.seed([stock()]); await sync.enqueue([deduction()]); sync.retryDelay = 5;
 let attempts = 0;
 sync.setRemote({ sender: async () => { attempts++; if (attempts === 1) throw new Error('conexión interrumpida'); return { 'pos_inventory/p1': { stock: 9 } }; } });
 await until(() => attempts === 2 && !sync.queue.length && !sync.running);
 assert.equal(sync.records.get('pos_inventory/p1').value.stock, 9);
});
