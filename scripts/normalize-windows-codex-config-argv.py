from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "src/AgentProvider.ts"
text = path.read_text(encoding="utf-8")

replacements = [
    ('        \'approvals_reviewer="auto_review"\',\n', '        "approvals_reviewer=auto_review",\n'),
    ('      argv.push("-c", `model_reasoning_effort="${options.effort}"`);\n', '      argv.push("-c", `model_reasoning_effort=${options.effort}`);\n'),
]

changed = False
for old, new in replacements:
    if new in text:
        continue
    if old not in text:
        raise RuntimeError(f"Expected AgentProvider argv anchor not found: {old!r}")
    text = text.replace(old, new, 1)
    changed = True

path.write_text(text, encoding="utf-8")
print("Normalized Windows Codex config argv literals" if changed else "Already normalized")
