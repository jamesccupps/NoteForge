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
      // reload so it picks it up the way a relaunch would.
      await c.js(`location.reload()`).catch(() => {});
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

module.exports = { SCENARIOS, R, NB_PW, seedBase, seedLocked, unlockNotebook };
