# Repository checks

- Run shell commands through `rtk`; use `rtk proxy` when RTK has no specialized wrapper.
- Use the checked-in Oxfmt and Oxlint configuration. Do not add broad disables or skip tests to make checks pass.
- Use `rtk pnpm format:check`, `rtk pnpm lint`, and `rtk pnpm check` while working. Run focused tests for changed behavior.
- Run `rtk pnpm verify` before handoff and report any failure. It may replace ignored `dist/` output but must not rewrite source or configuration.
- Treat `pnpm-lock.yaml` as pnpm-owned output; do not format or edit it manually.
- Follow `docs/ux-writing.md` for active user-facing copy, including labels, statuses, errors, notices, helper text, and presentation strings that can reach the UI.
