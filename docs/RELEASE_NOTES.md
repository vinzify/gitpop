# A focused Git workbench, now cross-platform

This is the first public preview of the GitPop 1.5 refresh. It is intended for
early testing, not a claim that every Linux desktop or native integration has
been manually exercised.

## What changed

- New split-view workbench with searchable files and readable diffs.
- Native repository picker, recent repositories, and `gitpop /path/to/repo`.
- Linux support with an optional per-user KDE Dolphin context menu.
- Portable Git operations with temporary preview indexes/object storage,
  whole-file selection, and preservation of unrelated staged work.
- Unicode-safe, size-bounded previews; rename, initial-commit, and linked-worktree tests.
- Separate Commit and Push actions. AI suggestions remain optional and explicit.
- Session-only API keys; no new plaintext credential persistence.
- Updated README, real interface screenshots with fictional data, and cross-platform CI.

## Important upgrade note: install this preview manually

Updater signing keys were rotated after encrypted private-key material was found
in repository history. Removing those files did not remove them from history.
This release trusts a new public key, so existing 1.4.x installations must not
be expected to update to it through the old updater. Download a fresh installer
from this official release. No old-key-signed bridge is being published.

The existing stable release and its update channel remain unchanged. This preview
uses a separate `preview.json` channel whose artifact signatures use the new key. Keep the old channel
and this preview distinct.

## Downloads and platform notes

- Linux x86_64: `.deb`, `.rpm`, and `.AppImage`; official Linux builds use Ubuntu 22.04.
- Windows x64: NSIS setup `.exe` or `.msi` (choose one).
- macOS: Apple Silicon (`aarch64`) or Intel (`x64`/`x86_64`) `.dmg`.

Updater signatures are supplied, but these are not Windows Authenticode or Apple
Developer ID/notarization signatures. OS trust warnings may appear; do not bypass
warnings for an untrusted or unexpected download.

Check the published SHA256SUMS before installing. Native Windows/macOS desktop
interaction, authentication prompts, and some Linux desktop combinations still
need field testing. See the
[validation record](https://github.com/vinzify/gitpop/blob/main/docs/VALIDATION.md)
and README for exact boundaries.

Whole-file selection includes unstaged edits. This preview does not implement
hunk staging, pulling, conflict resolution, or Finder integration.
