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
// Electron supports only the latest three majors; 44 was current when this was written.
const electronMajor = parseInt(pkg.devDependencies.electron.replace(/^[^\d]*/, ""), 10);
t(`electron major >= 44 (got ${electronMajor})`, electronMajor >= 44);

// lib/purify.min.js is what ships; the dompurify devDependency is only its source
// (npm run vendor:dompurify). Keep them on the same exact version.
const bundled = (fs.readFileSync(path.join(root, "lib", "purify.min.js"), "utf-8").match(/DOMPurify (\d+\.\d+\.\d+)/) || [])[1];
t(`dompurify devDependency pinned to the bundled version (${bundled})`, pkg.devDependencies.dompurify === bundled, pkg.devDependencies.dompurify);

// Vendored scripts are what the app runs. Compared with line endings normalized, since
// a Windows checkout may have converted them.
const crypto = require("crypto");
const text = (p) => fs.readFileSync(p, "utf-8").replace(/\r\n/g, "\n");
const sha256 = (p) => crypto.createHash("sha256").update(text(p)).digest("hex");
const npmPurify = path.join(root, "node_modules", "dompurify", "dist", "purify.min.js");
if (fs.existsSync(npmPurify)) t("lib/purify.min.js is the npm build, byte for byte", text(path.join(root, "lib", "purify.min.js")) === text(npmPurify));
// React 18.3.1 production UMD builds (umd/*.production.min.js in the npm packages)
t("lib/react.min.js is React 18.3.1", sha256(path.join(root, "lib", "react.min.js")) === "d949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd");
t("lib/react-dom.min.js is ReactDOM 18.3.1", sha256(path.join(root, "lib", "react-dom.min.js")) === "35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d");

// Release builds are signed by scripts/azure-sign.js, and the updater checks the next
// update was signed by the same publisher (publisherName goes into app-update.yml)
const signOpts = pkg.build.win.signtoolOptions || {};
t("Windows signing hook configured", signOpts.sign === "scripts/azure-sign.js" && fs.existsSync(path.join(root, signOpts.sign)));
t("one SHA-256 signature per file", JSON.stringify(signOpts.signingHashAlgorithms) === '["sha256"]');
t("updates must be signed by James Cupps", (signOpts.publisherName || []).includes("CN=James Cupps, O=James Cupps"));
t("signing hook isn't packaged", !pkg.build.files.some((f) => f.startsWith("scripts")));

for (const f of ["main.js", "preload.js", "app.js"]) {
  try { new vm.Script(fs.readFileSync(path.join(root, f), "utf-8")); t(`${f} syntactically valid`, true); }
  catch (e) { t(`${f} syntactically valid`, false, e.message); }
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf-8");
t("CSP meta tag present", /Content-Security-Policy/i.test(html));
t("CSP blocks connect-src", /connect-src 'none'/.test(html));
t("CSP has script-src 'self'", /script-src 'self'/.test(html));
t("CSP has default-src 'none'", /default-src 'none'/.test(html));
t("CSP has base-uri 'none'", /base-uri 'none'/.test(html));
t("CSP has form-action 'none'", /form-action 'none'/.test(html));
// Note: SRI hashes intentionally NOT used — they break Electron's file:// loader
// (CORS fails silently with integrity+crossorigin on local files). Packaged builds
// rely on the embedded-asar-integrity fuse instead (see build.electronFuses).
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
t("DevTools off in packaged builds", /devTools:\s*IS_DEV/.test(main));
t("sandbox option present", /sandbox:\s*useSandbox/.test(main));
t("Navigation guard present", /will-navigate/.test(main));
t("Permission handler denies all", /setPermissionRequestHandler.*cb\(false\)/s.test(main));
t("electron-updater require guarded", /try\s*{\s*autoUpdater\s*=\s*require\("electron-updater"\)/.test(main));
t("verify-and-restore-backup handler present", /ipcMain\.handle\("verify-and-restore-backup"/.test(main));
t("About dialog version comes from package.json", /"NoteForge v" \+ app\.getVersion\(\)/.test(main) && !/NoteForge v\d/.test(main));

const appJsx = fs.readFileSync(path.join(root, "app.jsx"), "utf-8");
// Open protected notebooks are sealed in main (writeAppData); see test_crypto for the behaviour
t("every async save goes through saveNow (one store.set call)", (appJsx.match(/store\.set\(/g) || []).length === 1);
t("close flush passes the notebook key handles", appJsx.includes("storageSetSync(json,Object.fromEntries(nbKeys.current))"));
t("main seals before it strips", /sealOpenNotebooks\(value, nbKeyIds\);\s*value = stripLockedSections\(sealed\.value\)/.test(main));
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
