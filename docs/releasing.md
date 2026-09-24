# Releasing

Fusion Power User is distributed as a VSIX attached to a GitHub Release, checksummed with SHA-256. There is no marketplace publication.

## Cutting a release

1. Bump `version` in `package.json` to the release version, following semver. A prerelease uses a hyphenated suffix, for example `0.6.1-beta.0`.
2. Run `just release` locally. It fetches remote tags, fails if a local tag for the current version already exists, then runs `just check` and `just package`, writes `vsix.sha256` for the built VSIX, and prints the tag, VSIX name, and checksum it would publish. It never pushes a tag or creates a release.
3. Commit the version bump and land it on `main` through the normal PR flow. Wait for that merge commit's CI run, including the smoke jobs, to go green before tagging it.
4. Tag the merged commit and push the tag: `just jj tag set v<version> -r <main commit>` then `just jj git push --tag v<version>`, where `<version>` matches `package.json` exactly, including any prerelease suffix.
5. Pushing the tag triggers `.github/workflows/release.yml`, which reuses the same check-and-package job as CI, verifies the tag matches `package.json` and that the tagged commit is an ancestor of `origin/main`, downloads the built VSIX and checksum, and creates a GitHub Release with both files attached. A tag with a hyphenated suffix (`-alpha`, `-beta`, `-rc`, or any other prerelease qualifier) is published as a prerelease.

## Consumer pinning

Consumer repositories, per Phase 10, pin an exact version and its SHA-256 checksum rather than tracking a moving tag. The installer downloads the VSIX for the pinned version and refuses to install it if the checksum does not match the release asset.

## Rollback

Rollback is re-pinning the consumer to the previous release's version and checksum; there is no in-place patch to a published release. A bad release is marked prerelease with `gh release edit v<version> --prerelease` rather than deleted, so an existing pin can still resolve the asset while new consumers do not pick it up as the latest stable release. Never delete a published release or its assets; a deleted asset breaks every consumer still pinned to it.
