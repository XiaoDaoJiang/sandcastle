---
"@ai-hero/sandcastle": patch
---

Preserve structured agent errors on non-zero exits and include stderr as supplemental diagnostics. The sequential-reviewer template now supports an optional interactive takeover mode via `SANDCASTLE_AGENT_MODE=interactive`, while keeping non-interactive execution as the default.
