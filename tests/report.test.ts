import { describe, expect, it } from "vitest";
import { reportLocationSchema } from "@/lib/report";

describe("reportLocationSchema", () => {
  it("accepts coordinates, a description or both, defaulting reference to unknown", () => {
    expect(reportLocationSchema.parse({ latitude: 0, longitude: 0 }).reference).toBe("unknown");
    expect(reportLocationSchema.parse({ description: "A-397", reference: "incident" })).toEqual({
      description: "A-397",
      reference: "incident",
    });
  });

  it("rejects half a coordinate pair, an empty location and unknown fields", () => {
    expect(reportLocationSchema.safeParse({ latitude: 36.5 }).success).toBe(false);
    expect(reportLocationSchema.safeParse({ reference: "reporter" }).success).toBe(false);
    expect(reportLocationSchema.safeParse({ description: "x", lat: 1 }).success).toBe(false);
    expect(reportLocationSchema.safeParse({ latitude: "36.5", longitude: -5 }).success).toBe(false);
  });
});
