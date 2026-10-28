# Contributing to GitPop

Small, focused contributions are welcome. Please describe the user-visible problem,
the affected OS/desktop, and how you tested the change.

## Development

Install Git 2.31 or newer, stable Rust, Node.js 22, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```sh
npm ci
npm run tauri dev
```

The UI uses React/TypeScript; portable Git operations live in
`src-tauri/src/git.rs`, provider requests in `ai.rs`, and OS-specific integration in
`platform.rs`. Keep OS APIs behind appropriate conditional compilation.
Tauri JavaScript and Rust packages must stay on compatible major/minor releases;
do not upgrade only one side.

## Before opening a pull request

```sh
npm test
npm run format:check
npm run build
npx playwright install chromium
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Use `npm run format` and `cargo fmt --manifest-path src-tauri/Cargo.toml` for formatting.

Git tests must use disposable repositories, never a contributor's actual working
tree. Cover spaces, Unicode, staged/unstaged work, initial commits, renames, and
failure paths whenever changing Git operations. Never silently reset unrelated
staging or auto-push as a side effect of another action.

Browser tests use dev-only fictional fixtures (`?demo=workbench`).
They do not establish native OS compatibility. Do not ship test fixtures in the
production bundle or screenshots containing private repository data.

To regenerate documentation images:

```sh
node scripts/capture.mjs

# Optional: use a local Chromium-compatible browser instead of Playwright's download:
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/browser node scripts/capture.mjs
```

On Linux, after a local release build, `node scripts/native-smoke.mjs` launches a
disposable repository with isolated settings. Its optional `--a11y` flag needs
Python PyGObject and the AT-SPI typelib; see [validation notes](docs/VALIDATION.md).
It opens and closes a real window, so run it only in an appropriate desktop session.

## Releases and signing

See [RELEASING.md](docs/RELEASING.md). Public releases require a separate signing
review. Never add API credentials, private signing keys, generated build products,
or real user data to a patch. Use fictional API keys in tests.
