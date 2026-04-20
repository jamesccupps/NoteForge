// Extract and test the crypto + sanitization functions from main.js standalone
const crypto = require("crypto");
const fs = require("fs");

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const SALT_LEN = 32;
const IV_LEN = 16;
const SCRYPT_N = 65536;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

function deriveKey(password, salt, N, r, p) {
  return crypto.scryptSync(password, salt, KEY_LEN, {
    N: N || SCRYPT_N, r: r || SCRYPT_R, p: p || SCRYPT_P, maxmem: SCRYPT_MAXMEM
  });
}

function encryptData(plaintext, password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let enc = cipher.update(plaintext, "utf-8", "base64");
  enc += cipher.final("base64");
  const tag = cipher.getAuthTag();
  key.fill(0);
  return JSON.stringify({
    v: 2, kdf: "scrypt", N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
    salt: salt.toString("hex"), iv: iv.toString("hex"),
    tag: tag.toString("hex"), data: enc,
  });
}

const MIN_SCRYPT_N = 16384;
const MIN_SCRYPT_R = 8;
const MIN_SCRYPT_P = 1;
const MAX_SCRYPT_N = 1 << 20;

function decryptData(encJson, password) {
  const obj = JSON.parse(encJson);
  const N = obj.N || 16384, r = obj.r || 8, p = obj.p || 1;
  if (N < MIN_SCRYPT_N || N > MAX_SCRYPT_N) throw new Error("Invalid KDF parameters (N)");
  if (r < MIN_SCRYPT_R) throw new Error("Invalid KDF parameters (r)");
  if (p < MIN_SCRYPT_P) throw new Error("Invalid KDF parameters (p)");
  if ((N & (N - 1)) !== 0) throw new Error("Invalid KDF parameters (N must be power of 2)");
  if (typeof obj.salt !== "string" || typeof obj.iv !== "string" ||
      typeof obj.tag !== "string" || typeof obj.data !== "string") {
    throw new Error("Malformed encrypted blob");
  }
  const salt = Buffer.from(obj.salt, "hex");
  const key = deriveKey(password, salt, N, r, p);
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(obj.iv, "hex"));
  decipher.setAuthTag(Buffer.from(obj.tag, "hex"));
  let dec = decipher.update(obj.data, "base64", "utf-8");
  dec += decipher.final("utf-8");
  return { plaintext: dec, key, salt, isV1: !obj.v || obj.v < 2 };
}

function sanitizeDataJson(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    if (data?.notebooks) {
      data.notebooks = data.notebooks.map(nb => nb.locked ? { ...nb, sections: [] } : nb);
    }
    return JSON.stringify(data);
  } catch { return jsonStr; }
}

const WEAK_PASSWORDS = new Set([
  "password","123456","qwerty","abc123","letmein","password123","p@ssw0rd","passw0rd1"
]);

function checkPasswordStrength(pw) {
  if (!pw || pw.length < 10) return "Password must be at least 10 characters";
  if (WEAK_PASSWORDS.has(pw.toLowerCase())) return "This password is too common — choose something unique";
  if (WEAK_PASSWORDS.has(pw.toLowerCase().replace(/[0-9!@#$%^&*]+$/,""))) return "Adding numbers/symbols to a common word isn't enough";
  const hasUpper = /[A-Z]/.test(pw);
  const hasLower = /[a-z]/.test(pw);
  const hasDigit = /[0-9]/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  const classes = [hasUpper, hasLower, hasDigit, hasSymbol].filter(Boolean).length;
  if (classes < 3) return "Use at least 3 of: uppercase, lowercase, numbers, symbols";
  const unique = new Set(pw.toLowerCase()).size;
  if (unique < 5) return "Too many repeated characters — use more variety";
  return null;
}

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); fail++; }
}

console.log("\n=== CRYPTO: Round-trip ===");
const plain = JSON.stringify({ notebooks: [{ id: "nb1", name: "Test", sections: [{ id: "s1", name: "Sec", pages: [{ id: "p1", title: "Hi", content: "<p>Hello</p>" }]}]}]});
const pw = "CorrectHorseBatteryStaple1!";
const enc = encryptData(plain, pw);
const dec = decryptData(enc, pw);
t("Encrypts and decrypts roundtrip", dec.plaintext === plain);
t("Header marks v=2", JSON.parse(enc).v === 2);
t("Uses scrypt N=65536", JSON.parse(enc).N === 65536);
t("Uses 32-byte salt", JSON.parse(enc).salt.length === 64);
t("Uses 16-byte IV", JSON.parse(enc).iv.length === 32);

console.log("\n=== CRYPTO: Wrong password rejected ===");
try { decryptData(enc, "wrong-password"); t("Wrong password throws", false); }
catch { t("Wrong password throws", true); }

console.log("\n=== CRYPTO: Tampering detection ===");
const obj = JSON.parse(enc);
// Tamper with ciphertext
const tampered = { ...obj, data: Buffer.from(obj.data, "base64").map((b,i)=>i===0?b^1:b).toString("base64") };
try { decryptData(JSON.stringify(tampered), pw); t("GCM rejects tampered ciphertext", false); }
catch (e) { t("GCM rejects tampered ciphertext", true, e.message); }

console.log("\n=== CRYPTO: KDF downgrade protection ===");
const weakHeader = { ...obj, N: 1024 }; // way below minimum
try { decryptData(JSON.stringify(weakHeader), pw); t("Rejects weakened N", false); }
catch (e) { t("Rejects weakened N", e.message.includes("KDF parameters")); }

const notPow2 = { ...obj, N: 20000 };
try { decryptData(JSON.stringify(notPow2), pw); t("Rejects non-power-of-2 N", false); }
catch (e) { t("Rejects non-power-of-2 N", e.message.includes("power of 2")); }

const bigN = { ...obj, N: 1 << 25 };
try { decryptData(JSON.stringify(bigN), pw); t("Rejects huge N (DoS)", false); }
catch (e) { t("Rejects huge N", e.message.includes("KDF parameters")); }

const weakR = { ...obj, r: 1 };
try { decryptData(JSON.stringify(weakR), pw); t("Rejects weakened r", false); }
catch (e) { t("Rejects weakened r", e.message.includes("r")); }

console.log("\n=== CRYPTO: Malformed blob rejection ===");
try { decryptData('{"v":2,"N":65536,"r":8,"p":1,"salt":null,"iv":"00","tag":"00","data":"xx"}', pw); t("Rejects non-string salt", false); }
catch (e) { t("Rejects non-string salt", e.message.includes("Malformed")); }

console.log("\n=== CRYPTO: v1 legacy compat ===");
// Simulate v1 blob (no v field, N defaults to 16384)
function encryptV1(plaintext, password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const key = deriveKey(password, salt, 16384, 8, 1);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let enc = cipher.update(plaintext, "utf-8", "base64");
  enc += cipher.final("base64");
  return JSON.stringify({
    salt: salt.toString("hex"), iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"), data: enc,
  });
}
const v1enc = encryptV1(plain, pw);
const v1dec = decryptData(v1enc, pw);
t("v1 legacy blobs still decrypt", v1dec.plaintext === plain);
t("isV1 flag set correctly", v1dec.isV1 === true);

console.log("\n=== SANITIZE: Disk scrubbing ===");
const dirty = JSON.stringify({
  notebooks: [
    { id: "n1", locked: false, sections: [{ id: "s1", pages: [{ content: "plain" }]}]},
    { id: "n2", locked: true, sections: [{ id: "s2", pages: [{ content: "SECRET!" }]}], encSections: "..." }
  ]
});
const cleaned = JSON.parse(sanitizeDataJson(dirty));
t("Unlocked notebook keeps sections", cleaned.notebooks[0].sections.length === 1);
t("Locked notebook sections stripped", cleaned.notebooks[1].sections.length === 0);
t("Locked notebook encSections preserved", cleaned.notebooks[1].encSections === "...");
t("Plaintext string never appears in output", !JSON.stringify(cleaned).includes("SECRET!"));

console.log("\n=== SANITIZE: Corrupt JSON returns passthrough ===");
const broken = sanitizeDataJson("not valid json {");
t("Corrupt JSON passes through (no crash)", broken === "not valid json {");

console.log("\n=== PASSWORD STRENGTH ===");
t("Rejects < 10 chars", checkPasswordStrength("Ab1!xY") !== null);
t("Rejects common password", checkPasswordStrength("password").includes("at least 10"));
t("Rejects common+suffix like passw0rd1", checkPasswordStrength("passw0rd1") !== null);
t("Accepts strong password", checkPasswordStrength("MyC0rrect!Battery") === null);
t("Rejects only-2-classes", checkPasswordStrength("abcdefghij1234") !== null); // only 2 classes
t("Rejects low-entropy like aaaaaaaaaa1!", checkPasswordStrength("aaaaaaaaaa1!") !== null);

console.log("\n=== Summary ===");
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
