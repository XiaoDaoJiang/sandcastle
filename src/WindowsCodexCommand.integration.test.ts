import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { codex } from "./AgentProvider.js";
import type { PrintCommand } from "./AgentProvider.js";
import { noSandbox } from "./sandboxes/no-sandbox.js";

const itWindows = process.platform === "win32" ? it : it.skip;

const runThroughFakeCodexCmd = async (
  print: PrintCommand,
): Promise<{ args: string[]; stdout: string; stderr: string; exitCode: number }> => {
  const fakeBin = await mkdtemp(join(tmpdir(), "sandcastle-codex-win-"));
  const fakeCodex = join(fakeBin, "codex.cmd");

  await writeFile(
    fakeCodex,
    [
      "@echo off",
      ":args",
      "if \"%~1\"==\"\" goto stdin",
      // %~1 is the parsed argument value with cmd's syntactic outer quotes removed.
      "echo ARG=%~1",
      "shift",
      "goto args",
      ":stdin",
      "set /p PROMPT=",
      "echo STDIN=%PROMPT%",
      "exit /b 0",
      "",
    ].join("\r\n"),
  );

  const handle = await noSandbox().create({
    worktreePath: process.cwd(),
    env: {
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
    },
  });

  try {
    const result = await handle.exec(print.command, {
      stdin: print.stdin,
      argv: print.argv,
    });
    const args = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("ARG="))
      .map((line) => line.slice("ARG=".length));

    return { ...result, args };
  } finally {
    await handle.close();
    await rm(fakeBin, { recursive: true, force: true });
  }
};

describe("Windows Codex command integration", () => {
  itWindows(
    "passes model argv and stdin through a .cmd wrapper without POSIX quotes",
    async () => {
      const print = codex("test-model").buildPrintCommand({
        prompt: "ping",
        dangerouslySkipPermissions: true,
      });

      const result = await runThroughFakeCodexCmd(print);

      expect(result.exitCode).toBe(0);
      expect(result.args).toEqual([
        "exec",
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "-m",
        "test-model",
      ]);
      expect(result.stdout).not.toContain("'test-model'");
      expect(result.stdout).toContain("STDIN=ping");
    },
  );

  itWindows(
    "passes Codex effort config as one literal argv through a .cmd wrapper",
    async () => {
      const print = codex("test-model", { effort: "high" }).buildPrintCommand({
        prompt: "ping",
        dangerouslySkipPermissions: true,
      });

      const result = await runThroughFakeCodexCmd(print);

      expect(result.exitCode).toBe(0);
      expect(result.args).toContain("model_reasoning_effort=high");
      expect(result.stdout).toContain("STDIN=ping");
    },
  );

  itWindows(
    "passes auto-review config as one literal argv through a .cmd wrapper",
    async () => {
      const print = codex("test-model", {
        approvalsReviewer: "auto_review",
      }).buildPrintCommand({
        prompt: "ping",
        dangerouslySkipPermissions: true,
      });

      const result = await runThroughFakeCodexCmd(print);

      expect(result.exitCode).toBe(0);
      expect(result.args).toContain("approvals_reviewer=auto_review");
      expect(result.stdout).toContain("STDIN=ping");
    },
  );
});
