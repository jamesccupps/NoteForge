# Contributing

Thanks for your interest. NoteForge is a small, single-maintainer project, but outside contributions are welcome — especially bug reports, security findings, and anything that improves the encryption-correctness or platform-support story.

## Getting set up

```bash
git clone https://github.com/jamesccupps/NoteForge.git
cd NoteForge
npm ci
npm run build:jsx
npm start
```

Node.js 22 or 24 (LTS). CI tests both.

## The workflow

1. Edit `app.jsx` (the React source). Do **not** edit `app.js` directly — it's generated, but it is committed, so commit the rebuilt file with your change (CI fails if it is stale).
2. Rebuild: `npm run build:jsx`.
3. Test: `npm test` (unit) and `npm run test:e2e` (drives the real app against a throwaway profile; needs a desktop session).
4. Run the app: `npm start`. This uses your real data folder.
5. Optional: build an installer with `npm run dist`.

Bug fixes should come with a test that fails without the fix. Main-process behaviour can be tested through `test/helpers/main_harness.js`, which loads the real `main.js` with a stubbed `electron`. Renderer behaviour goes in `test/e2e/app/scenarios.js`.

## Code style

- Single-file simplicity over architecture for its own sake. `main.js` and `app.jsx` are large on purpose — it's easier to audit one long file than chase interface indirection across a dozen small ones.
- Security-sensitive code belongs in `main.js` (main process). The renderer is treated as a potentially-compromised environment and only sees opaque handles to session keys.
- No new runtime dependencies without a strong reason. Everything currently in `lib/` is either necessary (React, DOMPurify) or typography (DM Sans, JetBrains Mono). Adding a new dependency expands the supply-chain surface and breaks the "fully offline, zero CDN" story.
- No runtime network requests from the renderer. CSP enforces this and the enforcement is the point — don't try to work around it.
- Wrap anything that touches the filesystem in try/catch and fail closed. The app should never silently lose data.

## Security contributions

Please read [SECURITY.md](../SECURITY.md) before filing anything. For vulnerabilities, use GitHub Security Advisories rather than public issues.

Non-security security-adjacent contributions (hardening, better validation, more robust parsing) are welcome as regular pull requests. If the change affects anything in the Security section of the README, update the README in the same PR.

## Pull requests

- Describe the problem being solved, not just the change.
- Reference the related issue if there is one.
- If the change affects behavior, test it yourself against a real install and include steps a reviewer can follow.
- Keep PRs focused. Security hardening + unrelated UI refactor = two PRs.
- Update `CHANGELOG.md` under `[Unreleased]`.

## Packaging and release

Releases are automated. When a tag matching `v*` is pushed to `main`, the GitHub Actions workflow builds the Windows installer and portable binaries and attaches them to a published release.

Only the maintainer pushes tags. If your PR should ship in a specific version, say so in the PR description.

## Licensing

By submitting a pull request you agree that your contribution is licensed under the MIT license of the project.
