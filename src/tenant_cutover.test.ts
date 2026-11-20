import { strict as assert } from "node:assert";
import { cutoverIsReady } from "./tenant_cutover.ts";

assert.equal(cutoverIsReady({ zone_id: "zone_acme", records_written: 3, domain_verified: true }), true);
assert.equal(cutoverIsReady({ zone_id: "zone_acme", records_written: 2, domain_verified: true }), false);
assert.equal(cutoverIsReady({ zone_id: "zone_acme", records_written: 3, domain_verified: false }), false);
console.log("cutover decision checks passed");
