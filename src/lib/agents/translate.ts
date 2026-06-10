import { AuthError, QuotaError, ReplayError } from "../errors.js";

export function translateStatus(status: number, message: string): ReplayError {
  if (status === 401 || status === 403) {
    return new AuthError(
      `upstream rejected the credential (${status})`,
      'the gateway key or OIDC token may be expired — re-pull with "npx vercel env pull"',
    );
  }
  if (status === 402 || status === 429) {
    return new QuotaError(
      `upstream is out of quota or rate limited (${status})`,
      "top up credits then re-run the same command — replay resumes from the last checkpoint",
    );
  }
  return new ReplayError("AGENT", `upstream error ${status}: ${message}`);
}

export function translateMessage(raw: string): ReplayError {
  const safe = String(raw ?? "");
  const text = safe.toLowerCase();
  if (text.includes("max_turns") || text.includes("max turns")) {
    return new ReplayError(
      "AGENT",
      "the agent stopped before producing an answer (max turns reached)",
      "this usually means the prompt nudged the agent toward tool use — re-run, or switch to a gateway/API key",
    );
  }
  if (text.includes("401") || text.includes("unauthorized") || text.includes("not logged in")) {
    return new AuthError(
      "the local agent session is missing or expired",
      'run "claude login" / "codex login", or set AI_GATEWAY_API_KEY',
    );
  }
  if (text.includes("429") || text.includes("quota") || text.includes("rate limit") || text.includes("usage limit")) {
    return new QuotaError(
      "the subscription hit its usage limit",
      "subscriptions lack capacity for sustained runs — set AI_GATEWAY_API_KEY and re-run to resume",
    );
  }
  return new ReplayError("AGENT", `agent call failed: ${safe}`);
}
