// End-to-end scenarios. Each runs in a fresh app instance with its own userData.
const crypto = require("crypto");

const NB_PW = "Tr0ub4dor&3xyz";
const page = (id, title, content) => ({ id, title, content, created: 1, modified: 1, pinned: false, deleted: false });

// Same blob format as main.js encryptData()
function encryptBlob(plaintext, password) {
  const salt = crypto.randomBytes(32), iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  let data = c.update(plaintext, "utf-8", "base64"); data += c.final("base64");
  return JSON.stringify({ v: 2, kdf: "scrypt", N: 65536, r: 8, p: 1, salt: salt.toString("hex"),
    iv: iv.toString("hex"), tag: c.getAuthTag().toString("hex"), data });
}

const seedBase = () => ({ notebooks: [{ id: "nb-a", name: "Alpha", color: "#7c6ef0", sections: [
  { id: "sec-a", name: "S1", color: "#7c6ef0", pages: [page("pg-a", "Page A", "<p>alpha body</p>")] }] }] });
const seedLocked = () => {
  const d = seedBase();
  const secret = [{ id: "sec-l", name: "Secret", color: "#e54545", pages: [page("pg-l", "Secret page", "<p>TOPSECRET</p>")] }];
  d.notebooks.push({ id: "nb-l", name: "Locked", color: "#e54545", locked: true, sections: [],
    encSections: encryptBlob(JSON.stringify(secret), NB_PW) });
  return d;
};

// Renderer helpers (strings evaluated in the page)
const R = {
  nb: (name) => `[...document.querySelectorAll(".nf-nb")].find(e=>e.textContent.includes(${JSON.stringify(name)}))`,
  ctxItem: (label) => `[...document.querySelectorAll(".nf-ctx-item")].find(e=>e.textContent.includes(${JSON.stringify(label)}))`,
  button: (sel, label) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.trim()===${JSON.stringify(label)})`,
  rightClick: (el, x = 60, y = 120) => `${el}.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:${x},clientY:${y}}))`,
  // Set a React-controlled input's value so onChange fires
  type: (el, value) => `(()=>{const i=${el};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event("input",{bubbles:true}))})()`,
  editorText: `document.querySelector(".nf-editor")?.innerText||""`,
};

async function unlockNotebook(c, name) {
  await c.js(`${R.nb(name)}.click()`);
  await c.waitFor(`document.querySelector(".nf-overlay-input")`);
  await c.js(R.type(`document.querySelector(".nf-overlay-input")`, NB_PW));
  await c.js(`${R.button(".nf-overlay-btn", "Unlock")}.click()`);
  await c.waitFor(`${R.editorText}.includes("TOPSECRET")`);
}

const SCENARIOS = {
  boot: {
    seed: seedBase,
    async run(c) {
      await c.waitFor(`document.querySelector(".nf-editor")`);
      c.check("editor renders seeded page", (await c.js(R.editorText)).includes("alpha body"));
      c.check("page title input shows title", (await c.js(`document.querySelector(".nf-title-input").value`)) === "Page A");
      c.check("sandboxed renderer has no require()", (await c.js(`typeof require`)) === "undefined");
      c.check("preload bridge exposed", (await c.js(`typeof window.electronAPI.storageGet`)) === "function");
      await c.sleep(300);
    },
  },

  editPersists: {
    seed: seedBase,
    async run(c) {
      await c.waitFor(`document.querySelector(".nf-editor")`);
      await c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.innerHTML="<p>edited body</p>";ed.dispatchEvent(new Event("input",{bubbles:true}))})()`);
      await c.sleep(1000);
      const pg = c.readData().notebooks[0].sections[0].pages[0];
      c.check("edit saved to disk after debounce", pg.content === "<p>edited body</p>", pg.content);
      c.check("schema version stamped", c.readData().version === 1);
    },
  },

  unlockNotebook: {
    seed: seedLocked,
    async run(c) {
      await c.waitFor(R.nb("Locked"));
      await unlockNotebook(c, "Locked");
      c.check("locked notebook content visible after unlock", true);
      await c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.innerHTML="<p>TOPSECRET edited</p>";ed.dispatchEvent(new Event("input",{bubbles:true}))})()`);
      await c.sleep(1000);
      const raw = require("fs").readFileSync(c.file("noteforge-data.json"), "utf-8");
      c.check("edited locked-notebook text never written in plaintext", !raw.includes("TOPSECRET"));
      const nb = JSON.parse(raw).notebooks.find((n) => n.id === "nb-l");
      c.check("locked notebook keeps encSections on disk", !!nb.encSections && nb.sections.length === 0);
    },
  },

  lockAndUnlockApp: {
    seed: seedBase,
    async run(c) {
      await c.waitFor(`document.querySelector(".nf-editor")`);
      const r = await c.js(`window.electronAPI.enableEncryption("Master!Passw0rd-e2e","")`);
      c.check("enable encryption", r && r.success, JSON.stringify(r));
      // The renderer only learns encryption is on from the settings flow or a restart;
      // reload from main (page-initiated navigation is blocked) as a relaunch stand-in.
      c.win.webContents.reload();
      await c.sleep(500);
      await c.waitFor(`document.querySelector(".nf-overlay-input")`);
      await c.js(R.type(`document.querySelector(".nf-overlay-input")`, "Master!Passw0rd-e2e"));
      await c.js(`${R.button(".nf-overlay-btn", "Unlock")}.click()`);
      await c.waitFor(`${R.editorText}.includes("alpha body")`);
      c.menu("lock-app");
      await c.waitFor(`document.querySelector(".nf-overlay-input")`);
      c.check("File > Lock App locks", true);
      await c.js(R.type(`document.querySelector(".nf-overlay-input")`, "Master!Passw0rd-e2e"));
      await c.js(`${R.button(".nf-overlay-btn", "Unlock")}.click()`);
      await c.waitFor(`document.querySelector(".nf-editor")`);
      await c.sleep(300);
      c.check("editor repaints after unlock on same page", (await c.js(R.editorText)).includes("alpha body"), await c.js(R.editorText));
    },
  },
};

SCENARIOS.removePassword = {
  seed: seedLocked,
  async run(c) {
    await c.waitFor(R.nb("Locked"));
    const before = require("fs").readFileSync(c.file("noteforge-data.json"), "utf-8");
    await c.js(R.rightClick(R.nb("Locked")));
    await c.sleep(200);
    const items = await c.js(`[...document.querySelectorAll(".nf-ctx-item")].map(e=>e.textContent.trim())`);
    c.check("still-locked notebook: no Remove Password item", !items.some((t) => t.includes("Remove Password")), items.join(", "));
    await c.js(`document.body.click()`);
    await c.sleep(800);
    c.check("still-locked notebook: data file untouched", require("fs").readFileSync(c.file("noteforge-data.json"), "utf-8") === before);

    await unlockNotebook(c, "Locked");
    const openRemove = async () => {
      await c.js(R.rightClick(R.nb("Locked")));
      await c.sleep(200);
      await c.js(`${R.ctxItem("Remove Password")}.click()`);
      await c.waitFor(`document.querySelector(".nf-modal")`);
    };
    await openRemove();
    await c.js(`${R.button(".nf-modal-btn", "Cancel")}.click()`);
    await c.sleep(800);
    let nb = c.readData().notebooks.find((n) => n.id === "nb-l");
    c.check("cancel keeps the notebook locked", nb.locked === true && !!nb.encSections);
    await openRemove();
    await c.js(`${R.button(".nf-modal-btn", "Remove Password")}.click()`);
    await c.sleep(1000);
    nb = c.readData().notebooks.find((n) => n.id === "nb-l");
    c.check("confirm removes the lock", nb.locked === false && !nb.encSections);
    c.check("pages survive removing the lock", JSON.stringify(nb.sections).includes("TOPSECRET"));
  },
};

SCENARIOS.saveFailureShown = {
  seed: seedBase,
  async run(c) {
    const fs = require("fs");
    await c.waitFor(`document.querySelector(".nf-editor")`);
    const edit = (text) => c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.innerHTML="<p>${text}</p>";ed.dispatchEvent(new Event("input",{bubbles:true}))})()`);
    const status = () => c.js(`[...document.querySelectorAll(".nf-status span")].map(s=>s.textContent).find(t=>/Save/.test(t))`);
    fs.chmodSync(c.file("noteforge-data.json"), 0o444); // read-only: the write will fail
    await edit("cannot be saved");
    await c.sleep(1000);
    c.check("failed write shows 'Save failed'", (await status()) === "Save failed", await status());
    fs.chmodSync(c.file("noteforge-data.json"), 0o644);
    await edit("saved now");
    await c.sleep(1000);
    c.check("next successful write shows 'Saved'", (await status()) === "Saved", await status());
    c.check("content on disk after recovery", c.readData().notebooks[0].sections[0].pages[0].content === "<p>saved now</p>");
  },
};

SCENARIOS.navigationBlocked = {
  seed: seedBase,
  async run(c) {
    const fs = require("fs");
    await c.waitFor(`document.querySelector(".nf-editor")`);
    const start = c.win.webContents.getURL();
    const probe = c.file("probe.html");
    fs.writeFileSync(probe, "<script>document.title='PROBE:'+typeof window.electronAPI</script>");
    const url = "file:///" + probe.replace(/\\/g, "/");
    await c.js(`location.href=${JSON.stringify(url)}`).catch(() => {});
    await c.sleep(1500);
    c.check("local file:// navigation blocked", c.win.webContents.getURL() === start, c.win.webContents.getURL());
    c.check("probe page never ran", !c.win.getTitle().startsWith("PROBE"), c.win.getTitle());
    await c.js(`location.href="https://example.com/"`).catch(() => {});
    await c.sleep(800);
    c.check("https navigation blocked", c.win.webContents.getURL() === start, c.win.webContents.getURL());
    c.check("app still responsive", (await c.js(R.editorText)).includes("alpha body"));
  },
};

SCENARIOS.uncImagesBlocked = {
  seed: () => {
    const d = seedBase();
    d.notebooks[0].sections[0].pages[0].content =
      '<p>pic</p><img src="//127.0.0.1/nf-e2e-share/a.png"><div style="background:url(//127.0.0.1/nf-e2e-share/b.png)">bg</div>';
    return d;
  },
  async run(c) {
    await c.waitFor(`document.querySelector(".nf-editor")`);
    c.check("sanitizer removed the UNC img src on load",
      (await c.js(`[...document.querySelectorAll(".nf-editor img")].every(i=>!i.hasAttribute("src"))`)) === true);
    // Bypass the sanitizer entirely: the CSP alone must stop a UNC image.
    await c.js(`(()=>{const img=new Image();img.src="//127.0.0.1/nf-e2e-share/c.png";document.body.appendChild(img);
      const bg=document.createElement("div");bg.style.background="url(//127.0.0.1/nf-e2e-share/d.png)";bg.textContent="x";document.body.appendChild(bg);})()`);
    await c.sleep(1500);
    // Violation events only report the scheme ("file"), so use Chromium's console refusal.
    const refused = (f) => new RegExp(`Refused to load the image 'file://127\.0\.0\.1/nf-e2e-share/${f}'.*"img-src data:"`);
    c.check("CSP blocks the seeded UNC CSS background", c.consumeConsoleErrors(refused("b.png")).length === 1);
    c.check("CSP blocks a UNC <img> injected directly", c.consumeConsoleErrors(refused("c.png")).length === 1);
    c.check("CSP blocks a UNC CSS background set from script", c.consumeConsoleErrors(refused("d.png")).length === 1);
  },
};

SCENARIOS.menuExport = {
  messageBoxResponse: 0, // "Export Anyway", so the save dialog (with its filename) opens
  seed: () => {
    const d = seedBase();
    d.notebooks[0].sections[0].pages.push({ ...page("pg-b", "Page B", "<p>bravo body</p>"), modified: 0 });
    return d;
  },
  async run(c) {
    await c.waitFor(`document.querySelector(".nf-editor")`);
    await c.js(`[...document.querySelectorAll(".nf-pg")].find(e=>e.textContent.includes("Page B")).click()`);
    await c.waitFor(`${R.editorText}.includes("bravo body")`);
    c.menu("export-html");
    await c.sleep(800);
    c.check("File > Export as HTML exports the current page", c.dialogs.includes("save:Page_B.html"), c.dialogs.join(", "));
    c.menu("export-text");
    await c.sleep(800);
    c.check("File > Export as Text exports the current page", c.dialogs.includes("save:Page_B.txt"), c.dialogs.join(", "));
    c.menu("new-notebook");
    await c.sleep(800);
    c.check("File > New Notebook still works", c.readData().notebooks.length === 2);
  },
};

SCENARIOS.contextMenuPaste = {
  seed: seedBase,
  async run(c) {
    // Uses the real system clipboard; the text that was on it is put back afterwards.
    const { clipboard } = require("electron");
    const saved = clipboard.readText();
    try {
      clipboard.writeText("PASTED-FROM-CLIPBOARD");
      await c.waitFor(`document.querySelector(".nf-editor")`);
      await c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.focus();const r=document.createRange();
        r.selectNodeContents(ed);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);
        ed.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:400,clientY:300}))})()`);
      await c.sleep(200);
      await c.js(`${R.ctxItem("Paste")}.click()`);
      await c.sleep(1000);
      const text = await c.js(R.editorText);
      c.check("context-menu Paste inserts clipboard text at the caret", /alpha body\s*PASTED-FROM-CLIPBOARD/.test(text), JSON.stringify(text));
      c.check("pasted text saved", JSON.stringify(c.readData()).includes("PASTED-FROM-CLIPBOARD"));
    } finally {
      clipboard.writeText(saved);
    }
  },
};

const BACKUP_PW = "Backup#Passphrase-2026";
SCENARIOS.restoreBackup = {
  messageBoxResponse: 0, // "Choose Backup…"
  seed: seedBase,
  openDialog: (tmp) => {
    const fs = require("fs"), path = require("path");
    const file = path.join(tmp, "picked-backup.enc");
    const data = { notebooks: [{ id: "nb-r", name: "Restored", color: "#1cb888", sections: [{ id: "sec-r", name: "R", color: "#1cb888",
      pages: [page("pg-r", "Restored page", "<p>from the backup</p>")] }] }] };
    fs.writeFileSync(file, encryptBlob(JSON.stringify(data), BACKUP_PW));
    return { canceled: false, filePaths: [file] };
  },
  async run(c) {
    await c.waitFor(`document.querySelector(".nf-editor")`);
    c.menu("restore-backup");
    await c.waitFor(`document.querySelector(".nf-overlay-title")?.textContent==="Verify Backup Password"`);
    await c.js(R.type(`document.querySelector(".nf-overlay-input")`, "wrong-password-1"));
    await c.js(`${R.button(".nf-overlay-btn", "Restore Backup")}.click()`);
    await c.waitFor(`document.querySelector(".nf-overlay-error")`);
    c.check("wrong backup password shows an error", true);
    await c.js(R.type(`document.querySelector(".nf-overlay-input")`, BACKUP_PW));
    await c.js(`${R.button(".nf-overlay-btn", "Restore Backup")}.click()`);
    await c.waitFor(`document.querySelector(".nf-modal h3")?.textContent==="Restore complete"`);
    const msg = await c.js(`document.querySelector(".nf-modal p").textContent`);
    c.check("'Restore complete' alert names the rollback file", msg.includes("noteforge-data.json.pre-restore.bak"), msg);
    await c.js(`${R.button(".nf-modal-btn", "OK")}.click()`);
    await c.waitFor(`document.querySelector(".nf-overlay-title")?.textContent==="Unlock NoteForge"`);
    c.check("restore leads to the unlock screen", true);
    await c.js(R.type(`document.querySelector(".nf-overlay-input")`, BACKUP_PW));
    await c.js(`${R.button(".nf-overlay-btn", "Unlock")}.click()`);
    await c.waitFor(`${R.editorText}.includes("from the backup")`);
    c.check("restored notes open with the backup password", true);
    const fs = require("fs");
    c.check("previous unencrypted notes kept for rollback",
      fs.existsSync(c.file("noteforge-data.json.pre-restore.bak")) && fs.readFileSync(c.file("noteforge-data.json.pre-restore.bak"), "utf-8").includes("alpha body"));
  },
};

module.exports = { SCENARIOS, R, NB_PW, seedBase, seedLocked, unlockNotebook };
