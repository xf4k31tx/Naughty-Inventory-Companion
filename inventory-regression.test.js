const fs = require("fs");
const assert = require("assert");

const source = fs.readFileSync("Naughty Inventory Companion.user.js", "utf8");

assert.match(source, /const INVENTORY_CATEGORIES = \[/);
assert.match(source, /requestJson\(apiUrl\("torn\/items", \{ cat: "All" \}\)\)/);
assert.match(source, /value\.market_price/);
assert.match(source, /requestJson\(apiUrl\("user\/equipment"\)\)/);
assert.match(source, /equipmentMaps\.bonuses\.get\(uid\)/);
assert.match(source, /equipmentMaps\.mods\.get\(uid\)/);
assert.match(source, /factionOwned: item\.faction_owned === true/);
assert.match(source, /data-parent-sort/);
assert.match(source, /data-item-sort/);
assert.match(source, /const RUNTIME = \(\(\) =>/);
assert.match(source, /PDA_httpGet/);
assert.match(source, /com\\\.manuito\\\.tornpda/);
assert.doesNotMatch(source, /maxTouchPoints|ontouchstart/);
assert.match(source, /window\.visualViewport/);
assert.match(source, /safe-area-inset/);
assert.match(source, /pointerdown/);
assert.match(source, /const COMPACT_DETAIL_WIDTH = 680/);
assert.match(source, /dashboard\.dataset\.compact/);
assert.match(source, /ResizeObserver/);
assert.match(source, /data-item-sort-select/);
assert.match(source, /data-action='flip-item-sort'/);
assert.match(source, /nic-compact-sort/);
assert.match(source, /const PARENT_SORT_OPTIONS = \[/);
assert.match(source, /data-parent-sort-select/);
assert.match(source, /data-action='flip-parent-sort'/);
assert.match(source, /nic-compact-parent-sort/);
assert.match(source, /nic-category-row>div:nth-child\(4\):before\{content:'Category value'/);
assert.match(source, /if \(index < INVENTORY_CATEGORIES\.length - 1\) await new Promise\(\(resolve\) => setTimeout\(resolve, 650\)\)/);
assert.doesNotMatch(source, /setInterval\(/);
assert.doesNotMatch(source, /scheduleAutoRefresh/);

console.log("Inventory regression checks passed: data, manual-only refresh, and TornPDA layout guards.");
