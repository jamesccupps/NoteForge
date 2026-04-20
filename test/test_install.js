// Structural sanity checks — validates CSP, IPC channel coverage, no eval, hardening flags
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.join(__dirname, "..");

let pass = 0, fail = 0;
const t = (n, ok, d) => { if (ok) { console.log(`  ✓ ${n}`); pass++; } else { console.log(`  ✗ ${n}${d?' → '+d:''}`); fail++; } };

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
t("package.json valid JSON", true);
t("main field correct", pkg.main === "main.js");
t("has electron-builder config", !!pkg.build);
t("electron >= 33", parseInt(pkg.devDependencies.electron.replace(/\D/g, "")) >= 330);

for (const f of ["main.js", "preload.js", "app.js"]) {
  try { new vm.Script(fs.readFileSync(path.join(root, f), "utf-8")); t(`${f} syntactically valid`, true); }
  catch (e) { t(`${f} syntactically valid`, false, e.message); }
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf-8");
t("CSP meta tag present", /Content-Security-Policy/i.test(html));
t("CSP blocks connect-src", /connect-src 'none'/.test(html));
t("CSP has script-src 'self'", /script-src 'self'/.test(html));
t("CSP has default-src 'none'", /default-src 'none'/.test(html));
// Note: SRI hashes intentionally NOT used — they break Electron's file:// loader
// (CORS fails silently with integrity+crossorigin on local files). The scripts'
// integrity is guaranteed by the signed installer and electron-builder ASAR packing.
t("No SRI on local scripts (would break file:// loading)", !/lib\/react\.min\.js.*integrity=/.test(html));

const preload = fs.readFileSync(path.join(root, "preload.js"), "utf-8");
const main = fs.readFileSync(path.join(root, "main.js"), "utf-8");
const invokes = [...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map(m => m[1]);
const sendSyncs = [...preload.matchAll(/ipcRenderer\.sendSync\("([^"]+)"/g)].map(m => m[1]);
const handlers = new Set([
  ...[...main.matchAll(/ipcMain\.handle\("([^"]+)"/g)].map(m => m[1]),
  ...[...main.matchAll(/ipcMain\.on\("([^"]+)"/g)].map(m => m[1])
]);
const missing = [...invokes, ...sendSyncs].filter(ch => !handlers.has(ch));
t("All preload IPC channels have main handlers", missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : null);

t("contextIsolation enabled", /contextIsolation:\s*true/.test(main));
t("nodeIntegration disabled", /nodeIntegration:\s*false/.test(main));
t("sandbox option present", /sandbox:\s*useSandbox/.test(main));
t("Navigation guard present", /will-navigate/.test(main));
t("Permission handler denies all", /setPermissionRequestHandler.*cb\(false\)/s.test(main));
t("electron-updater require guarded", /try\s*{\s*autoUpdater\s*=\s*require\("electron-updater"\)/.test(main));
t("verify-and-restore-backup handler present", /ipcMain\.handle\("verify-and-restore-backup"/.test(main));

const appJsx = fs.readFileSync(path.join(root, "app.jsx"), "utf-8");
t("sanitizeForDiskSync called in persist", appJsx.includes("sanitizeForDiskSync(toSave)"));
t("sanitizeForDiskSync called in beforeunload", appJsx.includes("sanitizeForDiskSync(dataRef.current)"));
t("DOMPurify input-type hook installed", appJsx.includes("installDOMPurifyHook"));
t("Schema version stamped on save", /version:\s*SCHEMA_VERSION/.test(appJsx));
t("Idle timer tracks mousemove/wheel", /"mousemove".*"wheel"|"wheel".*"mousemove"/.test(appJsx));

for (const f of ["main.js", "preload.js", "app.js", "app.jsx"]) {
  const c = fs.readFileSync(path.join(root, f), "utf-8");
  t(`${f}: no eval()`, !/\beval\s*\(/.test(c));
  t(`${f}: no new Function()`, !/new\s+Function\s*\(/.test(c));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail===0?0:1);
