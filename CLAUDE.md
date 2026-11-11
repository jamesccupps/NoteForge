# NoteForge - notes for Claude Code

Encrypted offline note-taking for Windows: Electron (`main.js` holds the crypto, storage and IPC; `preload.js`; a
sandboxed React renderer, `app.jsx` compiled to `app.js` by Babel). Shipped as an NSIS installer that updates itself
(electron-updater) and a portable exe. The README's Security and Development sections describe the design; SECURITY.md
the threat model.

## Commands

```
npm ci
npm run build:jsx          # app.jsx -> app.js (commit both)
npm test                   # unit tests: crypto, storage, backup, sanitizer, input hook, install
npm run test:e2e           # real Electron, userData redirected to a temp folder
node test/e2e/run.js <scenario>      # one e2e scenario; `screenshots` makes docs/screenshots/*
npm run dist               # local, unsigned build into dist/
```

The maintainer's PC has a real vault in `%APPDATA%\noteforge`. Never run `npm start` or a packaged build against
it: the e2e harness redirects userData and refuses to run if it can't.

## Releasing

1. Bump `version` in `package.json` (and `package-lock.json`) by editing the text: `npm version` and `npm pkg set`
   reformat `build.win.target`. Move the CHANGELOG's `[Unreleased]` entries under `## [X.Y.Z] — date`; the release
   text is taken from that section.
2. `npm test`, commit, push `main`, wait for CI.
3. Ask before tagging: every installed copy updates to it. `git tag vX.Y.Z` and push the tag.

`.github/workflows/build.yml` creates a draft release, builds, Authenticode-signs every exe as it's made (Azure
Artifact Signing through `scripts/azure-sign.js`, GitHub OIDC, the `release` environment), checks the fuses and
the signatures, then publishes the draft as the latest release. A `vX.Y.Z-signtest.N` tag runs the signed build
and checks and publishes nothing; delete it afterwards. Never use GitHub's web Delete/Edit on a release whose tag
two releases share: it acts on whichever one the tag resolves to.

### Rules that keep the Scoop bucket (and winget) working

NoteForge is in [jamesccupps/scoop-bucket](https://github.com/jamesccupps/scoop-bucket) as `noteforge`
(`bucket/noteforge.json`). Its manifest updates itself from each GitHub release, every 4 hours, so a release needs
no Scoop work as long as these hold:

- Tag releases `vX.Y.Z` and publish them as the latest release, never as a pre-release.
- Keep the release file names unchanged. The bucket downloads `NoteForge-<version>-portable.exe`; electron-updater
  reads `latest.yml`, `NoteForge-Setup-<version>.exe` and its `.blockmap`. Each release also carries unversioned
  copies, `NoteForge-Setup.exe` and `NoteForge-portable.exe` (the workflow's "Attach unversioned copies" step), so
  `releases/latest/download/NoteForge-Setup.exe` is a stable one-click link. They're extra files, not renames.
- There is no checksum file to keep publishing: Scoop hashes the portable exe itself, and `latest.yml` carries the
  installer's SHA-512.
- Sign files BEFORE publishing. Never replace a file on a release that's already out: Scoop and winget have
  recorded its hash. Fix a bad release with a new version.
- The bucket persists the portable build's `NoteForge Data` folder (where its notes are). Renaming that folder, or
  moving the portable build's data anywhere else, loses Scoop users' notes unless `bucket/noteforge.json` changes
  with it.
- If a file name must change, update `bucket/noteforge.json` in jamesccupps/scoop-bucket in the same change.
