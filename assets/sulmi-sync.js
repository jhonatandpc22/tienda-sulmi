/* Cola durable local. Ningún éxito de escritura se confirma antes de IndexedDB. */
(function (root) {
    'use strict';
    const copy = value => value === undefined ? undefined : structuredClone(value);
    const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const completed = tx => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error || new Error('No se pudo guardar en este equipo.')); });
    const increment = n => ({ __sulmiIncrement: Number(n) });
    function apply(previous, operation) {
        if (operation.type === 'delete') return null;
        if (operation.type === 'update' && previous == null) throw new Error('No existe el registro que se intenta actualizar. Vuelve a abrirlo.');
        const next = operation.type === 'set' && !operation.merge ? {} : copy(previous || {});
        for (const [key, value] of Object.entries(operation.data || {})) {
            const parts = operation.type === 'update' ? key.split('.') : [key];
            let target = next;
            for (const part of parts.slice(0, -1)) target = target[part] = { ...(target[part] || {}) };
            const last = parts.at(-1);
            target[last] = value && typeof value === 'object' && Object.keys(value).length === 1 && '__sulmiIncrement' in value
                ? (Number(target[last]) || 0) + value.__sulmiIncrement : copy(value);
        }
        return next;
    }
    class DurableSync {
        constructor({ name, indexedDB = root.indexedDB, onChange = () => {}, onStatus = () => {}, sender = null, reconcile = null }) {
            Object.assign(this, { name, indexedDB, onChange, onStatus, sender, reconcile });
            this.records = new Map(); this.queue = []; this.chain = Promise.resolve(); this.remoteReady = false; this.running = false; this.lastError = null; this.retryDelay = 1500; this.retryTimer = null;
        }
        serial(job) { const work = this.chain.then(job); this.chain = work.catch(() => {}); return work; }
        async open() {
            if (this.openPromise) return this.openPromise;
            this.openPromise = (async () => {
                if (!this.indexedDB) throw new Error('Este navegador no permite guardar datos locales. Abre la tienda en una ventana normal.');
                const req = this.indexedDB.open(this.name, 1);
                req.onupgradeneeded = () => {
                    req.result.createObjectStore('records', { keyPath: 'path' });
                    req.result.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
                };
                this.db = await request(req);
                this.db.onversionchange = () => this.db.close();
                await this.reload();
                if (typeof root.BroadcastChannel === 'function') {
                    this.channel = new root.BroadcastChannel(this.name);
                    this.channel.onmessage = event => this.serial(async () => { await this.reload(event.data?.paths); this.pump(); }).catch(error => this.fail(error));
                }
                return this;
            })();
            return this.openPromise;
        }
        async reload(paths) {
            const tx = this.db.transaction(['records', 'outbox'], 'readonly');
            const done = completed(tx);
            const recordReads = paths ? Promise.all([...new Set(paths)].map(path => request(tx.objectStore('records').get(path)))) : request(tx.objectStore('records').getAll());
            const [records, queue] = await Promise.all([recordReads, request(tx.objectStore('outbox').getAll())]);
            await done;
            if (!paths) this.records.clear();
            for (const row of records) if (row) this.records.set(row.path, row);
            this.queue = queue;
            this.notifyChanges(records.filter(Boolean).map(row => ({ path: row.path, data: copy(row.value) })));
            this.status();
        }
        status() { try { this.onStatus({ pending: this.queue.length, online: this.remoteReady, syncing: this.running, error: this.lastError }); } catch {} }
        notifyChanges(changes) { try { this.onChange(changes); } catch (error) { this.lastError = 'Datos guardados. Vuelve a abrir esta vista para actualizarlos.'; this.status(); } }
        fail(error) { this.lastError = error?.message || String(error); this.status(); }
        signal(paths) { try { this.channel?.postMessage({ paths }); } catch {} this.status(); }
        async seed(entries) {
            await this.open();
            return this.serial(async () => {
                const tx = this.db.transaction('records', 'readwrite'); const done = completed(tx); const store = tx.objectStore('records');
                const added = [];
                const existing = await Promise.all(entries.map(entry => request(store.get(entry.path))));
                entries.forEach(({ path, data }, index) => {
                    if (existing[index]) { this.records.set(path, existing[index]); return; }
                    const row = { path, base: copy(data), value: copy(data) }; store.put(row); added.push(row);
                });
                await done; added.forEach(row => this.records.set(row.path, row));
            });
        }
        async enqueue(operations) {
            await this.open();
            if (!operations.length) return;
            if (operations.length > 450) throw new Error('Este cambio tiene demasiados registros. Divídelo en grupos más pequeños.');
            const ops = copy(operations);
            return this.serial(async () => {
                const tx = this.db.transaction(['records', 'outbox'], 'readwrite'); const done = completed(tx); const store = tx.objectStore('records');
                try {
                    const paths = [...new Set(ops.map(op => op.path))];
                    const rows = new Map((await Promise.all(paths.map(async path => [path, await request(store.get(path)) || { path, base: null, value: null }]))));
                    for (const op of ops) { const row = rows.get(op.path); row.value = apply(row.value, op); }
                    const operation = { id: root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`, createdAt: Date.now(), operations: ops };
                    rows.forEach(row => store.put(row));
                    operation.seq = await request(tx.objectStore('outbox').add(operation));
                    const queue = await request(tx.objectStore('outbox').getAll());
                    await done;
                    rows.forEach(row => this.records.set(row.path, row)); this.queue = queue; this.lastError = null;
                    this.notifyChanges([...rows.values()].map(row => ({ path: row.path, data: copy(row.value) })));
                    this.signal(paths); this.pump(); return { id: operation.id, pending: true };
                } catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); this.fail(error); throw error; }
            });
        }
        pendingPaths() { return new Set(this.queue.flatMap(op => op.operations.map(change => change.path))); }
        async ingest(changes, { completeCollection = null, ids = [] } = {}) {
            await this.open();
            return this.serial(async () => {
                const tx = this.db.transaction(['records', 'outbox'], 'readwrite'); const done = completed(tx); const store = tx.objectStore('records'); const rows = [];
                const queue = await request(tx.objectStore('outbox').getAll());
                const pending = new Set(queue.flatMap(item => item.operations.map(change => change.path)));
                const incoming = new Map(changes.map(change => [change.path, change.data]));
                if (completeCollection) {
                    const keep = new Set(ids);
                    const existing = await request(store.getAllKeys());
                    for (const path of existing) if (path.startsWith(completeCollection + '/') && !keep.has(path)) incoming.set(path, null);
                }
                for (const [path, data] of incoming) {
                    if (pending.has(path)) continue;
                    const row = { path, base: copy(data), value: copy(data) }; store.put(row); rows.push(row);
                }
                await done; this.queue = queue; rows.forEach(row => this.records.set(row.path, row));
                if (rows.length) { this.notifyChanges(rows.map(row => ({ path: row.path, data: copy(row.value) }))); this.signal(rows.map(row => row.path)); }
            });
        }
        setRemote({ sender, reconcile = this.reconcile, ready = true }) {
            this.sender = sender; this.reconcile = reconcile; this.remoteReady = ready; this.lastError = null; clearTimeout(this.retryTimer); this.retryTimer = null; this.status(); if (ready) this.pump();
        }
        async acknowledge(operation, authoritative) {
            return this.serial(async () => {
                const tx = this.db.transaction(['records', 'outbox'], 'readwrite'); const done = completed(tx);
                const queue = await request(tx.objectStore('outbox').getAll());
                if (!queue.some(item => item.id === operation.id)) { await done; await this.reload(operation.operations.map(op => op.path)); return; }
                const remaining = queue.filter(item => item.id !== operation.id);
                const paths = [...new Set(operation.operations.map(op => op.path))]; const rows = [];
                for (const path of paths) {
                    const old = await request(tx.objectStore('records').get(path));
                    let base = authoritative?.[path];
                    if (base === undefined) { base = copy(old?.base ?? null); for (const op of operation.operations) if (op.path === path) base = apply(base, op); }
                    let value = copy(base);
                    for (const item of remaining) for (const op of item.operations) if (op.path === path) value = apply(value, op);
                    const row = { path, base: copy(base), value }; tx.objectStore('records').put(row); rows.push(row);
                }
                tx.objectStore('outbox').delete(operation.seq); await done;
                this.queue = remaining; rows.forEach(row => this.records.set(row.path, row));
                this.notifyChanges(rows.map(row => ({ path: row.path, data: copy(row.value) }))); this.signal(paths);
            });
        }
        async pump() {
            if (this.running || !this.remoteReady || !this.sender || !this.db) return;
            this.running = true; this.status(); const touched = new Set();
            try {
                while (this.remoteReady) {
                    const tx = this.db.transaction('outbox', 'readonly'); const done = completed(tx);
                    const op = await request(tx.objectStore('outbox').openCursor()); await done;
                    if (!op) break;
                    const operation = op.value;
                    const result = await this.sender(copy(operation));
                    operation.operations.forEach(change => touched.add(change.path));
                    await this.acknowledge(operation, result); this.lastError = null; this.retryDelay = 1500;
                }
                if (touched.size && this.reconcile) await this.reconcile([...touched]);
            } catch (error) {
                this.fail(error);
                if (this.remoteReady && !/permission-denied|unauthenticated|invalid-argument|failed-precondition/.test(error?.code || '')) {
                    clearTimeout(this.retryTimer);
                    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.pump(); }, this.retryDelay);
                    this.retryTimer.unref?.(); this.retryDelay = Math.min(this.retryDelay * 2, 30000);
                }
            }
            finally { this.running = false; this.status(); if (this.remoteReady && this.queue.length && !this.lastError) queueMicrotask(() => this.pump()); }
        }
        async retry() { clearTimeout(this.retryTimer); this.retryTimer = null; this.lastError = null; await this.pump(); }
        async close() { clearTimeout(this.retryTimer); this.retryTimer = null; this.remoteReady = false; await this.chain; this.channel?.close(); this.db?.close(); }
    }
    root.SulmiSync = { DurableSync, apply, increment };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.SulmiSync;
})(typeof window === 'undefined' ? globalThis : window);
