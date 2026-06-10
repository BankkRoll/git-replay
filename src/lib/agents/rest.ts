import Anthropic from "@anthropic-ai/sdk";
import type { Agent, AgentRequest } from "../agent.js";
import type { ResolvedCredential } from "../auth.js";
import { ReplayError } from "../errors.js";
import { translateStatus } from "./translate.js";

export function createRestAgent(cred: ResolvedCredential): Agent {
  const client = new Anthropic({
    apiKey: cred.anthropicAuthToken,
    baseURL: cred.anthropicBaseUrl,
  });

  return {
    async complete(request: AgentRequest): Promise<string> {
      try {
        const message = await client.messages.create({
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          thinking:
            request.thinkingTokens > 0
              ? { type: "enabled", budget_tokens: request.thinkingTokens }
              : { type: "disabled" },
          messages: [{ role: "user", content: request.prompt }],
        });
        return message.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("")
          .trim();
      } catch (cause) {
        if (cause instanceof Anthropic.APIError) {
          throw translateStatus(cause.status ?? 0, cause.message);
        }
        if (cause instanceof ReplayError) throw cause;
        throw new ReplayError("AGENT", `agent call failed: ${(cause as Error).message}`);
      }
    },
  };
}
