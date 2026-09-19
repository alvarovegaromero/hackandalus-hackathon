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
