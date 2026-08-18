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
assert.match(source, /if \(index < INVENTORY_CATEGORIES\.length - 1\) await new Promise\(\(resolve\) => setTimeout\(resolve, 650\)\)/);
assert.doesNotMatch(source, /setInterval\(/);
assert.doesNotMatch(source, /scheduleAutoRefresh/);

console.log("Inventory regression checks passed: live-price, equipment, loan, sorting, and manual-only refresh guards.");
