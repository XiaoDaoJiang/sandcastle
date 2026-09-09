---
"@ai-hero/sandcastle": patch
---

Fix `copyToWorktree` on native Windows hosts so it no longer depends on the Unix `cp` executable being present on `PATH`.
