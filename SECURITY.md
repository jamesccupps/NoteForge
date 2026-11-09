# Security Policy

NoteForge is built specifically to protect user data, so security reports are taken seriously and handled privately until a fix ships.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.** Report them privately instead, through one of:

- **GitHub Security Advisories** — [Report a vulnerability](https://github.com/jamesccupps/NoteForge/security/advisories/new) (preferred)
- **Email** — the address listed on the maintainer's [GitHub profile](https://github.com/jamesccupps)

Please include enough detail to reproduce: affected version, OS, what the issue is, and any relevant code paths or proof-of-concept. If the issue affects encrypted-data integrity or key handling, a small sample data file demonstrating the problem is especially useful.

I'll acknowledge reports within a few days, confirm the issue or push back if it isn't reproducible, and keep you updated on a fix. Fixes for significant issues ship as an expedited release.

Responsible disclosure is appreciated — a public write-up after a fix is out is fine, and credit in the CHANGELOG is the default unless you'd rather stay anonymous.

## Supported versions

Only the latest release (currently the 2.x line) receives security updates. Older versions are available in [Releases](https://github.com/jamesccupps/NoteForge/releases) but not maintained.

## In scope

- Cryptographic weaknesses in the at-rest encryption (master key or per-notebook key derivation, AES-GCM usage, authenticated encryption guarantees, nonce handling).
- KDF parameter validation (downgrade attacks against the scrypt header in stored blobs).
- Anything that causes plaintext to be written to disk when it shouldn't, including in crash dumps, logs, swap, or temp files.
- Electron sandbox / context-isolation / preload-bridge escapes.
- Renderer XSS or CSP bypass that affects encrypted-data confidentiality or integrity.
- Auto-updater integrity (anything that could cause the app to install a version from an untrusted source).
- Bypasses of the packaged app's Electron fuses or asar integrity validation (running modified app code from an installed copy).
- Rate-limiter bypass for password attempts.
- Config / backup file validation weaknesses.

## Out of scope

- Physical access to an unlocked machine with the app already unlocked. No software defense covers that.
- Reports that require already having decrypted keys in memory and then demonstrating those keys are in memory.
- Reports about dependency CVEs that have no realistic exploit path given how the dependency is used (for example, a server-side CVE in a client-bundled library that never runs in that context). Include an exploitation path for these.
- Denial of service against the local app itself by the local user (e.g., forcing the app to refuse to open a file you control).
- SmartScreen warnings on versions up to 2.9.0, which were unsigned. From 2.9.1 the builds are code-signed (publisher James Cupps) and the updater installs only updates signed by that publisher; a signing problem in a current release *is* in scope.

## Cryptographic details

| Item | Value |
|---|---|
| Encryption algorithm | AES-256-GCM |
| Key derivation | scrypt (N=65536, r=8, p=1) |
| Minimum accepted N on decrypt | 16384 (rejects weaker) |
| Maximum accepted N on decrypt | 131072, and at most 128 MiB of scrypt memory (128·N·r); DoS defense |
| Parameters written | the ones the cached key was derived with; a blob with other accepted parameters is re-encrypted with the current ones on unlock |
| Accepted r / p on decrypt | r 8–32, p 1–16, integers only (written as r=8, p=1) |
| Key length | 32 bytes |
| IV / nonce | 16 bytes, random per encryption (GCM derives J0 from a non-96-bit IV via GHASH) |
| Auth tag | 16 bytes, GCM-native; shorter tags are rejected (`authTagLength: 16`) |
| Backup file version | `v=2` (v1 legacy format not accepted) |

If you think any of these values is wrong for the threat model, I want to hear about it.
