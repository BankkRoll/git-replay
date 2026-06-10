import { Codex } from "@openai/codex-sdk";
import type { Agent, AgentRequest } from "../agent.js";
import type { ResolvedCredential } from "../auth.js";
import { ReplayError } from "../errors.js";
import { translateMessage } from "./translate.js";

export function createCodexAgent(cred: ResolvedCredential): Agent {
  const codex =
    cred.source === "subscription-codex"
      ? new Codex()
      : new Codex({ apiKey: cred.openaiApiKey, baseUrl: cred.openaiBaseUrl });

  return {
    async complete(request: AgentRequest): Promise<string> {
      try {
        const thread = codex.startThread({
          model: request.model,
          sandboxMode: "read-only",
          skipGitRepoCheck: true,
          approvalPolicy: "never",
          networkAccessEnabled: false,
        });
        const turn = await thread.run(`${request.system}\n\n${request.prompt}`);
        const text = (turn.finalResponse ?? "").trim();
        if (!text) {
          throw new ReplayError("AGENT", "codex agent returned an empty result");
        }
        return text;
      } catch (cause) {
        if (cause instanceof ReplayError) throw cause;
        throw translateMessage(cause instanceof Error ? cause.message : String(cause));
      }
    },
  };
}
