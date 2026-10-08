# Changelog

All notable changes to NoteForge are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.8.2] — 2026-10-08

Re-release of 2.8.1 with the same app code. The 2.8.1 GitHub release lost its installer: electron-builder 26 split it across two releases, and cleaning up the duplicate removed the wrong one.

### Changed
- The release workflow creates a single draft release up front, lets electron-builder upload into it, and publishes it only if exactly one release exists for the tag. electron-builder 26 can otherwise create two releases for one tag when uploads run concurrently.

## [2.8.1] — 2026-10-08 (release withdrawn; use 2.8.2)

Editor and UI pass: every toolbar button, shortcut, menu and dialog was driven through the real app. Each fix has an end-to-end test that fails on 2.8.0.

### Fixed
- **Checklist ticks were never saved.** Ticking a box changed it on screen only, so it was lost on reload or when switching pages.
- **Find & Replace did nothing.** Find never selected a match and Replace never replaced one (only Replace All worked). Rewritten:
  - every match is highlighted, with the current one stronger;
  - Enter / Shift+Enter step to the next / previous match;
  - a live "2 of 5" / "No matches" count;
  - Ctrl+F focuses the box with the selected text filled in;
  - Escape closes it.
- **Printing printed the whole app.** It captured the sidebar, toolbar and status bar in the current theme, and cut the note off at one screen. It now prints just the title and the full note, on white.
- **Font sizes didn't match their labels.** "14px" gave 16px and "32px" gave 48px, and normal text showed as "12px". Each size now renders at its label and follows zoom.
- **List buttons moved the caret to the start of the line.** Lists were also saved nested inside a paragraph, which added blank lines on reload.
- **Tab in a bulleted or numbered list** now indents it, and Shift+Tab outdents it. Before, Tab moved focus out of the editor.
- **Tab in a table** now moves between cells instead of leaving the editor. New tables start with empty cells (no leading space).
- **You couldn't get out of a code block or quote.** Enter on an empty last line now continues below it.
- **Checklists:**
  - Enter adds a new to-do, and Enter on an empty one ends the list;
  - clicking an item's text edits it instead of ticking it;
  - inserting a checklist selects the placeholder.
- **Search couldn't find text with `&` or `<`.** It also matched "amp" or "lt" in pages that contain neither.
- **Highlighted text was unreadable in the dark theme.**
- **Change Password accepted a wrong current password at step 1.** The error only appeared after you had typed the new password twice.
- **Password dialogs said "Ready to encrypt" for passwords the app then rejects.**
- **Escape** now closes Settings, password dialogs and right-click menus, and clears the search box.
- **Ctrl+N in a new notebook with no sections** now creates a section and page instead of doing nothing.
- **The heading dropdown cut "Normal" off at "Norn".**
- **Removed a startup read of `index.html`** that 2.8.0 added as a workaround for an Electron asar-integrity gap. The gap doesn't exist: a separate investigation found Electron 44 does validate `index.html` loaded from the asar, with or without the read. The 2.8.0 note below is corrected accordingly.

## [2.8.0] — 2026-10-08

Audit pass. Every fix below was reproduced against 2.7.2 first and has a regression test that fails on the old code.

### Fixed — data loss
- **Remove Password on a still-locked notebook deleted its pages.** The menu item was shown before the notebook had been unlocked, when its pages exist only inside the encrypted blob, and removing the lock threw that blob away without a prompt. It now appears only for notebooks unlocked this session and asks for confirmation.
- **Opening and closing Trash blanked the editor**, and the next keystroke saved the blank editor over the page. The editor now repaints whenever it mounts, which also covers re-lock followed by unlock.
- **Restoring a backup over unencrypted notes deleted them** with no rollback copy. Both data files are now copied to `*.pre-restore.bak` first; if the copy fails, the restore is cancelled.
- **A crash or power loss during a save could truncate the vault.** Since the whole vault is one AES-GCM blob, that meant losing every note. Data files are now written to a temp file, fsynced, and renamed into place.
- **Failed saves showed "Saved".** The status bar now shows "Save failed" until the next successful write.

### Security
- **Plaintext written after lock.** With encryption on, any save that arrived after Lock App, auto-lock, a restore, or before the first unlock wrote a decrypted `noteforge-data.json` next to the `.enc` file. The main process now refuses those writes.
- **The main-process plaintext strip described under 2.6.1 now actually runs on every save.** Previously it ran only on enable/disable/change-password.
- **Note images could open SMB connections.** On `file://`, `<img src="//host/share/x.png">` (or a CSS `url()`) resolves to a UNC path, and Windows connects to that host over SMB, which can leak an NTLM hash. CSP `img-src` is now `data:` only, and the sanitizer drops any non-`data:image/` image source.
- **Navigation is fully blocked.** The old guard allowed any `file://` URL, so the window could load an arbitrary local HTML page, which then got the preload bridge without the app's CSP.
- **The renderer can no longer turn off its own sandbox** through `set-config`, and config values are type-checked. Editing `noteforge-config.json` by hand still works.
- **Restore only installs the file the user picked**, and re-checks its format (v2, scrypt, minimum N) right before installing it.
- **scrypt `r` and `p` are capped (≤ 32, ≤ 16), and N/r/p must be integers.** A crafted header could otherwise make `scryptSync` block the main process for hours.
- **Electron fuses on the packaged app:** no RunAsNode, no `NODE_OPTIONS`, no `--inspect`. Embedded asar integrity is on.
- Bundled DOMPurify 3.3.3 → 3.4.16 (mXSS fixes from 3.4.0, later hardening).
- Electron 33 → 44 (Chromium security fixes; 33 has been end-of-life since mid-2025). electron-builder 25 → 26, electron-updater 6.3 → 6.8.

### Fixed
- File → Export as HTML / Export as Text (and Ctrl+Shift+E) did nothing. The menu listener ran a stale copy of the export handler.
- Unlocking a notebook by clicking it left the previous notebook active. As a result, exporting or printing its pages skipped the "password-protected notebook" warnings.
- Editor right-click → Paste did nothing (clipboard-read permission is denied). It now uses a native paste, so it goes through the same sanitizing path as Ctrl+V.
- Replace All expanded `$&`, `$1` and `$$` in the replacement text.
- Re-locking the open notebook left an empty "Section" pane.
- The "Restore complete" message never appeared, because it was opened behind the unlock screen.
- Help → About showed v2.7.1 in 2.7.2.

### Tests and CI
- Crypto and storage tests now load the real `main.js` with a stubbed `electron` module. They previously tested a pasted copy.
- XSS tests use the sanitizer exactly as shipped (`app.jsx` config + hook, bundled `lib/purify.min.js`), and every test file now exits non-zero on failure. Previously `npm test` passed with two failing XSS checks.
- New end-to-end suite (`npm run test:e2e`) drives the real Electron app against a throwaway profile.
- New `Test` workflow on every push and PR: unit tests on Node 22 and 24, a check that `app.js` matches `app.jsx`, e2e, and an unpacked electron-builder package.
- The release workflow uses `npm ci`, runs the tests before publishing, and uses Node 24. `package-lock.json` is tracked and in sync again.

## [2.7.2] — 2026-04-28

### Fixed
- **File → Lock App menu item** now actually locks the app. The menu-action listener was registered with an empty dependency array, so its handler captured the initial `encEnabled = false` closure and the lock branch never fired. The Ctrl+L shortcut was unaffected because its listener already tracked `encEnabled` and `lockApp` in its deps.
- **Editor content blank after unlock** when the unlock landed on the same page the user was viewing before locking. The editor's `prevPgRef` guard wasn't reset on lock (the sync effect early-returns when `edRef.current` is null during the password-dialog phase), so after unlock `aPg === prevPgRef.current` and the `innerHTML` write was skipped. `lockApp` now clears `prevPgRef.current` so the next paint always fires.

## [2.7.1] — 2026-04-20

### Fixed
- **Blank window on launch.** 2.7.0 added Subresource Integrity attributes to the bundled React/DOMPurify script tags. SRI needs CORS, which Electron's `file://` loader doesn't provide, so all three scripts were blocked. SRI was removed.

## [2.7.0] — 2026-04-20

### Added
- Renderer runs in Chromium's OS-level sandbox by default (can be turned off in `noteforge-config.json`).
- Restore test-decrypts the backup with your password before touching current data, and keeps a rollback copy.
- Per-notebook password rate limiting, keyed by the notebook blob.
- Themed modal dialogs replacing native `alert`/`confirm`/`prompt`.
- Pasted photos up to 5 MB are downscaled to 1600 px JPEG instead of being rejected.
- Idle timer resets on mouse movement and wheel (throttled to 1 Hz).
- Re-lock Now, Empty Trash, cursor-aware heading/size selectors, F1 shortcuts overlay.
- Schema `version` stamp on saved data.
- `npm test` suite (crypto, XSS, input hook, install checks).

### Security
- DOMPurify hook strips every `<input>` type except `checkbox`, so note content can't render a fake password field.
- A failure to load `electron-updater` no longer prevents the app from starting.

## [2.6.1] — 2026-04-16

Security hardening round plus a cross-notebook bug fix and Windows taskbar polish.

### Added
- **Cross-notebook click targets** now work correctly — clicking a link to a page in a different notebook navigates to the right notebook and page instead of dropping the navigation silently.
- **Windows taskbar icon** is set explicitly from the bundled `.ico` so the taskbar and alt-tab show the correct icon in packaged builds.

### Security
- Additional renderer-side sanitization on paste and load paths.
- Main-process second-layer check (`sanitizeDataJson`) prevents plaintext from hitting disk even if the renderer is compromised.
- KDF parameter validation strengthened — decrypt now rejects blobs with `N < 16384`, non-power-of-2 `N`, or malformed headers.

## [2.5.4] — 2026-04-14

Security hardening across the IPC surface and build pipeline.

### Security
- **Config-key allowlist** — IPC handler for `set-config` now accepts only a whitelist of known keys. A compromised renderer can no longer write arbitrary config.
- **CI actions pinned to commit SHAs** — `actions/checkout` and `actions/setup-node` are now pinned to full SHAs so a tag-move supply-chain attack can't affect future builds.
- Clarified README security posture.

## [2.5.3] — 2026-04-14

### Added
- **Auto-update toggle** in File → Settings. Users who don't want the launch-time update check can turn it off.

## [2.5.2] — 2026-04-14

### Fixed
- **Installer build** — removed a `signAndEditExecutable` electron-builder override that was causing the unsigned-build pipeline to fail.

## [2.5.1] — 2026-04-14

### Added
- **Auto-updater** using `electron-updater` against GitHub Releases. Check runs 5 seconds after launch, prompts before downloading, prompts before installing.
- **GitHub Actions CI** that builds on every `v*` tag push and attaches the installer + portable binaries to the release.
- Auto-publish releases as published (not drafts) so downloads are immediately visible.

### Fixed
- Build pipeline — code signing explicitly disabled (`forceCodeSigning: false`, `CSC_IDENTITY_AUTO_DISCOVERY: false`) so unsigned builds succeed on CI.

## [2.5.0] — prior

Initial public release. Encrypted offline note-taking with master-password + per-notebook locks, 3-panel OneNote-style UI, rich-text editor, encrypted backups, auto-lock, dark/light themes, Find & Replace, HTML/text export.
