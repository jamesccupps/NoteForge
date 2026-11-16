// The DOMPurify hook in app.jsx must remove every <input> except a checkbox, so pasted
// or restored content can't render a fake password prompt inside a note. (Stripping only
// the type, as before 2.9, left a text box behind.)
const { loadAppSanitizer } = require("./helpers/sanitizer");
const { sanitizeHTML } = loadAppSanitizer();

const stripped = [
  ['<input type="password" placeholder="Master password">', "password"],
  ['<input type="PASSWORD">', "PASSWORD (uppercase)"],
  ['<input type="text" value="x">', "text"],
  ['<input type="email">', "email"],
  ['<input type="hidden" value="x">', "hidden"],
  ['<input type="image" src="x">', "image"],
];
const kept = [
  ['<input type="checkbox" id="t">', "checkbox"],
  ['<input type="CheckBox" checked>', "CheckBox (mixed case)"],
  ['<input type=" checkbox">', "checkbox with leading space (DOMPurify trims values)"],
];

let pass = 0, fail = 0;
const t = (name, ok, detail) => { if (ok) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name} → ${detail}`); fail++; } };

for (const [html, label] of stripped) {
  const clean = sanitizeHTML(html);
  t(`${label}: input removed`, !/<input/i.test(clean), clean);
}
for (const [html, label] of kept) {
  const clean = sanitizeHTML(html);
  t(`${label}: type kept`, /type="checkbox"/i.test(clean), clean);
}

// Writing direction (2.10): a paragraph's or list's dir survives saving, but only as one of
// the values HTML defines. Before, the attribute list dropped dir altogether, so a
// right-to-left paragraph lost its direction on the next load.
for (const v of ["rtl", "ltr", "auto"]) {
  const clean = sanitizeHTML(`<p dir="${v}">x</p><ul dir="${v}"><li>y</li></ul>`);
  t(`dir="${v}" kept on a paragraph and a list`, (clean.match(new RegExp(`dir="${v}"`, "g")) || []).length === 2, clean);
}
t('dir="RTL" kept, as rtl', /dir="rtl"/.test(sanitizeHTML('<p dir="RTL">x</p>')), sanitizeHTML('<p dir="RTL">x</p>'));
for (const bad of ["x", "rtl; color:red", "javascript:x", ""]) {
  const clean = sanitizeHTML(`<p dir="${bad}">x</p>`);
  t(`dir="${bad}" removed`, !/dir=/.test(clean), clean);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
