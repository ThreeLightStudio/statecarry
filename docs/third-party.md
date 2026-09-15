# Third-party dependencies and attribution

Review snapshot: 2026-09-15, source commit `557efe5`. This records installed dependency metadata and selected license-file checks. It is not a license grant for StateCarry or a complete notice bundle for a compiled release. Recheck the inventory when the lockfile or release contents change.

## Review scope

The review used pnpm `10.33.2` across the workspace, including the web and server applications and their internal packages. A root-only production query would be insufficient because the root manifest primarily declares development dependencies.

```sh
rtk pnpm --filter '*' licenses list --json
rtk pnpm --filter '*' licenses list --prod --json
rtk pnpm --filter '*' licenses list --dev --json
```

These commands describe installed dependencies, not the exact contents of a built application. Platform-specific packages absent from the installation, dynamically loaded assets and future desktop runtimes require their own review. Keep diagnostic inventories containing machine-specific paths in private review storage; publish only the required attribution material.

## Findings requiring attention

| Package                     | Observed license or notice                                                                                            | Release handling                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOMPurify `3.4.15`          | Package metadata offers `MPL-2.0 OR Apache-2.0`; the installed package contains both license texts.                   | Preserve the selected upstream terms and attribution for any distributed copy. Do not replace its license with StateCarry's root license.                                     |
| khroma `2.1.0`              | pnpm reported `Unknown`; the installed lowercase `license` file contains the MIT text.                                | Retain the original scanner result and the reviewed MIT resolution. Preserve that license and attribution when shipping its code.                                             |
| es-toolkit `1.52.0`         | A separate `NOTICE` identifies Lodash-derived test and compatibility material and contains the associated MIT notice. | Inspect whether relevant material is included and retain the applicable notice with the compiled distribution. The package's top-level identifier alone is insufficient.      |
| robust-predicates `3.0.3`   | Installed `LICENSE` contains the Unlicense.                                                                           | Retain its upstream license information in the dependency notice bundle.                                                                                                      |
| caniuse-lite `1.0.30001810` | Development inventory identifies `CC-BY-4.0`.                                                                         | Do not assume all tooling or data uses MIT. Determine whether its data is distributed and preserve applicable attribution where included.                                     |
| TypeScript `5.9.3`          | Installed `ThirdPartyNoticeText.txt` accompanies the development tool.                                                | Review and preserve applicable notices if the tool or its covered material is redistributed; an installed development dependency is not automatically part of the app bundle. |

Upstream references: [DOMPurify](https://github.com/cure53/DOMPurify), [khroma](https://github.com/fabiospampinato/khroma), [es-toolkit](https://github.com/toss/es-toolkit), [robust-predicates](https://github.com/mourner/robust-predicates), [caniuse-lite](https://github.com/browserslist/caniuse-lite), and [TypeScript](https://github.com/microsoft/TypeScript). The installed version's files, rather than a potentially newer default branch, supplied the review evidence above.

## Source release versus installed application

The first source release distributes the reviewed source tree, manifests, lockfile and public documentation. Dependency folders, generated builds and developer archives are excluded. Dependency imports and declarations do not authorize removing notices from copies that are later bundled.

Before distributing `dist/` or a desktop installer, build an inventory of the actual included JavaScript, fonts, images, runtime and helper executables. Collect each relevant upstream license and notice, keep attribution intact, and include those files in the artifact. Verify the final package contents; neither this table nor a package-manager inventory completes that step. Do not copy another user's local state or diagnostic output into a notice bundle.

Code-origin comments are evidence to review, not proof of copyright ownership or permission. Confirm rights to directly incorporated code and assets when choosing StateCarry's source license. Keep accurate attribution rather than removing it to simplify a scanner result.

See [public source release](public-release.md) for the owner decisions and publication checks, and [development](development.md) for the existing build and packaging commands.
