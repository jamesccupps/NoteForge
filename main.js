const { app, BrowserWindow, Menu, shell, dialog, ipcMain, session } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Guarded so a missing/corrupt electron-updater doesn't prevent app launch.
// If load fails, auto-update is simply disabled for this session.
let autoUpdater = null;
let autoUpdaterLoadError = null;
try { autoUpdater = require("electron-updater").autoUpdater; }
catch (e) { autoUpdaterLoadError = e.message; console.error("[NoteForge] electron-updater unavailable:", e.message); }

let mainWindow;
// The portable build keeps everything in "NoteForge Data" beside its exe, so notes, the
// hint and the browser profile leave with the USB stick instead of staying in this PC's
// %APPDATA%, and it no longer shares one vault with an installed copy.
const IS_PORTABLE = !!process.env.PORTABLE_EXECUTABLE_DIR;
const pcUserDataPath = app.getPath("userData"); // where an installed NoteForge keeps its data
if (IS_PORTABLE) app.setPath("userData", path.join(process.env.PORTABLE_EXECUTABLE_DIR, "NoteForge Data"));
const userDataPath = app.getPath("userData");
const plainFile = path.join(userDataPath, "noteforge-data.json");
const encFile = path.join(userDataPath, "noteforge-data.enc");
const stateFile = path.join(userDataPath, "window-state.json");
const hintFile = path.join(userDataPath, "noteforge-hint.txt");
const rlFile = path.join(userDataPath, "ratelimit.json");
const IS_DEV = !app.isPackaged;

// One instance per data folder (the lock lives in userData). Two windows each rewrote
// the whole vault from their own memory: the last save won, and a password change in
// one was undone by the other's next save. A second launch focuses the first window.
const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) app.quit();

/* ═══════════════════════════════════════════════════════════════
   CRYPTO — AES-256-GCM + scrypt
   ═══════════════════════════════════════════════════════════════ */
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const SALT_LEN = 32;
const IV_LEN = 16;
// What new keys are derived with. A key only opens blobs whose header names the
// parameters it was made with, so every cached key carries its own (KeyEntry) and
// saves write those.
const KDF = { N: 65536, r: 8, p: 1 };
// scrypt needs about 128·N·r bytes. Headers are capped at half of this (below), so
// every accepted one fits; at 128 MiB, maxmem used to refuse N=2^17 outright.
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

// KeyEntry: { key: Buffer, salt: Buffer, N, r, p }
function deriveKey(password, salt, kdf = KDF) {
  const key = crypto.scryptSync(password, salt, KEY_LEN, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: SCRYPT_MAXMEM });
  return { key, salt, N: kdf.N, r: kdf.r, p: kdf.p };
}
const isCurrentKdf = (k) => k.N === KDF.N && k.r === KDF.r && k.p === KDF.p;
function zeroKey(k) { if (k) k.key.fill(0); }

// Encrypt under an already-derived key (no scrypt on the save path). The header
// names that key's own salt and parameters: writing the defaults over a key made
// with others left a blob no password could open.
function sealWithKey(plaintext, k) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, k.key, iv);
  let enc = cipher.update(plaintext, "utf-8", "base64");
  enc += cipher.final("base64");
  return JSON.stringify({
    v: 2, kdf: "scrypt", N: k.N, r: k.r, p: k.p,
    salt: k.salt.toString("hex"), iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"), data: enc,
  });
}

// Encrypt under a fresh salt and the current parameters. Returns the blob and its
// key, so callers cache that key rather than running scrypt a second time.
function encryptData(plaintext, password) {
  const k = deriveKey(password, crypto.randomBytes(SALT_LEN));
  return { blob: sealWithKey(plaintext, k), k };
}

// Full decrypt (for initial unlock, password verification)
// SECURITY: Enforces minimum KDF parameters to prevent downgrade attacks where
// an attacker swaps in a weakened header with low N/r/p values.
const MIN_SCRYPT_N = 16384;  // legacy v1 floor; never accept weaker
const MIN_SCRYPT_R = 8;
const MIN_SCRYPT_P = 1;
const MAX_SCRYPT_N = 1 << 17; // DoS caps: with r=8, 128 MiB
const MAX_SCRYPT_MEM = SCRYPT_MAXMEM / 2; // 128·N·r
// Cost is linear in p, and maxmem alone still admits p up to ~65k at N=65536
// (~2 h of scryptSync blocking the main process). Caps leave headroom far above
// what NoteForge writes (r=8, p=1).
const MAX_SCRYPT_R = 32;
const MAX_SCRYPT_P = 16;
// -> { plaintext, k: KeyEntry, isV1 }
function decryptData(encJson, password) {
  const obj = JSON.parse(encJson);
  const N = obj.N || 16384, r = obj.r || 8, p = obj.p || 1;
  // Reject weakened or malformed KDF parameters
  if (![N, r, p].every(Number.isInteger)) throw new Error("Invalid KDF parameters");
  if (N < MIN_SCRYPT_N || N > MAX_SCRYPT_N) throw new Error("Invalid KDF parameters (N)");
  if (r < MIN_SCRYPT_R || r > MAX_SCRYPT_R) throw new Error("Invalid KDF parameters (r)");
  if (p < MIN_SCRYPT_P || p > MAX_SCRYPT_P) throw new Error("Invalid KDF parameters (p)");
  if ((N & (N - 1)) !== 0) throw new Error("Invalid KDF parameters (N must be power of 2)");
  if (128 * N * r > MAX_SCRYPT_MEM) throw new Error("Invalid KDF parameters (memory)");
  // Validate field shapes before feeding to crypto APIs
  if (typeof obj.salt !== "string" || typeof obj.iv !== "string" ||
      typeof obj.tag !== "string" || typeof obj.data !== "string") {
    throw new Error("Malformed encrypted blob");
  }
  const k = deriveKey(password, Buffer.from(obj.salt, "hex"), { N, r, p });
  try {
    const decipher = crypto.createDecipheriv(ALGO, k.key, Buffer.from(obj.iv, "hex"));
    decipher.setAuthTag(Buffer.from(obj.tag, "hex"));
    let dec = decipher.update(obj.data, "base64", "utf-8");
    dec += decipher.final("utf-8");
    return { plaintext: dec, k, isV1: !obj.v || obj.v < 2 };
  } catch (e) { zeroKey(k); throw e; }
}

// After a decrypt: keep its key when it was made with the current parameters,
// otherwise derive one that is (fresh salt), so the next save upgrades the blob.
function currentKeyFor(password, k) {
  if (isCurrentKdf(k)) return k;
  zeroKey(k);
  return deriveKey(password, crypto.randomBytes(SALT_LEN));
}

/* ── Session keys (derived keys stored instead of passwords) ── */
let masterKey = null;            // master KeyEntry while unlocked; zeroed on lock
const nbSessionKeys = new Map(); // nbKeyId -> notebook KeyEntry

function encryptWithSession(plaintext) {
  if (!masterKey) throw new Error("No session key");
  return sealWithKey(plaintext, masterKey);
}

function decryptWithSession(encJson) {
  if (!masterKey) throw new Error("No session key");
  const obj = JSON.parse(encJson);
  const decipher = crypto.createDecipheriv(ALGO, masterKey.key, Buffer.from(obj.iv, "hex"));
  decipher.setAuthTag(Buffer.from(obj.tag, "hex"));
  let dec = decipher.update(obj.data, "base64", "utf-8");
  dec += decipher.final("utf-8");
  return dec;
}

function clearMasterKey() {
  zeroKey(masterKey);
  masterKey = null;
  snapshotDue = false;
}

function lockSession() {
  clearMasterKey();
  // Zero all per-notebook session keys
  for (const entry of nbSessionKeys.values()) zeroKey(entry);
  nbSessionKeys.clear();
}

/* ── Atomic data-file writes ─────────────────────────────────
   Every save rewrites the whole data file. Writing in place meant a crash or
   power loss mid-write left a truncated file, and for the encrypted file that
   makes every note unrecoverable (GCM rejects the whole blob). Write a temp
   file, fsync it, then rename over the original. */
// Windows refuses the rename while another process (antivirus, a sync client) has
// the target open without delete sharing, which usually passes within a moment.
// There is no fallback to writing in place: a crash mid-write would truncate the
// only copy. If the rename keeps failing the old file stays, the save reports
// failure and the renderer tries again.
const RENAME_RETRY_MS = [15, 50, 150, 400];
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function writeFileAtomic(file, data) {
  const tmp = file + ".tmp";
  try {
    const fd = fs.openSync(tmp, "w");
    try { fs.writeFileSync(fd, data, "utf-8"); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    for (let i = 0; ; i++) {
      try { fs.renameSync(tmp, file); return; }
      catch (e) {
        if (i >= RENAME_RETRY_MS.length || !["EPERM", "EACCES", "EBUSY"].includes(e.code)) throw e;
        sleepSync(RENAME_RETRY_MS[i]);
      }
    }
  } catch (e) {
    // (in unencrypted mode the temp file is a plaintext copy)
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

/* ── Earlier versions of the encrypted vault ────────────────
   A copy of the file as it was at unlock, made before that session's first save:
   the last PREV_KEEP sessions' starting points survive a bad save or a damaged
   file. Named .enc so File → Restore from Backup opens them. They open with the
   password in use when they were made, so a password change deletes them. */
const PREV_KEEP = 3;
const prevFile = (n) => path.join(userDataPath, `noteforge-data.prev-${n}.enc`);
let snapshotDue = false; // set on unlock
function snapshotVault() {
  snapshotDue = false;
  if (!fs.existsSync(encFile)) return;
  try {
    for (let n = PREV_KEEP; n > 1; n--) if (fs.existsSync(prevFile(n - 1))) fs.renameSync(prevFile(n - 1), prevFile(n));
    fs.copyFileSync(encFile, prevFile(1));
  } catch (e) { console.warn("[NoteForge] could not keep the previous version:", e.message); }
}
function deleteSnapshots() {
  for (let n = 1; n <= PREV_KEEP + 1; n++) { try { fs.unlinkSync(prevFile(n)); } catch {} }
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

// Main-process second layer behind the renderer's sanitizeForDiskSync(), applied to
// every save. Parses rather than substring-matching so an escaped key like
// "locked" can't slip past. Throws on non-JSON, so junk never replaces the vault.
function stripLockedSections(value) {
  const data = JSON.parse(value);
  const leaking = Array.isArray(data?.notebooks) && data.notebooks.some(nb => nb?.locked && nb.sections?.length);
  if (!leaking) return value;
  console.warn("[NoteForge] save contained plaintext sections for a locked notebook; stripped");
  return sanitizeDataJson(value);
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
   BRUTE-FORCE RATE LIMITING
   - Master password: single counter
   - Notebook passwords: per-notebook counter keyed by hash of encrypted blob
     (so we don't have to trust renderer-supplied nbId, and the key rotates
     when the user changes the notebook password)
   ═══════════════════════════════════════════════════════════════ */
let masterFails = 0, masterLockout = 0;
const nbRateMap = new Map(); // nbKey (hex string) -> { fails, lockout }
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;

function nbKeyFromBlob(blob) {
  // Derive stable per-notebook-password identifier from the encrypted blob's
  // salt+iv. Rotates automatically when the user changes the notebook password.
  try {
    const obj = JSON.parse(blob);
    return crypto.createHash("sha256").update((obj.salt||"")+(obj.iv||"")).digest("hex").slice(0,32);
  } catch { return "invalid"; }
}

try {
  if (fs.existsSync(rlFile)) {
    const rl = JSON.parse(fs.readFileSync(rlFile, "utf-8"));
    masterFails = rl.masterFails || rl.failCount || 0;
    masterLockout = rl.masterLockout || rl.lockoutUntil || 0;
    if (rl.nbMap && typeof rl.nbMap === "object") {
      for (const [k, v] of Object.entries(rl.nbMap)) {
        if (v && typeof v.fails === "number" && typeof v.lockout === "number") {
          nbRateMap.set(k, { fails: v.fails, lockout: v.lockout });
        }
      }
    }
    // Legacy migration: if old global nbFails/nbLockout existed, discard —
    // the per-notebook scheme starts fresh. Old counters were a leak vector.
  }
} catch {}

function saveRateLimit() {
  try {
    const nbMap = {};
    for (const [k, v] of nbRateMap.entries()) nbMap[k] = v;
    fs.writeFileSync(rlFile, JSON.stringify({ masterFails, masterLockout, nbMap }), "utf-8");
  } catch {}
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

function checkNbRateLimit(nbKey) {
  const entry = nbRateMap.get(nbKey);
  if (!entry) return null;
  const now = Date.now();
  if (now < entry.lockout) return `Too many failed attempts. Try again in ${Math.ceil((entry.lockout - now) / 1000)}s`;
  return null;
}
function recordNbFailure(nbKey) {
  const entry = nbRateMap.get(nbKey) || { fails: 0, lockout: 0 };
  entry.fails++;
  if (entry.fails >= MAX_ATTEMPTS) entry.lockout = Date.now() + BASE_DELAY_MS * Math.pow(2, entry.fails - MAX_ATTEMPTS);
  nbRateMap.set(nbKey, entry);
  saveRateLimit();
}
function recordNbSuccess(nbKey) {
  nbRateMap.delete(nbKey);
  saveRateLimit();
}

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


/* ═══════════════════════════════════════════════════════════════
   IPC: STORAGE (uses session key when available)
   ═══════════════════════════════════════════════════════════════ */
ipcMain.handle("storage-get", async () => {
  try {
    if (fs.existsSync(encFile)) {
      if (!masterKey) return { needsPassword: true };
      return { value: decryptWithSession(fs.readFileSync(encFile, "utf-8")) };
    }
    if (fs.existsSync(plainFile)) return { value: fs.readFileSync(plainFile, "utf-8") };
  } catch (e) { return { error: e.message }; }
  return null;
});

// With encryption on and the session locked there is no key to write with. Falling
// through to the plaintext branch here used to leave a decrypted copy next to the
// .enc file whenever a save landed after lock or restore.
// A protected notebook that is open in the renderer arrives with its pages in
// `sections`, and its encSections blob is only as new as the unlock. Encrypting those
// pages here, with the notebook's cached key (nbKeyIds: notebook id -> key handle),
// means every save path stores the newest pages: autosave, Lock, Re-lock and the close
// flush. The renderer used to do it in autosave only, so the other paths wrote the
// unlock-time blob back and every edit since the unlock was lost.
// Returns the new blobs, so the renderer's copy stays current, and the ids it had no
// key for: stripLockedSections drops their pages, so that save is reported as failed.
function sealOpenNotebooks(value, nbKeyIds) {
  const data = JSON.parse(value);
  const blobs = {}, unsealed = [];
  if (!Array.isArray(data?.notebooks)) return { value, blobs, unsealed };
  const keys = nbKeyIds && typeof nbKeyIds === "object" ? nbKeyIds : {};
  let changed = false;
  for (const nb of data.notebooks) {
    if (!nb?.locked || !Array.isArray(nb.sections) || !nb.sections.length) continue;
    const keyId = Object.prototype.hasOwnProperty.call(keys, nb.id) ? keys[nb.id] : null;
    const entry = typeof keyId === "string" ? nbSessionKeys.get(keyId) : null;
    if (!entry) { unsealed.push(nb.id); continue; }
    nb.encSections = sealWithKey(JSON.stringify(nb.sections), entry);
    nb.sections = [];
    blobs[nb.id] = nb.encSections;
    changed = true;
  }
  return { value: changed ? JSON.stringify(data) : value, blobs, unsealed };
}

// Returns { ok, blobs, unsealed } (see sealOpenNotebooks)
function writeAppData(value, nbKeyIds) {
  if (typeof value !== "string") return { ok: false };
  if (!masterKey && fs.existsSync(encFile)) return { ok: false };
  const sealed = sealOpenNotebooks(value, nbKeyIds);
  value = stripLockedSections(sealed.value);
  if (masterKey) {
    if (snapshotDue) snapshotVault();
    writeFileAtomic(encFile, encryptWithSession(value));
    if (fs.existsSync(plainFile)) fs.unlinkSync(plainFile);
  } else {
    writeFileAtomic(plainFile, value);
  }
  return { ok: true, blobs: sealed.blobs, unsealed: sealed.unsealed };
}

ipcMain.handle("storage-set", async (_e, value, nbKeyIds) => {
  try { return writeAppData(value, nbKeyIds); } catch (e) { return { ok: false }; }
});

ipcMain.on("storage-set-sync", (event, value, nbKeyIds) => {
  try { event.returnValue = writeAppData(value, nbKeyIds); } catch (e) { event.returnValue = { ok: false }; }
});

/* ═══════════════════════════════════════════════════════════════
   IPC: MASTER PASSWORD (derived key cached, password discarded)
   ═══════════════════════════════════════════════════════════════ */
// Only a failed GCM check means a wrong password (a damaged ciphertext fails it too
// and can't be told apart). Everything else is reported as what it is and doesn't
// count toward the lockout: a damaged file used to read "Wrong password", and each
// try lengthened the lockout of someone who had the right one.
const isWrongPassword = (e) => /unable to authenticate data/i.test(e?.message || "");
const fsErrorText = (e) => e?.code ? `${e.code}: ${e.syscall || "file"} failed` : (e?.message || "unknown error");
const damagedVaultText = () => "The data file is damaged and can't be decrypted. Earlier versions are kept in " +
  userDataPath + " (noteforge-data.prev-1.enc is the newest): choose Restore from Backup and pick one.";
// -> { result } | { error, damaged?, wrong? }
function openVault(password) {
  let raw;
  try {
    if (!fs.existsSync(encFile)) return { error: "No encrypted data found" };
    raw = fs.readFileSync(encFile, "utf-8");
  } catch (e) { return { error: "Couldn't read the data file (" + fsErrorText(e) + ")" }; }
  try { return { result: decryptData(raw, password) }; }
  catch (e) { return isWrongPassword(e) ? { wrong: true } : { error: damagedVaultText(), damaged: true }; }
}

ipcMain.handle("unlock-master", async (_e, password) => {
  const rlErr = checkMasterRateLimit();
  if (rlErr) return { error: rlErr };
  const o = openVault(password);
  if (o.wrong) { recordMasterFailure(); return { error: "Wrong password" }; }
  if (!o.result) return { error: o.error, damaged: o.damaged };
  const result = o.result;
  recordMasterSuccess();
  zeroKey(masterKey);
  masterKey = result.k;
  snapshotDue = true;
  // A v1 file, or one made with other parameters: re-encrypt it with the current ones
  // while the password is at hand. Now, not at the next save, because storage-get reads
  // the file back with the cached key. If that write fails, keep the key it was opened
  // with: saves write that key's own parameters, so the file stays readable.
  if (result.isV1 || !isCurrentKdf(result.k)) {
    try {
      snapshotVault(); // the file as it was, before the upgrade rewrites it
      const e = encryptData(result.plaintext, password);
      writeFileAtomic(encFile, e.blob);
      zeroKey(result.k);
      masterKey = e.k;
    } catch (e) { console.warn("[NoteForge] couldn't upgrade the data file:", e.message); }
  }
  return { success: true, value: result.plaintext };
});

const MAX_HINT_LEN = 200;
ipcMain.handle("enable-encryption", async (_e, password, hint) => {
  // For unencrypted data only. Over an existing vault this encrypted "{}" while
  // locked (wiping the notes) and re-keyed it without the current password while
  // unlocked; Change Password is the way to re-key.
  if (fs.existsSync(encFile)) return { error: "Encryption is already on" };
  if (hint != null && (typeof hint !== "string" || hint.length > MAX_HINT_LEN)) return { error: `Hint is limited to ${MAX_HINT_LEN} characters` };
  const strengthErr = checkPasswordStrength(password);
  if (strengthErr) return { error: strengthErr };
  try {
    let data = "{}";
    if (fs.existsSync(plainFile)) data = fs.readFileSync(plainFile, "utf-8");
    // Sanitize before encrypting
    data = sanitizeDataJson(data);
    const e = encryptData(data, password);
    writeFileAtomic(encFile, e.blob);
    // The plaintext file, and copies of it a failed save (before 2.9) or a restore left
    for (const f of [plainFile, plainFile + ".tmp", plainFile + ".pre-restore.bak"]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (err) { console.warn("[NoteForge] couldn't remove", f, err.message); }
    }
    zeroKey(masterKey);
    masterKey = e.k;
    // Save hint
    if (hint && hint.trim()) fs.writeFileSync(hintFile, hint.trim(), "utf-8");
    return { success: true };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle("disable-encryption", async (_e, password) => {
  const rlErr = checkMasterRateLimit();
  if (rlErr) return { error: rlErr };
  if (!fs.existsSync(encFile)) return { error: "Not encrypted" };
  const o = openVault(password);
  if (o.wrong) { recordMasterFailure(); return { error: "Wrong password" }; }
  if (!o.result) return { error: o.error };
  recordMasterSuccess();
  zeroKey(o.result.k);
  try {
    // Sanitize before writing plaintext
    writeFileAtomic(plainFile, sanitizeDataJson(o.result.plaintext));
    // If the vault can't be removed, take the plaintext copy back out: with both
    // files present the app stays encrypted and the copy would just sit there
    try { fs.unlinkSync(encFile); }
    catch (e) { try { fs.unlinkSync(plainFile); } catch {} throw e; }
  } catch (e) { return { error: "Couldn't turn encryption off (" + fsErrorText(e) + "). Nothing was changed." }; }
  try { if (fs.existsSync(hintFile)) fs.unlinkSync(hintFile); } catch {}
  deleteSnapshots();
  // Only the master key: protected notebooks open in the renderer stay open, and
  // their next saves need their keys (dropping them lost their edits)
  clearMasterKey();
  return { success: true };
});

ipcMain.handle("change-master-password", async (_e, oldPassword, newPassword) => {
  const rlErr = checkMasterRateLimit();
  if (rlErr) return { error: rlErr };
  const strengthErr = checkPasswordStrength(newPassword);
  if (strengthErr) return { error: strengthErr };
  if (!fs.existsSync(encFile)) return { error: "Not encrypted" };
  const o = openVault(oldPassword);
  if (o.wrong) { recordMasterFailure(); return { error: "Wrong current password" }; }
  if (!o.result) return { error: o.error };
  recordMasterSuccess();
  zeroKey(o.result.k);
  try {
    // Re-encrypt with the new password. The session key is replaced only once the new
    // file is written: a second scrypt used to run after the old key was zeroed, and
    // if it failed, saves encrypted under an all-zero key.
    const e = encryptData(sanitizeDataJson(o.result.plaintext), newPassword);
    writeFileAtomic(encFile, e.blob);
    deleteSnapshots();
    zeroKey(masterKey);
    masterKey = e.k;
    return { success: true };
  } catch (e) { return { error: "Couldn't save the new password (" + fsErrorText(e) + "). The old one still works." }; }
});

ipcMain.handle("check-password-strength", async (_e, pw) => ({ error: checkPasswordStrength(pw) }));

// Change Password step 1: reject a wrong current password before the user types a new
// one twice. Same rate limit and failure counting as unlock.
ipcMain.handle("verify-master-password", async (_e, password) => {
  const rlErr = checkMasterRateLimit();
  if (rlErr) return { error: rlErr };
  if (!fs.existsSync(encFile)) return { error: "Not encrypted" };
  const o = openVault(password);
  if (o.wrong) { recordMasterFailure(); return { error: "Wrong current password" }; }
  if (!o.result) return { error: o.error };
  zeroKey(o.result.k);
  recordMasterSuccess();
  return { success: true };
});
ipcMain.handle("lock-app", async () => { lockSession(); return { success: true }; });

/* ═══════════════════════════════════════════════════════════════
   IPC: NOTEBOOK ENCRYPTION (password-based, not session key)
   ═══════════════════════════════════════════════════════════════ */
ipcMain.handle("encrypt-notebook-sections", async (_e, json, password) => {
  const strengthErr = checkPasswordStrength(password);
  if (strengthErr) return { error: strengthErr };
  try {
    const e = encryptData(json, password);
    // Cache the key under a random handle; saves seal the notebook with it (writeAppData)
    const nbKeyId = crypto.randomBytes(16).toString("hex");
    nbSessionKeys.set(nbKeyId, e.k);
    return { success: true, blob: e.blob, nbKeyId };
  }
  catch (e) { return { error: e.message }; }
});

ipcMain.handle("decrypt-notebook-sections", async (_e, blob, password) => {
  const nbKey = nbKeyFromBlob(blob);
  const rlErr = checkNbRateLimit(nbKey);
  if (rlErr) return { error: rlErr };
  try {
    const result = decryptData(blob, password);
    recordNbSuccess(nbKey);
    // Cache the derived key under a random handle so renderer holds only a handle, not the password
    const nbKeyId = crypto.randomBytes(16).toString("hex");
    nbSessionKeys.set(nbKeyId, currentKeyFor(password, result.k));
    return { success: true, sections: result.plaintext, nbKeyId };
  } catch (e) {
    if (!isWrongPassword(e)) return { error: "This notebook's data is damaged and can't be decrypted" };
    recordNbFailure(nbKey);
    return { error: "Wrong password" };
  }
});

ipcMain.handle("forget-notebook-key", async (_e, nbKeyId) => {
  const entry = nbSessionKeys.get(nbKeyId);
  if (entry) { zeroKey(entry); nbSessionKeys.delete(nbKeyId); }
  return { success: true };
});

/* ═══════════════════════════════════════════════════════════════
   IPC: BACKUP
   ═══════════════════════════════════════════════════════════════ */
ipcMain.handle("export-backup", async () => {
  if (!fs.existsSync(encFile)) return { error: "No encrypted data to backup. Enable encryption first." };
  const hasHint = fs.existsSync(hintFile);
  let includeHint = false;
  if (hasHint) {
    const hintChoice = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "Include Password Hint?",
      message: "Your password hint is stored alongside your data.",
      detail: "The hint is NOT encrypted. Including it in the backup means anyone who obtains the backup file can read the hint. Only include it if you're storing the backup somewhere trusted.",
      buttons: ["Include Hint", "Exclude Hint", "Cancel"],
      defaultId: 1, cancelId: 2,
    });
    if (hintChoice.response === 2) return { canceled: true };
    includeHint = hintChoice.response === 0;
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `NoteForge-Backup-${new Date().toISOString().slice(0,10)}.enc`,
    filters: [{ name: "NoteForge Encrypted Backup", extensions: ["enc"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  try {
    fs.copyFileSync(encFile, result.filePath);
    if (includeHint && hasHint) {
      fs.writeFileSync(result.filePath + ".hint", fs.readFileSync(hintFile, "utf-8"), "utf-8");
    }
    return { success: true, path: result.filePath };
  } catch (e) { return { error: e.message }; }
});

// The file the user picked in restore-backup. verify-and-restore-backup only accepts
// this path, so a compromised renderer can't point main at some other blob on disk
// (e.g. a v1 file, which decryptData still accepts) and install it as the vault.
let pendingRestorePath = null;

function backupHeaderError(obj) {
  if (!obj || !obj.data || !obj.salt || !obj.iv || !obj.tag) return "Invalid backup file";
  if (obj.v !== 2 || obj.kdf !== "scrypt") return "Unsupported backup format";
  if (typeof obj.N !== "number" || obj.N < MIN_SCRYPT_N) return "Backup uses weakened encryption";
  return null;
}

ipcMain.handle("restore-backup", async () => {
  pendingRestorePath = null;
  const warn = await dialog.showMessageBox(mainWindow, {
    type: "warning", title: "Restore Backup",
    message: "This will replace ALL current data.",
    detail: "Your current notes will be overwritten with the backup. You'll need to enter the backup's password to verify it can be decrypted. Continue?",
    buttons: ["Choose Backup…", "Cancel"], defaultId: 1, cancelId: 1,
  });
  if (warn.response !== 0) return { canceled: true };
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: "NoteForge Encrypted Backup", extensions: ["enc"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  try {
    const src = result.filePaths[0];
    // Validate it's actually encrypted data — reject anything that isn't a v2 scrypt blob
    const raw = fs.readFileSync(src, "utf-8");
    const headerErr = backupHeaderError(JSON.parse(raw));
    if (headerErr) return { error: headerErr };
    pendingRestorePath = src;
    // Renderer prompts for the backup password, then calls verify-and-restore-backup
    return { readyForPassword: true, backupPath: src, hasHint: fs.existsSync(src + ".hint") };
  } catch (e) { return { error: "Invalid backup file: " + e.message }; }
});

// Two-step restore — password verified BEFORE we touch current data.
// If verification fails, current encFile is untouched.
ipcMain.handle("verify-and-restore-backup", async (_e, backupPath, password) => {
  if (!pendingRestorePath || backupPath !== pendingRestorePath) return { error: "Choose the backup file again (File → Restore from Backup…)" };
  if (!fs.existsSync(backupPath)) return { error: "Backup file no longer exists" };
  let raw;
  try {
    raw = fs.readFileSync(backupPath, "utf-8");
    // Re-check: the file may have changed since the user picked it
    const headerErr = backupHeaderError(JSON.parse(raw));
    if (headerErr) return { error: headerErr };
    // Test-decrypt — if this throws, the password is wrong and we do NOTHING destructive
    zeroKey(decryptData(raw, password).k); // a test decrypt; the next unlock derives its own
  } catch (e) {
    return { error: isWrongPassword(e) ? "Wrong password for this backup" : "The backup file is damaged or isn't a NoteForge backup" };
  }
  // Password verified. Copy whatever is there now (encrypted or not) to a rollback
  // file before touching it; if that copy fails, stop. The old code only kept an
  // encrypted rollback and unlinked an unencrypted noteforge-data.json outright.
  let rollbackPath = null;
  try {
    for (const f of [encFile, plainFile]) {
      if (fs.existsSync(f)) { fs.copyFileSync(f, f + ".pre-restore.bak"); rollbackPath = f + ".pre-restore.bak"; }
    }
  } catch (e) {
    return { error: "Restore cancelled: could not save a rollback copy of your current notes (" + e.message + ")" };
  }
  try {
    writeFileAtomic(encFile, raw); // the bytes that just decrypted, not a re-read of the path
    if (fs.existsSync(backupPath + ".hint")) {
      fs.writeFileSync(hintFile, fs.readFileSync(backupPath + ".hint", "utf-8"), "utf-8");
    }
    if (fs.existsSync(plainFile)) fs.unlinkSync(plainFile);
  } catch (e) {
    return { error: "Restore failed partway (" + e.message + "). Your previous notes are in " + rollbackPath };
  }
  lockSession();
  pendingRestorePath = null;
  return { success: true, needsRestart: true, rollbackPath };
});

/* ═══════════════════════════════════════════════════════════════
   IPC: EXPORT / PRINT
   ═══════════════════════════════════════════════════════════════ */
ipcMain.handle("export-html", async (_e, title, html, isLocked) => {
  const warn = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: isLocked ? "Export Password-Protected Page" : "Export Unencrypted",
    message: isLocked
      ? "This page belongs to a PASSWORD-PROTECTED notebook."
      : "The exported file will NOT be encrypted.",
    detail: isLocked
      ? "Exporting will create a plaintext HTML file that bypasses your notebook password. Anyone with access to the file can read its contents. Continue?"
      : "Anyone with access to the file can read its contents.",
    buttons: ["Export Anyway", "Cancel"], defaultId: 1, cancelId: 1,
  });
  if (warn.response !== 0) return false;
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: title.replace(/[^a-z0-9]/gi, "_") + ".html",
    filters: [{ name: "HTML", extensions: ["html"] }, { name: "All", extensions: ["*"] }],
  });
  if (result.canceled || !result.filePath) return false;
  const doc = `<!DOCTYPE html>\n<html><head><meta charset="UTF-8"><title>${safeTitle}</title>\n<style>body{font-family:'DM Sans','Segoe UI',sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.7;color:#1a1a1a}h1,h2,h3,h4{margin:.5em 0 .3em}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}pre{background:#f5f5f5;padding:12px;border-radius:8px;overflow-x:auto}code{background:#f5f5f5;padding:2px 6px;border-radius:4px}blockquote{border-left:3px solid #6359d0;padding-left:12px;opacity:.85}font[size="1"]{font-size:.714em}font[size="2"]{font-size:.857em}font[size="3"]{font-size:1em}font[size="4"]{font-size:1.143em}font[size="5"]{font-size:1.286em}font[size="6"]{font-size:1.714em}font[size="7"]{font-size:2.286em}</style>\n</head><body>${html}</body></html>`;
  fs.writeFileSync(result.filePath, doc, "utf-8");
  return true;
});

ipcMain.handle("export-text", async (_e, title, text, isLocked) => {
  const warn = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: isLocked ? "Export Password-Protected Page" : "Export Unencrypted",
    message: isLocked
      ? "This page belongs to a PASSWORD-PROTECTED notebook."
      : "The exported file will NOT be encrypted.",
    detail: isLocked
      ? "Exporting will create a plaintext file that bypasses your notebook password. Continue?"
      : "Anyone with access to the file can read its contents.",
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
// Editor context-menu Paste. A native paste is delivered to the page as a paste event,
// so it takes the same sanitizing path as Ctrl+V (including images).
ipcMain.handle("paste", async (e) => { e.sender.paste(); });

/* ═══════════════════════════════════════════════════════════════
   WINDOW
   ═══════════════════════════════════════════════════════════════ */
function createWindow() {
  const ws = loadWindowState();
  // Prefer .ico on Windows, .png elsewhere. Works in dev (unpacked) and after electron-builder packages
  // because the assets/ folder is in the `files` allowlist in package.json.
  const iconPath = process.platform === "win32"
    ? path.join(__dirname, "assets", "icon.ico")
    : path.join(__dirname, "assets", "icon.png");
  // Sandbox: on by default for defense-in-depth against a compromised renderer.
  // Preload only uses ipcRenderer (no fs, no native modules) so it's sandbox-safe.
  // If a specific Electron/OS combo breaks it, set `sandbox: false` in noteforge-config.json
  // and restart. No rebuild required.
  const cfg = loadConfig();
  const useSandbox = cfg.sandbox !== false; // default true
  mainWindow = new BrowserWindow({
    width: ws.width, height: ws.height, x: ws.x, y: ws.y,
    minWidth: 700, minHeight: 500, title: "NoteForge",
    backgroundColor: "#0e0e16", show: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false,
      sandbox: useSandbox,
      spellcheck: true, navigateOnDragDrop: false,
    },
  });

  // Navigation guards. The app is one page loaded once by loadFile and never navigates.
  // The old file:// allowance let the window load any local HTML file, which then got
  // the preload bridge (window.electronAPI) and none of index.html's CSP.
  mainWindow.webContents.on("will-navigate", (e) => e.preventDefault());
  mainWindow.webContents.on("will-redirect", (e) => e.preventDefault());
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
      { label: "Settings…", click: send("encryption-settings") },
      { label: "Lock App", accelerator: "CmdOrCtrl+L", click: send("lock-app") },
      { type: "separator" },
      { label: "Empty Trash…", click: send("empty-trash") },
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
      { label: "Keyboard Shortcuts", accelerator: "F1", click: send("show-shortcuts") },
      { type: "separator" },
      { label: "About NoteForge", click: () => dialog.showMessageBox(mainWindow, {
        type: "info", title: "About NoteForge", message: "NoteForge v" + app.getVersion(),
        detail: "Encrypted offline note-taking.\nAES-256-GCM · scrypt (N=65536)\nDerived key session · Auto-lock · Sandboxed renderer\n\nData: " + userDataPath,
      })},
    ]},
  ];
  if (IS_DEV) menuTemplate[2].submenu.push({ type: "separator" }, { role: "toggleDevTools" });
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

// Portable builds before 2.9 kept their notes in this PC's profile folder. On the first
// run with none beside the exe but some there, offer once to copy them. A copy, not a
// move: an installed NoteForge on this PC uses that folder too.
async function offerPortableCopy() {
  if (!IS_PORTABLE || pcUserDataPath === userDataPath) return;
  const hasNotes = (dir) => ["noteforge-data.enc", "noteforge-data.json"].some((f) => fs.existsSync(path.join(dir, f)));
  if (loadConfig().portableCopyOffered || hasNotes(userDataPath) || !hasNotes(pcUserDataPath)) return;
  const r = await dialog.showMessageBox({
    type: "question", title: "NoteForge Portable",
    message: "Copy the notes from this PC?",
    detail: "The portable version now keeps its notes in the \"NoteForge Data\" folder next to it. " +
      "NoteForge notes were found on this PC, in " + pcUserDataPath + ". Copy them there?\n\n" +
      "They also stay on this PC; delete them from that folder if you don't want them left behind.",
    buttons: ["Copy Them Here", "Start Empty"], defaultId: 0, cancelId: 1,
  });
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    if (r.response === 0) {
      for (const f of ["noteforge-data.enc", "noteforge-data.json", "noteforge-hint.txt"]) {
        const src = path.join(pcUserDataPath, f);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(userDataPath, f));
      }
    }
    saveConfig({ ...loadConfig(), portableCopyOffered: true });
  } catch (e) {
    dialog.showErrorBox("NoteForge Portable", "Couldn't copy the notes: " + e.message);
  }
}

app.whenReady().then(async () => {
  if (!isFirstInstance) return;
  await offerPortableCopy();
  // Windows: set AppUserModelID so the taskbar groups the window under NoteForge
  // with the correct icon instead of under generic "Electron"
  if (process.platform === "win32") app.setAppUserModelId("com.jamescupps.noteforge");
  createWindow();
  setupAutoUpdater();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (!mainWindow) createWindow(); });

/* ═══════════════════════════════════════════════════════════════
   AUTO-UPDATER — checks GitHub Releases on startup
   Only network activity the app makes. Can be disabled in settings.
   ═══════════════════════════════════════════════════════════════ */
const configFile = path.join(userDataPath, "noteforge-config.json");

function loadConfig() {
  try {
    if (fs.existsSync(configFile)) return JSON.parse(fs.readFileSync(configFile, "utf-8"));
  } catch {}
  return { autoUpdate: true };
}
function saveConfig(cfg) {
  try { fs.writeFileSync(configFile, JSON.stringify(cfg), "utf-8"); } catch {}
}

ipcMain.handle("get-config", async () => loadConfig());
// Only settings the UI exposes. `sandbox` is deliberately absent: a compromised
// renderer must not be able to turn its own sandbox off for the next launch. The
// README documents editing noteforge-config.json by hand for that.
const CONFIG_VALIDATORS = { autoUpdate: (v) => typeof v === "boolean" };
ipcMain.handle("set-config", async (_e, key, value) => {
  if (!Object.hasOwn(CONFIG_VALIDATORS, key)) return { error: "Unknown config key" };
  if (!CONFIG_VALIDATORS[key](value)) return { error: "Invalid value" };
  const cfg = loadConfig();
  cfg[key] = value;
  saveConfig(cfg);
  return cfg;
});

if (autoUpdater) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
}

// Cached for About dialog / troubleshooting
let lastUpdateError = null;

// A fixed address, opened from main only (the renderer can't open URLs)
const RELEASES_URL = "https://github.com/jamesccupps/NoteForge/releases/latest";

function setupAutoUpdater() {
  if (IS_DEV) return;
  if (!autoUpdater) {
    console.warn("[NoteForge] Auto-updater unavailable:", autoUpdaterLoadError);
    return;
  }
  const cfg = loadConfig();
  if (!cfg.autoUpdate) return; // user disabled auto-update

  // Check for updates 5 seconds after launch (non-blocking)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(e => {
      lastUpdateError = e?.message || String(e);
      console.error("[NoteForge] Update check failed:", lastUpdateError);
    });
  }, 5000);

  autoUpdater.on("update-available", (info) => {
    if (!mainWindow) return;
    // electron-updater would run the installer, which sets up a separate installed copy
    // that doesn't see the notes beside the portable exe: point to the download instead
    if (IS_PORTABLE) {
      dialog.showMessageBox(mainWindow, {
        type: "info", title: "Update Available",
        message: `NoteForge ${info.version} is available.`,
        detail: `Download NoteForge-${info.version}-portable.exe and put it in place of this one, in the same folder, so it finds your "NoteForge Data" folder.`,
        buttons: ["Open Download Page", "Later"], defaultId: 0, cancelId: 1,
      }).then((r) => { if (r.response === 0) shell.openExternal(RELEASES_URL); });
      return;
    }
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

  autoUpdater.on("error", (err) => {
    lastUpdateError = err?.message || String(err);
    console.error("[NoteForge] Update error:", lastUpdateError);
  });
}

ipcMain.handle("check-for-updates", async () => {
  if (IS_DEV) return { update: false, devMode: true };
  if (!autoUpdater) return { update: false, error: "Auto-updater not loaded: " + autoUpdaterLoadError };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { update: !!result?.updateInfo, version: result?.updateInfo?.version };
  } catch (e) {
    lastUpdateError = e?.message || String(e);
    return { update: false, error: lastUpdateError };
  }
});

ipcMain.handle("get-update-status", async () => ({
  available: !!autoUpdater,
  loadError: autoUpdaterLoadError,
  lastError: lastUpdateError,
}));
