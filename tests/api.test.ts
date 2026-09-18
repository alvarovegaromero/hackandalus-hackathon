import { beforeEach, describe, expect, it } from "vitest";
import { POST as approvePost } from "@/app/api/actions/[id]/approve/route";
import { POST as statusPost } from "@/app/api/actions/[id]/status/route";
import { POST as eventPost } from "@/app/api/events/route";
import { GET as situationGet } from "@/app/api/situation/route";
import { getSituation, resetSituation } from "@/lib/store";

beforeEach(() => {
  process.env.ACTION_EXECUTION_MODE = "mock";
  process.env.HAPPYROBOT_WEBHOOK_SECRET = "";
  resetSituation();
});

describe("crisis API routes", () => {
  it("creates an event and updates the situation", async () => {
    const response = await eventPost(
      new Request("http://localhost/api/events", {
        method: "POST",
        body: JSON.stringify({
          zoneId: "zone-south",
          category: "shelter-overflow",
          severity: "critical",
          confidence: "high"
        })
      })
    );

    expect(response.status).toBe(201);
    const situationResponse = await situationGet();
    const situation = await situationResponse.json();
    expect(situation.events[0].category).toBe("shelter-overflow");
    expect(situation.plan.priorities[0].zoneId).toBe("zone-south");
  });

  it("approves an action through the mock HappyRobot adapter", async () => {
    const action = getSituation().actions[0];
    const response = await approvePost(new Request("http://localhost"), { params: { id: action.id } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action.status).toBe("succeeded");
    expect(body.action.externalActionId).toContain("mock-");
  });

  it("surfaces HappyRobot execution failures", async () => {
    process.env.ACTION_EXECUTION_MODE = "happyrobot";
    delete process.env.HAPPYROBOT_API_KEY;
    delete process.env.HAPPYROBOT_AGENT_ID;

    const action = getSituation().actions[0];
    const response = await approvePost(new Request("http://localhost"), { params: { id: action.id } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action.status).toBe("failed");
    expect(body.action.error).toContain("HappyRobot credentials are missing");
  });

  it("accepts webhook-style status callbacks", async () => {
    const action = getSituation().actions[0];
    const response = await statusPost(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ status: "in_progress", externalActionId: "hr-123", localActionId: action.id })
      }),
      { params: { id: action.id } }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action.status).toBe("running");
    expect(body.action.externalActionId).toBe("hr-123");
  });
});
