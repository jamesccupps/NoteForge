// Crypto, KDF validation, and password policy, exercised through the real main.js
// IPC handlers (see helpers/main_harness.js).
const { loadMain, makeBlob, runner } = require("./helpers/main_harness");
const { t, done, section } = runner();

const PW = "CorrectHorseBatteryStaple1!";
const DATA = JSON.stringify({ notebooks: [{ id: "nb1", name: "Test", sections: [{ id: "s1", name: "Sec",
  pages: [{ id: "p1", title: "Hi", content: "<p>Hello</p>" }] }] }] });

(async () => {
  section("Enable encryption: on-disk format");
  {
    const h = loadMain();
    h.write("noteforge-data.json", DATA);
    const r = await h.invoke("enable-encryption", PW, "");
    t("enable-encryption succeeds", r.success === true, JSON.stringify(r));
    t("plaintext file removed", !h.exists("noteforge-data.json"));
    const hdr = JSON.parse(h.read("noteforge-data.enc"));
    t("header v=2, kdf=scrypt", hdr.v === 2 && hdr.kdf === "scrypt");
    t("scrypt N=65536 r=8 p=1", hdr.N === 65536 && hdr.r === 8 && hdr.p === 1);
    t("32-byte salt", hdr.salt.length === 64);
    t("16-byte IV", hdr.iv.length === 32);
    t("16-byte GCM tag", hdr.tag.length === 32);
    t("ciphertext does not contain plaintext", !h.read("noteforge-data.enc").includes("Hello"));

    section("Unlock after restart");
    const h2 = h.restart();
    t("storage-get asks for password while locked", (await h2.invoke("storage-get")).needsPassword === true);
    const bad = await h2.invoke("unlock-master", "wrong-password-123");
    t("wrong password rejected", bad.error === "Wrong password", JSON.stringify(bad));
    const ok = await h2.invoke("unlock-master", PW);
    t("right password unlocks", ok.success === true && ok.value === DATA);
    t("storage-get returns plaintext with session key", (await h2.invoke("storage-get")).value === DATA);

    section("Tampering");
    const hdr2 = JSON.parse(h2.read("noteforge-data.enc"));
    const flipped = Buffer.from(hdr2.data, "base64"); flipped[0] ^= 1;
    h2.write("noteforge-data.enc", JSON.stringify({ ...hdr2, data: flipped.toString("base64") }));
    const h3 = h2.restart();
    t("GCM rejects flipped ciphertext bit", (await h3.invoke("unlock-master", PW)).error === "Wrong password");
    h2.write("noteforge-data.enc", JSON.stringify({ ...hdr2, tag: "00".repeat(16) }));
    t("GCM rejects forged tag", (await h3.restart().invoke("unlock-master", PW)).error === "Wrong password");
    h.cleanup();
  }

  section("KDF downgrade protection (blob made with the CORRECT password)");
  // If the header check were missing these would unlock, so success here = test failure.
  for (const [label, opts] of [
    ["N=1024 rejected", { N: 1024 }],
    ["N=8192 rejected", { N: 8192 }],
    ["r=1 rejected (N at floor so only the r check can catch it)", { N: 16384, r: 1 }],
  ]) {
    const h = loadMain();
    h.write("noteforge-data.enc", makeBlob(DATA, PW, opts));
    const r = await h.invoke("unlock-master", PW);
    t(label, r.error && !r.success, JSON.stringify(r));
    h.cleanup();
  }
  {
    const h = loadMain();
    h.write("noteforge-data.enc", makeBlob(DATA, PW, { header: { N: 1 << 25 } }));
    t("N=2^25 rejected (DoS cap)", !!(await h.invoke("unlock-master", PW)).error);
    h.write("noteforge-data.enc", makeBlob(DATA, PW, { header: { N: 20000 } }));
    t("non-power-of-2 N rejected", !!(await h.restart().invoke("unlock-master", PW)).error);
    for (const [label, hdr] of [["p=65534 (accepted by maxmem, ~2 h of CPU)", { p: 65534 }], ["r=64", { r: 64 }],
      ["p=17", { p: 17 }], ["string N", { N: "65536" }], ["fractional p", { p: 1.5 }]]) {
      h.write("noteforge-data.enc", makeBlob(DATA, PW, { header: hdr }));
      const t0 = Date.now();
      const r = await h.restart().invoke("unlock-master", PW);
      t(`${label} rejected without deriving`, !!r.error && Date.now() - t0 < 1000, `${JSON.stringify(r)} in ${Date.now() - t0} ms`);
    }
    h.write("noteforge-data.enc", makeBlob(DATA, PW, { header: { salt: null } }));
    t("non-string salt rejected", !!(await h.restart().invoke("unlock-master", PW)).error);
    h.cleanup();
  }

  section("v1 legacy blob");
  {
    const h = loadMain();
    h.write("noteforge-data.enc", makeBlob(DATA, PW, { N: 16384, header: { v: undefined, kdf: undefined, N: undefined, r: undefined, p: undefined } }));
    const r = await h.invoke("unlock-master", PW);
    t("v1 blob (no header, N=16384) unlocks", r.success === true && r.value === DATA, JSON.stringify(r));
    const hdr = JSON.parse(h.read("noteforge-data.enc"));
    t("v1 file auto-upgraded to v2 / N=65536", hdr.v === 2 && hdr.N === 65536);
    t("upgraded file unlocks after restart", (await h.restart().invoke("unlock-master", PW)).success === true);
    h.cleanup();
  }

  section("Locked notebooks never reach disk in plaintext (enable/change/disable)");
  {
    const h = loadMain();
    const dirty = JSON.stringify({ notebooks: [
      { id: "n1", locked: false, sections: [{ id: "s1", pages: [{ content: "plain" }] }] },
      { id: "n2", locked: true, sections: [{ id: "s2", pages: [{ content: "SECRET!" }] }], encSections: "blob" },
    ] });
    h.write("noteforge-data.json", dirty);
    await h.invoke("enable-encryption", PW, "");
    const v = JSON.parse((await h.invoke("storage-get")).value);
    t("unlocked notebook keeps sections", v.notebooks[0].sections.length === 1);
    t("locked notebook sections stripped", v.notebooks[1].sections.length === 0);
    t("locked notebook encSections kept", v.notebooks[1].encSections === "blob");
    const r = await h.invoke("disable-encryption", PW);
    t("disable-encryption succeeds", r.success === true, JSON.stringify(r));
    t("plaintext file has no locked-notebook content", !h.read("noteforge-data.json").includes("SECRET!"));
    h.cleanup();
  }

  section("Change master password");
  {
    const h = loadMain();
    h.write("noteforge-data.json", DATA);
    await h.invoke("enable-encryption", PW, "");
    const NEW = "AnotherGood#Passphrase9";
    t("wrong current password rejected", (await h.invoke("change-master-password", "nope-nope-nope", NEW)).error === "Wrong current password");
    t("change succeeds", (await h.invoke("change-master-password", PW, NEW)).success === true);
    const h2 = h.restart();
    t("old password no longer unlocks", !!(await h2.invoke("unlock-master", PW)).error);
    t("new password unlocks", (await h2.restart().invoke("unlock-master", NEW)).value === DATA);
    h.cleanup();
  }

  section("Verify current master password (Change Password step 1)");
  {
    const h = loadMain();
    h.write("noteforge-data.json", DATA);
    await h.invoke("enable-encryption", PW, "");
    t("right password verifies", (await h.invoke("verify-master-password", PW)).success === true);
    t("wrong password rejected", (await h.invoke("verify-master-password", "nope-nope-nope")).error === "Wrong current password");
    t("vault unchanged by verifying", (await h.restart().invoke("unlock-master", PW)).value === DATA);
    for (let i = 0; i < 5; i++) await h.invoke("verify-master-password", "wrong-" + i);
    t("shares the unlock rate limit", /Too many failed attempts/.test((await h.invoke("verify-master-password", PW)).error || ""));
    h.cleanup();
  }

  section("Notebook encryption");
  {
    const h = loadMain();
    const secs = JSON.stringify([{ id: "s", name: "x", pages: [] }]);
    const e = await h.invoke("encrypt-notebook-sections", secs, PW);
    t("encrypt returns blob + opaque key handle", !!e.blob && /^[0-9a-f]{32}$/.test(e.nbKeyId));
    const d = await h.invoke("decrypt-notebook-sections", e.blob, PW);
    t("decrypt round-trips", d.sections === secs);
    t("weak notebook password refused", !!(await h.invoke("encrypt-notebook-sections", secs, "short")).error);

    section("Saves seal open protected notebooks with their cached key");
    // The renderer sends the open notebook's pages plus its key handle; main encrypts
    // them into encSections and strips the plaintext.
    const edited = JSON.stringify([{ id: "s", name: "x", pages: [{ id: "p", content: "EDITED-AFTER-UNLOCK" }] }]);
    const app = (sections) => JSON.stringify({ notebooks: [{ id: "nb", name: "N", locked: true, encSections: e.blob, sections }] });
    const r = await h.invoke("storage-set", app(JSON.parse(edited)), { nb: d.nbKeyId });
    const onDisk = JSON.parse(h.read("noteforge-data.json")).notebooks[0];
    t("save reports the new blob", r.ok && r.blobs.nb === onDisk.encSections, JSON.stringify(r).slice(0, 200));
    t("plaintext stripped from disk", onDisk.sections.length === 0 && !h.read("noteforge-data.json").includes("EDITED"));
    t("blob on disk holds the newest pages", (await h.invoke("decrypt-notebook-sections", onDisk.encSections, PW)).sections === edited);
    t("sealed blob keeps the notebook salt", JSON.parse(onDisk.encSections).salt === JSON.parse(e.blob).salt);
    t("sealed blob uses a fresh IV", JSON.parse(onDisk.encSections).iv !== JSON.parse(e.blob).iv);
    const rs = h.sendSync("storage-set-sync", app(JSON.parse(edited)), { nb: d.nbKeyId });
    t("the sync (close) path seals too", rs.ok && !!rs.blobs.nb &&
      (await h.invoke("decrypt-notebook-sections", JSON.parse(h.read("noteforge-data.json")).notebooks[0].encSections, PW)).sections === edited);
    t("key handle for another id isn't used", (await h.invoke("storage-set", app(JSON.parse(edited)), { other: d.nbKeyId })).unsealed[0] === "nb");
    await h.invoke("forget-notebook-key", d.nbKeyId);
    const gone = await h.invoke("storage-set", app(JSON.parse(edited)), { nb: d.nbKeyId });
    t("forgotten key handle no longer seals (reported unsealed)", gone.unsealed[0] === "nb" && !gone.blobs.nb);
    t("unsealed pages are still never written in plaintext", !h.read("noteforge-data.json").includes("EDITED"));
    await h.invoke("lock-app");
    t("lock-app drops notebook keys", (await h.invoke("storage-set", app(JSON.parse(edited)), { nb: e.nbKeyId })).unsealed[0] === "nb");
    h.cleanup();
  }

  section("Rate limiting");
  {
    const h = loadMain();
    h.write("noteforge-data.json", DATA);
    await h.invoke("enable-encryption", PW, "");
    const h2 = h.restart();
    for (let i = 0; i < 5; i++) await h2.invoke("unlock-master", "wrong-password-" + i);
    const locked = await h2.invoke("unlock-master", PW);
    t("5 failures lock out even the right password", /Too many failed attempts/.test(locked.error || ""), JSON.stringify(locked));
    t("lockout persists across restart", /Too many failed attempts/.test((await h2.restart().invoke("unlock-master", PW)).error || ""));
    h.cleanup();
  }

  section("Password strength (real WEAK_PASSWORDS list)");
  {
    const h = loadMain();
    const s = async (pw) => (await h.invoke("check-password-strength", pw)).error;
    t("rejects < 10 chars", !!(await s("Ab1!xY")));
    t("rejects common password", !!(await s("password123")));
    t("rejects common word + suffix (Sunshine2024!)", !!(await s("Sunshine2024!")));
    t("rejects only 2 classes", !!(await s("abcdefghij1234")));
    t("rejects low variety", !!(await s("aaaaaaaaaa1!")));
    t("accepts strong password", (await s("MyC0rrect!Battery")) === null);
    h.cleanup();
  }

  done();
})().catch((e) => { console.error(e); process.exit(1); });
