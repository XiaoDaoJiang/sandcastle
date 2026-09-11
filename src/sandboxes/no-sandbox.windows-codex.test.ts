import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  noSandbox,
  normalizeCodexCommandForWindows,
} from "./no-sandbox.js";

const itWindows = process.platform === "win32" ? it : it.skip;

describe("normalizeCodexCommandForWindows", () => {
  it("removes POSIX model quoting and preserves TOML string overrides", () => {
    expect(
      normalizeCodexCommandForWindows(
        `codex exec --json --dangerously-bypass-approvals-and-sandbox -m 'gpt-5.3-codex' -c 'model_reasoning_effort="high"'`,
      ),
    ).toBe(
      `codex exec --json --dangerously-bypass-approvals-and-sandbox -m gpt-5.3-codex -c model_reasoning_effort='high'`,
    );
  });

  it("does not touch non-Codex commands", () => {
    const command = `echo 'hello world'`;
    expect(normalizeCodexCommandForWindows(command)).toBe(command);
  });
});

describe("noSandbox Codex execution on Windows", () => {
  itWindows("passes normalized argv through a codex.cmd wrapper", async () => {
    const root = await mkdtemp(join(tmpdir(), "sandcastle-codex-cmd-"));
    const binDir = join(root, "bin");
    await mkdir(binDir);

    const printer = join(binDir, "print-args.cjs");
    await writeFile(
      printer,
      [
        "let stdin = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { stdin += chunk; });",
        "process.stdin.on('end', () => {",
        "  console.log(JSON.stringify({ args: process.argv.slice(2), stdin }));",
        "});",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(binDir, "codex.cmd"),
      `@echo off\r\nnode "${printer}" %*\r\n`,
    );

    const provider = noSandbox();
    const handle = await provider.create({
      worktreePath: root,
      env: {
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
      },
    });

    try {
      const result = await handle.exec(
        `codex exec --json --dangerously-bypass-approvals-and-sandbox -m 'gpt-5.3-codex' -c 'model_reasoning_effort="high"'`,
        { stdin: "Reply OK" },
      );

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        args: [
          "exec",
          "--json",
          "--dangerously-bypass-approvals-and-sandbox",
          "-m",
          "gpt-5.3-codex",
          "-c",
          "model_reasoning_effort='high'",
        ],
        stdin: "Reply OK",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
