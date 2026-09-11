import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PassThrough, Readable } from "node:stream";
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
  const createFakeCodex = async () => {
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

    return { root, handle };
  };

  itWindows("passes normalized argv through a codex.cmd wrapper", async () => {
    const { root, handle } = await createFakeCodex();

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

  itWindows(
    "preserves an interactive prompt containing spaces and newlines as one argv value",
    async () => {
      const { root, handle } = await createFakeCodex();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let stdoutText = "";
      let stderrText = "";
      stdout.on("data", (chunk) => {
        stdoutText += chunk.toString();
      });
      stderr.on("data", (chunk) => {
        stderrText += chunk.toString();
      });

      const prompt = "Context line one\nline two with spaces & <tag>";

      try {
        const result = await handle.interactiveExec(
          ["codex", "--model", "gpt-5.6-sol", prompt],
          {
            stdin: Readable.from([]),
            stdout,
            stderr,
            cwd: root,
          },
        );

        expect(result.exitCode, stderrText).toBe(0);
        const printed = JSON.parse(stdoutText.trim());
        expect(printed.args).toEqual([
          "--model",
          "gpt-5.6-sol",
          prompt,
        ]);
      } finally {
        await handle.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
