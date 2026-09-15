# Public source release

Stage 2C applies the approved source license and records third-party attribution and publication settings. Stage 3 publishes the reviewed source and verifies remote access. License application and local verification do not establish that the source has been pushed or remote CI has passed.

## Confirmed source settings

The owner selected these settings on 2026-09-15:

| Setting               | Value                                                                         |
| --------------------- | ----------------------------------------------------------------------------- |
| Source license        | [MIT](../LICENSE)                                                             |
| Copyright attribution | `Copyright (c) 2026 ThreeLight Studio`                                        |
| Repository            | [ThreeLightStudio/statecarry](https://github.com/ThreeLightStudio/statecarry) |
| Local branch          | `main`                                                                        |
| Git author            | Existing configured identity retained; no history rewrite                     |

The standard MIT text is applied as the root `LICENSE` with the approved copyright line. The root and five workspace manifests declare `license: "MIT"` and retain `private: true`. README and development guidance reference that applied license. The selected GitHub repository is connected as `origin`; source push and remote checks remain stage 3 work.

The [GitHub licensing guide](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository) explains repository license placement, and [SPDX identifies this license as MIT](https://spdx.org/licenses/MIT.html). The root `LICENSE`, rather than this process document or an ignored proposal, supplies the license terms.

## Source and dependency notices

Preserve applicable license and attribution notices for any directly included external source or asset. Review installed dependencies separately from copied source: a package declaration and a shipped copy of a package are different release contents. The locked dependency inventory is review evidence, not a blanket declaration that every dependency uses StateCarry's source license.

The first public source release includes the reviewed Git contents only. It does not attach the developer's existing `dist/`, dependency directory, private records, tool caches or local release archives. This keeps binary packaging and its full dependency notice bundle as a separate delivery step.

For a later compiled release, identify what is actually included and preserve the relevant upstream license texts, copyrights and any required `NOTICE` material. Review JavaScript dependencies, any shipped fonts/assets, and bundled runtimes or executables. A top-level summary of package names does not replace their license texts. A passing application test does not validate redistribution notices.

## Review the exact publication candidate

Once license and notice edits are ready, use the checked-in formatter and verification commands. Inspect the resulting diff and commit only the intended public files. Confirm that the selected branch and any tags to publish contain the reviewed source, license and public documentation. Keep private source inventories and review reports outside the committed tree.

```sh
rtk pnpm format
rtk pnpm verify:fresh
rtk git diff --check
rtk git status --short
```

`verify:fresh` executes the checks rather than replaying a previous cached pass. It may recreate ignored build output. Describe any cached, unexecuted or unsupported checks accurately. Source preparation retains the development-preview status and the unresolved user-workflow items in [the roadmap](roadmap.md).

## Publication and post-publication checks

Recheck `origin` and the chosen repository immediately before publication. The owner has already created `ThreeLightStudio/statecarry`; do not create a second destination or replace remote history. Inspect any existing remote branches and publish only the reviewed local branch without unrelated branches/tags.

Publish the reviewed branch in stage 3, then confirm the remote repository's visibility, default branch and commit. Check anonymous source access and a credential-free clone. Keep the repository URL and the exact reviewed/published commit in the private release record. Do not infer public accessibility from an authenticated request alone.

Inspect the actual GitHub Actions run for that commit. Local workflow validation and local `verify` results are separate evidence. If remote CI is unavailable or fails, report the concrete outcome instead of labeling it passed. Repository policies and branch protection can be configured for the actual collaboration model; they are not assumed to exist.

The source release remains separate from an installable desktop application, successful human work resumption and any contest submission. See [development](development.md) for current commands and [the tooling and desktop plan](tooling-and-desktop-plan.md) for later delivery requirements.
