export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  let command: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq !== -1) {
        flags.set(token.slice(2, eq), token.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags.set(token.slice(2), next);
          i += 1;
        } else {
          flags.set(token.slice(2), true);
        }
      }
    } else if (command === undefined) {
      command = token;
    } else {
      positionals.push(token);
    }
  }

  return { command, positionals, flags };
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

export function flagBool(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true || args.flags.get(name) === "true";
}

export function flagNumber(args: ParsedArgs, name: string): number | undefined {
  const value = flagString(args, name);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
