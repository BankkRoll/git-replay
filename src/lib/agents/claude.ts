import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Agent, AgentRequest } from "../agent.js";
import type { ResolvedCredential } from "../auth.js";
import { ReplayError } from "../errors.js";
import { translateMessage } from "./translate.js";

export function createClaudeAgent(_cred: ResolvedCredential): Agent {
  return {
    async complete(request: AgentRequest): Promise<string> {
      try {
        let result = "";
        for await (const message of query({
          prompt: request.prompt,
          options: {
            model: request.model,
            systemPrompt: request.system,
            allowedTools: [],
            disallowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
            permissionMode: "default",
            maxTurns: 4,
            thinking:
              request.thinkingTokens > 0
                ? { type: "enabled", budgetTokens: request.thinkingTokens }
                : { type: "disabled" },
          },
        })) {
          if (message.type === "result") {
            if (message.subtype !== "success") {
              throw translateMessage(message.subtype);
            }
            result = message.result ?? "";
          }
        }
        if (!result.trim()) {
          throw new ReplayError("AGENT", "claude agent returned an empty result");
        }
        return result.trim();
      } catch (cause) {
        if (cause instanceof ReplayError) throw cause;
        throw translateMessage(cause instanceof Error ? cause.message : String(cause));
      }
    },
  };
}
