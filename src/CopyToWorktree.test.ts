import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import { copyToWorktree, getCopyOnWriteFlags } from "./CopyToWorktree.js";
import { CopyToWorktreeError, CopyToWorktreeTimeoutError } from "./errors.js";

describe("getCopyOnWriteFlags", () => {
  it("returns -cR on darwin (APFS clonefile)", () => {
    expect(getCopyOnWriteFlags("darwin")).toEqual(["-cR"]);
  });

  it("returns -R --reflink=auto on linux", () => {
    expect(getCopyOnWriteFlags("linux")).toEqual(["-R", "--reflink=auto"]);
  });

  it("preserves the existing flags for other Unix-like platforms", () => {
    expect(getCopyOnWriteFlags("freebsd")).toEqual(["-R", "--reflink=auto"]);
  });
});

const symlinkSupported = await (async () => {
  const probe = await mkdtemp(join(tmpdir(), "cw-sym-probe-"));
  try {
    await writeFile(join(probe, "target.txt"), "x");
    await symlink("target.txt", join(probe, "link"));
    return true;
  } catch {
    return false;
  } finally {
    await rm(probe, { recursive: true, force: true });
  }
})();

describe("copyToWorktree", () => {
  it("copies a regular file", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "cw-test-"));
    const worktreeDir = await mkdtemp(join(tmpdir(), "cw-wt-"));

    await writeFile(join(hostDir, "file.txt"), "content");

    try {
      await Effect.runPromise(
        copyToWorktree(["file.txt"], hostDir, worktreeDir),
      );
      expect(existsSync(join(worktreeDir, "file.txt"))).toBe(true);
    } finally {
      await rm(hostDir, { recursive: true, force: true });
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "win32")(
    "creates missing destination parents for nested files on Windows",
    async () => {
      const hostDir = await mkdtemp(join(tmpdir(), "cw-test-"));
      const worktreeDir = await mkdtemp(join(tmpdir(), "cw-wt-"));

      const relativePath = ".sandcastle/implement-prompt.md";
      await mkdir(join(hostDir, ".sandcastle"));
      await writeFile(join(hostDir, relativePath), "prompt");

      try {
        expect(existsSync(join(worktreeDir, ".sandcastle"))).toBe(false);

        await Effect.runPromise(
          copyToWorktree([relativePath], hostDir, worktreeDir),
        );

        expect(existsSync(join(worktreeDir, relativePath))).toBe(true);
      } finally {
        await rm(hostDir, { recursive: true, force: true });
        await rm(worktreeDir, { recursive: true, force: true });
      }
    },
  );

  it("recursively copies a directory tree", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "cw-test-"));
    const worktreeDir = await mkdtemp(join(tmpdir(), "cw-wt-"));

    await mkdir(join(hostDir, "pkg", "sub"), { recursive: true });
    await writeFile(join(hostDir, "pkg", "a.txt"), "A");
    await writeFile(join(hostDir, "pkg", "sub", "b.txt"), "B");

    try {
      await Effect.runPromise(copyToWorktree(["pkg"], hostDir, worktreeDir));

      expect(existsSync(join(worktreeDir, "pkg", "a.txt"))).toBe(true);
      expect(existsSync(join(worktreeDir, "pkg", "sub", "b.txt"))).toBe(true);
      expect(existsSync(join(worktreeDir, "pkg", "pkg"))).toBe(false);
    } finally {
      await rm(hostDir, { recursive: true, force: true });
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "win32")(
    "merges into an existing destination directory on Windows without nesting",
    async () => {
      const hostDir = await mkdtemp(join(tmpdir(), "cw-test-"));
      const worktreeDir = await mkdtemp(join(tmpdir(), "cw-wt-"));

      await mkdir(join(hostDir, "tree"));
      await writeFile(join(hostDir, "tree", "fresh.txt"), "fresh");

      await mkdir(join(worktreeDir, "tree"));
      await writeFile(join(worktreeDir, "tree", "stale.txt"), "stale");

      try {
        await Effect.runPromise(copyToWorktree(["tree"], hostDir, worktreeDir));

        expect(existsSync(join(worktreeDir, "tree", "fresh.txt"))).toBe(true);
        expect(existsSync(join(worktreeDir, "tree", "stale.txt"))).toBe(true);
        expect(existsSync(join(worktreeDir, "tree", "tree"))).toBe(false);
      } finally {
        await rm(hostDir, { recursive: true, force: true });
        await rm(worktreeDir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!symlinkSupported)(
    "preserves symlinks with their original relative target",
    async () => {
      const hostDir = await mkdtemp(join(tmpdir(), "cw-test-"));
      const worktreeDir = await mkdtemp(join(tmpdir(), "cw-wt-"));

      await mkdir(join(hostDir, "pkg", "bin"), { recursive: true });
      await writeFile(join(hostDir, "pkg", "bin", "real"), "binary");
      await mkdir(join(hostDir, "pkg", ".bin"));
      await symlink("../bin/real", join(hostDir, "pkg", ".bin", "shim"));

      const sourceLink = join(hostDir, "pkg", ".bin", "shim");
      const expectedTarget = await readlink(sourceLink);

      try {
        await Effect.runPromise(copyToWorktree(["pkg"], hostDir, worktreeDir));

        const copiedLink = join(worktreeDir, "pkg", ".bin", "shim");
        const stat = await lstat(copiedLink);
        expect(stat.isSymbolicLink()).toBe(true);
        expect(await readlink(copiedLink)).toBe(expectedTarget);
      } finally {
        await rm(hostDir, { recursive: true, force: true });
        await rm(worktreeDir, { recursive: true, force: true });
      }
    },
  );

  it("fails with CopyToWorktreeError when the destination parent is a file", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "cw-test-"));
    const worktreeDir = await mkdtemp(join(tmpdir(), "cw-wt-"));

    await mkdir(join(hostDir, "nested"));
    await writeFile(join(hostDir, "nested", "file.txt"), "content");
    await writeFile(join(worktreeDir, "nested"), "blocker");

    try {
      const exit = await Effect.runPromiseExit(
        copyToWorktree(["nested/file.txt"], hostDir, worktreeDir),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        const error = exit.cause.error;
        expect(error).toBeInstanceOf(CopyToWorktreeError);
        if (error instanceof CopyToWorktreeError) {
          expect(error.path).toBe("nested/file.txt");
          expect(error.stderr).toBeTruthy();
          expect(error._tag).toBe("CopyToWorktreeError");
        }
      } else {
        throw new Error("Expected Fail cause");
      }
    } finally {
      await rm(hostDir, { recursive: true, force: true });
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

  it("skips missing source paths without error", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "cw-test-"));
    const worktreeDir = await mkdtemp(join(tmpdir(), "cw-wt-"));

    try {
      await Effect.runPromise(
        copyToWorktree(["nonexistent.txt"], hostDir, worktreeDir),
      );
    } finally {
      await rm(hostDir, { recursive: true, force: true });
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

  it("uses custom timeoutMs when provided", async () => {
    vi.useFakeTimers();
    const hostDir = await mkdtemp(join(tmpdir(), "cw-test-"));
    const worktreeDir = await mkdtemp(join(tmpdir(), "cw-wt-"));

    await writeFile(join(hostDir, "big-file.txt"), "content");

    try {
      const customTimeout = 500;
      const exitPromise = Effect.runPromiseExit(
        copyToWorktree(
          ["big-file.txt"],
          hostDir,
          worktreeDir,
          customTimeout,
        ),
      );

      await vi.advanceTimersByTimeAsync(customTimeout + 100);

      const exit = await exitPromise;
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        const error = exit.cause.error;
        expect(error).toBeInstanceOf(CopyToWorktreeTimeoutError);
        if (error instanceof CopyToWorktreeTimeoutError) {
          expect(error.timeoutMs).toBe(customTimeout);
        }
      }
    } finally {
      vi.useRealTimers();
      await rm(hostDir, { recursive: true, force: true });
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

  it("defaults to 60s timeout when timeoutMs is omitted", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "cw-test-"));
    const worktreeDir = await mkdtemp(join(tmpdir(), "cw-wt-"));

    await writeFile(join(hostDir, "file.txt"), "content");

    try {
      await Effect.runPromise(
        copyToWorktree(["file.txt"], hostDir, worktreeDir),
      );
      expect(existsSync(join(worktreeDir, "file.txt"))).toBe(true);
    } finally {
      await rm(hostDir, { recursive: true, force: true });
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });
});
