# Public Beta data reset

The next StateCarry beta update resets existing project data once, on the first launch after the
update. Users need to register their projects again and start with a fresh StateCarry workspace.

The reset removes project registrations and connections, analyses, observations, directions, work,
discussions, execution records, project-specific browser drafts and action state, analysis caches,
analysis logs, and copied project images. The reset preserves app-wide analysis settings and
credentials, the appearance theme, original project files and Git metadata, and external Codex
conversations. New projects and records created after the reset remain available on later launches.

An unresolved external execution blocks the reset with an error. StateCarry does not cancel or
resend the operation. A known completed, failed, or interrupted operation does not block it.

Startup recovery uses the database version marker and a quarantine limited to StateCarry-owned
paths. If startup stops before the database commit, moved content is restored. If startup stops
after the commit, the reset completes on the next launch. See
[the native project model transition contract](product-model-migration.md) and
[`tests/beta-cutover.test.ts`](../tests/beta-cutover.test.ts).
