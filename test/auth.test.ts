import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCredential, applyCredential } from "../src/lib/auth.js";

const NO_SUB = { allowSubscription: false };

async function withRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "replay-auth-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("resolveCredential precedence", () => {
  it("prefers an explicit Anthropic key over a gateway key", async () => {
    await withRoot(async (root) => {
      const cred = await resolveCredential(
        "claude",
        root,
        {
          ANTHROPIC_AUTH_TOKEN: "sk-ant-explicit",
          ANTHROPIC_BASE_URL: "https://api.anthropic.com",
          AI_GATEWAY_API_KEY: "vck_gateway",
        },
        NO_SUB,
      );
      expect(cred.source).toBe("explicit-anthropic");
      expect(cred.anthropicAuthToken).toBe("sk-ant-explicit");
      expect(cred.anthropicBaseUrl).toBe("https://api.anthropic.com");
    });
  });

  it("expands a single gateway key into all four SDK vars", async () => {
    await withRoot(async (root) => {
      const cred = await resolveCredential("claude", root, { AI_GATEWAY_API_KEY: "vck_gateway" }, NO_SUB);
      expect(cred.source).toBe("gateway-key");
      const env = applyCredential(cred, {});
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe("vck_gateway");
      expect(env.OPENAI_API_KEY).toBe("vck_gateway");
      expect(env.ANTHROPIC_BASE_URL).toContain("ai-gateway");
      expect(env.OPENAI_BASE_URL).toContain("ai-gateway");
    });
  });

  it("falls back to OIDC when only a token is present", async () => {
    await withRoot(async (root) => {
      const cred = await resolveCredential("claude", root, { VERCEL_OIDC_TOKEN: "oidc-token" }, NO_SUB);
      expect(cred.source).toBe("gateway-oidc");
    });
  });

  it("reads credentials from .env.local in the repo root", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, ".env.local"), 'AI_GATEWAY_API_KEY="vck_from_file"\n', "utf8");
      const cred = await resolveCredential("claude", root, {}, NO_SUB);
      expect(cred.source).toBe("gateway-key");
      expect(cred.anthropicAuthToken).toBe("vck_from_file");
    });
  });

  it("lets process env override .env.local", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, ".env.local"), "AI_GATEWAY_API_KEY=from_file\n", "utf8");
      const cred = await resolveCredential("claude", root, { AI_GATEWAY_API_KEY: "from_env" }, NO_SUB);
      expect(cred.anthropicAuthToken).toBe("from_env");
    });
  });

  it("parses .env.local with a BOM, export prefix, and CRLF line endings", async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, ".env.local"), "﻿export AI_GATEWAY_API_KEY=bommed\r\n", "utf8");
      const cred = await resolveCredential("claude", root, {}, NO_SUB);
      expect(cred.source).toBe("gateway-key");
      expect(cred.anthropicAuthToken).toBe("bommed");
    });
  });

  it("throws a helpful error when no credential exists", async () => {
    await withRoot(async (root) => {
      await expect(resolveCredential("claude", root, {}, NO_SUB)).rejects.toThrow(/no usable credential/);
    });
  });

  it("marks gateway and explicit credentials as non-delegated", async () => {
    await withRoot(async (root) => {
      const cred = await resolveCredential("claude", root, { AI_GATEWAY_API_KEY: "vck" }, NO_SUB);
      expect(cred.delegated).toBe(false);
    });
  });

  it("does not inject env for delegated (subscription) credentials", () => {
    const env = applyCredential(
      {
        source: "subscription-claude",
        backend: "claude",
        delegated: true,
        anthropicAuthToken: "",
        anthropicBaseUrl: "",
        openaiApiKey: "",
        openaiBaseUrl: "",
      },
      { PATH: "/usr/bin" },
    );
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });
});
