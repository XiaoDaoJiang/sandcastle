---
"@ai-hero/sandcastle": patch
---

Fix Codex argument quoting on native Windows no-sandbox runs by passing structured argv while preserving the existing shell command path for Unix and sandbox providers.
