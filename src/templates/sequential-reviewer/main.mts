// Sequential Reviewer — implement-then-review loop
//
// This template drives a two-phase workflow per issue:
//   Phase 1 (Implement): A sonnet agent picks an open issue, works on it
//                        on a dedicated branch, commits the changes, and signals
//                        completion.
//   Phase 2 (Review):    A second sonnet agent reviews the branch diff and either
//                        approves it or makes corrections directly on the branch.
//
// Both phases share a single sandbox created via createSandbox(), so the
// implementer and reviewer work on the same explicit branch.
//
// The outer loop repeats up to MAX_ITERATIONS times, processing one issue per
// iteration and stopping early once the backlog is exhausted (an implement
// phase that produces no commits). This is a middle-complexity option between
// the simple-loop (no review gate) and the parallel-planner (concurrent
// execution with a planning phase).
//
// Usage (default, non-interactive):
//   npx tsx .sandcastle/main.mts
//
// Interactive takeover mode:
//   SANDCASTLE_AGENT_MODE=interactive npx tsx .sandcastle/main.mts
// PowerShell:
//   $env:SANDCASTLE_AGENT_MODE="interactive"; npx tsx .sandcastle/main.mts
//
// Or add to package.json:
//   "scripts": { "sandcastle": "npx tsx .sandcastle/main.mts" }

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Maximum number of implement→review cycles to run before stopping.
// Each cycle works on one issue. Raise this to process more issues per run.
const MAX_ITERATIONS = 10;

// Default is fully automated/non-interactive. Set SANDCASTLE_AGENT_MODE to
// "interactive" to hand the terminal directly to the agent TUI. Interactive
// mode intentionally seeds an empty prompt so createSandbox().interactive()
// enters the TUI without submitting the task. You can first choose model/settings
// (for example with Codex /model), then ask the agent to read the printed prompt
// path and continue the phase manually.
const AGENT_MODE = process.env.SANDCASTLE_AGENT_MODE ?? "run";
if (AGENT_MODE !== "run" && AGENT_MODE !== "interactive") {
  throw new Error(
    `Invalid SANDCASTLE_AGENT_MODE=${JSON.stringify(AGENT_MODE)}. Expected "run" or "interactive".`,
  );
}
const interactiveMode = AGENT_MODE === "interactive";

// Hooks run inside the sandbox before the agent starts each iteration.
// npm install ensures the sandbox always has fresh dependencies.
const hooks = {
  sandbox: { onSandboxReady: [{ command: "npm install" }] },
};

// Copy node_modules from the host into the worktree before each sandbox
// starts. Avoids a full npm install from scratch; the hook above handles
// platform-specific binaries and any packages added since the last copy.
const copyToWorktree = ["node_modules"];

console.log(`Agent mode: ${AGENT_MODE}`);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // Generate a unique branch name for this iteration.
  const branch = `sandcastle/sequential-reviewer/${Date.now()}`;

  // Create a single sandbox that both the implementer and reviewer share.
  // This gives both agents a real, named branch that persists across phases.
  const sandbox = await sandcastle.createSandbox({
    branch,
    sandbox: docker(),
    hooks,
    copyToWorktree,
  });

  try {
    // -----------------------------------------------------------------------
    // Phase 1: Implement
    //
    // A sonnet agent picks the next open issue, writes the
    // implementation (using RGR: Red → Green → Repeat → Refactor), and
    // commits the result.
    //
    // The agent signals completion via <promise>COMPLETE</promise> when done.
    // -----------------------------------------------------------------------
    // One iteration so each outer pass implements a single issue on its own
    // branch, then hands it to the reviewer. A higher value lets the agent
    // drain the whole backlog onto this one branch in a single pass, which
    // defeats the per-issue review.
    const implementAgent = sandcastle.claudeCode("claude-sonnet-4-6");
    const implement = interactiveMode
      ? await (async () => {
          console.log(
            "Interactive implementer: configure the agent first, then ask it to read .sandcastle/implement-prompt.md and execute the task.",
          );
          return sandbox.interactive({
            name: "implementer",
            agent: implementAgent,
            prompt: "",
          });
        })()
      : await sandbox.run({
          name: "implementer",
          maxIterations: 1,
          agent: implementAgent,
          promptFile: "./.sandcastle/implement-prompt.md",
        });

    if (interactiveMode && "exitCode" in implement && implement.exitCode !== 0) {
      throw new Error(
        `Interactive implementer exited with code ${implement.exitCode}`,
      );
    }

    if (!implement.commits.length) {
      // No commits means the backlog is empty or every remaining issue is
      // blocked — there is nothing left to implement or review, so stop.
      console.log("Implementation agent made no commits. Stopping.");
      break;
    }

    console.log(`\nImplementation complete on branch: ${branch}`);
    console.log(`Commits: ${implement.commits.length}`);

    // -----------------------------------------------------------------------
    // Phase 2: Review
    //
    // A second sonnet agent reviews the diff of the branch produced by
    // Phase 1. It uses the {{BRANCH}} prompt argument to inspect the right
    // branch, and either approves or makes corrections directly on the branch.
    // -----------------------------------------------------------------------
    const reviewAgent = sandcastle.claudeCode("claude-sonnet-4-6");
    if (interactiveMode) {
      console.log(
        `Interactive reviewer: configure the agent first, then ask it to read .sandcastle/review-prompt.md and review branch ${branch}.`,
      );
      const review = await sandbox.interactive({
        name: "reviewer",
        agent: reviewAgent,
        prompt: "",
      });
      if (review.exitCode !== 0) {
        throw new Error(`Interactive reviewer exited with code ${review.exitCode}`);
      }
    } else {
      await sandbox.run({
        name: "reviewer",
        maxIterations: 1,
        agent: reviewAgent,
        promptFile: "./.sandcastle/review-prompt.md",
        promptArgs: {
          BRANCH: branch,
        },
      });
    }

    console.log("\nReview complete.");
  } finally {
    await sandbox.close();
  }
}

console.log("\nAll done.");
