const { app, BrowserWindow, Menu, shell, dialog, ipcMain, session } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { autoUpdater } = require("electron-updater");

let mainWindow;
const userDataPath = app.getPath("userData");
const plainFile = path.join(userDataPath, "noteforge-data.json");
const encFile = path.join(userDataPath, "noteforge-data.enc");
const stateFile = path.join(userDataPath, "window-state.json");
const hintFile = path.join(userDataPath, "noteforge-hint.txt");
const rlFile = path.join(userDataPath, "ratelimit.json");
const IS_DEV = !app.isPackaged;

/* ═══════════════════════════════════════════════════════════════
   CRYPTO — AES-256-GCM + scrypt
   ═══════════════════════════════════════════════════════════════ */
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const SALT_LEN = 32;
const IV_LEN = 16;
const SCRYPT_N = 65536;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

function deriveKey(password, salt, N, r, p) {
  return crypto.scryptSync(password, salt, KEY_LEN, {
    N: N || SCRYPT_N, r: r || SCRYPT_R, p: p || SCRYPT_P, maxmem: SCRYPT_MAXMEM
  });
}

// Full encrypt (for initial setup, password changes, notebook encryption)
function encryptData(plaintext, password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let enc = cipher.update(plaintext, "utf-8", "base64");
  enc += cipher.final("base64");
  const tag = cipher.getAuthTag();
  key.fill(0);
  return JSON.stringify({
    v: 2, kdf: "scrypt", N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
    salt: salt.toString("hex"), iv: iv.toString("hex"),
    tag: tag.toString("hex"), data: enc,
  });
}

// Full decrypt (for initial unlock, password verification)
function decryptData(encJson, password) {
  const obj = JSON.parse(encJson);
  const N = obj.N || 16384, r = obj.r || 8, p = obj.p || 1;
  const salt = Buffer.from(obj.salt, "hex");
  const key = deriveKey(password, salt, N, r, p);
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(obj.iv, "hex"));
  decipher.setAuthTag(Buffer.from(obj.tag, "hex"));
  let dec = decipher.update(obj.data, "base64", "utf-8");
  dec += decipher.final("utf-8");
  // Return key info for session caching
  return { plaintext: dec, key, salt, isV1: !obj.v || obj.v < 2 };
}

/* ── Session key (derived key stored instead of password) ───── */
let sessionKey = null;   // Buffer — can be zeroed
let sessionSalt = null;  // Buffer — for re-encryptions

function encryptWithSession(plaintext) {
  if (!sessionKey) throw new Error("No session key");
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, sessionKey, iv);
  let enc = cipher.update(plaintext, "utf-8", "base64");
  enc += cipher.final("base64");
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 2, kdf: "scrypt", N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
    salt: sessionSalt.toString("hex"), iv: iv.toString("hex"),
    tag: tag.toString("hex"), data: enc,
  });
}

function decryptWithSession(encJson) {
  if (!sessionKey) throw new Error("No session key");
  const obj = JSON.parse(encJson);
  const decipher = crypto.createDecipheriv(ALGO, sessionKey, Buffer.from(obj.iv, "hex"));
  decipher.setAuthTag(Buffer.from(obj.tag, "hex"));
  let dec = decipher.update(obj.data, "base64", "utf-8");
  dec += decipher.final("utf-8");
  return dec;
}

function lockSession() {
  if (sessionKey) { sessionKey.fill(0); sessionKey = null; }
  sessionSalt = null;
}

/* ═══════════════════════════════════════════════════════════════
   SERVER-SIDE DATA SANITIZATION
   ═══════════════════════════════════════════════════════════════ */
function sanitizeDataJson(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    if (data?.notebooks) {
      data.notebooks = data.notebooks.map(nb => nb.locked ? { ...nb, sections: [] } : nb);
    }
    return JSON.stringify(data);
  } catch { return jsonStr; }
}

/* ═══════════════════════════════════════════════════════════════
   PASSWORD STRENGTH — expanded list (~200 common passwords)
   ═══════════════════════════════════════════════════════════════ */
const WEAK_PASSWORDS = new Set([
  "password","123456","12345678","qwerty","abc123","monkey","1234567","letmein",
  "trustno1","dragon","baseball","iloveyou","master","sunshine","ashley","bailey",
  "passw0rd","shadow","123123","654321","superman","qazwsx","michael","football",
  "password1","password123","welcome","jesus","ninja","mustang","password2",
  "amanda","whatever","trustme","jordan","harley","ranger","admin","admin123",
  "changeme","test","test123","guest","root","secret","love","hello",
  "charlie","donald","robert","thomas","george","soccer","hockey","killer",
  "andrew","joshua","matrix","hunter","summer","winter","spring","autumn",
  "diamond","forever","freedom","warrior","princess","thunder","ginger","pepper",
  "maggie","maverick","phoenix","cookie","butter","flower","garden","chocolate",
  "starwars","cheese","guitar","coffee","banana","cherry","orange","purple",
  "silver","golden","bronze","midnight","morning","sunset","moonlight","crystal",
  "sparkle","rainbow","butterfly","dolphin","unicorn","penguin","chicken",
  "monkey1","monkey123","dragon1","dragon123","master1","master123",
  "qwerty123","abc1234","abcdef","asdfgh","zxcvbn","112233","121212",
  "111111","000000","999999","696969","1q2w3e","q1w2e3","qwertyuiop",
  "iloveu","access","flower","lovely","biteme","angel1","baseball1",
  "soccer1","football1","letmein1","trustno","welcome1","charlie1",
  "donald1","robert1","thomas1","batman","spider","matrix1","samsung",
  "computer","internet","america","england","canada","australia",
  "january","february","december","monday","friday","saturday","sunday",
  "password12","password01","pa55word","p@ssword","p@ssw0rd","passw0rd1",
]);

function checkPasswordStrength(pw) {
  if (!pw || pw.length < 10) return "Password must be at least 10 characters";
  if (WEAK_PASSWORDS.has(pw.toLowerCase())) return "This password is too common — choose something unique";
  if (WEAK_PASSWORDS.has(pw.toLowerCase().replace(/[0-9!@#$%^&*]+$/,""))) return "Adding numbers/symbols to a common word isn't enough";
  const hasUpper = /[A-Z]/.test(pw);
  const hasLower = /[a-z]/.test(pw);
  const hasDigit = /[0-9]/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  const classes = [hasUpper, hasLower, hasDigit, hasSymbol].filter(Boolean).length;
  if (classes < 3) return "Use at least 3 of: uppercase, lowercase, numbers, symbols";
  // Entropy check — reject low-entropy patterns
  const unique = new Set(pw.toLowerCase()).size;
  if (unique < 5) return "Too many repeated characters — use more variety";
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   BRUTE-FORCE RATE LIMITING (separate master vs notebook counters)
   ═══════════════════════════════════════════════════════════════ */
let masterFails = 0, masterLockout = 0;
let nbFails = 0, nbLockout = 0;
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;

try {
  if (fs.existsSync(rlFile)) {
    const rl = JSON.parse(fs.readFileSync(rlFile, "utf-8"));
    masterFails = rl.masterFails || rl.failCount || 0;
    masterLockout = rl.masterLockout || rl.lockoutUntil || 0;
    nbFails = rl.nbFails || 0;
    nbLockout = rl.nbLockout || 0;
  }
} catch {}

function saveRateLimit() {
  try { fs.writeFileSync(rlFile, JSON.stringify({ masterFails, masterLockout, nbFails, nbLockout }), "utf-8"); } catch {}
}
function checkMasterRateLimit() {
  const now = Date.now();
  if (now < masterLockout) return `Too many failed attempts. Try again in ${Math.ceil((masterLockout - now) / 1000)}s`;
  return null;
}
function recordMasterFailure() {
  masterFails++;
  if (masterFails >= MAX_ATTEMPTS) masterLockout = Date.now() + BASE_DELAY_MS * Math.pow(2, masterFails - MAX_ATTEMPTS);
  saveRateLimit();
}
function recordMasterSuccess() { masterFails = 0; masterLockout = 0; saveRateLimit(); }

function checkNbRateLimit() {
  const now = Date.now();
  if (now < nbLockout) return `Too many failed attempts. Try again in ${Math.ceil((nbLockout - now) / 1000)}s`;
  return null;
}
function recordNbFailure() {
  nbFails++;
  if (nbFails >= MAX_ATTEMPTS) nbLockout = Date.now() + BASE_DELAY_MS * Math.pow(2, nbFails - MAX_ATTEMPTS);
  saveRateLimit();
}
function recordNbSuccess() { nbFails = 0; nbLockout = 0; saveRateLimit(); }

/* ═══════════════════════════════════════════════════════════════
   WINDOW STATE
   ═══════════════════════════════════════════════════════════════ */
function loadWindowState() {
  try { if (fs.existsSync(stateFile)) return JSON.parse(fs.readFileSync(stateFile, "utf-8")); } catch {}
  return { width: 1400, height: 900, x: undefined, y: undefined, maximized: false };
}
let saveStateTimer = null;
function saveWindowState() {
  if (!mainWindow) return;
  if (saveStateTimer) clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(() => {
    try {
      const b = mainWindow.getNormalBounds();
      fs.writeFileSync(stateFile, JSON.stringify({ ...b, maximized: mainWindow.isMaximized() }), "utf-8");
    } catch {}
  }, 300);
}
function saveWindowStateSync() {
  if (!mainWindow) return;
  try {
    const b = mainWindow.getNormalBounds();
    fs.writeFileSync(stateFile, JSON.stringify({ ...b, maximized: mainWindow.isMaximized() }), "utf-8");
  } catch {}
}

/* ═══════════════════════════════════════════════════════════════
   IPC: ENCRYPTION STATUS & HINT
   ═══════════════════════════════════════════════════════════════ */
ipcMain.handle("check-encryption", async () => {
  let hint = null;
  try { if (fs.existsSync(hintFile)) hint = fs.readFileSync(hintFile, "utf-8").trim(); } catch {}
  return { encrypted: fs.existsSync(encFile), hasData: fs.existsSync(encFile) || fs.existsSync(plainFile), hint };
});

ipcMain.handle("set-hint", async (_e, hint) => {
  try {
    if (hint && hint.trim()) fs.writeFileSync(hintFile, hint.trim(), "utf-8");
    else if (fs.existsSync(hintFile)) fs.unlinkSync(hintFile);
    return true;
  } catch { return false; }
});

/* ═══════════════════════════════════════════════════════════════
   IPC: STORAGE (uses session key when available)
   ═══════════════════════════════════════════════════════════════ */
ipcMain.handle("storage-get", async () => {
  try {
    if (fs.existsSync(encFile)) {
      if (!sessionKey) return { needsPassword: true };
      return { value: decryptWithSession(fs.readFileSync(encFile, "utf-8")) };
    }
    if (fs.existsSync(plainFile)) return { value: fs.readFileSync(plainFile, "utf-8") };
  } catch (e) { return { error: e.message }; }
  return null;
});

ipcMain.handle("storage-set", async (_e, value) => {
  try {
    if (sessionKey) {
      fs.writeFileSync(encFile, encryptWithSession(value), "utf-8");
      if (fs.existsSync(plainFile)) fs.unlinkSync(plainFile);
    } else {
      fs.writeFileSync(plainFile, value, "utf-8");
    }
    return true;
  } catch (e) { return false; }
});

ipcMain.on("storage-set-sync", (event, value) => {
  try {
    if (sessionKey) {
      fs.writeFileSync(encFile, encryptWithSession(value), "utf-8");
      if (fs.existsSync(plainFile)) fs.unlinkSync(plainFile);
    } else {
      fs.writeFileSync(plainFile, value, "utf-8");
    }
    event.returnValue = true;
  } catch (e) { event.returnValue = false; }
});

/* ═══════════════════════════════════════════════════════════════
   IPC: MASTER PASSWORD (derived key cached, password discarded)
   ═══════════════════════════════════════════════════════════════ */
ipcMain.handle("unlock-master", async (_e, password) => {
  const rlErr = checkMasterRateLimit();
  if (rlErr) return { error: rlErr };
  try {
    if (!fs.existsSync(encFile)) return { error: "No encrypted data found" };
    const raw = fs.readFileSync(encFile, "utf-8");
    const result = decryptData(raw, password);
    recordMasterSuccess();
    // Auto-upgrade v1 → v2: re-encrypt with FULL v2 params using the password
    // MUST happen before we discard the password, because the v1-derived key
    // can't be used with v2 headers (different N → different key from same password)
    if (result.isV1) {
      result.key.fill(0); // discard v1 key
      const v2enc = encryptData(result.plaintext, password);
      fs.writeFileSync(encFile, v2enc, "utf-8");
      // Now derive the session key from the v2 file
      const v2obj = JSON.parse(v2enc);
      sessionSalt = Buffer.from(v2obj.salt, "hex");
      sessionKey = deriveKey(password, sessionSalt);
    } else {
      sessionKey = result.key;
      sessionSalt = result.salt;
    }
    return { success: true, value: result.plaintext };
  } catch (e) { recordMasterFailure(); return { error: "Wrong password" }; }
});

ipcMain.handle("enable-encryption", async (_e, password, hint) => {
  const strengthErr = checkPasswordStrength(password);
  if (strengthErr) return { error: strengthErr };
  try {
    let data = "{}";
    if (fs.existsSync(plainFile)) data = fs.readFileSync(plainFile, "utf-8");
    else if (sessionKey) data = decryptWithSession(fs.readFileSync(encFile, "utf-8"));
    // Sanitize before encrypting
    data = sanitizeDataJson(data);
    const enc = encryptData(data, password);
    fs.writeFileSync(encFile, enc, "utf-8");
    if (fs.existsSync(plainFile)) fs.unlinkSync(plainFile);
    // Cache new session key
    const obj = JSON.parse(enc);
    sessionKey = deriveKey(password, Buffer.from(obj.salt, "hex"));
    sessionSalt = Buffer.from(obj.salt, "hex");
    // Save hint
    if (hint && hint.trim()) fs.writeFileSync(hintFile, hint.trim(), "utf-8");
    return { success: true };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle("disable-encryption", async (_e, password) => {
  const rlErr = checkMasterRateLimit();
  if (rlErr) return { error: rlErr };
  try {
    if (!fs.existsSync(encFile)) return { error: "Not encrypted" };
    const result = decryptData(fs.readFileSync(encFile, "utf-8"), password);
    result.key.fill(0);
    // Sanitize before writing plaintext
    fs.writeFileSync(plainFile, sanitizeDataJson(result.plaintext), "utf-8");
    fs.unlinkSync(encFile);
    if (fs.existsSync(hintFile)) fs.unlinkSync(hintFile);
    lockSession();
    recordMasterSuccess();
    return { success: true };
  } catch (e) { recordMasterFailure(); return { error: "Wrong password" }; }
});

ipcMain.handle("change-master-password", async (_e, oldPassword, newPassword) => {
  const rlErr = checkMasterRateLimit();
  if (rlErr) return { error: rlErr };
  const strengthErr = checkPasswordStrength(newPassword);
  if (strengthErr) return { error: strengthErr };
  try {
    if (!fs.existsSync(encFile)) return { error: "Not encrypted" };
    const result = decryptData(fs.readFileSync(encFile, "utf-8"), oldPassword);
    result.key.fill(0);
    // Re-encrypt with new password, sanitize
    const sanitized = sanitizeDataJson(result.plaintext);
    const enc = encryptData(sanitized, newPassword);
    fs.writeFileSync(encFile, enc, "utf-8");
    // Cache new session key
    const obj = JSON.parse(enc);
    if (sessionKey) sessionKey.fill(0);
    sessionKey = deriveKey(newPassword, Buffer.from(obj.salt, "hex"));
    sessionSalt = Buffer.from(obj.salt, "hex");
    recordMasterSuccess();
    return { success: true };
  } catch (e) { recordMasterFailure(); return { error: "Wrong current password" }; }
});

ipcMain.handle("check-password-strength", async (_e, pw) => ({ error: checkPasswordStrength(pw) }));
ipcMain.handle("lock-app", async () => { lockSession(); return { success: true }; });

/* ═══════════════════════════════════════════════════════════════
   IPC: NOTEBOOK ENCRYPTION (password-based, not session key)
   ═══════════════════════════════════════════════════════════════ */
ipcMain.handle("encrypt-notebook-sections", async (_e, json, password) => {
  const strengthErr = checkPasswordStrength(password);
  if (strengthErr) return { error: strengthErr };
  try { return { success: true, blob: encryptData(json, password) }; }
  catch (e) { return { error: e.message }; }
});

ipcMain.handle("decrypt-notebook-sections", async (_e, blob, password) => {
  const rlErr = checkNbRateLimit();
  if (rlErr) return { error: rlErr };
  try {
    const result = decryptData(blob, password);
    result.key.fill(0);
    recordNbSuccess();
    return { success: true, sections: result.plaintext };
  } catch (e) { recordNbFailure(); return { error: "Wrong password" }; }
});

/* ═══════════════════════════════════════════════════════════════
   IPC: BACKUP
   ═══════════════════════════════════════════════════════════════ */
ipcMain.handle("export-backup", async () => {
  if (!fs.existsSync(encFile)) return { error: "No encrypted data to backup. Enable encryption first." };
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `NoteForge-Backup-${new Date().toISOString().slice(0,10)}.enc`,
    filters: [{ name: "NoteForge Encrypted Backup", extensions: ["enc"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  try {
    fs.copyFileSync(encFile, result.filePath);
    // Include hint if exists
    if (fs.existsSync(hintFile)) {
      fs.writeFileSync(result.filePath + ".hint", fs.readFileSync(hintFile, "utf-8"), "utf-8");
    }
    return { success: true, path: result.filePath };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle("restore-backup", async () => {
  const warn = await dialog.showMessageBox(mainWindow, {
    type: "warning", title: "Restore Backup",
    message: "This will replace ALL current data.",
    detail: "Your current notes will be overwritten with the backup. You'll need to enter the backup's password to unlock. Continue?",
    buttons: ["Restore", "Cancel"], defaultId: 1, cancelId: 1,
  });
  if (warn.response !== 0) return { canceled: true };
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: "NoteForge Encrypted Backup", extensions: ["enc"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  try {
    const src = result.filePaths[0];
    // Validate it's actually encrypted data
    const raw = fs.readFileSync(src, "utf-8");
    const obj = JSON.parse(raw);
    if (!obj.data || !obj.salt || !obj.iv || !obj.tag) return { error: "Invalid backup file" };
    fs.copyFileSync(src, encFile);
    // Restore hint if exists
    if (fs.existsSync(src + ".hint")) {
      fs.writeFileSync(hintFile, fs.readFileSync(src + ".hint", "utf-8"), "utf-8");
    }
    // Remove plain file if exists
    if (fs.existsSync(plainFile)) fs.unlinkSync(plainFile);
    lockSession();
    return { success: true, needsRestart: true };
  } catch (e) { return { error: "Invalid backup file: " + e.message }; }
});

/* ═══════════════════════════════════════════════════════════════
   IPC: EXPORT / PRINT
   ═══════════════════════════════════════════════════════════════ */
ipcMain.handle("export-html", async (_e, title, html) => {
  const warn = await dialog.showMessageBox(mainWindow, {
    type: "warning", title: "Export Unencrypted",
    message: "The exported file will NOT be encrypted.",
    detail: "Anyone with access to the file can read its contents.",
    buttons: ["Export Anyway", "Cancel"], defaultId: 1, cancelId: 1,
  });
  if (warn.response !== 0) return false;
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: title.replace(/[^a-z0-9]/gi, "_") + ".html",
    filters: [{ name: "HTML", extensions: ["html"] }, { name: "All", extensions: ["*"] }],
  });
  if (result.canceled || !result.filePath) return false;
  const doc = `<!DOCTYPE html>\n<html><head><meta charset="UTF-8"><title>${safeTitle}</title>\n<style>body{font-family:'DM Sans','Segoe UI',sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.7;color:#1a1a1a}h1,h2,h3,h4{margin:.5em 0 .3em}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}pre{background:#f5f5f5;padding:12px;border-radius:8px;overflow-x:auto}code{background:#f5f5f5;padding:2px 6px;border-radius:4px}blockquote{border-left:3px solid #6359d0;padding-left:12px;opacity:.85}</style>\n</head><body>${html}</body></html>`;
  fs.writeFileSync(result.filePath, doc, "utf-8");
  return true;
});

ipcMain.handle("export-text", async (_e, title, text) => {
  const warn = await dialog.showMessageBox(mainWindow, {
    type: "warning", title: "Export Unencrypted",
    message: "The exported file will NOT be encrypted.",
    detail: "Anyone with access to the file can read its contents.",
    buttons: ["Export Anyway", "Cancel"], defaultId: 1, cancelId: 1,
  });
  if (warn.response !== 0) return false;
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: title.replace(/[^a-z0-9]/gi, "_") + ".txt",
    filters: [{ name: "Text", extensions: ["txt"] }, { name: "All", extensions: ["*"] }],
  });
  if (result.canceled || !result.filePath) return false;
  fs.writeFileSync(result.filePath, text, "utf-8");
  return true;
});

ipcMain.handle("print-with-warning", async (_e, isLocked) => {
  if (isLocked) {
    const warn = await dialog.showMessageBox(mainWindow, {
      type: "warning", title: "Print Unencrypted",
      message: "This page belongs to a password-protected notebook.",
      detail: "Printing will create an unencrypted copy. Continue?",
      buttons: ["Print Anyway", "Cancel"], defaultId: 1, cancelId: 1,
    });
    if (warn.response !== 0) return false;
  }
  mainWindow?.webContents.print();
  return true;
});

ipcMain.handle("open-data-folder", async () => { shell.openPath(userDataPath); });

/* ═══════════════════════════════════════════════════════════════
   WINDOW
   ═══════════════════════════════════════════════════════════════ */
function createWindow() {
  const ws = loadWindowState();
  mainWindow = new BrowserWindow({
    width: ws.width, height: ws.height, x: ws.x, y: ws.y,
    minWidth: 700, minHeight: 500, title: "NoteForge",
    backgroundColor: "#0e0e16", show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false,
      spellcheck: true, navigateOnDragDrop: false,
    },
  });

  // Navigation guards
  mainWindow.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file://")) e.preventDefault(); });
  mainWindow.webContents.on("will-redirect", (e, url) => { if (!url.startsWith("file://")) e.preventDefault(); });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  if (ws.maximized) mainWindow.maximize();
  mainWindow.loadFile("index.html");
  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.on("resize", saveWindowState);
  mainWindow.on("move", saveWindowState);
  mainWindow.on("close", saveWindowStateSync);
  mainWindow.on("closed", () => { mainWindow = null; lockSession(); });

  const send = (action) => () => mainWindow?.webContents.send("menu-action", action);
  const menuTemplate = [
    { label: "File", submenu: [
      { label: "New Page", accelerator: "CmdOrCtrl+N", click: send("new-page") },
      { label: "New Notebook", accelerator: "CmdOrCtrl+Shift+N", click: send("new-notebook") },
      { type: "separator" },
      { label: "Export as HTML…", accelerator: "CmdOrCtrl+Shift+E", click: send("export-html") },
      { label: "Export as Text…", click: send("export-text") },
      { label: "Print…", accelerator: "CmdOrCtrl+P", click: send("print") },
      { type: "separator" },
      { label: "Backup Encrypted Data…", click: send("export-backup") },
      { label: "Restore from Backup…", click: send("restore-backup") },
      { type: "separator" },
      { label: "Encryption Settings…", click: send("encryption-settings") },
      { label: "Lock App", accelerator: "CmdOrCtrl+L", click: send("lock-app") },
      { type: "separator" },
      { label: "Open Data Folder", click: send("open-data-folder") },
      { type: "separator" },
      { role: "quit" },
    ]},
    { label: "Edit", submenu: [
      { role: "undo" }, { role: "redo" }, { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "pasteAndMatchStyle" }, { role: "selectAll" },
      { type: "separator" },
      { label: "Find & Replace", accelerator: "CmdOrCtrl+F", click: send("find-replace") },
    ]},
    { label: "View", submenu: [
      { label: "Toggle Sidebar", accelerator: "CmdOrCtrl+\\", click: send("toggle-sidebar") },
      { label: "Toggle Theme", accelerator: "CmdOrCtrl+Shift+D", click: send("toggle-theme") },
      { type: "separator" },
      { label: "Zoom In", accelerator: "CmdOrCtrl+=", click: send("zoom-in") },
      { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: send("zoom-out") },
      { label: "Reset Zoom", accelerator: "CmdOrCtrl+0", click: send("zoom-reset") },
      { type: "separator" },
      { label: "Toggle Word Wrap", click: send("toggle-wrap") },
      { type: "separator" },
      { role: "togglefullscreen" },
    ]},
    { label: "Help", submenu: [
      { label: "About NoteForge", click: () => dialog.showMessageBox(mainWindow, {
        type: "info", title: "About NoteForge", message: "NoteForge v2.5.1",
        detail: "Encrypted offline note-taking.\nAES-256-GCM · scrypt (N=65536)\nDerived key session · Auto-lock\n\nData: " + userDataPath,
      })},
    ]},
  ];
  if (IS_DEV) menuTemplate[2].submenu.push({ type: "separator" }, { role: "toggleDevTools" });
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (!mainWindow) createWindow(); });

/* ═══════════════════════════════════════════════════════════════
   AUTO-UPDATER — checks GitHub Releases on startup
   Only network activity the app makes. Everything else stays offline.
   ═══════════════════════════════════════════════════════════════ */
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function setupAutoUpdater() {
  if (IS_DEV) return; // don't check for updates in dev mode

  // Check for updates 5 seconds after launch (non-blocking)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {}); // silently fail if offline
  }, 5000);

  autoUpdater.on("update-available", (info) => {
    if (!mainWindow) return;
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Update Available",
      message: `NoteForge ${info.version} is available.`,
      detail: "Would you like to download it? The update will be installed when you close the app.",
      buttons: ["Download", "Later"],
      defaultId: 0,
    }).then(result => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
        mainWindow?.webContents.send("menu-action", "update-downloading");
      }
    });
  });

  autoUpdater.on("update-downloaded", () => {
    if (!mainWindow) return;
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Update Ready",
      message: "Update downloaded. It will be installed when you quit NoteForge.",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
    }).then(result => {
      if (result.response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on("error", () => {}); // silently ignore update errors (offline, etc.)
}

ipcMain.handle("check-for-updates", async () => {
  if (IS_DEV) return { update: false };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { update: !!result?.updateInfo, version: result?.updateInfo?.version };
  } catch { return { update: false }; }
});
