# Public Beta data transition

The manual project re-registration reset tool has been removed. Startup now performs the version-3
registration-only transition before the server starts ordinary reads or background work.

See [the native project model and transition contract](product-model-migration.md) for ownership,
preserved settings, removed content, external-execution protection and interruption recovery.

The transition preserves registration IDs, connection settings and app/auth settings, and leaves
original project files and Codex conversations untouched. It runs once for database versions 1/2.
Version-3 restarts preserve all newly created analysis, tasks, discussions and executions.

Do not delete the transition quarantine while startup reports a recovery error. Resolve the identified
external operation or filesystem problem and restart; the version marker determines whether caches
must be restored or obsolete content can be removed. The updater never resends or cancels execution.
