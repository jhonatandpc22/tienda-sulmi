/* Shared stock calculation: edits reverse the original and apply the replacement in one batch. */
function saleStockUnits(sale) {
    const units = new Map();
    const add = (id, qty) => { if (id != null && Number.isFinite(qty) && qty !== 0) units.set(String(id), (units.get(String(id)) || 0) + qty); };
    const addInventory = (id, qty) => {
        add(id, qty);
        const product = window.inventory.find(p => String(p.id) === String(id));
        if (product?.paperRefId) add(product.paperRefId, qty);
    };
    if (sale?.type === 'POS' || sale?.type === 'CONSUMO_INTERNO') {
        for (const item of sale.items || []) {
            const p = item.product;
            if (!p || p.isExtra) continue;
            addInventory(p.id, item.type === 'package' ? item.qty * (p.unitsPerGroup || 1) : item.qty);
            if (item.type === 'promo') {
                const promo = p.promos?.find(pr => pr.id === item.promoId);
                for (const part of promo?.items || []) addInventory(part.id, item.qty * part.qty);
            }
        }
    } else if (sale?.type === 'SERVICIO') {
        const paper = window.paperInventory.find(p => sale.paperId ? String(p.id) === String(sale.paperId) : p.name === sale.paperName);
        if (paper) {
            add(paper.id, sale.qty);
            const product = window.inventory.find(p => p.paperRefId === paper.id);
            if (product) add(product.id, sale.qty);
        }
    } else if (sale?.type === 'DETALLE') {
        const recipe = sale.componentsSnapshot || window.detallesInventory.find(p => String(p.id) === String(sale.productId))?.components || [];
        for (const part of recipe) addInventory(part.id, part.qty * sale.qty);
    }
    return units;
}
function queueSaleStock(batch, sale, direction) {
    for (const [id, qty] of saleStockUnits(sale)) {
        batch.update(window.fs.doc(window.db, 'artifacts', window.appId, 'users', window.userId, 'pos_inventory', id), { stock: window.fs.increment(qty * direction) });
    }
}
function getEditingStockAllowance(productId) {
    return saleStockUnits(window.editingPos?.originalData).get(String(productId)) || 0;
}
function installWriteGuards() {
    const names = ['processCheckout','confirmarPagoCredito','saveRenameClient','processRestock','saveProduct','savePaper','registerPrint','saveQuickAddDetalle','saveDetalleProduct','registerDetalleSale','registrarGasto','processReturnEnvase','applyBulkEdit','saveConfig','saveRenameFilter','addGlobalCategory','addGlobalFamily','addDetTipo','addVendedor','setVendedor','saveVendedorSchedule'];
    for (const name of names) {
        const original = window[name];
        if (typeof original !== 'function') continue;
        let pending;
        window[name] = function (...args) {
            if (pending) return pending;
            pending = (async () => {
                try {
                    await window.ensureLocalWritesReady();
                    return await original.apply(this, args);
                } catch (error) {
                    console.error('Guardado local pendiente de revisión:', error);
                    window.showModal('No se pudo guardar', 'Conserva esta ventana y vuelve a intentarlo. No se pudo confirmar el guardado local. ' + (error?.name === 'QuotaExceededError' ? 'El almacenamiento del dispositivo está lleno.' : ''));
                    return false;
                } finally { pending = null; }
            })();
            return pending;
        };
    }
}
