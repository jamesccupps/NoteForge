# Pull Request

## Summary
What does this change do and why?

## Type of change
- [ ] Bug fix
- [ ] New feature
- [ ] Security hardening
- [ ] Documentation
- [ ] Refactor / cleanup
- [ ] Build / CI
- [ ] Dependency update

## Checklist
- [ ] `npm run build:jsx` succeeds
- [ ] `npm start` launches cleanly and the change works as described
- [ ] If touching `main.js` crypto / IPC, I've confirmed no keys or plaintext can reach the renderer or disk in a form they shouldn't
- [ ] If adding a runtime dependency, I've justified it in the PR description — no new CDN calls, no weakening of the "fully offline" story
- [ ] If the change affects behavior, README and/or docs updated
- [ ] CHANGELOG.md updated under `[Unreleased]`

## How to verify
Steps a reviewer can follow to confirm the change works.

## Security considerations
Does this PR touch crypto, key handling, disk writes, the renderer/main IPC boundary, CSP, or the auto-updater? If yes, describe what you changed and why it's safe. If no, write "none."

## Related issues
Closes # / Refs #
