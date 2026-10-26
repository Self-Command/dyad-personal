import { describe, expect, it } from "vitest";
import { describeSafetyReviewFailure } from "./safety_review_error";

describe("safe review provider diagnostics", () => {
  it.each([401, 403, 404, 429, 400, 422, 500, 503])("preserves HTTP %s without leaking provider payloads", (statusCode) => {
    const secret = "Bearer very-private-key https://private.example/?token=hidden command-user-data";
    const cause = Object.assign(new Error(secret), { statusCode, responseBody: secret, url: secret });
    const result = describeSafetyReviewFailure(Object.assign(new Error("wrapper"), { cause }));
    expect(result).toContain(`HTTP ${statusCode}`);
    for (const value of [secret, "very-private-key", "private.example", "command-user-data"]) expect(result).not.toContain(value);
  });
  it("searches bounded retry errors and tolerates cyclic errors", () => {
    const error: { errors?: unknown[]; cause?: unknown } = {};
    error.cause = error;
    error.errors = [Object.assign(new Error("hidden"), { statusCode: 429 })];
    expect(describeSafetyReviewFailure(error)).toContain("HTTP 429");
  });
  it("classifies transport and protocol errors without echoing messages", () => {
    expect(describeSafetyReviewFailure(new Error("fetch failed to https://secret.example"))).toContain("network");
    expect(describeSafetyReviewFailure({ name: "AI_TypeValidationError", message: "sensitive response" })).toContain("incompatible");
  });
});
