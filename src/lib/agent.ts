import { z } from "zod";
import { extractJson } from "./json.js";
import { ReplayError } from "./errors.js";
import type { ResolvedCredential } from "./auth.js";
import { createRestAgent } from "./agents/rest.js";
import { createClaudeAgent } from "./agents/claude.js";
import { createCodexAgent } from "./agents/codex.js";

export interface AgentRequest {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  thinkingTokens: number;
}

export interface Agent {
  complete(request: AgentRequest): Promise<string>;
}

export function parseAgentJson<T>(text: string, schema: z.ZodType<T>): T {
  const parsed = extractJson(text);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new ReplayError("AGENT_SCHEMA", `agent returned malformed output: ${detail}`);
  }
  return result.data;
}

export async function agentJson<T>(
  agent: Agent,
  request: AgentRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  return parseAgentJson(await agent.complete(request), schema);
}

export function createAgent(cred: ResolvedCredential): Agent {
  switch (cred.source) {
    case "subscription-claude":
      return createClaudeAgent(cred);
    case "subscription-codex":
      return createCodexAgent(cred);
    default:
      return cred.backend === "codex" ? createCodexAgent(cred) : createRestAgent(cred);
  }
}
