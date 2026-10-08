// Loads the sanitizer exactly as the app ships it: the bundled lib/purify.min.js
// plus the installDOMPurifyHook/sanitizeHTML source sliced out of app.jsx.
// Testing a hand-copied config let the tests drift from the real one.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..", "..");
const START = "let _dompurifyHookInstalled";
const END = "/* ── CRITICAL: Sanitize data before ANY write";

function loadAppSanitizer() {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", { runScripts: "outside-only" });
  dom.window.eval(fs.readFileSync(path.join(root, "lib", "purify.min.js"), "utf-8"));
  if (typeof dom.window.DOMPurify?.sanitize !== "function") {
    throw new Error("lib/purify.min.js did not define window.DOMPurify");
  }
  const src = fs.readFileSync(path.join(root, "app.jsx"), "utf-8");
  const start = src.indexOf(START), end = src.indexOf(END);
  if (start < 0 || end < start) {
    throw new Error("sanitizer markers not found in app.jsx; update test/helpers/sanitizer.js");
  }
  const ctx = { window: dom.window };
  vm.runInNewContext(src.slice(start, end) + "\nthis.sanitizeHTML = sanitizeHTML;", ctx);
  return { sanitizeHTML: ctx.sanitizeHTML, window: dom.window, version: dom.window.DOMPurify.version };
}

// Parse sanitized output and list anything that could execute, phish, or load a resource.
const DANGEROUS_TAGS = new Set(["SCRIPT", "IFRAME", "OBJECT", "EMBED", "FORM", "META", "LINK", "BASE",
  "SVG", "MATH", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "SELECT", "BUTTON"]);
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "background", "poster"];

function findProblems(window, html) {
  const tpl = window.document.createElement("template");
  tpl.innerHTML = html;
  const problems = [];
  for (const el of tpl.content.querySelectorAll("*")) {
    if (DANGEROUS_TAGS.has(el.nodeName)) problems.push(`<${el.nodeName.toLowerCase()}>`);
    for (const a of el.attributes) {
      if (/^on/i.test(a.name)) problems.push(`${a.name}=`);
      if (URL_ATTRS.includes(a.name.toLowerCase()) && /^\s*(javascript|vbscript|data:text)/i.test(a.value)) {
        problems.push(`${a.name}=${a.value.slice(0, 30)}`);
      }
    }
    if (el.nodeName === "INPUT" && el.hasAttribute("type") && el.getAttribute("type").toLowerCase() !== "checkbox") {
      problems.push(`input type=${el.getAttribute("type")}`);
    }
  }
  return problems;
}

module.exports = { loadAppSanitizer, findProblems, root };
