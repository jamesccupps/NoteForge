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
    await c.sleep(1000);
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
    const results = async (q) => {
      await c.js(R.type(box, q));
      await c.sleep(400);
      return c.js(`[...document.querySelectorAll(".nf-gsearch-item")].map(e=>e.querySelector("div").textContent).join(",")`);
    };
    c.check('finds "Tom & Jerry"', (await results("Tom & Jerry")) === "Cartoons", await results("Tom & Jerry"));
    c.check('finds "<3"', (await results("<3")) === "Cartoons", await results("<3"));
    c.check('no false match on "amp"', (await results("amp")) === "", await results("amp"));
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
