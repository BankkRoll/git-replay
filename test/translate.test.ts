import { describe, it, expect } from "vitest";
import { translateStatus, translateMessage } from "../src/lib/agents/translate.js";
import { AuthError, QuotaError } from "../src/lib/errors.js";

describe("translateStatus", () => {
  it("maps 401/403 to an auth error", () => {
    expect(translateStatus(401, "x")).toBeInstanceOf(AuthError);
    expect(translateStatus(403, "x")).toBeInstanceOf(AuthError);
  });

  it("maps 402/429 to a quota error", () => {
    expect(translateStatus(402, "x")).toBeInstanceOf(QuotaError);
    expect(translateStatus(429, "x")).toBeInstanceOf(QuotaError);
  });

  it("passes other statuses through as generic agent errors", () => {
    const err = translateStatus(500, "boom");
    expect(err.code).toBe("AGENT");
    expect(err.message).toContain("500");
  });
});

describe("translateMessage", () => {
  it("recognizes a missing login session as an auth error", () => {
    expect(translateMessage("Error: not logged in")).toBeInstanceOf(AuthError);
    expect(translateMessage("401 unauthorized")).toBeInstanceOf(AuthError);
  });

  it("recognizes usage limits as a quota error", () => {
    expect(translateMessage("usage limit reached")).toBeInstanceOf(QuotaError);
    expect(translateMessage("429 rate limit")).toBeInstanceOf(QuotaError);
  });

  it("falls back to a generic agent error", () => {
    expect(translateMessage("something odd").code).toBe("AGENT");
  });
});
