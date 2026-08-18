// ==UserScript==
// @name         Naughty Inventory Companion
// @namespace    https://github.com/xf4k31tx/Naughty-Inventory-Companion
// @version      1.0.0
// @description  Manual Torn inventory tracker with live market values, equipment perks, mods, and loan status.
// @author       sharpsplinter [315311]
// @match        https://www.torn.com/item.php*
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://www.torn.com/bazaar.php*
// @source       https://raw.githubusercontent.com/xf4k31tx/Naughty-Inventory-Companion/main/Naughty%20Inventory%20Companion.user.js
// @updateURL    https://raw.githubusercontent.com/xf4k31tx/Naughty-Inventory-Companion/main/Naughty%20Inventory%20Companion.user.js
// @downloadURL  https://raw.githubusercontent.com/xf4k31tx/Naughty-Inventory-Companion/main/Naughty%20Inventory%20Companion.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @connect      api.torn.com
// ==/UserScript==

(function () {
    "use strict";

    const VERSION = "1.0.0";
    const BASE_URL = "https://api.torn.com/v2/";
    const INVENTORY_CATEGORIES = [
        "medical", "drug", "booster", "alcohol", "candy", "enhancer", "jewelry",
        "plushie", "flower", "temporary", "clothing", "car", "artifact", "book",
        "special", "other", "melee", "primary", "secondary", "tool", "defensive",
        "material", "collectible"
    ];
    const LOANABLE_CATEGORIES = new Set(["temporary", "melee", "primary", "secondary", "tool", "defensive"]);
    const STORAGE = {
        key: "NIC_TORN_API_KEY",
        dashboard: "NIC_DASHBOARD_STATE",
        position: "NIC_WIDGET_POSITION",
        inventory: "NIC_INVENTORY_CACHE"
    };
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

    async function gmGet(key, fallback) {
        try { return await GM.getValue(key, fallback); } catch { return fallback; }
    }
    function gmSet(key, value) {
        void GM.setValue(key, value).catch(() => {});
    }
    function requestJson(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url,
                headers: { Accept: "application/json" },
                onload: (response) => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error("HTTP " + response.status));
                        return;
                    }
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data?.error) reject(new Error(data.error.error || "Torn API error"));
                        else resolve(data);
                    } catch {
                        reject(new Error("Unable to parse Torn API response"));
                    }
                },
                onerror: () => reject(new Error("Network request failed"))
            });
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
        state.refreshInFlight = true;
        state.error = "";
        state.status = "Fetching Torn item-market prices…";
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
                } catch (error) {
                    failures.push(category);
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
            gmSet(STORAGE.inventory, state.inventory);
            state.status = "Live Torn market values loaded.";
        } catch (error) {
            state.error = error.message || "Unable to refresh inventory";
            state.status = "Refresh failed.";
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
        return "<div class='nic-nested'><div class='nic-item-header'>" +
            itemHeader("Item", "name") + itemHeader("Qty", "quantity") + itemHeader("Unit Value", "price") +
            itemHeader("Item Total", "total") + itemHeader("Bonus / Perks", "bonusText") +
            itemHeader("Mods", "modsText") + itemHeader("Loaned", "factionOwned") + "</div>" +
            items.map((item) =>
                "<article class='nic-item-row'>" +
                "<div class='nic-item-name'>" + escapeHtml(item.name) + (item.equipped ? "<span class='nic-equipped'>Equipped</span>" : "") + "</div>" +
                "<div>" + formatInteger(item.quantity) + "</div><div class='nic-money'>" + formatMoney(item.price) + "</div>" +
                "<div class='nic-money nic-total'>" + formatMoney(item.total) + "</div>" +
                "<div class='nic-perks'>" + (item.bonusText ? escapeHtml(item.bonusText) : "—") + "</div>" +
                "<div class='nic-mods'>" + (item.modsText ? escapeHtml(item.modsText) : "—") + "</div>" +
                "<div>" + loanStatus(item, group.category) + "</div></article>"
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
            "<section class='nic-category-table'><div class='nic-parent-header'>" +
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
        return "<section class='nic-settings nic-card'><div class='nic-card-title'><h2>Settings</h2><button data-tab='inventory'>Inventory</button></div>" +
            "<label for='nic-api-key'>Torn API Key</label><div class='nic-key-row'><input id='nic-api-key' type='password' autocomplete='off' value='" +
            escapeHtml(state.apiKey) + "' placeholder='Enter Torn API key'><button data-action='save-key'>Save Key</button></div>" +
            "<p>Inventory is manual-refresh only. Each refresh retrieves the current Torn item catalog market price, inventory categories, and equipped item bonuses/mods.</p>" +
            "<div class='nic-setting-actions'><button data-action='toggle-theme'>Use " + (state.theme === "dark" ? "Light" : "Dark") + " Mode</button>" +
            "<button data-action='clear-cache'>Clear Cached Inventory</button></div></section>";
    }
    function saveDashboardState() {
        gmSet(STORAGE.dashboard, {
            activeTab: state.activeTab, theme: state.theme, isMinimized: state.isMinimized,
            windowSizes: state.windowSizes, parentSort: state.parentSort, itemSort: state.itemSort,
            expandedCategories: [...state.expandedCategories], filter: state.filter
        });
    }
    function sizeKey() {
        return state.activeTab === "settings" ? "settings" : "inventory";
    }
    function getSizeLimits() {
        return {
            minWidth: Math.min(380, Math.max(280, window.innerWidth - 20)),
            minHeight: Math.min(620, Math.max(360, window.innerHeight - 20)),
            maxWidth: Math.max(280, window.innerWidth - 20),
            maxHeight: Math.max(360, window.innerHeight - 20)
        };
    }
    function applyPosition(position = state.position) {
        const dashboard = state.dashboard;
        if (!dashboard) return;
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
        const rect = state.dashboard.getBoundingClientRect();
        const distances = { left: rect.left, right: window.innerWidth - rect.right, top: rect.top, bottom: window.innerHeight - rect.bottom };
        const edge = Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0];
        state.position = { edge, x: rect.left, y: rect.top };
        gmSet(STORAGE.position, state.position);
        applyPosition();
    }
    function saveSize() {
        if (state.isMinimized) return;
        const rect = state.dashboard.getBoundingClientRect();
        state.windowSizes[sizeKey()] = { width: rect.width, height: rect.height };
        saveDashboardState();
    }
    function applySize() {
        if (state.isMinimized) return;
        const dashboard = state.dashboard;
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
            applyPosition();
        } else {
            body.style.setProperty("display", "flex", "important");
            dashboard.style.minWidth = "";
            dashboard.style.minHeight = "";
            dashboard.style.maxWidth = "";
            dashboard.style.maxHeight = "";
            title.textContent = "▣ Naughty Inventory Companion v" + VERSION;
            title.style.fontSize = "12px";
            minimize.style.display = "grid";
            handles.forEach((handle) => { handle.style.display = "block"; });
            dashboard.style.cursor = "";
            applySize();
        }
    }
    function render() {
        const dashboard = state.dashboard;
        if (!dashboard) return;
        dashboard.dataset.theme = state.theme;
        const content = dashboard.querySelector("#nic-content");
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
            gmSet(STORAGE.key, state.apiKey);
            render();
        });
        content.querySelector("[data-action='toggle-theme']")?.addEventListener("click", () => {
            state.theme = state.theme === "dark" ? "light" : "dark";
            saveDashboardState();
            render();
        });
        content.querySelector("[data-action='clear-cache']")?.addEventListener("click", () => {
            state.inventory = null;
            gmSet(STORAGE.inventory, null);
            state.status = "Cached inventory cleared.";
            render();
        });
        content.querySelector("#nic-filter")?.addEventListener("input", (event) => {
            state.filter = event.target.value;
            saveDashboardState();
            render();
        });
        content.querySelectorAll("[data-parent-sort]").forEach((button) => button.onclick = () => {
            const key = button.dataset.parentSort;
            state.parentSort = { key, direction: state.parentSort.key === key && state.parentSort.direction === "asc" ? "desc" : "asc" };
            saveDashboardState();
            render();
        });
        content.querySelectorAll("[data-item-sort]").forEach((button) => button.onclick = () => {
            const key = button.dataset.itemSort;
            state.itemSort = { key, direction: state.itemSort.key === key && state.itemSort.direction === "asc" ? "desc" : "asc" };
            saveDashboardState();
            render();
        });
        content.querySelectorAll("[data-toggle-category]").forEach((button) => button.onclick = () => {
            const category = button.dataset.toggleCategory;
            if (state.expandedCategories.has(category)) state.expandedCategories.delete(category);
            else state.expandedCategories.add(category);
            saveDashboardState();
            render();
        });
    }
    function bindWindowControls() {
        const dashboard = state.dashboard;
        const drag = dashboard.querySelector("#nic-drag");
        let dragging = false, didDrag = false, offsetX = 0, offsetY = 0;
        drag.addEventListener("mousedown", (event) => {
            if (event.target.closest("#nic-minimize")) return;
            const rect = dashboard.getBoundingClientRect();
            dragging = true; didDrag = false;
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
        });
        document.addEventListener("mousemove", (event) => {
            if (!dragging) return;
            didDrag = true;
            const rect = dashboard.getBoundingClientRect();
            dashboard.style.left = clamp(event.clientX - offsetX, 0, window.innerWidth - rect.width) + "px";
            dashboard.style.top = clamp(event.clientY - offsetY, 0, window.innerHeight - rect.height) + "px";
        });
        document.addEventListener("mouseup", () => {
            if (dragging) savePosition();
            dragging = false;
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
        let resizing = false, start = null;
        dashboard.querySelectorAll(".nic-resize").forEach((handle) => handle.addEventListener("mousedown", (event) => {
            if (state.isMinimized) return;
            event.preventDefault(); event.stopPropagation();
            resizing = true;
            start = { x: event.clientX, y: event.clientY, rect: dashboard.getBoundingClientRect(), corner: handle.dataset.corner };
            document.body.style.userSelect = "none";
        }));
        document.addEventListener("mousemove", (event) => {
            if (!resizing || !start) return;
            const limits = getSizeLimits();
            const fromLeft = start.corner.endsWith("left");
            const fromTop = start.corner.startsWith("top");
            const width = clamp(start.rect.width + (fromLeft ? start.x - event.clientX : event.clientX - start.x), limits.minWidth, Math.min(limits.maxWidth, fromLeft ? start.rect.right : window.innerWidth - start.rect.left));
            const height = clamp(start.rect.height + (fromTop ? start.y - event.clientY : event.clientY - start.y), limits.minHeight, Math.min(limits.maxHeight, fromTop ? start.rect.bottom : window.innerHeight - start.rect.top));
            dashboard.style.width = width + "px";
            dashboard.style.height = height + "px";
            dashboard.style.left = (fromLeft ? start.rect.right - width : start.rect.left) + "px";
            dashboard.style.top = (fromTop ? start.rect.bottom - height : start.rect.top) + "px";
        });
        document.addEventListener("mouseup", () => {
            if (!resizing) return;
            resizing = false; start = null; document.body.style.userSelect = "";
            saveSize(); savePosition(); render();
        });
        window.addEventListener("resize", () => { applySize(); saveSize(); });
    }
    function initializeDashboard() {
        const dashboard = document.createElement("aside");
        dashboard.id = "nic-wrapper";
        dashboard.innerHTML = "<style>" +
            "#nic-wrapper{position:fixed;z-index:999999;display:flex;flex-direction:column;overflow:hidden;background:rgba(18,23,32,.98);color:#edf4ff;border:1px solid #34445e;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.5);font-family:Inter,Segoe UI,Arial,sans-serif}" +
            "#nic-wrapper[data-theme='light']{background:#f7fafc;color:#172033;border-color:#cbd5e1}#nic-wrapper *,#nic-wrapper *:before,#nic-wrapper *:after{box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere}" +
            "#nic-drag{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 11px;background:linear-gradient(90deg,#182337,#223653);border-bottom:1px solid #435671;cursor:move;user-select:none}#nic-wrapper[data-theme='light'] #nic-drag{background:#e8f0fa;border-color:#cbd5e1}" +
            "#nic-title{font-size:12px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#nic-minimize{width:36px;height:30px;flex:0 0 36px;place-items:center;border:1px solid #6980a0;border-radius:6px;background:#263b59;color:#fff;font-size:19px;font-weight:700;cursor:pointer}" +
            "#nic-body{display:flex!important;flex:1 1 auto;min-height:0;overflow:auto;padding:10px;scrollbar-width:none;-ms-overflow-style:none}#nic-body::-webkit-scrollbar,.nic-category-table::-webkit-scrollbar{width:0;height:0}#nic-content{display:grid;gap:9px;width:100%;align-content:start}" +
            "button{border:1px solid #455a78;border-radius:6px;background:#263b59;color:#fff;padding:6px 9px;font-size:11px;font-weight:650;cursor:pointer}button:hover{filter:brightness(1.15)}button:disabled{opacity:.5;cursor:not-allowed}#nic-wrapper[data-theme='light'] button{background:#e4edf8;color:#172033;border-color:#9aafc9}.nic-topline{display:flex;align-items:center;gap:7px;color:#aebed3;font-size:10px}.nic-topline span{flex:1}.nic-topline button:first-of-type{background:#28704d;border-color:#38855e;color:#fff}.nic-summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.nic-summary-card,.nic-card{width:100%;border:1px solid #34445e;border-radius:8px;padding:10px;background:linear-gradient(145deg,rgba(34,50,76,.82),rgba(17,24,36,.78))}#nic-wrapper[data-theme='light'] .nic-summary-card,#nic-wrapper[data-theme='light'] .nic-card{background:#fff;border-color:#cbd5e1}.nic-summary-card span{display:block;color:#aebed3;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}.nic-summary-card strong{display:block;color:#86d49b;font-size:16px;margin:4px 0}.nic-summary-card small{color:#9baabd;font-size:10px;line-height:1.3}.nic-toolbar{display:flex;align-items:center;gap:8px;color:#9baabd;font-size:10px}.nic-toolbar input,.nic-key-row input{flex:1;min-width:0;border:1px solid #4d6282;border-radius:6px;background:#111a28;color:#fff;padding:7px 8px;font-size:11px}#nic-wrapper[data-theme='light'] .nic-toolbar input,#nic-wrapper[data-theme='light'] .nic-key-row input{background:#fff;color:#172033;border-color:#94a3b8}.nic-category-table{width:100%;overflow:auto;scrollbar-width:none;-ms-overflow-style:none;border:1px solid #34445e;border-radius:8px;background:rgba(10,15,24,.55)}#nic-wrapper[data-theme='light'] .nic-category-table{background:#fff;border-color:#cbd5e1}.nic-parent-header,.nic-category-row{display:grid;grid-template-columns:minmax(130px,1.7fr) minmax(52px,.65fr) minmax(54px,.7fr) minmax(102px,1.1fr) minmax(56px,.55fr);gap:6px;align-items:center;width:100%}.nic-parent-header{position:sticky;top:0;z-index:3;padding:5px 6px;background:#25364f;border-bottom:1px solid #4a5e7c}#nic-wrapper[data-theme='light'] .nic-parent-header{background:#e8f0fa;border-color:#cbd5e1}.nic-column-button,.nic-nested-button{padding:2px 0;border:0;background:transparent!important;color:inherit!important;text-align:left;font-size:10px;font-weight:800}.nic-column-button span,.nic-nested-button span{color:#8eb5e5}.nic-column-button:not(:first-child){text-align:right}.nic-category{border-bottom:1px solid #273449}.nic-category:last-child{border-bottom:0}.nic-category-row{border:0;border-radius:0;background:rgba(30,45,67,.62);padding:8px 7px;color:#eaf2ff;text-align:right;font-size:11px}#nic-wrapper[data-theme='light'] .nic-category-row{background:#f8fafc;color:#172033}.nic-category-row:hover{background:#314967}.nic-category-name{text-align:left;font-weight:800;text-transform:capitalize}.nic-caret{display:inline-block;width:16px;color:#8eb5e5;font-size:16px;line-height:10px}.nic-money{text-align:right}.nic-total{color:#86d49b;font-weight:800}.nic-nested{padding:0 7px 8px;background:rgba(11,17,26,.62)}#nic-wrapper[data-theme='light'] .nic-nested{background:#f8fafc}.nic-item-header,.nic-item-row{display:grid;grid-template-columns:minmax(128px,1.7fr) minmax(42px,.5fr) minmax(80px,.95fr) minmax(84px,1fr) minmax(110px,1.45fr) minmax(92px,1.2fr) minmax(58px,.7fr);gap:6px;align-items:center}.nic-item-header{padding:7px 5px 4px;color:#aebed3;border-bottom:1px solid #34445e}.nic-item-header .nic-nested-button:not(:first-child){text-align:right}.nic-item-row{padding:7px 5px;border-bottom:1px solid #1e2a3b;font-size:10px;color:#d6e0ed}.nic-item-row:last-child{border-bottom:0}.nic-item-row>div:not(:first-child){text-align:right}.nic-item-name{font-weight:750;color:#f4f8ff;text-align:left!important}.nic-equipped{display:inline-block;margin-left:5px;padding:1px 4px;border:1px solid #467eb0;border-radius:3px;color:#9dd8ff;font-size:8px;text-transform:uppercase}.nic-perks{color:#9dd8ff}.nic-mods{color:#d2a8ff}.nic-loaned{color:#f1b86e;font-weight:750}.nic-owned{color:#86d49b;font-weight:750}.nic-muted{color:#718096}.nic-warning,.nic-error{padding:7px 9px;border-radius:6px;font-size:10px}.nic-warning{border:1px solid #8a6e36;background:rgba(151,111,36,.18);color:#f1cb82}.nic-error{border:1px solid #9a4646;background:rgba(151,45,45,.2);color:#ffadad}.nic-empty{padding:18px 8px;color:#9baabd;font-size:11px;text-align:center}.nic-settings{display:grid;gap:9px}.nic-card-title{display:flex;justify-content:space-between;align-items:center;gap:8px}.nic-card-title h2{margin:0;font-size:14px}.nic-settings label{font-size:11px;font-weight:800}.nic-key-row,.nic-setting-actions{display:flex;gap:7px}.nic-settings p{margin:0;color:#9baabd;font-size:10px;line-height:1.45}.nic-resize{position:absolute;z-index:4;width:20px;height:20px;touch-action:none}.nic-resize[data-corner='top-left']{left:0;top:0;cursor:nwse-resize}.nic-resize[data-corner='bottom-left']{left:0;bottom:0;cursor:nesw-resize}.nic-resize[data-corner='bottom-right']{right:0;bottom:0;cursor:nwse-resize}@media(max-width:600px){.nic-summary-grid{grid-template-columns:1fr}.nic-parent-header,.nic-category-row{grid-template-columns:minmax(105px,1.5fr) minmax(42px,.55fr) minmax(45px,.6fr) minmax(88px,1fr) minmax(42px,.45fr);font-size:9px}.nic-item-header,.nic-item-row{grid-template-columns:minmax(88px,1.35fr) minmax(34px,.45fr) minmax(58px,.8fr) minmax(62px,.85fr) minmax(80px,1.1fr) minmax(68px,1fr) minmax(43px,.55fr);font-size:8px}.nic-item-row{gap:3px}.nic-item-header{gap:3px}}" +
            "</style><header id='nic-drag'><span id='nic-title'></span><button id='nic-minimize' aria-label='Minimize Naughty Inventory Companion'>−</button></header><main id='nic-body'><div id='nic-content'></div></main><i class='nic-resize' data-corner='top-left' title='Resize this tab'></i><i class='nic-resize' data-corner='bottom-left' title='Resize this tab'></i><i class='nic-resize' data-corner='bottom-right' title='Resize this tab'></i>";
        document.body.appendChild(dashboard);
        state.dashboard = dashboard;
        bindWindowControls();
        applyWidgetView();
        render();
    }
    async function bootstrap() {
        const [apiKey, dashboard, position, inventory] = await Promise.all([
            gmGet(STORAGE.key, ""), gmGet(STORAGE.dashboard, {}), gmGet(STORAGE.position, null), gmGet(STORAGE.inventory, null)
        ]);
        state.apiKey = String(apiKey || "").trim();
        state.activeTab = ["inventory", "settings"].includes(dashboard?.activeTab) ? dashboard.activeTab : "inventory";
        state.theme = dashboard?.theme === "light" ? "light" : "dark";
        state.isMinimized = dashboard?.isMinimized === true;
        state.windowSizes = dashboard?.windowSizes && typeof dashboard.windowSizes === "object" ? dashboard.windowSizes : {};
        state.position = position;
        state.inventory = inventory;
        state.parentSort = dashboard?.parentSort?.key ? dashboard.parentSort : state.parentSort;
        state.itemSort = dashboard?.itemSort?.key ? dashboard.itemSort : state.itemSort;
        state.expandedCategories = new Set(Array.isArray(dashboard?.expandedCategories) ? dashboard.expandedCategories : []);
        state.filter = String(dashboard?.filter || "");
        initializeDashboard();
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void bootstrap());
    else void bootstrap();
})();
