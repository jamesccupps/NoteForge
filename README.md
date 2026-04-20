# NoteForge

**Encrypted, offline note-taking.** A OneNote-style app that keeps your data local and protected with AES-256-GCM encryption.

## Features

- **3-panel layout** — Notebooks → Sections → Pages, just like OneNote
- **AES-256-GCM encryption** — Master password encrypts all data at rest with scrypt key derivation (N=65536)
- **Per-notebook locks** — Individual password for sensitive notebooks, with per-notebook brute-force rate limiting
- **Fully offline** — All fonts, scripts, and dependencies bundled locally. The only network request is an optional update check against GitHub Releases on launch
- **Rich text editor** — Bold, italic, headings, lists, tables, code blocks, links, images, checklists
- **Image auto-downscale** — Pasted photos are automatically resized to 1600px and JPEG-compressed
- **Find & Replace** — Safe text-node walking that won't break HTML
- **Auto-lock** — Configurable idle timeout (5/15/30/60 min) + Ctrl+L manual lock + per-notebook "Re-lock Now"
- **Encrypted backup** — Export/restore `.enc` backup files with password-verified-before-clobber restore
- **Auto-update** — Checks GitHub Releases on launch, downloads and installs updates seamlessly
- **Dark & light themes** — Persisted across sessions, applied to all dialogs
- **Export** — HTML and plain text with unencrypted file warnings
- **Keyboard shortcuts help** — Press F1 for a list of every shortcut
- **Sandboxed renderer** — Chromium OS-level process sandbox enabled by default
- **Content Security Policy** — `connect-src 'none'`, `script-src 'self'` — no eval, no outbound connections
- **DOMPurify + hardening hook** — All note content sanitized on load and paste; `<input>` types restricted to `checkbox` only to block in-note phishing
- **Subresource Integrity** — Bundled scripts (React, DOMPurify) verified via SHA-384 hashes at load time

## What's new in 2.7.0

- **Sandbox** — Renderer now runs in Chromium's OS-level process sandbox by default. Can be disabled per-user in `noteforge-config.json` if it causes issues on a specific system.
- **Phishing-input hardening** — DOMPurify hook strips `<input type="password">` (and every other non-checkbox input type) so malicious content can't impersonate a password prompt inside a note.
- **Safe backup restore** — Restore now test-decrypts the backup with your password *before* touching current data. Failed restores leave everything intact. A rollback copy is kept on successful restores.
- **Per-notebook rate limiting** — Wrong-password counter now tracks each notebook independently (keyed by the blob's salt+iv hash), so one mistyped password doesn't burn the lockout quota for every other notebook.
- **Subresource Integrity** — Bundled React/DOMPurify scripts verified by SHA-384 hash.
- **Custom modal dialogs** — Native `alert()`/`confirm()`/`prompt()` replaced with themed modals. Password dialogs now honor light/dark theme.
- **Paste any photo** — Images up to 5 MB auto-downscale to 1600px JPEG instead of being rejected.
- **Idle timer improvements** — Now resets on `mousemove`/`wheel` too (throttled to 1 Hz). No more auto-locking mid-read.
- **Re-lock Now** — Right-click a notebook you've unlocked this session to relock it without closing the app.
- **Empty Trash** — Bulk-purge all soft-deleted pages from the trash view.
- **Cursor-aware toolbar** — Heading and font-size selectors now reflect the format under your cursor.
- **F1 shortcuts overlay** — Built-in keyboard shortcut cheat sheet.
- **Schema version stamp** — Every saved file now carries a `version` field for safe future migrations.
- **Graceful auto-updater failures** — If `electron-updater` fails to load (corrupt install, symlink weirdness), the app still starts. Update errors now log instead of silently vanishing.
- **Automated test suite** — `npm test` runs 89+ tests covering crypto round-trips, KDF-downgrade protection, XSS vector blocking, IPC channel coverage, and the input-type hook. CI-ready.

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
npm test      # runs the full test suite
npm start
```

To build the installer locally (or use `Build.bat` on Windows):

```bash
npm run dist
```

Output goes to `dist/`. The `predist` hook runs tests before building — if any test fails, the build aborts.

## Security

### Encryption

| Layer | Algorithm | Key Derivation |
|---|---|---|
| Master (file-level) | AES-256-GCM | scrypt N=65536, r=8, p=1 |
| Notebook locks | AES-256-GCM | scrypt N=65536, r=8, p=1 |

- Master password is **never stored** — only the derived key (Buffer) lives in memory during the session
- Session key is zeroed (`Buffer.fill(0)`) on lock, close, and idle timeout
- Locked notebook sections are **stripped from disk on every write** via `sanitizeForDiskSync()` — plaintext never reaches the data file
- **Per-notebook** rate limiting with exponential backoff on failed password attempts (persisted across restarts)
- KDF-downgrade protection: rejects any blob with weakened N/r/p parameters
- Password strength enforcement: 10+ chars, 3/4 character classes, dictionary check against 160+ common passwords, low-entropy rejection

### Content Security Policy (Renderer)

```
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' data:;
connect-src 'none';
```

All scripts and fonts loaded from local `lib/` directory. Zero CDN dependencies at runtime. `connect-src 'none'` blocks any outbound fetch/XHR from the renderer process, even if code is injected.

**Note:** The auto-updater runs in the main process (not governed by the renderer's CSP) and makes a single HTTPS request to GitHub Releases on launch to check for new versions. This can be disabled in File → Settings.

### Additional Hardening

- **Sandboxed renderer** (`sandbox: true`) — Chromium OS-level sandbox, on by default
- Navigation guards block all non-`file://` navigation
- `contextIsolation: true`, `nodeIntegration: false`
- All permissions denied (`setPermissionRequestHandler`)
- DevTools disabled in production builds
- **DOMPurify input-type hook** — blocks in-note phishing by forcing all non-checkbox `<input>` elements to lose their type attribute
- **Subresource Integrity** — bundled React and DOMPurify verified by SHA-384 hash at script load
- Links inserted into notes get `target="_blank" rel="noopener noreferrer"` automatically
- Export dialogs warn about unencrypted output
- Print dialogs warn for password-protected notebooks
- Config keys allowlisted — renderer can only write known settings
- CI actions pinned to commit SHAs to prevent supply-chain attacks

### Disabling sandbox (fallback)

If `sandbox: true` causes issues on a specific system (rare), close NoteForge and edit `noteforge-config.json` in the data folder:

```json
{ "autoUpdate": true, "sandbox": false }
```

Then restart. No rebuild required.

## Development

### File Structure

```
NoteForge/
├── .github/workflows/build.yml  # CI: auto-build on tag push
├── app.jsx           # React source (edit this)
├── app.js            # Compiled output (generated)
├── main.js           # Electron main process + crypto
├── preload.js        # IPC bridge (contextBridge)
├── index.html        # Shell with CSP + SRI hashes
├── styles.css        # All styling + @font-face
├── package.json      # Scripts + electron-builder config
├── lib/              # Bundled dependencies (React, DOMPurify, fonts)
├── assets/           # Icons
├── test/             # Test harness — crypto, XSS, install, input hook
├── Build.bat         # Windows build helper
├── NoteForge.bat     # Windows dev launcher
├── LICENSE
└── README.md
```

### Workflow

1. Edit `app.jsx` (React/JSX source)
2. Compile: `npm run build:jsx`
3. Test: `npm test`
4. Run: `npm start`
5. Build installer: `npm run dist`

### Data Location

| OS | Path |
|---|---|
| Windows | `%APPDATA%\noteforge\` |
| macOS | `~/Library/Application Support/noteforge/` |
| Linux | `~/.config/noteforge/` |

Files: `noteforge-data.json` (unencrypted) or `noteforge-data.enc` (encrypted), `window-state.json`, `ratelimit.json`, `noteforge-hint.txt`, `noteforge-config.json`, `noteforge-data.enc.pre-restore.bak` (after a restore, for rollback)

## Keyboard Shortcuts

Press **F1** in the app for an interactive cheat sheet.

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
| F1 | Keyboard Shortcuts |

## License

[MIT](LICENSE) — James Cupps
