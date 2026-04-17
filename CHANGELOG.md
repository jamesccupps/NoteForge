# Changelog

All notable changes to NoteForge are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
