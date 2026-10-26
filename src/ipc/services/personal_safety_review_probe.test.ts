import { beforeEach, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";
const mocks = vi.hoisted(() => ({ review: vi.fn() }));
vi.mock("@/pro/main/ipc/handlers/local_agent/tool_safety_reviewer", () => ({ reviewToolAction: mocks.review }));
import { probePersonalSafetyReview } from "./personal_safety_review_probe";
beforeEach(() => mocks.review.mockReset());
it("tests the configured production reviewer with only an inert inspection tool", async () => {
  mocks.review.mockImplementation(async ({ prepare, timeoutMs }) => {
    expect(timeoutMs).toBe(90_000);
    const { tools } = await prepare();
    expect(Object.keys(tools)).toEqual(["inspect_app_path"]);
    expect(await tools.inspect_app_path.execute({ path: "any" })).toEqual({ type: "directory", probe: true });
    return { decision: "allow", reason: "probe" };
  });
  const result = await probePersonalSafetyReview({ enablePersonalMode: true, personalSafetyReviewTimeoutSeconds: 90 } as UserSettings);
  expect(result.available).toBe(true);
  expect(result.reason).toContain("未执行 Shell");
});
it("returns the classified provider failure and rejects official mode", async () => {
  mocks.review.mockResolvedValue({ decision: "block", unavailable: true, reason: "HTTP 401" });
  expect(await probePersonalSafetyReview({ enablePersonalMode: true } as UserSettings)).toEqual({ available: false, reason: "HTTP 401" });
  await expect(probePersonalSafetyReview({ enablePersonalMode: false } as UserSettings)).rejects.toThrow("Enable Personal mode");
});
