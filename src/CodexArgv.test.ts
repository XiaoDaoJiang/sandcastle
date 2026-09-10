import { describe, expect, it } from "vitest";
import { codex } from "./AgentProvider.js";

const commandOptions = {
  prompt: "ping",
  dangerouslySkipPermissions: true,
} as const;

describe("codex structured argv", () => {
  it("builds default argv without shell quoting", () => {
    const print = codex("test-model").buildPrintCommand(commandOptions);
    expect(print.argv).toEqual([
      "codex",
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-m",
      "test-model",
    ]);
    // Existing shell command stays intact for sandbox/Unix providers.
    expect(print.command).toContain("-m 'test-model'");
  });

  it("adds effort as one shell-free config argv value", () => {
    const print = codex("test-model", { effort: "high" }).buildPrintCommand(
      commandOptions,
    );
    expect(print.argv).toContain("model_reasoning_effort=high");
    // The existing shell command keeps the TOML-quoted form.
    expect(print.command).toContain('model_reasoning_effort="high"');
  });

  it("builds resume argv and stdin marker", () => {
    const print = codex("test-model").buildPrintCommand({
      ...commandOptions,
      resumeSession: "session-123",
    });
    expect(print.argv).toEqual([
      "codex",
      "exec",
      "resume",
      "session-123",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-m",
      "test-model",
      "-",
    ]);
  });

  it("builds fork argv without quoting the session id", () => {
    const print = codex("test-model").buildPrintCommand({
      ...commandOptions,
      resumeSession: "session-123",
      forkSession: true,
    });
    expect(print.argv?.slice(0, 5)).toEqual([
      "codex",
      "exec",
      "fork",
      "session-123",
      "--json",
    ]);
  });

  it("builds auto-review flags as structured values", () => {
    const print = codex("test-model", {
      approvalsReviewer: "auto_review",
    }).buildPrintCommand(commandOptions);
    expect(print.argv).toEqual([
      "codex",
      "exec",
      "--json",
      "-a",
      "on-request",
      "-s",
      "danger-full-access",
      "-c",
      "approvals_reviewer=auto_review",
      "-m",
      "test-model",
    ]);
    // Existing sandbox/Unix command behavior is unchanged.
    expect(print.command).toContain('approvals_reviewer="auto_review"');
  });
});
