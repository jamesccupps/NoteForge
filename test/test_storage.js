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
    t("storage-set writes", (await h.invoke("storage-set", DATA)) === true);
    t("plaintext file holds data", h.read("noteforge-data.json") === DATA);
    t("storage-get reads it back", (await h.invoke("storage-get")).value === DATA);
    t("storage-set-sync writes", h.sendSync("storage-set-sync", DATA) === true);
    t("non-string value refused", (await h.invoke("storage-set", { notebooks: [] })) === false);
    h.cleanup();
  }

  section("Encrypted and unlocked");
  {
    const h = loadMain();
    h.write("noteforge-data.json", DATA);
    await h.invoke("enable-encryption", PW, "");
    t("storage-set writes", (await h.invoke("storage-set", DATA)) === true);
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
    t("storage-set returns false", (await h.invoke("storage-set", LEAK)) === false);
    t("storage-set-sync returns false", h.sendSync("storage-set-sync", LEAK) === false);
    t("no plaintext file created", !h.exists("noteforge-data.json"));
    t("encrypted file unchanged", h.read("noteforge-data.enc") === encBefore);

    const h2 = h.restart(); // fresh launch, password not yet entered
    t("after restart, before unlock: storage-set refused", (await h2.invoke("storage-set", LEAK)) === false);
    t("after restart: still no plaintext file", !h2.exists("noteforge-data.json"));
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
    t("failed write reports false", r === false);
    t("previous encrypted file intact after failed write", h.read("noteforge-data.enc") === before);
    t("previous file still decrypts", (await h.restart().invoke("unlock-master", PW)).value === DATA);
    h.cleanup();
  }
  {
    // Rename refused (target held open on Windows): fall back to in-place write.
    const fs = require("fs");
    const h = loadMain();
    h.write("noteforge-data.json", "old");
    const realRename = fs.renameSync;
    fs.renameSync = () => { const e = new Error("EPERM: operation not permitted, rename"); e.code = "EPERM"; throw e; };
    const r = await h.invoke("storage-set", DATA);
    fs.renameSync = realRename;
    t("save succeeds when rename is refused", r === true && h.read("noteforge-data.json") === DATA);
    t("temp file cleaned up after fallback", !h.exists("noteforge-data.json.tmp"));
    h.cleanup();
  }

  done();
})().catch((e) => { console.error(e); process.exit(1); });
