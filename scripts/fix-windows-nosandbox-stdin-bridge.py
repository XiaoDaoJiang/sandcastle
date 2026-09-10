from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "src/sandboxes/no-sandbox.ts"
text = path.read_text(encoding="utf-8")

old_env = '''                SANDCASTLE_EXEC_ARGV_B64: Buffer.from(\n                  JSON.stringify(structuredArgv),\n                  "utf8",\n                ).toString("base64"),\n'''
new_env = '''                SANDCASTLE_EXEC_ARGV_B64: Buffer.from(\n                  JSON.stringify(structuredArgv),\n                  "utf8",\n                ).toString("base64"),\n                SANDCASTLE_EXEC_HAS_STDIN:\n                  opts?.stdin !== undefined ? "1" : "0",\n'''

old_bridge = '''            '$rest = @($argv | Select-Object -Skip 1); ' +\n            '& $exe @rest; ' +\n            'if ($null -eq $LASTEXITCODE) { exit 0 } else { exit $LASTEXITCODE }';\n'''
new_bridge = '''            '$rest = @($argv | Select-Object -Skip 1); ' +\n            'if ($env:SANDCASTLE_EXEC_HAS_STDIN -eq "1") { ' +\n            '$stdinText = [Console]::In.ReadToEnd(); ' +\n            '$stdinText | & $exe @rest; ' +\n            '} else { & $exe @rest }; ' +\n            'if ($null -eq $LASTEXITCODE) { exit 0 } else { exit $LASTEXITCODE }';\n'''

if new_env not in text:
    if old_env not in text:
        raise RuntimeError("Structured argv env anchor not found")
    text = text.replace(old_env, new_env, 1)

if new_bridge not in text:
    if old_bridge not in text:
        raise RuntimeError("PowerShell bridge anchor not found")
    text = text.replace(old_bridge, new_bridge, 1)

path.write_text(text, encoding="utf-8")
print("Applied explicit stdin forwarding to Windows argv bridge")
