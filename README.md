# NoteForge

**Encrypted, offline note-taking.** A OneNote-style app that keeps your data local and protected with AES-256-GCM encryption.

## Features

- **3-panel layout** — Notebooks → Sections → Pages, just like OneNote
- **AES-256-GCM encryption** — Master password encrypts all data at rest with scrypt key derivation (N=65536)
- **Per-notebook locks** — Individual password for sensitive notebooks
- **Fully offline** — All fonts, scripts, and dependencies bundled locally. The only network request is an optional update check against GitHub Releases on launch
- **Rich text editor** — Bold, italic, headings, lists, tables, code blocks, links, images, checklists
- **Find & Replace** — Safe text-node walking that won't break HTML
- **Auto-lock** — Configurable idle timeout (5/15/30/60 min) + Ctrl+L manual lock
- **Encrypted backup** — Export/restore `.enc` backup files
- **Auto-update** — Checks GitHub Releases on launch, downloads and installs updates seamlessly
- **Dark & light themes** — Persisted across sessions
- **Export** — HTML and plain text with unencrypted file warnings
- **Content Security Policy** — `connect-src 'none'`, `script-src 'self'` — no eval, no outbound connections
- **DOMPurify** — All note content sanitized against XSS on load and paste

## Install

### Download (Windows)

Download the latest installer from [Releases](../../releases):

- **`NoteForge Setup x.x.x.exe`** — Standard Windows installer (recommended)
- **`NoteForge-x.x.x-portable.exe`** — Portable version, no install needed

Releases are built automatically by GitHub Actions — no manual build steps required.

> **Note:** Windows may show a SmartScreen warning because the app isn't code-signed yet. Click **"More info"** → **"Run anyway"** to proceed. The source code is fully open for inspection.

### Build from Source

Requires [Node.js](https://nodejs.org/) 18+.

```bash
git clone https://github.com/jamesccupps/NoteForge.git
cd NoteForge
npm install
npm run build:jsx
npm start
```

To build the installer locally (or use `Build.bat` on Windows):

```bash
npm run dist
```

Output goes to `dist/`.

## Security

### Encryption

| Layer | Algorithm | Key Derivation |
|---|---|---|
| Master (file-level) | AES-256-GCM | scrypt N=65536, r=8, p=1 |
| Notebook locks | AES-256-GCM | scrypt N=65536, r=8, p=1 |

- Master password is **never stored** — only the derived key (Buffer) lives in memory during the session
- Session key is zeroed (`Buffer.fill(0)`) on lock, close, and idle timeout
- Locked notebook sections are **stripped from disk on every write** via `sanitizeForDiskSync()` — plaintext never reaches the data file
- Rate limiting with exponential backoff on failed password attempts (persisted across restarts)
- Password strength enforcement: 10+ chars, 3/4 character classes, dictionary check against 160+ common passwords

### Content Security Policy

```
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' data:;
connect-src 'none';
```

All scripts and fonts loaded from local `lib/` directory. Zero CDN dependencies at runtime. `connect-src 'none'` blocks any outbound fetch/XHR even if code is injected.

### Additional Hardening

- Navigation guards block all non-`file://` navigation
- `contextIsolation: true`, `nodeIntegration: false`
- All permissions denied (`setPermissionRequestHandler`)
- DevTools disabled in production builds
- DOMPurify sanitizes all note content on load and paste
- Export dialogs warn about unencrypted output
- Print dialogs warn for password-protected notebooks

## Development

### File Structure

```
NoteForge/
├── .github/
│   └── workflows/
│       └── build.yml        # CI: auto-build on tag push
├── app.jsx           # React source (edit this)
├── app.js            # Compiled output (generated)
├── main.js           # Electron main process + crypto
├── preload.js        # IPC bridge (contextBridge)
├── index.html        # Shell with CSP
├── styles.css        # All styling + @font-face
├── package.json      # Scripts + electron-builder config
├── lib/              # Bundled dependencies
│   ├── react.min.js
│   ├── react-dom.min.js
│   ├── purify.min.js
│   └── *.woff2       # DM Sans + JetBrains Mono fonts
├── assets/
│   ├── icon.ico
│   └── icon.png
├── Build.bat         # Windows build helper
├── NoteForge.bat     # Windows dev launcher
├── LICENSE
└── README.md
```

### Workflow

1. Edit `app.jsx` (React/JSX source)
2. Compile: `npm run build:jsx`
3. Test: `npm start`
4. Build installer: `npm run dist`

### Data Location

| OS | Path |
|---|---|
| Windows | `%APPDATA%\noteforge\` |
| macOS | `~/Library/Application Support/noteforge/` |
| Linux | `~/.config/noteforge/` |

Files: `noteforge-data.json` (unencrypted) or `noteforge-data.enc` (encrypted), `window-state.json`, `ratelimit.json`, `noteforge-hint.txt`

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+N | New Page |
| Ctrl+Shift+N | New Notebook |
| Ctrl+B / I / U | Bold / Italic / Underline |
| Ctrl+D | Duplicate Page |
| Ctrl+F | Find & Replace |
| Ctrl+L | Lock App |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+= / Ctrl+- | Zoom In / Out |
| Ctrl+\\ | Toggle Sidebar |
| Ctrl+Shift+D | Toggle Theme |
| Ctrl+P | Print |
| Ctrl+Shift+E | Export HTML |

## License

[MIT](LICENSE) — James Cupps
