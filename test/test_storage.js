// Data-file writes through the real main.js storage handlers.
const { loadMain, runner } = require("./helpers/main_harness");
const { t, done, section } = runner();

const PW = "CorrectHorseBatteryStaple1!";
const DATA = JSON.stringify({ notebooks: [{ id: "nb1", name: "N", sections: [] }] });
const LEAK = JSON.stringify({ notebooks: [{ id: "x", name: "LEAKED-PLAINTEXT", sections: [] }] });

(async () => {
  section("Unencrypted mode");
  {
    const h = loadMain();
    t("storage-set writes", (await h.invoke("storage-set", DATA)).ok === true);
    t("plaintext file holds data", h.read("noteforge-data.json") === DATA);
    t("storage-get reads it back", (await h.invoke("storage-get")).value === DATA);
    t("storage-set-sync writes", h.sendSync("storage-set-sync", DATA).ok === true);
    t("non-string value refused", (await h.invoke("storage-set", { notebooks: [] })).ok === false);
    h.cleanup();
  }

  section("Encrypted and unlocked");
  {
    const h = loadMain();
    h.write("noteforge-data.json", DATA);
    await h.invoke("enable-encryption", PW, "");
    t("storage-set writes", (await h.invoke("storage-set", DATA)).ok === true);
    t("no plaintext file", !h.exists("noteforge-data.json"));
    t("encrypted file does not contain data", !h.read("noteforge-data.enc").includes('"name":"N"'));
    h.cleanup();
  }

  section("Encrypted and locked: writes are refused, nothing hits disk in plaintext");
  {
    const h = loadMain();
    h.write("noteforge-data.json", DATA);
    await h.invoke("enable-encryption", PW, "");
    const encBefore = h.read("noteforge-data.enc");
    await h.invoke("lock-app");
    t("storage-set returns false", (await h.invoke("storage-set", LEAK)).ok === false);
    t("storage-set-sync returns false", h.sendSync("storage-set-sync", LEAK).ok === false);
    t("no plaintext file created", !h.exists("noteforge-data.json"));
    t("encrypted file unchanged", h.read("noteforge-data.enc") === encBefore);

    const h2 = h.restart(); // fresh launch, password not yet entered
    t("after restart, before unlock: storage-set refused", (await h2.invoke("storage-set", LEAK)).ok === false);
    t("after restart: still no plaintext file", !h2.exists("noteforge-data.json"));
    h.cleanup();
  }

  section("Main process strips locked-notebook plaintext on every save");
  {
    const leaky = (key = '"locked"') => `{"notebooks":[{"id":"n1","locked":false,"sections":[{"id":"s1","pages":[{"content":"public"}]}]},` +
      `{"id":"n2",${key}:true,"encSections":"blob","sections":[{"id":"s2","pages":[{"content":"SECRET!"}]}]}]}`;
    const warn = console.warn; console.warn = () => {};
    const h = loadMain();
    const lr = await h.invoke("storage-set", leaky());
    t("save with plaintext for a locked notebook succeeds", lr.ok === true);
    t("notebook with no key reported as unsealed", JSON.stringify(lr.unsealed) === '["n2"]', JSON.stringify(lr));
    const saved = h.read("noteforge-data.json");
    t("locked sections stripped (unencrypted mode)", !saved.includes("SECRET!"));
    t("unlocked notebook untouched", saved.includes("public"));
    t("encSections kept", JSON.parse(saved).notebooks[1].encSections === "blob");
    h.sendSync("storage-set-sync", leaky());
    t("storage-set-sync strips too", !h.read("noteforge-data.json").includes("SECRET!"));
    await h.invoke("storage-set", leaky('"\\u006cocked"'));
    t("unicode-escaped key can't bypass", !h.read("noteforge-data.json").includes("SECRET!"));
    t("clean data written byte-for-byte", (await h.invoke("storage-set", DATA)).ok === true && h.read("noteforge-data.json") === DATA);
    t("non-JSON refused", (await h.invoke("storage-set", "not json {")).ok === false && h.read("noteforge-data.json") === DATA);

    await h.invoke("enable-encryption", PW, "");
    await h.invoke("storage-set", leaky());
    t("locked sections stripped (encrypted mode)", !(await h.invoke("storage-get")).value.includes("SECRET!"));
    console.warn = warn;
    h.cleanup();
  }

  section("Config written from the renderer");
  {
    const h = loadMain();
    t("autoUpdate=false accepted", (await h.invoke("set-config", "autoUpdate", false)).autoUpdate === false);
    t("persisted and read back", (await h.restart().invoke("get-config")).autoUpdate === false);
    t("renderer can't disable the sandbox", !!(await h.invoke("set-config", "sandbox", false)).error);
    t("non-boolean autoUpdate refused", !!(await h.invoke("set-config", "autoUpdate", "yes")).error);
    t("prototype keys refused", !!(await h.invoke("set-config", "__proto__", { polluted: true })).error &&
      !!(await h.invoke("set-config", "constructor", true)).error);
    const cfg = JSON.parse(h.read("noteforge-config.json"));
    t("config file only holds autoUpdate", JSON.stringify(cfg) === '{"autoUpdate":false}', JSON.stringify(cfg));
    h.write("noteforge-config.json", '{"autoUpdate":true,"sandbox":false}');
    t("hand-edited sandbox:false still honoured by loadConfig", (await h.restart().invoke("get-config")).sandbox === false);
    h.cleanup();
  }

  section("Atomic writes (temp file + fsync + rename)");
  {
    const fs = require("fs");
    const path = require("path");
    // main.js shares this process's fs module, so patching it here is visible there.
    const renames = [];
    const realRename = fs.renameSync;
    fs.renameSync = (a, b) => { renames.push([path.basename(a), path.basename(b)]); return realRename(a, b); };
    const h = loadMain();
    const renamed = (name) => renames.some(([a, b]) => a === name + ".tmp" && b === name);
    const reset = () => { renames.length = 0; };

    await h.invoke("storage-set", DATA);
    t("plaintext save goes through rename", renamed("noteforge-data.json"));
    reset(); await h.invoke("enable-encryption", PW, "");
    t("enable-encryption goes through rename", renamed("noteforge-data.enc"));
    reset(); await h.invoke("storage-set", DATA);
    t("encrypted save goes through rename", renamed("noteforge-data.enc"));
    reset(); await h.invoke("change-master-password", PW, PW + "x");
    t("change-master-password goes through rename", renamed("noteforge-data.enc"));
    reset(); await h.invoke("disable-encryption", PW + "x");
    t("disable-encryption goes through rename", renamed("noteforge-data.json"));
    t("no .tmp files left behind", !fs.readdirSync(h.userData).some((f) => f.endsWith(".tmp")));
    fs.renameSync = realRename;
    h.cleanup();
  }
  {
    // A write that dies before the rename must leave the previous file intact.
    const fs = require("fs");
    const h = loadMain();
    h.write("noteforge-data.json", DATA);
    await h.invoke("enable-encryption", PW, "");
    const before = h.read("noteforge-data.enc");
    const realFsync = fs.fsyncSync;
    fs.fsyncSync = () => { throw new Error("simulated power loss"); };
    const r = await h.invoke("storage-set", LEAK);
    fs.fsyncSync = realFsync;
    t("failed write reports false", r.ok === false);
    t("previous encrypted file intact after failed write", h.read("noteforge-data.enc") === before);
    t("previous file still decrypts", (await h.restart().invoke("unlock-master", PW)).value === DATA);
    h.cleanup();
  }
  {
    // Rename refused (target held open on Windows, e.g. by antivirus). Never overwrite
    // the file in place: a crash mid-write would truncate the only copy.
    const fs = require("fs");
    const h = loadMain();
    h.write("noteforge-data.json", "old");
    const realRename = fs.renameSync;
    let refusals = 0;
    const refuse = (n) => { refusals = 0; fs.renameSync = (a, b) => {
      if (refusals++ < n) { const e = new Error("EPERM: operation not permitted, rename"); e.code = "EPERM"; throw e; }
      return realRename(a, b);
    }; };
    refuse(2);
    const r1 = await h.invoke("storage-set", DATA);
    t("a briefly refused rename is retried", r1.ok === true && h.read("noteforge-data.json") === DATA, JSON.stringify(r1));
    h.write("noteforge-data.json", "old");
    const realWrite = fs.writeFileSync;
    let inPlace = false;
    fs.writeFileSync = (p, ...a) => { if (p === h.file("noteforge-data.json")) inPlace = true; return realWrite(p, ...a); };
    refuse(1000);
    const t0 = Date.now();
    const r2 = await h.invoke("storage-set", DATA);
    fs.renameSync = realRename; fs.writeFileSync = realWrite;
    t("a rename that keeps failing fails the save", r2.ok === false, JSON.stringify(r2));
    t("...without writing over the file in place", !inPlace && h.read("noteforge-data.json") === "old");
    t("...and within about a second", Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
    t("temp file cleaned up", !h.exists("noteforge-data.json.tmp"));
    h.cleanup();
  }
  {
    // A failed write must not leave its temp file (plaintext in unencrypted mode)
    const fs = require("fs");
    const h = loadMain();
    const realFsync = fs.fsyncSync;
    fs.fsyncSync = () => { throw new Error("simulated disk error"); };
    await h.invoke("storage-set", DATA);
    fs.fsyncSync = realFsync;
    t("temp file removed after a failed write", !h.exists("noteforge-data.json.tmp"));
    h.cleanup();
  }

  section("Earlier versions of the encrypted vault");
  {
    const v = (n) => `noteforge-data.prev-${n}.enc`;
    const h = loadMain();
    h.write("noteforge-data.json", DATA);
    await h.invoke("enable-encryption", PW, "");
    const atUnlock = [];
    let cur = h;
    for (let session = 1; session <= 4; session++) {
      cur = cur.restart();
      await cur.invoke("unlock-master", PW);
      atUnlock.push(cur.read("noteforge-data.enc"));
      await cur.invoke("storage-set", DATA.replace('"N"', `"N${session}"`));
      await cur.invoke("storage-set", DATA.replace('"N"', `"N${session}b"`));
    }
    t("one copy per unlock, taken before its first save", cur.read(v(1)) === atUnlock[3] && cur.read(v(2)) === atUnlock[2] && cur.read(v(3)) === atUnlock[1]);
    t("three kept", !cur.exists(v(4)));
    t("copies are .enc files Restore can open (v2 header)", JSON.parse(cur.read(v(1))).v === 2);
    await cur.invoke("change-master-password", PW, PW + "x");
    t("change password removes copies the old password opens", ![1, 2, 3].some((n) => cur.exists(v(n))));
    await cur.restart().invoke("unlock-master", PW + "x");
    await cur.invoke("disable-encryption", PW + "x");
    t("none kept in unencrypted mode", ![1, 2, 3].some((n) => cur.exists(v(n))));
    h.cleanup();
  }

  done();
})().catch((e) => { console.error(e); process.exit(1); });
