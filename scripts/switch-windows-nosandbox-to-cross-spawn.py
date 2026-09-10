from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "src/sandboxes/no-sandbox.ts"
text = path.read_text(encoding="utf-8")

old_import = 'import { spawn, type StdioOptions } from "node:child_process";\n'
new_import = 'import { spawn, type StdioOptions } from "node:child_process";\nimport { createRequire } from "node:module";\n'
if new_import not in text:
    if old_import not in text:
        raise RuntimeError("child_process import anchor not found")
    text = text.replace(old_import, new_import, 1)

old_anchor = 'import { BoundedTail, MAX_TAIL_CHARS } from "../boundedTail.js";\n'
new_anchor = '''import { BoundedTail, MAX_TAIL_CHARS } from "../boundedTail.js";\n\n// cross-spawn is used only for structured argv on native Windows. It resolves\n// PATHEXT / npm `.cmd` shims and applies Windows argument escaping while\n// preserving stdin/stdout/stderr as normal child-process pipes.\nconst require = createRequire(import.meta.url);\nconst crossSpawn = require("cross-spawn") as typeof spawn;\n'''
if new_anchor not in text:
    if old_anchor not in text:
        raise RuntimeError("boundedTail import anchor not found")
    text = text.replace(old_anchor, new_anchor, 1)

start_marker = '          const structuredArgv = isWindows ? opts?.argv : undefined;\n'
end_marker = '''          if (opts?.stdin !== undefined) {\n'''
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise RuntimeError("structured argv execution block not found")

new_block = '''          const structuredArgv = isWindows ? opts?.argv : undefined;\n          if (structuredArgv?.some((arg) => /[\\r\\n]/.test(arg))) {\n            reject(\n              new Error(\n                "exec failed: structured argv must not contain CR or LF on Windows",\n              ),\n            );\n            return;\n          }\n\n          const proc = structuredArgv?.length\n            ? crossSpawn(structuredArgv[0]!, [...structuredArgv.slice(1)], {\n                cwd,\n                env: processEnv,\n                stdio,\n              })\n            : spawn(shellCmd, shellArgs, {\n                cwd,\n                env: processEnv,\n                stdio,\n                windowsVerbatimArguments: isWindows,\n              });\n\n'''
text = text[:start] + new_block + text[end:]
path.write_text(text, encoding="utf-8")
print("Switched Windows structured argv execution to cross-spawn")
