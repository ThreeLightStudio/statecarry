# Public source release

Stage 2C prepares the source license, third-party attribution and publication settings. Stage 3 publishes the reviewed source and verifies remote access. A local commit or successful build does not establish either an approved license or a completed public release.

## Owner decisions

Before publication, confirm the source license, the actual copyright holder's preferred attribution and the repository owner/name. The repository owner and the copyright holder are separate choices. Keep the existing Git author identity unless a change is explicitly requested; avoid rewriting completed history simply to adopt a source license.

After those decisions, add the unmodified chosen license text as root `LICENSE`, replacing only its designated fields. Set the corresponding SPDX identifier on the workspace manifests, retaining `private: true`. Update the README and development guide's pending-license language. Do not treat an ignored license proposal as an applied license.

The [GitHub licensing guide](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository) explains the role and placement of a repository license. [MIT](https://choosealicense.com/licenses/mit/) is a permissive option; [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) also includes an express patent grant and additional notice provisions. Selecting either one requires the owner's decision. This document grants no rights on its own.

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

Recheck the chosen remote immediately before creating or using it. A repository not resolving in a prior query does not reserve the name or prove creation permission. Do not replace an existing repository or publish unrelated branches/tags. Create a destination without generated starter files when preserving the reviewed local history.

Publish the reviewed branch in stage 3, then confirm the remote repository's visibility, default branch and commit. Check anonymous source access and a credential-free clone. Keep the repository URL and the exact reviewed/published commit in the private release record. Do not infer public accessibility from an authenticated request alone.

Inspect the actual GitHub Actions run for that commit. Local workflow validation and local `verify` results are separate evidence. If remote CI is unavailable or fails, report the concrete outcome instead of labeling it passed. Repository policies and branch protection can be configured for the actual collaboration model; they are not assumed to exist.

The source release remains separate from an installable desktop application, successful human work resumption and any contest submission. See [development](development.md) for current commands and [the tooling and desktop plan](tooling-and-desktop-plan.md) for later delivery requirements.
