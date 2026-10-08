// Electron entry point for the end-to-end tests. Loads the real main.js and renderer
// against a throwaway userData dir, runs one scenario (NF_SCENARIO), writes its checks
// to NF_RESULT as JSON, and quits. Driven by test/e2e/run.js.
const { app, dialog, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const REPO = path.resolve(__dirname, "..", "..", "..");
const { SCENARIOS } = require("./scenarios");
const scenario = SCENARIOS[process.env.NF_SCENARIO];
const RESULT = process.env.NF_RESULT;

const out = { checks: [], dialogs: [], consoleErrors: [] };
function finish(extra) {
  Object.assign(out, extra);
  fs.writeFileSync(RESULT, JSON.stringify(out, null, 2));
  app.exit(0);
}
if (!scenario) { finish({ fatal: `unknown scenario ${process.env.NF_SCENARIO}` }); return; }

// Never touch the user's real data: redirect userData before main.js reads it, and
// refuse to continue if that didn't take.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nf-e2e-"));
out.tmp = tmp; // run.js deletes it once Electron has exited and released its locks
app.setPath("userData", tmp);
if (app.getPath("userData") !== tmp) { finish({ fatal: "userData redirect failed" }); return; }
setTimeout(() => finish({ fatal: "scenario timed out" }), 60000).unref();

// Record native dialogs instead of showing them. Default answer is the cancel button.
dialog.showMessageBox = async (...args) => {
  const o = args.length > 1 ? args[1] : args[0];
  out.dialogs.push(o.title || o.message);
  return { response: scenario.messageBoxResponse ?? (o.cancelId ?? 1) };
};
dialog.showSaveDialog = async (...args) => {
  const o = args.length > 1 ? args[1] : args[0];
  out.dialogs.push("save:" + o.defaultPath);
  return { canceled: true };
};
dialog.showOpenDialog = async () => (scenario.openDialog ? scenario.openDialog(tmp) : { canceled: true, filePaths: [] });

// main.js calls loadFile("index.html") relative to the app path, which is this folder.
const origLoadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (f, o) {
  return origLoadFile.call(this, path.isAbsolute(f) ? f : path.join(REPO, f), o);
};

if (scenario.seed) fs.writeFileSync(path.join(tmp, "noteforge-data.json"), JSON.stringify(scenario.seed()));
require(path.join(REPO, "main.js"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function makeCtx(win) {
  const js = (code) => win.webContents.executeJavaScript(code, true);
  return {
    win, tmp, sleep, js,
    dialogs: out.dialogs,
    // Returns and removes console errors matching re, for scenarios that expect them.
    consumeConsoleErrors(re) {
      const hit = out.consoleErrors.filter((m) => re.test(m));
      out.consoleErrors = out.consoleErrors.filter((m) => !re.test(m));
      return hit;
    },
    check: (name, ok, detail) => out.checks.push({ name, ok: !!ok, detail: detail === undefined ? undefined : String(detail) }),
    async waitFor(expr, ms = 10000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await js(`!!(${expr})`)) return true; await sleep(100); }
      throw new Error("timed out waiting for: " + expr);
    },
    menu: (action) => win.webContents.send("menu-action", action),
    file: (name) => path.join(tmp, name),
    readData: () => JSON.parse(fs.readFileSync(path.join(tmp, "noteforge-data.json"), "utf-8")),
    // Polls the saved file until pred(data) holds (or ms passes) and returns the last data
    // read. Saves are debounced 500 ms and any further edit (e.g. a rename input committing
    // on window blur) restarts the timer, so a fixed sleep before reading is racy.
    async waitForData(pred, ms = 4000) {
      const t0 = Date.now();
      let data = null;
      while (Date.now() - t0 < ms) {
        try { data = JSON.parse(fs.readFileSync(path.join(tmp, "noteforge-data.json"), "utf-8")); if (pred(data)) return data; }
        catch { /* mid-rename or not written yet */ }
        await sleep(100);
      }
      return data;
    },
  };
}

app.on("browser-window-created", (_e, win) => {
  win.webContents.on("console-message", (e, level, message) => {
    const lvl = e.level ?? level, msg = e.message ?? message;
    if (lvl === 3 || lvl === "error") out.consoleErrors.push(msg);
  });
  win.webContents.once("did-finish-load", async () => {
    try {
      await scenario.run(makeCtx(win));
      finish({});
    } catch (e) {
      finish({ error: String((e && e.stack) || e) });
    }
  });
});
