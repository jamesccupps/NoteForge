---
name: Bug report
about: Report a defect or unexpected behavior
title: "[Bug] "
labels: bug
assignees: ''
---

**Describe the bug**
What's wrong?

**To reproduce**
1. Version (Help → About, or look at the release you installed):
2. OS / version:
3. Install type: [ ] Installer [ ] Portable [ ] Built from source
4. Steps to reproduce:
5. What you expected to happen:
6. What actually happened:

**Data-related?**
- [ ] Data file is encrypted (`noteforge-data.enc`) with master password
- [ ] Data file is unencrypted (`noteforge-data.json`)
- [ ] Issue involves a password-protected notebook
- [ ] Not data-related

If data-related, does the issue reproduce on a fresh data file?

**Security-sensitive?**
If this might be a security vulnerability — key handling, plaintext leakage to disk, encryption correctness, CSP bypass, sandbox escape — **stop and follow [SECURITY.md](../../SECURITY.md) instead of filing this issue publicly.**

**Logs / console output**
If you opened DevTools (dev builds only) or saw an error message, paste it here. Redact any note content.

```
(paste here)
```

**Screenshots**
If visual, drop screenshots here. Redact any note content.

**Additional context**
Anything else that might help.
