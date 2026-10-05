import { expect, test } from "vitest";
import { parseCommand } from "./command";

test("parses the quoted host command from issue #20", () => {
  expect(parseCommand('npm run dev -- --host "0.0.0.0"')).toEqual([
    "npm",
    "run",
    "dev",
    "--",
    "--host",
    "0.0.0.0",
  ]);
});
test("preserves quoted spaces, empty arguments, and escaped characters", () => {
  expect(
    parseCommand(`  npm\tinstall 'some package' "" escaped\\ space  `),
  ).toEqual(["npm", "install", "some package", "", "escaped space"]);
});
test("rejects empty commands and shell operators instead of passing invalid argv", () => {
  expect(() => parseCommand("  ")).toThrow();
  expect(() => parseCommand("npm install && npm run dev")).toThrow();
});
