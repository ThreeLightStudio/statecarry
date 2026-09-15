# StateCarry — development preview

Pick up interrupted Codex work. StateCarry reads the records you connect, suggests a task to resume and its first useful action, and supports opening the original Codex session after local navigation setup.

**Development preview:** source preparation and automated checks are separate from a validated end-to-end MVP. Work-specific state and navigation gaps remain in the [roadmap](docs/roadmap.md).

**Resume → Confirm → Act.** Check what to do and when that step is finished. Expand **Why This?** only when you need the evidence. Use **Not This** to correct the work, next step, completion, or pause status.

This is a local Mac application with a browser UI. It does not execute the next action or send a message to Codex. Records and corrections are stored on your Mac. **Relevant conversation excerpts and scoped project observations, including limited file previews, are sent through your signed-in Codex account for model analysis; this is not offline AI.**

## Run from source

Requirements: Apple Silicon macOS, Node **24.14.1+**, pnpm **10.33.2**, RTK on PATH, Codex CLI and desktop installed and signed in. Development used RTK 0.28.2 and Codex CLI 0.152.0. Other OS/CLI combinations are unverified.

- [Node](https://nodejs.org/en/download)
- [RTK](https://github.com/rtk-ai/rtk#installation) — required by the runtime adapter
- [Codex CLI](https://developers.openai.com/codex/cli/)
- [Codex desktop](https://developers.openai.com/codex/app/)

Open a terminal in the source folder, then:

```sh
rtk pnpm install --frozen-lockfile
rtk pnpm build
rtk proxy node dist/server.mjs
```

Open [StateCarry](http://127.0.0.1:4310). Keep the terminal running; Ctrl+C stops it. A prepared `dist/` can run without pnpm or the source, but still needs Node, RTK, Codex, and your login. Run it from the folder containing `dist/`.

An agent can install dependencies, build, and diagnose startup. Sign in yourself (`rtk proxy codex login` if needed); never share credentials. No separate API key is required. Model access and usage limits belong to your Codex account; there is no automatic model fallback.

## First use

1. Choose **Connect records**. Enter a name and your Codex project's absolute folder path.
2. Find conversations and select the records you allow StateCarry to read. Start with the related sessions for one goal. Optional turn boundaries narrow access. Folder discovery can propose additional related sessions; disable it if you only want your selection.
3. Save the connection. StateCarry opens Resume and starts finding candidates. Initial analysis can take time; the page shows its progress. Return visits read saved results; request a recheck when a fresh analysis is needed. Editing a goal can also trigger analysis.
4. Read the purpose, **Where you left off**, **Why this is next**, **Next action**, and **Complete when**. Inferred goals are labelled. **Confirm or edit goal / Set goal** saves your intended result within the same connected work; it creates no project or session. Required constraints appear before the primary action. A suggested action is labelled and needs your judgment.
5. Choose **Confirm & open in Codex** when the recorded route is available. Otherwise, choose **Copy handoff instructions** and paste them into the intended conversation. Opening or copying does not perform the proposed work. The full message and previous conversation ID are under **Review handoff instructions**; supporting records and optional session tools remain in separate details.

Returning reads the saved candidate. Newer records can mark that snapshot as older so you can confirm relevance or recheck. **Find resume candidates / Recheck records** performs a fresh collection and bounded analysis. Review the candidate's goal and evidence after changing a goal or access scope; known validity gaps are listed below.

For first-time navigation setup, run the following command in an interactive terminal, replacing `YOUR_THREAD_ID` with a conversation you intend to open:

```sh
rtk proxy node dist/verify-connection.mjs --verify-navigation YOUR_THREAD_ID
```

The helper opens that conversation and asks you to inspect its title and content before recording confirmation. An accepted OS request alone is not proof of arrival. Existing navigation evidence is preserved. This diagnostic is optional for source checks and is not run by the automated tests.

| State   | What you see                                            |
| ------- | ------------------------------------------------------- |
| active  | A first action, its source and its completion condition |
| waiting | Dependency and condition for resuming                   |
| paused  | The deferral and relevant resumption condition          |
| unclear | What needs to be clarified; no invented next action     |
| done    | Completion; no next action                              |

**Not This** lets you dismiss wrong work, supply a corrected next step and its Done When, mark done, or pause. Corrections persist across restarts and inform later analysis within the same record scope. Restore is available for mistakes. Other candidates are under **Resume something else**. Original records are never edited.

Goal and action drafts, candidate selection, open reading panels and scroll position are saved in this browser for each work. Returning from details or reloading keeps these edits. A draft from earlier records retains its original version: review it against the latest brief and explicitly choose **Use current records for this edit** before saving it against that version. Browser storage failures are shown on screen; clearing site data removes browser drafts, not saved server records.

Use **Manage connections** to find disconnected work. **Disconnect this work** in the details screen stops that connection and opens the management page. **Reconnect this work** restores the original work, saved results and corrections without creating another connection or starting analysis. Collection can resume after reconnection; a fresh analysis remains explicit.

## Scope and data

StateCarry analyzes connected records, not every record on your device. Related sessions may form one candidate; unrelated goals may produce separate candidates. Analysis includes selected conversation excerpts, bounded observations and previews of project files, and workspace state. The excerpt budget is not a bound on the entire model request. Missing history is not proof of completion. Candidate ranking is a suggestion, not knowledge of your current priority.

The default storage is `~/.statecarry`. It contains private records, analysis output, and corrections; do not include it in a submission or sample. Only one server can write to a data directory. To use a separate local instance:

```sh
rtk proxy env STATECARRY_DATA_DIR=/absolute/path/to/private-data STATECARRY_PORT=4397 node dist/server.mjs
```

Open the matching port. The server binds to `127.0.0.1` and rejects unexpected Host/Origin headers. Do not expose it through public hosting or a tunnel. The supported release form is local source or a prepared local build.

The isolated model reader disables execution tools. Original records remain untrusted evidence. Exact quote validation checks source references; it does not guarantee the model's interpretation is correct. Use correction when the suggested work or action is wrong.

Legacy context screens remain under **More context / connection settings**. Entering these screens reads saved results; explanation preparation requires its explicit button. Their background long-form analysis is disabled by default. `STATECARRY_LEGACY_ANALYSIS=1` explicitly enables that older processing path; it is unnecessary for Resume and consumes additional model usage.

## Troubleshooting

- **Port already in use:** stop the existing server in its terminal or choose another port. Do not delete its database.
- **Records missing / partially collected:** check CLI login, selected session IDs and turn boundaries in connection settings. No action is shown when collection fails. Compressed or partial records are identified before acting.
- **Analysis failed:** check the visible error, account limits and configured model access, then retry. Existing records and corrections are retained.
- **App link does not open:** install/open Codex desktop, permit your browser's external-app link, or use the displayed session ID manually.
- **Unexpected candidate:** use Not This. A recent session is not necessarily your desired work.

## Development and release checks

```sh
rtk pnpm verify
```

`verify` uses the repository's local Turborepo cache for deterministic checks and the production
build. Use `rtk pnpm verify:fresh` when release evidence must execute those tasks instead of reading
prior cache entries. See [development](docs/development.md) for focused tests, the workspace layout,
cache boundaries, contribution guidance, diagnostics and local packaging.

## Known limitations

Goal and correction drafts are local to the same browser profile and origin (including port); they are not synchronized between devices. A server disconnection keeps the already-loaded brief available for review in the current tab, while actions requiring current records remain blocked. Reconnection reloads saved results without starting analysis. Only drafts and reading preferences are written to browser storage, not server evidence or action permissions. After a completely new tab or browser process starts offline, the server must return before its saved brief can be read again.

The compact narrative uses the existing generated current-state summary and recorded reason. It does not independently verify the model's interpretation. Route, storage and recovery tests use controlled inputs; actual Codex arrival, human understanding, and a complete later work return remain in the [roadmap](docs/roadmap.md).

Changing the goal or record scope hides the previous candidate until the selected records are checked. A temporary read failure can retain a same-scope brief with accessible supporting evidence, but its action remains blocked. An unchanged bounded file sample is shown as a limitation without forcing another identical analysis; it is not proof that every project file was checked.

The primary v0 scope excludes automatic execution, full project management, new provider integrations and environment restoration. Existing auxiliary context screens are retained. A public download and a completed real-work validation are separate release steps. Keep private `.cache/` observations out of shared source and builds.

## License

StateCarry is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 ThreeLight Studio.

Third-party components retain their own licenses and attribution requirements. Workspace packages remain `private: true` to prevent accidental npm publication.

See [public source release preparation](docs/public-release.md) for the confirmed settings and publication checks, and
[third-party attribution](docs/third-party.md) for the reviewed dependency notices and binary-release limits.
