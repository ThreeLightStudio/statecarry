# Fresh project registrations

The owner authorized clearing the previous registrations and their content on 2026-09-16 KST. The old recommendations were not considered a usable evaluation baseline. This supersedes the earlier requirement to keep the session/goal registrations as separate visible projects.

The inspected workspace contained four registrations, all pointing to the same StateCarry folder. The six visible candidate recommendations belonged to those old registrations. The approved replacement is one fresh StateCarry project, with new work/connection IDs and no inherited goal, source connection, recommendation, correction or acceptance. Other folders are not registered merely because they exist on the computer.

## Registration behavior

The working folder selects a project registration. Re-entering the same folder returns its existing identity instead of adding a project for a different session. This does not replace its saved context, connect submitted conversations, or restore a disconnected project. Conversations are connected through project source settings. The server resolves existing local folder aliases; Core also compares equivalent absolute path spellings. Different folders with the same name remain separate projects. Changing a goal inside a managed project keeps the same project identity.

Home and project screens do not invent recommendations before new context is prepared. The fresh-project flow starts with a project purpose and current goal, selection of relevant conversations, and an explicit request for an updated overview. These are configuration choices, not AI-derived claims about remaining work.

## Offline reset

`scripts/reset-project-registrations.ts` previews registered folders and record counts without printing conversation or goal bodies. Applying requires the server writer to be stopped and the preview token to still match. Unresolved dispatched executions block the reset. Obsolete queued analysis is removed under the explicit cleanup authorization.

Before replacing database content, the tool creates a private SQLite backup and moves old analysis, analysis caches/feedback, explanation candidates and activity/analysis logs out of their active locations. It then replaces all content rows with one fresh registration per actual folder in a transaction. A failed write restores both database content and active cache locations. Minimal request receipts remain to prevent late retries from recreating retired registrations. Backups are not loaded into recommendations. Project files, upstream conversations, login and navigation capability settings are unchanged.

```sh
# Preview using the explicitly chosen existing application data directory.
rtk pnpm exec tsx scripts/reset-project-registrations.ts --data-dir /absolute/path/to/private-data

# After stopping its server, preview again and apply with that returned token.
rtk pnpm exec tsx scripts/reset-project-registrations.ts --data-dir /absolute/path/to/private-data --apply --token PREVIEW_TOKEN
```

The browser removes retired work drafts only after a successful complete project list, including disconnected registrations. Cleanup is limited to the known `statecarry.resume.v1.` and `statecarry.work.v1.` namespaces. A failed read cannot delete drafts, and a late scroll cleanup cannot recreate a retired work key.

## Execution and validation

`rtk pnpm format:check`, `rtk pnpm lint`, `rtk pnpm check` and final `rtk pnpm verify` passed. The full run executed all six tasks without cache hits: **76 test files / 588 tests** and the server/web build. The 205 public source/configuration/document files had the same digest before and after verification: `e5aa0146415f3541151ecabe38e1837174dd584f36761716395af71128eefa48`. Existing legacy React `act(...)` warnings remain. The completion record was updated afterward.

The real reset was **not applied**. After the identified development launcher stopped normally, the read-only preview found four registrations in one folder, 6,134 imported source copies, and no unresolved execution records. The explicit `--apply` tool request was refused by the tool safety check twice. A read-only preview between those attempts returned the exact same token and counts; no alternative write route was used.

The development server was restored using the same `~/.statecarry` directory with legacy automatic analysis disabled. Both frontend 4311 and backend 4310 returned HTTP 200. A final metadata-only workspace read confirmed that the four old IDs and six recommendations remain, with zero running model analyses. Thus the registration/cleanup implementation is complete, but the owner-authorized real-data reset still requires execution from a local terminal after stopping that server. The private backup and fresh IDs will be created by a successful apply; they have not been claimed as existing here.
