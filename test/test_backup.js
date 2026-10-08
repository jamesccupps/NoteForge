// Backup export and two-step restore through the real main.js handlers.
const fs = require("fs");
const path = require("path");
const { loadMain, makeBlob, runner } = require("./helpers/main_harness");
const { t, done, section } = runner();

const PW = "CorrectHorseBatteryStaple1!";
const BACKUP_PW = "Backup#Passphrase-2026";
const CURRENT = JSON.stringify({ notebooks: [{ id: "cur", name: "Current", sections: [] }] });
const BACKUP = JSON.stringify({ notebooks: [{ id: "bak", name: "From backup", sections: [] }] });

// Starts with an encrypted vault holding CURRENT and a backup file holding BACKUP.
async function setup() {
  const h = loadMain();
  h.write("noteforge-data.json", CURRENT);
  await h.invoke("enable-encryption", PW, "");
  const backupPath = path.join(h.userData, "picked", "NoteForge-Backup.enc");
  fs.mkdirSync(path.dirname(backupPath));
  fs.writeFileSync(backupPath, makeBlob(BACKUP, BACKUP_PW));
  return { h, backupPath };
}
async function pick(h, file) {
  h.dialogs.messageBoxResponse = 0; // "Choose Backup…"
  h.dialogs.open = { canceled: false, filePaths: [file] };
  return h.invoke("restore-backup");
}
const vaultValue = async (h, pw) => (await h.restart().invoke("unlock-master", pw)).value;

(async () => {
  section("Export");
  {
    const { h } = await setup();
    const out = path.join(h.userData, "exported.enc");
    h.dialogs.save = { canceled: false, filePath: out };
    const r = await h.invoke("export-backup");
    t("export-backup copies the encrypted file", r.success === true && fs.readFileSync(out, "utf-8") === h.read("noteforge-data.enc"));
    h.cleanup();
  }

  section("Restore: happy path");
  {
    const { h, backupPath } = await setup();
    const r = await pick(h, backupPath);
    t("restore-backup accepts a v2 backup", r.readyForPassword === true && r.backupPath === backupPath, JSON.stringify(r));
    const bad = await h.invoke("verify-and-restore-backup", backupPath, "wrong-password-1");
    t("wrong backup password refused", !!bad.error);
    t("vault untouched after wrong password", (await vaultValue(h, PW)) === CURRENT);
    const ok = await h.invoke("verify-and-restore-backup", backupPath, BACKUP_PW);
    t("right backup password restores", ok.success === true, JSON.stringify(ok));
    t("vault now holds the backup", (await vaultValue(h, BACKUP_PW)) === BACKUP);
    t("rollback copy of the previous vault kept", !!ok.rollbackPath && fs.readFileSync(ok.rollbackPath, "utf-8").length > 0);
    t("restore can't be replayed without picking again", !!(await h.invoke("verify-and-restore-backup", backupPath, BACKUP_PW)).error);
    h.cleanup();
  }

  section("Restore: renderer can only restore the file the user picked");
  {
    const { h, backupPath } = await setup();
    const other = path.join(h.userData, "other.enc");
    fs.writeFileSync(other, makeBlob(BACKUP, BACKUP_PW));
    t("verify without picking a file refused", !!(await h.invoke("verify-and-restore-backup", other, BACKUP_PW)).error);
    await pick(h, backupPath);
    t("verify with a different path refused", !!(await h.invoke("verify-and-restore-backup", other, BACKUP_PW)).error);
    t("vault untouched", (await vaultValue(h, PW)) === CURRENT);
    h.cleanup();
  }

  section("Restore over unencrypted notes keeps a rollback copy");
  {
    const h = loadMain();
    h.write("noteforge-data.json", CURRENT); // encryption never enabled
    const backupPath = path.join(h.userData, "b.enc");
    fs.writeFileSync(backupPath, makeBlob(BACKUP, BACKUP_PW));
    await pick(h, backupPath);
    const ok = await h.invoke("verify-and-restore-backup", backupPath, BACKUP_PW);
    t("restore succeeds", ok.success === true, JSON.stringify(ok));
    t("rollback path reported", ok.rollbackPath === h.file("noteforge-data.json.pre-restore.bak"), ok.rollbackPath);
    t("rollback holds the previous unencrypted notes", h.read("noteforge-data.json.pre-restore.bak") === CURRENT);
    t("live plaintext file removed", !h.exists("noteforge-data.json"));
    t("vault holds the backup", (await vaultValue(h, BACKUP_PW)) === BACKUP);
    h.cleanup();
  }
  {
    const { h, backupPath } = await setup();
    await pick(h, backupPath);
    const realCopy = fs.copyFileSync;
    fs.copyFileSync = () => { throw new Error("EACCES: simulated"); };
    const r = await h.invoke("verify-and-restore-backup", backupPath, BACKUP_PW);
    fs.copyFileSync = realCopy;
    t("rollback copy failure cancels the restore", /Restore cancelled/.test(r.error || ""), JSON.stringify(r));
    t("vault untouched when rollback can't be made", (await vaultValue(h, PW)) === CURRENT);
    h.cleanup();
  }

  section("Restore: legacy / weakened backups");
  {
    const { h, backupPath } = await setup();
    const v1 = makeBlob(BACKUP, BACKUP_PW, { N: 16384, header: { v: undefined, kdf: undefined, N: undefined, r: undefined, p: undefined } });
    fs.writeFileSync(backupPath, v1);
    t("v1 backup refused at pick time", (await pick(h, backupPath)).error === "Unsupported backup format");
    fs.writeFileSync(backupPath, makeBlob(BACKUP, BACKUP_PW));
    t("v2 backup picked", (await pick(h, backupPath)).readyForPassword === true);
    fs.writeFileSync(backupPath, v1); // swapped after picking
    const r = await h.invoke("verify-and-restore-backup", backupPath, BACKUP_PW);
    t("file swapped to v1 after picking is refused", r.error === "Unsupported backup format", JSON.stringify(r));
    t("vault untouched", (await vaultValue(h, PW)) === CURRENT);
    h.cleanup();
  }

  done();
})().catch((e) => { console.error(e); process.exit(1); });
