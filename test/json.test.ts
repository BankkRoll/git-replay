import { describe, it, expect } from "vitest";
import { extractJson } from "../src/lib/json.js";

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses JSON inside a fenced code block", () => {
    const text = 'Here you go:\n```json\n{"file":"x.ts","line":3}\n```\nthanks';
    expect(extractJson(text)).toEqual({ file: "x.ts", line: 3 });
  });

  it("parses JSON surrounded by prose", () => {
    expect(extractJson('The fix is {"patch":"diff"} as shown.')).toEqual({ patch: "diff" });
  });

  it("parses a top-level JSON array", () => {
    expect(extractJson("results: [1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("ignores a stray closing brace in trailing prose", () => {
    expect(extractJson('{"a":1} and then } extra')).toEqual({ a: 1 });
  });

  it("handles braces inside string values", () => {
    expect(extractJson('{"patch":"a { b } c"}')).toEqual({ patch: "a { b } c" });
  });

  it("throws when there is no JSON value", () => {
    expect(() => extractJson("no json here")).toThrow(/no parseable JSON/);
  });

  it("throws on malformed JSON", () => {
    expect(() => extractJson('{"a": }')).toThrow(/no parseable JSON/);
  });

  it("recovers valid JSON that follows a balanced brace in prose", () => {
    expect(extractJson('Plan {do the thing} then: {"file":"x.ts"}')).toEqual({ file: "x.ts" });
  });
});
