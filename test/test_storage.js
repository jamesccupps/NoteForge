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

  done();
})().catch((e) => { console.error(e); process.exit(1); });
