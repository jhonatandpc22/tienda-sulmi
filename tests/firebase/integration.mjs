import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import * as authApi from 'firebase/auth';
import * as fs from 'firebase/firestore';
import { IDBFactory } from 'fake-indexeddb';
import { createBusinessHarness, product } from '../business-harness.mjs';

// Únicamente emuladores demo; la configuración y las cuentas reales no se importan.
const PROJECT = 'demo-sulmi';
const AUTH_URL = 'http://127.0.0.1:9099';
const STORE_URL = 'http://127.0.0.1:8080';
fs.setLogLevel('silent');
async function clear() {
  for (const url of [`${AUTH_URL}/emulator/v1/projects/${PROJECT}/accounts`, `${STORE_URL}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`]) {
    const response = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
    assert.equal(response.ok, true, 'Inicia los emuladores demo antes de ejecutar estas pruebas');
  }
}
function remoteClient(name) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-local-key' }, `sulmi-${name}`);
  const auth = authApi.getAuth(app);
  authApi.connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
  const db = fs.initializeFirestore(app, { localCache: fs.memoryLocalCache() });
  fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return { app, auth, db };
}
const read = async (client, path) => {
  const doc = await fs.getDocFromServer(fs.doc(client.db, path));
  return doc.exists() ? doc.data() : null;
};
async function eventually(check, label, timeout = 7000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`No se completó: ${label}`);
}
function connectHarness(a, client) {
  // JSDOM y el SDK Node tienen prototipos Object distintos. La aplicación web real
  // comparte un solo entorno. Clonamos sólo esa frontera; las transacciones, las
  // lecturas y las escrituras siguen siendo del SDK/emulador reales.
  a.w.remoteDb = client.db;
  a.w.remoteFs = {
    ...fs,
    runTransaction(db, callback, options) {
      return fs.runTransaction(db, transaction => callback({
        get: ref => transaction.get(ref),
        set: (ref, data) => transaction.set(ref, structuredClone(data)),
        delete: ref => transaction.delete(ref),
      }), options);
    },
  };
  a.w.remoteUserId = client.auth.currentUser.uid;
  a.w.__setTestRemoteReady(true);
}

test('Sulmi Firebase real: reglas, transacciones y reintentos sin duplicar movimientos', { timeout: 120_000 }, async t => {
  await clear();
  const owner = remoteClient('owner');
  const visitor = remoteClient('visitor');
  const apps = [];
  try {
    await t.test('las cinco colecciones originales aceptan sesión anónima y rechazan visitantes', async () => {
      await assert.rejects(fs.setDoc(fs.doc(visitor.db, 'pos_inventory/drink'), product()), error => error.code === 'permission-denied');
      await authApi.signInAnonymously(owner.auth);
      for (const collection of ['pos_inventory', 'pos_sales', 'pos_gastos', 'pos_fiados', 'pos_config']) {
        await fs.setDoc(fs.doc(owner.db, `${collection}/rules-check`), { id: 'rules-check', value: 1 });
        assert.equal((await read(owner, `${collection}/rules-check`)).value, 1);
        await fs.deleteDoc(fs.doc(owner.db, `${collection}/rules-check`));
      }
      await assert.rejects(fs.setDoc(fs.doc(owner.db, 'unrelated/check'), { value: 1 }), error => error.code === 'permission-denied');
    });

    const idb = new IDBFactory();
    let first;
    let operation;
    await t.test('venta confirma localmente sin red y Firestore recibe caja y stock de forma atómica', async () => {
      await fs.setDoc(fs.doc(owner.db, 'pos_inventory/drink'), product());
      first = await createBusinessHarness({}, { indexedDB: idb, remoteHooks: true }); apps.push(first);
      first.cart(2); await first.w.processCheckout();
      operation = structuredClone(first.w.sulmiLocalSync.queue[0]);
      assert.equal(first.stock('drink'), 18);
      assert.equal((await read(owner, 'pos_inventory/drink')).stock, 20);
      connectHarness(first, owner);
      const result = await first.w.sendOperation(operation);
      assert.equal(result['pos_inventory/drink'].stock, 18);
      assert.equal((await read(owner, 'pos_inventory/drink')).stock, 18);
      const sale = first.w.salesHistory[0];
      assert.equal((await read(owner, `pos_sales/${sale.id}`)).total, 10);
      assert.equal((await read(owner, `pos_config/_sync_${operation.id}`)).kind, 'sync_receipt');
      // Simula respuesta perdida: el servidor confirmó, pero no se ejecuta acknowledge local.
      assert.equal(first.w.sulmiLocalSync.queue.length, 1);
    });

    let reopened;
    await t.test('cerrar después de perder respuesta y reabrir reintenta el mismo ID una sola vez', async () => {
      await first.close(); apps.splice(apps.indexOf(first), 1);
      reopened = await createBusinessHarness({}, { indexedDB: idb, remoteHooks: true }); apps.push(reopened);
      assert.equal(reopened.w.sulmiLocalSync.queue[0].id, operation.id);
      connectHarness(reopened, owner);
      reopened.w.sulmiLocalSync.setRemote({ sender: reopened.w.sendOperation, reconcile: reopened.w.reconcileRemote, ready: true });
      await eventually(() => !reopened.w.sulmiLocalSync.running && reopened.w.sulmiLocalSync.queue.length === 0, 'reintento y reconciliación');
      assert.equal((await read(owner, 'pos_inventory/drink')).stock, 18);
      assert.equal(reopened.stock('drink'), 18);
      assert.equal((await fs.getDocs(fs.collection(owner.db, 'pos_sales'))).size, 1);
    });

    await t.test('snapshots de otra caja actualizan el saldo sin volver a aplicar descuentos', async () => {
      reopened.w.setupRealtimeListeners();
      await eventually(() => reopened.w.envaseLedger.salesLoaded && reopened.w.envaseLedger.returnsLoaded, 'primer snapshot del servidor');
      await fs.updateDoc(fs.doc(owner.db, 'pos_inventory/drink'), { stock: fs.increment(5) });
      await eventually(() => reopened.stock('drink') === 23, 'nuevo ingreso de otra caja');
      assert.equal(reopened.w.salesHistory.length, 1);
    });

    await t.test('eliminar venta compensa stock y un reintento remoto no repone dos veces', async () => {
      reopened.w.sulmiLocalSync.setRemote({ sender: reopened.w.sendOperation, ready: false });
      const saleId = reopened.w.salesHistory[0].id;
      await reopened.w.deleteTransaction(saleId, 'POS'); await reopened.confirm();
      assert.equal(reopened.stock('drink'), 25);
      const deletion = structuredClone(reopened.w.sulmiLocalSync.queue[0]);
      await reopened.w.sendOperation(deletion);
      await reopened.w.sendOperation(deletion);
      assert.equal((await read(owner, 'pos_inventory/drink')).stock, 25);
      assert.equal(await read(owner, `pos_sales/${saleId}`), null);
      reopened.w.sulmiLocalSync.setRemote({ sender: reopened.w.sendOperation, reconcile: reopened.w.reconcileRemote, ready: true });
      await eventually(() => !reopened.w.sulmiLocalSync.running && reopened.w.sulmiLocalSync.queue.length === 0, 'confirmación de eliminación');
      assert.equal(reopened.stock('drink'), 25);
    });

    await t.test('fallo de autorización conserva operación local para reintentar con sesión válida', async () => {
      reopened.w.__stopTestRemoteListeners();
      reopened.w.sulmiLocalSync.setRemote({ sender: reopened.w.sendOperation, ready: false });
      reopened.cart(1); await reopened.w.processCheckout();
      const queuedId = reopened.w.sulmiLocalSync.queue[0].id;
      reopened.w.remoteDb = visitor.db;
      reopened.w.sulmiLocalSync.setRemote({ sender: reopened.w.sendOperation, ready: true });
      await eventually(() => !reopened.w.sulmiLocalSync.running && !!reopened.w.sulmiSyncStatus.error, 'rechazo de sesión visitante');
      assert.equal(reopened.w.sulmiLocalSync.queue[0].id, queuedId);
      assert.equal(reopened.stock('drink'), 24);
      assert.equal((await read(owner, 'pos_inventory/drink')).stock, 25);
      reopened.w.remoteDb = owner.db;
      await reopened.w.sulmiLocalSync.retry();
      assert.equal(reopened.w.sulmiLocalSync.queue.length, 0);
      assert.equal((await read(owner, 'pos_inventory/drink')).stock, 24);
    });
  } finally {
    for (const a of apps) await a.close();
    for (const c of [owner, visitor]) { await fs.terminate(c.db); await deleteApp(c.app); }
  }
});
