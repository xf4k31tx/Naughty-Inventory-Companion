const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("Naughty Inventory Companion.user.js", "utf8");

function harness({ nativeValues = {}, legacyValues = {}, quota = false } = {}) {
    const native = { ...nativeValues };
    const legacy = new Map(Object.entries(legacyValues));
    const calls = { loadAll: 0, setMany: [], deletes: [], gmSets: [], gmDeletes: [] };
    const storage = {
        async loadAll() { calls.loadAll += 1; return { ...native }; },
        async getMany(keys) { return Object.fromEntries(keys.map((key) => [key, native[key] ?? null])); },
        async setMany(values) {
            calls.setMany.push({ ...values });
            if (quota) {
                const error = new Error("quota");
                error.code = "QuotaExceeded";
                throw error;
            }
            Object.assign(native, values);
        },
        async set(key, value) { native[key] = value; },
        async delete(key) { calls.deletes.push(key); delete native[key]; }
    };
    const local = new Map();
    const window = {
        addEventListener() {}, removeEventListener() {},
        setTimeout(fn) { return setTimeout(fn, 0); }, clearTimeout,
        performance: { now: () => Date.now() },
        localStorage: { getItem: (key) => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: (key) => local.delete(key) }
    };
    const context = vm.createContext({
        console: { info() {}, warn() {}, error() {} }, URL, URLSearchParams, Promise, Date, Math, Object, Array, String, Number, Boolean, JSON, TextEncoder, Uint8Array,
        window, navigator: { userAgent: "" }, PDA_storage: storage,
        document: { readyState: "loading", visibilityState: "visible", documentElement: { clientWidth: 1200, clientHeight: 800 }, addEventListener() {} },
        GM: {
            async getValue(key, fallback) { return legacy.has(key) ? legacy.get(key) : fallback; },
            async setValue(key, value) { calls.gmSets.push([key, value]); legacy.set(key, value); },
            async deleteValue(key) { calls.gmDeletes.push(key); legacy.delete(key); }
        },
        __NIC_STORAGE_TEST__: {}
    });
    vm.runInContext(source, context, { filename: "Naughty Inventory Companion.user.js" });
    return { hooks: context.__NIC_STORAGE_TEST__.hooks, native, legacy, calls };
}

async function nativePreferredRead() {
    const initial = harness({ nativeValues: { NIC_TORN_API_KEY: "native-key" }, legacyValues: { NIC_TORN_API_KEY: "legacy-key" } });
    const stored = await initial.hooks.loadStoredValues();
    assert.strictEqual(stored.NIC_TORN_API_KEY, "native-key");
}

async function oneTimeMigration() {
    const initial = harness({ legacyValues: { NIC_TORN_API_KEY: "legacy-key" } });
    await initial.hooks.loadStoredValues();
    assert.strictEqual(initial.calls.setMany.length, 1);
    assert.strictEqual(initial.native.NIC_TORN_API_KEY, "legacy-key");
    await initial.hooks.loadStoredValues();
    assert.strictEqual(initial.calls.setMany.length, 1);
}

async function quotaFallbackAndQueue() {
    const quotaHarness = harness({ quota: true });
    await quotaHarness.hooks.loadStoredValues();
    await quotaHarness.hooks.persistValues({ NIC_DASHBOARD_STATE: { tab: "inventory" } }, true);
    assert.strictEqual(quotaHarness.hooks.PERSISTENCE.pdaQuotaExceeded, true);
    assert.deepStrictEqual(quotaHarness.legacy.get("NIC_DASHBOARD_STATE"), { tab: "inventory" });

    const queued = harness();
    await queued.hooks.loadStoredValues();
    const first = queued.hooks.persistValues({ NIC_DASHBOARD_STATE: { tab: "inventory" } });
    const second = queued.hooks.persistValues({ NIC_WIDGET_POSITION: { x: 2, y: 3 } });
    await queued.hooks.flushPersistValues();
    await Promise.all([first, second]);
    assert.strictEqual(queued.calls.setMany.length, 1);
    assert.deepStrictEqual(queued.calls.setMany[0], { NIC_DASHBOARD_STATE: { tab: "inventory" }, NIC_WIDGET_POSITION: { x: 2, y: 3 } });
}

async function deletesBothStores() {
    const initial = harness({ nativeValues: { NIC_INVENTORY_CACHE: { rows: [1] } }, legacyValues: { NIC_INVENTORY_CACHE: { rows: [1] } } });
    await initial.hooks.loadStoredValues();
    await initial.hooks.deletePersistedValues(["NIC_INVENTORY_CACHE"]);
    assert.strictEqual(Object.hasOwn(initial.native, "NIC_INVENTORY_CACHE"), false);
    assert.strictEqual(initial.legacy.has("NIC_INVENTORY_CACHE"), false);
    assert.deepStrictEqual(initial.calls.deletes, ["NIC_INVENTORY_CACHE"]);
}

async function backupValidation() {
    const initial = harness();
    const backup = initial.hooks.createBackup(false);
    assert.strictEqual(backup.schema, "naughty-inventory-companion-backup");
    assert.strictEqual(backup.includesApiKey, false);
    assert.strictEqual(Object.hasOwn(backup.data, "NIC_TORN_API_KEY"), false);
    const restored = initial.hooks.validateBackup({ ...backup, data: { ...backup.data, NIC_TORN_API_KEY: "must-not-load" } });
    assert.strictEqual(Object.hasOwn(restored.data, "NIC_TORN_API_KEY"), false);
    assert.throws(() => initial.hooks.validateBackup({ ...backup, schema: "other-companion" }), /compatible Naughty Inventory Companion backup/);
}

async function inventoryExportFormats() {
    const initial = harness();
    initial.hooks.state.inventory = {
        rows: [{ category: "medical", id: 123, name: "First Aid Kit", quantity: 12, price: 4500, total: 54000, equipped: false, bonusText: "", modsText: "", factionOwned: false }],
        totalCount: 12,
        totalValue: 54000,
        syncedAt: Date.UTC(2026, 7, 24, 18, 0, 0),
        failedCategories: ["book"]
    };
    const data = initial.hooks.inventoryExportData();
    const csv = initial.hooks.createInventoryCsv(data);
    const spreadsheet = initial.hooks.createInventorySpreadsheet(data);

    assert.match(csv, /Naughty Inventory Companion snapshot/);
    assert.match(csv, /\$54,000/);
    assert.match(csv, /First Aid Kit/);
    assert.equal(spreadsheet[0], 0x50);
    assert.equal(spreadsheet[1], 0x4B);
    const xlsxText = Buffer.from(spreadsheet).toString("utf8");
    assert.match(xlsxText, /xl\/worksheets\/sheet1\.xml/);
    assert.match(xlsxText, /Naughty Inventory Companion snapshot/);
}

(async () => {
    await nativePreferredRead();
    await oneTimeMigration();
    await quotaFallbackAndQueue();
    await deletesBothStores();
    await backupValidation();
    await inventoryExportFormats();
    console.log("Inventory storage adapter checks passed: native preference, migration, quota fallback, queue, deletes, backup validation, and export formats.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
