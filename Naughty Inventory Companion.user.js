// ==UserScript==
// @name         Naughty Inventory Companion
// @namespace    https://github.com/SharpSplinter/Naughty-Inventory-Companion
// @version      1.2.15
// @description  Manual Torn inventory tracker with live market values, equipment perks, mods, and loan status.
// @author       SharpSplinter [315311]
// @license      MIT
// @match        https://www.torn.com/item.php*
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://www.torn.com/bazaar.php*
// @source       https://raw.githubusercontent.com/SharpSplinter/Naughty-Inventory-Companion/main/Naughty%20Inventory%20Companion.user.js
// @updateURL    https://raw.githubusercontent.com/SharpSplinter/Naughty-Inventory-Companion/main/Naughty%20Inventory%20Companion.user.js
// @downloadURL  https://raw.githubusercontent.com/SharpSplinter/Naughty-Inventory-Companion/main/Naughty%20Inventory%20Companion.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        unsafeWindow
// @connect      api.torn.com
// @run-at       document-end
// ==/UserScript==

(function () {
    "use strict";

    const VERSION = "1.2.15";
    const BASE_URL = "https://api.torn.com/v2/";
    const PDA_INJECTED_API_KEY = "_###PDA-APIKEY###_";
    const NATIVE_REMINDER_ID = 6321;
    const BACKUP_SCHEMA = "naughty-inventory-companion-backup";
    const BACKUP_VERSION = 1;
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
    const TAB_ACTIVITY = { documentVisible: document.visibilityState !== "hidden", nativeActive: true, nativeVisible: true, bound: false };
    const activityWaiters = new Set();
    function isTabActive() {
        return TAB_ACTIVITY.documentVisible && (!RUNTIME.isTornPDA || (TAB_ACTIVITY.nativeActive && TAB_ACTIVITY.nativeVisible));
    }
    function updateTabActivity(next = {}) {
        TAB_ACTIVITY.documentVisible = document.visibilityState !== "hidden";
        if (typeof next.isActiveTab === "boolean") TAB_ACTIVITY.nativeActive = next.isActiveTab;
        if (typeof next.isWebViewVisible === "boolean") TAB_ACTIVITY.nativeVisible = next.isWebViewVisible;
        const active = isTabActive();
        logDebug("Tab activity updated.", { active, documentVisible: TAB_ACTIVITY.documentVisible, nativeActive: TAB_ACTIVITY.nativeActive, nativeVisible: TAB_ACTIVITY.nativeVisible });
        if (active) {
            const waiters = [...activityWaiters];
            activityWaiters.clear();
            waiters.forEach((resolve) => resolve());
        }
        return active;
    }
    async function refreshNativeTabState() {
        if (!RUNTIME.isTornPDA || !RUNTIME.flutterReady) return;
        const bridge = getFlutterBridge();
        if (!bridge) return;
        try {
            updateTabActivity(await bridge.callHandler("PDA_getTabState"));
        } catch (error) {
            logDebug("Native tab-state check was unavailable.", { category: safeErrorCategory(error) });
        }
    }
    function bindTabActivity() {
        if (TAB_ACTIVITY.bound) return;
        TAB_ACTIVITY.bound = true;
        document.addEventListener("visibilitychange", () => updateTabActivity());
        window.addEventListener("tornpda:tabState", (event) => updateTabActivity(event.detail || {}));
        window.addEventListener("pagehide", () => void flushPersistValues());
        void refreshNativeTabState();
    }
    async function waitForActiveTab() {
        while (!isTabActive()) {
            state.status = "Refresh paused while this tab is inactive.";
            render();
            await new Promise((resolve) => activityWaiters.add(resolve));
        }
    }
    function injectedPdaApiKey() {
        const key = String(PDA_INJECTED_API_KEY || "").trim();
        return key && key !== "_###PDA-APIKEY###_" ? key : "";
    }
    function adoptInjectedPdaApiKey() {
        const key = RUNTIME.isTornPDA ? injectedPdaApiKey() : "";
        if (!key) return false;
        state.apiKey = key;
        state.apiKeySource = "tornpda";
        return true;
    }
    function nativeBridgeCall(handler, payload) {
        const bridge = getFlutterBridge();
        if (!RUNTIME.isTornPDA || !RUNTIME.flutterReady || !bridge) return Promise.reject(new Error("TornPDA native handler is unavailable"));
        return bridge.callHandler(handler, payload);
    }
    function nativeToast(text, tone = "blue") {
        if (!text || !RUNTIME.isTornPDA) return;
        const colors = {
            blue: { a: 255, r: 28, g: 86, b: 136 },
            green: { a: 255, r: 25, g: 109, b: 81 },
            red: { a: 255, r: 135, g: 51, b: 61 }
        };
        void nativeBridgeCall("showToast", {
            text: String(text), clickClose: true, seconds: 4,
            bgColor: colors[tone] || colors.blue,
            textColor: { a: 255, r: 255, g: 255, b: 255 }
        }).catch((error) => logDebug("Native toast was unavailable.", { category: safeErrorCategory(error) }));
    }
    function standardFeedbackLayer() {
        const dashboard = state.dashboard;
        if (!dashboard) return null;
        if (!dashboard.querySelector("#nic-standard-feedback-style")) {
            const style = document.createElement("style");
            style.id = "nic-standard-feedback-style";
            style.textContent = "#nic-wrapper .nic-tab-status{display:flex;align-items:center;flex-wrap:wrap;gap:5px 8px;min-width:0;padding:8px 9px;border:1px solid #3c587b;border-radius:8px;background:rgba(14,32,54,.62);color:#aac1dc;font-size:10px;line-height:1.35}#nic-wrapper .nic-tab-status strong{color:#9de3aa;font-size:10px}#nic-wrapper .nic-tab-status time{min-width:0;color:#9baec6;overflow-wrap:anywhere}#nic-wrapper .nic-tab-status[data-state='partial'] strong{color:#ffd276}#nic-wrapper .nic-tab-status[data-state='stale'] strong,#nic-wrapper .nic-tab-status[data-state='not-updated'] strong{color:#ff9ca8}#nic-wrapper #nic-toast-stack{position:absolute;z-index:12;right:10px;bottom:10px;display:grid;gap:7px;width:min(340px,calc(100% - 20px));pointer-events:none}#nic-wrapper .nic-toast{padding:9px 11px;border:1px solid #4a668d;border-radius:8px;background:rgba(20,41,68,.97);color:#f7fbff;font-size:11px;font-weight:700;line-height:1.35;box-shadow:0 8px 20px rgba(0,0,0,.34)}#nic-wrapper .nic-toast[data-tone='green']{border-color:#3d8b64;background:rgba(25,85,61,.97)}#nic-wrapper .nic-toast[data-tone='red']{border-color:#a34b55;background:rgba(120,42,50,.97)}#nic-wrapper .nic-topline .nic-activity{overflow:visible;text-overflow:clip;white-space:normal}#nic-wrapper[data-narrow='true'] .nic-topline{grid-template-columns:minmax(0,1fr) auto}#nic-wrapper[data-narrow='true'] .nic-topline .nic-activity{grid-column:1/-1}#nic-wrapper[data-compact='true'] .nic-tab-status{align-items:flex-start;flex-direction:column;gap:3px}#nic-wrapper[data-theme='light'] .nic-tab-status{border-color:#9eb2c9;background:#e7eff8;color:#465c76}#nic-wrapper[data-theme='light'] .nic-tab-status time{color:#506783}#nic-wrapper[data-theme='light'] .nic-toast{border-color:#8097b4;background:#e6eef7;color:#142238}";
            dashboard.append(style);
        }
        let stack = dashboard.querySelector("#nic-toast-stack");
        if (!stack) {
            stack = document.createElement("div");
            stack.id = "nic-toast-stack";
            stack.setAttribute("aria-live", "polite");
            stack.setAttribute("aria-relevant", "additions");
            dashboard.append(stack);
        }
        return stack;
    }
    function showToast(text, tone = "blue") {
        const message = String(text || "").trim();
        if (!message) return;
        const stack = standardFeedbackLayer();
        if (stack) {
            const toast = document.createElement("div");
            toast.className = "nic-toast";
            toast.dataset.tone = tone;
            toast.setAttribute("role", "status");
            toast.textContent = message;
            stack.append(toast);
            const timer = window.setTimeout(() => {
                toast.remove();
                state.toastTimers.delete(timer);
            }, 4200);
            state.toastTimers.add(timer);
        }
        nativeToast(message, tone);
    }
    async function scheduleNativeReminder() {
        const timestamp = Date.now() + 86400000;
        await nativeBridgeCall("scheduleNotification", {
            title: "Naughty Inventory Companion",
            subtitle: "Your inventory snapshot is ready to refresh.",
            id: NATIVE_REMINDER_ID,
            timestamp,
            overwriteID: true,
            launchNativeToast: true,
            toastMessage: "Inventory refresh reminder scheduled.",
            toastColor: "green",
            toastDurationSeconds: 4,
            urlCallback: "https://www.torn.com/item.php"
        });
        return timestamp;
    }
    const INVENTORY_CATEGORIES = [
        "medical", "drug", "booster", "alcohol", "candy", "enhancer", "jewelry",
        "plushie", "flower", "temporary", "clothing", "car", "artifact", "book",
        "special", "other", "melee", "primary", "secondary", "tool", "defensive",
        "material", "collectible", "supply pack"
    ];
    const LOANABLE_CATEGORIES = new Set(["temporary", "melee", "primary", "secondary", "tool", "defensive", "drug", "booster", "alcohol", "candy"]);
    // The desktop parent and detail grids need roughly 664px after their columns, gaps, and nested padding.
    const COMPACT_DETAIL_WIDTH = 680;
    const NARROW_WIDGET_WIDTH = 480;
    const TINY_WIDGET_WIDTH = 360;
    const MINIMIZED_ICON_SIZE = 36;
    const MINIMIZED_ICON_GUTTER = 8;
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
        inventory: "NIC_INVENTORY_CACHE",
        legacyStorage: "NIC_USE_LEGACY_GM_STORAGE"
    };
    const STORAGE_KEYS = Object.values(STORAGE);
    const state = {
        apiKey: "",
        savedApiKey: "",
        apiKeySource: "saved",
        activeTab: "inventory",
        theme: "dark",
        isMinimized: false,
        windowSizes: {},
        position: null,
        minimizedPosition: null,
        inventory: null,
        refreshInFlight: false,
        exportInFlight: false,
        status: "Manual refresh only.",
        error: "",
        toastTimers: new Set(),
        dashboard: null,
        parentSort: { key: "value", direction: "desc" },
        itemSort: { key: "total", direction: "desc" },
        expandedCategories: new Set(),
        filter: ""
    };
    const KEYBOARD_VIEWPORT_GUARD = {
        stable: null,
        focusedControl: null,
        active: false,
        releaseUntil: 0,
        releaseTimer: 0
    };
    const KEYBOARD_VIEWPORT_MIN_HEIGHT_DELTA = 120;
    const KEYBOARD_VIEWPORT_HEIGHT_RATIO = .16;
    const KEYBOARD_VIEWPORT_WIDTH_RATIO = .12;
    const PERSISTENCE = {
        pdaStorage: null,
        pdaCache: Object.create(null),
        pdaEnabled: false,
        pdaQuotaExceeded: false,
        forceLegacyGM: false,
        pendingValues: Object.create(null),
        pendingResolvers: [],
        persistTimer: 0,
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
    const formatUtcTimestamp = (milliseconds) => {
        const timestamp = Number(milliseconds || 0);
        return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "—";
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
    function localDelete(key) {
        try {
            window.localStorage?.removeItem(key);
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
    async function legacyDeleteKeys(keys) {
        await Promise.all(keys.map(async (key) => {
            if (!await gmDelete(key)) localDelete(key);
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
    async function gmDelete(key) {
        try {
            if (typeof GM !== "undefined" && typeof GM.deleteValue === "function") {
                await GM.deleteValue(key);
                return true;
            }
            if (typeof GM_deleteValue === "function") {
                await Promise.resolve(GM_deleteValue(key));
                return true;
            }
        } catch {}
        return false;
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
    async function persistNow(values) {
        if (PERSISTENCE.forceLegacyGM) {
            await legacySetValues(values);
            return false;
        }
        if (await writePdaValues(values)) return true;
        await legacySetValues(values);
        return false;
    }
    async function flushPersistValues() {
        if (PERSISTENCE.persistTimer) {
            window.clearTimeout(PERSISTENCE.persistTimer);
            PERSISTENCE.persistTimer = 0;
        }
        const values = PERSISTENCE.pendingValues;
        const resolvers = PERSISTENCE.pendingResolvers;
        PERSISTENCE.pendingValues = Object.create(null);
        PERSISTENCE.pendingResolvers = [];
        if (!Object.keys(values).length) {
            resolvers.forEach((resolve) => resolve(false));
            return false;
        }
        const nativeSaved = await persistNow(values);
        logDebug("Storage write batch flushed.", { keys: Object.keys(values).length, nativeSaved });
        resolvers.forEach((resolve) => resolve(nativeSaved));
        return nativeSaved;
    }
    function persistValues(values, immediate = false) {
        Object.assign(PERSISTENCE.pendingValues, values);
        if (immediate) return flushPersistValues();
        return new Promise((resolve) => {
            PERSISTENCE.pendingResolvers.push(resolve);
            if (PERSISTENCE.persistTimer) return;
            PERSISTENCE.persistTimer = window.setTimeout(() => void flushPersistValues(), 180);
        });
    }
    async function deletePdaKeys(keys) {
        const storage = PERSISTENCE.pdaStorage;
        if (!PERSISTENCE.pdaEnabled || !storage || typeof storage.delete !== "function") return false;
        try {
            await Promise.all(keys.map((key) => storage.delete(key)));
            keys.forEach((key) => delete PERSISTENCE.pdaCache[key]);
            return true;
        } catch (error) {
            logWarn("PDA_storage delete failed; userscript storage fallback will be used.", { keys: keys.length, category: safeErrorCategory(error) });
            return false;
        }
    }
    async function deletePersistedValues(keys) {
        await flushPersistValues();
        if (!PERSISTENCE.forceLegacyGM) await deletePdaKeys(keys);
        await legacyDeleteKeys(keys);
    }
    function resolveLegacyStoragePreference(legacyValue, pdaValue) {
        return legacyValue === undefined ? pdaValue === true : legacyValue === true;
    }
    async function setLegacyStoragePreference(enabled) {
        await flushPersistValues();
        const useLegacy = enabled === true;
        const migration = currentStoredValues();
        PERSISTENCE.forceLegacyGM = useLegacy;
        await legacySetValues(useLegacy
            ? { ...migration, [STORAGE.legacyStorage]: true }
            : { [STORAGE.legacyStorage]: false });
        if (PERSISTENCE.pdaEnabled && !PERSISTENCE.pdaQuotaExceeded) {
            await writePdaValues(useLegacy
                ? { [STORAGE.legacyStorage]: true }
                : { ...migration, [STORAGE.legacyStorage]: false });
        }
        logInfo("Storage method preference updated.", {
            storageMethod: useLegacy ? "legacy-gm" : "pda-storage",
            pdaAvailable: PERSISTENCE.pdaEnabled,
            migrationKeys: useLegacy ? 0 : Object.keys(migration).length
        });
    }
    function storageMethodLabel() {
        if (PERSISTENCE.forceLegacyGM) return "Legacy GM storage (selected)";
        if (PERSISTENCE.pdaEnabled && !PERSISTENCE.pdaQuotaExceeded) return "TornPDA PDA_storage";
        if (PERSISTENCE.pdaEnabled && PERSISTENCE.pdaQuotaExceeded) return "Legacy GM fallback (PDA_storage quota full)";
        return "Legacy GM storage fallback";
    }
    async function loadStoredValues() {
        const storage = getPdaStorage();
        if (storage && (typeof storage.loadAll === "function" || typeof storage.getMany === "function")) {
            try {
                logDebug("Loading PDA_storage cache at startup.", { method: typeof storage.loadAll === "function" ? "loadAll" : "getMany" });
                PERSISTENCE.pdaStorage = storage;
                PERSISTENCE.pdaCache = await readPdaCache(storage);
                PERSISTENCE.pdaEnabled = true;
                const legacy = await legacyValues();
                PERSISTENCE.forceLegacyGM = resolveLegacyStoragePreference(
                    legacy[STORAGE.legacyStorage],
                    PERSISTENCE.pdaCache[STORAGE.legacyStorage]
                );
                if (PERSISTENCE.forceLegacyGM) {
                    logInfo("Legacy GM storage is selected.", { nativeStorageAvailable: true });
                    return Object.fromEntries(STORAGE_KEYS.map((key) => [
                        key,
                        legacy[key] === undefined ? PERSISTENCE.pdaCache[key] : legacy[key]
                    ]));
                }
                const missing = STORAGE_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(PERSISTENCE.pdaCache, key));
                const fallback = missing.length ? legacy : {};
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
        const legacy = await legacyValues();
        PERSISTENCE.forceLegacyGM = legacy[STORAGE.legacyStorage] === true;
        return legacy;
    }
    async function promotePdaStorage() {
        if (!PERSISTENCE.hydrated || PERSISTENCE.pdaEnabled || PERSISTENCE.forceLegacyGM) return;
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
        if (!isTabActive()) {
            state.status = "Refresh paused while this tab is inactive.";
            render();
            return;
        }
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
                await waitForActiveTab();
                const category = INVENTORY_CATEGORIES[index];
                state.status = "Fetching " + category + " (" + formatInteger(index + 1) + "/" + formatInteger(INVENTORY_CATEGORIES.length) + ")…";
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
            showToast("Inventory refreshed: " + formatInteger(rows.length) + " items.", "green");
            logInfo("Manual inventory refresh completed.", {
                items: rows.length,
                failedCategories: failures.length,
                durationMs: elapsedMilliseconds(refreshStartedAt)
            });
        } catch (error) {
            state.error = error.message || "Unable to refresh inventory";
            state.status = "Refresh failed.";
            showToast("Inventory refresh failed. See the dashboard for details.", "red");
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
    function exportLoanStatus(item) {
        if (!LOANABLE_CATEGORIES.has(item.category)) return "";
        return item.factionOwned ? "Loaned" : "Owned";
    }
    function inventoryExportData() {
        const inventory = state.inventory || { rows: [], totalCount: 0, totalValue: 0, failedCategories: [] };
        const rows = [...(Array.isArray(inventory.rows) ? inventory.rows : [])].sort((left, right) => {
            const category = String(left.category || "").localeCompare(String(right.category || ""));
            return category || String(left.name || "").localeCompare(String(right.name || "")) || Number(left.id || 0) - Number(right.id || 0);
        });
        return {
            snapshotAt: Number(inventory.syncedAt) || Date.now(),
            totalCount: Number(inventory.totalCount || 0),
            totalValue: Number(inventory.totalValue || 0),
            failedCategories: Array.isArray(inventory.failedCategories) ? inventory.failedCategories : [],
            headers: ["Category", "Item ID", "Item", "Quantity", "Unit Value", "Total Value", "Equipped", "Bonus / Perks", "Mods", "Loan Status"],
            rows
        };
    }
    function csvExportLine(values) {
        return values.map((value) => "\"" + String(value ?? "").replace(/\"/g, "\"\"") + "\"").join(",");
    }
    function createInventoryCsv(data = inventoryExportData()) {
        const summary = [
            ["Naughty Inventory Companion snapshot"],
            ["Snapshot UTC", new Date(data.snapshotAt).toISOString()],
            ["Tracked items", formatInteger(data.totalCount)],
            ["Live inventory value", formatMoney(data.totalValue)],
            ["Distinct item rows", formatInteger(data.rows.length)],
            ["Unavailable categories", data.failedCategories.length ? data.failedCategories.join(", ") : "None"],
            [],
            data.headers
        ];
        const rows = data.rows.map((item) => [
            item.category, formatInteger(item.id), item.name, formatInteger(item.quantity), formatMoney(item.price), formatMoney(item.total),
            item.equipped ? "Yes" : "No", item.bonusText || "", item.modsText || "", exportLoanStatus(item)
        ]);
        return "\uFEFF" + [...summary, ...rows].map(csvExportLine).join("\r\n");
    }
    function utf8Bytes(value) {
        if (typeof TextEncoder !== "function") throw new Error("This runtime cannot create spreadsheet exports.");
        return new TextEncoder().encode(String(value ?? ""));
    }
    function zipWriteU16(target, offset, value) {
        target[offset] = value & 255;
        target[offset + 1] = (value >>> 8) & 255;
    }
    function zipWriteU32(target, offset, value) {
        const unsigned = Number(value) >>> 0;
        target[offset] = unsigned & 255;
        target[offset + 1] = (unsigned >>> 8) & 255;
        target[offset + 2] = (unsigned >>> 16) & 255;
        target[offset + 3] = (unsigned >>> 24) & 255;
    }
    function zipCrc32(bytes) {
        let crc = 0xFFFFFFFF;
        for (let index = 0; index < bytes.length; index += 1) {
            crc ^= bytes[index];
            for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }
    function zipDateTime(date) {
        const year = Math.max(1980, date.getFullYear());
        return {
            time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
            date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
        };
    }
    function zipStoredFiles(files) {
        const timestamp = zipDateTime(new Date());
        const entries = files.map((file) => {
            const name = utf8Bytes(file.name);
            const bytes = file.bytes instanceof Uint8Array ? file.bytes : utf8Bytes(file.bytes);
            return { name, bytes, crc: zipCrc32(bytes), offset: 0 };
        });
        const localLength = entries.reduce((total, entry) => total + 30 + entry.name.length + entry.bytes.length, 0);
        const centralLength = entries.reduce((total, entry) => total + 46 + entry.name.length, 0);
        const output = new Uint8Array(localLength + centralLength + 22);
        let cursor = 0;
        entries.forEach((entry) => {
            entry.offset = cursor;
            zipWriteU32(output, cursor, 0x04034B50); cursor += 4;
            zipWriteU16(output, cursor, 20); cursor += 2;
            zipWriteU16(output, cursor, 0x0800); cursor += 2;
            zipWriteU16(output, cursor, 0); cursor += 2;
            zipWriteU16(output, cursor, timestamp.time); cursor += 2;
            zipWriteU16(output, cursor, timestamp.date); cursor += 2;
            zipWriteU32(output, cursor, entry.crc); cursor += 4;
            zipWriteU32(output, cursor, entry.bytes.length); cursor += 4;
            zipWriteU32(output, cursor, entry.bytes.length); cursor += 4;
            zipWriteU16(output, cursor, entry.name.length); cursor += 2;
            zipWriteU16(output, cursor, 0); cursor += 2;
            output.set(entry.name, cursor); cursor += entry.name.length;
            output.set(entry.bytes, cursor); cursor += entry.bytes.length;
        });
        const centralOffset = cursor;
        entries.forEach((entry) => {
            zipWriteU32(output, cursor, 0x02014B50); cursor += 4;
            zipWriteU16(output, cursor, 20); cursor += 2;
            zipWriteU16(output, cursor, 20); cursor += 2;
            zipWriteU16(output, cursor, 0x0800); cursor += 2;
            zipWriteU16(output, cursor, 0); cursor += 2;
            zipWriteU16(output, cursor, timestamp.time); cursor += 2;
            zipWriteU16(output, cursor, timestamp.date); cursor += 2;
            zipWriteU32(output, cursor, entry.crc); cursor += 4;
            zipWriteU32(output, cursor, entry.bytes.length); cursor += 4;
            zipWriteU32(output, cursor, entry.bytes.length); cursor += 4;
            zipWriteU16(output, cursor, entry.name.length); cursor += 2;
            zipWriteU16(output, cursor, 0); cursor += 2;
            zipWriteU16(output, cursor, 0); cursor += 2;
            zipWriteU16(output, cursor, 0); cursor += 2;
            zipWriteU16(output, cursor, 0); cursor += 2;
            zipWriteU32(output, cursor, 0); cursor += 4;
            zipWriteU32(output, cursor, entry.offset); cursor += 4;
            output.set(entry.name, cursor); cursor += entry.name.length;
        });
        const centralSize = cursor - centralOffset;
        zipWriteU32(output, cursor, 0x06054B50); cursor += 4;
        zipWriteU16(output, cursor, 0); cursor += 2;
        zipWriteU16(output, cursor, 0); cursor += 2;
        zipWriteU16(output, cursor, entries.length); cursor += 2;
        zipWriteU16(output, cursor, entries.length); cursor += 2;
        zipWriteU32(output, cursor, centralSize); cursor += 4;
        zipWriteU32(output, cursor, centralOffset); cursor += 4;
        zipWriteU16(output, cursor, 0);
        return output;
    }
    function xlsxColumnName(index) {
        let value = index + 1;
        let column = "";
        while (value > 0) {
            const remainder = (value - 1) % 26;
            column = String.fromCharCode(65 + remainder) + column;
            value = Math.floor((value - 1) / 26);
        }
        return column;
    }
    function xlsxCell(cell, reference) {
        const style = cell.style ? " s='" + cell.style + "'" : "";
        if (cell.type === "number") {
            const number = Math.round(Number(cell.value));
            return "<c r='" + reference + "'" + style + "><v>" + (Number.isFinite(number) ? number : 0) + "</v></c>";
        }
        return "<c r='" + reference + "'" + style + " t='inlineStr'><is><t xml:space='preserve'>" + escapeHtml(cell.value) + "</t></is></c>";
    }
    function xlsxRow(cells, rowNumber) {
        return "<row r='" + rowNumber + "'>" + cells.map((cell, index) => xlsxCell(cell, xlsxColumnName(index) + rowNumber)).join("") + "</row>";
    }
    function createInventorySpreadsheet(data = inventoryExportData()) {
        const summary = [
            [{ value: "Naughty Inventory Companion snapshot", style: 1 }],
            [{ value: "Snapshot UTC", style: 1 }, { value: new Date(data.snapshotAt).toISOString() }],
            [{ value: "Tracked items", style: 1 }, { value: data.totalCount, type: "number", style: 3 }],
            [{ value: "Live inventory value", style: 1 }, { value: data.totalValue, type: "number", style: 2 }],
            [{ value: "Distinct item rows", style: 1 }, { value: data.rows.length, type: "number", style: 3 }],
            [{ value: "Unavailable categories", style: 1 }, { value: data.failedCategories.length ? data.failedCategories.join(", ") : "None" }]
        ];
        const worksheetRows = summary.map((cells, index) => xlsxRow(cells, index + 1));
        worksheetRows.push(xlsxRow(data.headers.map((value) => ({ value, style: 4 })), 8));
        data.rows.forEach((item, index) => worksheetRows.push(xlsxRow([
            { value: item.category }, { value: item.id, type: "number", style: 3 }, { value: item.name },
            { value: item.quantity, type: "number", style: 3 }, { value: item.price, type: "number", style: 2 },
            { value: item.total, type: "number", style: 2 }, { value: item.equipped ? "Yes" : "No" },
            { value: item.bonusText || "" }, { value: item.modsText || "" }, { value: exportLoanStatus(item) }
        ], index + 9)));
        const lastRow = Math.max(8, data.rows.length + 8);
        const worksheet = "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>" +
            "<worksheet xmlns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'><sheetViews><sheetView workbookViewId='0'/></sheetViews><sheetFormatPr defaultRowHeight='15'/>" +
            "<cols><col min='1' max='1' width='18' customWidth='1'/><col min='2' max='2' width='12' customWidth='1'/><col min='3' max='3' width='32' customWidth='1'/><col min='4' max='4' width='12' customWidth='1'/><col min='5' max='6' width='16' customWidth='1'/><col min='7' max='7' width='12' customWidth='1'/><col min='8' max='9' width='38' customWidth='1'/><col min='10' max='10' width='16' customWidth='1'/></cols>" +
            "<sheetData>" + worksheetRows.join("") + "</sheetData><autoFilter ref='A8:J" + lastRow + "'/></worksheet>";
        return zipStoredFiles([
            { name: "[Content_Types].xml", bytes: "<?xml version='1.0' encoding='UTF-8' standalone='yes'?><Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'><Default Extension='rels' ContentType='application/vnd.openxmlformats-package.relationships+xml'/><Default Extension='xml' ContentType='application/xml'/><Override PartName='/xl/workbook.xml' ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'/><Override PartName='/xl/worksheets/sheet1.xml' ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'/><Override PartName='/xl/styles.xml' ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'/></Types>" },
            { name: "_rels/.rels", bytes: "<?xml version='1.0' encoding='UTF-8' standalone='yes'?><Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='rId1' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument' Target='xl/workbook.xml'/></Relationships>" },
            { name: "xl/workbook.xml", bytes: "<?xml version='1.0' encoding='UTF-8' standalone='yes'?><workbook xmlns='http://schemas.openxmlformats.org/spreadsheetml/2006/main' xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'><sheets><sheet name='Inventory' sheetId='1' r:id='rId1'/></sheets></workbook>" },
            { name: "xl/_rels/workbook.xml.rels", bytes: "<?xml version='1.0' encoding='UTF-8' standalone='yes'?><Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='rId1' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet' Target='worksheets/sheet1.xml'/><Relationship Id='rId2' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles' Target='styles.xml'/></Relationships>" },
            { name: "xl/styles.xml", bytes: "<?xml version='1.0' encoding='UTF-8' standalone='yes'?><styleSheet xmlns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'><numFmts count='1'><numFmt numFmtId='164' formatCode='$#,##0'/></numFmts><fonts count='2'><font><sz val='11'/><name val='Calibri'/></font><font><b/><sz val='11'/><name val='Calibri'/></font></fonts><fills count='3'><fill><patternFill patternType='none'/></fill><fill><patternFill patternType='gray125'/></fill><fill><patternFill patternType='solid'><fgColor rgb='FFDAE8F5'/><bgColor indexed='64'/></patternFill></fill></fills><borders count='1'><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count='1'><xf numFmtId='0' fontId='0' fillId='0' borderId='0'/></cellStyleXfs><cellXfs count='5'><xf numFmtId='0' fontId='0' fillId='0' borderId='0' xfId='0'/><xf numFmtId='0' fontId='1' fillId='0' borderId='0' xfId='0' applyFont='1'/><xf numFmtId='164' fontId='0' fillId='0' borderId='0' xfId='0' applyNumberFormat='1'/><xf numFmtId='3' fontId='0' fillId='0' borderId='0' xfId='0' applyNumberFormat='1'/><xf numFmtId='0' fontId='1' fillId='2' borderId='0' xfId='0' applyFont='1' applyFill='1'/></cellXfs></styleSheet>" },
            { name: "xl/worksheets/sheet1.xml", bytes: worksheet }
        ]);
    }
    function inventoryExportFileName(extension) {
        const date = new Date(Number(state.inventory?.syncedAt) || Date.now()).toISOString().slice(0, 10);
        return "naughty-inventory-snapshot-" + date + "." + extension;
    }
    function bytesToBase64(bytes) {
        if (typeof btoa !== "function") return "";
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            const limit = Math.min(bytes.length, offset + 0x8000);
            for (let index = offset; index < limit; index += 1) binary += String.fromCharCode(bytes[index]);
        }
        return btoa(binary);
    }
    function downloadInventoryExport(bytes, fileName, mimeType) {
        const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    async function shareInventoryExport(bytes, fileName) {
        await RUNTIME_READY;
        const bridge = getFlutterBridge();
        if (!RUNTIME.isTornPDA || !bridge) return { native: false, shared: false };
        const base64Data = bytesToBase64(bytes);
        if (!base64Data) return { native: true, shared: false, message: "This runtime could not encode the export." };
        try {
            const response = await bridge.callHandler("shareFile", { base64Data, fileName });
            if (response?.status === "success") return { native: true, shared: true };
            return { native: true, shared: false, message: String(response?.message || "TornPDA could not open its share sheet.") };
        } catch (error) {
            logDebug("Native inventory export share sheet was unavailable.", { category: safeErrorCategory(error) });
            return { native: true, shared: false, message: "TornPDA could not open its share sheet." };
        }
    }
    async function exportInventory(format) {
        if (state.exportInFlight || !Array.isArray(state.inventory?.rows) || !state.inventory.rows.length) return;
        const isSpreadsheet = format === "spreadsheet";
        const label = isSpreadsheet ? "Spreadsheet" : "CSV";
        state.exportInFlight = true;
        state.error = "";
        state.status = "Preparing " + label + " export…";
        render();
        try {
            const data = inventoryExportData();
            const fileName = inventoryExportFileName(isSpreadsheet ? "xlsx" : "csv");
            const mimeType = isSpreadsheet ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv;charset=utf-8";
            const bytes = isSpreadsheet ? createInventorySpreadsheet(data) : utf8Bytes(createInventoryCsv(data));
            const share = await shareInventoryExport(bytes, fileName);
            if (share.native && !share.shared) throw new Error(share.message || "TornPDA could not open its share sheet.");
            if (!share.shared) downloadInventoryExport(bytes, fileName, mimeType);
            state.status = share.shared ? label + " opened in the TornPDA share sheet." : label + " downloaded.";
            showToast(state.status, "green");
            logInfo("Inventory export completed.", { format: isSpreadsheet ? "xlsx" : "csv", transport: share.shared ? "TornPDA shareFile" : "desktop download", items: data.rows.length });
        } catch (error) {
            state.status = "Inventory export failed.";
            state.error = "Unable to create the " + label.toLowerCase() + " export.";
            showToast(state.error, "red");
            logError("Inventory export failed.", { format: isSpreadsheet ? "xlsx" : "csv", category: safeErrorCategory(error) });
        } finally {
            state.exportInFlight = false;
            render();
        }
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
            "<div class='nic-export-actions'><span>Exports the full local inventory snapshot</span><button data-action='export-csv'" + (state.exportInFlight ? " disabled" : "") + ">Save as CSV</button><button data-action='export-spreadsheet'" + (state.exportInFlight ? " disabled" : "") + ">Save as Spreadsheet</button></div>" +
            "<section class='nic-category-table'>" + compactParentSortControls() + "<div class='nic-parent-header'>" +
            parentHeader("Category", "category") + parentHeader("Items", "distinctItems") + parentHeader("Qty", "quantity") +
            parentHeader("Category Value", "value") + parentHeader("Loaned", "loaned") + "</div>" +
            (groups.length ? groups.map((group) => {
                const expanded = state.expandedCategories.has(group.category);
                const loaned = LOANABLE_CATEGORIES.has(group.category) ? formatInteger(group.loaned) : "—";
                return "<section class='nic-category' data-category='" + escapeHtml(group.category) + "'><button class='nic-category-row' data-toggle-category='" +
                    escapeHtml(group.category) + "'><div class='nic-category-name'><span class='nic-caret'>" + (expanded ? "⌄" : "›") +
                    "</span>" + escapeHtml(group.category) + "</div><div>" + formatInteger(group.distinctItems) + "</div><div>" +
                    formatInteger(group.quantity) + "</div><div class='nic-money nic-total'>" + formatMoney(group.value) + "</div><div>" +
                    loaned + "</div></button>" + (expanded ? nestedRows(group) : "") + "</section>";
            }).join("") : "<div class='nic-empty'>No inventory rows match the current filter.</div>") + "</section></section>";
    }
    function settingsView() {
        const runtime = runtimeInfo();
        const usingInjectedKey = state.apiKeySource === "tornpda";
        return "<section class='nic-settings nic-card'><div class='nic-card-title'><div><h2>Settings</h2><div class='nic-runtime' title='Runtime detection and measured layout are independent'><span>Runtime</span><strong>" + runtime.label + "</strong></div></div><button data-tab='inventory'>Inventory</button></div>" +
            "<label for='nic-api-key'>Torn API Key</label><div class='nic-key-row'><input id='nic-api-key' type='password' autocomplete='off' value='" +
            escapeHtml(usingInjectedKey ? "" : state.savedApiKey) + "' placeholder='" + (usingInjectedKey ? "Using TornPDA injected API key" : "Enter Torn API key") + "'><button data-action='save-key'>Save Key</button></div>" +
            (usingInjectedKey ? "<p class='nic-key-source'>A TornPDA injected API key is active and is never shown or stored by this companion.</p>" : "") +
            "<p>Inventory is manual-refresh only. Each refresh retrieves the current Torn item catalog market price, inventory categories, and equipped item bonuses/mods.</p>" +
            "<dl class='nic-runtime-details'><div><dt>Runtime</dt><dd>" + escapeHtml(runtime.platform) + "</dd></div><div><dt>Screen Size</dt><dd>" + escapeHtml(screenSizeLabel()) + "</dd></div><div><dt>Layout Profile</dt><dd>" + escapeHtml(runtime.layout) + "</dd></div><div><dt>Storage Method</dt><dd>" + escapeHtml(storageMethodLabel()) + "</dd></div></dl>" +
            "<label class='nic-storage-toggle'><input id='nic-use-legacy-gm' type='checkbox'" + (PERSISTENCE.forceLegacyGM ? " checked" : "") + "><span>Use legacy GM storage</span></label>" +
            "<p class='nic-storage-help'>Unchecked uses TornPDA PDA_storage when available, with compatible GM storage as the fallback.</p>" +
            "<section class='nic-backup'><strong>Backup &amp; restore</strong><p>Download all local snapshots, history, preferences, and layout as a JSON backup. Loading a valid backup replaces this companion’s local data.</p><label class='nic-storage-toggle'><input id='nic-backup-include-key' type='checkbox'><span>Include saved API key</span></label><div class='nic-backup-actions'><button data-action='download-backup'" + (state.exportInFlight ? " disabled" : "") + ">Download Backup</button><button data-action='choose-backup'>Load Backup</button><input id='nic-backup-file' type='file' accept='application/json,.json' hidden></div></section>" +
            "<div class='nic-setting-actions'><button data-action='toggle-theme'>Use " + (state.theme === "dark" ? "Light" : "Dark") + " Mode</button>" +
            "<button data-action='clear-cache'>Clear Cached Inventory</button><button data-action='native-reminder'>Remind Me Tomorrow</button></div></section>";
    }
    function dashboardStateValue() {
        return {
            activeTab: state.activeTab, theme: state.theme, isMinimized: state.isMinimized,
            windowSizes: state.windowSizes, parentSort: state.parentSort, itemSort: state.itemSort,
            expandedCategories: [...state.expandedCategories], filter: state.filter,
            minimizedPosition: state.minimizedPosition
        };
    }
    function currentStoredValues() {
        const values = {
            [STORAGE.key]: state.savedApiKey,
            [STORAGE.dashboard]: dashboardStateValue(),
            [STORAGE.position]: state.position
        };
        if (state.inventory !== null) values[STORAGE.inventory] = state.inventory;
        return values;
    }
    function createBackup(includeApiKey = false) {
        const data = { ...currentStoredValues(), [STORAGE.legacyStorage]: PERSISTENCE.forceLegacyGM };
        if (!includeApiKey) delete data[STORAGE.key];
        return { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, createdAt: Date.now(), includesApiKey: includeApiKey === true, data };
    }
    function validateBackup(candidate) {
        if (!isStorageRecord(candidate) || candidate.schema !== BACKUP_SCHEMA || candidate.version !== BACKUP_VERSION || !isStorageRecord(candidate.data)) {
            throw new Error("This is not a compatible Naughty Inventory Companion backup.");
        }
        const data = Object.fromEntries(Object.entries(candidate.data).filter(([key]) => STORAGE_KEYS.includes(key)));
        const includesApiKey = candidate.includesApiKey === true;
        if (!includesApiKey) delete data[STORAGE.key];
        if (!Object.keys(data).length) throw new Error("The backup contains no compatible companion data.");
        if (Object.prototype.hasOwnProperty.call(data, STORAGE.key) && typeof data[STORAGE.key] !== "string") throw new Error("The backup API key is invalid.");
        if (Object.prototype.hasOwnProperty.call(data, STORAGE.dashboard) && !isStorageRecord(data[STORAGE.dashboard])) throw new Error("The backup dashboard state is invalid.");
        if (Object.prototype.hasOwnProperty.call(data, STORAGE.position) && data[STORAGE.position] !== null && !isStorageRecord(data[STORAGE.position])) throw new Error("The backup panel position is invalid.");
        if (Object.prototype.hasOwnProperty.call(data, STORAGE.inventory) && data[STORAGE.inventory] !== null && !isStorageRecord(data[STORAGE.inventory])) throw new Error("The backup inventory snapshot is invalid.");
        if (Object.prototype.hasOwnProperty.call(data, STORAGE.legacyStorage) && typeof data[STORAGE.legacyStorage] !== "boolean") throw new Error("The backup storage preference is invalid.");
        return { data, includesApiKey };
    }
    async function downloadBackup(includeApiKey) {
        if (state.exportInFlight) return false;
        state.exportInFlight = true;
        state.error = "";
        state.status = "Preparing Inventory backup…";
        render();
        try {
        const json = JSON.stringify(createBackup(includeApiKey), null, 2);
        const fileName = "naughty-inventory-companion-backup-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
        const bytes = utf8Bytes(json);
        const share = await shareInventoryExport(bytes, fileName);
        if (share.native && !share.shared) {
            state.status = "Inventory backup was not exported.";
            state.error = share.message || "TornPDA could not open the native share sheet.";
            showToast(state.error, "red");
            render();
            return false;
        }
        if (!share.shared) downloadInventoryExport(bytes, fileName, "application/json;charset=utf-8");
        state.status = share.shared ? "Inventory backup opened in the TornPDA share sheet." : "Inventory backup downloaded.";
        state.error = "";
        showToast(state.status, "green");
        render();
        return true;
        } finally {
            state.exportInFlight = false;
            render();
        }
    }
    async function readBackupFile(file) {
        if (!file) throw new Error("Choose a backup file first.");
        if (Number(file.size || 0) > 25 * 1024 * 1024) throw new Error("Backup files must be 25 MB or smaller.");
        if (typeof file.text === "function") return file.text();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Unable to read that backup file."));
            reader.readAsText(file);
        });
    }
    async function restoreBackup(backup) {
        await flushPersistValues();
        const data = backup.data;
        const retainedApiKey = state.savedApiKey;
        const restoreKeys = STORAGE_KEYS.filter((key) => key !== STORAGE.key || backup.includesApiKey);
        await deletePdaKeys(restoreKeys);
        await legacyDeleteKeys(restoreKeys);
        const useLegacy = data[STORAGE.legacyStorage] === true;
        PERSISTENCE.forceLegacyGM = useLegacy;
        const values = { ...data };
        delete values[STORAGE.legacyStorage];
        if (!backup.includesApiKey) delete values[STORAGE.key];
        if (Object.keys(values).length) await persistNow(values);
        await legacySetValues({ [STORAGE.legacyStorage]: useLegacy });
        if (PERSISTENCE.pdaEnabled && !PERSISTENCE.pdaQuotaExceeded) await writePdaValues({ [STORAGE.legacyStorage]: useLegacy });
        const dashboard = isStorageRecord(data[STORAGE.dashboard]) ? data[STORAGE.dashboard] : {};
        state.savedApiKey = backup.includesApiKey ? String(data[STORAGE.key] || "") : retainedApiKey;
        state.apiKey = state.savedApiKey;
        state.apiKeySource = "saved";
        adoptInjectedPdaApiKey();
        state.theme = dashboard.theme === "light" ? "light" : "dark";
        state.isMinimized = dashboard.isMinimized === true;
        state.windowSizes = isStorageRecord(dashboard.windowSizes) ? dashboard.windowSizes : {};
        state.position = data[STORAGE.position] ?? null;
        state.minimizedPosition = isStorageRecord(dashboard.minimizedPosition) ? dashboard.minimizedPosition : null;
        state.inventory = data[STORAGE.inventory] ?? null;
        state.parentSort = dashboard.parentSort?.key ? dashboard.parentSort : state.parentSort;
        state.itemSort = dashboard.itemSort?.key ? dashboard.itemSort : state.itemSort;
        state.expandedCategories = new Set(Array.isArray(dashboard.expandedCategories) ? dashboard.expandedCategories : []);
        state.filter = String(dashboard.filter || "");
        state.activeTab = "settings";
        state.status = "Backup restored.";
        state.error = "";
        applyWidgetView();
        showToast(state.status, "green");
        render();
    }
    async function loadBackupFile(file) {
        const text = await readBackupFile(file);
        let parsed;
        try { parsed = JSON.parse(text); } catch { throw new Error("The selected file is not valid JSON."); }
        const backup = validateBackup(parsed);
        if (typeof window.confirm === "function" && !window.confirm("Restore this Inventory backup? Current local companion data will be replaced.")) return false;
        await restoreBackup(backup);
        return true;
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
    function cloneViewportMetrics(viewport) {
        return {
            width: Math.max(1, Number(viewport?.width || 1)),
            height: Math.max(1, Number(viewport?.height || 1)),
            left: Math.max(0, Number(viewport?.left || 0)),
            top: Math.max(0, Number(viewport?.top || 0))
        };
    }
    function isVirtualKeyboardViewportChange(stable, current) {
        if (!stable || !current) return false;
        const heightLoss = Number(stable.height || 0) - Number(current.height || 0);
        const minimumHeightLoss = Math.max(KEYBOARD_VIEWPORT_MIN_HEIGHT_DELTA, Math.round(Number(stable.height || 0) * KEYBOARD_VIEWPORT_HEIGHT_RATIO));
        const maximumWidthDrift = Math.max(48, Math.round(Number(stable.width || 0) * KEYBOARD_VIEWPORT_WIDTH_RATIO));
        return heightLoss >= minimumHeightLoss && Math.abs(Number(stable.width || 0) - Number(current.width || 0)) <= maximumWidthDrift;
    }
    function keyboardViewportGuardIsEngaged() {
        return Boolean(KEYBOARD_VIEWPORT_GUARD.focusedControl) || KEYBOARD_VIEWPORT_GUARD.releaseUntil > Date.now();
    }
    function updateStableViewport(viewport = getViewportMetrics()) {
        const stable = cloneViewportMetrics(viewport);
        if (!keyboardViewportGuardIsEngaged()) {
            KEYBOARD_VIEWPORT_GUARD.stable = stable;
            KEYBOARD_VIEWPORT_GUARD.active = false;
            if (state.dashboard) state.dashboard.dataset.keyboard = "false";
        }
        return stable;
    }
    function presentationViewportMetrics() {
        const current = getViewportMetrics();
        const guard = KEYBOARD_VIEWPORT_GUARD;
        if (!keyboardViewportGuardIsEngaged()) return updateStableViewport(current);
        if (!guard.stable) guard.stable = cloneViewportMetrics(current);
        if (!guard.active && isVirtualKeyboardViewportChange(guard.stable, current)) {
            guard.active = true;
            if (state.dashboard) state.dashboard.dataset.keyboard = "true";
            logDebug("Virtual keyboard viewport change detected; keeping the companion at its stable size.", {
                before: guard.stable.width + "x" + guard.stable.height,
                after: current.width + "x" + current.height
            });
        }
        return guard.active ? cloneViewportMetrics(guard.stable) : current;
    }
    function isTextEntryControl(element) {
        if (!element || typeof element.matches !== "function" || element.disabled || element.readOnly) return false;
        if (element.matches("textarea,[contenteditable=''],[contenteditable='true']")) return true;
        if (!element.matches("input")) return false;
        return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(String(element.type || "text").toLowerCase());
    }
    function requestKeyboardOverlay() {
        const virtualKeyboard = navigator.virtualKeyboard;
        if (!virtualKeyboard || !("overlaysContent" in virtualKeyboard)) return false;
        try {
            virtualKeyboard.overlaysContent = true;
            return true;
        } catch (error) {
            logDebug("Native virtual-keyboard overlay mode is unavailable; using the viewport guard.", { category: safeErrorCategory(error) });
            return false;
        }
    }
    function beginKeyboardViewportGuard(control) {
        if (!state.dashboard || state.isMinimized || !isCompactRuntime() || !isTextEntryControl(control)) return;
        const guard = KEYBOARD_VIEWPORT_GUARD;
        if (guard.releaseTimer) window.clearTimeout(guard.releaseTimer);
        guard.releaseTimer = 0;
        if (!guard.active || !guard.stable) guard.stable = cloneViewportMetrics(getViewportMetrics());
        guard.focusedControl = control;
        guard.releaseUntil = 0;
        requestKeyboardOverlay();
    }
    function endKeyboardViewportGuard(control) {
        const guard = KEYBOARD_VIEWPORT_GUARD;
        if (guard.focusedControl && control && guard.focusedControl !== control) return;
        guard.focusedControl = null;
        guard.releaseUntil = Date.now() + 360;
        if (guard.releaseTimer) window.clearTimeout(guard.releaseTimer);
        guard.releaseTimer = window.setTimeout(() => {
            guard.releaseTimer = 0;
            if (guard.focusedControl) return;
            guard.releaseUntil = 0;
            guard.active = false;
            guard.stable = cloneViewportMetrics(getViewportMetrics());
            if (state.dashboard) state.dashboard.dataset.keyboard = "false";
            if (!state.isMinimized) {
                applyRuntimePresentation();
                applySize();
                applyCompactDetailLayout();
            }
        }, 360);
    }
    function resetKeyboardViewportGuard() {
        const guard = KEYBOARD_VIEWPORT_GUARD;
        if (guard.releaseTimer) window.clearTimeout(guard.releaseTimer);
        guard.stable = cloneViewportMetrics(getViewportMetrics());
        guard.focusedControl = null;
        guard.active = false;
        guard.releaseUntil = 0;
        guard.releaseTimer = 0;
        if (state.dashboard) state.dashboard.dataset.keyboard = "false";
    }
    function screenSizeLabel() {
        const viewport = presentationViewportMetrics();
        const orientation = viewport.width >= viewport.height ? "landscape" : "portrait";
        const scale = Math.round((Number(window.visualViewport?.scale) || 1) * 100);
        return formatInteger(viewport.width) + " × " + formatInteger(viewport.height) + " · " + orientation + " · " + formatInteger(scale) + "%";
    }
    function layoutProfile() {
        const viewport = presentationViewportMetrics();
        const scale = Number(window.visualViewport?.scale) || 1;
        const panelWidth = Number(state.dashboard?.getBoundingClientRect?.().width || 0);
        const width = Math.max(1, Math.round(panelWidth || viewport.width));
        if (width <= 360 || viewport.height <= 480) return "narrow";
        if (width <= 520 || viewport.height <= 580 || (scale > 1.1 && width <= 760)) return "compact";
        if (width <= 920) return "standard";
        return "wide";
    }
    function inventoryFreshness() {
        const syncedAt = Number(state.inventory?.syncedAt || 0);
        if (!syncedAt) return { state: "Not updated", source: "Torn API", timestamp: "—", relative: "Never" };
        const failures = Array.isArray(state.inventory?.failedCategories) ? state.inventory.failedCategories.length : 0;
        const age = Math.max(0, Date.now() - syncedAt);
        const label = state.error || failures ? "Partial" : age > 36 * 60 * 60 * 1000 ? "Stale" : "Fresh";
        return { state: label, source: "Torn API", timestamp: formatUtcTimestamp(syncedAt), relative: formatRelative(syncedAt) };
    }
    function inventoryStatusRow() {
        const freshness = inventoryFreshness();
        const dateTime = state.inventory?.syncedAt ? new Date(state.inventory.syncedAt).toISOString() : "";
        return "<div class='nic-tab-status' data-state='" + freshness.state.toLowerCase().replace(/\s+/g, "-") + "'><strong>" + freshness.state + "</strong><span>Inventory data · " + freshness.source + "</span><time datetime='" + dateTime + "'>" + freshness.timestamp + " · " + freshness.relative + "</time></div>";
    }
    function runtimeInfo() {
        const viewport = presentationViewportMetrics();
        const scale = Number(window.visualViewport?.scale) || 1;
        const layout = layoutProfile();
        const viewportCompact = layout === "narrow" || layout === "compact" || (scale > 1.1 && viewport.width <= 960);
        const compact = RUNTIME.isTornPDA || viewportCompact;
        const platform = RUNTIME.isTornPDA ? "TornPDA" : RUNTIME.nativeCheckComplete ? "Desktop" : "Checking TornPDA";
        const runtimeKind = RUNTIME.isTornPDA ? "tornpda" : RUNTIME.nativeCheckComplete ? "desktop" : "checking";
        return { compact, mode: compact ? "compact" : "desktop", layout, runtimeKind, platform, label: platform + " / " + layout + " layout" };
    }
    function isCompactRuntime() {
        return runtimeInfo().compact;
    }
    function applyRuntimePresentation() {
        const dashboard = state.dashboard;
        if (!dashboard) return runtimeInfo();
        const runtime = runtimeInfo();
        dashboard.dataset.runtime = runtime.mode;
        dashboard.dataset.runtimeKind = runtime.runtimeKind;
        dashboard.dataset.layoutProfile = runtime.layout;
        dashboard.dataset.platform = runtime.platform.toLowerCase().replace(/[^a-z]+/g, "-");
        return runtime;
    }
    function applyCompactViewport() {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        applyRuntimePresentation();
        const viewport = presentationViewportMetrics();
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
        const active = !state.isMinimized;
        dashboard.dataset.compact = String(active && width <= COMPACT_DETAIL_WIDTH);
        dashboard.dataset.narrow = String(active && width <= NARROW_WIDGET_WIDTH);
        dashboard.dataset.tiny = String(active && width <= TINY_WIDGET_WIDTH);
    }
    function getViewportPositionBounds(width, height) {
        const viewport = getViewportMetrics();
        const minX = viewport.left;
        const minY = viewport.top;
        return {
            minX,
            minY,
            maxX: Math.max(minX, viewport.left + viewport.width - width),
            maxY: Math.max(minY, viewport.top + viewport.height - height)
        };
    }
    function defaultMinimizedPosition() {
        const bounds = getViewportPositionBounds(MINIMIZED_ICON_SIZE, MINIMIZED_ICON_SIZE);
        return {
            x: Math.max(bounds.minX, bounds.maxX - MINIMIZED_ICON_GUTTER),
            y: Math.min(bounds.maxY, bounds.minY + MINIMIZED_ICON_GUTTER)
        };
    }
    function applyMinimizedPosition(position = state.minimizedPosition) {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        applyRuntimePresentation();
        const rect = dashboard.getBoundingClientRect();
        const width = Math.max(1, rect.width || MINIMIZED_ICON_SIZE);
        const height = Math.max(1, rect.height || MINIMIZED_ICON_SIZE);
        const bounds = getViewportPositionBounds(width, height);
        const fallback = defaultMinimizedPosition();
        const rawX = Number(position?.x);
        const rawY = Number(position?.y);
        const x = clamp(Number.isFinite(rawX) ? rawX : fallback.x, bounds.minX, bounds.maxX);
        const y = clamp(Number.isFinite(rawY) ? rawY : fallback.y, bounds.minY, bounds.maxY);
        dashboard.style.right = "auto";
        dashboard.style.bottom = "auto";
        dashboard.style.left = x + "px";
        dashboard.style.top = y + "px";
    }
    function saveMinimizedPosition() {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        const rect = dashboard.getBoundingClientRect();
        const viewport = getViewportMetrics();
        const bounds = getViewportPositionBounds(Math.max(1, rect.width), Math.max(1, rect.height));
        state.minimizedPosition = {
            x: clamp(rect.left + viewport.left, bounds.minX, bounds.maxX),
            y: clamp(rect.top + viewport.top, bounds.minY, bounds.maxY)
        };
        saveDashboardState();
        applyMinimizedPosition();
    }
    function applyPosition(position = state.position) {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        if (state.isMinimized) {
            applyMinimizedPosition();
            return;
        }
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
        if (state.isMinimized) {
            applyMinimizedPosition();
            return;
        }
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
        const dragHandle = dashboard.querySelector("#nic-drag");
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
            dashboard.dataset.narrow = "false";
            dashboard.dataset.tiny = "false";
            dragHandle.title = "Tap to open · drag to move";
            applyMinimizedPosition();
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
            dragHandle.title = isCompactRuntime() ? "" : "Drag to move";
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
        const statusRow = inventoryStatusRow();
        const body = state.activeTab === "settings" ? statusRow + settingsView() :
            statusRow + "<div class='nic-topline'><span class='nic-activity'>" + escapeHtml(state.status) + "</span><button data-action='refresh' " +
            (state.refreshInFlight || !state.apiKey ? "disabled" : "") + ">↻ " + (state.refreshInFlight ? "Refreshing inventory…" : "Refresh inventory") +
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
        content.querySelector("[data-action='export-csv']")?.addEventListener("click", () => void exportInventory("csv"));
        content.querySelector("[data-action='export-spreadsheet']")?.addEventListener("click", () => void exportInventory("spreadsheet"));
        content.querySelector("[data-action='save-key']")?.addEventListener("click", () => {
            state.savedApiKey = content.querySelector("#nic-api-key").value.trim();
            if (!adoptInjectedPdaApiKey()) {
                state.apiKey = state.savedApiKey;
                state.apiKeySource = "saved";
            }
            state.status = state.apiKey ? (state.apiKeySource === "tornpda" ? "TornPDA injected API key is active." : "API key saved. Inventory refresh is manual-only.") : "Manual refresh only.";
            state.error = "";
            void persistValues({ [STORAGE.key]: state.savedApiKey });
            showToast(state.status, "green");
            render();
        });
        content.querySelector("[data-action='toggle-theme']")?.addEventListener("click", () => {
            state.theme = state.theme === "dark" ? "light" : "dark";
            saveDashboardState();
            render();
        });
        content.querySelector("[data-action='clear-cache']")?.addEventListener("click", () => {
            state.inventory = null;
            void deletePersistedValues([STORAGE.inventory]);
            state.status = "Cached inventory cleared.";
            showToast(state.status, "blue");
            render();
        });
        content.querySelector("#nic-use-legacy-gm")?.addEventListener("change", (event) => {
            void setLegacyStoragePreference(event.target.checked).then(() => {
                state.status = event.target.checked ? "Legacy GM storage selected." : "Preferred storage method restored.";
                showToast(state.status, "blue");
                render();
            });
        });
        content.querySelector("[data-action='native-reminder']")?.addEventListener("click", () => {
            void scheduleNativeReminder().then(() => {
                state.status = "Native inventory reminder scheduled for tomorrow.";
                showToast(state.status, "green");
                render();
            }).catch(() => {
                state.status = "Native reminders are available in TornPDA.";
                render();
            });
        });
        content.querySelector("[data-action='download-backup']")?.addEventListener("click", () => {
            void downloadBackup(content.querySelector("#nic-backup-include-key")?.checked === true);
        });
        content.querySelector("[data-action='choose-backup']")?.addEventListener("click", () => content.querySelector("#nic-backup-file")?.click());
        content.querySelector("#nic-backup-file")?.addEventListener("change", (event) => {
            const file = event.target.files?.[0];
            void loadBackupFile(file).catch((error) => {
                state.error = error?.message || "Unable to restore that backup.";
                state.status = "Backup restore failed.";
                showToast(state.status, "red");
                render();
            });
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
        const restoreMinimizedWidget = () => {
            if (!state.isMinimized) return;
            state.isMinimized = false;
            saveDashboardState();
            applyWidgetView();
            render();
        };
        dragHandle.addEventListener(events.down, (event) => {
            if ((!state.isMinimized && isCompactRuntime()) || event.target.closest("#nic-minimize") || ("button" in event && event.button !== 0)) return;
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
            const viewport = getViewportMetrics();
            const bounds = getViewportPositionBounds(rect.width, rect.height);
            dashboard.style.right = "auto";
            dashboard.style.bottom = "auto";
            dashboard.style.left = clamp(viewport.left + event.clientX - dragOffsetX, bounds.minX, bounds.maxX) + "px";
            dashboard.style.top = clamp(viewport.top + event.clientY - dragOffsetY, bounds.minY, bounds.maxY) + "px";
        });
        const finishDrag = (event, cancelled = false) => {
            if (!dragging || (usePointerEvents && event.pointerId !== pointerId)) return;
            if (usePointerEvents) {
                try { dragHandle.releasePointerCapture?.(event.pointerId); } catch {}
            }
            const restore = state.isMinimized && !didDrag && !cancelled;
            if (didDrag) {
                if (state.isMinimized) saveMinimizedPosition();
                else savePosition();
            }
            dragging = false;
            pointerId = null;
            if (restore) restoreMinimizedWidget();
            else if (didDrag) window.setTimeout(() => { didDrag = false; }, 0);
        };
        document.addEventListener(events.up, (event) => finishDrag(event));
        if (events.cancel) document.addEventListener(events.cancel, (event) => finishDrag(event, true));
        dashboard.addEventListener("click", () => {
            if (!state.isMinimized || didDrag) return;
            restoreMinimizedWidget();
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
        dashboard.addEventListener("pointerdown", (event) => beginKeyboardViewportGuard(event.target), true);
        dashboard.addEventListener("focusin", (event) => beginKeyboardViewportGuard(event.target));
        dashboard.addEventListener("focusout", (event) => endKeyboardViewportGuard(event.target));
        let viewportFrame = 0;
        const syncViewport = (event) => {
            if (event?.type === "orientationchange") resetKeyboardViewportGuard();
            cancelAnimationFrame(viewportFrame);
            viewportFrame = requestAnimationFrame(() => {
                presentationViewportMetrics();
                if (KEYBOARD_VIEWPORT_GUARD.active && keyboardViewportGuardIsEngaged() && isCompactRuntime()) return;
                const priorMode = dashboard.dataset.runtime;
                const priorProfile = dashboard.dataset.layoutProfile;
                applyRuntimePresentation();
                applySize();
                applyCompactDetailLayout();
                if (priorMode !== dashboard.dataset.runtime || priorProfile !== dashboard.dataset.layoutProfile || state.activeTab === "settings") render();
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
        const initialRuntime = runtimeInfo();
        dashboard.dataset.runtime = initialRuntime.mode;
        dashboard.dataset.runtimeKind = initialRuntime.runtimeKind;
        dashboard.dataset.layoutProfile = initialRuntime.layout;
        dashboard.dataset.keyboard = "false";
        dashboard.innerHTML = `
            <style>
                #nic-wrapper{position:fixed;z-index:999999;display:flex;flex-direction:column;overflow:hidden;background:linear-gradient(150deg,rgba(20,28,42,.985),rgba(13,19,30,.985));color:#edf4ff;border:1px solid #40516d;border-radius:14px;box-shadow:0 16px 38px rgba(0,0,0,.55);font-family:Inter,Segoe UI,Arial,sans-serif;contain:layout style}
                #nic-wrapper[data-theme='light']{background:linear-gradient(145deg,#d9e2ed,#c8d4e1);color:#172438;border-color:#71849c;box-shadow:0 14px 30px rgba(21,35,54,.24)}
                #nic-wrapper[data-runtime='compact']:not([data-minimized='true']){left:calc(var(--nic-vv-left,0px) + env(safe-area-inset-left) + 5px)!important;top:calc(var(--nic-vv-top,0px) + env(safe-area-inset-top) + 5px)!important;right:auto!important;bottom:auto!important;width:max(1px,calc(var(--nic-vv-width,100vw) - env(safe-area-inset-left) - env(safe-area-inset-right) - 10px))!important;height:max(1px,calc(var(--nic-vv-height,100dvh) - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 10px))!important;border-radius:13px}
                #nic-wrapper *,#nic-wrapper *:before,#nic-wrapper *:after{box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere}
                #nic-drag{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:48px;padding:8px 11px;background:linear-gradient(100deg,#1b2a43,#28446a);border-bottom:1px solid #4e6687;cursor:move;user-select:none;touch-action:none}
                #nic-wrapper[data-theme='light'] #nic-drag{background:linear-gradient(100deg,#bbcadd,#d3dee9);border-color:#778ba5}
                #nic-wrapper[data-runtime='compact'] #nic-drag{cursor:default;touch-action:manipulation}
                #nic-wrapper[data-minimized='true'] #nic-drag{height:36px;min-height:36px;padding:0;border:0;justify-content:center;cursor:pointer;touch-action:none}
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
                .nic-export-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.nic-export-actions>span{flex:1 1 150px;color:#9baabd;font-size:10px}.nic-export-actions button{flex:0 1 auto}
                #nic-wrapper[data-theme='light'] .nic-export-actions>span{color:#475d76}
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
                .nic-empty{padding:22px 10px;color:#aebed3;font-size:11px;text-align:center}.nic-settings{display:grid;gap:11px;align-content:start}.nic-card-title{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.nic-card-title h2{margin:0;font-size:15px}.nic-runtime{display:flex;align-items:center;gap:5px;margin-top:3px;color:#9fb0c7;font-size:9px;font-weight:700}.nic-runtime strong{padding:2px 5px;border:1px solid #58769b;border-radius:999px;color:#a9deff;font-size:9px}.nic-settings label{font-size:11px;font-weight:800}.nic-key-row,.nic-setting-actions,.nic-backup-actions{display:flex;gap:7px;flex-wrap:wrap}.nic-key-row input{flex:1 1 180px}.nic-settings p{margin:0;color:#aebed3;font-size:10px;line-height:1.5}.nic-runtime-details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:0}.nic-runtime-details>div{min-width:0;padding:7px 8px;border:1px solid #344d6b;border-radius:8px;background:rgba(20,35,55,.68)}.nic-runtime-details dt{margin:0 0 3px;color:#8fa4be;font-size:8px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.nic-runtime-details dd{margin:0;overflow-wrap:anywhere;color:#e3efff;font-size:10px;font-weight:750;line-height:1.3}.nic-storage-toggle{display:flex;align-items:center;gap:7px;width:max-content;max-width:100%;color:#dcecff}.nic-storage-toggle input{width:15px;height:15px;accent-color:#4dd3be}.nic-storage-help{margin-top:-5px!important}.nic-backup{display:grid;gap:8px;padding:9px;border:1px solid #344d6b;border-radius:8px;background:rgba(20,35,55,.48)}.nic-backup>strong{font-size:11px}.nic-backup-actions button{flex:1 1 135px}
                #nic-wrapper[data-theme='light'] .nic-runtime,#nic-wrapper[data-theme='light'] .nic-settings p,#nic-wrapper[data-theme='light'] .nic-runtime-details dt{color:#465d77}#nic-wrapper[data-theme='light'] .nic-runtime strong{color:#1f587c;border-color:#7591ad}#nic-wrapper[data-theme='light'] .nic-runtime-details>div,#nic-wrapper[data-theme='light'] .nic-backup{background:#d8e4ef;border-color:#96aabe}#nic-wrapper[data-theme='light'] .nic-runtime-details dd,#nic-wrapper[data-theme='light'] .nic-storage-toggle{color:#203650}
                .nic-resize{position:absolute;z-index:4;width:24px;height:24px;touch-action:none}.nic-resize::after{content:'';position:absolute;width:9px;height:9px;pointer-events:none}.nic-resize[data-corner='top-left']{left:0;top:0;cursor:nwse-resize}.nic-resize[data-corner='top-left']::after{left:4px;top:4px;border-left:2px solid #7793bb;border-top:2px solid #7793bb}.nic-resize[data-corner='bottom-left']{left:0;bottom:0;cursor:nesw-resize}.nic-resize[data-corner='bottom-left']::after{left:4px;bottom:4px;border-left:2px solid #7793bb;border-bottom:2px solid #7793bb}.nic-resize[data-corner='bottom-right']{right:0;bottom:0;cursor:nwse-resize}.nic-resize[data-corner='bottom-right']::after{right:4px;bottom:4px;border-right:2px solid #7793bb;border-bottom:2px solid #7793bb}
                #nic-wrapper[data-runtime='compact'] .nic-resize{display:none!important}#nic-wrapper[data-runtime='compact'] button{min-height:38px}#nic-wrapper[data-runtime='compact'] #nic-body{padding:8px}#nic-wrapper[data-runtime='compact'] #nic-content,#nic-wrapper[data-runtime='compact'] .nic-layout{flex:0 0 auto;min-height:auto}#nic-wrapper[data-runtime='compact'] .nic-layout{gap:8px}#nic-wrapper[data-runtime='compact'] .nic-summary-card{padding:8px}#nic-wrapper[data-runtime='compact'] .nic-category-table{flex:0 0 auto;min-height:0;max-height:none;overflow:visible;overscroll-behavior:auto}
                #nic-wrapper[data-narrow='true'] .nic-card-title{flex-wrap:wrap}#nic-wrapper[data-narrow='true'] .nic-card-title>div{flex:1 1 150px}#nic-wrapper[data-narrow='true'] .nic-card-title>button{margin-left:auto}#nic-wrapper[data-narrow='true'] .nic-topline{grid-template-columns:minmax(0,1fr) auto}#nic-wrapper[data-narrow='true'] .nic-topline span{grid-column:1/-1;overflow:visible;text-overflow:clip;white-space:normal;line-height:1.35}#nic-wrapper[data-narrow='true'] .nic-toolbar{flex-wrap:wrap}#nic-wrapper[data-narrow='true'] .nic-toolbar input{width:auto;flex:1 1 170px}#nic-wrapper[data-narrow='true'] .nic-toolbar span{flex:1 1 100%}#nic-wrapper[data-narrow='true'] .nic-export-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}#nic-wrapper[data-narrow='true'] .nic-export-actions>span{grid-column:1/-1}#nic-wrapper[data-narrow='true'] .nic-key-row,#nic-wrapper[data-narrow='true'] .nic-setting-actions,#nic-wrapper[data-narrow='true'] .nic-backup-actions{display:grid;grid-template-columns:1fr}#nic-wrapper[data-narrow='true'] .nic-key-row input{min-height:38px}#nic-wrapper[data-narrow='true'] .nic-runtime-details{grid-template-columns:1fr}#nic-wrapper[data-narrow='true'] .nic-compact-sort,#nic-wrapper[data-narrow='true'] .nic-compact-parent-sort{flex-wrap:wrap}#nic-wrapper[data-narrow='true'] .nic-compact-sort>span,#nic-wrapper[data-narrow='true'] .nic-compact-parent-sort>span{flex:1 0 100%}#nic-wrapper[data-narrow='true'] .nic-compact-sort select,#nic-wrapper[data-narrow='true'] .nic-compact-parent-sort select{flex:1 1 120px}
                #nic-wrapper[data-narrow='true'] .nic-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#nic-wrapper[data-tiny='true'] .nic-summary-grid{grid-template-columns:1fr}#nic-wrapper[data-tiny='true'] .nic-export-actions{grid-template-columns:1fr}#nic-wrapper[data-tiny='true'][data-compact='true'] .nic-category-row{grid-template-columns:1fr!important}#nic-wrapper[data-tiny='true'] .nic-runtime{flex-wrap:wrap}
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
            <header id='nic-drag'><span id='nic-title'></span><button id='nic-minimize' aria-label='Minimize Naughty Inventory Companion'>−</button></header>
            <main id='nic-body'><div id='nic-content'></div></main>
            <i class='nic-resize' data-corner='top-left' title='Resize this tab'></i><i class='nic-resize' data-corner='bottom-left' title='Resize this tab'></i><i class='nic-resize' data-corner='bottom-right' title='Resize this tab'></i>`;
        document.body.appendChild(dashboard);
        state.dashboard = dashboard;
        standardFeedbackLayer();
        bindWindowControls();
        applyWidgetView();
        render();
    }
    async function bootstrap() {
        await RUNTIME_READY;
        const stored = await loadStoredValues();
        const dashboard = stored[STORAGE.dashboard];
        state.savedApiKey = String(stored[STORAGE.key] || "").trim();
        state.apiKey = state.savedApiKey;
        state.apiKeySource = "saved";
        adoptInjectedPdaApiKey();
        state.activeTab = ["inventory", "settings"].includes(dashboard?.activeTab) ? dashboard.activeTab : "inventory";
        state.theme = dashboard?.theme === "light" ? "light" : "dark";
        state.isMinimized = dashboard?.isMinimized === true;
        state.windowSizes = dashboard?.windowSizes && typeof dashboard.windowSizes === "object" ? dashboard.windowSizes : {};
        state.position = stored[STORAGE.position] ?? null;
        state.minimizedPosition = dashboard?.minimizedPosition && typeof dashboard.minimizedPosition === "object" ? dashboard.minimizedPosition : null;
        state.inventory = stored[STORAGE.inventory] ?? null;
        state.parentSort = dashboard?.parentSort?.key ? dashboard.parentSort : state.parentSort;
        state.itemSort = dashboard?.itemSort?.key ? dashboard.itemSort : state.itemSort;
        state.expandedCategories = new Set(Array.isArray(dashboard?.expandedCategories) ? dashboard.expandedCategories : []);
        state.filter = String(dashboard?.filter || "");
        PERSISTENCE.hydrated = true;
        bindTabActivity();
        const startupRuntime = runtimeInfo();
        const startupViewport = getViewportMetrics();
        logInfo("Startup complete.", {
            version: VERSION,
            runtime: startupRuntime.platform,
            view: startupRuntime.mode,
            tornPDAConfirmed: RUNTIME.isTornPDA,
            viewport: startupViewport.width + "x" + startupViewport.height,
            scale: Number(window.visualViewport?.scale) || 1,
            storageMethod: storageMethodLabel(),
            apiKeySource: state.apiKeySource
        });
        initializeDashboard();
        RUNTIME.onChange(() => {
            if (!state.dashboard) return;
            if (RUNTIME.isTornPDA) void promotePdaStorage();
            if (RUNTIME.isTornPDA) {
                adoptInjectedPdaApiKey();
                void refreshNativeTabState();
            }
            const previousMode = state.dashboard.dataset.runtime;
            applyRuntimePresentation();
            applySize();
            applyCompactDetailLayout();
            const runtime = runtimeInfo();
            logInfo("Runtime presentation updated.", { runtime: runtime.platform, view: runtime.mode, tornPDAConfirmed: RUNTIME.isTornPDA });
            if (previousMode !== state.dashboard.dataset.runtime || state.activeTab === "settings") render();
        });
    }
    if (globalThis.__NIC_STORAGE_TEST__) {
        globalThis.__NIC_STORAGE_TEST__.hooks = {
            STORAGE, PERSISTENCE, loadStoredValues, persistValues, flushPersistValues,
            deletePersistedValues, resolveLegacyStoragePreference, createBackup, validateBackup,
            state, inventoryExportData, createInventoryCsv, createInventorySpreadsheet,
            isVirtualKeyboardViewportChange
        };
    } else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void bootstrap());
    else void bootstrap();
})();
