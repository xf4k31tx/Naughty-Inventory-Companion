# Naughty Inventory Companion

Naughty Inventory Companion is a focused Torn inventory dashboard for Tampermonkey and TornPDA. It turns a manual inventory refresh into a searchable, sortable local snapshot with category totals, current catalog market prices, equipped-item details, and loan status.

## Project goals

This open-source userscript helps Torn players understand their own inventory without sending it to a separate companion service. Its goals are a clear local dashboard, reliable exports and backups, privacy-conscious API-key handling, and equal usability on desktop Tampermonkey and TornPDA. It is an independent community project and is not affiliated with Torn or TornPDA.

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
2. Open the [raw userscript](https://raw.githubusercontent.com/SharpSplinter/Naughty-Inventory-Companion/main/Naughty%20Inventory%20Companion.user.js) and install it.
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

## Exports

The Inventory tab exports the complete stored snapshot, not just the currently filtered rows. **Save as CSV** creates a clean, spreadsheet-readable file with a snapshot summary and every item row. **Save as Spreadsheet** creates a formatted `.xlsx` workbook with numeric quantity/currency columns, a filterable item table, and readable widths for item details.

On TornPDA, either action opens the native share sheet from the user’s tap through `shareFile({ base64Data, fileName })`. On desktop, it downloads the file locally. Android and iOS use that system sheet to choose Files or another destination; it is not a browser save-location picker. Exports remain local to the device until you choose a destination in the native share sheet. If TornPDA reports a share failure, the companion reports that failure rather than incorrectly claiming a local download, and it prevents overlapping native share requests.

## Desktop and TornPDA

On desktop, the panel can be moved, resized, minimized, and snapped. On TornPDA, it detects the native runtime at startup and follows the usable viewport, device safe areas, and orientation. Responsive tiers use the actual panel width: details become labeled cards at 680px or below, controls and cards wrap at 480px or below, and summaries/categories become single-column at 360px or below. Desktop tables remain intact above those thresholds. On TornPDA and compact viewports, expanded inventory items flow into the panel body so the main window provides one continuous scroll instead of a separate nested list scroll. Desktop retains its independent category-list scroll. Scrollbar tracks are hidden while wheel, keyboard, and touch scrolling remain native.

## TornPDA compatibility and storage

The companion gives TornPDA's native, per-script `PDA_storage` priority over Tampermonkey storage. It reads the native namespace once at startup (using `loadAll` or `getMany` when provided), keeps a local cache, and batches writes. Existing GM/local values are migrated only for native keys that do not yet exist, so a newer TornPDA value takes precedence. If native storage is absent, unavailable, or reaches its quota, the script continues with compatible GM/local storage; the Settings screen reports which store is active. A late native-runtime confirmation can also promote already loaded compatibility data into `PDA_storage` without losing it.

Settings also shows the active runtime, current visual screen size, and storage method. **Use legacy GM storage** is unchecked by default. Selecting it makes the compatible GM/local store primary; turning it off migrates the current state back to available `PDA_storage` and restores it as the preferred store.

Repeated dashboard saves are merged into a short write queue, then written with one native `setMany` call. The adapter tests cover native-first reads, one-time GM migration, quota fallback, batched writes, and native/GM deletion.

Native TornPDA detection is bridge-confirmed: the script waits for `flutterInAppWebViewPlatformReady` and checks `isTornPDA`. User-agent hints help it decide whether to wait for that bridge but do not independently identify the runtime. Viewport compactness is a separate decision: confirmed TornPDA, or a constrained desktop viewport, receives the full-viewport safe-area-aware compact layout; normal desktop retains draggable, resizable behavior. Requests prefer the declared GM network APIs and use native `PDA_httpGet` only when the confirmed native bridge is available.

## TornPDA-native feedback

When TornPDA injects its API key, the companion uses it without displaying or persisting it; a saved key remains the desktop fallback. Refresh success, errors, setting changes, and the optional **Remind Me Tomorrow** action use TornPDA native toast/notification handlers when available. Refresh work pauses between API calls while the page or TornPDA tab is inactive and resumes when it becomes active again. Desktop retains the in-panel status feedback.

## Backup & restore

Settings can download a versioned JSON backup containing the local inventory snapshot, display preferences, sorting, filters, layout, and storage preference. **Include saved API key** is off by default; TornPDA’s injected key is never exported. On TornPDA, backup download opens the native system share sheet; desktop uses a normal file download. Loading a backup validates its companion schema, asks before replacing local companion data, and restores through the currently selected `PDA_storage` or legacy GM storage backend.

## Diagnostics

The browser console records concise, on-by-default diagnostics for startup/runtime confirmation, storage and native-bridge fallbacks, and each API request. Request logs include only method, host, path, status, and duration; they never include query strings, API keys, headers, or response bodies.

## Privacy and API keys

Your Torn API key, interface preferences, and cached inventory snapshot are stored in your local per-script storage. The script requests Torn data directly from `api.torn.com`. It does not upload inventory data to a separate service.

Treat API keys as secrets. Revoke and replace any key you believe has been exposed.

## Updating

Reopen the raw userscript URL above in your userscript manager to install the newest version. Existing local settings and cached data are retained unless you explicitly clear the cache.

## Community and governance

- [Contributing guidelines](CONTRIBUTING.md) explain how to propose code and documentation changes.
- [Code of Conduct](CODE_OF_CONDUCT.md) sets expectations for every project space.
- [Security policy](SECURITY.md) explains how to report a vulnerability privately.
- Use the [bug report](https://github.com/SharpSplinter/Naughty-Inventory-Companion/issues/new?template=bug_report.yml) and [feature request](https://github.com/SharpSplinter/Naughty-Inventory-Companion/issues/new?template=feature_request.yml) forms for public feedback.
- Source is available under the permissive [MIT License](LICENSE).

## Verify from source

```powershell
node --check "Naughty Inventory Companion.user.js"
node --test inventory-regression.test.js
node --test storage-adapter.test.js
```
