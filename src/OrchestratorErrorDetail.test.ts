import { describe, expect, it } from "vitest";
import { formatAgentFailureDetail } from "./Orchestrator.js";

describe("formatAgentFailureDetail", () => {
  it("keeps structured agent errors ahead of stderr diagnostics", () => {
    const detail = formatAgentFailureDetail({
      resultText:
        "You've hit your usage limit. Try again at Sep 15th, 2026 9:45 AM.",
      stderr: "Reading prompt from stdin...\n",
      stdout: '{"type":"error","message":"usage limit"}',
    });

    expect(detail).toContain("You've hit your usage limit");
    expect(detail).toContain("stderr:\nReading prompt from stdin...");
    expect(detail.indexOf("usage limit")).toBeLessThan(
      detail.indexOf("Reading prompt from stdin"),
    );
  });

  it("uses stderr when no structured agent error was parsed", () => {
    expect(
      formatAgentFailureDetail({
        resultText: "",
        stderr: "fatal error from stderr\n",
        stdout: "some stdout output",
      }),
    ).toBe("fatal error from stderr");
  });

  it("falls back to the last 20 non-empty stdout lines", () => {
    const stdout = Array.from({ length: 25 }, (_, index) => `line-${index + 1}`)
      .join("\n");

    const detail = formatAgentFailureDetail({
      resultText: "",
      stderr: "",
      stdout,
    });

    expect(detail).not.toContain("line-1\n");
    expect(detail).toContain("line-6");
    expect(detail).toContain("line-25");
  });
});
