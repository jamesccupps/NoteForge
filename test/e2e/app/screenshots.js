// Screenshots for the README and the website, from made-up sample notes (never real
// data): node test/e2e/run.js screenshots  ->  docs/screenshots/*.png
// Runs in the e2e harness, so it uses a throwaway data folder like the tests.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OUT = path.join(__dirname, "..", "..", "..", "docs", "screenshots");
const NB_PW = "Sample#Notebook-Pass1";
const T = Date.parse("2026-11-02T09:30:00");
const page = (id, title, content, h = 0) => ({ id, title, content, created: T - 86400000 * 9, modified: T - 3600000 * h, pinned: false, deleted: false });
const check = (id, text, on) => `<div class="nf-check"><input type="checkbox" id="${id}"${on ? " checked" : ""}><label for="${id}">${text}</label></div>`;

function encryptBlob(plaintext, password) {
  const salt = crypto.randomBytes(32), iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32, { N: 65536, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  let data = c.update(plaintext, "utf-8", "base64"); data += c.final("base64");
  return JSON.stringify({ v: 2, kdf: "scrypt", N: 65536, r: 8, p: 1, salt: salt.toString("hex"), iv: iv.toString("hex"), tag: c.getAuthTag().toString("hex"), data });
}

function sampleData() {
  const network = "<h2>Goals</h2><p>Replace the old switch, split the network into VLANs, and keep the cameras off the internet.</p>" +
    "<h2>Checklist</h2>" + check("c1", "Order the 24-port switch", true) + check("c2", "Label every cable in the rack", true) +
    check("c3", "Move the cameras to their own VLAN", false) + check("c4", "Back up the router config first", false) +
    "<h2>Address plan</h2><table><tr><th>VLAN</th><th>Name</th><th>Subnet</th></tr><tr><td>10</td><td>Trusted</td><td>10.0.10.0/24</td></tr>" +
    "<tr><td>20</td><td>Cameras</td><td>10.0.20.0/24</td></tr><tr><td>30</td><td>Guests</td><td>10.0.30.0/24</td></tr></table>" +
    "<h2>Notes</h2><p>Update the firmware before moving any ports. <span style=\"background-color: rgb(255, 235, 59);\">Don't reboot during the nightly backup.</span></p>" +
    "<pre>switch# show vlan brief\nswitch# copy running-config startup-config</pre>";
  const pasta = "<h2>Ingredients</h2><ul><li>300 g spaghetti</li><li>2 lemons, zest and juice</li><li>60 g parmesan, grated</li><li>A handful of basil</li><li>Olive oil, salt, black pepper</li></ul>" +
    "<h2>Method</h2><ol><li>Cook the pasta in well-salted water; keep a cup of the water.</li><li>Whisk the zest, juice, parmesan and a splash of oil.</li>" +
    "<li>Toss with the pasta, loosening with the pasta water.</li><li>Finish with basil and pepper.</li></ol>" +
    "<blockquote>Serves 3. Twenty minutes, start to finish.</blockquote>";
  const finance = [{ id: "sec-f", name: "Budget", color: "#e54545", pages: [page("pg-f", "2027 budget", "<p>Sample</p>")] }];
  return { notebooks: [
    { id: "nb-p", name: "Projects", color: "#7c6ef0", sections: [
      { id: "sec-lab", name: "Home lab", color: "#3b82f6", pages: [
        page("pg-net", "Network refresh", network, 1),
        page("pg-bak", "Backup schedule", "<p>Nightly to the NAS, weekly to the offsite drive.</p>", 30),
        page("pg-parts", "Parts to order", "<ul><li>Patch cables, 0.5 m</li><li>Rack shelf</li></ul>", 52)] },
      { id: "sec-gar", name: "Garden", color: "#1cb888", pages: [
        page("pg-spring", "Spring planting", "<p>Tomatoes, beans and squash along the south fence.</p>", 70),
        page("pg-water", "Watering", "<p>Drip line on a timer, 6 am.</p>", 90)] }] },
    { id: "nb-r", name: "Recipes", color: "#e8912d", sections: [
      { id: "sec-wk", name: "Weeknight", color: "#e8912d", pages: [
        page("pg-pasta", "Lemon pasta", pasta, 3),
        page("pg-chili", "Three-bean chili", "<p>Big pot, freezes well.</p>", 26)] }] },
    { id: "nb-f", name: "Finance", color: "#e54545", locked: true, sections: [], encSections: encryptBlob(JSON.stringify(finance), NB_PW) },
  ] };
}

// Clicks a row in the notebook / section / page lists by its text
const click = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>e.textContent.includes(${JSON.stringify(text)})).click()`;

async function shot(c, name, width, selector) {
  await c.sleep(600);
  // selector: capture just that element, with a margin
  const rect = selector ? await c.js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return {x:Math.max(0,Math.floor(r.x-32)),y:Math.max(0,Math.floor(r.y-32)),width:Math.ceil(r.width+64),height:Math.ceil(r.height+64)}})()`) : undefined;
  const img = await c.win.webContents.capturePage(rect);
  const out = width ? img.resize({ width, quality: "best" }) : img;
  fs.writeFileSync(path.join(OUT, name), out.toPNG());
  const { width: w, height: h } = out.getSize();
  c.check(`${name} (${w}x${h})`, true);
}

module.exports = {
  helper: true, // run on its own, not with the tests
  seed: sampleData,
  async run(c) {
    fs.mkdirSync(OUT, { recursive: true });
    c.win.setContentSize(1480, 900); // below about 1400 px the toolbar wraps
    c.win.center();
    await c.waitFor(`document.querySelector(".nf-editor")`);
    // Dark: the home-lab note
    await c.js(click(".nf-sec", "Home lab"));
    await c.js(click(".nf-pg", "Network refresh"));
    await c.waitFor(`document.querySelector(".nf-editor table")`);
    await c.js(`document.activeElement?.blur()`);
    await shot(c, "noteforge-dark.png", 1600);
    // A protected notebook asking for its password
    await c.js(click(".nf-nb", "Finance"));
    await c.waitFor(`document.querySelector(".nf-overlay-input")`);
    await shot(c, "noteforge-notebook-lock.png", 0, ".nf-overlay-card");
    // Light: a recipe
    await c.js(`localStorage.setItem("noteforge-prefs",JSON.stringify({...JSON.parse(localStorage.getItem("noteforge-prefs")||"{}"),dark:false}))`);
    c.win.webContents.reload();
    await c.waitFor(`document.querySelector(".nf-editor")`);
    await c.js(click(".nf-nb", "Recipes"));
    await c.sleep(300);
    await c.js(click(".nf-pg", "Lemon pasta"));
    await c.waitFor(`document.querySelector(".nf-editor ol")`);
    await c.js(`document.activeElement?.blur()`);
    await shot(c, "noteforge-light.png", 1600);
    // Back to dark for the next run, then the 1280x640 social preview card
    await c.js(`localStorage.setItem("noteforge-prefs",JSON.stringify({...JSON.parse(localStorage.getItem("noteforge-prefs")||"{}"),dark:true}))`);
    await socialPreview(c);
  },
};

async function socialPreview(c) {
  const { BrowserWindow } = require("electron");
  const shotB64 = fs.readFileSync(path.join(OUT, "noteforge-dark.png")).toString("base64");
  const iconB64 = fs.readFileSync(path.join(__dirname, "..", "..", "..", "assets", "icon.png")).toString("base64");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:1280px;height:640px;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif}
    body{background:linear-gradient(150deg,#2a2550 0%,#14141c 60%);color:#fff;position:relative}
    .t{position:absolute;left:72px;top:96px;width:520px}
    .b{display:flex;align-items:center;gap:20px}.b img{width:88px;height:88px}
    h1{margin:0;font-size:68px;font-weight:600;letter-spacing:-1px}
    p{font-size:30px;line-height:1.35;margin:34px 0 0;color:#d8d6f5}
    small{display:block;margin-top:26px;font-size:21px;color:#a6a3cc}
    .s{position:absolute;left:640px;top:70px;width:900px;border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.6)}
  </style></head><body><div class="t"><div class="b"><img src="data:image/png;base64,${iconB64}"><h1>NoteForge</h1></div>
    <p>Encrypted, offline notes for Windows.</p><small>AES-256-GCM · notebook passwords · no account, no cloud · open source</small></div>
    <img class="s" src="data:image/png;base64,${shotB64}"></body></html>`;
  const tmpHtml = path.join(c.tmp, "social.html");
  fs.writeFileSync(tmpHtml, html);
  const w = new BrowserWindow({ width: 1280, height: 640, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  await w.loadFile(tmpHtml);
  await c.sleep(800);
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 640 });
  const out = img.getSize().width === 1280 ? img : img.resize({ width: 1280, height: 640, quality: "best" });
  fs.writeFileSync(path.join(OUT, "social-preview.png"), out.toPNG());
  c.check(`social-preview.png (${out.getSize().width}x${out.getSize().height})`, true);
  w.destroy();
}
