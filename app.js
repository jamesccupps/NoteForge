const {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo
} = React;

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════ */
const SCHEMA_VERSION = 1; // bump if notebook/section/page shape changes; used for safe migrations
const NB_COLORS = ["#7c6ef0", "#e05a9f", "#e89020", "#1cb888", "#3b82f6", "#9061e0", "#e54545", "#14b8a6", "#d96830", "#64748b"];
const FONT_SIZES = [{
  l: "10",
  v: "1"
}, {
  l: "12",
  v: "2"
}, {
  l: "14",
  v: "3"
}, {
  l: "16",
  v: "4"
}, {
  l: "18",
  v: "5"
}, {
  l: "24",
  v: "6"
}, {
  l: "32",
  v: "7"
}];
const HEADINGS = [{
  l: "Normal",
  v: "div"
}, {
  l: "H1",
  v: "h1"
}, {
  l: "H2",
  v: "h2"
}, {
  l: "H3",
  v: "h3"
}, {
  l: "H4",
  v: "h4"
}];
const TXT_COLORS = ["#000000", "#374151", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#2563eb", "#7c3aed", "#db2777", "#ffffff"];
const HL_COLORS = ["transparent", "#fef08a", "#bbf7d0", "#bfdbfe", "#e9d5ff", "#fecdd3", "#fed7aa", "#ccfbf1", "#e2e8f0"];
const IMG_MAX_INLINE_BYTES = 5 * 1024 * 1024; // 5 MB hard cap on pasted images before downscale attempt
const IMG_DOWNSCALE_TARGET_WIDTH = 1600;
const IMG_DOWNSCALE_QUALITY = 0.85;
const uid = () => "id-" + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
const THEMES = {
  dark: {
    "--bg": "#0e0e16",
    "--surface": "#161622",
    "--surface-alt": "#1c1c2c",
    "--border": "#282840",
    "--border-light": "#32324a",
    "--text": "#e4e4f0",
    "--text-secondary": "#8585a0",
    "--text-muted": "#52526a",
    "--accent": "#7c6ef0",
    "--accent-bg": "rgba(124,110,240,.12)",
    "--accent-hover": "#6359d0",
    "--hover": "rgba(255,255,255,.04)",
    "--shadow": "rgba(0,0,0,.5)",
    "--editor-bg": "#111119",
    "--code-bg": "#1a1a28",
    "--scrollbar": "#32324a",
    "--scrollbar-hover": "#444468",
    "--danger": "#f87171",
    "--success": "#34d399",
    "--warning": "#fbbf24",
    "--nav-bg": "#111118"
  },
  light: {
    "--bg": "#f6f5f0",
    "--surface": "#ffffff",
    "--surface-alt": "#f0efe8",
    "--border": "#ddd8ce",
    "--border-light": "#eae6dc",
    "--text": "#1a1a1a",
    "--text-secondary": "#606058",
    "--text-muted": "#9a9a88",
    "--accent": "#6359d0",
    "--accent-bg": "rgba(99,89,208,.09)",
    "--accent-hover": "#4f42b5",
    "--hover": "rgba(0,0,0,.035)",
    "--shadow": "rgba(0,0,0,.06)",
    "--editor-bg": "#fcfcfa",
    "--code-bg": "#f0efe8",
    "--scrollbar": "#c8c4b8",
    "--scrollbar-hover": "#a8a498",
    "--danger": "#e54545",
    "--success": "#1cb888",
    "--warning": "#e89020",
    "--nav-bg": "#eceade"
  }
};
const DEFAULT_DATA = {
  notebooks: [{
    id: "nb-1",
    name: "My Notebook",
    color: "#7c6ef0",
    sections: [{
      id: "sec-1",
      name: "General",
      color: "#7c6ef0",
      pages: [{
        id: "page-1",
        title: "Welcome to NoteForge",
        content: `<h2>Welcome to NoteForge</h2>
<p>Your encrypted, offline note-taking app.</p>
<h3>Features</h3>
<ul>
<li><strong>AES-256 encryption</strong> — protect all notes with a master password</li>
<li><strong>Notebook locks</strong> — individual password per notebook</li>
<li>Rich text: <strong>bold</strong>, <em>italic</em>, <u>underline</u>, <s>strike</s></li>
<li>Headings, lists, tables, code blocks, links</li>
<li>Paste images, checklists, find &amp; replace</li>
</ul>
<h3>Shortcuts</h3>
<ul>
<li><code>Ctrl+B/I/U</code> — Bold/Italic/Underline</li>
<li><code>Ctrl+F</code> — Find &amp; Replace</li>
<li><code>Ctrl+D</code> — Duplicate page</li>
<li><code>Ctrl+P</code> — Print</li>
<li><code>Ctrl+Shift+E</code> — Export HTML</li>
</ul>
<p>Go to <strong>File → Encryption Settings</strong> to enable master encryption.</p>`,
        created: Date.now(),
        modified: Date.now(),
        pinned: false,
        deleted: false
      }]
    }]
  }]
};

/* ═══════════════════════════════════════════════════════════════
   STORAGE
   ═══════════════════════════════════════════════════════════════ */
const store = {
  async get() {
    try {
      if (window.electronAPI) return await window.electronAPI.storageGet();
      const v = localStorage.getItem("noteforge-data");
      return v ? {
        value: v
      } : null;
    } catch {
      return null;
    }
  },
  async set(val) {
    try {
      if (window.electronAPI) return await window.electronAPI.storageSet(val);
      localStorage.setItem("noteforge-data", val);
      return true;
    } catch {
      return false;
    }
  }
};
const prefsStore = {
  load() {
    try {
      return JSON.parse(localStorage.getItem("noteforge-prefs") || "{}");
    } catch {
      return {};
    }
  },
  save(p) {
    try {
      localStorage.setItem("noteforge-prefs", JSON.stringify(p));
    } catch {}
  }
};

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════ */
const snippet = html => html ? decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 80) : "";
const escHtml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hasElectronCrypto = () => !!window.electronAPI?.checkEncryption;
// Decode HTML entities using the browser's built-in parser — safe because we read textContent only
let _entityDecoder = null;
function decodeEntities(s) {
  if (!s) return s;
  if (!_entityDecoder) _entityDecoder = document.createElement("textarea");
  _entityDecoder.innerHTML = s;
  return _entityDecoder.value;
}

/* ── HTML Sanitization (DOMPurify) ─────────────────────────────
   Strips script tags, event handlers, javascript: URLs, etc.
   Applied before any HTML is set as innerHTML.
   Additional hook: restrict <input type=...> to checkbox only, so a malicious
   paste can't inject <input type="password"> for in-note phishing. */
let _dompurifyHookInstalled = false;
function installDOMPurifyHook() {
  if (_dompurifyHookInstalled || !window.DOMPurify) return;
  window.DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (node.nodeName === "INPUT" && data.attrName === "type") {
      if (String(data.attrValue).toLowerCase() !== "checkbox") data.keepAttr = false;
    }
  });
  _dompurifyHookInstalled = true;
}
const sanitizeHTML = html => {
  if (!html) return html;
  if (window.DOMPurify) {
    installDOMPurifyHook();
    return window.DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["h1", "h2", "h3", "h4", "p", "br", "strong", "b", "em", "i", "u", "s", "del", "ul", "ol", "li", "blockquote", "pre", "code", "table", "thead", "tbody", "tr", "td", "th", "a", "img", "hr", "div", "span", "label", "input", "sub", "sup", "font"],
      ALLOWED_ATTR: ["href", "src", "title", "alt", "style", "class", "id", "type", "checked", "for", "color", "size", "face", "target", "width", "height", "colspan", "rowspan"],
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "textarea", "select", "button", "meta", "link", "base"],
      FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "onchange", "onsubmit", "onkeydown", "onkeyup", "onkeypress", "onmousedown", "onmouseup", "onauxclick", "onpointerdown", "onpointerup", "onwheel", "onbeforeinput", "oninput", "onpaste"],
      ALLOW_DATA_ATTR: false
    });
  }
  // Fallback if DOMPurify not loaded — strip obvious dangerous patterns
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<iframe[\s\S]*?<\/iframe>/gi, "").replace(/<object[\s\S]*?<\/object>/gi, "").replace(/<embed[\s\S]*?>/gi, "").replace(/\bon\w+\s*=/gi, "data-removed=").replace(/javascript\s*:/gi, "removed:");
};

/* ── CRITICAL: Sanitize data before ANY write to disk ──────────
   Strips plaintext sections from ALL locked notebooks.
   This is the mandatory safety net — no conditions, no exceptions.
   Called by persist() and the beforeunload emergency flush. */
function sanitizeForDiskSync(data) {
  if (!data?.notebooks) return data;
  return {
    ...data,
    notebooks: data.notebooks.map(nb => {
      if (!nb.locked) return nb;
      // Locked notebook: NEVER write plaintext sections to disk
      return {
        ...nb,
        sections: []
      };
    })
  };
}

/* ── Image downscale helper ────────────────────────────────────
   Large pasted photos are resized to IMG_DOWNSCALE_TARGET_WIDTH and
   re-encoded as JPEG. Keeps the encrypted data file lean. */
function downscaleImage(file, maxBytes) {
  return new Promise((resolve, reject) => {
    if (file.size > IMG_MAX_INLINE_BYTES) {
      return reject(new Error(`Image is ${(file.size / 1048576).toFixed(1)} MB — over the 5 MB inline limit.`));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.onload = ev => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.onload = () => {
        // If already small enough, use original
        if (file.size <= (maxBytes || 512000)) {
          return resolve(ev.target.result);
        }
        // Downscale to target width, preserving aspect ratio
        const scale = Math.min(1, IMG_DOWNSCALE_TARGET_WIDTH / img.width);
        const w = Math.round(img.width * scale),
          h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
        try {
          const dataUrl = canvas.toDataURL(mime, IMG_DOWNSCALE_QUALITY);
          resolve(dataUrl);
        } catch (e) {
          reject(new Error("Could not compress image"));
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ═══════════════════════════════════════════════════════════════
   MODAL DIALOGS — replace native alert/confirm/prompt for consistent UX
   ═══════════════════════════════════════════════════════════════ */
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmStyle,
  onConfirm,
  onCancel,
  dark
}) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    className: "nf-modal-overlay",
    onMouseDown: e => {
      if (e.target === e.currentTarget) onCancel();
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "nf-modal",
    style: dark ? THEMES.dark : THEMES.light,
    onMouseDown: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("h3", null, title), /*#__PURE__*/React.createElement("p", null, message), /*#__PURE__*/React.createElement("div", {
    className: "nf-modal-actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "nf-modal-btn secondary",
    onClick: onCancel
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    ref: ref,
    className: `nf-modal-btn ${confirmStyle || "primary"}`,
    onClick: onConfirm,
    onKeyDown: e => {
      if (e.key === "Enter") onConfirm();
      if (e.key === "Escape") onCancel();
    }
  }, confirmLabel || "OK"))));
}
function PromptDialog({
  title,
  message,
  placeholder,
  defaultValue,
  confirmLabel,
  onConfirm,
  onCancel,
  dark
}) {
  const [val, setVal] = useState(defaultValue || "");
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    className: "nf-modal-overlay",
    onMouseDown: e => {
      if (e.target === e.currentTarget) onCancel();
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "nf-modal",
    style: dark ? THEMES.dark : THEMES.light,
    onMouseDown: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("h3", null, title), message && /*#__PURE__*/React.createElement("p", null, message), /*#__PURE__*/React.createElement("input", {
    ref: ref,
    className: "nf-modal-input",
    placeholder: placeholder || "",
    value: val,
    onChange: e => setVal(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") onConfirm(val);
      if (e.key === "Escape") onCancel();
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "nf-modal-actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "nf-modal-btn secondary",
    onClick: onCancel
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    className: "nf-modal-btn primary",
    onClick: () => onConfirm(val)
  }, confirmLabel || "OK"))));
}
function AlertDialog({
  title,
  message,
  dark,
  onClose
}) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    className: "nf-modal-overlay",
    onMouseDown: e => {
      if (e.target === e.currentTarget) onClose();
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "nf-modal",
    style: dark ? THEMES.dark : THEMES.light,
    onMouseDown: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("h3", null, title), /*#__PURE__*/React.createElement("p", null, message), /*#__PURE__*/React.createElement("div", {
    className: "nf-modal-actions"
  }, /*#__PURE__*/React.createElement("button", {
    ref: ref,
    className: "nf-modal-btn primary",
    onClick: onClose,
    onKeyDown: e => {
      if (e.key === "Enter" || e.key === "Escape") onClose();
    }
  }, "OK"))));
}
function ShortcutsDialog({
  onClose,
  dark
}) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const rows = [["Ctrl+N", "New Page"], ["Ctrl+Shift+N", "New Notebook"], ["Ctrl+B / I / U", "Bold / Italic / Underline"], ["Ctrl+D", "Duplicate Page"], ["Ctrl+F", "Find & Replace"], ["Ctrl+L", "Lock App"], ["Ctrl+Z / Ctrl+Y", "Undo / Redo"], ["Ctrl+= / Ctrl+-", "Zoom In / Out"], ["Ctrl+\\", "Toggle Sidebar"], ["Ctrl+Shift+D", "Toggle Theme"], ["Ctrl+P", "Print"], ["Ctrl+Shift+E", "Export HTML"], ["F1", "This dialog"]];
  return /*#__PURE__*/React.createElement("div", {
    className: "nf-modal-overlay",
    onMouseDown: e => {
      if (e.target === e.currentTarget) onClose();
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "nf-modal",
    style: {
      ...(dark ? THEMES.dark : THEMES.light),
      width: 440
    },
    onMouseDown: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("h3", null, "Keyboard Shortcuts"), /*#__PURE__*/React.createElement("div", {
    ref: ref,
    tabIndex: -1,
    style: {
      outline: "none",
      marginTop: 10,
      maxHeight: "60vh",
      overflowY: "auto"
    },
    onKeyDown: e => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: 12.5
    }
  }, /*#__PURE__*/React.createElement("tbody", null, rows.map(([k, v]) => /*#__PURE__*/React.createElement("tr", {
    key: k
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "4px 8px 4px 0",
      whiteSpace: "nowrap"
    }
  }, /*#__PURE__*/React.createElement("kbd", {
    style: {
      fontFamily: "'JetBrains Mono',monospace",
      fontSize: 11,
      padding: "2px 6px",
      background: "var(--code-bg)",
      border: "1px solid var(--border)",
      borderRadius: 4
    }
  }, k)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "4px 0",
      color: "var(--text-secondary)"
    }
  }, v)))))), /*#__PURE__*/React.createElement("div", {
    className: "nf-modal-actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "nf-modal-btn primary",
    onClick: onClose
  }, "Close"))));
}

/* ═══════════════════════════════════════════════════════════════
   SVG ICONS
   ═══════════════════════════════════════════════════════════════ */
function I({
  n,
  s = 16
}) {
  const p = {
    book: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M4 19.5A2.5 2.5 0 016.5 17H20"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"
    })),
    folder: /*#__PURE__*/React.createElement("path", {
      d: "M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"
    }),
    file: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: "14,2 14,8 20,8"
    })),
    plus: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
      x1: "12",
      y1: "5",
      x2: "12",
      y2: "19"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "5",
      y1: "12",
      x2: "19",
      y2: "12"
    })),
    search: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "11",
      cy: "11",
      r: "8"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "21",
      y1: "21",
      x2: "16.65",
      y2: "16.65"
    })),
    trash: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
      points: "3,6 5,6 21,6"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
    })),
    pin: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
      x1: "12",
      y1: "17",
      x2: "12",
      y2: "22"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24z"
    })),
    bold: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"
    })),
    italic: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
      x1: "19",
      y1: "4",
      x2: "10",
      y2: "4"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "14",
      y1: "20",
      x2: "5",
      y2: "20"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "15",
      y1: "4",
      x2: "9",
      y2: "20"
    })),
    underline: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M6 3v7a6 6 0 006 6 6 6 0 006-6V3"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "4",
      y1: "21",
      x2: "20",
      y2: "21"
    })),
    strike: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M16 4H9a3 3 0 00-3 3v0a3 3 0 003 3h0"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M8 20h7a3 3 0 003-3v0a3 3 0 00-3-3h0"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "4",
      y1: "12",
      x2: "20",
      y2: "12"
    })),
    ul: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
      x1: "8",
      y1: "6",
      x2: "21",
      y2: "6"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "8",
      y1: "12",
      x2: "21",
      y2: "12"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "8",
      y1: "18",
      x2: "21",
      y2: "18"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "3",
      cy: "6",
      r: "1",
      fill: "currentColor"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "3",
      cy: "12",
      r: "1",
      fill: "currentColor"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "3",
      cy: "18",
      r: "1",
      fill: "currentColor"
    })),
    ol: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
      x1: "10",
      y1: "6",
      x2: "21",
      y2: "6"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "10",
      y1: "12",
      x2: "21",
      y2: "12"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "10",
      y1: "18",
      x2: "21",
      y2: "18"
    }), /*#__PURE__*/React.createElement("text", {
      x: "3",
      y: "8",
      fontSize: "8",
      fill: "currentColor",
      stroke: "none"
    }, "1"), /*#__PURE__*/React.createElement("text", {
      x: "3",
      y: "14",
      fontSize: "8",
      fill: "currentColor",
      stroke: "none"
    }, "2"), /*#__PURE__*/React.createElement("text", {
      x: "3",
      y: "20",
      fontSize: "8",
      fill: "currentColor",
      stroke: "none"
    }, "3")),
    check: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
      points: "9,11 12,14 22,4"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"
    })),
    undo: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
      points: "1,4 1,10 7,10"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M3.51 15a9 9 0 102.13-9.36L1 10"
    })),
    redo: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
      points: "23,4 23,10 17,10"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M20.49 15a9 9 0 11-2.13-9.36L23 10"
    })),
    moon: /*#__PURE__*/React.createElement("path", {
      d: "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
    }),
    sun: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "5"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "12",
      y1: "1",
      x2: "12",
      y2: "3"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "12",
      y1: "21",
      x2: "12",
      y2: "23"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "4.22",
      y1: "4.22",
      x2: "5.64",
      y2: "5.64"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "18.36",
      y1: "18.36",
      x2: "19.78",
      y2: "19.78"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "1",
      y1: "12",
      x2: "3",
      y2: "12"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "21",
      y1: "12",
      x2: "23",
      y2: "12"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "4.22",
      y1: "19.78",
      x2: "5.64",
      y2: "18.36"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "18.36",
      y1: "5.64",
      x2: "19.78",
      y2: "4.22"
    })),
    chev: /*#__PURE__*/React.createElement("polyline", {
      points: "9,18 15,12 9,6"
    }),
    edit: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
    })),
    x: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
      x1: "18",
      y1: "6",
      x2: "6",
      y2: "18"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "6",
      y1: "6",
      x2: "18",
      y2: "18"
    })),
    code: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
      points: "16,18 22,12 16,6"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: "8,6 2,12 8,18"
    })),
    hr: /*#__PURE__*/React.createElement("line", {
      x1: "2",
      y1: "12",
      x2: "22",
      y2: "12"
    }),
    indent: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
      x1: "21",
      y1: "6",
      x2: "11",
      y2: "6"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "21",
      y1: "12",
      x2: "11",
      y2: "12"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "21",
      y1: "18",
      x2: "11",
      y2: "18"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: "3,8 7,12 3,16"
    })),
    outdent: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
      x1: "21",
      y1: "6",
      x2: "11",
      y2: "6"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "21",
      y1: "12",
      x2: "11",
      y2: "12"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "21",
      y1: "18",
      x2: "11",
      y2: "18"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: "7,8 3,12 7,16"
    })),
    sidebar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "3",
      width: "18",
      height: "18",
      rx: "2",
      ry: "2"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "9",
      y1: "3",
      x2: "9",
      y2: "21"
    })),
    table: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "3",
      width: "18",
      height: "18",
      rx: "2"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "3",
      y1: "9",
      x2: "21",
      y2: "9"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "3",
      y1: "15",
      x2: "21",
      y2: "15"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "9",
      y1: "3",
      x2: "9",
      y2: "21"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "15",
      y1: "3",
      x2: "15",
      y2: "21"
    })),
    wrap: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 6h18"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M3 12h15a3 3 0 110 6h-4"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: "13,15 11,18 13,21"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M3 18h4"
    })),
    zin: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "11",
      cy: "11",
      r: "8"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "21",
      y1: "21",
      x2: "16.65",
      y2: "16.65"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "11",
      y1: "8",
      x2: "11",
      y2: "14"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "8",
      y1: "11",
      x2: "14",
      y2: "11"
    })),
    zout: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "11",
      cy: "11",
      r: "8"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "21",
      y1: "21",
      x2: "16.65",
      y2: "16.65"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "8",
      y1: "11",
      x2: "14",
      y2: "11"
    })),
    palette: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "13.5",
      cy: "6.5",
      r: "2"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "17.5",
      cy: "10.5",
      r: "2"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "8.5",
      cy: "7.5",
      r: "2"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "6.5",
      cy: "12",
      r: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10c1.38 0 2.5-1.12 2.5-2.5 0-.61-.23-1.2-.64-1.67-.08-.1-.13-.21-.13-.33 0-.28.22-.5.5-.5H16c3.31 0 6-2.69 6-6 0-5.51-4.49-10-10-10z"
    })),
    hl: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 20h9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
    })),
    dl: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: "7,10 12,15 17,10"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "12",
      y1: "15",
      x2: "12",
      y2: "3"
    })),
    link: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
    })),
    quote: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 21c3 0 7-1 7-8V5c0-1.25-.76-2.017-2-2H5c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M15 21c3 0 7-1 7-8V5c0-1.25-.76-2.017-2-2h-3c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"
    })),
    print: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
      points: "6,9 6,2 18,2 18,9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "6",
      y: "14",
      width: "12",
      height: "8"
    })),
    copy: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "9",
      y: "9",
      width: "13",
      height: "13",
      rx: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
    })),
    eraser: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M7 21h10"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M5.5 13.5L12 7l5 5-6.5 6.5a2.12 2.12 0 01-3 0L5.5 16.5a2.12 2.12 0 010-3z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M18 13l-1.5-1.5"
    })),
    scissors: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "6",
      cy: "6",
      r: "3"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "6",
      cy: "18",
      r: "3"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "20",
      y1: "4",
      x2: "8.12",
      y2: "15.88"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "14.47",
      y1: "14.48",
      x2: "20",
      y2: "20"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "8.12",
      y1: "8.12",
      x2: "12",
      y2: "12"
    })),
    clipboard: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "8",
      y: "2",
      width: "8",
      height: "4",
      rx: "1",
      ry: "1"
    })),
    lock: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "11",
      width: "18",
      height: "11",
      rx: "2",
      ry: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M7 11V7a5 5 0 0110 0v4"
    })),
    unlock: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "11",
      width: "18",
      height: "11",
      rx: "2",
      ry: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M7 11V7a5 5 0 019.9-1"
    })),
    shield: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
    }))
  };
  return /*#__PURE__*/React.createElement("svg", {
    width: s,
    height: s,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p[n]);
}

/* ═══════════════════════════════════════════════════════════════
   SMALL COMPONENTS
   ═══════════════════════════════════════════════════════════════ */
function Btn({
  icon,
  label,
  onClick,
  active,
  disabled,
  s = 14
}) {
  return /*#__PURE__*/React.createElement("button", {
    title: label,
    onClick: onClick,
    disabled: disabled,
    className: `tb${active ? " active" : ""}`
  }, /*#__PURE__*/React.createElement(I, {
    n: icon,
    s: s
  }));
}
function Sel({
  value,
  opts,
  onChange,
  w = 80
}) {
  return /*#__PURE__*/React.createElement("select", {
    className: "nf-select",
    value: value,
    onChange: e => onChange(e.target.value),
    style: {
      width: w
    }
  }, opts.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.v,
    value: o.v
  }, o.l)));
}
function CPick({
  colors,
  onChange,
  label
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("button", {
    title: label,
    onClick: () => setOpen(!open),
    className: "tb"
  }, /*#__PURE__*/React.createElement(I, {
    n: label === "Text Color" ? "palette" : "hl",
    s: 13
  })), open && /*#__PURE__*/React.createElement("div", {
    className: "nf-cpick-popup fade-in"
  }, colors.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    className: "nf-cpick-swatch",
    onClick: () => {
      onChange(c);
      setOpen(false);
    },
    style: {
      border: c === "transparent" ? "1px dashed var(--border)" : "1px solid var(--border-light)",
      background: c
    }
  }))));
}
function RenameInput({
  id,
  initialValue,
  onRename,
  onCancel
}) {
  const [val, setVal] = useState(initialValue || "");
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, []);
  const commit = () => onRename(id, val);
  return /*#__PURE__*/React.createElement("input", {
    ref: ref,
    className: "nf-rename",
    value: val,
    onChange: e => setVal(e.target.value),
    onBlur: commit,
    onKeyDown: e => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      }
      if (e.key === "Escape") onCancel();
    },
    onClick: e => e.stopPropagation(),
    onMouseDown: e => e.stopPropagation()
  });
}

/* ═══════════════════════════════════════════════════════════════
   PASSWORD DIALOG (reusable overlay)
   ═══════════════════════════════════════════════════════════════ */
function PasswordDialog({
  title,
  subtitle,
  onSubmit,
  onCancel,
  confirmLabel,
  error,
  showConfirm,
  showHint,
  children,
  dark
}) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [hint, setHint] = useState("");
  const [localErr, setLocalErr] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const submit = () => {
    if (showConfirm && pw !== pw2) {
      setLocalErr("Passwords don't match");
      return;
    }
    if (!pw.trim()) {
      setLocalErr("Enter a password");
      return;
    }
    setLocalErr("");
    onSubmit(pw, hint);
  };
  const stop = e => e.stopPropagation();

  // Live password requirements (only shown when setting new password)
  const hasLen = pw.length >= 10;
  const hasUpper = /[A-Z]/.test(pw);
  const hasLower = /[a-z]/.test(pw);
  const hasDigit = /[0-9]/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  const classes = [hasUpper, hasLower, hasDigit, hasSymbol].filter(Boolean).length;
  const allMet = hasLen && classes >= 3;
  const Req = ({
    met,
    text
  }) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12,
      color: met ? "var(--success)" : "var(--text-muted)",
      transition: "color .15s"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14
    }
  }, met ? "✓" : "○"), text);
  return /*#__PURE__*/React.createElement("div", {
    className: "nf-overlay",
    style: dark ? THEMES.dark : THEMES.light,
    onClick: stop,
    onMouseDown: stop,
    onKeyDown: stop,
    onKeyUp: stop,
    onKeyPress: stop
  }, /*#__PURE__*/React.createElement("div", {
    className: "nf-overlay-card"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(I, {
    n: "shield",
    s: 32
  })), /*#__PURE__*/React.createElement("div", {
    className: "nf-overlay-title"
  }, title), /*#__PURE__*/React.createElement("div", {
    className: "nf-overlay-sub"
  }, subtitle), (error || localErr) && /*#__PURE__*/React.createElement("div", {
    className: "nf-overlay-error"
  }, error || localErr), /*#__PURE__*/React.createElement("input", {
    ref: ref,
    className: "nf-overlay-input",
    type: "password",
    placeholder: "Password",
    value: pw,
    onChange: e => setPw(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter" && (!showConfirm || pw2)) submit();
    }
  }), showConfirm && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("input", {
    className: "nf-overlay-input",
    type: "password",
    placeholder: "Confirm password",
    value: pw2,
    onChange: e => setPw2(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") submit();
    }
  }), pw.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "left",
      padding: "8px 12px",
      background: "var(--surface-alt)",
      borderRadius: 8,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-muted)",
      marginBottom: 6,
      textTransform: "uppercase",
      letterSpacing: ".5px"
    }
  }, "Password Requirements"), /*#__PURE__*/React.createElement(Req, {
    met: hasLen,
    text: "At least 10 characters"
  }), /*#__PURE__*/React.createElement(Req, {
    met: classes >= 3,
    text: "3 of 4: uppercase, lowercase, number, symbol"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      display: "flex",
      gap: 3
    }
  }, [hasUpper, hasLower, hasDigit, hasSymbol].map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      height: 3,
      borderRadius: 2,
      background: m ? "var(--success)" : "var(--border)",
      transition: "background .15s"
    }
  }))), pw2.length > 0 && pw !== pw2 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: "var(--danger)",
      fontSize: 11,
      marginTop: 6
    }
  }, "Passwords don't match"), allMet && pw === pw2 && pw2.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: "var(--success)",
      fontSize: 11,
      marginTop: 6
    }
  }, "Ready to encrypt")), showHint && /*#__PURE__*/React.createElement("input", {
    className: "nf-overlay-input",
    type: "text",
    placeholder: "Password hint (optional, stored unencrypted)",
    value: hint,
    onChange: e => setHint(e.target.value),
    style: {
      marginBottom: 12,
      fontSize: 12,
      opacity: .8
    }
  })), children, /*#__PURE__*/React.createElement("button", {
    className: "nf-overlay-btn primary",
    onClick: submit,
    style: showConfirm && (!allMet || pw !== pw2) ? {
      opacity: .5,
      cursor: "not-allowed"
    } : {},
    disabled: showConfirm && (!allMet || pw !== pw2)
  }, confirmLabel || "Unlock"), onCancel && /*#__PURE__*/React.createElement("button", {
    className: "nf-overlay-btn secondary",
    onClick: onCancel
  }, "Cancel")));
}

/* ═══════════════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════════════ */
function NoteForge() {
  const savedPrefs = useRef(prefsStore.load());
  const [data, setData] = useState(null);
  const [dark, setDark] = useState(savedPrefs.current.dark !== undefined ? savedPrefs.current.dark : true);
  const [navOpen, setNavOpen] = useState(savedPrefs.current.navOpen !== undefined ? savedPrefs.current.navOpen : true);
  const [wrap, setWrap] = useState(savedPrefs.current.wrap !== undefined ? savedPrefs.current.wrap : true);
  const [zoom, setZoom] = useState(savedPrefs.current.zoom || 100);
  const [aNb, setANb] = useState(null);
  const [aSec, setASec] = useState(null);
  const [aPg, setAPg] = useState(null);
  const [expNb, setExpNb] = useState({});
  const [showFR, setShowFR] = useState(false);
  const [findT, setFindT] = useState("");
  const [replT, setReplT] = useState("");
  const [gSearch, setGSearch] = useState("");
  const [gResults, setGResults] = useState([]);
  const [gFocused, setGFocused] = useState(false);
  const [pgFilter, setPgFilter] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [ctx, setCtx] = useState(null);
  const [edCtx, setEdCtx] = useState(null);
  const [stats, setStats] = useState({
    w: 0,
    c: 0,
    l: 0
  });
  const [saved, setSaved] = useState(true);

  // Encryption state
  const [appPhase, setAppPhase] = useState("loading"); // loading|needsPassword|ready
  const [encEnabled, setEncEnabled] = useState(false);
  const [masterHint, setMasterHint] = useState(null);
  const [pwDialog, setPwDialog] = useState(null); // null | {type,nbId,...}
  const [pwError, setPwError] = useState("");
  const [unlockedNbs, setUnlockedNbs] = useState(new Set());
  const [autoUpdate, setAutoUpdate] = useState(true); // loaded from config
  const [sandboxEnabled, setSandboxEnabled] = useState(true); // loaded from config (main-process setting)

  // Modal dialogs (custom replacements for native alert/confirm/prompt)
  const [confirmDialog, setConfirmDialog] = useState(null); // {title,message,confirmLabel,confirmStyle,resolve}
  const [promptDialog, setPromptDialog] = useState(null); // {title,message,placeholder,defaultValue,resolve}
  const [alertDialog, setAlertDialog] = useState(null); // {title,message}
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [restoreFlow, setRestoreFlow] = useState(null); // {backupPath,hasHint}
  // Toolbar reflection — tracks current format under cursor
  const [toolbarFmt, setToolbarFmt] = useState({
    block: "div",
    size: "3"
  });
  const edRef = useRef(null);
  const saveTimer = useRef(null);
  const statsTimer = useRef(null);
  const dataRef = useRef(null);
  dataRef.current = data;
  const aNbRef = useRef(null);
  aNbRef.current = aNb;
  const aSecRef = useRef(null);
  aSecRef.current = aSec;
  const nbKeys = useRef(new Map()); // nbId -> opaque nbKeyId (main-process session key handle)
  const [autoLockMin, setAutoLockMin] = useState(savedPrefs.current.autoLockMin || 15);

  // Promise-based confirm/prompt/alert helpers — wrap the modal state so call
  // sites read naturally: `if(await confirm("Delete?")) { ... }`
  const confirm = useCallback(opts => new Promise(resolve => {
    const o = typeof opts === "string" ? {
      message: opts
    } : opts;
    setConfirmDialog({
      title: o.title || "Confirm",
      message: o.message || "",
      confirmLabel: o.confirmLabel || "OK",
      confirmStyle: o.confirmStyle || "primary",
      resolve
    });
  }), []);
  const promptUser = useCallback(opts => new Promise(resolve => {
    const o = typeof opts === "string" ? {
      message: opts
    } : opts;
    setPromptDialog({
      title: o.title || "Input",
      message: o.message || "",
      placeholder: o.placeholder || "",
      defaultValue: o.defaultValue || "",
      confirmLabel: o.confirmLabel || "OK",
      resolve
    });
  }), []);
  const alertUser = useCallback(opts => new Promise(resolve => {
    const o = typeof opts === "string" ? {
      message: opts
    } : opts;
    setAlertDialog({
      title: o.title || "Notice",
      message: o.message || "",
      resolve
    });
  }), []);
  useEffect(() => {
    prefsStore.save({
      dark,
      navOpen,
      wrap,
      zoom,
      autoLockMin
    });
  }, [dark, navOpen, wrap, zoom, autoLockMin]);

  /* ── Lock / Auto-lock ────────────────────────────────────── */
  const idleTimer = useRef(null);
  const lockApp = useCallback(async () => {
    if (saveTimer.current && dataRef.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const sanitized = {
        ...sanitizeForDiskSync(dataRef.current),
        version: SCHEMA_VERSION
      };
      await store.set(JSON.stringify(sanitized));
    }
    if (window.electronAPI?.lockApp) await window.electronAPI.lockApp();
    nbKeys.current.clear();
    dataRef.current = null;
    setData(null);
    setANb(null);
    setASec(null);
    setAPg(null);
    setUnlockedNbs(new Set());
    prevPgRef.current = null; // Force editor to repaint content after unlock even if we land on the same page id
    if (encEnabled) setAppPhase("needsPassword");
  }, [encEnabled]);

  // Reset idle timer on any user interaction (throttled to ~1 Hz so mousemove
  // doesn't flood the call — we still lock after `autoLockMin` minutes)
  useEffect(() => {
    if (!encEnabled || appPhase !== "ready") return;
    const ms = autoLockMin * 60 * 1000;
    let lastReset = 0;
    const reset = () => {
      const now = Date.now();
      if (now - lastReset < 1000) return;
      lastReset = now;
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => lockApp(), ms);
    };
    reset();
    const events = ["mousedown", "mousemove", "keydown", "scroll", "wheel", "touchstart"];
    events.forEach(e => window.addEventListener(e, reset, {
      passive: true
    }));
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [encEnabled, appPhase, lockApp, autoLockMin]);

  // Force-flush on window close (sync so it completes before shutdown)
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current && dataRef.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        // CRITICAL: strip plaintext from locked notebooks before ANY write
        const sanitized = {
          ...sanitizeForDiskSync(dataRef.current),
          version: SCHEMA_VERSION
        };
        const json = JSON.stringify(sanitized);
        if (window.electronAPI?.storageSetSync) window.electronAPI.storageSetSync(json);else try {
          localStorage.setItem("noteforge-data", json);
        } catch {}
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  /* ── Navigate ────────────────────────────────────────────── */
  const navigateTo = useCallback((nbId, secId, pgId) => {
    setANb(nbId);
    setASec(secId);
    setAPg(pgId);
    if (nbId) setExpNb(p => ({
      ...p,
      [nbId]: true
    }));
    setShowTrash(false);
  }, []);
  const loadIntoState = useCallback(d => {
    dataRef.current = d;
    setData(d);
    const nb = d.notebooks[0];
    if (nb) {
      const isLocked = nb.locked && !nb.sections?.length;
      if (!isLocked) {
        const sec = nb.sections[0];
        if (sec) {
          const pg = sec.pages.find(p => !p.deleted);
          navigateTo(nb.id, sec.id, pg?.id || null);
        } else {
          setANb(nb.id);
          setExpNb({
            [nb.id]: true
          });
        }
      } else {
        setANb(nb.id);
        setExpNb({
          [nb.id]: true
        });
      }
    }
    setAppPhase("ready");
  }, [navigateTo]);

  /* ── Load (encryption-aware) ─────────────────────────────── */
  useEffect(() => {
    (async () => {
      // Load config
      if (window.electronAPI?.getConfig) {
        const cfg = await window.electronAPI.getConfig();
        if (cfg.autoUpdate !== undefined) setAutoUpdate(cfg.autoUpdate);
        if (cfg.sandbox !== undefined) setSandboxEnabled(cfg.sandbox !== false);
      }
      if (hasElectronCrypto()) {
        const status = await window.electronAPI.checkEncryption();
        setEncEnabled(status.encrypted);
        if (status.hint) setMasterHint(status.hint);
        if (status.encrypted) {
          setAppPhase("needsPassword");
          return;
        }
      }
      // Not encrypted — load normally
      let d = null;
      try {
        const r = await store.get();
        if (r?.value) d = JSON.parse(r.value);
      } catch {}
      if (!d || !d.notebooks) d = structuredClone(DEFAULT_DATA);
      loadIntoState(d);
    })();
  }, []);

  /* ── Persist ─────────────────────────────────────────────── */
  const persist = useCallback(async nd => {
    dataRef.current = nd; // Update ref IMMEDIATELY — don't wait for React re-render
    setData(nd);
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      let toSave = nd;
      // Step 1: Re-encrypt sections for any locked+unlocked-in-session notebooks
      // so edits are captured in the encrypted blob before we strip plaintext.
      // Uses cached main-process session key — no scrypt on the hot path.
      if (hasElectronCrypto()) {
        const nbs = await Promise.all(nd.notebooks.map(async nb => {
          if (nb.locked && nb.sections?.length > 0 && nbKeys.current.has(nb.id)) {
            const nbKeyId = nbKeys.current.get(nb.id);
            const r = await window.electronAPI.reencryptNotebookSections(JSON.stringify(nb.sections), nbKeyId);
            if (r.success) return {
              ...nb,
              encSections: r.blob
            };
          }
          return nb;
        }));
        toSave = {
          ...nd,
          notebooks: nbs
        };
      }
      // Step 2: MANDATORY — strip ALL plaintext from locked notebooks before writing
      // This is the safety net. Even if step 1 failed or was skipped, plaintext never hits disk.
      toSave = sanitizeForDiskSync(toSave);
      // Stamp schema version so future releases can migrate safely
      toSave = {
        ...toSave,
        version: SCHEMA_VERSION
      };
      await store.set(JSON.stringify(toSave));
      setSaved(true);
    }, 500);
  }, []);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  /* ── Derived ─────────────────────────────────────────────── */
  const curPage = useMemo(() => {
    if (!data || !aPg) return null;
    for (const nb of data.notebooks) for (const sec of nb.sections) {
      const pg = sec.pages.find(p => p.id === aPg && !p.deleted);
      if (pg) return pg;
    }
    return null;
  }, [data, aPg]);
  const curSection = useMemo(() => {
    if (!data || !aSec) return null;
    for (const nb of data.notebooks) {
      const sec = (nb.sections || []).find(s => s.id === aSec);
      if (sec) return sec;
    }
    return null;
  }, [data, aSec]);
  const curNotebook = useMemo(() => data?.notebooks?.find(n => n.id === aNb) || null, [data, aNb]);
  const sectionPages = useMemo(() => {
    if (!curSection) return [];
    let pages = curSection.pages.filter(p => !p.deleted);
    if (pgFilter.trim()) {
      const q = pgFilter.toLowerCase();
      pages = pages.filter(p => p.title.toLowerCase().includes(q));
    }
    return pages.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.modified - a.modified);
  }, [curSection, pgFilter]);
  const breadcrumb = useMemo(() => {
    if (!data || !aPg) return null;
    for (const nb of data.notebooks) for (const sec of nb.sections) if (sec.pages.find(p => p.id === aPg)) return {
      nb: nb.name,
      sec: sec.name,
      color: nb.color
    };
    return null;
  }, [data, aPg]);
  const trashPages = useMemo(() => {
    if (!data) return [];
    const r = [];
    for (const nb of data.notebooks) for (const sec of nb.sections || []) for (const pg of sec.pages) if (pg.deleted) r.push({
      ...pg,
      nbName: nb.name,
      secName: sec.name
    });
    return r;
  }, [data]);

  /* ── Editor content ──────────────────────────────────────── */
  const prevPgRef = useRef(null);
  useEffect(() => {
    if (!edRef.current) return;
    if (curPage && aPg !== prevPgRef.current) {
      edRef.current.innerHTML = sanitizeHTML(curPage.content) || "<p><br></p>";
      prevPgRef.current = aPg;
      updStats();
    } else if (!curPage && prevPgRef.current) {
      edRef.current.innerHTML = "";
      prevPgRef.current = null;
    }
  }, [aPg, curPage]);
  const updStats = useCallback(() => {
    if (statsTimer.current) clearTimeout(statsTimer.current);
    statsTimer.current = setTimeout(() => {
      if (!edRef.current) return;
      const t = edRef.current.innerText || "";
      setStats({
        w: t.trim() ? t.trim().split(/\s+/).length : 0,
        c: t.length,
        l: t.split("\n").length
      });
    }, 120);
  }, []);
  const updatePage = useCallback((pageId, updater) => {
    const d = dataRef.current;
    if (!d) return;
    const nd = {
      ...d,
      notebooks: d.notebooks.map(nb => ({
        ...nb,
        sections: (nb.sections || []).map(sec => {
          const idx = sec.pages.findIndex(p => p.id === pageId);
          if (idx === -1) return sec;
          const np = [...sec.pages];
          np[idx] = {
            ...np[idx],
            ...updater(np[idx])
          };
          return {
            ...sec,
            pages: np
          };
        })
      }))
    };
    persist(nd);
  }, [persist]);
  const onInput = useCallback(() => {
    if (!edRef.current || !dataRef.current || !aPg) return;
    updatePage(aPg, () => ({
      content: edRef.current.innerHTML,
      modified: Date.now()
    }));
    updStats();
  }, [aPg, updatePage, updStats]);
  const exec = useCallback((cmd, val = null) => {
    edRef.current?.focus();
    document.execCommand(cmd, false, val);
    setTimeout(() => onInput(), 10);
  }, [onInput]);

  /* ── Paste ───────────────────────────────────────────────── */
  const onPaste = useCallback(e => {
    const cd = e.clipboardData;
    if (!cd) return;
    // Check for images first
    for (const item of cd.items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        // Auto-downscale large images so the encrypted data file stays lean.
        // 5 MB hard cap to avoid canvas/memory pathologies.
        downscaleImage(file, 512000).then(dataUrl => {
          exec("insertHTML", `<img src="${dataUrl}" alt="">`);
        }).catch(err => {
          alertUser({
            title: "Image too large",
            message: err.message || "Could not process image."
          });
        });
        return;
      }
    }
    // Always prevent default — never let the browser insert raw clipboard HTML
    e.preventDefault();
    // Prefer plain text (strips all formatting — clean paste like OneNote)
    const text = cd.getData("text/plain");
    if (text) {
      document.execCommand("insertText", false, text);
      return;
    }
    // Fallback: if only HTML is available (rare), sanitize it
    const html = cd.getData("text/html");
    if (html) {
      const clean = sanitizeHTML(html);
      if (clean) document.execCommand("insertHTML", false, clean);
    }
  }, [exec, alertUser]);
  const onKeyDown = useCallback(e => {
    if (e.key === "Tab") {
      const sel = window.getSelection();
      if (sel.anchorNode) {
        let node = sel.anchorNode;
        while (node && node !== edRef.current) {
          if (node.nodeName === "PRE") {
            e.preventDefault();
            document.execCommand("insertText", false, "    ");
            return;
          }
          node = node.parentNode;
        }
      }
    }
  }, []);

  /* ── Shortcuts ───────────────────────────────────────────── */
  useEffect(() => {
    const h = e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "f") {
        e.preventDefault();
        setShowFR(p => !p);
      }
      if (mod && e.key === "h") {
        e.preventDefault();
        setShowFR(true);
      }
      if (mod && e.key === "d" && !e.shiftKey) {
        e.preventDefault();
        if (aPg) duplicatePage(aPg);
      }
      if (mod && e.key === "l") {
        e.preventDefault();
        if (encEnabled) lockApp();
      }
      if (e.key === "F1") {
        e.preventDefault();
        setShowShortcuts(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [aPg, encEnabled, lockApp]);

  /* ── Electron menu ───────────────────────────────────────── */
  useEffect(() => {
    if (!window.electronAPI) return;
    const cleanup = window.electronAPI.onMenuAction(a => {
      if (a === "toggle-sidebar") setNavOpen(p => !p);
      if (a === "toggle-theme") setDark(p => !p);
      if (a === "find-replace") setShowFR(p => !p);
      if (a === "zoom-in") setZoom(z => Math.min(200, z + 10));
      if (a === "zoom-out") setZoom(z => Math.max(50, z - 10));
      if (a === "zoom-reset") setZoom(100);
      if (a === "toggle-wrap") setWrap(p => !p);
      if (a === "export-html") doExportHTML();
      if (a === "export-text") doExportText();
      if (a === "print") {
        const nb = dataRef.current?.notebooks?.find(n => n.id === aNbRef.current);
        const isLocked = nb?.locked || false;
        window.electronAPI.printWithWarning(isLocked);
      }
      if (a === "open-data-folder") window.electronAPI.openDataFolder();
      if (a === "encryption-settings") setPwDialog({
        type: "enc-settings"
      });
      if (a === "export-backup") window.electronAPI.exportBackup();
      if (a === "restore-backup") (async () => {
        const r = await window.electronAPI.restoreBackup();
        if (r?.error) {
          alertUser({
            title: "Restore failed",
            message: r.error
          });
          return;
        }
        if (r?.readyForPassword) {
          setRestoreFlow({
            backupPath: r.backupPath,
            hasHint: r.hasHint
          });
        }
      })();
      if (a === "lock-app") {
        if (encEnabled) lockApp();
      }
      if (a === "empty-trash") emptyTrash();
      if (a === "show-shortcuts") setShowShortcuts(true);
      if (a === "new-notebook") addNotebook();
      if (a === "new-page") {
        const d = dataRef.current;
        if (!d) return;
        const nb = d.notebooks.find(n => n.id === aNbRef.current);
        if (nb && nb.sections?.length) {
          const sid = aSecRef.current && (nb.sections || []).find(s => s.id === aSecRef.current) ? aSecRef.current : nb.sections[0].id;
          addPage(nb.id, sid);
        }
      }
    });
    return cleanup;
  }, [encEnabled, lockApp]);

  // Track cursor format for heading/font-size select reflection
  useEffect(() => {
    if (!edRef.current) return;
    const sync = () => {
      try {
        // Only update when caret is actually inside the editor
        const sel = document.getSelection();
        if (!sel?.anchorNode || !edRef.current.contains(sel.anchorNode)) return;
        const block = (document.queryCommandValue("formatBlock") || "div").toLowerCase();
        const size = document.queryCommandValue("fontSize") || "3";
        setToolbarFmt(p => p.block === block && p.size === size ? p : {
          block,
          size
        });
      } catch {}
    };
    document.addEventListener("selectionchange", sync);
    return () => document.removeEventListener("selectionchange", sync);
  }, [curPage]);
  useEffect(() => {
    const h = () => {
      setCtx(null);
      setEdCtx(null);
    };
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, []);

  /* ═══════════════════════════════════════════════════════════
     CRUD
     ═══════════════════════════════════════════════════════════ */
  const addNotebook = () => {
    const id = uid();
    const d = dataRef.current;
    persist({
      ...d,
      notebooks: [...d.notebooks, {
        id,
        name: "New Notebook",
        color: NB_COLORS[d.notebooks.length % NB_COLORS.length],
        locked: false,
        encSections: null,
        sections: []
      }]
    });
    setANb(id);
    setASec(null);
    setAPg(null);
    setExpNb(p => ({
      ...p,
      [id]: true
    }));
    setEditId(id);
    setEditVal("New Notebook");
  };
  const addSection = nbId => {
    const id = uid();
    const d = dataRef.current;
    persist({
      ...d,
      notebooks: d.notebooks.map(n => n.id !== nbId ? n : {
        ...n,
        sections: [...(n.sections || []), {
          id,
          name: "New Section",
          color: n.color,
          pages: []
        }]
      })
    });
    setANb(nbId);
    setASec(id);
    setAPg(null);
    setExpNb(p => ({
      ...p,
      [nbId]: true
    }));
    setEditId(id);
    setEditVal("New Section");
  };
  const addPage = (nbId, secId) => {
    const id = uid();
    const d = dataRef.current;
    persist({
      ...d,
      notebooks: d.notebooks.map(nb => nb.id !== nbId ? nb : {
        ...nb,
        sections: (nb.sections || []).map(sec => sec.id !== secId ? sec : {
          ...sec,
          pages: [...sec.pages, {
            id,
            title: "New Page",
            content: "<p><br></p>",
            created: Date.now(),
            modified: Date.now(),
            pinned: false,
            deleted: false
          }]
        })
      })
    });
    navigateTo(nbId, secId, id);
    setEditId(id);
    setEditVal("New Page");
  };
  const duplicatePage = pgId => {
    const d = dataRef.current;
    if (!d) return;
    for (const nb of d.notebooks) for (const sec of nb.sections || []) {
      const pg = sec.pages.find(p => p.id === pgId);
      if (pg) {
        const id = uid();
        persist({
          ...d,
          notebooks: d.notebooks.map(n => n.id !== nb.id ? n : {
            ...n,
            sections: (n.sections || []).map(s => s.id !== sec.id ? s : {
              ...s,
              pages: [...s.pages, {
                ...pg,
                id,
                title: pg.title + " (copy)",
                created: Date.now(),
                modified: Date.now(),
                pinned: false
              }]
            })
          })
        });
        navigateTo(nb.id, sec.id, id);
        return;
      }
    }
  };
  const rename = (itemId, name) => {
    if (!name.trim()) name = "Untitled";
    const d = dataRef.current;
    persist({
      ...d,
      notebooks: d.notebooks.map(nb => {
        if (nb.id === itemId) return {
          ...nb,
          name
        };
        return {
          ...nb,
          sections: (nb.sections || []).map(sec => {
            if (sec.id === itemId) return {
              ...sec,
              name
            };
            return {
              ...sec,
              pages: sec.pages.map(pg => pg.id === itemId ? {
                ...pg,
                title: name
              } : pg)
            };
          })
        };
      })
    });
    setEditId(null);
  };
  const autoSelectNextPage = excludeId => {
    const d = dataRef.current;
    if (!d || !aSec) return;
    for (const nb of d.notebooks) for (const sec of nb.sections || []) if (sec.id === aSec) {
      const pg = sec.pages.find(p => !p.deleted && p.id !== excludeId);
      setAPg(pg?.id || null);
      return;
    }
    setAPg(null);
  };
  const softDelete = pid => {
    updatePage(pid, () => ({
      deleted: true,
      modified: Date.now()
    }));
    if (aPg === pid) autoSelectNextPage(pid);
  };
  const restorePage = pid => updatePage(pid, () => ({
    deleted: false
  }));
  const permDelete = async pid => {
    if (!(await confirm({
      title: "Delete Forever",
      message: "Permanently delete this page? This cannot be undone.",
      confirmLabel: "Delete Forever",
      confirmStyle: "danger"
    }))) return;
    const d = dataRef.current;
    persist({
      ...d,
      notebooks: d.notebooks.map(nb => ({
        ...nb,
        sections: (nb.sections || []).map(sec => ({
          ...sec,
          pages: sec.pages.filter(p => p.id !== pid)
        }))
      }))
    });
    if (aPg === pid) autoSelectNextPage(pid);
  };
  const togglePin = pid => {
    for (const nb of dataRef.current.notebooks) for (const sec of nb.sections || []) if (sec.pages.find(p => p.id === pid)) {
      updatePage(pid, p => ({
        pinned: !p.pinned
      }));
      return;
    }
  };
  const delSection = async sid => {
    const d = dataRef.current;
    let count = 0;
    let parentNb = null;
    for (const nb of d.notebooks) for (const sec of nb.sections || []) if (sec.id === sid) {
      count = sec.pages.length;
      parentNb = nb;
    }
    const ok = await confirm({
      title: "Delete Section",
      message: count > 0 ? `Delete section and ${count} page${count > 1 ? "s" : ""}? This cannot be undone.` : "Delete empty section?",
      confirmLabel: "Delete",
      confirmStyle: "danger"
    });
    if (!ok) return;
    persist({
      ...d,
      notebooks: d.notebooks.map(nb => ({
        ...nb,
        sections: (nb.sections || []).filter(s => s.id !== sid)
      }))
    });
    if (aSec === sid) {
      // Auto-select next section in same notebook
      const remaining = (parentNb?.sections || []).filter(s => s.id !== sid);
      if (remaining[0]) {
        setASec(remaining[0].id);
        const pg = remaining[0].pages.find(p => !p.deleted);
        setAPg(pg?.id || null);
      } else {
        setASec(null);
        setAPg(null);
      }
    }
  };
  const delNotebook = async nid => {
    const d = dataRef.current;
    const nb = d.notebooks.find(n => n.id === nid);
    const pc = nb ? (nb.sections || []).reduce((a, s) => a + s.pages.length, 0) : 0;
    const ok = await confirm({
      title: "Delete Notebook",
      message: pc > 0 ? `Delete "${nb.name}" and all ${pc} pages? This cannot be undone.` : `Delete "${nb?.name}"?`,
      confirmLabel: "Delete",
      confirmStyle: "danger"
    });
    if (!ok) return;
    persist({
      ...d,
      notebooks: d.notebooks.filter(n => n.id !== nid)
    });
    const keyId = nbKeys.current.get(nid);
    if (keyId && window.electronAPI?.forgetNotebookKey) window.electronAPI.forgetNotebookKey(keyId);
    nbKeys.current.delete(nid);
    if (aNb === nid) {
      setANb(null);
      setASec(null);
      setAPg(null);
    }
  };
  // Empty trash — removes all soft-deleted pages
  const emptyTrash = async () => {
    const d = dataRef.current;
    if (!d) return;
    let n = 0;
    for (const nb of d.notebooks) for (const sec of nb.sections || []) for (const pg of sec.pages) if (pg.deleted) n++;
    if (n === 0) {
      alertUser({
        title: "Trash is empty",
        message: "Nothing to clean up."
      });
      return;
    }
    const ok = await confirm({
      title: "Empty Trash",
      message: `Permanently delete ${n} page${n > 1 ? "s" : ""} from trash? This cannot be undone.`,
      confirmLabel: "Empty Trash",
      confirmStyle: "danger"
    });
    if (!ok) return;
    persist({
      ...d,
      notebooks: d.notebooks.map(nb => ({
        ...nb,
        sections: (nb.sections || []).map(sec => ({
          ...sec,
          pages: sec.pages.filter(p => !p.deleted)
        }))
      }))
    });
  };
  // Re-lock a notebook in-session — discards in-memory plaintext and the cached session key
  const relockNotebook = async nbId => {
    const d = dataRef.current;
    const nb = d.notebooks.find(n => n.id === nbId);
    if (!nb || !nb.locked || !nb.encSections) return;
    const ok = await confirm({
      title: `Re-lock "${nb.name}"?`,
      message: "You'll need to re-enter the notebook password to view these pages again.",
      confirmLabel: "Re-lock"
    });
    if (!ok) return;
    const keyId = nbKeys.current.get(nbId);
    if (keyId && window.electronAPI?.forgetNotebookKey) await window.electronAPI.forgetNotebookKey(keyId);
    nbKeys.current.delete(nbId);
    // Strip plaintext sections from in-memory state (encSections is already on disk-authoritative)
    const nd = {
      ...d,
      notebooks: d.notebooks.map(n => n.id !== nbId ? n : {
        ...n,
        sections: []
      })
    };
    persist(nd);
    setUnlockedNbs(p => {
      const s = new Set(p);
      s.delete(nbId);
      return s;
    });
    if (aNb === nbId && !nb.sections?.length) {
      setASec(null);
      setAPg(null);
    }
  };

  /* ═══ Notebook Lock/Unlock ═════════════════════════════════ */
  const lockNotebook = async (nbId, password) => {
    if (!hasElectronCrypto()) return {
      error: "Encryption not available"
    };
    const d = dataRef.current;
    const nb = d.notebooks.find(n => n.id === nbId);
    if (!nb || !nb.sections?.length) return {
      error: "Nothing to lock"
    };
    const r = await window.electronAPI.encryptNotebookSections(JSON.stringify(nb.sections), password);
    if (!r.success) return {
      error: r.error
    };
    // Store only the opaque handle to the main-process session key. Password is discarded here.
    if (r.nbKeyId) nbKeys.current.set(nbId, r.nbKeyId);
    // Keep sections in memory (user still has access this session).
    // sanitizeForDiskSync() strips them before every write — plaintext never reaches disk.
    const nd = {
      ...d,
      notebooks: d.notebooks.map(n => n.id !== nbId ? n : {
        ...n,
        locked: true,
        encSections: r.blob
      })
    };
    persist(nd);
    setUnlockedNbs(p => {
      const s = new Set(p);
      s.add(nbId);
      return s;
    });
    return {};
  };
  const unlockNotebook = async (nbId, password) => {
    if (!hasElectronCrypto()) return {
      error: "Encryption not available"
    };
    const d = dataRef.current;
    const nb = d.notebooks.find(n => n.id === nbId);
    if (!nb || !nb.locked || !nb.encSections) return {
      error: "Not locked"
    };
    const r = await window.electronAPI.decryptNotebookSections(nb.encSections, password);
    if (!r.success) return {
      error: r.error
    };
    try {
      const sections = JSON.parse(r.sections);
      if (r.nbKeyId) nbKeys.current.set(nbId, r.nbKeyId);
      const nd = {
        ...d,
        notebooks: d.notebooks.map(n => n.id !== nbId ? n : {
          ...n,
          sections
        })
      };
      dataRef.current = nd;
      setData(nd);
      setUnlockedNbs(p => {
        const s = new Set(p);
        s.add(nbId);
        return s;
      });
      // Auto-select first page
      if (sections[0]) {
        setASec(sections[0].id);
        const pg = sections[0].pages?.find(p => !p.deleted);
        setAPg(pg?.id || null);
      } else {
        setASec(null);
        setAPg(null);
      }
      return {};
    } catch {
      return {
        error: "Corrupted data"
      };
    }
  };
  const removeNotebookLock = nbId => {
    const d = dataRef.current;
    const nd = {
      ...d,
      notebooks: d.notebooks.map(n => n.id !== nbId ? n : {
        ...n,
        locked: false,
        encSections: null
      })
    };
    persist(nd);
    const keyId = nbKeys.current.get(nbId);
    if (keyId && window.electronAPI?.forgetNotebookKey) window.electronAPI.forgetNotebookKey(keyId);
    nbKeys.current.delete(nbId);
    setUnlockedNbs(p => {
      const s = new Set(p);
      s.delete(nbId);
      return s;
    });
  };
  const isNbLocked = nb => nb.locked && (!nb.sections || nb.sections.length === 0) && !unlockedNbs.has(nb.id);

  /* ═══ Find & Replace ═══════════════════════════════════════ */
  const doFind = () => {
    if (!findT || !edRef.current) return;
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(edRef.current);
    sel.removeAllRanges();
    sel.addRange(r);
    if (window.find) window.find(findT, false, false, true);
  };
  const doReplace = () => {
    if (!findT || !edRef.current) return;
    const sel = window.getSelection();
    if (sel.toString().toLowerCase() === findT.toLowerCase()) document.execCommand("insertText", false, replT);
    doFind();
  };
  const doReplAll = () => {
    if (!findT || !edRef.current) return;
    const walker = document.createTreeWalker(edRef.current, NodeFilter.SHOW_TEXT, null);
    const escaped = findT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const re = new RegExp(escaped, "gi");
      if (re.test(node.textContent)) node.textContent = node.textContent.replace(new RegExp(escaped, "gi"), replT);
    }
    onInput();
  };

  /* ═══ Global Search ════════════════════════════════════════ */
  const searchTimer = useRef(null);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!gSearch.trim() || !data) {
      setGResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      const q = gSearch.toLowerCase(),
        res = [];
      for (const nb of data.notebooks) for (const sec of nb.sections || []) for (const pg of sec.pages) {
        if (pg.deleted) continue;
        const text = (pg.title + " " + (pg.content || "").replace(/<[^>]*>/g, " ")).toLowerCase();
        if (text.includes(q)) res.push({
          nbId: nb.id,
          secId: sec.id,
          page: pg,
          nbName: nb.name,
          secName: sec.name
        });
      }
      setGResults(res);
    }, 150);
  }, [gSearch, data]);

  /* ═══ Insert Helpers ═══════════════════════════════════════ */
  const insertTable = () => exec("insertHTML", '<table><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr></table><p><br></p>');
  const insertCheck = () => {
    const id = uid();
    exec("insertHTML", `<div class="nf-check"><input type="checkbox" id="${id}"><label for="${id}">To-do item</label></div>`);
  };
  const insertLink = async () => {
    const sel = window.getSelection();
    const selText = sel?.toString() || "";
    const url = await promptUser({
      title: "Insert Link",
      message: selText ? `Link URL for "${selText.slice(0, 40)}"` : "Enter URL",
      placeholder: "https://example.com",
      defaultValue: "https://"
    });
    if (!url || !url.trim() || url.trim() === "https://") return;
    const safe = escHtml(url.trim());
    const text = escHtml(selText || url.trim());
    exec("insertHTML", `<a href="${safe}" title="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`);
  };

  /* ═══ Export ═══════════════════════════════════════════════ */
  const doExportHTML = async () => {
    if (!curPage) return;
    // Re-sanitize on export — storage may contain pre-DOMPurify HTML from older versions
    const cleanHTML = sanitizeHTML(curPage.content || "");
    const parentNb = aNb ? dataRef.current?.notebooks.find(n => n.id === aNb) : null;
    const isLocked = !!parentNb?.locked;
    if (window.electronAPI) await window.electronAPI.exportHTML(curPage.title, cleanHTML, isLocked);else {
      const doc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escHtml(curPage.title)}</title><style>body{font-family:'DM Sans',sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.7;color:#1a1a1a}h1,h2,h3,h4{margin:.5em 0 .3em}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}pre{background:#f5f5f5;padding:14px;border-radius:8px;overflow-x:auto}code{background:#f5f5f5;padding:2px 6px;border-radius:4px}blockquote{border-left:3px solid #6359d0;padding-left:14px;opacity:.85}</style></head><body>${cleanHTML}</body></html>`;
      const b = new Blob([doc], {
        type: "text/html"
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = curPage.title.replace(/[^a-z0-9]/gi, "_") + ".html";
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };
  const doExportText = async () => {
    if (!curPage || !edRef.current) return;
    const text = edRef.current.innerText;
    const parentNb = aNb ? dataRef.current?.notebooks.find(n => n.id === aNb) : null;
    const isLocked = !!parentNb?.locked;
    if (window.electronAPI) await window.electronAPI.exportText(curPage.title, text, isLocked);else {
      const b = new Blob([text], {
        type: "text/plain"
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = curPage.title.replace(/[^a-z0-9]/gi, "_") + ".txt";
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };
  const findItem = id => {
    if (!data) return null;
    for (const nb of data.notebooks) {
      if (nb.id === id) return {
        type: "notebook",
        item: nb
      };
      for (const sec of nb.sections || []) {
        if (sec.id === id) return {
          type: "section",
          item: sec
        };
        for (const pg of sec.pages) if (pg.id === id) return {
          type: "page",
          item: pg
        };
      }
    }
    return null;
  };

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */
  const tv = dark ? THEMES.dark : THEMES.light;

  // Loading
  if (appPhase === "loading") return /*#__PURE__*/React.createElement("div", {
    className: "nf-overlay",
    style: tv
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 28,
      fontWeight: 700
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--accent)"
    }
  }, "Note"), "Forge"), /*#__PURE__*/React.createElement("div", {
    style: {
      opacity: .4,
      marginTop: 10,
      fontSize: 13
    }
  }, "Loading\u2026")));

  // Master password prompt
  if (appPhase === "needsPassword") return /*#__PURE__*/React.createElement(PasswordDialog, {
    dark: dark,
    title: "Unlock NoteForge",
    subtitle: masterHint ? `Enter your master password. Hint: ${masterHint}` : "Enter your master password to decrypt your notes.",
    confirmLabel: "Unlock",
    error: pwError,
    onSubmit: async pw => {
      setPwError("");
      const r = await window.electronAPI.unlockMaster(pw);
      if (r.error) {
        setPwError(r.error);
        return;
      }
      setEncEnabled(true);
      let d = null;
      try {
        d = JSON.parse(r.value);
      } catch {}
      if (!d || !d.notebooks) d = structuredClone(DEFAULT_DATA);
      loadIntoState(d);
    }
  });
  if (!data) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "nf-root",
    style: tv
  }, pwDialog?.type === "enc-settings" && /*#__PURE__*/React.createElement("div", {
    className: "nf-overlay",
    style: tv,
    onClick: e => e.stopPropagation(),
    onMouseDown: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "nf-overlay-card"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(I, {
    n: "shield",
    s: 32
  })), /*#__PURE__*/React.createElement("div", {
    className: "nf-overlay-title"
  }, "Settings"), /*#__PURE__*/React.createElement("div", {
    className: "nf-overlay-sub"
  }, "Encryption, auto-lock, and updates."), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "left",
      fontSize: 13,
      marginBottom: 16,
      padding: "10px 12px",
      background: "var(--surface-alt)",
      borderRadius: 8
    }
  }, "Encryption: ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: encEnabled ? "var(--success)" : "var(--text-muted)"
    }
  }, encEnabled ? "Enabled (AES-256-GCM)" : "Not enabled")), encEnabled && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "left",
      fontSize: 13,
      marginBottom: 16,
      padding: "10px 12px",
      background: "var(--surface-alt)",
      borderRadius: 8,
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", null, "Auto-lock after"), /*#__PURE__*/React.createElement("select", {
    value: autoLockMin,
    onChange: e => setAutoLockMin(Number(e.target.value)),
    style: {
      padding: "4px 8px",
      borderRadius: 6,
      border: "1px solid var(--border)",
      background: "var(--bg)",
      color: "var(--text)",
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: 5
  }, "5 min"), /*#__PURE__*/React.createElement("option", {
    value: 15
  }, "15 min"), /*#__PURE__*/React.createElement("option", {
    value: 30
  }, "30 min"), /*#__PURE__*/React.createElement("option", {
    value: 60
  }, "60 min")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--text-muted)"
    }
  }, "of inactivity")), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "left",
      fontSize: 13,
      marginBottom: 16,
      padding: "10px 12px",
      background: "var(--surface-alt)",
      borderRadius: 8,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", null, "Auto-update"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--text-muted)"
    }
  }, "Check GitHub for new versions on launch")), /*#__PURE__*/React.createElement("label", {
    style: {
      position: "relative",
      width: 40,
      height: 22,
      flexShrink: 0,
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: autoUpdate,
    onChange: async e => {
      const val = e.target.checked;
      setAutoUpdate(val);
      if (window.electronAPI?.setConfig) await window.electronAPI.setConfig("autoUpdate", val);
    },
    style: {
      opacity: 0,
      width: 0,
      height: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      inset: 0,
      borderRadius: 11,
      background: autoUpdate ? "var(--accent)" : "var(--border)",
      transition: "background .2s"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 2,
      left: autoUpdate ? 20 : 2,
      width: 18,
      height: 18,
      borderRadius: "50%",
      background: "#fff",
      transition: "left .2s",
      boxShadow: "0 1px 3px rgba(0,0,0,.3)"
    }
  })))), !encEnabled && /*#__PURE__*/React.createElement("button", {
    className: "nf-overlay-btn primary",
    onClick: () => setPwDialog({
      type: "enable-enc"
    })
  }, "Enable Encryption"), encEnabled && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    className: "nf-overlay-btn primary",
    onClick: () => setPwDialog({
      type: "change-pw"
    })
  }, "Change Password"), /*#__PURE__*/React.createElement("button", {
    className: "nf-overlay-btn danger",
    onClick: () => setPwDialog({
      type: "disable-enc"
    })
  }, "Remove Encryption")), /*#__PURE__*/React.createElement("button", {
    className: "nf-overlay-btn secondary",
    onClick: () => setPwDialog(null)
  }, "Close"))), pwDialog?.type === "enable-enc" && /*#__PURE__*/React.createElement(PasswordDialog, {
    dark: dark,
    title: "Enable Encryption",
    subtitle: "Choose a master password. Don't forget it \u2014 there's no recovery.",
    confirmLabel: "Encrypt",
    showConfirm: true,
    showHint: true,
    error: pwError,
    onCancel: () => {
      setPwDialog({
        type: "enc-settings"
      });
      setPwError("");
    },
    onSubmit: async (pw, hint) => {
      setPwError("");
      const r = await window.electronAPI.enableEncryption(pw, hint);
      if (r.error) {
        setPwError(r.error);
        return;
      }
      setEncEnabled(true);
      if (hint) setMasterHint(hint);
      setPwDialog({
        type: "enc-settings"
      });
    }
  }), pwDialog?.type === "disable-enc" && /*#__PURE__*/React.createElement(PasswordDialog, {
    dark: dark,
    title: "Remove Encryption",
    subtitle: "Enter your current password to decrypt all data.",
    confirmLabel: "Remove Encryption",
    error: pwError,
    onCancel: () => {
      setPwDialog({
        type: "enc-settings"
      });
      setPwError("");
    },
    onSubmit: async pw => {
      setPwError("");
      const r = await window.electronAPI.disableEncryption(pw);
      if (r.error) {
        setPwError(r.error);
        return;
      }
      setEncEnabled(false);
      setPwDialog({
        type: "enc-settings"
      });
    }
  }), pwDialog?.type === "change-pw" && /*#__PURE__*/React.createElement(PasswordDialog, {
    dark: dark,
    title: "Change Password \u2014 Step 1",
    subtitle: "Enter your current password.",
    confirmLabel: "Next",
    error: pwError,
    onCancel: () => {
      setPwDialog({
        type: "enc-settings"
      });
      setPwError("");
    },
    onSubmit: async oldPw => {
      setPwError("");
      setPwDialog({
        type: "change-pw-new",
        oldPw
      });
    }
  }), pwDialog?.type === "change-pw-new" && /*#__PURE__*/React.createElement(PasswordDialog, {
    dark: dark,
    title: "Change Password \u2014 Step 2",
    subtitle: "Choose your new password.",
    confirmLabel: "Change Password",
    showConfirm: true,
    error: pwError,
    onCancel: () => {
      setPwDialog({
        type: "enc-settings"
      });
      setPwError("");
    },
    onSubmit: async newPw => {
      setPwError("");
      const r = await window.electronAPI.changeMasterPassword(pwDialog.oldPw, newPw);
      if (r.error) {
        setPwError(r.error);
        return;
      }
      setPwDialog({
        type: "enc-settings"
      });
    }
  }), pwDialog?.type === "lock-nb" && /*#__PURE__*/React.createElement(PasswordDialog, {
    dark: dark,
    title: "Lock Notebook",
    subtitle: `Set a password for "${pwDialog.name}".`,
    confirmLabel: "Lock",
    showConfirm: true,
    error: pwError,
    onCancel: () => {
      setPwDialog(null);
      setPwError("");
    },
    onSubmit: async pw => {
      setPwError("");
      const r = await lockNotebook(pwDialog.nbId, pw);
      if (r.error) {
        setPwError(r.error);
        return;
      }
      setPwDialog(null);
    }
  }), pwDialog?.type === "unlock-nb" && /*#__PURE__*/React.createElement(PasswordDialog, {
    dark: dark,
    title: "Unlock Notebook",
    subtitle: `Enter password for "${pwDialog.name}".`,
    confirmLabel: "Unlock",
    error: pwError,
    onCancel: () => {
      setPwDialog(null);
      setPwError("");
    },
    onSubmit: async pw => {
      setPwError("");
      const r = await unlockNotebook(pwDialog.nbId, pw);
      if (r.error) {
        setPwError(r.error);
        return;
      }
      setPwDialog(null);
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "nf-header"
  }, /*#__PURE__*/React.createElement(Btn, {
    icon: "sidebar",
    label: "Toggle Navigation",
    onClick: () => setNavOpen(!navOpen),
    active: navOpen
  }), /*#__PURE__*/React.createElement("div", {
    className: "nf-logo"
  }, /*#__PURE__*/React.createElement("span", {
    className: "nf-logo-accent"
  }, "Note"), "Forge"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      maxWidth: 360,
      position: "relative",
      marginLeft: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 9,
      top: "50%",
      transform: "translateY(-50%)",
      color: "var(--text-muted)",
      pointerEvents: "none"
    }
  }, /*#__PURE__*/React.createElement(I, {
    n: "search",
    s: 13
  })), /*#__PURE__*/React.createElement("input", {
    placeholder: "Search all notes\u2026",
    value: gSearch,
    onChange: e => setGSearch(e.target.value),
    onFocus: () => setGFocused(true),
    onBlur: () => setTimeout(() => setGFocused(false), 250),
    style: {
      width: "100%",
      height: 30,
      paddingLeft: 30,
      paddingRight: 10,
      border: "1px solid var(--border)",
      borderRadius: 8,
      background: "var(--bg)",
      color: "var(--text)",
      fontSize: 12.5,
      outline: "none"
    }
  }), gResults.length > 0 && gFocused && /*#__PURE__*/React.createElement("div", {
    className: "nf-gsearch-dropdown fade-in"
  }, gResults.slice(0, 20).map(r => {
    // Highlight matching text
    const hl = text => {
      if (!gSearch.trim()) return text;
      const idx = text.toLowerCase().indexOf(gSearch.toLowerCase());
      if (idx === -1) return text;
      return /*#__PURE__*/React.createElement(React.Fragment, null, text.slice(0, idx), /*#__PURE__*/React.createElement("mark", {
        style: {
          background: "var(--accent-bg)",
          color: "var(--accent)",
          borderRadius: 2,
          padding: "0 1px"
        }
      }, text.slice(idx, idx + gSearch.length)), text.slice(idx + gSearch.length));
    };
    const preview = snippet(r.page.content);
    return /*#__PURE__*/React.createElement("div", {
      key: r.page.id,
      className: "nf-gsearch-item",
      onMouseDown: e => {
        e.preventDefault();
        navigateTo(r.nbId, r.secId, r.page.id);
        setGSearch("");
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 600
      }
    }, hl(r.page.title)), preview && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--text-muted)",
        marginTop: 1
      }
    }, hl(preview)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: "var(--text-muted)",
        opacity: .6
      }
    }, r.nbName, " \u203A ", r.secName));
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), encEnabled && /*#__PURE__*/React.createElement(Btn, {
    icon: "lock",
    label: "Lock App (Ctrl+L)",
    onClick: lockApp,
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "dl",
    label: "Export HTML",
    onClick: doExportHTML
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "print",
    label: "Print",
    onClick: () => {
      if (window.electronAPI) {
        const nb = data?.notebooks?.find(n => n.id === aNb);
        window.electronAPI.printWithWarning(nb?.locked || false);
      } else window.print();
    }
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: dark ? "sun" : "moon",
    label: "Toggle Theme",
    onClick: () => setDark(!dark)
  })), /*#__PURE__*/React.createElement("div", {
    className: "nf-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: `nf-nav${navOpen ? "" : " collapsed"}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "nf-nav-scroll"
  }, data.notebooks.map(nb => {
    const locked = isNbLocked(nb);
    return /*#__PURE__*/React.createElement("div", {
      key: nb.id
    }, /*#__PURE__*/React.createElement("div", {
      className: `nf-nb${aNb === nb.id ? " active" : ""}`,
      onClick: () => {
        if (editId === nb.id) return;
        if (locked) {
          setPwDialog({
            type: "unlock-nb",
            nbId: nb.id,
            name: nb.name
          });
          return;
        }
        const switchingNb = aNb !== nb.id;
        setANb(nb.id);
        setShowTrash(false);
        if (switchingNb) {
          // Switched to a different notebook — sync sec/page panes, don't leave stale state
          setPgFilter("");
          const sec = nb.sections?.[0];
          if (sec) {
            setASec(sec.id);
            const pg = sec.pages.find(p => !p.deleted);
            setAPg(pg?.id || null);
          } else {
            setASec(null);
            setAPg(null);
          }
          // Force expand on switch so the user immediately sees the notebook's sections
          setExpNb(p => ({
            ...p,
            [nb.id]: true
          }));
        } else {
          // Same notebook clicked — just toggle expand, keep current section/page
          setExpNb(p => ({
            ...p,
            [nb.id]: !p[nb.id]
          }));
        }
      },
      onContextMenu: e => {
        e.preventDefault();
        setCtx({
          x: e.clientX,
          y: e.clientY,
          id: nb.id
        });
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: `nf-nb-chevron${expNb[nb.id] ? " open" : ""}`
    }, /*#__PURE__*/React.createElement(I, {
      n: "chev",
      s: 11
    })), /*#__PURE__*/React.createElement("div", {
      className: "nf-nb-color",
      style: {
        background: nb.color
      }
    }), editId === nb.id ? /*#__PURE__*/React.createElement(RenameInput, {
      id: nb.id,
      initialValue: editVal,
      onRename: rename,
      onCancel: () => setEditId(null)
    }) : /*#__PURE__*/React.createElement("span", {
      className: "nf-nb-name"
    }, nb.name), locked && /*#__PURE__*/React.createElement("span", {
      className: "nf-lock-badge"
    }, /*#__PURE__*/React.createElement(I, {
      n: "lock",
      s: 12
    })), nb.locked && !locked && /*#__PURE__*/React.createElement("span", {
      className: "nf-lock-badge",
      style: {
        opacity: .3
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "unlock",
      s: 12
    }))), expNb[nb.id] && !locked && /*#__PURE__*/React.createElement(React.Fragment, null, (nb.sections || []).map(sec => /*#__PURE__*/React.createElement("div", {
      key: sec.id,
      className: `nf-sec${aSec === sec.id ? " active" : ""}`,
      onClick: () => {
        if (editId === sec.id) return;
        setANb(nb.id);
        setASec(sec.id);
        setShowTrash(false);
        setPgFilter("");
        const pg = sec.pages.find(p => !p.deleted);
        setAPg(pg?.id || null);
      },
      onContextMenu: e => {
        e.preventDefault();
        setCtx({
          x: e.clientX,
          y: e.clientY,
          id: sec.id
        });
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "nf-sec-bar",
      style: {
        background: sec.color || nb.color
      }
    }), editId === sec.id ? /*#__PURE__*/React.createElement(RenameInput, {
      id: sec.id,
      initialValue: editVal,
      onRename: rename,
      onCancel: () => setEditId(null)
    }) : /*#__PURE__*/React.createElement("span", {
      className: "nf-sec-name"
    }, sec.name), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        color: "var(--text-muted)",
        flexShrink: 0
      }
    }, sec.pages.filter(p => !p.deleted).length))), /*#__PURE__*/React.createElement("div", {
      className: "nf-add-btn",
      style: {
        marginLeft: 10
      },
      onClick: () => addSection(nb.id)
    }, /*#__PURE__*/React.createElement(I, {
      n: "plus",
      s: 11
    }), /*#__PURE__*/React.createElement("span", null, "Add Section"))));
  })), /*#__PURE__*/React.createElement("div", {
    className: "nf-nav-footer"
  }, /*#__PURE__*/React.createElement("div", {
    className: "nf-add-btn",
    onClick: addNotebook
  }, /*#__PURE__*/React.createElement(I, {
    n: "plus",
    s: 13
  }), /*#__PURE__*/React.createElement("span", null, "New Notebook")), /*#__PURE__*/React.createElement("div", {
    className: `nf-add-btn${showTrash ? " active" : ""}`,
    style: showTrash ? {
      color: "var(--accent)"
    } : {},
    onClick: () => setShowTrash(!showTrash)
  }, /*#__PURE__*/React.createElement(I, {
    n: "trash",
    s: 13
  }), /*#__PURE__*/React.createElement("span", null, "Trash", trashPages.length > 0 ? ` (${trashPages.length})` : "")))), aSec && !showTrash && /*#__PURE__*/React.createElement("div", {
    className: "nf-pages"
  }, /*#__PURE__*/React.createElement("div", {
    className: "nf-pages-header"
  }, /*#__PURE__*/React.createElement("div", {
    className: "nf-pages-title"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 4,
      height: 16,
      borderRadius: 2,
      background: curNotebook?.color || "var(--accent)",
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, curSection?.name || "Section")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 8,
      top: "50%",
      transform: "translateY(-50%)",
      color: "var(--text-muted)",
      pointerEvents: "none"
    }
  }, /*#__PURE__*/React.createElement(I, {
    n: "search",
    s: 12
  })), /*#__PURE__*/React.createElement("input", {
    className: "nf-pages-search",
    placeholder: "Filter pages\u2026",
    value: pgFilter,
    onChange: e => setPgFilter(e.target.value)
  }))), /*#__PURE__*/React.createElement("div", {
    className: "nf-pages-scroll"
  }, sectionPages.length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "24px 12px",
      textAlign: "center",
      color: "var(--text-muted)",
      fontSize: 12
    }
  }, pgFilter ? "No matching pages" : "No pages yet") : sectionPages.map(pg => /*#__PURE__*/React.createElement("div", {
    key: pg.id,
    className: `nf-pg${aPg === pg.id ? " active" : ""}`,
    onClick: () => {
      if (editId === pg.id) return;
      navigateTo(aNb, aSec, pg.id);
    },
    onContextMenu: e => {
      e.preventDefault();
      setCtx({
        x: e.clientX,
        y: e.clientY,
        id: pg.id
      });
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "nf-pg-title"
  }, pg.pinned && /*#__PURE__*/React.createElement("span", {
    className: "nf-pg-pin"
  }, "\uD83D\uDCCC "), editId === pg.id ? /*#__PURE__*/React.createElement(RenameInput, {
    id: pg.id,
    initialValue: editVal,
    onRename: rename,
    onCancel: () => setEditId(null)
  }) : pg.title), /*#__PURE__*/React.createElement("div", {
    className: "nf-pg-preview"
  }, snippet(pg.content)), /*#__PURE__*/React.createElement("div", {
    className: "nf-pg-meta"
  }, new Date(pg.modified).toLocaleDateString())))), /*#__PURE__*/React.createElement("div", {
    className: "nf-pages-footer"
  }, /*#__PURE__*/React.createElement("div", {
    className: "nf-add-btn",
    onClick: () => addPage(aNb, aSec)
  }, /*#__PURE__*/React.createElement(I, {
    n: "plus",
    s: 13
  }), /*#__PURE__*/React.createElement("span", null, "New Page")))), /*#__PURE__*/React.createElement("div", {
    className: "nf-editor-wrap"
  }, showTrash ? /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      padding: 28
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 20,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      gap: 8,
      flex: 1,
      margin: 0
    }
  }, /*#__PURE__*/React.createElement(I, {
    n: "trash",
    s: 20
  }), " Trash"), trashPages.length > 0 && /*#__PURE__*/React.createElement("button", {
    className: "nf-trash-btn",
    onClick: emptyTrash,
    style: {
      border: "1px solid var(--danger)",
      background: "transparent",
      color: "var(--danger)",
      fontWeight: 600
    }
  }, "Empty Trash (", trashPages.length, ")")), !trashPages.length ? /*#__PURE__*/React.createElement("div", {
    style: {
      color: "var(--text-muted)",
      padding: 48,
      textAlign: "center"
    }
  }, "Trash is empty") : trashPages.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    className: "nf-trash-item"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600
    }
  }, p.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--text-muted)"
    }
  }, p.nbName, " \u203A ", p.secName, " \xB7 ", new Date(p.modified).toLocaleDateString())), /*#__PURE__*/React.createElement("button", {
    className: "nf-trash-btn",
    onClick: () => restorePage(p.id),
    style: {
      marginRight: 8,
      border: "1px solid var(--border)",
      background: "var(--accent-bg)",
      color: "var(--accent)",
      fontWeight: 600
    }
  }, "Restore"), /*#__PURE__*/React.createElement("button", {
    className: "nf-trash-btn",
    onClick: () => permDelete(p.id),
    style: {
      border: "1px solid var(--danger)",
      background: "transparent",
      color: "var(--danger)"
    }
  }, "Delete Forever")))) : curPage ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "nf-toolbar"
  }, /*#__PURE__*/React.createElement(Btn, {
    icon: "undo",
    label: "Undo",
    onClick: () => exec("undo"),
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "redo",
    label: "Redo",
    onClick: () => exec("redo"),
    s: 13
  }), /*#__PURE__*/React.createElement("div", {
    className: "tb-sep"
  }), /*#__PURE__*/React.createElement(Sel, {
    value: HEADINGS.some(h => h.v === toolbarFmt.block) ? toolbarFmt.block : "div",
    opts: HEADINGS.map(h => ({
      l: h.l,
      v: h.v
    })),
    onChange: v => exec("formatBlock", v),
    w: 60
  }), /*#__PURE__*/React.createElement(Sel, {
    value: FONT_SIZES.some(f => f.v === toolbarFmt.size) ? toolbarFmt.size : "3",
    opts: FONT_SIZES.map(f => ({
      l: f.l + "px",
      v: f.v
    })),
    onChange: v => exec("fontSize", v),
    w: 58
  }), /*#__PURE__*/React.createElement("div", {
    className: "tb-sep"
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "bold",
    label: "Bold",
    onClick: () => exec("bold"),
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "italic",
    label: "Italic",
    onClick: () => exec("italic"),
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "underline",
    label: "Underline",
    onClick: () => exec("underline"),
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "strike",
    label: "Strikethrough",
    onClick: () => exec("strikeThrough"),
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "eraser",
    label: "Clear Formatting",
    onClick: () => exec("removeFormat"),
    s: 13
  }), /*#__PURE__*/React.createElement("div", {
    className: "tb-sep"
  }), /*#__PURE__*/React.createElement(CPick, {
    colors: TXT_COLORS,
    onChange: c => exec("foreColor", c),
    label: "Text Color"
  }), /*#__PURE__*/React.createElement(CPick, {
    colors: HL_COLORS,
    onChange: c => exec("hiliteColor", c),
    label: "Highlight"
  }), /*#__PURE__*/React.createElement("div", {
    className: "tb-sep"
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "ul",
    label: "Bullet List",
    onClick: () => exec("insertUnorderedList"),
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "ol",
    label: "Numbered List",
    onClick: () => exec("insertOrderedList"),
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "check",
    label: "Checklist",
    onClick: insertCheck,
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "indent",
    label: "Indent",
    onClick: () => exec("indent"),
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "outdent",
    label: "Outdent",
    onClick: () => exec("outdent"),
    s: 13
  }), /*#__PURE__*/React.createElement("div", {
    className: "tb-sep"
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "table",
    label: "Table",
    onClick: insertTable,
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "link",
    label: "Link",
    onClick: insertLink,
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "quote",
    label: "Blockquote",
    onClick: () => exec("formatBlock", "blockquote"),
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "code",
    label: "Code Block",
    onClick: () => exec("formatBlock", "pre"),
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "hr",
    label: "Horizontal Rule",
    onClick: () => exec("insertHorizontalRule"),
    s: 13
  }), /*#__PURE__*/React.createElement("div", {
    className: "tb-sep"
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "search",
    label: "Find & Replace",
    onClick: () => setShowFR(!showFR),
    active: showFR,
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "wrap",
    label: "Word Wrap",
    onClick: () => setWrap(!wrap),
    active: wrap,
    s: 13
  }), /*#__PURE__*/React.createElement(Btn, {
    icon: "zin",
    label: "Zoom In",
    onClick: () => setZoom(z => Math.min(200, z + 10)),
    s: 13
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: "var(--text-muted)",
      minWidth: 28,
      textAlign: "center",
      userSelect: "none"
    }
  }, zoom, "%"), /*#__PURE__*/React.createElement(Btn, {
    icon: "zout",
    label: "Zoom Out",
    onClick: () => setZoom(z => Math.max(50, z - 10)),
    s: 13
  })), showFR && /*#__PURE__*/React.createElement("div", {
    className: "nf-find-bar fade-in"
  }, /*#__PURE__*/React.createElement("input", {
    className: "nf-find-input",
    style: {
      width: 160
    },
    placeholder: "Find\u2026",
    value: findT,
    onChange: e => setFindT(e.target.value),
    onKeyDown: e => e.key === "Enter" && doFind()
  }), /*#__PURE__*/React.createElement("input", {
    className: "nf-find-input",
    style: {
      width: 160
    },
    placeholder: "Replace\u2026",
    value: replT,
    onChange: e => setReplT(e.target.value)
  }), /*#__PURE__*/React.createElement("button", {
    className: "nf-find-btn",
    onClick: doFind,
    style: {
      border: "1px solid var(--accent)",
      background: "var(--accent-bg)",
      color: "var(--accent)",
      fontWeight: 600
    }
  }, "Find"), /*#__PURE__*/React.createElement("button", {
    className: "nf-find-btn",
    onClick: doReplace,
    style: {
      border: "1px solid var(--border)",
      background: "var(--bg)",
      color: "var(--text)"
    }
  }, "Replace"), /*#__PURE__*/React.createElement("button", {
    className: "nf-find-btn",
    onClick: doReplAll,
    style: {
      border: "1px solid var(--border)",
      background: "var(--bg)",
      color: "var(--text)"
    }
  }, "All"), /*#__PURE__*/React.createElement(Btn, {
    icon: "x",
    label: "Close",
    onClick: () => setShowFR(false),
    s: 13
  })), /*#__PURE__*/React.createElement("div", {
    className: "nf-title-area"
  }, breadcrumb && /*#__PURE__*/React.createElement("div", {
    className: "nf-breadcrumb"
  }, /*#__PURE__*/React.createElement("div", {
    className: "nf-breadcrumb-dot",
    style: {
      background: breadcrumb.color
    }
  }), breadcrumb.nb, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: .5
    }
  }, "\u203A"), " ", breadcrumb.sec), /*#__PURE__*/React.createElement("input", {
    className: "nf-title-input",
    value: curPage.title,
    onChange: e => updatePage(aPg, () => ({
      title: e.target.value,
      modified: Date.now()
    }))
  }), /*#__PURE__*/React.createElement("div", {
    className: "nf-timestamps"
  }, /*#__PURE__*/React.createElement("span", null, "Created ", new Date(curPage.created).toLocaleString()), /*#__PURE__*/React.createElement("span", null, "Modified ", new Date(curPage.modified).toLocaleString()))), /*#__PURE__*/React.createElement("div", {
    ref: edRef,
    className: "nf-editor",
    contentEditable: true,
    suppressContentEditableWarning: true,
    onInput: onInput,
    onPaste: onPaste,
    onKeyDown: onKeyDown,
    onContextMenu: e => {
      e.preventDefault();
      setEdCtx({
        x: e.clientX,
        y: e.clientY
      });
      setCtx(null);
    },
    style: {
      fontSize: `${14 * zoom / 100}px`,
      whiteSpace: wrap ? "pre-wrap" : "pre",
      overflowX: wrap ? "hidden" : "auto",
      wordWrap: wrap ? "break-word" : "normal"
    }
  })) : /*#__PURE__*/React.createElement("div", {
    className: "nf-empty"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      opacity: .15
    }
  }, /*#__PURE__*/React.createElement(I, {
    n: "book",
    s: 56
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 17,
      fontWeight: 600,
      opacity: .5
    }
  }, aSec ? "Select or create a page" : "Select a section")), curPage && !showTrash && /*#__PURE__*/React.createElement("div", {
    className: "nf-status"
  }, /*#__PURE__*/React.createElement("span", null, stats.w, " words"), /*#__PURE__*/React.createElement("span", null, stats.c, " chars"), /*#__PURE__*/React.createElement("span", null, stats.l, " lines"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), encEnabled && /*#__PURE__*/React.createElement("span", {
    className: "nf-enc-badge"
  }, /*#__PURE__*/React.createElement(I, {
    n: "lock",
    s: 10
  }), " Encrypted"), /*#__PURE__*/React.createElement("span", null, zoom, "%"), /*#__PURE__*/React.createElement("span", null, "Wrap ", wrap ? "on" : "off"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: saved ? "var(--success)" : "var(--warning)",
      display: "flex",
      alignItems: "center",
      gap: 3
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "nf-status-dot",
    style: {
      background: "currentColor"
    }
  }), saved ? "Saved" : "Saving…")))), ctx && (() => {
    const found = findItem(ctx.id);
    if (!found) return null;
    const mx = Math.min(ctx.x, window.innerWidth - 200);
    const my = Math.min(ctx.y, window.innerHeight - 200);
    return /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx fade-in",
      style: {
        left: mx,
        top: my
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-item",
      onClick: () => {
        setEditId(ctx.id);
        setEditVal(found.item.name || found.item.title || "");
        setCtx(null);
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "edit",
      s: 13
    }), " Rename"), found.type === "page" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-item",
      onClick: () => {
        duplicatePage(ctx.id);
        setCtx(null);
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "copy",
      s: 13
    }), " Duplicate"), /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-item",
      onClick: () => {
        togglePin(ctx.id);
        setCtx(null);
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "pin",
      s: 13
    }), " ", found.item.pinned ? "Unpin" : "Pin to Top"), /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-sep"
    }), /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-item danger",
      onClick: () => {
        softDelete(ctx.id);
        setCtx(null);
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "trash",
      s: 13
    }), " Delete")), found.type === "section" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-sep"
    }), /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-item danger",
      onClick: () => {
        delSection(ctx.id);
        setCtx(null);
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "trash",
      s: 13
    }), " Delete Section")), found.type === "notebook" && /*#__PURE__*/React.createElement(React.Fragment, null, hasElectronCrypto() && !found.item.locked && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-sep"
    }), /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-item",
      onClick: () => {
        setPwDialog({
          type: "lock-nb",
          nbId: ctx.id,
          name: found.item.name
        });
        setCtx(null);
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "lock",
      s: 13
    }), " Set Password")), hasElectronCrypto() && found.item.locked && unlockedNbs.has(ctx.id) && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-sep"
    }), /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-item",
      onClick: () => {
        relockNotebook(ctx.id);
        setCtx(null);
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "lock",
      s: 13
    }), " Re-lock Now")), hasElectronCrypto() && found.item.locked && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-item",
      onClick: () => {
        removeNotebookLock(ctx.id);
        setCtx(null);
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "unlock",
      s: 13
    }), " Remove Password")), /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-sep"
    }), /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-item danger",
      onClick: () => {
        delNotebook(ctx.id);
        setCtx(null);
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "trash",
      s: 13
    }), " Delete Notebook")));
  })(), edCtx && (() => {
    const mx = Math.min(edCtx.x, window.innerWidth - 200);
    const my = Math.min(edCtx.y, window.innerHeight - 320);
    const hasSel = window.getSelection()?.toString()?.length > 0;
    const doCmd = cmd => {
      exec(cmd);
      setEdCtx(null);
    };
    return /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx fade-in",
      style: {
        left: mx,
        top: my
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: `nf-ctx-item${!hasSel ? " disabled" : ""}`,
      onClick: () => {
        if (hasSel) {
          document.execCommand("cut");
          setTimeout(() => onInput(), 10);
        }
        setEdCtx(null);
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "scissors",
      s: 13
    }), " Cut ", /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontSize: 10,
        color: "var(--text-muted)"
      }
    }, "Ctrl+X")), /*#__PURE__*/React.createElement("div", {
      className: `nf-ctx-item${!hasSel ? " disabled" : ""}`,
      onClick: () => {
        if (hasSel) document.execCommand("copy");
        setEdCtx(null);
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "copy",
      s: 13
    }), " Copy ", /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontSize: 10,
        color: "var(--text-muted)"
      }
    }, "Ctrl+C")), /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-item",
      onClick: async () => {
        try {
          const t = await navigator.clipboard.readText();
          if (t) {
            edRef.current?.focus();
            document.execCommand("insertText", false, t);
            setTimeout(() => onInput(), 10);
          }
        } catch {}
        setEdCtx(null);
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "clipboard",
      s: 13
    }), " Paste ", /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontSize: 10,
        color: "var(--text-muted)"
      }
    }, "Ctrl+V")), /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-item",
      onClick: () => {
        document.execCommand("selectAll");
        setEdCtx(null);
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "check",
      s: 13
    }), " Select All"), /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-sep"
    }), /*#__PURE__*/React.createElement("div", {
      className: `nf-ctx-item${!hasSel ? " disabled" : ""}`,
      onClick: () => doCmd("bold")
    }, /*#__PURE__*/React.createElement(I, {
      n: "bold",
      s: 13
    }), " Bold"), /*#__PURE__*/React.createElement("div", {
      className: `nf-ctx-item${!hasSel ? " disabled" : ""}`,
      onClick: () => doCmd("italic")
    }, /*#__PURE__*/React.createElement(I, {
      n: "italic",
      s: 13
    }), " Italic"), /*#__PURE__*/React.createElement("div", {
      className: `nf-ctx-item${!hasSel ? " disabled" : ""}`,
      onClick: () => doCmd("underline")
    }, /*#__PURE__*/React.createElement(I, {
      n: "underline",
      s: 13
    }), " Underline"), /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-sep"
    }), /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-item",
      onClick: () => {
        insertLink();
        setEdCtx(null);
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "link",
      s: 13
    }), " Insert Link"), /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-item",
      onClick: () => {
        insertTable();
        setEdCtx(null);
      }
    }, /*#__PURE__*/React.createElement(I, {
      n: "table",
      s: 13
    }), " Insert Table"), /*#__PURE__*/React.createElement("div", {
      className: "nf-ctx-sep"
    }), /*#__PURE__*/React.createElement("div", {
      className: `nf-ctx-item${!hasSel ? " disabled" : ""}`,
      onClick: () => doCmd("removeFormat")
    }, /*#__PURE__*/React.createElement(I, {
      n: "eraser",
      s: 13
    }), " Clear Formatting"));
  })(), confirmDialog && /*#__PURE__*/React.createElement(ConfirmDialog, {
    dark: dark,
    title: confirmDialog.title,
    message: confirmDialog.message,
    confirmLabel: confirmDialog.confirmLabel,
    confirmStyle: confirmDialog.confirmStyle,
    onConfirm: () => {
      const r = confirmDialog.resolve;
      setConfirmDialog(null);
      r(true);
    },
    onCancel: () => {
      const r = confirmDialog.resolve;
      setConfirmDialog(null);
      r(false);
    }
  }), promptDialog && /*#__PURE__*/React.createElement(PromptDialog, {
    dark: dark,
    title: promptDialog.title,
    message: promptDialog.message,
    placeholder: promptDialog.placeholder,
    defaultValue: promptDialog.defaultValue,
    confirmLabel: promptDialog.confirmLabel,
    onConfirm: val => {
      const r = promptDialog.resolve;
      setPromptDialog(null);
      r(val);
    },
    onCancel: () => {
      const r = promptDialog.resolve;
      setPromptDialog(null);
      r(null);
    }
  }), alertDialog && /*#__PURE__*/React.createElement(AlertDialog, {
    dark: dark,
    title: alertDialog.title,
    message: alertDialog.message,
    onClose: () => {
      const r = alertDialog.resolve;
      setAlertDialog(null);
      if (r) r();
    }
  }), showShortcuts && /*#__PURE__*/React.createElement(ShortcutsDialog, {
    dark: dark,
    onClose: () => setShowShortcuts(false)
  }), restoreFlow && /*#__PURE__*/React.createElement(PasswordDialog, {
    dark: dark,
    title: "Verify Backup Password",
    subtitle: "Enter the password for the backup file. Your current data will be kept if this fails.",
    confirmLabel: "Restore Backup",
    error: pwError,
    onCancel: () => {
      setRestoreFlow(null);
      setPwError("");
    },
    onSubmit: async pw => {
      setPwError("");
      const r = await window.electronAPI.verifyAndRestoreBackup(restoreFlow.backupPath, pw);
      if (r?.error) {
        setPwError(r.error);
        return;
      }
      setRestoreFlow(null);
      if (r?.needsRestart) {
        dataRef.current = null;
        setData(null);
        setEncEnabled(true);
        setAppPhase("needsPassword");
        await alertUser({
          title: "Restore complete",
          message: "Enter the backup password to unlock your restored data." + (r.rollbackPath ? "\n\nYour previous data was saved as a rollback file next to your data folder." : "")
        });
      }
    }
  }));
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(NoteForge, null));
