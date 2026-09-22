# Project detail implementation

The design 03 flow is connected to the production project gateway. Older gateways without the
decision capability continue using the existing detail surface. The new surface is loaded only
when project details need it; the standalone design prototype remains reference material.

## Data and behavior

- The project decision record is stored with the existing work in Core. It contains scope-specific
  leave decisions, user corrections, direction decisions, policy conflicts, request references,
  result comparisons and acceptance. The current goal remains the canonical direction.
- Work-group IDs are assigned by Core and retained across an unambiguous matching file group.
  Ambiguous regrouping preserves earlier discussions and requires an explicit connection.
- Scope inspection is separate from bounded analysis previews. It reads staged and unstaged hunks
  and whole-file changes without altering Git. Incomplete scope is not an empty change set.
- Preparing, copying and sending a request validate the current scope. Sending validates again
  after conversation creation. A changed scope preserves the request but prevents stale execution.
- The execution adapter uses a separate Codex App Server transport. It does not grant approvals
  automatically. Verification and direction discussion use a read-only turn. Reports are attached
  using conversation, turn and request identifiers; an unknown send is never retried automatically.
- Result receipt triggers current-project comparison. Reports, changed sections and acceptance
  remain different facts. A copied request can receive an explicitly user-recorded external result.
- Browser drafts retain per-work/per-operation inputs. Saved server decisions survive restart;
  input storage failures remain visible. Earlier discussions retain the evidence version of each answer.

## Validation boundaries

Automated coverage includes scope separation in a temporary Git repository, stale-scope rejection,
duplicate-send prevention, ambiguous send recovery, policy conflicts, external reports, explicit
acceptance and browser draft restoration. A local preview uses an isolated in-memory project and
a fake execution adapter to exercise the actual HTTP/UI flow without invoking Codex.

Real Codex execution against an installed provider and a returning user's comprehension remain
separate acceptance checks. Automated tests and fixture reports do not establish those outcomes.

The feature does not deploy or package a stable desktop release. Existing user changes in the
working tree are retained.
