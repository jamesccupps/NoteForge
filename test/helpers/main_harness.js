// Loads the real main.js with a stub "electron" module so the IPC handlers can be
// called directly against a throwaway userData dir. Each load gets fresh module
// state (session keys, rate-limit counters), which is how a restart looks to main.js.
const Module = require("module");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..", "..");
const mainPath = path.join(root, "main.js");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));

function loadMain({ userData } = {}) {
  userData = userData || fs.mkdtempSync(path.join(os.tmpdir(), "nf-test-"));
  const handlers = new Map();
  const listeners = new Map();
  // Tests script dialog results by assigning to these before invoking a handler.
  const dialogs = {
    messageBoxResponse: 0,
    save: { canceled: true },
    open: { canceled: true, filePaths: [] },
    shown: [],
  };
  const stub = {
    app: {
      getPath: () => userData,
      getVersion: () => pkg.version,
      isPackaged: false,
      whenReady: () => new Promise(() => {}), // never creates a window under test
      on() {},
      setAppUserModelId() {},
    },
    ipcMain: {
      handle: (ch, fn) => handlers.set(ch, fn),
      on: (ch, fn) => listeners.set(ch, fn),
    },
    dialog: {
      showMessageBox: async (_win, opts) => { dialogs.shown.push(opts); return { response: dialogs.messageBoxResponse }; },
      showSaveDialog: async () => dialogs.save,
      showOpenDialog: async () => dialogs.open,
    },
    shell: { openPath: async () => "" },
    Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
    BrowserWindow: function BrowserWindow() { throw new Error("BrowserWindow not available under test"); },
    session: { defaultSession: { setPermissionRequestHandler() {} } },
  };

  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return stub;
    if (request === "electron-updater") throw new Error("electron-updater stubbed out under test");
    return origLoad.call(this, request, parent, isMain);
  };
  const origError = console.error;
  console.error = () => {}; // main.js logs the stubbed-out updater
  try {
    delete require.cache[require.resolve(mainPath)];
    require(mainPath);
  } finally {
    Module._load = origLoad;
    console.error = origError;
  }

  const sender = { paste() { sender.pasted = (sender.pasted || 0) + 1; } };
  const event = () => ({ sender, senderFrame: { url: "file:///index.html" } });
  return {
    userData,
    dialogs,
    sender,
    file: (name) => path.join(userData, name),
    exists: (name) => fs.existsSync(path.join(userData, name)),
    read: (name) => fs.readFileSync(path.join(userData, name), "utf-8"),
    write: (name, data) => fs.writeFileSync(path.join(userData, name), data),
    has: (ch) => handlers.has(ch) || listeners.has(ch),
    invoke: async (ch, ...args) => {
      if (!handlers.has(ch)) throw new Error(`no ipcMain.handle("${ch}")`);
      return handlers.get(ch)(event(), ...args);
    },
    sendSync: (ch, ...args) => {
      if (!listeners.has(ch)) throw new Error(`no ipcMain.on("${ch}")`);
      const ev = event();
      listeners.get(ch)(ev, ...args);
      return ev.returnValue;
    },
    restart: () => loadMain({ userData }),
    cleanup: () => fs.rmSync(userData, { recursive: true, force: true }),
  };
}

// Builds a blob in main.js's on-disk format with arbitrary KDF parameters, for
// downgrade / legacy / DoS tests. `header` overrides or removes fields.
function makeBlob(plaintext, password, { N = 65536, r = 8, p = 1, header = {} } = {}) {
  const salt = crypto.randomBytes(32), iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32, { N, r, p, maxmem: 256 * 1024 * 1024 });
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  let data = c.update(plaintext, "utf-8", "base64"); data += c.final("base64");
  const obj = { v: 2, kdf: "scrypt", N, r, p, salt: salt.toString("hex"), iv: iv.toString("hex"),
    tag: c.getAuthTag().toString("hex"), data, ...header };
  for (const [k, v] of Object.entries(header)) if (v === undefined) delete obj[k];
  return JSON.stringify(obj);
}

// Minimal assertion runner shared by the main-process test files.
function runner() {
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => {
    if (ok) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${detail !== undefined ? " → " + detail : ""}`); fail++; }
  };
  const done = () => {
    console.log(`\n  ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  };
  return { t, done, section: (s) => console.log(`\n=== ${s} ===`) };
}

module.exports = { loadMain, makeBlob, runner, root };
