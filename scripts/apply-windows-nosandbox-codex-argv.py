from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f"Expected patch anchor not found in {path}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all_expected(path: str, old: str, new: str, expected: int) -> None:
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    if new in text and old not in text:
        return
    count = text.count(old)
    if count != expected:
        raise RuntimeError(
            f"Expected {expected} patch anchors in {path}, found {count}: {old[:80]!r}"
        )
    p.write_text(text.replace(old, new), encoding="utf-8")


replace_once(
    "src/AgentProvider.ts",
    '''export interface PrintCommand {\n  readonly command: string;\n  readonly stdin?: string;\n}\n''',
    '''export interface PrintCommand {\n  readonly command: string;\n  readonly stdin?: string;\n  /**\n   * Optional structured argv for host-native execution. Sandboxed providers\n   * continue to use `command`; native Windows no-sandbox execution can use\n   * argv to avoid applying POSIX shell quoting to cmd.exe.\n   */\n  readonly argv?: readonly string[];\n}\n''',
)

replace_once(
    "src/AgentProvider.ts",
    '''    const stdinArg = resumeSession ? " -" : "";\n    return {\n      command: `${base} --json${approvalsFlags} -m ${shellEscape(model)}${effortFlag}${stdinArg}`,\n      stdin: prompt,\n    };\n''',
    '''    const stdinArg = resumeSession ? " -" : "";\n\n    // Keep the existing shell command unchanged for Docker/Podman/Unix\n    // sandboxes. The structured argv is consumed only by native no-sandbox\n    // execution, where cmd.exe does not understand POSIX single-quote escaping.\n    const argv: string[] = ["codex", "exec"];\n    if (resumeSession && forkSession) {\n      argv.push("fork", resumeSession);\n    } else if (resumeSession) {\n      argv.push("resume", resumeSession);\n    }\n    argv.push("--json");\n    if (options?.approvalsReviewer === "auto_review") {\n      argv.push(\n        "-a",\n        "on-request",\n        "-s",\n        "danger-full-access",\n        "-c",\n        'approvals_reviewer="auto_review"',\n      );\n    } else {\n      argv.push("--dangerously-bypass-approvals-and-sandbox");\n    }\n    argv.push("-m", model);\n    if (options?.effort) {\n      argv.push("-c", `model_reasoning_effort="${options.effort}"`);\n    }\n    if (resumeSession) {\n      argv.push("-");\n    }\n\n    return {\n      command: `${base} --json${approvalsFlags} -m ${shellEscape(model)}${effortFlag}${stdinArg}`,\n      stdin: prompt,\n      argv,\n    };\n''',
)

# All sandbox handle exec contracts accept the hint, but only noSandbox uses it.
replace_all_expected(
    "src/SandboxProvider.ts",
    '''      stdin?: string;\n    },\n''',
    '''      stdin?: string;\n      /** Optional structured argv hint for host-native execution. */\n      argv?: readonly string[];\n    },\n''',
    3,
)

replace_once(
    "src/SandboxFactory.ts",
    '''      stdin?: string;\n    },\n  ) => Effect.Effect<ExecResult, ExecError>;\n''',
    '''      stdin?: string;\n      /** Optional structured argv hint for host-native execution. */\n      argv?: readonly string[];\n    },\n  ) => Effect.Effect<ExecResult, ExecError>;\n''',
)

replace_once(
    "src/Orchestrator.ts",
    '''        cwd: sandboxRepoDir,\n        stdin: printCmd.stdin,\n      });\n''',
    '''        cwd: sandboxRepoDir,\n        stdin: printCmd.stdin,\n        argv: printCmd.argv,\n      });\n''',
)

replace_once(
    "src/sandboxes/no-sandbox.ts",
    '''          stdin?: string;\n        },\n''',
    '''          stdin?: string;\n          /** Structured argv supplied by an agent provider when available. */\n          argv?: readonly string[];\n        },\n''',
)

replace_once(
    "src/sandboxes/no-sandbox.ts",
    '''          const proc = spawn(shellCmd, shellArgs, {\n            cwd,\n            env: processEnv,\n            stdio: [\n              opts?.stdin !== undefined ? "pipe" : "ignore",\n              "pipe",\n              "pipe",\n            ],\n            windowsVerbatimArguments: isWindows,\n          });\n''',
    '''          const stdio: StdioOptions = [\n            opts?.stdin !== undefined ? "pipe" : "ignore",\n            "pipe",\n            "pipe",\n          ];\n          const structuredArgv = isWindows ? opts?.argv : undefined;\n          const proc = structuredArgv?.length\n            ? spawn(structuredArgv[0]!, [...structuredArgv.slice(1)], {\n                cwd,\n                env: processEnv,\n                stdio,\n                // Agent CLIs installed by npm are commonly .cmd wrappers.\n                // Let cmd.exe resolve PATHEXT, while Node serializes the\n                // already-structured args instead of reusing POSIX quoting.\n                shell: true,\n              })\n            : spawn(shellCmd, shellArgs, {\n                cwd,\n                env: processEnv,\n                stdio,\n                windowsVerbatimArguments: isWindows,\n              });\n''',
)

(ROOT / "src/CodexArgv.test.ts").write_text(
    '''import { describe, expect, it } from "vitest";\nimport { codex } from "./AgentProvider.js";\n\nconst commandOptions = {\n  prompt: "ping",\n  dangerouslySkipPermissions: true,\n} as const;\n\ndescribe("codex structured argv", () => {\n  it("builds default argv without shell quoting", () => {\n    const print = codex("test-model").buildPrintCommand(commandOptions);\n    expect(print.argv).toEqual([\n      "codex",\n      "exec",\n      "--json",\n      "--dangerously-bypass-approvals-and-sandbox",\n      "-m",\n      "test-model",\n    ]);\n    // Existing shell command stays intact for sandbox/Unix providers.\n    expect(print.command).toContain("-m 'test-model'");\n  });\n\n  it("adds effort as one exact config argv value", () => {\n    const print = codex("test-model", { effort: "high" }).buildPrintCommand(\n      commandOptions,\n    );\n    expect(print.argv).toContain('model_reasoning_effort="high"');\n  });\n\n  it("builds resume argv and stdin marker", () => {\n    const print = codex("test-model").buildPrintCommand({\n      ...commandOptions,\n      resumeSession: "session-123",\n    });\n    expect(print.argv).toEqual([\n      "codex",\n      "exec",\n      "resume",\n      "session-123",\n      "--json",\n      "--dangerously-bypass-approvals-and-sandbox",\n      "-m",\n      "test-model",\n      "-",\n    ]);\n  });\n\n  it("builds fork argv without quoting the session id", () => {\n    const print = codex("test-model").buildPrintCommand({\n      ...commandOptions,\n      resumeSession: "session-123",\n      forkSession: true,\n    });\n    expect(print.argv?.slice(0, 5)).toEqual([\n      "codex",\n      "exec",\n      "fork",\n      "session-123",\n      "--json",\n    ]);\n  });\n\n  it("builds auto-review flags as structured values", () => {\n    const print = codex("test-model", {\n      approvalsReviewer: "auto_review",\n    }).buildPrintCommand(commandOptions);\n    expect(print.argv).toEqual([\n      "codex",\n      "exec",\n      "--json",\n      "-a",\n      "on-request",\n      "-s",\n      "danger-full-access",\n      "-c",\n      'approvals_reviewer="auto_review"',\n      "-m",\n      "test-model",\n    ]);\n  });\n});\n''',
    encoding="utf-8",
)

changeset = ROOT / ".changeset/fix-windows-nosandbox-codex-argv.md"
changeset.write_text(
    '''---\n"@ai-hero/sandcastle": patch\n---\n\nFix Codex argument quoting on native Windows no-sandbox runs by passing structured argv while preserving the existing shell command path for Unix and sandbox providers.\n''',
    encoding="utf-8",
)

print("Applied Windows noSandbox Codex argv patch")
