// Reads the fuses back from a packaged NoteForge.exe and checks each one against
// build.electronFuses in package.json. electron-builder flips them at package time; this
// makes sure the shipped binary really has them (asar integrity, no RunAsNode, ...).
// Usage: node test/check_fuses.js [path to NoteForge.exe]   (default: dist/win-unpacked)
const path = require("path");
const fs = require("fs");
const { getCurrentFuseWire, FuseV1Options } = require("@electron/fuses");
// The wire stores each fuse as an ASCII byte; @electron/fuses does not export its enum
const FuseState = { DISABLE: 0x30, ENABLE: 0x31, 0x30: "DISABLE", 0x31: "ENABLE", 0x72: "REMOVED" };

const root = path.join(__dirname, "..");
const exe = process.argv[2] || path.join(root, "dist", "win-unpacked", "NoteForge.exe");
const wanted = require(path.join(root, "package.json")).build.electronFuses;

(async () => {
  if (!fs.existsSync(exe)) { console.error(`  ✗ ${exe} not found; package first (electron-builder --dir)`); process.exit(1); }
  const wire = await getCurrentFuseWire(exe);
  let fail = 0;
  for (const [key, on] of Object.entries(wanted)) {
    // package.json uses camelCase keys for the FuseV1Options names
    const name = key[0].toUpperCase() + key.slice(1);
    const id = FuseV1Options[name];
    if (id === undefined) { console.log(`  ✗ ${key}: unknown fuse`); fail++; continue; }
    const got = wire[id];
    const ok = got === (on ? FuseState.ENABLE : FuseState.DISABLE);
    console.log(`  ${ok ? "✓" : "✗"} ${key} ${on ? "on" : "off"}${ok ? "" : ` (binary has ${FuseState[got] ?? got})`}`);
    if (!ok) fail++;
  }
  console.log(fail ? `\n  ${fail} fuse(s) wrong` : "\n  fuses match package.json");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
