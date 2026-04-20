// Verify the DOMPurify input-type hook from app.jsx — pasted <input type="password"> should lose its type attr
const { JSDOM } = require("jsdom");
const createDOMPurify = require("dompurify");
const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

DOMPurify.addHook("uponSanitizeAttribute",(node,data)=>{
  if(node.nodeName==="INPUT"&&data.attrName==="type"){
    if(String(data.attrValue).toLowerCase()!=="checkbox")data.keepAttr=false;
  }
});

const config = {
  ALLOWED_TAGS:["input","label","div","span","p","strong"],
  ALLOWED_ATTR:["type","checked","id","for","class"],
  FORBID_TAGS:["form","script","iframe"],
};

const cases = [
  ['<input type="password" placeholder="Master password">', 'password'],
  ['<input type="text" value="x">', 'text'],
  ['<input type="email">', 'email'],
  ['<input type="checkbox" id="t">', 'checkbox (should keep)'],
];

let pass=0,fail=0;
for (const [html, label] of cases) {
  const clean = DOMPurify.sanitize(html, config);
  const hasType = /type\s*=/.test(clean);
  if (label.includes('checkbox')) {
    const ok = hasType && clean.includes('checkbox');
    console.log(`  ${ok?'✓':'✗'} ${label}: "${clean}"`);
    if (ok) pass++; else fail++;
  } else {
    const ok = !hasType;
    console.log(`  ${ok?'✓':'✗'} ${label} → type stripped: "${clean}"`);
    if (ok) pass++; else fail++;
  }
}
console.log(`\n  ${pass}/${pass+fail} passed — hook ${fail===0?'works ✅':'BROKEN ❌'}`);
