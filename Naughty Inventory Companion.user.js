// ==UserScript==
// @name         Naughty Inventory Companion
// @namespace    https://github.com/xf4k31tx/Naughty-Inventory-Companion
// @version      1.2.3
// @description  Manual Torn inventory tracker with live market values, equipment perks, mods, and loan status.
// @author       sharpsplinter [315311]
// @match        https://www.torn.com/item.php*
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://www.torn.com/bazaar.php*
// @source       https://raw.githubusercontent.com/xf4k31tx/Naughty-Inventory-Companion/main/Naughty%20Inventory%20Companion.user.js
// @updateURL    https://raw.githubusercontent.com/xf4k31tx/Naughty-Inventory-Companion/main/Naughty%20Inventory%20Companion.user.js
// @downloadURL  https://raw.githubusercontent.com/xf4k31tx/Naughty-Inventory-Companion/main/Naughty%20Inventory%20Companion.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        unsafeWindow
// @connect      api.torn.com
// @run-at       document-end
// ==/UserScript==

(function () {
    "use strict";

    const VERSION = "1.2.3";
    const BASE_URL = "https://api.torn.com/v2/";
    const LOG_PREFIX = "[Naughty Inventory Companion]";
    const consoleEvent = (level, message, details = {}) => {
        try {
            if (typeof console === "undefined") return;
            const write = typeof console[level] === "function" ? console[level] : console.info;
            write.call(console, LOG_PREFIX + " " + message, details);
        } catch {}
    };
    const logInfo = (message, details) => consoleEvent("info", message, details);
    const logDebug = (message, details) => consoleEvent("info", "debug: " + message, details);
    const logWarn = (message, details) => consoleEvent("warn", message, details);
    const logError = (message, details) => consoleEvent("error", message, details);
    const elapsedMilliseconds = (startedAt) => Math.max(0, Math.round((window.performance?.now?.() ?? Date.now()) - startedAt));
    const safeErrorCategory = (error) => error?.code === "QuotaExceeded" ? "QuotaExceeded" : error?.name === "AbortError" ? "AbortError" : "unavailable";
    function requestSummary(url) {
        try {
            const request = new URL(url, BASE_URL);
            return { method: "GET", host: request.host, path: request.pathname };
        } catch {
            return { method: "GET", host: "unknown", path: "unknown" };
        }
    }
    const RUNTIME = (() => {
        const userAgent = navigator.userAgent || "";
        const hasTornPdaUserAgent = /\bTornPDA\b|com\.manuito\.tornpda/i.test(userAgent);
        const listeners = new Set();
        let isTornPDA = false;
        let flutterReady = false;
        let nativeCheckComplete = false;
        let nativeCheckPromise = null;
        let nativeCheckVersion = 0;
        let startupPromise = null;
        const notify = () => listeners.forEach((listener) => {
            try { listener(); } catch {}
        });
        const confirmNativeRuntime = async (force = false) => {
            if (nativeCheckPromise && !force) return nativeCheckPromise;
            if (force) nativeCheckPromise = null;
            const checkVersion = ++nativeCheckVersion;
            nativeCheckPromise = (async () => {
                const bridge = getFlutterBridge();
                if (!bridge) {
                    if (checkVersion === nativeCheckVersion) nativeCheckComplete = true;
                    logDebug("Native TornPDA check skipped; Flutter bridge is unavailable.", { userAgentHint: hasTornPdaUserAgent });
                    return false;
                }
                flutterReady = true;
                let confirmed = false;
                try {
                    logDebug("Confirming native TornPDA runtime.", { force, flutterReady });
                    const response = await bridge.callHandler("isTornPDA");
                    confirmed = response?.isTornPDA === true;
                } catch (error) {
                    logWarn("Native TornPDA confirmation failed; desktop-compatible behavior remains active.", { category: safeErrorCategory(error) });
                } finally {
                    if (checkVersion !== nativeCheckVersion) return confirmed;
                    isTornPDA = confirmed;
                    nativeCheckComplete = true;
                    logInfo("Native runtime check complete.", { tornPDA: confirmed, flutterReady });
                    notify();
                }
                return confirmed;
            })();
            return nativeCheckPromise;
        };
        const initialize = () => {
            if (startupPromise) return startupPromise;
            startupPromise = new Promise((resolve) => {
                let settled = false;
                let platformEventReceived = false;
                const settle = (value) => {
                    if (settled) return;
                    settled = true;
                    resolve(value);
                };
                const checkWhenReady = () => {
                    flutterReady = true;
                    logDebug("Flutter bridge is ready; checking native TornPDA state.", { platformEventReceived });
                    void confirmNativeRuntime(platformEventReceived).then(settle, () => settle(false));
                };
                window.addEventListener("flutterInAppWebViewPlatformReady", () => {
                    platformEventReceived = true;
                    checkWhenReady();
                }, { once: true });
                const bridgeAvailable = Boolean(getFlutterBridge());
                const storageAvailable = Boolean(getPdaStorage());
                logInfo("Startup runtime detection.", { version: VERSION, userAgentHint: hasTornPdaUserAgent, bridgeAvailable, storageAvailable });
                if (bridgeAvailable) {
                    checkWhenReady();
                    return;
                }
                if (!hasTornPdaUserAgent && !storageAvailable) {
                    nativeCheckComplete = true;
                    logInfo("Desktop runtime selected; no TornPDA bridge signals found.", { tornPDA: false });
                    settle(false);
                    return;
                }
                window.setTimeout(() => {
                    if (!nativeCheckComplete) {
                        nativeCheckComplete = true;
                        logWarn("Native runtime readiness timed out; continuing with desktop-compatible behavior.", { timeoutMs: 1500 });
                        notify();
                    }
                    settle(false);
                }, 1500);
            });
            return startupPromise;
        };
        return {
            get isTornPDA() { return isTornPDA; },
            get flutterReady() { return flutterReady; },
            get nativeCheckComplete() { return nativeCheckComplete; },
            get name() { return isTornPDA ? "TornPDA" : "Desktop"; },
            initialize,
            onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
            canUseNativeHttp() { return isTornPDA && flutterReady && Boolean(getFlutterBridge()); },
            nativeHttpGet(url, headers) {
                const bridge = getFlutterBridge();
                if (!isTornPDA || !flutterReady || !bridge) return Promise.reject(new Error("TornPDA HTTP handler is unavailable"));
                return bridge.callHandler("PDA_httpGet", url, headers);
            }
        };
    })();
    const RUNTIME_READY = RUNTIME.initialize();
    const INVENTORY_CATEGORIES = [
        "medical", "drug", "booster", "alcohol", "candy", "enhancer", "jewelry",
        "plushie", "flower", "temporary", "clothing", "car", "artifact", "book",
        "special", "other", "melee", "primary", "secondary", "tool", "defensive",
        "material", "collectible"
    ];
    const LOANABLE_CATEGORIES = new Set(["temporary", "melee", "primary", "secondary", "tool", "defensive"]);
    // The desktop parent and detail grids need roughly 664px after their columns, gaps, and nested padding.
    const COMPACT_DETAIL_WIDTH = 680;
    const PARENT_SORT_OPTIONS = [
        ["category", "Category"], ["distinctItems", "Items"], ["quantity", "Quantity"],
        ["value", "Category Value"], ["loaned", "Loaned"]
    ];
    const ITEM_SORT_OPTIONS = [
        ["name", "Name"], ["quantity", "Quantity"], ["price", "Unit Value"], ["total", "Item Total"],
        ["bonusText", "Bonus / Perks"], ["modsText", "Mods"], ["factionOwned", "Loan Status"]
    ];
    const STORAGE = {
        key: "NIC_TORN_API_KEY",
        dashboard: "NIC_DASHBOARD_STATE",
        position: "NIC_WIDGET_POSITION",
        inventory: "NIC_INVENTORY_CACHE"
    };
    const STORAGE_KEYS = Object.values(STORAGE);
    const state = {
        apiKey: "",
        activeTab: "inventory",
        theme: "dark",
        isMinimized: false,
        windowSizes: {},
        position: null,
        inventory: null,
        refreshInFlight: false,
        status: "Manual refresh only.",
        error: "",
        dashboard: null,
        parentSort: { key: "value", direction: "desc" },
        itemSort: { key: "total", direction: "desc" },
        expandedCategories: new Set(),
        filter: ""
    };
    const PERSISTENCE = {
        pdaStorage: null,
        pdaCache: Object.create(null),
        pdaEnabled: false,
        pdaQuotaExceeded: false,
        hydrated: false
    };
    let filterRenderTimer = 0;

    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
    const formatInteger = (value) => {
        const number = Number(value ?? 0);
        return Number.isFinite(number) ? Math.round(number).toLocaleString() : "0";
    };
    const formatMoney = (value) => {
        const number = Number(value ?? 0);
        return "$" + (Number.isFinite(number) ? Math.round(number).toLocaleString() : "0");
    };
    const formatRelative = (milliseconds) => {
        const elapsed = Math.max(0, Date.now() - Number(milliseconds || 0));
        if (elapsed < 60000) return "just now";
        if (elapsed < 3600000) return Math.floor(elapsed / 60000) + "m ago";
        if (elapsed < 86400000) return Math.floor(elapsed / 3600000) + "h ago";
        return Math.floor(elapsed / 86400000) + "d ago";
    };
    const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
    const compareValues = (left, right, direction) => {
        const a = typeof left === "string" ? left.toLowerCase() : Number(left || 0);
        const b = typeof right === "string" ? right.toLowerCase() : Number(right || 0);
        if (a < b) return direction === "asc" ? -1 : 1;
        if (a > b) return direction === "asc" ? 1 : -1;
        return 0;
    };

    function getPageWindow() {
        try {
            if (typeof unsafeWindow !== "undefined" && unsafeWindow) return unsafeWindow;
        } catch {}
        return window;
    }
    function getFlutterBridge() {
        const pageWindow = getPageWindow();
        const bridge = pageWindow?.flutter_inappwebview || window.flutter_inappwebview;
        return typeof bridge?.callHandler === "function" ? bridge : null;
    }
    function getPdaStorage() {
        try {
            if (typeof PDA_storage !== "undefined" && PDA_storage) return PDA_storage;
        } catch {}
        const pageWindow = getPageWindow();
        return pageWindow?.PDA_storage || window.PDA_storage || null;
    }
    async function gmGet(key, fallback) {
        try {
            if (typeof GM !== "undefined" && typeof GM.getValue === "function") return await GM.getValue(key, fallback);
            if (typeof GM_getValue === "function") return await Promise.resolve(GM_getValue(key, fallback));
        } catch {}
        return fallback;
    }
    async function gmSet(key, value) {
        try {
            if (typeof GM !== "undefined" && typeof GM.setValue === "function") {
                await GM.setValue(key, value);
                return true;
            }
            if (typeof GM_setValue === "function") {
                await Promise.resolve(GM_setValue(key, value));
                return true;
            }
        } catch {}
        return false;
    }
    function localGet(key, fallback) {
        try {
            const raw = window.localStorage?.getItem(key);
            return raw === null || raw === undefined ? fallback : JSON.parse(raw);
        } catch {}
        return fallback;
    }
    function localSet(key, value) {
        try {
            window.localStorage?.setItem(key, JSON.stringify(value));
            return true;
        } catch {}
        return false;
    }
    async function legacyGet(key, fallback) {
        const value = await gmGet(key, undefined);
        return value === undefined ? localGet(key, fallback) : value;
    }
    async function legacySetValues(values) {
        await Promise.all(Object.entries(values).map(async ([key, value]) => {
            if (!await gmSet(key, value)) localSet(key, value);
        }));
    }
    async function legacyValues() {
        const values = await Promise.all(STORAGE_KEYS.map((key) => legacyGet(key, undefined)));
        return Object.fromEntries(STORAGE_KEYS.map((key, index) => [key, values[index]]));
    }
    function isStorageRecord(value) {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }
    async function readPdaCache(storage) {
        if (typeof storage?.loadAll === "function") {
            const values = await storage.loadAll();
            return isStorageRecord(values) ? values : {};
        }
        if (typeof storage?.getMany === "function") {
            const values = await storage.getMany(STORAGE_KEYS);
            return isStorageRecord(values) ? values : {};
        }
        return {};
    }
    async function writePdaValues(values) {
        const entries = Object.entries(values);
        const storage = PERSISTENCE.pdaStorage;
        if (!entries.length) return true;
        if (!PERSISTENCE.pdaEnabled || PERSISTENCE.pdaQuotaExceeded || !storage) return false;
        try {
            if (typeof storage.setMany === "function") await storage.setMany(values);
            else await Promise.all(entries.map(([key, value]) => storage.set(key, value)));
            Object.assign(PERSISTENCE.pdaCache, values);
            return true;
        } catch (error) {
            if (error?.code === "QuotaExceeded") {
                PERSISTENCE.pdaQuotaExceeded = true;
                logWarn("PDA_storage quota reached; userscript storage will keep future changes safe.", { keys: entries.length, category: "QuotaExceeded" });
            } else {
                logWarn("PDA_storage write failed; userscript storage fallback will be used.", { keys: entries.length, category: safeErrorCategory(error) });
            }
            return false;
        }
    }
    async function persistValues(values) {
        if (await writePdaValues(values)) return;
        await legacySetValues(values);
    }
    async function loadStoredValues() {
        const storage = getPdaStorage();
        if (storage && (typeof storage.loadAll === "function" || typeof storage.getMany === "function")) {
            try {
                logDebug("Loading PDA_storage cache at startup.", { method: typeof storage.loadAll === "function" ? "loadAll" : "getMany" });
                PERSISTENCE.pdaStorage = storage;
                PERSISTENCE.pdaCache = await readPdaCache(storage);
                PERSISTENCE.pdaEnabled = true;
                const missing = STORAGE_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(PERSISTENCE.pdaCache, key));
                const fallback = missing.length ? await legacyValues() : {};
                const migration = Object.fromEntries(missing
                    .filter((key) => fallback[key] !== undefined)
                    .map((key) => [key, fallback[key]]));
                if (Object.keys(migration).length && !await writePdaValues(migration)) await legacySetValues(migration);
                logInfo("PDA_storage cache is active.", { cachedKeys: Object.keys(PERSISTENCE.pdaCache).length, migratedKeys: Object.keys(migration).length });
                return Object.fromEntries(STORAGE_KEYS.map((key) => [
                    key,
                    Object.prototype.hasOwnProperty.call(PERSISTENCE.pdaCache, key) ? PERSISTENCE.pdaCache[key] : fallback[key]
                ]));
            } catch (error) {
                logWarn("PDA_storage startup load failed; using userscript storage fallback.", { category: safeErrorCategory(error) });
            }
            PERSISTENCE.pdaStorage = null;
            PERSISTENCE.pdaCache = Object.create(null);
            PERSISTENCE.pdaEnabled = false;
        }
        logInfo("Using userscript storage fallback.", { nativeStorageAvailable: Boolean(storage) });
        return legacyValues();
    }
    async function promotePdaStorage() {
        if (!PERSISTENCE.hydrated || PERSISTENCE.pdaEnabled) return;
        const storage = getPdaStorage();
        if (!storage || (typeof storage.loadAll !== "function" && typeof storage.getMany !== "function")) return;
        try {
            logDebug("Promoting compatibility storage into PDA_storage.");
            PERSISTENCE.pdaStorage = storage;
            PERSISTENCE.pdaCache = await readPdaCache(storage);
            PERSISTENCE.pdaEnabled = true;
            const values = currentStoredValues();
            const migration = Object.fromEntries(Object.entries(values)
                .filter(([key]) => !Object.prototype.hasOwnProperty.call(PERSISTENCE.pdaCache, key)));
            if (Object.keys(migration).length && !await writePdaValues(migration)) await legacySetValues(migration);
            logInfo("PDA_storage promotion completed.", { cachedKeys: Object.keys(PERSISTENCE.pdaCache).length, migratedKeys: Object.keys(migration).length });
        } catch (error) {
            logWarn("PDA_storage promotion failed; userscript storage fallback remains active.", { category: safeErrorCategory(error) });
            PERSISTENCE.pdaStorage = null;
            PERSISTENCE.pdaCache = Object.create(null);
            PERSISTENCE.pdaEnabled = false;
        }
    }
    function requestJson(url) {
        const request = requestSummary(url);
        const startedAt = window.performance?.now?.() ?? Date.now();
        return new Promise((resolve, reject) => {
            let transport = "unselected";
            let completed = false;
            const requestDetails = (details = {}) => ({ ...request, transport, durationMs: elapsedMilliseconds(startedAt), ...details });
            const start = (nextTransport) => {
                transport = nextTransport;
                logInfo("API request.", { ...request, transport });
            };
            const fail = (reason, details = {}, userMessage = reason) => {
                if (completed) return;
                completed = true;
                logError("API request failed.", requestDetails({ reason, ...details }));
                reject(new Error(userMessage));
            };
            const succeed = (status) => {
                if (completed) return;
                completed = true;
                logInfo("API request succeeded.", requestDetails({ status }));
            };
            const onload = (response) => {
                const status = Number(response?.status ?? 200);
                if (status < 200 || status >= 300) {
                    fail("HTTP " + status, { status });
                    return;
                }
                try {
                    const responseText = typeof response === "string" ? response : (response?.responseText ?? JSON.stringify(response?.body ?? response));
                    const data = JSON.parse(responseText);
                    if (data?.error) {
                        fail("Torn API error", { status }, data.error.error || "Torn API error");
                        return;
                    }
                    succeed(status);
                    resolve(data);
                } catch {
                    fail("Unable to parse Torn API response", { status });
                }
            };
            const onerror = () => fail("Network request failed");
            const details = {
                method: "GET",
                url,
                headers: { Accept: "application/json" },
                onload,
                onerror
            };
            const requestWithFetch = (fallbackFrom = "") => {
                if (fallbackFrom) logWarn("API transport fallback.", requestDetails({ from: fallbackFrom, to: "fetch" }));
                start("fetch");
                try {
                    void fetch(url, { headers: details.headers })
                        .then(async (response) => ({ status: response.status, responseText: await response.text() }))
                        .then(onload, onerror);
                } catch {
                    onerror();
                }
            };
            try {
                if (typeof GM_xmlhttpRequest === "function") {
                    start("GM_xmlhttpRequest");
                    GM_xmlhttpRequest(details);
                    return;
                }
                if (typeof GM !== "undefined" && typeof GM.xmlHttpRequest === "function") {
                    start("GM.xmlHttpRequest");
                    GM.xmlHttpRequest(details);
                    return;
                }
                if (RUNTIME.canUseNativeHttp()) {
                    start("TornPDA PDA_httpGet");
                    void RUNTIME.nativeHttpGet(url, details.headers).then(onload, (error) => requestWithFetch("TornPDA PDA_httpGet:" + safeErrorCategory(error)));
                    return;
                }
                requestWithFetch();
            } catch (error) {
                if (transport === "TornPDA PDA_httpGet") requestWithFetch("TornPDA PDA_httpGet:" + safeErrorCategory(error));
                else fail("Request initialization failed", { category: safeErrorCategory(error) });
            }
        });
    }
    function apiUrl(path, params = {}) {
        return BASE_URL + path + "?" + new URLSearchParams({ key: state.apiKey, ...params });
    }
    function normalizeBonusText(bonuses) {
        if (!Array.isArray(bonuses) || !bonuses.length) return "";
        const formatted = bonuses.map((bonus) => {
            if (!bonus) return "";
            if (typeof bonus === "string") return bonus.trim();
            const name = String(bonus.title || bonus.name || "").trim();
            const rawValue = bonus.value ?? bonus.amount ?? bonus.percent ?? bonus.bonus ?? bonus.percentage;
            if (!name) return "";
            if (rawValue === undefined || rawValue === null || rawValue === "") return name;
            const numeric = Number(rawValue);
            const suffix = Number.isFinite(numeric) && !name.includes("%") ? " +" + numeric + "%" : String(rawValue).trim();
            return name + suffix;
        }).filter(Boolean);
        const unique = [...new Set(formatted.map((item) => String(item).trim()))].filter(Boolean);
        return unique.slice(0, 4).join(", ") + (unique.length > 4 ? ", …" : "");
    }
    function normalizeModsText(mods) {
        if (!Array.isArray(mods) || !mods.length) return "";
        const unique = [...new Set(mods.map((mod) => {
            if (!mod) return "";
            return typeof mod === "string" ? mod.trim() : String(mod.name || mod.title || "").trim();
        }).filter(Boolean))];
        return unique.slice(0, 4).join(", ") + (unique.length > 4 ? ", …" : "");
    }
    function catalogPrice(entry) {
        const value = entry?.value || {};
        const price = value.market_price ?? entry?.market_value ?? value.sell_price ?? entry?.value ?? 0;
        return Math.max(0, Number(price) || 0);
    }
    async function fetchPriceMap() {
        const response = await requestJson(apiUrl("torn/items", { cat: "All" }));
        const items = Array.isArray(response?.items) ? response.items : (Array.isArray(response) ? response : []);
        return new Map(items.map((item) => [Number(item.id), catalogPrice(item)]));
    }
    async function fetchEquipmentMaps() {
        const response = await requestJson(apiUrl("user/equipment")).catch(() => ({ equipment: [] }));
        const equipment = Array.isArray(response?.equipment) ? response.equipment : [];
        const bonuses = new Map();
        const mods = new Map();
        equipment.forEach((item) => {
            const uid = item?.uid;
            if (!uid) return;
            const key = String(uid);
            if (Array.isArray(item.bonuses) && item.bonuses.length) bonuses.set(key, item.bonuses);
            if (Array.isArray(item.mods) && item.mods.length) mods.set(key, item.mods);
        });
        return { bonuses, mods };
    }
    async function fetchInventory() {
        if (!state.apiKey || state.refreshInFlight || state.isMinimized) return;
        const refreshStartedAt = window.performance?.now?.() ?? Date.now();
        state.refreshInFlight = true;
        state.error = "";
        state.status = "Fetching Torn item-market prices…";
        logInfo("Manual inventory refresh started.", { categories: INVENTORY_CATEGORIES.length });
        render();
        const rows = [];
        const failures = [];
        try {
            const [priceMap, equipmentMaps] = await Promise.all([fetchPriceMap(), fetchEquipmentMaps()]);
            for (let index = 0; index < INVENTORY_CATEGORIES.length; index += 1) {
                const category = INVENTORY_CATEGORIES[index];
                state.status = "Fetching " + category + " (" + (index + 1) + "/" + INVENTORY_CATEGORIES.length + ")…";
                render();
                try {
                    const response = await requestJson(apiUrl("user/inventory", { cat: category }));
                    const items = Array.isArray(response?.inventory?.items) ? response.inventory.items : [];
                    items.forEach((item) => {
                        const quantity = Math.max(0, Number(item.amount ?? item.quantity ?? item.qty ?? item.count ?? 0) || 0);
                        const price = priceMap.get(Number(item.id)) || 0;
                        const uid = item.uid ? String(item.uid) : "";
                        const equipped = item.equipped === true;
                        rows.push({
                            category,
                            id: Number(item.id || 0),
                            uid,
                            name: item.name || "Unknown Item",
                            quantity,
                            price,
                            total: quantity * price,
                            factionOwned: item.faction_owned === true,
                            equipped,
                            bonusText: equipped ? normalizeBonusText(equipmentMaps.bonuses.get(uid)) : "",
                            modsText: equipped ? normalizeModsText(equipmentMaps.mods.get(uid)) : ""
                        });
                    });
                } catch {
                    failures.push(category);
                    logWarn("Inventory category could not be loaded.", { category });
                }
                if (index < INVENTORY_CATEGORIES.length - 1) await new Promise((resolve) => setTimeout(resolve, 650));
            }
            const totalCount = rows.reduce((sum, item) => sum + item.quantity, 0);
            const totalValue = rows.reduce((sum, item) => sum + item.total, 0);
            state.inventory = {
                rows,
                totalCount,
                totalValue,
                syncedAt: Date.now(),
                failedCategories: failures
            };
            void persistValues({ [STORAGE.inventory]: state.inventory });
            state.status = "Live Torn market values loaded.";
            logInfo("Manual inventory refresh completed.", {
                items: rows.length,
                failedCategories: failures.length,
                durationMs: elapsedMilliseconds(refreshStartedAt)
            });
        } catch (error) {
            state.error = error.message || "Unable to refresh inventory";
            state.status = "Refresh failed.";
            logError("Manual inventory refresh failed.", { category: safeErrorCategory(error), durationMs: elapsedMilliseconds(refreshStartedAt) });
        } finally {
            state.refreshInFlight = false;
            render();
        }
    }
    function aggregateCategories(rows) {
        const groups = new Map();
        rows.forEach((item) => {
            if (!groups.has(item.category)) {
                groups.set(item.category, { category: item.category, items: [], distinctItems: 0, quantity: 0, value: 0, loaned: 0 });
            }
            const group = groups.get(item.category);
            group.items.push(item);
            group.distinctItems += 1;
            group.quantity += item.quantity;
            group.value += item.total;
            if (item.factionOwned) group.loaned += 1;
        });
        return [...groups.values()];
    }
    function sortIndicator(current, key) {
        if (current.key !== key) return "↕";
        return current.direction === "asc" ? "↑" : "↓";
    }
    function parentHeader(label, key) {
        return "<button class='nic-column-button' data-parent-sort='" + key + "'>" + label + " <span>" + sortIndicator(state.parentSort, key) + "</span></button>";
    }
    function itemHeader(label, key) {
        return "<button class='nic-nested-button' data-item-sort='" + key + "'>" + label + " <span>" + sortIndicator(state.itemSort, key) + "</span></button>";
    }
    function compactItemSortControls() {
        const direction = state.itemSort.direction === "asc" ? "↑ Asc" : "↓ Desc";
        return "<div class='nic-compact-sort'><span>Sort items</span><select data-item-sort-select aria-label='Sort expanded items by'>" +
            ITEM_SORT_OPTIONS.map(([key, label]) => "<option value='" + key + "'" + (state.itemSort.key === key ? " selected" : "") + ">" + label + "</option>").join("") +
            "</select><button data-action='flip-item-sort' title='Reverse item sort order'>" + direction + "</button></div>";
    }
    function compactParentSortControls() {
        const direction = state.parentSort.direction === "asc" ? "↑ Asc" : "↓ Desc";
        return "<div class='nic-compact-parent-sort'><span>Sort categories</span><select data-parent-sort-select aria-label='Sort categories by'>" +
            PARENT_SORT_OPTIONS.map(([key, label]) => "<option value='" + key + "'" + (state.parentSort.key === key ? " selected" : "") + ">" + label + "</option>").join("") +
            "</select><button data-action='flip-parent-sort' title='Reverse category sort order'>" + direction + "</button></div>";
    }
    function loanStatus(item, category) {
        if (!LOANABLE_CATEGORIES.has(category)) return "<span class='nic-muted'>—</span>";
        return item.factionOwned
            ? "<span class='nic-loaned'>Loaned</span>"
            : "<span class='nic-owned'>Owned</span>";
    }
    function nestedRows(group) {
        const items = [...group.items].sort((a, b) => {
            const result = compareValues(a[state.itemSort.key], b[state.itemSort.key], state.itemSort.direction);
            return result || a.name.localeCompare(b.name);
        });
        return "<div class='nic-nested'>" + compactItemSortControls() + "<div class='nic-item-header'>" +
            itemHeader("Item", "name") + itemHeader("Qty", "quantity") + itemHeader("Unit Value", "price") +
            itemHeader("Item Total", "total") + itemHeader("Bonus / Perks", "bonusText") +
            itemHeader("Mods", "modsText") + itemHeader("Loaned", "factionOwned") + "</div>" +
            items.map((item) =>
                "<article class='nic-item-row'>" +
                "<div class='nic-item-name'>" + escapeHtml(item.name) + (item.equipped ? "<span class='nic-equipped'>Equipped</span>" : "") + "</div>" +
                "<div><span class='nic-detail-value'>" + formatInteger(item.quantity) + "</span></div><div class='nic-money'><span class='nic-detail-value'>" + formatMoney(item.price) + "</span></div>" +
                "<div class='nic-money nic-total'><span class='nic-detail-value'>" + formatMoney(item.total) + "</span></div>" +
                "<div class='nic-perks'><span class='nic-detail-value'>" + (item.bonusText ? escapeHtml(item.bonusText) : "—") + "</span></div>" +
                "<div class='nic-mods'><span class='nic-detail-value'>" + (item.modsText ? escapeHtml(item.modsText) : "—") + "</span></div>" +
                "<div><span class='nic-detail-value'>" + loanStatus(item, group.category) + "</span></div></article>"
            ).join("") + "</div>";
    }
    function inventoryView() {
        const inventory = state.inventory;
        if (!inventory) {
            return "<div class='nic-empty'>Save a Torn API key under Settings, then use the manual Refresh button.</div>";
        }
        const filter = state.filter.trim().toLowerCase();
        const rows = filter ? inventory.rows.filter((item) => item.name.toLowerCase().includes(filter) || item.category.includes(filter)) : inventory.rows;
        const groups = aggregateCategories(rows).sort((a, b) => {
            const result = compareValues(a[state.parentSort.key], b[state.parentSort.key], state.parentSort.direction);
            return result || a.category.localeCompare(b.category);
        });
        const failures = Array.isArray(inventory.failedCategories) && inventory.failedCategories.length
            ? "<div class='nic-warning'>Unavailable categories: " + escapeHtml(inventory.failedCategories.join(", ")) + "</div>" : "";
        return "<section class='nic-layout'>" +
            "<div class='nic-summary-grid'><div class='nic-summary-card'><span>Tracked Items</span><strong>" + formatInteger(inventory.totalCount) + "</strong><small>Across all inventory categories</small></div>" +
            "<div class='nic-summary-card'><span>Live Inventory Value</span><strong>" + formatMoney(inventory.totalValue) + "</strong><small>Current Torn catalog market prices</small></div>" +
            "<div class='nic-summary-card'><span>Categories</span><strong>" + formatInteger(groups.length) + "</strong><small>Click a category to inspect its items</small></div></div>" +
            failures +
            "<div class='nic-toolbar'><input id='nic-filter' value='" + escapeHtml(state.filter) + "' placeholder='Filter categories or item names'><span>" +
            (inventory.syncedAt ? "Price snapshot " + formatRelative(inventory.syncedAt) : "No snapshot") + "</span></div>" +
            "<section class='nic-category-table'>" + compactParentSortControls() + "<div class='nic-parent-header'>" +
            parentHeader("Category", "category") + parentHeader("Items", "distinctItems") + parentHeader("Qty", "quantity") +
            parentHeader("Category Value", "value") + parentHeader("Loaned", "loaned") + "</div>" +
            (groups.length ? groups.map((group) => {
                const expanded = state.expandedCategories.has(group.category);
                const loaned = LOANABLE_CATEGORIES.has(group.category) ? String(group.loaned) : "—";
                return "<section class='nic-category' data-category='" + escapeHtml(group.category) + "'><button class='nic-category-row' data-toggle-category='" +
                    escapeHtml(group.category) + "'><div class='nic-category-name'><span class='nic-caret'>" + (expanded ? "⌄" : "›") +
                    "</span>" + escapeHtml(group.category) + "</div><div>" + formatInteger(group.distinctItems) + "</div><div>" +
                    formatInteger(group.quantity) + "</div><div class='nic-money nic-total'>" + formatMoney(group.value) + "</div><div>" +
                    loaned + "</div></button>" + (expanded ? nestedRows(group) : "") + "</section>";
            }).join("") : "<div class='nic-empty'>No inventory rows match the current filter.</div>") + "</section></section>";
    }
    function settingsView() {
        const storageLabel = PERSISTENCE.pdaEnabled
            ? (PERSISTENCE.pdaQuotaExceeded ? "TornPDA storage is full; userscript storage is keeping new changes safe." : "TornPDA per-script storage is active.")
            : "Userscript storage fallback is active.";
        return "<section class='nic-settings nic-card'><div class='nic-card-title'><div><h2>Settings</h2><div class='nic-runtime' title='Native TornPDA confirmation and viewport mode are checked independently'><span>Runtime</span><strong>" + runtimeInfo().label + "</strong></div></div><button data-tab='inventory'>Inventory</button></div>" +
            "<label for='nic-api-key'>Torn API Key</label><div class='nic-key-row'><input id='nic-api-key' type='password' autocomplete='off' value='" +
            escapeHtml(state.apiKey) + "' placeholder='Enter Torn API key'><button data-action='save-key'>Save Key</button></div>" +
            "<p>Inventory is manual-refresh only. Each refresh retrieves the current Torn item catalog market price, inventory categories, and equipped item bonuses/mods.</p>" +
            "<p>Storage: " + storageLabel + "</p>" +
            "<div class='nic-setting-actions'><button data-action='toggle-theme'>Use " + (state.theme === "dark" ? "Light" : "Dark") + " Mode</button>" +
            "<button data-action='clear-cache'>Clear Cached Inventory</button></div></section>";
    }
    function dashboardStateValue() {
        return {
            activeTab: state.activeTab, theme: state.theme, isMinimized: state.isMinimized,
            windowSizes: state.windowSizes, parentSort: state.parentSort, itemSort: state.itemSort,
            expandedCategories: [...state.expandedCategories], filter: state.filter
        };
    }
    function currentStoredValues() {
        return {
            [STORAGE.key]: state.apiKey,
            [STORAGE.dashboard]: dashboardStateValue(),
            [STORAGE.position]: state.position,
            [STORAGE.inventory]: state.inventory
        };
    }
    function saveDashboardState() {
        void persistValues({ [STORAGE.dashboard]: dashboardStateValue() });
    }
    function sizeKey() {
        return state.activeTab === "settings" ? "settings" : "inventory";
    }
    function getViewportMetrics() {
        const viewport = window.visualViewport;
        return {
            width: Math.max(1, Math.round(viewport?.width || window.innerWidth || document.documentElement.clientWidth || 1)),
            height: Math.max(1, Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight || 1)),
            left: Math.max(0, Math.round(viewport?.offsetLeft || 0)),
            top: Math.max(0, Math.round(viewport?.offsetTop || 0))
        };
    }
    function runtimeInfo() {
        const viewport = getViewportMetrics();
        const scale = Number(window.visualViewport?.scale) || 1;
        const viewportCompact = viewport.width <= 700 || viewport.height <= 520 || (scale > 1.1 && viewport.width <= 960);
        const compact = RUNTIME.isTornPDA || viewportCompact;
        const platform = RUNTIME.isTornPDA ? "TornPDA" : RUNTIME.nativeCheckComplete ? "Desktop" : "Checking TornPDA";
        return { compact, mode: compact ? "compact" : "desktop", platform, label: platform + " / " + (compact ? "compact view" : "desktop view") };
    }
    function isCompactRuntime() {
        return runtimeInfo().compact;
    }
    function applyRuntimePresentation() {
        const dashboard = state.dashboard;
        if (!dashboard) return runtimeInfo();
        const runtime = runtimeInfo();
        dashboard.dataset.runtime = runtime.mode;
        dashboard.dataset.platform = runtime.platform.toLowerCase().replace(/[^a-z]+/g, "-");
        return runtime;
    }
    function applyCompactViewport() {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        applyRuntimePresentation();
        const viewport = getViewportMetrics();
        dashboard.style.setProperty("--nic-vv-width", viewport.width + "px");
        dashboard.style.setProperty("--nic-vv-height", viewport.height + "px");
        dashboard.style.setProperty("--nic-vv-left", viewport.left + "px");
        dashboard.style.setProperty("--nic-vv-top", viewport.top + "px");
        dashboard.style.removeProperty("left");
        dashboard.style.removeProperty("top");
        dashboard.style.removeProperty("right");
        dashboard.style.removeProperty("bottom");
        dashboard.style.removeProperty("width");
        dashboard.style.removeProperty("height");
    }
    function getSizeLimits() {
        const viewport = getViewportMetrics();
        if (isCompactRuntime()) {
            return { minWidth: 1, minHeight: 1, maxWidth: viewport.width, maxHeight: viewport.height };
        }
        return {
            minWidth: Math.min(380, Math.max(280, window.innerWidth - 20)),
            minHeight: Math.min(620, Math.max(360, window.innerHeight - 20)),
            maxWidth: Math.max(280, window.innerWidth - 20),
            maxHeight: Math.max(360, window.innerHeight - 20)
        };
    }
    function applyCompactDetailLayout() {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        const width = dashboard.getBoundingClientRect().width || getViewportMetrics().width;
        dashboard.dataset.compact = String(!state.isMinimized && width <= COMPACT_DETAIL_WIDTH);
    }
    function applyPosition(position = state.position) {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        if (isCompactRuntime() && !state.isMinimized) {
            applyCompactViewport();
            return;
        }
        applyRuntimePresentation();
        const rect = dashboard.getBoundingClientRect();
        const saved = position || { edge: "right", x: window.innerWidth - rect.width, y: 20 };
        const x = clamp(Number(saved.x || 0), 0, window.innerWidth - rect.width);
        const y = clamp(Number(saved.y || 0), 0, window.innerHeight - rect.height);
        dashboard.style.right = "auto";
        dashboard.style.bottom = "auto";
        if (saved.edge === "left") { dashboard.style.left = "0px"; dashboard.style.top = y + "px"; }
        else if (saved.edge === "top") { dashboard.style.left = x + "px"; dashboard.style.top = "0px"; }
        else if (saved.edge === "bottom") { dashboard.style.left = x + "px"; dashboard.style.top = Math.max(0, window.innerHeight - rect.height) + "px"; }
        else { dashboard.style.left = Math.max(0, window.innerWidth - rect.width) + "px"; dashboard.style.top = y + "px"; }
    }
    function savePosition() {
        if (isCompactRuntime()) return;
        const rect = state.dashboard.getBoundingClientRect();
        const distances = { left: rect.left, right: window.innerWidth - rect.right, top: rect.top, bottom: window.innerHeight - rect.bottom };
        const edge = Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0];
        state.position = { edge, x: rect.left, y: rect.top };
        void persistValues({ [STORAGE.position]: state.position });
        applyPosition();
    }
    function saveSize() {
        if (state.isMinimized || isCompactRuntime()) return;
        const rect = state.dashboard.getBoundingClientRect();
        state.windowSizes[sizeKey()] = { width: rect.width, height: rect.height };
        saveDashboardState();
    }
    function applySize() {
        if (state.isMinimized) return;
        const dashboard = state.dashboard;
        if (isCompactRuntime()) {
            applyCompactViewport();
            return;
        }
        const limits = getSizeLimits();
        const saved = state.windowSizes[sizeKey()] || { width: 760, height: Math.min(760, window.innerHeight * .86) };
        dashboard.style.width = clamp(Number(saved.width || 760), limits.minWidth, limits.maxWidth) + "px";
        dashboard.style.height = clamp(Number(saved.height || 620), limits.minHeight, limits.maxHeight) + "px";
        applyPosition();
    }
    function applyWidgetView() {
        const dashboard = state.dashboard;
        const body = dashboard.querySelector("#nic-body");
        const title = dashboard.querySelector("#nic-title");
        const minimize = dashboard.querySelector("#nic-minimize");
        const handles = dashboard.querySelectorAll(".nic-resize");
        dashboard.dataset.minimized = String(state.isMinimized);
        if (state.isMinimized) {
            body.style.setProperty("display", "none", "important");
            dashboard.style.width = "36px";
            dashboard.style.height = "36px";
            dashboard.style.minWidth = "36px";
            dashboard.style.minHeight = "36px";
            dashboard.style.maxWidth = "36px";
            dashboard.style.maxHeight = "36px";
            title.textContent = "NIC";
            title.style.fontSize = "10px";
            minimize.style.display = "none";
            handles.forEach((handle) => { handle.style.display = "none"; });
            dashboard.style.cursor = "pointer";
            dashboard.dataset.compact = "false";
            if (isCompactRuntime()) {
                dashboard.style.left = "auto";
                dashboard.style.top = "calc(env(safe-area-inset-top) + 8px)";
                dashboard.style.right = "calc(env(safe-area-inset-right) + 8px)";
                dashboard.style.bottom = "auto";
            } else {
                applyPosition();
            }
        } else {
            body.style.setProperty("display", "flex", "important");
            dashboard.style.minWidth = "";
            dashboard.style.minHeight = "";
            dashboard.style.maxWidth = "";
            dashboard.style.maxHeight = "";
            title.textContent = "▣ Naughty Inventory Companion v" + VERSION;
            title.style.fontSize = "12px";
            minimize.style.display = "grid";
            handles.forEach((handle) => { handle.style.display = isCompactRuntime() ? "none" : "block"; });
            dashboard.style.cursor = "";
            applySize();
            applyCompactDetailLayout();
        }
    }
    function render() {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        dashboard.dataset.theme = state.theme;
        dashboard.dataset.tab = state.activeTab;
        applyCompactDetailLayout();
        const content = dashboard.querySelector("#nic-content");
        const activeElement = document.activeElement;
        const filterFocus = activeElement?.id === "nic-filter" ? {
            start: activeElement.selectionStart,
            end: activeElement.selectionEnd
        } : null;
        const body = state.activeTab === "settings" ? settingsView() :
            "<div class='nic-topline'><span>" + escapeHtml(state.status) + "</span><button data-action='refresh' " +
            (state.refreshInFlight || !state.apiKey ? "disabled" : "") + ">↻ " + (state.refreshInFlight ? "Refreshing…" : "Refresh") +
            "</button><button data-tab='settings' title='Settings'>⚙</button></div>" +
            (state.error ? "<div class='nic-error'>" + escapeHtml(state.error) + "</div>" : "") + inventoryView();
        content.innerHTML = body;
        dashboard.querySelectorAll("[data-tab]").forEach((button) => button.onclick = () => {
            state.activeTab = button.dataset.tab;
            saveDashboardState();
            applySize();
            render();
        });
        content.querySelector("[data-action='refresh']")?.addEventListener("click", () => void fetchInventory());
        content.querySelector("[data-action='save-key']")?.addEventListener("click", () => {
            state.apiKey = content.querySelector("#nic-api-key").value.trim();
            state.status = state.apiKey ? "API key saved. Inventory refresh is manual-only." : "Manual refresh only.";
            state.error = "";
            void persistValues({ [STORAGE.key]: state.apiKey });
            render();
        });
        content.querySelector("[data-action='toggle-theme']")?.addEventListener("click", () => {
            state.theme = state.theme === "dark" ? "light" : "dark";
            saveDashboardState();
            render();
        });
        content.querySelector("[data-action='clear-cache']")?.addEventListener("click", () => {
            state.inventory = null;
            void persistValues({ [STORAGE.inventory]: null });
            state.status = "Cached inventory cleared.";
            render();
        });
        content.querySelector("#nic-filter")?.addEventListener("input", (event) => {
            state.filter = event.target.value;
            saveDashboardState();
            window.clearTimeout(filterRenderTimer);
            filterRenderTimer = window.setTimeout(() => {
                filterRenderTimer = 0;
                render();
            }, 120);
        });
        content.querySelectorAll("[data-parent-sort]").forEach((button) => button.onclick = () => {
            const key = button.dataset.parentSort;
            state.parentSort = { key, direction: state.parentSort.key === key && state.parentSort.direction === "asc" ? "desc" : "asc" };
            saveDashboardState();
            render();
        });
        content.querySelectorAll("[data-parent-sort-select]").forEach((select) => select.addEventListener("change", (event) => {
            state.parentSort = { key: event.target.value, direction: state.parentSort.direction };
            saveDashboardState();
            render();
        }));
        content.querySelectorAll("[data-action='flip-parent-sort']").forEach((button) => button.addEventListener("click", () => {
            state.parentSort = { key: state.parentSort.key, direction: state.parentSort.direction === "asc" ? "desc" : "asc" };
            saveDashboardState();
            render();
        }));
        content.querySelectorAll("[data-item-sort]").forEach((button) => button.onclick = () => {
            const key = button.dataset.itemSort;
            state.itemSort = { key, direction: state.itemSort.key === key && state.itemSort.direction === "asc" ? "desc" : "asc" };
            saveDashboardState();
            render();
        });
        content.querySelectorAll("[data-item-sort-select]").forEach((select) => select.addEventListener("change", (event) => {
            state.itemSort = { key: event.target.value, direction: state.itemSort.direction };
            saveDashboardState();
            render();
        }));
        content.querySelectorAll("[data-action='flip-item-sort']").forEach((button) => button.addEventListener("click", () => {
            state.itemSort = { key: state.itemSort.key, direction: state.itemSort.direction === "asc" ? "desc" : "asc" };
            saveDashboardState();
            render();
        }));
        content.querySelectorAll("[data-toggle-category]").forEach((button) => button.onclick = () => {
            const category = button.dataset.toggleCategory;
            if (state.expandedCategories.has(category)) state.expandedCategories.delete(category);
            else state.expandedCategories.add(category);
            saveDashboardState();
            render();
        });
        if (filterFocus) {
            const filterInput = content.querySelector("#nic-filter");
            if (filterInput) {
                try { filterInput.focus({ preventScroll: true }); } catch { filterInput.focus(); }
                filterInput.setSelectionRange(filterFocus.start, filterFocus.end);
            }
        }
    }
    function bindWindowControls() {
        const dashboard = state.dashboard;
        const dragHandle = dashboard.querySelector("#nic-drag");
        const usePointerEvents = typeof window.PointerEvent === "function";
        const events = usePointerEvents ? { down: "pointerdown", move: "pointermove", up: "pointerup", cancel: "pointercancel" } : { down: "mousedown", move: "mousemove", up: "mouseup", cancel: null };
        let dragging = false, didDrag = false, dragStart = null, dragOffsetX = 0, dragOffsetY = 0, pointerId = null;
        dragHandle.addEventListener(events.down, (event) => {
            if (isCompactRuntime() || event.target.closest("#nic-minimize") || ("button" in event && event.button !== 0)) return;
            const rect = dashboard.getBoundingClientRect();
            dragging = true;
            didDrag = false;
            dragStart = { x: event.clientX, y: event.clientY };
            dragOffsetX = event.clientX - rect.left;
            dragOffsetY = event.clientY - rect.top;
            pointerId = usePointerEvents ? event.pointerId : null;
            if (usePointerEvents) dragHandle.setPointerCapture?.(event.pointerId);
        });
        document.addEventListener(events.move, (event) => {
            if (!dragging || (usePointerEvents && event.pointerId !== pointerId)) return;
            if (Math.abs(event.clientX - dragStart.x) > 3 || Math.abs(event.clientY - dragStart.y) > 3) didDrag = true;
            const rect = dashboard.getBoundingClientRect();
            dashboard.style.left = clamp(event.clientX - dragOffsetX, 0, window.innerWidth - rect.width) + "px";
            dashboard.style.top = clamp(event.clientY - dragOffsetY, 0, window.innerHeight - rect.height) + "px";
        });
        document.addEventListener(events.up, (event) => {
            if (!dragging || (usePointerEvents && event.pointerId !== pointerId)) return;
            if (usePointerEvents) dragHandle.releasePointerCapture?.(event.pointerId);
            if (didDrag) savePosition();
            dragging = false;
            pointerId = null;
        });
        dashboard.addEventListener("click", () => {
            if (!state.isMinimized || didDrag) return;
            state.isMinimized = false;
            saveDashboardState();
            applyWidgetView();
            render();
        });
        dashboard.querySelector("#nic-minimize").addEventListener("click", (event) => {
            event.stopPropagation();
            saveSize();
            state.isMinimized = true;
            saveDashboardState();
            applyWidgetView();
        });
        let resizing = false, resizeStart = null, resizePointerId = null, resizeHandle = null;
        dashboard.querySelectorAll(".nic-resize").forEach((handle) => handle.addEventListener(events.down, (event) => {
            if (isCompactRuntime() || state.isMinimized || ("button" in event && event.button !== 0)) return;
            event.preventDefault();
            event.stopPropagation();
            resizing = true;
            resizeStart = { x: event.clientX, y: event.clientY, rect: dashboard.getBoundingClientRect(), corner: handle.dataset.corner };
            resizePointerId = usePointerEvents ? event.pointerId : null;
            resizeHandle = handle;
            if (usePointerEvents) handle.setPointerCapture?.(event.pointerId);
            document.body.style.userSelect = "none";
        }));
        document.addEventListener(events.move, (event) => {
            if (!resizing || !resizeStart || (usePointerEvents && event.pointerId !== resizePointerId)) return;
            const limits = getSizeLimits();
            const fromLeft = resizeStart.corner.endsWith("left");
            const fromTop = resizeStart.corner.startsWith("top");
            const width = clamp(resizeStart.rect.width + (fromLeft ? resizeStart.x - event.clientX : event.clientX - resizeStart.x), limits.minWidth, Math.min(limits.maxWidth, fromLeft ? resizeStart.rect.right : window.innerWidth - resizeStart.rect.left));
            const height = clamp(resizeStart.rect.height + (fromTop ? resizeStart.y - event.clientY : event.clientY - resizeStart.y), limits.minHeight, Math.min(limits.maxHeight, fromTop ? resizeStart.rect.bottom : window.innerHeight - resizeStart.rect.top));
            dashboard.style.width = width + "px";
            dashboard.style.height = height + "px";
            dashboard.style.left = (fromLeft ? resizeStart.rect.right - width : resizeStart.rect.left) + "px";
            dashboard.style.top = (fromTop ? resizeStart.rect.bottom - height : resizeStart.rect.top) + "px";
            applyCompactDetailLayout();
        });
        const finishResize = (event) => {
            if (!resizing || (usePointerEvents && event.pointerId !== resizePointerId)) return;
            if (usePointerEvents) {
                try { resizeHandle?.releasePointerCapture?.(event.pointerId); } catch {}
            }
            resizing = false;
            resizeStart = null;
            resizePointerId = null;
            resizeHandle = null;
            document.body.style.userSelect = "";
            saveSize(); savePosition(); render();
        };
        document.addEventListener(events.up, finishResize);
        if (events.cancel) document.addEventListener(events.cancel, finishResize);
        let viewportFrame = 0;
        const syncViewport = () => {
            cancelAnimationFrame(viewportFrame);
            viewportFrame = requestAnimationFrame(() => {
                const priorMode = dashboard.dataset.runtime;
                applyRuntimePresentation();
                applySize();
                applyCompactDetailLayout();
                if (priorMode !== dashboard.dataset.runtime) render();
                else if (!isCompactRuntime()) saveSize();
            });
        };
        window.addEventListener("resize", syncViewport);
        window.addEventListener("orientationchange", syncViewport);
        window.visualViewport?.addEventListener("resize", syncViewport);
        window.visualViewport?.addEventListener("scroll", syncViewport);
        if (typeof ResizeObserver === "function") new ResizeObserver(() => applyCompactDetailLayout()).observe(dashboard);
    }
    function initializeDashboard() {
        const dashboard = document.createElement("aside");
        dashboard.id = "nic-wrapper";
        dashboard.dataset.runtime = runtimeInfo().mode;
        dashboard.innerHTML = `
            <style>
                #nic-wrapper{position:fixed;z-index:999999;display:flex;flex-direction:column;overflow:hidden;background:linear-gradient(150deg,rgba(20,28,42,.985),rgba(13,19,30,.985));color:#edf4ff;border:1px solid #40516d;border-radius:14px;box-shadow:0 16px 38px rgba(0,0,0,.55);font-family:Inter,Segoe UI,Arial,sans-serif;contain:layout style}
                #nic-wrapper[data-theme='light']{background:linear-gradient(145deg,#d9e2ed,#c8d4e1);color:#172438;border-color:#71849c;box-shadow:0 14px 30px rgba(21,35,54,.24)}
                #nic-wrapper[data-runtime='compact']:not([data-minimized='true']){left:calc(var(--nic-vv-left,0px) + env(safe-area-inset-left) + 5px)!important;top:calc(var(--nic-vv-top,0px) + env(safe-area-inset-top) + 5px)!important;right:auto!important;bottom:auto!important;width:max(1px,calc(var(--nic-vv-width,100vw) - env(safe-area-inset-left) - env(safe-area-inset-right) - 10px))!important;height:max(1px,calc(var(--nic-vv-height,100dvh) - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 10px))!important;border-radius:13px}
                #nic-wrapper *,#nic-wrapper *:before,#nic-wrapper *:after{box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere}
                #nic-drag{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:48px;padding:8px 11px;background:linear-gradient(100deg,#1b2a43,#28446a);border-bottom:1px solid #4e6687;cursor:move;user-select:none;touch-action:none}
                #nic-wrapper[data-theme='light'] #nic-drag{background:linear-gradient(100deg,#bbcadd,#d3dee9);border-color:#778ba5}
                #nic-wrapper[data-runtime='compact'] #nic-drag{cursor:default;touch-action:manipulation}
                #nic-wrapper[data-minimized='true'] #nic-drag{height:36px;min-height:36px;padding:0;border:0;justify-content:center;cursor:pointer}
                #nic-title{font-size:12px;font-weight:800;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
                #nic-minimize{display:grid;width:42px;height:36px;min-width:42px;flex:0 0 42px;place-items:center;border:1px solid #7793bb;border-radius:8px;background:#294564;color:#fff;font-size:21px;font-weight:750;line-height:1;cursor:pointer;touch-action:manipulation}
                #nic-wrapper[data-theme='light'] #nic-minimize{background:#dce7f1;color:#1c2a3e;border-color:#718aa7}
                #nic-minimize:hover,button:hover{filter:brightness(1.1);transform:translateY(-1px)}
                #nic-body{display:flex!important;flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:10px;overscroll-behavior:contain}
                #nic-body,.nic-category-table{scrollbar-width:none;scrollbar-color:transparent transparent;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;touch-action:pan-y pinch-zoom}
                #nic-body::-webkit-scrollbar,.nic-category-table::-webkit-scrollbar{display:none;width:0;height:0;background:transparent}
                #nic-body::-webkit-scrollbar-track,.nic-category-table::-webkit-scrollbar-track,#nic-body::-webkit-scrollbar-thumb,.nic-category-table::-webkit-scrollbar-thumb,#nic-body::-webkit-scrollbar-corner,.nic-category-table::-webkit-scrollbar-corner{background:transparent;border:0}
                #nic-content{display:flex;flex:1 1 auto;flex-direction:column;gap:10px;min-height:0;width:100%}
                button{min-height:32px;border:1px solid #526986;border-radius:8px;background:#294563;color:#f6f9ff;padding:6px 9px;font-size:11px;font-weight:750;line-height:1.1;cursor:pointer;transition:filter .15s ease,transform .15s ease;touch-action:manipulation}
                button:disabled{opacity:.5;cursor:not-allowed;transform:none}
                #nic-wrapper[data-theme='light'] button{background:#d2deea;color:#18283d;border-color:#7890aa}
                .nic-topline{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:7px;color:#acbdd3;font-size:10px}
                .nic-topline span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
                .nic-topline button:first-of-type{background:#276f4d;border-color:#409265;color:#fff}
                .nic-summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
                .nic-summary-card,.nic-card{width:100%;border:1px solid #40516d;border-radius:11px;padding:10px;background:linear-gradient(145deg,rgba(40,57,83,.84),rgba(17,25,38,.84));box-shadow:inset 0 1px rgba(255,255,255,.035)}
                #nic-wrapper[data-theme='light'] .nic-summary-card,#nic-wrapper[data-theme='light'] .nic-card{background:linear-gradient(145deg,#e1e9f1,#cedae6);border-color:#8395aa;box-shadow:inset 0 1px rgba(255,255,255,.5)}
                .nic-summary-card span{display:block;color:#aebed3;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.055em}
                #nic-wrapper[data-theme='light'] .nic-summary-card span{color:#425772}
                .nic-summary-card strong{display:block;color:#89dda2;font-size:16px;line-height:1.15;margin:4px 0}
                .nic-summary-card small{display:block;color:#9baabd;font-size:10px;line-height:1.35}
                #nic-wrapper[data-theme='light'] .nic-summary-card small{color:#475d76}
                .nic-layout{display:flex;flex:1 1 auto;flex-direction:column;gap:10px;min-height:0}
                .nic-toolbar{display:flex;align-items:center;gap:8px;color:#9baabd;font-size:10px}
                .nic-toolbar input,.nic-key-row input{width:100%;min-height:34px;min-width:0;border:1px solid #526986;border-radius:8px;background:#111b2a;color:#f4f8ff;padding:7px 9px;font-size:11px;outline:none}
                .nic-toolbar input:focus,.nic-key-row input:focus{border-color:#8eb5e5;box-shadow:0 0 0 2px rgba(110,159,214,.22)}
                #nic-wrapper[data-theme='light'] .nic-toolbar input,#nic-wrapper[data-theme='light'] .nic-key-row input{background:#e6edf4;color:#17263b;border-color:#8397ae}
                .nic-category-table{width:100%;flex:1 1 auto;min-height:132px;overflow-y:auto;overflow-x:hidden;border:1px solid #40516d;border-radius:10px;background:rgba(8,13,22,.45);overscroll-behavior:contain}
                #nic-wrapper[data-theme='light'] .nic-category-table{background:#d5e0eb;border-color:#8193a8}
                .nic-parent-header,.nic-category-row{display:grid;grid-template-columns:minmax(130px,1.7fr) minmax(52px,.65fr) minmax(54px,.7fr) minmax(102px,1.1fr) minmax(56px,.55fr);gap:6px;align-items:center;width:100%}
                .nic-parent-header{position:sticky;top:0;z-index:3;padding:7px;background:#263a57;border-bottom:1px solid #506887}
                #nic-wrapper[data-theme='light'] .nic-parent-header{background:#c4d1df;border-color:#8094ad}
                .nic-column-button,.nic-nested-button{min-height:22px;padding:2px 0;border:0;background:transparent!important;color:inherit!important;text-align:left;font-size:10px;font-weight:800;transform:none!important}
                .nic-column-button span,.nic-nested-button span{color:#8eb5e5}.nic-column-button:not(:first-child){text-align:right}
                .nic-category{border-bottom:1px solid #2a3a51}.nic-category:last-child{border-bottom:0}
                .nic-category-row{min-height:39px;border:0;border-radius:0;background:rgba(34,52,78,.72);padding:8px;color:#edf4ff;text-align:right;font-size:11px}
                #nic-wrapper[data-theme='light'] .nic-category-row{background:#dce6ef;color:#17263b}.nic-category-row:hover{background:#395574}
                #nic-wrapper[data-theme='light'] .nic-category-row:hover{background:#c8d6e3}
                .nic-category-name{text-align:left;font-weight:800;text-transform:capitalize}.nic-caret{display:inline-block;width:16px;color:#8eb5e5;font-size:16px;line-height:10px}.nic-money{text-align:right}.nic-total{color:#89dda2;font-weight:800}
                .nic-nested{padding:0 7px 8px;background:rgba(10,16,26,.58)}#nic-wrapper[data-theme='light'] .nic-nested{background:#d2dde8}
                .nic-compact-sort,.nic-compact-parent-sort{display:none;align-items:center;gap:6px;padding:7px 5px;border-bottom:1px solid #40516d;color:#aebed3;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.035em}.nic-compact-parent-sort{position:sticky;top:0;z-index:3;background:#17253a}.nic-compact-sort select,.nic-compact-parent-sort select{min-width:0;flex:1 1 120px;height:30px;border:1px solid #526986;border-radius:7px;background:#111b2a;color:#f4f8ff;padding:4px 7px;font:inherit;text-transform:none;letter-spacing:normal}.nic-compact-sort button,.nic-compact-parent-sort button{min-width:62px;min-height:30px;padding:4px 6px;font-size:9px;white-space:nowrap}#nic-wrapper[data-theme='light'] .nic-compact-sort,#nic-wrapper[data-theme='light'] .nic-compact-parent-sort{color:#475d76;border-color:#9badbe}#nic-wrapper[data-theme='light'] .nic-compact-sort select,#nic-wrapper[data-theme='light'] .nic-compact-parent-sort select{background:#e6edf4;color:#17263b;border-color:#8397ae}#nic-wrapper[data-theme='light'] .nic-compact-parent-sort{background:#d5e0eb}
                .nic-item-header,.nic-item-row{display:grid;grid-template-columns:minmax(128px,1.7fr) minmax(42px,.5fr) minmax(80px,.95fr) minmax(84px,1fr) minmax(110px,1.45fr) minmax(92px,1.2fr) minmax(58px,.7fr);gap:6px;align-items:center}
                .nic-item-header{padding:8px 5px 5px;color:#aebed3;border-bottom:1px solid #40516d}.nic-item-header .nic-nested-button:not(:first-child){text-align:right}
                .nic-item-row{padding:8px 5px;border-bottom:1px solid #202d40;font-size:10px;color:#d8e3f0}.nic-item-row:last-child{border-bottom:0}.nic-item-row>div:not(:first-child){text-align:right}
                #nic-wrapper[data-theme='light'] .nic-item-row{color:#263a53;border-color:#b1c0cf}
                .nic-item-name{font-weight:800;color:#f7fbff;text-align:left!important}#nic-wrapper[data-theme='light'] .nic-item-name{color:#15283f}
                .nic-equipped{display:inline-block;margin-left:5px;padding:2px 4px;border:1px solid #5289be;border-radius:4px;color:#a9deff;font-size:8px;font-weight:800;text-transform:uppercase}.nic-perks{color:#a9deff}.nic-mods{color:#d8b3ff}.nic-loaned{color:#f3bd72;font-weight:750}.nic-owned{color:#89dda2;font-weight:750}.nic-muted{color:#7890aa}
                .nic-warning,.nic-error{padding:8px 10px;border-radius:8px;font-size:10px}.nic-warning{border:1px solid #9a7b3c;background:rgba(159,119,40,.18);color:#f3d18a}.nic-error{border:1px solid #a54d55;background:rgba(168,53,64,.2);color:#ffb9bf}
                .nic-empty{padding:22px 10px;color:#aebed3;font-size:11px;text-align:center}.nic-settings{display:grid;gap:11px;align-content:start}.nic-card-title{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.nic-card-title h2{margin:0;font-size:15px}.nic-runtime{display:flex;align-items:center;gap:5px;margin-top:3px;color:#9fb0c7;font-size:9px;font-weight:700}.nic-runtime strong{padding:2px 5px;border:1px solid #58769b;border-radius:999px;color:#a9deff;font-size:9px}.nic-settings label{font-size:11px;font-weight:800}.nic-key-row,.nic-setting-actions{display:flex;gap:7px;flex-wrap:wrap}.nic-key-row input{flex:1 1 180px}.nic-settings p{margin:0;color:#aebed3;font-size:10px;line-height:1.5}
                #nic-wrapper[data-theme='light'] .nic-runtime,#nic-wrapper[data-theme='light'] .nic-settings p{color:#465d77}#nic-wrapper[data-theme='light'] .nic-runtime strong{color:#1f587c;border-color:#7591ad}
                .nic-resize{position:absolute;z-index:4;width:24px;height:24px;touch-action:none}.nic-resize::after{content:'';position:absolute;width:9px;height:9px;pointer-events:none}.nic-resize[data-corner='top-left']{left:0;top:0;cursor:nwse-resize}.nic-resize[data-corner='top-left']::after{left:4px;top:4px;border-left:2px solid #7793bb;border-top:2px solid #7793bb}.nic-resize[data-corner='bottom-left']{left:0;bottom:0;cursor:nesw-resize}.nic-resize[data-corner='bottom-left']::after{left:4px;bottom:4px;border-left:2px solid #7793bb;border-bottom:2px solid #7793bb}.nic-resize[data-corner='bottom-right']{right:0;bottom:0;cursor:nwse-resize}.nic-resize[data-corner='bottom-right']::after{right:4px;bottom:4px;border-right:2px solid #7793bb;border-bottom:2px solid #7793bb}
                #nic-wrapper[data-runtime='compact'] .nic-resize{display:none!important}#nic-wrapper[data-runtime='compact'] button{min-height:38px}#nic-wrapper[data-runtime='compact'] #nic-body{padding:8px}#nic-wrapper[data-runtime='compact'] .nic-layout{gap:8px}#nic-wrapper[data-runtime='compact'] .nic-summary-card{padding:8px}
                #nic-wrapper[data-compact='true'] .nic-compact-sort,#nic-wrapper[data-compact='true'] .nic-compact-parent-sort{display:flex}
                #nic-wrapper[data-compact='true'] .nic-parent-header{display:none}
                #nic-wrapper[data-compact='true'] .nic-category-row{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:5px 12px!important;min-height:0;padding:9px 10px;font-size:10px;text-align:left}
                #nic-wrapper[data-compact='true'] .nic-category-row>div:first-child{grid-column:1/-1;margin:0 0 2px;padding:0 0 6px;border-bottom:1px solid #283950;overflow:visible;text-overflow:clip;white-space:normal}
                #nic-wrapper[data-compact='true'] .nic-category-row>div:not(:first-child){display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0;padding:3px 0;text-align:right}
                #nic-wrapper[data-compact='true'] .nic-category-row>div:not(:first-child):before{flex:0 0 auto;color:#8fa4be;font-size:8px;font-weight:800;text-align:left;text-transform:uppercase;letter-spacing:.035em}
                #nic-wrapper[data-compact='true'] .nic-category-row>div:nth-child(2):before{content:'Items'}#nic-wrapper[data-compact='true'] .nic-category-row>div:nth-child(3):before{content:'Qty'}#nic-wrapper[data-compact='true'] .nic-category-row>div:nth-child(4):before{content:'Category value'}#nic-wrapper[data-compact='true'] .nic-category-row>div:nth-child(5):before{content:'Loaned'}
                #nic-wrapper[data-compact='true'] .nic-category-row .nic-total{min-width:0;overflow-wrap:anywhere}
                #nic-wrapper[data-compact='true'] .nic-item-header{display:none}
                #nic-wrapper[data-compact='true'] .nic-item-row{display:grid;grid-template-columns:minmax(0,1fr)!important;gap:0!important;padding:9px 7px;font-size:10px}#nic-wrapper[data-compact='true'] .nic-item-row>div:first-child{grid-column:auto;margin:0 0 5px;padding:0 0 6px;border-bottom:1px solid #283950}#nic-wrapper[data-compact='true'] .nic-item-row>div:not(:first-child){display:flex;grid-column:auto;align-items:baseline;justify-content:space-between;gap:10px;min-width:0;padding:4px 0;text-align:right!important}#nic-wrapper[data-compact='true'] .nic-item-row>div:not(:first-child):before{flex:0 0 auto;color:#8fa4be;font-size:9px;font-weight:800;text-align:left;text-transform:uppercase;letter-spacing:.035em}#nic-wrapper[data-compact='true'] .nic-detail-value{min-width:0;overflow-wrap:anywhere;text-align:right}#nic-wrapper[data-compact='true'] .nic-perks,#nic-wrapper[data-compact='true'] .nic-mods{align-items:flex-start!important;line-height:1.35}#nic-wrapper[data-compact='true'] .nic-perks .nic-detail-value,#nic-wrapper[data-compact='true'] .nic-mods .nic-detail-value{padding-top:1px}#nic-wrapper[data-compact='true'] .nic-item-row>div:nth-child(2):before{content:'Qty'}#nic-wrapper[data-compact='true'] .nic-item-row>div:nth-child(3):before{content:'Unit value'}#nic-wrapper[data-compact='true'] .nic-item-row>div:nth-child(4):before{content:'Item total'}#nic-wrapper[data-compact='true'] .nic-item-row>div:nth-child(5):before{content:'Bonus / perks'}#nic-wrapper[data-compact='true'] .nic-item-row>div:nth-child(6):before{content:'Mods'}#nic-wrapper[data-compact='true'] .nic-item-row>div:nth-child(7):before{content:'Loan status'}#nic-wrapper[data-compact='true'][data-theme='light'] .nic-category-row>div:first-child,#nic-wrapper[data-compact='true'][data-theme='light'] .nic-item-row>div:first-child{border-color:#b1c0cf}
                @media(max-width:600px){.nic-summary-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.nic-summary-card span{font-size:8px}.nic-summary-card strong{font-size:14px}.nic-summary-card small{font-size:8px}.nic-parent-header,.nic-category-row{grid-template-columns:minmax(0,1.35fr) minmax(0,.45fr) minmax(0,.5fr) minmax(0,1fr) minmax(0,.45fr);gap:3px;font-size:9px}.nic-parent-header{padding:6px 5px}.nic-category-row{padding:8px 5px}.nic-category-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nic-caret{width:12px}.nic-toolbar{gap:6px}.nic-toolbar span{display:none}.nic-key-row,.nic-setting-actions{display:grid;grid-template-columns:1fr}.nic-key-row input{min-height:38px}.nic-item-header,.nic-item-row{grid-template-columns:minmax(80px,1.25fr) minmax(32px,.4fr) minmax(54px,.7fr) minmax(58px,.75fr) minmax(74px,1fr) minmax(62px,.9fr) minmax(42px,.5fr);gap:3px;font-size:8px}}
            </style>
            <style>#nic-wrapper[data-runtime='compact'] .nic-category-table{min-height:clamp(70px,24dvh,132px)}</style>
            <header id='nic-drag'><span id='nic-title'></span><button id='nic-minimize' aria-label='Minimize Naughty Inventory Companion'>−</button></header>
            <main id='nic-body'><div id='nic-content'></div></main>
            <i class='nic-resize' data-corner='top-left' title='Resize this tab'></i><i class='nic-resize' data-corner='bottom-left' title='Resize this tab'></i><i class='nic-resize' data-corner='bottom-right' title='Resize this tab'></i>`;
        document.body.appendChild(dashboard);
        state.dashboard = dashboard;
        bindWindowControls();
        applyWidgetView();
        render();
    }
    async function bootstrap() {
        await RUNTIME_READY;
        const stored = await loadStoredValues();
        const dashboard = stored[STORAGE.dashboard];
        state.apiKey = String(stored[STORAGE.key] || "").trim();
        state.activeTab = ["inventory", "settings"].includes(dashboard?.activeTab) ? dashboard.activeTab : "inventory";
        state.theme = dashboard?.theme === "light" ? "light" : "dark";
        state.isMinimized = dashboard?.isMinimized === true;
        state.windowSizes = dashboard?.windowSizes && typeof dashboard.windowSizes === "object" ? dashboard.windowSizes : {};
        state.position = stored[STORAGE.position] ?? null;
        state.inventory = stored[STORAGE.inventory] ?? null;
        state.parentSort = dashboard?.parentSort?.key ? dashboard.parentSort : state.parentSort;
        state.itemSort = dashboard?.itemSort?.key ? dashboard.itemSort : state.itemSort;
        state.expandedCategories = new Set(Array.isArray(dashboard?.expandedCategories) ? dashboard.expandedCategories : []);
        state.filter = String(dashboard?.filter || "");
        PERSISTENCE.hydrated = true;
        const startupRuntime = runtimeInfo();
        const startupViewport = getViewportMetrics();
        logInfo("Startup complete.", {
            version: VERSION,
            runtime: startupRuntime.platform,
            view: startupRuntime.mode,
            tornPDAConfirmed: RUNTIME.isTornPDA,
            viewport: startupViewport.width + "x" + startupViewport.height,
            scale: Number(window.visualViewport?.scale) || 1
        });
        initializeDashboard();
        RUNTIME.onChange(() => {
            if (!state.dashboard) return;
            if (RUNTIME.isTornPDA) void promotePdaStorage();
            const previousMode = state.dashboard.dataset.runtime;
            applyRuntimePresentation();
            applySize();
            applyCompactDetailLayout();
            const runtime = runtimeInfo();
            logInfo("Runtime presentation updated.", { runtime: runtime.platform, view: runtime.mode, tornPDAConfirmed: RUNTIME.isTornPDA });
            if (previousMode !== state.dashboard.dataset.runtime || state.activeTab === "settings") render();
        });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void bootstrap());
    else void bootstrap();
})();
