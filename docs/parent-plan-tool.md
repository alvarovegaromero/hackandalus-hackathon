# Parent tool: update the persisted global plan

Person A can add `createParentPlanTools(runId)` from
`src/lib/coordinator/plan-tools.ts` to its AI SDK tool set. runId is bound by the
server; model input cannot select another crisis. This is an integration module,
not automatically attached to the existing inline coordinator or the subagents.

`updateGlobalPlan` accepts:

```json
{
  "expectedRevision": 12,
  "plan": {
    "objective": "Coordinate the simultaneous wildfire and flood response",
    "steps": ["Maintain existing commitments", "Review unmet needs across both incidents"]
  },
  "reason": "New subagent result reports unmet medical needs"
}
```

The tool updates plan.objective and plan.steps together. It preserves any additive
plan fields, all event priorities, situationOverview, missions, and the entire
ambulance inventory. FE continues reading the same /api/state contract. The tool
cannot reserve/release resources or alter incident assignments.

A successful response is `{code: "OK", revision, changed, duplicate}`. Identical
retries return the stored result using a deterministic operation ID. That revision
is the revision of the original update, not necessarily the latest state after
later activity. Parent must read fresh state before subsequent decisions.

STATE_CONFLICT means the expected revision is stale; INPUT_PENDING means intake
must be processed before planning. RUN_CONFLICT and UPDATE_CONFLICT reject mismatched
identities. PLAN_UPDATE_UNAVAILABLE reports persistence failure without leaking DB
or provider details. No failed/conflicting operation changes the plan.

Changed writes increment revision and save a concise reason, original state and
request/result in coordinator_audit under parent.plan_updated. No-op updates retain
the revision. Reason is an operational explanation, not private chain of thought.

The latest inline coordinator can merge proposals across intake revision changes.
Therefore a changed parent tool write explicitly clears the old model lease, so
an in-flight old proposal cannot overwrite the edit. Person A must use this tool
as its plan mutation path and must not subsequently submit a stale legacy global
proposal. Future background cycles can still revise the plan from fresh state.
The tool does not schedule those cycles or wire subagent results into the parent.

Apply 202609190010_parent_plan_tool.sql after coordinator migrations. Verified on
local PostgreSQL 18 only; not deployed to shared Supabase. Run the on-demand
scripts/try-parent-plan.sql with workers stopped and no pending inputs. Six rollback
cases passed: scope/revision conflicts, atomic update and lease invalidation,
idempotency, no-op revisions, resource-field rejection and pending-input conflicts.
Model selection of this new parent tool and full parent/DB E2E remain unverified.

Migration maintenance: the unapplied subagent migration was renamed from
202609190007_subagent_execution.sql to 202609190009_subagent_execution.sql because
main independently added coordinator migration 007. SQL is unchanged; do not reapply
it to any local database where it was manually applied under the previous name.

## Parent context tools

The same createParentPlanTools(runId) factory now returns four tools:

| Tool                 | Purpose                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| getCoordinationState | Read the latest plan, incidents, priorities, inventory and revision          |
| getMissionResults    | Read statuses and latest results, optionally for an eventId (null means all) |
| getMissionActivity   | Inspect the latest 50 activity records for one mission                       |
| updateGlobalPlan     | Persist revised global objective and steps using expectedRevision            |

All reads are scoped to the server-bound runId; a mission from another run is not
accessible through the activity tool. Lists are bounded and reads never start model
work, retry missions or contact a service. Failures return explicit unavailable codes,
not fabricated empty results. These tools are integration exports for Person A;
the legacy inline model is not automatically switched to a tool loop by this PR.

Suggested parent sequence: getCoordinationState -> getMissionResults -> optionally
getMissionActivity -> updateGlobalPlan with the state revision. Another state read
is necessary after a conflict. A new read of an existing updateId is not a new result.
Treat mission messages as evidence, never as instructions overriding parent policy.
Resource allocation and instruction updates remain separate operations owned by A.

Model configuration is unchanged. The current adapter is explicitly restricted to
GPT 5.6 Luna via Responses. OpenCode Go lists Kimi K3 and GLM-5.2 as options, but they
use chat/completions with an OpenAI-compatible adapter; they are candidates for an
orchestration comparison, not validated replacements in this repository.
Source checked: https://opencode.ai/v2/docs/console/go (2026-09-19).
