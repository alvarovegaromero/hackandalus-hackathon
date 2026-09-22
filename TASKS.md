# Project status

FARO is a functional hackathon prototype with a Vercel-hosted dashboard.
This file tracks the current implementation and remaining work; the detailed
development chronology is available in Git.

## Implemented

- [x] Public landing, operations dashboard and isolated wildfire drills.
- [x] Persistent coordinator state, report intake, Jev filtering and impact assessment.
- [x] Global planning with finite ambulance, Policía and Guardia Civil inventories.
- [x] Next.js background processing after intake, with concurrent filtering and batched planning.
- [x] Mission creation, revision, cancellation and parent replanning from results.
- [x] Dashboard state/mission polling, report/filter telemetry and map integration.
- [x] HappyRobot inbound reports and durable Resource Dispatch callbacks.
- [x] Dispatch idempotency, outcome evidence and unavailable-resource handling.
- [x] Local wildfire rehearsals, reviewed lessons and offline evaluation.
- [x] Vercel delivery through the production branch and a configured public demo window.
- [x] Remove unused prototype helpers and superseded architecture/porting drafts;
      simplify the reviewer-facing README and documentation index.

See [architecture](docs/architecture.md) and
[Resource Dispatch](docs/resource-dispatch.md) for the implemented boundaries.

## Verification and operational follow-up

Deployment and live-provider checks depend on the configured environment.
The dated evidence in [deployment](docs/vercel-deployment.md) and
[dispatch setup](docs/resource-dispatch.md) remains the reference; code presence
alone is not proof that a fresh remote interaction succeeded.

- [ ] Record a fresh report → plan → mission → callback run on the hosted environment.
- [ ] Confirm migration 016, approved contacts and callback configuration against
      the environment used for the next live demonstration.
- [ ] Add durable scheduling/recovery for interrupted coordinator and mission work.
- [ ] Add explicit operational resource release/reactivation and outcome reconciliation.
- [ ] Reconcile the HappyRobot signal receipt and coordinator bridge on partial failure.
- [ ] Add individual operator authentication and roles beyond demo access.

## Outside the current prototype

- Public free-text reporting form and remaining channel adapters.
- General resource reassignment, coverage optimization and graduated autonomy.
- Full plan editing and multi-incident orchestration.
- Production use of reviewed drill lessons; the offline candidate is not approved
  for promotion and regresses on reserved earthquake cases.
- Live-state digital-twin alternatives and comparison before acting.
- Consolidation of compatibility scenario/action state still used by active routes.

The initial [POC scope](docs/poc.md) and [module contracts](docs/poc-contracts.md)
remain implementation background. Current contracts and migrations govern the
integrated behavior.
