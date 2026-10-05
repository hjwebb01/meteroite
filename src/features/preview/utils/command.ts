import { parse } from "shell-quote";

export function parseCommand(command: string): [string, ...string[]] {
  // Preserve literal environment references; spawn receives argv, not a shell.
  const args = parse(command, (name) => `$${name}`);
  if (!args.length || args.some((arg) => typeof arg !== "string") || !args[0]) {
    throw new Error(
      "Preview commands must contain an executable and arguments, without shell operators",
    );
  }
  return args as [string, ...string[]];
}
