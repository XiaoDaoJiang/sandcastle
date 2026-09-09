import { constants as fsConstants, existsSync } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import {
  CopyToWorktreeError,
  CopyToWorktreeTimeoutError,
  withTimeout,
} from "./errors.js";

const COPY_TO_WORKTREE_TIMEOUT_MS = 60_000;

/**
 * Recursively copy a file-system tree without depending on platform shell tools.
 *
 * Regular files prefer copy-on-write via COPYFILE_FICLONE and transparently
 * fall back to a regular byte copy when the filesystem does not support it.
 * Symlinks keep their original targets. On Windows, npm/Git Bash can create
 * reparse-point shims that Node cannot inspect (EACCES/EINVAL); those entries
 * are skipped while their sibling .cmd/.ps1 shims remain copyable.
 */
const copyTree = async (src: string, dest: string): Promise<void> => {
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
      entries.map((name) => copyTree(join(src, name), join(dest, name))),
    );
    return;
  }

  if (srcStat.isSymbolicLink()) {
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
    await copyFile(src, dest, fsConstants.COPYFILE_FICLONE);
  }
};

/**
 * Copy files and directories from the host repo root to the worktree root.
 * Missing source paths are silently skipped.
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
      yield* Effect.tryPromise({
        try: () => copyTree(src, dest),
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
