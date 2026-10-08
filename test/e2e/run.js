// Runs each end-to-end scenario in its own Electron process and reports the checks.
// Usage: node test/e2e/run.js [scenario ...]   (needs a desktop session; Windows CI has one)
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SCENARIOS } = require("./app/scenarios");

const electron = require("electron"); // the npm package exports the binary path
const appDir = path.join(__dirname, "app");
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIOS);

let pass = 0, fail = 0;
for (const name of names) {
  const result = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nf-e2e-result-")), "result.json");
  const proc = spawnSync(electron, [appDir], {
    env: { ...process.env, NF_SCENARIO: name, NF_RESULT: result, ELECTRON_ENABLE_LOGGING: "" },
    timeout: 90000,
    stdio: "ignore",
  });
  console.log(`\n=== ${name} ===`);
  let out;
  try { out = JSON.parse(fs.readFileSync(result, "utf-8")); }
  catch { console.log(`  ✗ no result (exit ${proc.status}${proc.error ? ", " + proc.error.message : ""})`); fail++; continue; }
  finally { fs.rmSync(path.dirname(result), { recursive: true, force: true }); }
  if (out.tmp && path.basename(out.tmp).startsWith("nf-e2e-")) fs.rmSync(out.tmp, { recursive: true, force: true });
  for (const c of out.checks) {
    if (c.ok) { console.log(`  ✓ ${c.name}`); pass++; }
    else { console.log(`  ✗ ${c.name}${c.detail ? " → " + c.detail : ""}`); fail++; }
  }
  if (out.fatal || out.error) { console.log(`  ✗ ${out.fatal || out.error}`); fail++; }
  if (out.consoleErrors.length) { console.log(`  ✗ renderer console errors: ${out.consoleErrors.join(" | ")}`); fail++; }
  if (!out.checks.length && !out.fatal && !out.error) { console.log("  ✗ scenario made no checks"); fail++; }
}
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
