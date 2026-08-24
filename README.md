# Naughty Inventory Companion

Naughty Inventory Companion is a focused Torn inventory dashboard for Tampermonkey and TornPDA. It turns a manual inventory refresh into a searchable, sortable local snapshot with category totals, current catalog market prices, equipped-item details, and loan status.

## What it does

- Loads your Torn inventory categories and the official item catalog market-price snapshot on demand.
- Groups items by category and calculates tracked item count, quantity, category value, and total inventory value.
- Lets you expand a category to inspect individual items, including quantity, unit value, item total, equipped state, perks/bonuses, weapon mods, and owned or loaned status where applicable.
- Searches both category and item names.
- Sorts categories and expanded item rows. Desktop headers are clickable; narrow layouts use compact sort controls so all fields remain usable.
- Remembers expanded categories, filters, sort choices, theme, panel position, and panel size.
- Uses a compact responsive layout on TornPDA and constrained desktop viewports: effective width ≤700px, effective height ≤520px, or scale >1.1 at ≤960px. It follows safe areas and the active visual viewport.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) or use TornPDA’s userscript support.
2. Open the [raw userscript](https://raw.githubusercontent.com/xf4k31tx/Naughty-Inventory-Companion/main/Naughty%20Inventory%20Companion.user.js) and install it.
3. Reload Torn, then open the companion from its launcher.
4. Open **Settings**, enter your Torn API key, and select **Save Key**.
5. Return to **Inventory** and select **Refresh** when you want a new snapshot.

## Using the inventory view

The top summary reports tracked items, total inventory value, and visible categories. Use the filter box to narrow the result set by item or category name.

Select a category row to expand it. The expanded table contains:

- **Item** — item name and equipped indicator.
- **Qty** — owned quantity.
- **Unit Value** and **Item Total** — calculated from Torn’s current catalog market price.
- **Bonus / Perks** — equipped-item bonus information when available.
- **Mods** — equipped weapon modifications when available.
- **Loaned** — owned versus faction-loaned status for loanable categories.

Sorting is independent for categories and expanded items. Your selections are retained locally.

## Refresh and data behavior

Inventory refresh is intentionally **manual only**. The script does not poll your inventory in the background. A refresh obtains the current inventory data, equipped-item details, and official Torn catalog market prices, then stores the resulting snapshot locally for the dashboard.

Values are an estimate based on the latest loaded catalog market price; they are not a sale guarantee and do not account for market liquidity, listing fees, or item condition.

## Desktop and TornPDA

On desktop, the panel can be moved, resized, minimized, and snapped. On TornPDA, it detects the native runtime at startup and follows the usable viewport, device safe areas, and orientation. Narrow layouts reflow detailed rows and expose compact sorting controls instead of forcing tiny columns or horizontal clipping.

## TornPDA compatibility and storage

The companion gives TornPDA's native, per-script `PDA_storage` priority over Tampermonkey storage. It reads the native namespace once at startup (using `loadAll` or `getMany` when provided), keeps a local cache, and batches writes. Existing GM/local values are migrated only for native keys that do not yet exist, so a newer TornPDA value takes precedence. If native storage is absent, unavailable, or reaches its quota, the script continues with compatible GM/local storage; the Settings screen reports which store is active. A late native-runtime confirmation can also promote already loaded compatibility data into `PDA_storage` without losing it.

Native TornPDA detection is bridge-confirmed: the script waits for `flutterInAppWebViewPlatformReady` and checks `isTornPDA`. User-agent hints help it decide whether to wait for that bridge but do not independently identify the runtime. Viewport compactness is a separate decision: confirmed TornPDA, or a constrained desktop viewport, receives the full-viewport safe-area-aware compact layout; normal desktop retains draggable, resizable behavior. Requests prefer the declared GM network APIs and use native `PDA_httpGet` only when the confirmed native bridge is available.

## Privacy and API keys

Your Torn API key, interface preferences, and cached inventory snapshot are stored in your local per-script storage. The script requests Torn data directly from `api.torn.com`. It does not upload inventory data to a separate service.

Treat API keys as secrets. Revoke and replace any key you believe has been exposed.

## Updating

Reopen the raw userscript URL above in your userscript manager to install the newest version. Existing local settings and cached data are retained unless you explicitly clear the cache.

## Verify from source

```powershell
node --check "Naughty Inventory Companion.user.js"
node --test inventory-regression.test.js
```
