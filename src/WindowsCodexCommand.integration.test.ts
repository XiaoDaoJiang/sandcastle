import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { codex } from "./AgentProvider.js";
import { noSandbox } from "./sandboxes/no-sandbox.js";

const itWindows = process.platform === "win32" ? it : it.skip;

describe("Windows Codex command integration", () => {
  itWindows(
    "passes the model argv and stdin to codex.cmd without POSIX single quotes",
    async () => {
      const fakeBin = await mkdtemp(join(tmpdir(), "sandcastle-codex-win-"));
      const fakeCodex = join(fakeBin, "codex.cmd");

      await writeFile(
        fakeCodex,
        [
          "@echo off",
          ":args",
          "if \"%~1\"==\"\" goto stdin",
          "echo ARG=%1",
          "shift",
          "goto args",
          ":stdin",
          "set /p PROMPT=",
          "echo STDIN=%PROMPT%",
          "exit /b 0",
          "",
        ].join("\r\n"),
      );

      const model = "test-model";
      const provider = codex(model);
      const print = provider.buildPrintCommand({
        prompt: "ping",
        dangerouslySkipPermissions: true,
      });

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
        expect(result.exitCode).toBe(0);

        const args = result.stdout
          .split(/\r?\n/)
          .filter((line) => line.startsWith("ARG="))
          .map((line) => line.slice("ARG=".length));

        const modelFlagIndex = args.indexOf("-m");
        expect(modelFlagIndex).toBeGreaterThanOrEqual(0);
        expect(args[modelFlagIndex + 1]).toBe(model);
        expect(result.stdout).not.toContain("'test-model'");
        expect(result.stdout).toContain("STDIN=ping");
      } finally {
        await handle.close();
        await rm(fakeBin, { recursive: true, force: true });
      }
    },
  );
});
