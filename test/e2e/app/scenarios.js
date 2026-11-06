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
  editorText: `(document.querySelector(".nf-editor")?.innerText||"")`,
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
      const d = await c.waitForData((d) => d.notebooks[0].sections[0].pages[0].content === "<p>edited body</p>");
      c.check("edit saved to disk after debounce", d.notebooks[0].sections[0].pages[0].content === "<p>edited body</p>", d.notebooks[0].sections[0].pages[0].content);
      c.check("schema version stamped", d.version === 1);
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
    let nb = (await c.waitForData(() => true)).notebooks.find((n) => n.id === "nb-l");
    c.check("cancel keeps the notebook locked", nb.locked === true && !!nb.encSections);
    await openRemove();
    await c.js(`${R.button(".nf-modal-btn", "Remove Password")}.click()`);
    await c.sleep(1000);
    nb = (await c.waitForData((d) => d.notebooks.find((n) => n.id === "nb-l").locked === false)).notebooks.find((n) => n.id === "nb-l");
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
    // (the rename is retried for about 0.6 s before the save gives up)
    await c.waitFor(`[...document.querySelectorAll(".nf-status span")].some(s=>s.textContent==="Save failed")`, 4000).catch(() => {});
    c.check("failed write shows 'Save failed'", (await status()) === "Save failed", await status());
    fs.chmodSync(c.file("noteforge-data.json"), 0o644);
    await edit("saved now");
    await c.sleep(1000);
    c.check("next successful write shows 'Saved'", (await status()) === "Saved", await status());
    c.check("content on disk after recovery", (await c.waitForData((d) => d.notebooks[0].sections[0].pages[0].content === "<p>saved now</p>"))
      .notebooks[0].sections[0].pages[0].content === "<p>saved now</p>");
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
    // Violation events only report the scheme ("file"), so use Chromium's console message
    // ("Refused to load the image '...'" before Chromium ~140, "Loading the image '...' violates" after).
    const refused = (f) => new RegExp(`the image 'file://127\.0\.0\.1/nf-e2e-share/${f}'.*"img-src data:"`);
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
    const afterNew = await c.waitForData((d) => d.notebooks.length === 2);
    c.check("File > New Notebook still works", afterNew.notebooks.length === 2, JSON.stringify(afterNew.notebooks.map((n) => n.name)));
  },
};

SCENARIOS.contextMenuPaste = {
  seed: seedBase,
  async run(c) {
    // Uses the real system clipboard; the text that was on it is put back afterwards.
    const { clipboard } = require("electron");
    // Electron 44 made the clipboard methods async (W3C Clipboard API shape).
    const saved = await clipboard.readText();
    try {
      await clipboard.writeText("PASTED-FROM-CLIPBOARD");
      await c.waitFor(`document.querySelector(".nf-editor")`);
      await c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.focus();const r=document.createRange();
        r.selectNodeContents(ed);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);
        ed.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:400,clientY:300}))})()`);
      await c.sleep(200);
      await c.js(`${R.ctxItem("Paste")}.click()`);
      await c.sleep(1000);
      const text = await c.js(R.editorText);
      c.check("context-menu Paste inserts clipboard text at the caret", /alpha body\s*PASTED-FROM-CLIPBOARD/.test(text), JSON.stringify(text));
      c.check("pasted text saved", JSON.stringify(await c.waitForData((d) => JSON.stringify(d).includes("PASTED-FROM-CLIPBOARD"))).includes("PASTED-FROM-CLIPBOARD"));
    } finally {
      await clipboard.writeText(saved);
    }
  },
};

SCENARIOS.replaceAll = {
  seed: seedBase,
  async run(c) {
    await c.waitFor(`document.querySelector(".nf-editor")`);
    await c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.innerHTML="<p>cost 5 dollars, Dollars</p>";ed.dispatchEvent(new Event("input",{bubbles:true}))})()`);
    c.menu("find-replace");
    await c.waitFor(`document.querySelectorAll(".nf-find-input").length===2`);
    await c.js(R.type(`document.querySelectorAll(".nf-find-input")[0]`, "dollars"));
    await c.js(R.type(`document.querySelectorAll(".nf-find-input")[1]`, "US$& ($1) $$"));
    await c.js(`${R.button(".nf-find-btn", "All")}.click()`);
    await c.sleep(800);
    const text = await c.js(R.editorText);
    c.check("Replace All inserts the replacement literally", text === "cost 5 US$& ($1) $$, US$& ($1) $$", JSON.stringify(text));
    const replaced = (await c.waitForData((d) => d.notebooks[0].sections[0].pages[0].content.includes("US$&amp;"))).notebooks[0].sections[0].pages[0].content;
    c.check("replacement saved", replaced.includes("US$&amp; ($1) $$"), replaced);
  },
};

// Replace All used to assign textContent, which the editor's undo can't reverse, and
// matched case-insensitively with no way to say otherwise ("cat" also hit "Category").
SCENARIOS.replaceAllUndoAndCase = {
  seed: seedBase,
  async run(c) {
    await c.waitFor(`document.querySelector(".nf-editor")`);
    const ORIGINAL = "cat Cat category <b>cat</b>";
    await c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.innerHTML="<p>${ORIGINAL}</p>";ed.dispatchEvent(new Event("input",{bubbles:true}))})()`);
    c.menu("find-replace");
    await c.waitFor(`document.querySelectorAll(".nf-find-input").length===2`);
    await c.js(R.type(`document.querySelectorAll(".nf-find-input")[0]`, "cat"));
    await c.js(R.type(`document.querySelectorAll(".nf-find-input")[1]`, "dog"));
    const toggle = `document.querySelector('.nf-find-bar [title="Match case"]')`;
    c.check("Match case option present", await c.js(`!!${toggle}`));
    await c.js(`${toggle}?.click()`);
    await c.sleep(200);
    c.check("Match case narrows the count", (await c.js(`document.querySelector(".nf-find-info")?.textContent||""`)).includes("of 3") ||
      (await c.js(`document.querySelector(".nf-find-info")?.textContent||""`)) === "– of 3", await c.js(`document.querySelector(".nf-find-info")?.textContent||""`));
    await c.js(`${R.button(".nf-find-btn", "All")}.click()`);
    await c.sleep(500);
    const text = await c.js(R.editorText);
    c.check("Match case: only lower-case 'cat' replaced", text === "dog Cat dogegory dog", JSON.stringify(text));
    c.check("formatting kept", await c.js(`document.querySelector(".nf-editor b")?.textContent==="dog"`));
    await c.js(`document.querySelector(".nf-editor").focus()`);
    for (let i = 0; i < 3; i++) { await c.js(`document.execCommand("undo")`); await c.sleep(100); }
    c.check("Replace All can be undone", (await c.js(R.editorText)) === "cat Cat category cat", JSON.stringify(await c.js(R.editorText)));
  },
};

SCENARIOS.lockedNotebookWarnings = {
  seed: seedLocked,
  async run(c) {
    await c.waitFor(R.nb("Locked"));
    await unlockNotebook(c, "Locked");
    c.check("unlocked notebook becomes the active one",
      (await c.js(`document.querySelector(".nf-nb.active")?.textContent||""`)).includes("Locked"));
    await c.js(`document.querySelector('button[title="Export HTML"]').click()`);
    await c.sleep(600);
    c.check("Export HTML warns that the page is password-protected", c.dialogs.includes("Export Password-Protected Page"), c.dialogs.join(", "));
    await c.js(`document.querySelector('button[title="Print"]').click()`);
    await c.sleep(600);
    c.check("Print warns before printing a password-protected page", c.dialogs.includes("Print Unencrypted"), c.dialogs.join(", "));
  },
};

SCENARIOS.trashToggleKeepsPage = {
  seed: seedBase,
  async run(c) {
    await c.waitFor(`${R.editorText}.includes("alpha body")`);
    const trash = `[...document.querySelectorAll(".nf-add-btn")].find(e=>e.textContent.startsWith("Trash"))`;
    await c.js(`${trash}.click()`);
    await c.sleep(300);
    await c.js(`${trash}.click()`);
    await c.sleep(300);
    c.check("page content shown after closing Trash", (await c.js(R.editorText)).includes("alpha body"), JSON.stringify(await c.js(R.editorText)));
    await c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.focus();const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);
      const s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand("insertText",false," typed")})()`);
    await c.sleep(1000);
    const saved = (await c.waitForData((d) => d.notebooks[0].sections[0].pages[0].content.includes("typed"))).notebooks[0].sections[0].pages[0].content;
    c.check("typing afterwards keeps the existing content", saved.includes("alpha body") && saved.includes("typed"), saved);
  },
};

SCENARIOS.relockActiveNotebook = {
  seed: seedLocked,
  async run(c) {
    await c.waitFor(R.nb("Locked"));
    await unlockNotebook(c, "Locked");
    await c.js(R.rightClick(R.nb("Locked")));
    await c.sleep(200);
    await c.js(`${R.ctxItem("Re-lock Now")}.click()`);
    await c.waitFor(`document.querySelector(".nf-modal")`);
    await c.js(`${R.button(".nf-modal-btn", "Re-lock")}.click()`);
    await c.sleep(800);
    c.check("page list pane closes after re-locking the open notebook", !(await c.js(`!!document.querySelector(".nf-pages")`)));
    c.check("editor shows the empty state", (await c.js(`document.querySelector(".nf-empty")?.innerText||""`)).includes("Select a section"));
    c.check("re-locked content gone from the DOM", !(await c.js(`document.body.innerText.includes("TOPSECRET")||document.body.innerText.includes("Secret page")`)));
    await unlockNotebook(c, "Locked");
    c.check("notebook unlocks again and shows its page", (await c.js(R.editorText)).includes("TOPSECRET"));
  },
};

// The protected notebook's pages as they are on disk, decrypted with its password
function diskNotebookText(c) {
  const nb = c.readData().notebooks.find((n) => n.id === "nb-l");
  const o = JSON.parse(nb.encSections);
  const key = crypto.scryptSync(NB_PW, Buffer.from(o.salt, "hex"), 32, { N: o.N, r: o.r, p: o.p, maxmem: 128 * 1024 * 1024 });
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(o.iv, "hex"));
  d.setAuthTag(Buffer.from(o.tag, "hex"));
  return d.update(o.data, "base64", "utf-8") + d.final("utf-8");
}
const editLocked = (c, text) => c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.innerHTML=${JSON.stringify(`<p>TOPSECRET ${text}</p>`)};ed.dispatchEvent(new Event("input",{bubbles:true}))})()`);

// Edits in a protected notebook must survive Re-lock Now, Lock and closing the app
SCENARIOS.relockKeepsEdits = {
  seed: seedLocked,
  async run(c) {
    await c.waitFor(R.nb("Locked"));
    await unlockNotebook(c, "Locked");
    await editLocked(c, "edit-one");
    await c.sleep(1500);
    c.check("edit reaches the encrypted blob on disk", diskNotebookText(c).includes("edit-one"));
    await c.js(R.rightClick(R.nb("Locked")));
    await c.sleep(200);
    await c.js(`${R.ctxItem("Re-lock Now")}.click()`);
    await c.waitFor(`document.querySelector(".nf-modal")`);
    await c.js(`${R.button(".nf-modal-btn", "Re-lock")}.click()`);
    await c.sleep(1500);
    c.check("edit still on disk after Re-lock Now", diskNotebookText(c).includes("edit-one"), diskNotebookText(c));
    await unlockNotebook(c, "Locked");
    c.check("edit shown after unlocking again", (await c.js(R.editorText)).includes("edit-one"), await c.js(R.editorText));
  },
};

SCENARIOS.closeKeepsLockedEdits = {
  seed: seedLocked,
  async run(c) {
    await c.waitFor(R.nb("Locked"));
    await unlockNotebook(c, "Locked");
    await editLocked(c, "edit-two");
    await c.sleep(1500);
    c.check("edit reaches the encrypted blob on disk", diskNotebookText(c).includes("edit-two"));
    // Reload runs the beforeunload flush, the same as closing the window
    c.win.webContents.reload();
    await c.sleep(1000);
    c.check("edit still on disk after the close flush", diskNotebookText(c).includes("edit-two"), diskNotebookText(c));
    await c.waitFor(R.nb("Locked"));
    await unlockNotebook(c, "Locked");
    c.check("edit shown after relaunch", (await c.js(R.editorText)).includes("edit-two"), await c.js(R.editorText));
  },
};

SCENARIOS.lockAppKeepsLockedEdits = {
  seed: seedLocked,
  async run(c) {
    const MPW = "Master!Passw0rd-e2e";
    const unlockMaster = async () => {
      await c.waitFor(`document.querySelector(".nf-overlay-input")`);
      await c.js(R.type(`document.querySelector(".nf-overlay-input")`, MPW));
      await c.js(`${R.button(".nf-overlay-btn", "Unlock")}.click()`);
      await c.waitFor(R.nb("Locked"));
    };
    await c.waitFor(R.nb("Locked"));
    const r = await c.js(`window.electronAPI.enableEncryption(${JSON.stringify(MPW)},"")`);
    c.check("enable encryption", r && r.success, JSON.stringify(r));
    c.win.webContents.reload();
    await c.sleep(500);
    await unlockMaster();
    await unlockNotebook(c, "Locked");
    await editLocked(c, "edit-three");
    await c.sleep(1500);
    c.menu("lock-app");
    await unlockMaster();
    await unlockNotebook(c, "Locked");
    c.check("edit shown after Lock and unlock", (await c.js(R.editorText)).includes("edit-three"), await c.js(R.editorText));
  },
};

SCENARIOS.listTabIndent = {
  seed: () => {
    const d = seedBase();
    d.notebooks[0].sections[0].pages[0].content = "<ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>";
    return d;
  },
  async run(c) {
    await c.waitFor(`document.querySelector(".nf-editor li")`);
    // Put the caret at the end of a list item's text
    const caretIn = (text) => c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.focus();
      const li=[...ed.querySelectorAll("li")].find(l=>l.textContent===${JSON.stringify(text)});
      const r=document.createRange();r.selectNodeContents(li);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r)})()`);
    // Real key events (sendInputEvent), so the browser's default Tab handling is exercised
    const press = async (modifiers = []) => {
      c.win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab", modifiers });
      c.win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab", modifiers });
      await c.sleep(300);
    };
    const nested = (text) => c.js(`[...document.querySelectorAll(".nf-editor ul ul li, .nf-editor ol ol li")].some(l=>l.textContent===${JSON.stringify(text)})`);
    const editorFocused = () => c.js(`document.activeElement===document.querySelector(".nf-editor")`);

    await caretIn("two");
    await press();
    c.check("Tab in a bullet nests it one level deeper", await nested("two"), await c.js(`document.querySelector(".nf-editor").innerHTML`));
    c.check("focus stays in the editor after Tab", await editorFocused(), await c.js(`document.activeElement?.className||document.activeElement?.tagName`));
    await press(["shift"]);
    c.check("Shift+Tab moves it back out", !(await nested("two")), await c.js(`document.querySelector(".nf-editor").innerHTML`));
    await caretIn("second");
    await press();
    c.check("Tab in a numbered list nests it", await nested("second"), await c.js(`document.querySelector(".nf-editor").innerHTML`));
    await c.sleep(800);
    const nestedRe = /<ol>\s*<li>first<\/li>\s*<ol>|<li>first<ol>/;
    const listHtml = (await c.waitForData((d) => nestedRe.test(d.notebooks[0].sections[0].pages[0].content))).notebooks[0].sections[0].pages[0].content;
    c.check("nested list saved", nestedRe.test(listHtml), listHtml);
  },
};

// Real mouse click at an element's centre (sendInputEvent), for things where the browser's
// own default behaviour matters (checkbox toggling, focus moves).
async function realClick(c, expr) {
  const r = await c.js(`(()=>{const e=${expr};const b=e.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
  c.win.webContents.sendInputEvent({ type: "mouseDown", x: r.x, y: r.y, button: "left", clickCount: 1 });
  c.win.webContents.sendInputEvent({ type: "mouseUp", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await c.sleep(250);
}

SCENARIOS.checklistTickSaved = {
  seed: () => {
    const d = seedBase();
    d.notebooks[0].sections[0].pages[0].content = '<div class="nf-check"><input type="checkbox" id="t1"><label for="t1">buy milk</label></div>';
    return d;
  },
  async run(c) {
    const box = `document.querySelector(".nf-editor .nf-check input")`;
    const saved = (pred) => c.waitForData((d) => pred(d.notebooks[0].sections[0].pages[0].content));
    await c.waitFor(box);
    await realClick(c, box);
    c.check("tick is saved", /<input[^>]*checked/.test((await saved((s) => /checked/.test(s))).notebooks[0].sections[0].pages[0].content));
    const trash = `[...document.querySelectorAll(".nf-add-btn")].find(e=>e.textContent.startsWith("Trash"))`;
    await c.js(`${trash}.click()`); await c.sleep(200); await c.js(`${trash}.click()`); await c.sleep(300);
    c.check("tick survives the editor reloading the page", await c.js(`${box}.checked`));
    await realClick(c, box);
    c.check("untick is saved", !/checked/.test((await saved((s) => !/checked/.test(s))).notebooks[0].sections[0].pages[0].content));
  },
};

SCENARIOS.findReplace = {
  seed: () => {
    const d = seedBase();
    d.notebooks[0].sections[0].pages[0].content = "<p>cat dog cat bird CAT fish</p>";
    return d;
  },
  async run(c) {
    const key = async (keyCode, modifiers = []) => {
      c.win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      c.win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
      await c.sleep(150);
    };
    const type = async (text) => { for (const ch of text) c.win.webContents.sendInputEvent({ type: "char", keyCode: ch }); await c.sleep(250); };
    const info = () => c.js(`document.querySelector(".nf-find-info")?.textContent||""`);
    // Offset (in editor text) and text of the current-match highlight
    const current = () => c.js(`(()=>{const h=CSS.highlights.get("nf-find-current");if(!h)return "none";const r=[...h][0];
      const pre=document.createRange();pre.selectNodeContents(document.querySelector(".nf-editor"));pre.setEnd(r.startContainer,r.startOffset);
      return pre.toString().length+":"+r.toString()})()`);
    const focusedFind = () => c.js(`document.activeElement===document.querySelector(".nf-find-input")`);

    await c.waitFor(`document.querySelector(".nf-editor")`);
    await c.js(`document.querySelector(".nf-editor").focus()`);
    await key("F", ["control"]);
    c.check("Ctrl+F puts focus in the find box", await focusedFind());
    await type("cat");
    c.check("live count while typing", (await info()) === "– of 3", await info());
    const seen = [];
    for (let i = 0; i < 4; i++) { await key("Enter"); seen.push(`${await info()}@${await current()}`); }
    c.check("Enter steps through matches and wraps", seen.join(" | ") === "1 of 3@0:cat | 2 of 3@8:cat | 3 of 3@17:CAT | 1 of 3@0:cat", seen.join(" | "));
    await key("Enter", ["shift"]);
    c.check("Shift+Enter goes back (wrapping)", `${await info()}@${await current()}` === "3 of 3@17:CAT", `${await info()}@${await current()}`);
    c.check("focus stays in the find box", await focusedFind());
    await key("Enter"); // back to 1 of 3
    await c.js(`document.querySelectorAll(".nf-find-input")[1].focus()`);
    await type("cow");
    await c.js(`${R.button(".nf-find-btn", "Replace")}.click()`);
    await c.sleep(300);
    c.check("Replace swaps the current match only", (await c.js(R.editorText)) === "cow dog cat bird CAT fish", await c.js(R.editorText));
    c.check("then moves to the next match", `${await info()}@${await current()}` === "1 of 2@8:cat", `${await info()}@${await current()}`);
    await c.js(`document.querySelectorAll(".nf-find-input")[0].focus()`);
    await c.js(R.type(`document.querySelectorAll(".nf-find-input")[0]`, "zebra"));
    await c.sleep(200);
    c.check("no-match feedback", (await info()) === "No matches", await info());
    await key("Escape");
    c.check("Escape closes the bar and returns to the editor",
      !(await c.js(`!!document.querySelector(".nf-find-bar")`)) && (await c.js(`document.activeElement===document.querySelector(".nf-editor")`)));
    c.check("highlights cleared on close", await c.js(`!CSS.highlights.has("nf-find")`));
    const saved = await c.waitForData((d) => d.notebooks[0].sections[0].pages[0].content.includes("cow"));
    c.check("replacement saved", saved.notebooks[0].sections[0].pages[0].content === "<p>cow dog cat bird CAT fish</p>", saved.notebooks[0].sections[0].pages[0].content);
  },
};

SCENARIOS.printLayout = {
  seed: () => {
    const d = seedBase();
    d.notebooks[0].sections[0].pages[0].content =
      Array.from({ length: 120 }, (_, i) => `<p>Paragraph ${i + 1} of a long note.</p>`).join("");
    return d;
  },
  async run(c) {
    await c.waitFor(`document.querySelector(".nf-editor p")`);
    const pdf = (await c.win.webContents.printToPDF({})).toString("latin1");
    const pages = (pdf.match(/\/Type\s*\/Page(?!s)/g) || []).length;
    c.check("a long note prints across several pages", pages >= 3, `${pages} page(s)`);
    // Emulate print media to check what is hidden and the colours used
    const dbg = c.win.webContents.debugger;
    dbg.attach("1.3");
    await dbg.sendCommand("Emulation.setEmulatedMedia", { media: "print" });
    const hidden = await c.js(`[".nf-header",".nf-nav",".nf-pages",".nf-toolbar",".nf-status"].filter(s=>{const e=document.querySelector(s);return e&&getComputedStyle(e).display!=="none"})`);
    c.check("app chrome hidden when printing", hidden.length === 0, hidden.join(","));
    c.check("title still printed", await c.js(`getComputedStyle(document.querySelector(".nf-title-area")).display!=="none"`));
    c.check("printed on white with dark text even in dark theme", (await c.js(`(()=>{const e=document.querySelector(".nf-editor");const s=getComputedStyle(e);return s.backgroundColor+"/"+s.color})()`)) === "rgb(255, 255, 255)/rgb(17, 17, 17)",
      await c.js(`(()=>{const s=getComputedStyle(document.querySelector(".nf-editor"));return s.backgroundColor+"/"+s.color})()`));
    await dbg.sendCommand("Emulation.setEmulatedMedia", { media: "" });
    dbg.detach();
  },
};

SCENARIOS.fontSizes = {
  seed: () => {
    const d = seedBase();
    d.notebooks[0].sections[0].pages[0].content = "<p>plain text</p><p>sized text</p>";
    return d;
  },
  async run(c) {
    await c.waitFor(`document.querySelector(".nf-editor p")`);
    const sizeSelect = `document.querySelectorAll(".nf-toolbar select")[1]`;
    const caretIn = (text) => c.js(`(()=>{const p=[...document.querySelectorAll(".nf-editor p")].find(e=>e.textContent===${JSON.stringify(text)});
      const r=document.createRange();r.selectNodeContents(p.querySelector("font")||p);const s=getSelection();s.removeAllRanges();s.addRange(r);document.querySelector(".nf-editor").focus()})()`);
    const shown = async () => { await c.sleep(150); return c.js(`${sizeSelect}.options[${sizeSelect}.selectedIndex].text`); };
    await caretIn("plain text");
    c.check("plain 14px text shows 14px", (await shown()) === "14px", await shown());
    const rows = [];
    for (const v of ["1", "2", "3", "4", "5", "6", "7"]) {
      await caretIn("sized text");
      await c.js(`(()=>{const s=${sizeSelect};Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s,"${v}");s.dispatchEvent(new Event("change",{bubbles:true}))})()`);
      await c.sleep(150);
      const label = await c.js(`[...${sizeSelect}.options].find(o=>o.value==="${v}").text`);
      const actual = await c.js(`getComputedStyle([...document.querySelectorAll(".nf-editor p")].find(e=>e.textContent==="sized text").querySelector("font")).fontSize`);
      await caretIn("sized text");
      rows.push(`${label}=${actual}/${await shown()}`);
    }
    c.check("each size renders at its label and reads back the same",
      rows.join(" ") === "10px=10px/10px 12px=12px/12px 14px=14px/14px 16px=16px/16px 18px=18px/18px 24px=24px/24px 32px=32px/32px", rows.join(" "));
    c.menu("zoom-in"); c.menu("zoom-in"); // 120%
    await c.sleep(300);
    await caretIn("sized text");
    c.check("sized text scales with zoom and still reads 32px",
      (await c.js(`getComputedStyle(document.querySelector(".nf-editor font")).fontSize`)) === "38.4px" && (await shown()) === "32px",
      (await c.js(`getComputedStyle(document.querySelector(".nf-editor font")).fontSize`)) + " / " + (await shown()));
  },
};

SCENARIOS.listButtons = {
  seed: () => {
    const d = seedBase();
    d.notebooks[0].sections[0].pages[0].content = "<p>first line here</p><p>second</p>";
    return d;
  },
  async run(c) {
    const html = () => c.js(`document.querySelector(".nf-editor").innerHTML`);
    const caretEnd = (text) => c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.focus();const w=document.createTreeWalker(ed,NodeFilter.SHOW_TEXT);
      while(w.nextNode()){const n=w.currentNode;if(n.textContent.includes(${JSON.stringify(text)})){getSelection().collapse(n,n.textContent.length);return}}})()`);
    const typeChar = async (ch) => { c.win.webContents.sendInputEvent({ type: "char", keyCode: ch }); await c.sleep(150); };
    const tb = (title) => `document.querySelector('.nf-toolbar button[title=${JSON.stringify(title)}]')`;
    await c.waitFor(`document.querySelector(".nf-editor p")`);

    const clean = "<ul><li>first line hereX</li></ul><ol><li>secondY</li></ol>";
    await caretEnd("first line here");
    await realClick(c, tb("Bullet List"));
    await typeChar("X");
    c.check("bullet list: caret stays at the end of the line", /<li>first line hereX<\/li>/.test(await html()), await html());
    await caretEnd("second");
    await realClick(c, tb("Numbered List"));
    await typeChar("Y");
    c.check("numbered list: same", /<li>secondY<\/li>/.test(await html()), await html());
    const saved = (await c.waitForData((d) => d.notebooks[0].sections[0].pages[0].content.includes("secondY"))).notebooks[0].sections[0].pages[0].content;
    c.check("saved without the <p><ul> nesting", saved === clean, saved);
    const trash = `[...document.querySelectorAll(".nf-add-btn")].find(e=>e.textContent.startsWith("Trash"))`;
    await c.js(`${trash}.click()`); await c.sleep(200); await c.js(`${trash}.click()`); await c.sleep(300);
    c.check("reloads without stray empty paragraphs", (await html()) === clean, await html());
    await caretEnd("secondY");
    await realClick(c, tb("Numbered List"));
    await typeChar("Z");
    c.check("clicking again turns the item back into text, caret kept", /secondYZ/.test(await html()) && !/<ol>/.test(await html()), await html());
  },
};

SCENARIOS.listButtonUndo = {
  seed: () => {
    const d = seedBase();
    d.notebooks[0].sections[0].pages[0].content = "<p>first line here</p><p>second</p>";
    return d;
  },
  async run(c) {
    const html = () => c.js(`document.querySelector(".nf-editor").innerHTML`);
    await c.waitFor(`document.querySelector(".nf-editor p")`);
    await c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.focus();const t=ed.querySelector("p").firstChild;getSelection().collapse(t,t.textContent.length)})()`);
    await realClick(c, `document.querySelector('.nf-toolbar button[title="Bullet List"]')`);
    c.win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Z", modifiers: ["control"] });
    c.win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Z", modifiers: ["control"] });
    await c.sleep(300);
    c.check("Ctrl+Z after a list button keeps the text and removes the list", (await html()).includes("first line here") && !(await html()).includes("<li>"), await html());
    c.check("no text lost or duplicated", (await c.js(R.editorText)).replace(/\s+/g, " ").trim() === "first line here second", await c.js(R.editorText));
  },
};

SCENARIOS.searchEntities = {
  seed: () => {
    const d = seedBase();
    d.notebooks[0].sections[0].pages.push(page("pg-c", "Cartoons", "<p>Tom &amp; Jerry &lt;3</p>"));
    return d;
  },
  async run(c) {
    const box = `document.querySelector('input[placeholder="Search all notes…"]')`;
    await c.waitFor(box);
    await c.js(`${box}.focus()`);
    // Polls: the list is debounced, and shows only while the box has focus (which a
    // desktop in use can take away mid-run)
    const results = async (q, want) => {
      const list = `[...document.querySelectorAll(".nf-gsearch-item")].map(e=>e.querySelector("div").textContent).join(",")`;
      await c.js(`${box}.focus()`);
      await c.js(R.type(box, q));
      const t0 = Date.now();
      let got;
      do { await c.sleep(150); got = await c.js(list); } while (got !== want && Date.now() - t0 < 2000);
      return got;
    };
    let r;
    c.check('finds "Tom & Jerry"', (r = await results("Tom & Jerry", "Cartoons")) === "Cartoons", r);
    c.check('finds "<3"', (r = await results("<3", "Cartoons")) === "Cartoons", r);
    await results("amp", "");
    await c.sleep(500); // and stays empty
    c.check('no false match on "amp"', (r = await c.js(`[...document.querySelectorAll(".nf-gsearch-item")].length`)) === 0, r);
  },
};

SCENARIOS.tableTab = {
  seed: () => {
    const d = seedBase();
    d.notebooks[0].sections[0].pages[0].content = "<p>above</p>";
    return d;
  },
  async run(c) {
    const key = async (keyCode, modifiers = []) => {
      c.win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      c.win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
      await c.sleep(150);
    };
    const type = async (t) => { for (const ch of t) c.win.webContents.sendInputEvent({ type: "char", keyCode: ch }); await c.sleep(200); };
    const cells = () => c.js(`[...document.querySelectorAll(".nf-editor td")].map(td=>td.textContent).join("|")`);
    await c.waitFor(`document.querySelector(".nf-editor p")`);
    await c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.focus();const t=ed.querySelector("p").firstChild;getSelection().collapse(t,t.textContent.length)})()`);
    await realClick(c, `document.querySelector('.nf-toolbar button[title="Table"]')`);
    await c.js(`(()=>{const td=document.querySelector(".nf-editor td");getSelection().selectAllChildren(td);getSelection().collapseToStart()})()`);
    await type("A1"); await key("Tab"); await type("B1"); await key("Tab"); await type("C1"); await key("Tab"); await type("A2");
    c.check("Tab moves to the next cell (and wraps to the next row)", (await cells()) === "A1|B1|C1|A2|||||", await cells());
    c.check("focus stays in the editor", await c.js(`document.activeElement===document.querySelector(".nf-editor")`));
    await key("Tab", ["shift"]); await type("!");
    c.check("Shift+Tab moves back a cell", (await cells()) === "A1|B1|C1!|A2|||||", await cells());
    await c.js(`(()=>{const tds=document.querySelectorAll(".nf-editor td");getSelection().selectAllChildren(tds[tds.length-1]);getSelection().collapseToEnd()})()`);
    await key("Tab"); await type("Z");
    c.check("Tab in the last cell stays in it", (await cells()) === "A1|B1|C1!|A2|||||Z", await cells());
    const saved = (await c.waitForData((d) => d.notebooks[0].sections[0].pages[0].content.includes(">Z<"))).notebooks[0].sections[0].pages[0].content;
    c.check("cells saved without leading spaces", /<td>A1<\/td>/.test(saved) && !/&nbsp;A1/.test(saved), saved.slice(0, 120));
  },
};

SCENARIOS.exitCodeAndQuote = {
  seed: () => {
    const d = seedBase();
    d.notebooks[0].sections[0].pages[0].content = "<p>intro</p>";
    return d;
  },
  async run(c) {
    const key = async (keyCode, modifiers = []) => {
      c.win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      if (keyCode === "Enter") c.win.webContents.sendInputEvent({ type: "char", keyCode: "\r", modifiers });
      c.win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
      await c.sleep(150);
    };
    const type = async (t) => { for (const ch of t) c.win.webContents.sendInputEvent({ type: "char", keyCode: ch }); await c.sleep(200); };
    const html = () => c.js(`document.querySelector(".nf-editor").innerHTML`);
    const setup = async (content) => {
      await c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.innerHTML=${JSON.stringify(content)};ed.focus();
        const b=ed.querySelector("pre,blockquote");const s=getSelection();s.selectAllChildren(b);s.collapseToEnd()})()`);
    };
    await c.waitFor(`document.querySelector(".nf-editor p")`);

    await setup("<pre>const x = 1;</pre>");
    await key("Enter"); await type("y();");
    c.check("Enter in a code block adds a line inside it", /<pre>const x = 1;<br>y\(\);/.test(await html()), await html());
    await key("Enter"); await key("Enter"); await type("after");
    c.check("Enter on the empty last line leaves the code block",
      /<\/pre><p>after<\/p>$/.test(await html()) && !(await c.js(`document.querySelector(".nf-editor pre").textContent.includes("after")`)), await html());

    await setup("<pre>one</pre><p>next para</p>");
    await key("Enter"); await key("Enter"); await type("between");
    c.check("…also when content follows the block", /<\/pre><p>between<\/p><p>next para<\/p>$/.test(await html()), await html());
    c.win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Z", modifiers: ["control"] });
    c.win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Z", modifiers: ["control"] });
    await c.sleep(200);
    c.check("undo still works afterwards (no text lost)", (await c.js(R.editorText)).includes("one") && (await c.js(R.editorText)).includes("next para"), await html());

    await setup("<blockquote>quoted</blockquote>");
    await key("Enter"); await type("more");
    await key("Enter"); await key("Enter"); await type("out");
    c.check("Enter on an empty quote line leaves the quote", /<blockquote>more<\/blockquote><p>out<\/p>$/.test(await html()), await html());

    await setup("<pre>keep</pre>");
    await key("Enter", ["shift"]); await key("Enter", ["shift"]); await type("z");
    c.check("Shift+Enter still just adds lines inside the block", /<pre>keep(<br>)+z<\/pre>/.test(await html()), await html());
  },
};

SCENARIOS.checklistEditing = {
  seed: () => {
    const d = seedBase();
    d.notebooks[0].sections[0].pages[0].content = "<p>tasks</p>";
    return d;
  },
  async run(c) {
    const key = async (keyCode, modifiers = []) => {
      c.win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      if (keyCode === "Enter") c.win.webContents.sendInputEvent({ type: "char", keyCode: "\r", modifiers });
      c.win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
      await c.sleep(200);
    };
    const type = async (t) => { for (const ch of t) c.win.webContents.sendInputEvent({ type: "char", keyCode: ch }); await c.sleep(250); };
    const items = () => c.js(`[...document.querySelectorAll(".nf-editor .nf-check")].filter(d=>d.querySelector("input")).map(d=>d.querySelectorAll("input").length+":"+[...d.querySelectorAll("label")].map(l=>l.textContent).join("+")).join(" | ")`);
    await c.waitFor(`document.querySelector(".nf-editor p")`);
    await c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.focus();const t=ed.querySelector("p").firstChild;getSelection().collapse(t,t.textContent.length)})()`);
    await key("Enter");
    await realClick(c, `document.querySelector('.nf-toolbar button[title="Checklist"]')`);
    await type("milk");
    c.check("typing replaces the 'To-do item' placeholder", (await items()) === "1:milk", await items());
    await key("Enter"); await type("eggs");
    c.check("Enter starts a new to-do item", (await items()) === "1:milk | 1:eggs", await items());
    await key("Enter"); await key("Enter"); await type("done");
    c.check("Enter on an empty to-do returns to normal text", (await items()) === "1:milk | 1:eggs" && /<\/div>(<div class="nf-check"><\/div>)?<p>done<\/p>$/.test(await c.js(`document.querySelector(".nf-editor").innerHTML`)),
      (await items()) + " :: " + (await c.js(`document.querySelector(".nf-editor").innerHTML`)).slice(-80));
    const savedTodo = (await c.waitForData((d) => d.notebooks[0].sections[0].pages[0].content.includes("done"))).notebooks[0].sections[0].pages[0].content;
    c.check("saved without the leftover empty to-do wrapper", !/<div class="nf-check"><\/div>/.test(savedTodo) && /eggs<\/label><\/div><p>done<\/p>$/.test(savedTodo), savedTodo.slice(-120));
    for (let i = 0; i < 3; i++) {
      c.win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Z", modifiers: ["control"] });
      c.win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Z", modifiers: ["control"] });
      await c.sleep(150);
    }
    // 3 undos: the typing, the exit, the delete; every item keeps exactly one checkbox
    c.check("undo steps back without mangling the items", /^1:milk \| 1:eggs( \| 1:)?$/.test(await items()), await items());
    for (let i = 0; i < 3; i++) {
      c.win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Y", modifiers: ["control"] });
      c.win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Y", modifiers: ["control"] });
      await c.sleep(150);
    }
    const labels = `document.querySelectorAll(".nf-editor .nf-check label")`;
    await realClick(c, `${labels}[0]`);
    c.check("clicking a to-do's text doesn't toggle it", !(await c.js(`document.querySelectorAll(".nf-editor .nf-check input")[0].checked`)));
    await realClick(c, `document.querySelectorAll(".nf-editor .nf-check input")[1]`);
    c.check("clicking the box still toggles", await c.js(`document.querySelectorAll(".nf-editor .nf-check input")[1].checked`));
  },
};

SCENARIOS.highlightContrast = {
  seed: () => {
    const d = seedBase();
    d.notebooks[0].sections[0].pages[0].content =
      '<p><span style="background-color: rgb(254, 240, 138);">yellow</span> <span style="background-color: transparent;">cleared</span> plain</p>';
    return d;
  },
  async run(c) {
    await c.waitFor(`document.querySelector(".nf-editor span")`);
    const col = (i) => c.js(`getComputedStyle(document.querySelectorAll(".nf-editor span")[${i}]).color`);
    const plain = () => c.js(`getComputedStyle(document.querySelector(".nf-editor p")).color`);
    c.check("dark theme: highlighted text is dark", (await col(0)) === "rgb(26, 26, 26)", await col(0));
    c.check("dark theme: 'no highlight' text stays light", (await col(1)) === (await plain()), `${await col(1)} vs ${await plain()}`);
    c.menu("toggle-theme"); await c.sleep(300);
    c.check("light theme unchanged", (await col(0)) === (await plain()), `${await col(0)} vs ${await plain()}`);
  },
};

SCENARIOS.changePasswordStep1 = {
  seed: seedBase,
  async run(c) {
    await c.waitFor(`document.querySelector(".nf-editor")`);
    await c.js(`window.electronAPI.enableEncryption("Master!Passw0rd-e2e","")`);
    c.win.webContents.reload(); await c.sleep(500);
    await c.waitFor(`document.querySelector(".nf-overlay-input")`);
    await c.js(R.type(`document.querySelector(".nf-overlay-input")`, "Master!Passw0rd-e2e"));
    await c.js(`${R.button(".nf-overlay-btn", "Unlock")}.click()`);
    await c.waitFor(`document.querySelector(".nf-editor")`);
    c.menu("encryption-settings");
    await c.waitFor(R.button(".nf-overlay-btn", "Change Password"));
    await c.js(`${R.button(".nf-overlay-btn", "Change Password")}.click()`);
    await c.waitFor(`document.querySelector(".nf-overlay-input")`);
    await c.js(R.type(`document.querySelector(".nf-overlay-input")`, "not-my-password"));
    await c.js(`${R.button(".nf-overlay-btn", "Next")}.click()`);
    await c.sleep(600);
    const title = () => c.js(`document.querySelector(".nf-overlay-title").textContent`);
    c.check("wrong current password stops at step 1", (await title()).includes("Step 1"), await title());
    c.check("…with an error", (await c.js(`document.querySelector(".nf-overlay-error")?.textContent||""`)) === "Wrong current password");
    await c.js(R.type(`document.querySelector(".nf-overlay-input")`, "Master!Passw0rd-e2e"));
    await c.js(`${R.button(".nf-overlay-btn", "Next")}.click()`);
    await c.waitFor(`document.querySelector(".nf-overlay-title")?.textContent.includes("Step 2")`);
    c.check("right current password goes to step 2", true);
  },
};

SCENARIOS.toolbarSelectsFit = {
  seed: seedBase,
  async run(c) {
    await c.waitFor(`document.querySelector(".nf-toolbar select")`);
    // Text width of the longest option vs the space left after padding and the arrow
    const fit = await c.js(`[...document.querySelectorAll(".nf-toolbar select")].map(s=>{
      const cs=getComputedStyle(s);const ctx=document.createElement("canvas").getContext("2d");ctx.font=cs.font;
      const widest=Math.max(...[...s.options].map(o=>ctx.measureText(o.text).width));
      const room=s.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)-16;
      return {widest:Math.round(widest),room:Math.round(room)}})`);
    c.check("heading select fits 'Normal'", fit[0].widest <= fit[0].room, JSON.stringify(fit[0]));
    c.check("size select fits its labels", fit[1].widest <= fit[1].room, JSON.stringify(fit[1]));
  },
};

SCENARIOS.escapeCloses = {
  seed: seedBase,
  async run(c) {
    const esc = async () => {
      c.win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      c.win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await c.sleep(250);
    };
    const title = () => c.js(`document.querySelector(".nf-overlay-title")?.textContent||null`);
    await c.waitFor(`document.querySelector(".nf-editor")`);
    c.menu("encryption-settings");
    await c.waitFor(`document.querySelector(".nf-overlay-title")`);
    await c.js(`${R.button(".nf-overlay-btn", "Enable Encryption")}.click()`);
    await c.waitFor(`document.querySelector(".nf-overlay-title")?.textContent==="Enable Encryption"`);
    await esc();
    c.check("Escape in a password dialog = Cancel (back to Settings)", (await title()) === "Settings", await title());
    await esc();
    c.check("Escape closes Settings", (await title()) === null, await title());
    await c.js(R.rightClick(`document.querySelector(".nf-pg")`, 400, 200)); await c.sleep(200);
    await esc();
    c.check("Escape closes the page context menu", !(await c.js(`!!document.querySelector(".nf-ctx")`)));
    await c.js(R.rightClick(`document.querySelector(".nf-editor p")`, 700, 300)); await c.sleep(200);
    await esc();
    c.check("Escape closes the editor context menu", !(await c.js(`!!document.querySelector(".nf-ctx")`)));
    const box = `document.querySelector('input[placeholder="Search all notes…"]')`;
    await c.js(`${box}.focus()`); await c.js(R.type(box, "alpha")); await c.sleep(300);
    await esc();
    c.check("Escape clears the search box", (await c.js(`${box}.value`)) === "" && !(await c.js(`!!document.querySelector(".nf-gsearch-dropdown")`)));
  },
};

SCENARIOS.newPageInEmptyNotebook = {
  seed: () => {
    const d = seedLocked();
    d.notebooks.push({ id: "nb-e", name: "Empty", color: "#3b82f6", sections: [] });
    return d;
  },
  async run(c) {
    await c.waitFor(R.nb("Empty"));
    await c.js(`${R.nb("Empty")}.click()`); await c.sleep(200);
    c.menu("new-page"); await c.sleep(400);
    const d = await c.waitForData((d) => d.notebooks.find((n) => n.id === "nb-e").sections.length === 1);
    const nb = d.notebooks.find((n) => n.id === "nb-e");
    c.check("Ctrl+N in an empty notebook creates a section with a page",
      nb.sections.length === 1 && nb.sections[0].pages.length === 1, JSON.stringify(nb.sections.map((s) => [s.name, s.pages.length])));
    c.check("the new page is open with its name ready to edit",
      (await c.js(`document.querySelector(".nf-title-input")?.value`)) === "New Page" && (await c.js(`!!document.querySelector(".nf-rename")`)));
    await c.js(`${R.nb("Locked")}.click()`); await c.sleep(200);
    await c.js(`${R.button(".nf-overlay-btn", "Cancel")}.click()`); await c.sleep(200);
    c.menu("new-page"); await c.sleep(400);
    c.check("still-locked notebook: no section added",
      c.readData().notebooks.find((n) => n.id === "nb-l").sections.length === 0 && !!c.readData().notebooks.find((n) => n.id === "nb-l").encSections);
  },
};

SCENARIOS.passwordStrengthLive = {
  seed: seedBase,
  async run(c) {
    await c.waitFor(`document.querySelector(".nf-editor")`);
    c.menu("encryption-settings");
    await c.waitFor(R.button(".nf-overlay-btn", "Enable Encryption"));
    await c.js(`${R.button(".nf-overlay-btn", "Enable Encryption")}.click()`);
    await c.waitFor(`document.querySelectorAll(".nf-overlay-input").length>=2`);
    const fill = async (pw) => {
      await c.js(R.type(`document.querySelectorAll(".nf-overlay-input")[0]`, pw));
      await c.js(R.type(`document.querySelectorAll(".nf-overlay-input")[1]`, pw));
      await c.sleep(500);
    };
    const state = () => c.js(`({ready:document.querySelector(".nf-overlay-card").innerText.includes("Ready to encrypt"),
      disabled:${R.button(".nf-overlay-btn", "Encrypt")}.disabled,
      text:document.querySelector(".nf-overlay-card").innerText.replace(/\\s+/g," ")})`);
    await fill("Sunshine2024!");
    await c.waitFor(`/common word/.test(document.querySelector(".nf-overlay-card").innerText)`, 4000).catch(() => {});
    let s = await state();
    c.check("common word + suffix: shown as not OK before submitting", !s.ready && s.disabled && /common word/.test(s.text), s.text.slice(0, 200));
    await fill("Correct-Horse-42");
    // The policy check is debounced and goes over IPC; poll rather than trust a fixed sleep
    await c.waitFor(`document.querySelector(".nf-overlay-card").innerText.includes("Ready to encrypt")`, 4000).catch(() => {});
    s = await state();
    c.check("strong password: ready and enabled", s.ready && !s.disabled, s.text.slice(0, 200));
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

// Restoring your own backup while a protected notebook is unlocked: every id matches,
// so session state left over from before the restore made it look unlocked and empty.
SCENARIOS.restoreResetsUnlockedNotebooks = {
  messageBoxResponse: 0,
  seed: seedLocked,
  openDialog: (tmp) => {
    const file = require("path").join(tmp, "own-backup.enc");
    require("fs").writeFileSync(file, encryptBlob(JSON.stringify(seedLocked()), BACKUP_PW));
    return { canceled: false, filePaths: [file] };
  },
  async run(c) {
    await c.waitFor(R.nb("Locked"));
    await unlockNotebook(c, "Locked");
    c.menu("restore-backup");
    await c.waitFor(`document.querySelector(".nf-overlay-title")?.textContent==="Verify Backup Password"`);
    await c.js(R.type(`document.querySelector(".nf-overlay-input")`, BACKUP_PW));
    await c.js(`${R.button(".nf-overlay-btn", "Restore Backup")}.click()`);
    await c.waitFor(`document.querySelector(".nf-modal h3")?.textContent==="Restore complete"`);
    await c.js(`${R.button(".nf-modal-btn", "OK")}.click()`);
    await c.waitFor(`document.querySelector(".nf-overlay-title")?.textContent==="Unlock NoteForge"`);
    await c.js(R.type(`document.querySelector(".nf-overlay-input")`, BACKUP_PW));
    await c.js(`${R.button(".nf-overlay-btn", "Unlock")}.click()`);
    await c.waitFor(R.nb("Locked"));
    await c.js(R.rightClick(R.nb("Locked")));
    await c.sleep(200);
    const items = await c.js(`[...document.querySelectorAll(".nf-ctx-item")].map(e=>e.textContent.trim())`);
    c.check("restored protected notebook offers no Remove Password", !items.some((t) => t.includes("Remove Password")), items.join(", "));
    await c.js(`document.body.click()`);
    await c.sleep(200);
    await c.js(`${R.nb("Locked")}.click()`);
    await c.sleep(400);
    c.check("restored protected notebook asks for its password", await c.js(`!!document.querySelector(".nf-overlay-input")`));
  },
};

// A dialog left open when the app locks must not act after the unlock: it held the
// pre-lock data, plaintext of the notebooks unlocked then included.
SCENARIOS.lockClosesDialogs = {
  seed: seedLocked,
  async run(c) {
    const MPW = "Master!Passw0rd-e2e";
    const unlockMaster = async () => {
      await c.waitFor(`document.querySelector(".nf-overlay-input")`);
      await c.js(R.type(`document.querySelector(".nf-overlay-input")`, MPW));
      await c.js(`${R.button(".nf-overlay-btn", "Unlock")}.click()`);
      await c.waitFor(R.nb("Locked"));
    };
    await c.waitFor(R.nb("Locked"));
    await c.js(`window.electronAPI.enableEncryption(${JSON.stringify(MPW)},"")`);
    c.win.webContents.reload();
    await c.sleep(500);
    await unlockMaster();
    await unlockNotebook(c, "Locked");
    const sec = `[...document.querySelectorAll(".nf-sec")].find(e=>e.textContent.includes("Secret"))`;
    await c.js(R.rightClick(sec));
    await c.sleep(200);
    await c.js(`${R.ctxItem("Delete Section")}.click()`);
    await c.waitFor(`document.querySelector(".nf-modal")`);
    c.menu("lock-app");
    await unlockMaster();
    await c.sleep(300);
    c.check("no dialog left open after the unlock", !(await c.js(`!!document.querySelector(".nf-modal")`)));
    c.check("protected notebook's pages not shown without its password", !(await c.js(`document.body.innerText.includes("Secret")`)));
    await unlockNotebook(c, "Locked");
    c.check("section still there", await c.js(`!!${sec}`));
  },
};

// First run (no data yet): offer a master password, once, with Skip
SCENARIOS.firstRunSkip = {
  async run(c) {
    const fs = require("fs");
    await c.waitFor(`document.querySelector(".nf-overlay-title")?.textContent==="Protect your notes?"`);
    c.check("first run offers a master password", true);
    await c.js(`${R.button(".nf-overlay-btn", "Skip")}.click()`);
    await c.waitFor(`document.querySelector(".nf-editor")`);
    c.check("Skip opens the app unencrypted", !fs.existsSync(c.file("noteforge-data.enc")));
    c.win.webContents.reload();
    await c.sleep(1500);
    c.check("asked only once", !(await c.js(`document.querySelector(".nf-overlay-title")?.textContent==="Protect your notes?"`)) &&
      (await c.js(`!!document.querySelector(".nf-editor")`)));
  },
};
SCENARIOS.firstRunEncrypt = {
  async run(c) {
    const fs = require("fs");
    const MPW = "Master!Passw0rd-e2e";
    await c.waitFor(`document.querySelector(".nf-overlay-title")?.textContent==="Protect your notes?"`);
    await c.js(R.type(`document.querySelectorAll(".nf-overlay-input")[0]`, MPW));
    await c.js(R.type(`document.querySelectorAll(".nf-overlay-input")[1]`, MPW));
    await c.waitFor(`!${R.button(".nf-overlay-btn", "Encrypt")}.disabled`, 4000).catch(() => {});
    await c.js(`${R.button(".nf-overlay-btn", "Encrypt")}.click()`);
    await c.waitFor(`document.querySelector(".nf-editor")`);
    c.check("encrypted from the first run", fs.existsSync(c.file("noteforge-data.enc")) && !fs.existsSync(c.file("noteforge-data.json")));
    await c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.innerHTML="<p>first note</p>";ed.dispatchEvent(new Event("input",{bubbles:true}))})()`);
    await c.sleep(1200);
    c.check("notes saved encrypted, no plaintext file", !fs.existsSync(c.file("noteforge-data.json")) && !fs.readFileSync(c.file("noteforge-data.enc"), "utf-8").includes("first note"));
    c.win.webContents.reload();
    await c.waitFor(`document.querySelector(".nf-overlay-title")?.textContent==="Unlock NoteForge"`);
    c.check("next launch asks for the master password", true);
  },
};

// A damaged vault: the lock screen says so (not "Wrong password") and offers Restore,
// which used to be unreachable while locked.
SCENARIOS.damagedVaultOffersRestore = {
  messageBoxResponse: 0, // "Choose Backup…"
  seed: seedBase,
  openDialog: (tmp) => {
    const file = require("path").join(tmp, "noteforge-data.prev-1.enc");
    require("fs").writeFileSync(file, encryptBlob(JSON.stringify(seedBase()), BACKUP_PW));
    return { canceled: false, filePaths: [file] };
  },
  async run(c) {
    const fs = require("fs");
    await c.waitFor(`document.querySelector(".nf-editor")`);
    await c.js(`window.electronAPI.enableEncryption(${JSON.stringify(BACKUP_PW)},"")`);
    const enc = fs.readFileSync(c.file("noteforge-data.enc"), "utf-8");
    fs.writeFileSync(c.file("noteforge-data.enc"), enc.slice(0, 200)); // truncated
    c.win.webContents.reload();
    await c.waitFor(`document.querySelector(".nf-overlay-title")?.textContent==="Unlock NoteForge"`);
    await c.js(R.type(`document.querySelector(".nf-overlay-input")`, BACKUP_PW));
    await c.js(`${R.button(".nf-overlay-btn", "Unlock")}.click()`);
    await c.waitFor(`document.querySelector(".nf-overlay-error")`);
    const err = await c.js(`document.querySelector(".nf-overlay-error").textContent`);
    c.check("lock screen says the file is damaged", /damaged/.test(err) && !/Wrong password/.test(err), err);
    c.check("Restore from Backup offered", await c.js(`!!${R.button(".nf-overlay-btn", "Restore from Backup…")}`));
    await c.js(`${R.button(".nf-overlay-btn", "Restore from Backup…")}.click()`);
    await c.waitFor(`document.querySelector(".nf-overlay-title")?.textContent==="Verify Backup Password"`);
    await c.js(R.type(`document.querySelector(".nf-overlay-input")`, BACKUP_PW));
    await c.js(`${R.button(".nf-overlay-btn", "Restore Backup")}.click()`);
    await c.waitFor(`document.querySelector(".nf-modal h3")?.textContent==="Restore complete"`);
    c.check("restore completes from the lock screen", true);
    await c.js(`${R.button(".nf-modal-btn", "OK")}.click()`);
    await c.waitFor(`document.querySelector(".nf-overlay-title")?.textContent==="Unlock NoteForge"`);
    c.check("no Restore button once the vault is fine", !(await c.js(`!!${R.button(".nf-overlay-btn", "Restore from Backup…")}`)));
    await c.js(R.type(`document.querySelector(".nf-overlay-input")`, BACKUP_PW));
    await c.js(`${R.button(".nf-overlay-btn", "Unlock")}.click()`);
    await c.waitFor(`${R.editorText}.includes("alpha body")`);
    c.check("restored notes open", true);
  },
};

// An image paste is processed asynchronously. Switching page before it finished
// inserted the image into the new page and saved that page's content over the old one.
SCENARIOS.latePasteKeepsPages = {
  seed: () => {
    const d = seedBase();
    d.notebooks[0].sections[0].pages.push(page("pg-b", "Page B", "<p>bravo body</p>"));
    return d;
  },
  async run(c) {
    await c.waitFor(`${R.editorText}.includes("alpha body")`);
    // A noisy 800x800 PNG (~2.5 MB) is over 512 KB, so it goes through the canvas downscale
    await c.js(`(async()=>{
      const cv=document.createElement("canvas");cv.width=cv.height=800;const x=cv.getContext("2d");
      const im=x.createImageData(800,800);for(let i=0;i<im.data.length;i++)im.data[i]=(Math.random()*256)|0;x.putImageData(im,0,0);
      const blob=await new Promise(r=>cv.toBlob(r,"image/png"));
      window.__img=new File([blob],"big.png",{type:"image/png"});return window.__img.size})()`);
    await c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.focus();
      const dt=new DataTransfer();dt.items.add(window.__img);
      ed.dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:true,cancelable:true}));
      [...document.querySelectorAll(".nf-pg")].find(e=>e.textContent.includes("Page B")).click()})()`);
    await c.sleep(3000);
    const pages = c.readData().notebooks[0].sections[0].pages;
    const a = pages.find((p) => p.id === "pg-a").content, b = pages.find((p) => p.id === "pg-b").content;
    c.check("page A keeps its own content", a.includes("alpha body") && !a.includes("bravo"), a.slice(0, 120));
    c.check("page B keeps its own content", b.includes("bravo body"), b.slice(0, 120));
    c.check("the image didn't land on page B", !b.includes("<img"));
    c.check("user told the paste was dropped", await c.js(`document.querySelector(".nf-modal")?.innerText.includes("another page")||false`));
    await c.js(`${R.button(".nf-modal-btn", "OK")}.click()`);
    await c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.focus();
      const dt=new DataTransfer();dt.items.add(window.__img);
      ed.dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:true,cancelable:true}))})()`);
    const d = await c.waitForData((d) => d.notebooks[0].sections[0].pages.find((p) => p.id === "pg-b").content.includes("<img"), 6000);
    const b2 = d.notebooks[0].sections[0].pages.find((p) => p.id === "pg-b").content;
    c.check("a paste that stays on its page is inserted and saved", b2.includes("<img") && b2.includes("bravo body"), b2.slice(0, 80));
  },
};

// A save that can't be written (the file held by another program) shows as failed,
// stays pending and is written once the file is free; closing meanwhile still flushes it.
SCENARIOS.failedSaveIsRetried = {
  seed: seedBase,
  async run(c) {
    const fs = require("fs");
    await c.waitFor(`document.querySelector(".nf-editor")`);
    const realRename = fs.renameSync; // main.js shares this module
    fs.renameSync = () => { const e = new Error("EPERM: operation not permitted, rename"); e.code = "EPERM"; throw e; };
    const edit = (t) => c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.innerHTML="<p>${t}</p>";ed.dispatchEvent(new Event("input",{bubbles:true}))})()`);
    await edit("first edit");
    await c.waitFor(`document.body.innerText.includes("Save failed")`, 5000).catch(() => {});
    c.check("status shows Save failed", await c.js(`document.body.innerText.includes("Save failed")`));
    c.check("file untouched while the rename is refused", c.readData().notebooks[0].sections[0].pages[0].content.includes("alpha body"));
    fs.renameSync = realRename;
    const d = await c.waitForData((d) => d.notebooks[0].sections[0].pages[0].content.includes("first edit"), 8000);
    c.check("written by the retry once the file is free", d.notebooks[0].sections[0].pages[0].content.includes("first edit"));
    await c.waitFor(`document.body.innerText.includes("Saved")`, 3000).catch(() => {});
    c.check("status back to Saved", await c.js(`document.body.innerText.includes("Saved")&&!document.body.innerText.includes("Save failed")`));

    fs.renameSync = () => { const e = new Error("EPERM"); e.code = "EPERM"; throw e; };
    await edit("second edit");
    await c.sleep(2500); // the save fails; its retry is pending
    fs.renameSync = realRename;
    c.win.webContents.reload(); // the close flush
    await c.sleep(800);
    c.check("closing with a failed save pending still writes it", c.readData().notebooks[0].sections[0].pages[0].content.includes("second edit"));
  },
};

// The portable build keeps its data beside the exe, not in this PC's profile folder.
// Runs the app twice as the portable build (PORTABLE_EXECUTABLE_DIR set, as the
// portable launcher does), with this scenario's folder as the PC's profile folder.
SCENARIOS.portableDataBesideExe = {
  seed: seedBase,
  async run(c) {
    const { spawn } = require("child_process");
    const fs = require("fs"), path = require("path");
    await c.waitFor(`document.querySelector(".nf-editor")`);
    const usb = path.join(c.tmp, "usb");
    fs.mkdirSync(usb);
    const before = fs.readFileSync(c.file("noteforge-data.json"), "utf-8");
    const runPortable = async (scenario) => {
      const result = path.join(c.tmp, scenario + "-result.json");
      const proc = spawn(process.execPath, [__dirname], {
        env: { ...process.env, NF_SCENARIO: scenario, NF_USERDATA: c.tmp, NF_RESULT: result, PORTABLE_EXECUTABLE_DIR: usb },
        stdio: "ignore",
      });
      await new Promise((resolve) => { const t = setTimeout(() => { proc.kill(); resolve(); }, 45000); proc.on("exit", () => { clearTimeout(t); resolve(); }); });
      if (!fs.existsSync(result)) { c.check(`${scenario} ran`, false); return; }
      const out = JSON.parse(fs.readFileSync(result, "utf-8"));
      for (const k of out.checks) c.check(k.name, k.ok, k.detail);
      if (out.error || out.fatal) c.check(`${scenario}: ${out.error || out.fatal}`, false);
    };
    await runPortable("portableFirstRun");
    await runPortable("portableSecondRun");
    c.check("this PC's own notes left as they were", fs.readFileSync(c.file("noteforge-data.json"), "utf-8") === before);
    c.check("portable notes are beside the exe", fs.existsSync(path.join(usb, "NoteForge Data", "noteforge-data.json")));
  },
};
SCENARIOS.portableFirstRun = {
  helper: true, // started by portableDataBesideExe only
  messageBoxResponse: 0, // "Copy Them Here"
  async run(c) {
    const path = require("path");
    await c.waitFor(`${R.editorText}.includes("alpha body")`);
    c.check("portable: data folder beside the exe", require("electron").app.getPath("userData") === path.join(process.env.PORTABLE_EXECUTABLE_DIR, "NoteForge Data"));
    c.check("portable: offered to copy this PC's notes", c.dialogs.includes("NoteForge Portable"), c.dialogs.join(", "));
    c.check("portable: copied notes open", true);
    await c.js(`(()=>{const ed=document.querySelector(".nf-editor");ed.innerHTML="<p>portable edit</p>";ed.dispatchEvent(new Event("input",{bubbles:true}))})()`);
    await c.sleep(1200);
  },
};
SCENARIOS.portableSecondRun = {
  helper: true,
  async run(c) {
    await c.waitFor(`${R.editorText}.includes("portable edit")`);
    c.check("portable: its own edits on the next run", true);
    c.check("portable: asked only once", !c.dialogs.includes("NoteForge Portable"), c.dialogs.join(", "));
  },
};

// Two windows on one data folder each rewrite the whole vault from their own memory.
// Starts a second app process on this scenario's folder: it must quit without a window
// and hand over to the first.
SCENARIOS.singleInstance = {
  seed: seedBase,
  async run(c) {
    const { spawn } = require("child_process");
    const fs = require("fs"), path = require("path");
    await c.waitFor(`document.querySelector(".nf-editor")`);
    const { app } = require("electron");
    let handedOver = false;
    app.once("second-instance", () => { handedOver = true; });
    const result = path.join(c.tmp, "second-instance-result.json");
    const proc = spawn(process.execPath, [__dirname], {
      env: { ...process.env, NF_SCENARIO: "secondInstanceProbe", NF_USERDATA: c.tmp, NF_RESULT: result },
      stdio: "ignore",
    });
    const exited = await new Promise((resolve) => {
      const t = setTimeout(() => { proc.kill(); resolve(false); }, 20000);
      proc.on("exit", () => { clearTimeout(t); resolve(true); });
    });
    c.check("second instance exits on its own", exited);
    c.check("second instance never opened a window", !fs.existsSync(result),
      fs.existsSync(result) ? fs.readFileSync(result, "utf-8").slice(0, 200) : "");
    c.check("first instance is told (and focuses its window)", handedOver);
  },
};
SCENARIOS.secondInstanceProbe = {
  helper: true, // started by singleInstance only
  async run(c) { c.check("second instance opened a window", true); },
};

module.exports = { SCENARIOS, R, NB_PW, seedBase, seedLocked, unlockNotebook };
