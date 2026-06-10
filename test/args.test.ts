import { describe, it, expect } from "vitest";
import { parseArgs, flagString, flagBool, flagNumber } from "../src/cli/args.js";

describe("parseArgs", () => {
  it("separates command, positionals, and flags", () => {
    const args = parseArgs(["run", "the bug", "--root", "/repo", "--verbose"]);
    expect(args.command).toBe("run");
    expect(args.positionals).toEqual(["the bug"]);
    expect(flagString(args, "root")).toBe("/repo");
    expect(flagBool(args, "verbose")).toBe(true);
  });

  it("supports --flag=value form", () => {
    const args = parseArgs(["fix", "bug", "--candidates=5"]);
    expect(flagNumber(args, "candidates")).toBe(5);
  });

  it("treats a trailing --flag as boolean true", () => {
    const args = parseArgs(["init", "--force"]);
    expect(flagBool(args, "force")).toBe(true);
  });

  it("returns undefined for absent flags", () => {
    const args = parseArgs(["run", "bug"]);
    expect(flagString(args, "good")).toBeUndefined();
    expect(flagNumber(args, "candidates")).toBeUndefined();
    expect(flagBool(args, "verbose")).toBe(false);
  });

  it("ignores non-numeric values for flagNumber", () => {
    const args = parseArgs(["fix", "bug", "--candidates", "abc"]);
    expect(flagNumber(args, "candidates")).toBeUndefined();
  });
});
