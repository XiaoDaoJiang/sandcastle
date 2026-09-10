from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "src/sandboxes/no-sandbox.ts"
text = path.read_text(encoding="utf-8")

old = '''          const structuredArgv = isWindows ? opts?.argv : undefined;\n          const proc = structuredArgv?.length\n            ? spawn(structuredArgv[0]!, [...structuredArgv.slice(1)], {\n                cwd,\n                env: processEnv,\n                stdio,\n                // Agent CLIs installed by npm are commonly .cmd wrappers.\n                // Let cmd.exe resolve PATHEXT, while Node serializes the\n                // already-structured args instead of reusing POSIX quoting.\n                shell: true,\n              })\n            : spawn(shellCmd, shellArgs, {\n                cwd,\n                env: processEnv,\n                stdio,\n                windowsVerbatimArguments: isWindows,\n              });\n'''

new = '''          const structuredArgv = isWindows ? opts?.argv : undefined;\n          // Windows npm-installed agent CLIs are commonly `.cmd` wrappers.\n          // `spawn(exe, args, { shell: true })` would flatten the args back into\n          // a cmd.exe command string, losing the structured boundary and making\n          // spaces/metacharacters unsafe. Instead pass argv as base64 JSON data\n          // to a fixed PowerShell bridge and splat it as an argument array.\n          const structuredEnv = structuredArgv?.length\n            ? {\n                ...processEnv,\n                SANDCASTLE_EXEC_ARGV_B64: Buffer.from(\n                  JSON.stringify(structuredArgv),\n                  "utf8",\n                ).toString("base64"),\n              }\n            : processEnv;\n          const powershellArgvBridge =\n            '$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:SANDCASTLE_EXEC_ARGV_B64)); ' +\n            '$argv = @(ConvertFrom-Json $json); ' +\n            'if ($argv.Count -eq 0) { exit 1 }; ' +\n            '$exe = [string]$argv[0]; ' +\n            '$rest = @($argv | Select-Object -Skip 1); ' +\n            '& $exe @rest; ' +\n            'if ($null -eq $LASTEXITCODE) { exit 0 } else { exit $LASTEXITCODE }';\n          const proc = structuredArgv?.length\n            ? spawn(\n                "powershell.exe",\n                [\n                  "-NoLogo",\n                  "-NoProfile",\n                  "-NonInteractive",\n                  "-Command",\n                  powershellArgvBridge,\n                ],\n                {\n                  cwd,\n                  env: structuredEnv,\n                  stdio,\n                },\n              )\n            : spawn(shellCmd, shellArgs, {\n                cwd,\n                env: processEnv,\n                stdio,\n                windowsVerbatimArguments: isWindows,\n              });\n'''

if new in text:
    print("PowerShell argv bridge already applied")
elif old in text:
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("Applied safe PowerShell argv bridge")
else:
    raise RuntimeError("Expected structured argv spawn block not found")
