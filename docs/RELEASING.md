# Release checklist

The 1.5 refresh is a preview. Stable users are not automatically repointed to it.
Public previews require successful platform checks, signed artifact verification,
and explicit migration notes. Manual desktop gaps remain documented.

## Signing review required

An encrypted updater private-key file was previously tracked in this public
repository. It is removed from the current tree and ignored, but remains in Git
history. Removing a file does not revoke a key, establish whether it was decrypted,
or repair trust in already-installed clients.

Before a public release:

1. Review the signing-key exposure, password strength, and release-secret access.
2. Generate a new updater signing pair outside the repository. Store the private
   key/password only in GitHub Actions secrets and a private backup.
3. Update `plugins.updater.pubkey` and the public verification-key file together.
   Never log or commit private signing material.
4. Plan the transition for existing Windows 1.4.x installations: those clients
   trust the old public key and cannot validate a release signed only by the new
   key. A manual reinstall from verified official release assets may be required.
   Do not assume a bridge signed by a potentially exposed key re-establishes trust.
5. Review the existing `latest.json` and updater endpoint. Published stable
   artifacts/manifests retain their original key; the new preview embeds the
   rotated key and uses the separate `preview.json` endpoint.

## Validate

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

- Pass the GitHub Actions Linux, Windows, and macOS checks.
- Check open-folder, initial commit, selected-file commit, unrelated staging,
  failed hooks, authentication, branch publishing, and update/relaunch flows.
- Check Linux KDE Wayland and an X11 session; check the native dialog and optional
  Dolphin service menu from an installed build, not a temporary AppImage mount.
- Check Windows Explorer integration and macOS permissions/Gatekeeper behaviour.
- Check that demo fixtures are absent from the production JavaScript.
- Do not describe an untested desktop/distribution or unsigned build as supported.

## Draft releases

The preview signing pair has been rotated. Versioned GitHub secrets
`TAURI_SIGNING_PRIVATE_KEY_V2` and `TAURI_SIGNING_PRIVATE_KEY_V2_PASSWORD` are used
for new builds. The old secrets are retained for recovery, not used by this workflow.
No private key or password belongs in this repository. Both `preview.json` and
the current release's `latest.json` refer to artifacts verified by the new public key;
the original stable release/update channel is untouched.

The release workflow is manual and produces a **draft prerelease**, never an
automatic public release on tag push. It requires explicit confirmation that the
signing migration has been reviewed. Check version consistency, create the tag,
then dispatch the workflow with that tag. Verify all assets/signatures and update
metadata before publishing. GitHub updater signatures are separate from Windows
code signing and Apple signing/notarization.

The workflow maps `X.Y.Z-beta.N` to numeric MSI version `X.Y.Z.N`; a stable
`X.Y.Z` maps to `X.Y.Z.65535`. This is an installer-only override: the app and
updater keep the original semantic version. Default MSI bundling from a beta
source checkout needs the same WiX version override.

Each platform uploads packages/signatures without touching updater metadata.
A single final job requires all four builds and creates `latest.json` with Linux
x86_64, Windows x64, macOS Apple Silicon, and macOS Intel entries. This avoids
parallel writers dropping platforms or replacing one another's draft assets.

After verifying every signature and the complete manifest, upload SHA256SUMS,
copy the manifest to `preview.json` on main, and publish as a **prerelease** with
`--latest=false`. Do not replace the old stable `latest.json` channel.
