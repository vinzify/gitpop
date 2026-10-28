# Validation — 1.5.0-beta.1 development preview

Recorded on 2026-10-28. Local desktop checks and hosted build/test checks are
distinguished below; neither establishes support for every desktop/distribution.

## Cross-platform CI

[The release-source checks passed](https://github.com/vinzify/gitpop/actions/runs/40702794841)
for commit `c930f0e`, tagged `v1.5.0-beta.1`: frontend tests/build/formatting and
Rust tests/formatting/Clippy on Ubuntu 22.04, Windows, and macOS, plus Chromium
interface tests. Hosted checks compile native code; they do not drive native
Windows or macOS desktop interactions.

## Release packages

[The packaging workflow passed](https://github.com/vinzify/gitpop/actions/runs/40706344295)
for Linux x86_64, Windows x64, and both macOS architectures. Package/updater
signatures were independently verified against the rotated public key. The
four-platform updater manifest was checked against the downloaded artifacts;
SHA256SUMS covers all release assets.

The actual Ubuntu 22.04-built Debian package was extracted on the host below.
Its version, architecture, and runtime dependencies were checked, and the packaged
executable reported the expected version. This is not a system-wide installation
or native Windows/macOS interaction test.

## Environment

- Ubuntu 26.04.1 LTS, x86_64; KDE, Wayland.
- Rust 1.94.1; Git 2.53.0.
- WebKitGTK 2.52.6; GTK 3.24.52.
- Chromium browser-flow checks used the locally installed Brave executable.
- Development/CI targets Node.js 22. Node.js 20.19.4 also ran the builds/tests,
  but its V8 optimizer crashed during one Prettier run; formatting was rerun
  with an isolated Node.js 22 tool, without changing the system Node installation.

## Automated coverage

- 20 Rust tests passed on disposable real repositories: index preservation,
  unrelated staging, failed commit/signing, initial commits, literal paths,
  Unicode, spaces/newlines where supported, renames, deletions, linked worktrees,
  merge guards, detached HEAD, branch publishing, large selections, preview byte/
  line bounds, and temporary object-store cleanup.
- 4 frontend domain tests passed: current/legacy settings, recent paths, provider
  configuration, and path/error presentation.
- 9 browser-flow tests passed: opening recent repositories, explicit commit without
  automatic push, filtering, AI errors, session-only credentials, provider selection,
  stale diff responses, empty/minimum-size layouts, explicit initialization, and
  cancellation of confirmation dialogs. IPC and dialogs are mocked in these tests.
- Production TypeScript/Vite build passed; development fixture markers were absent
  from its JavaScript assets.
- Rust formatting and Clippy passed with warnings denied.

## Native Linux checks

A release binary and unsigned Debian preview package were built locally without
updater signing artifacts. The package declares Git as a runtime dependency.
This local binary targets the host system; it is not evidence of compatibility
with older Linux distributions.

The native app was launched with a disposable repository and isolated XDG config,
data, and cache directories. It stayed running without startup diagnostics. A
process-ID-scoped AT-SPI check exercised the real WebKit interface and Tauri IPC:

- Repository name, changed file, and real Git diff appeared.
- Including the file updated the Commit action.
- Settings installed an executable Dolphin service menu in the isolated data
  directory and removed that same menu again.

A separate WebKitWebDriver check drove the real native interface to include one
file, write a commit message, and commit through Tauri IPC. Git inspection confirmed
that only the selected file reached HEAD, an unrelated staged edit remained staged,
and nothing was pushed. All content and Git identity belonged to a disposable
fixture repository, not the user's projects.

No actual user repository, settings, or desktop menu was modified. Temporary test
repositories and settings were removed after the smoke run.

```sh
node scripts/native-smoke.mjs
# Optional interactive desktop check; requires PyGObject and AT-SPI:
node scripts/native-smoke.mjs --a11y
```

## Still requires validation

- Native Windows and macOS desktop behaviour beyond the hosted checks above.
- Native folder-picker/confirmation interaction; Dolphin's discovery and launch
  from a real installed menu; a Linux X11 session and other file managers.
- SSH/credential-helper and signed-commit prompts,
  remote hosting authentication, cloud/local model services, and updater/relaunch.
  Real Git commits are tested in Rust and the native Linux fixture above;
  browser commit-flow tests mock IPC.
- Manual-upgrade behaviour in older installations after signing-key rotation.

See [RELEASING.md](RELEASING.md). This remains a preview; older clients must
install it manually. The original stable release/update channel is unchanged.
