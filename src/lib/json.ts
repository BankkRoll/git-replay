import { ReplayError } from "./errors.js";

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();

  const direct = tryParse(candidate);
  if (direct.ok) return direct.value;

  for (const span of balancedSpans(candidate)) {
    const parsed = tryParse(span);
    if (parsed.ok) return parsed.value;
  }
  throw new ReplayError("AGENT_SCHEMA", "agent response contained no parseable JSON value");
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (cause) {
    return { ok: false, error: (cause as Error).message };
  }
}

function* balancedSpans(text: string): Generator<string> {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{" || ch === "[") {
      const end = matchBalanced(text, i, ch);
      if (end !== -1) yield text.slice(i, end + 1);
    }
  }
}

function matchBalanced(text: string, start: number, open: "{" | "["): number {
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
