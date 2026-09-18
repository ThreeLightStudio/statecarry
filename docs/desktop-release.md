# Desktop release runbook

Status: current macOS Apple Silicon release procedure, verified through `v0.1.2` on 2026-09-17 KST.

This runbook covers a StateCarry stable desktop release: versioning, repository verification, Electrobun packaging, Developer ID signing, Apple notarization, GitHub Release publication, landing-page compatibility, and post-release update checks.

Automatic-update architecture and lifecycle details live in [desktop automatic updates](auto-update.md).

## Release invariants

A desktop release is ready only when all of these statements are true:

- the source commit to be tagged has passed `rtk pnpm verify:fresh`;
- the stable Electrobun build is signed with a valid Developer ID Application identity;
- the DMG is accepted by Apple's notary service and has a stapled ticket;
- the application inside the DMG passes Gatekeeper assessment as a notarized Developer ID app;
- GitHub Release contains the DMG, update bundle, and update manifest produced by the same build;
- the Git tag resolves to the reviewed release commit;
- `releases/latest/download/stable-macos-arm64-update.json` returns the intended stable version;
- a downloaded/installed build is exercised before relying on it as the public desktop path.

Do not publish a release from a dirty tree or from artifacts generated before the final release commit/version was fixed.

## Credentials

Keep release credentials outside Git.

Required for macOS distribution:

- a Developer ID Application certificate and private key available to `codesign`;
- Apple notarization credentials, using either App Store Connect API-key credentials or Apple ID/app-specific-password credentials supported by the local release tooling.

Electrobun's signing environment uses `ELECTROBUN_DEVELOPER_ID`. Its built-in notarization path can use the documented `ELECTROBUN_APPLEAPIISSUER` / `ELECTROBUN_APPLEAPIKEY` / `ELECTROBUN_APPLEAPIKEYPATH` set or `ELECTROBUN_APPLEID` / `ELECTROBUN_APPLEIDPASS` / `ELECTROBUN_TEAMID` set.

For local notarization, `xcrun notarytool` may instead use a named Keychain profile. The profile name is local operator state and should not be committed. Never put credential values, certificate-owner identity, Team IDs, Apple account addresses, or notary submission IDs into repository documentation or release notes.

## 1. Choose and synchronize the version

Use a semantic desktop version such as `0.1.3`. Update the current desktop-facing version locations together:

```text
package.json
apps/desktop/src/app-version.ts
apps/server/src/adapters/rpc.ts
```

`electrobun.config.ts` consumes `APP_VERSION` from `apps/desktop/src/app-version.ts`, so keep the literal version in that shared file instead of duplicating it in the Electrobun config.

Check for stale occurrences before release:

```sh
rtk rg -n '0\.1\.[0-9]+' package.json apps/desktop/src/app-version.ts apps/server/src/adapters/rpc.ts
```

Review the diff and keep unrelated work out of a version-only release commit.

## 2. Verify the release source

Run the uncached repository checks:

```sh
rtk pnpm verify:fresh
rtk git diff --check
rtk git status --short
```

Commit and push the reviewed source before creating final release artifacts. Record the public commit SHA/tag in the GitHub Release; do not record private machine paths or local diagnostic output.

## 3. Build the stable artifact

The checked-in configuration keeps stable signing, notarization, DMG creation, and GitHub update hosting enabled:

```ts
mac: { codesign: true, notarize: true, createDmg: true }
release.baseUrl = 'https://github.com/ThreeLightStudio/statecarry/releases/latest/download'
```

Load the local release credentials before starting a stable build. The credential file is local operator state and must stay outside the repository:

```sh
source ~/.config/statecarry/release-env.zsh
rtk pnpm desktop:build:stable
```

The release environment file supplies `ELECTROBUN_DEVELOPER_ID` plus the Electrobun-compatible notarization credentials. With those variables loaded, the stable build completes signing and notarization in one invocation.

If local notarization is performed separately with a Keychain profile, create the signed stable artifacts without committing a disabled notarization setting, restore the checked-in configuration immediately, and keep the tree clean before publication. This is a local release-operation detail, not a repository configuration change.

Electrobun writes release files under the ignored artifact directory. The release requires:

```text
.cache/electrobun/artifacts/macos-arm64-StateCarry.dmg
.cache/electrobun/artifacts/stable-macos-arm64-StateCarry.app.tar.zst
.cache/electrobun/artifacts/stable-macos-arm64-update.json
```

Inspect the update manifest and confirm its version/channel/platform/architecture and bundle filename before uploading it.

## 4. Notarize and staple

When using a local `notarytool` Keychain profile, submit the signed DMG and wait for completion:

```sh
xcrun notarytool submit \
  .cache/electrobun/artifacts/macos-arm64-StateCarry.dmg \
  --keychain-profile '<local-profile-name>' \
  --wait
```

Continue only after the service reports `Accepted`.

Staple and validate the ticket:

```sh
xcrun stapler staple .cache/electrobun/artifacts/macos-arm64-StateCarry.dmg
xcrun stapler validate .cache/electrobun/artifacts/macos-arm64-StateCarry.dmg
codesign --verify --deep --strict --verbose=2 .cache/electrobun/artifacts/macos-arm64-StateCarry.dmg
```

For Gatekeeper verification, mount the DMG and assess the contained `StateCarry.app`. The expected source is `Notarized Developer ID`. Use the actual mount point returned by `hdiutil`; do not hard-code a user-specific volume suffix.

Do not copy the notarization submission ID, signing identity owner, Team ID, or local mount/home paths into the repository.

## 5. Freeze artifact hashes

Calculate hashes after stapling because stapling changes the DMG bytes:

```sh
shasum -a 256 \
  .cache/electrobun/artifacts/macos-arm64-StateCarry.dmg \
  .cache/electrobun/artifacts/stable-macos-arm64-StateCarry.app.tar.zst \
  .cache/electrobun/artifacts/stable-macos-arm64-update.json
```

Artifact hashes may be recorded in release evidence. They contain no credential or user-record content.

## 6. Create the GitHub Release

Prefer a draft until artifact upload and integrity checks are complete. The tag should target the reviewed release commit.

Upload exactly the three stable assets listed above. After upload, download the assets again or use GitHub's reported digest and confirm the bytes match the local post-staple artifacts.

The current updater consumes GitHub's **latest normal release**. Versions intended for automatic discovery must therefore be published as normal releases rather than GitHub prereleases.

Before publishing, confirm:

- release tag/version matches the Electrobun manifest version;
- target commit is the reviewed release commit;
- all three assets are present and uploaded successfully;
- asset digests match;
- the release notes describe user-visible changes without including credentials, private paths, or diagnostic identifiers.

After publishing, verify:

```sh
rtk gh api repos/ThreeLightStudio/statecarry/releases/latest --jq '{tag_name,name,draft,prerelease}'
```

and read the public manifest from:

```text
https://github.com/ThreeLightStudio/statecarry/releases/latest/download/stable-macos-arm64-update.json
```

It must return the version just published.

## 7. Landing page

The landing page uses the stable GitHub `latest/download` DMG URL:

```text
https://github.com/ThreeLightStudio/statecarry/releases/latest/download/macos-arm64-StateCarry.dmg
```

The landing page is deployed to Cloudflare Pages from the `main` branch. Cloudflare builds it from the repository root with `pnpm landing:build` and publishes `dist/landing` to `https://statecarry.threelight-studio.com`.

Because the download URL tracks the latest normal GitHub Release, routine patch releases do not require a landing-page link edit. When landing content changes, confirm the Cloudflare Pages deployment for the corresponding `main` commit and verify the custom domain over HTTPS. GitHub Releases remain the distribution source for the DMG and automatic-update assets; landing-page hosting is independent of desktop release delivery.

## 8. Installed-app checks

For a first install or bootstrap release, install the DMG into `/Applications` and launch it from Finder. Confirm the app starts outside the source tree, uses the expected saved project data, and can access required local integrations.

For an update-capable installed version, also confirm:

1. **Check for updates** discovers the new stable release.
2. **Download update** reaches the ready state.
3. **Restart** closes the owned runtime and hands off to Electrobun.
4. The relaunched app reports the new current version and no longer offers the same update.

`v0.1.1 -> v0.1.2` was the first controlled end-to-end updater verification. See [desktop automatic updates](auto-update.md#verified-rollout-history).

Native updater tests should not rely on a temporary app-bundle copy as the only isolation boundary. Electrobun may share managed installation metadata between stable apps with the same identifier/channel under one macOS account. See [updater test isolation](auto-update.md#isolation-for-native-updater-tests) before repeating an end-to-end update test.

## 9. Current delta-update policy

`release.generatePatch` is currently `false`. Stable releases publish and download the full compressed application bundle. Do not enable delta patches as an incidental optimization during a release. Test previous-release lookup, patch production, multi-hop behavior, and full-bundle fallback before changing this policy.

## Failure handling

- If `verify:fresh` fails, fix the source and create new release artifacts from the new commit.
- If code signing fails, do not weaken signing settings; repair certificate/Keychain access.
- If notarization is not `Accepted`, inspect the notary log locally and do not publish the artifact.
- If Gatekeeper does not report a notarized Developer ID app, do not ship the DMG.
- If GitHub asset hashes differ after upload/download, replace the draft asset before publishing.
- If the updater cannot discover the published release, verify that the release is normal (not a prerelease), that `latest/download` points to it, and that the manifest/bundle names match.
- If an update apply does not start the Electrobun native handoff, StateCarry falls back to a normal quit. Investigate local updater logs before retrying publication changes.

## Privacy checklist

Before committing release documentation or notes, search the changed files and remove:

- real home-directory/user names;
- Apple account addresses, certificate-owner names, Team IDs, Keychain profile secrets, API-key filenames tied to a person, and app-specific passwords;
- notary submission IDs and native update transaction IDs;
- private project paths, local databases, Codex session content, or copied terminal logs containing them.

Use placeholders such as `<local-profile-name>`, generic certificate labels, public repository URLs, public tags/commits, and aggregate verification results instead.
