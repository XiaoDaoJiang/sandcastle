import { execFile } from "node:child_process";
import { constants as fsConstants, existsSync } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  symlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import {
  CopyToWorktreeError,
  CopyToWorktreeTimeoutError,
  withTimeout,
} from "./errors.js";

const COPY_TO_WORKTREE_TIMEOUT_MS = 60_000;

/**
 * Returns cp flags for copy-on-write support on Unix-like hosts:
 * - macOS (darwin): `-cR` uses APFS clonefile
 * - Other Unix-like hosts (Linux, etc.): `-R --reflink=auto` uses GNU
 *   coreutils reflink when available
 */
export const getCopyOnWriteFlags = (platform: string): string[] =>
  platform === "darwin" ? ["-cR"] : ["-R", "--reflink=auto"];

/**
 * Recursively copy a file-system tree on native Windows without depending on
 * Git Bash/MSYS `cp.exe`.
 *
 * Regular files request COPYFILE_FICLONE and transparently fall back to a
 * regular byte copy when the filesystem/runtime cannot clone them. Symlinks
 * retain their original targets. npm/Git Bash may create reparse-point shims
 * that Node cannot inspect (EACCES/EINVAL); those unreadable entries are
 * skipped while their sibling .cmd/.ps1 shims remain copyable.
 */
const copyTreeOnWindows = async (src: string, dest: string): Promise<void> => {
  let srcStat;
  try {
    srcStat = await lstat(src);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "EACCES" || code === "EINVAL") {
      return;
    }
    throw error;
  }

  if (srcStat.isDirectory()) {
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src);
    await Promise.all(
      entries.map((name) =>
        copyTreeOnWindows(join(src, name), join(dest, name)),
      ),
    );
    return;
  }

  if (srcStat.isSymbolicLink()) {
    await mkdir(dirname(dest), { recursive: true });
    const target = await readlink(src);
    try {
      await symlink(target, dest);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
        throw error;
      }
    }
    return;
  }

  if (srcStat.isFile()) {
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest, fsConstants.COPYFILE_FICLONE);
  }
};

const copyWithUnixCp = (
  relativePath: string,
  src: string,
  dest: string,
  platform: string,
): Effect.Effect<void, CopyToWorktreeError> => {
  const cowFlags = getCopyOnWriteFlags(platform);
  return Effect.async<void, CopyToWorktreeError>((resume) => {
    execFile("cp", [...cowFlags, src, dest], (error) => {
      if (error) {
        // Preserve the existing Unix fallback when copy-on-write is unavailable.
        execFile("cp", ["-R", src, dest], (fallbackError, _, stderr) => {
          if (fallbackError) {
            resume(
              Effect.fail(
                new CopyToWorktreeError({
                  message: `Failed to copy ${relativePath} to worktree: ${stderr || fallbackError.message}`,
                  path: relativePath,
                  stderr: stderr || fallbackError.message,
                  exitCode:
                    typeof fallbackError.code === "number"
                      ? fallbackError.code
                      : null,
                }),
              ),
            );
          } else {
            resume(Effect.succeed(undefined));
          }
        });
      } else {
        resume(Effect.succeed(undefined));
      }
    });
  });
};

/**
 * Copy files and directories from the host repo root to the worktree root.
 *
 * Unix-like hosts retain the existing `cp` + copy-on-write path. Native
 * Windows uses Node filesystem APIs so `copyToWorktree` does not require a
 * Unix `cp.exe` to be present on PATH. Missing source paths are silently
 * skipped.
 */
export const copyToWorktree = (
  paths: string[],
  hostRepoDir: string,
  worktreePath: string,
  timeoutMs?: number,
): Effect.Effect<void, CopyToWorktreeTimeoutError | CopyToWorktreeError> => {
  const effectiveTimeout = timeoutMs ?? COPY_TO_WORKTREE_TIMEOUT_MS;
  return Effect.gen(function* () {
    for (const relativePath of paths) {
      const src = join(hostRepoDir, relativePath);
      if (!existsSync(src)) {
        continue;
      }
      const dest = join(worktreePath, relativePath);

      if (process.platform === "win32") {
        yield* Effect.tryPromise({
          try: () => copyTreeOnWindows(src, dest),
          catch: (error: unknown) => {
            const err = error as NodeJS.ErrnoException;
            const message = err?.message ?? String(error);
            return new CopyToWorktreeError({
              message: `Failed to copy ${relativePath} to worktree: ${message}`,
              path: relativePath,
              stderr: message,
              exitCode: typeof err?.errno === "number" ? err.errno : null,
            });
          },
        });
      } else {
        yield* copyWithUnixCp(relativePath, src, dest, process.platform);
      }
    }
  }).pipe(
    withTimeout(
      effectiveTimeout,
      () =>
        new CopyToWorktreeTimeoutError({
          message: `Copying files to worktree timed out after ${effectiveTimeout}ms`,
          timeoutMs: effectiveTimeout,
          paths,
        }),
    ),
  );
};
