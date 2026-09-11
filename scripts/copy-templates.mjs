import { cp, rm } from "node:fs/promises";

await rm("dist/templates", { recursive: true, force: true });
await cp("src/templates", "dist/templates", { recursive: true });
