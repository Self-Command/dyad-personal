import { _electron as electron } from "playwright";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const target = (await readdir("out")).find((name) => name.endsWith("-linux-x64"));
assert(target, "Missing packaged Linux app");
const userData = await mkdtemp(path.join(os.tmpdir(), "dyad-personal-smoke-"));
let app;
try {
  app = await electron.launch({
    executablePath: path.resolve("out", target, "dyad-personal"),
    args: ["--no-sandbox", `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: "production" },
    timeout: 120_000,
  });
  const window = await app.firstWindow({ timeout: 120_000 });
  await window.waitForLoadState("domcontentloaded");
  await window.locator("#root").waitFor();
  await window.waitForFunction(() => document.querySelector("#root")?.textContent?.trim().length > 20, null, { timeout: 90_000 });
  const identity = await app.evaluate(({ app }) => ({ name: app.getName(), version: app.getVersion(), userData: app.getPath("userData") }));
  assert.equal(identity.name, "Dyad Personal");
  assert.match(identity.version, /-personal\.\d+$/);
  assert.equal(path.resolve(identity.userData), path.resolve(userData));
  console.log(`Packaged app started; renderer populated; isolated data: ${identity.name} ${identity.version}`);
} finally {
  await app?.close();
  await rm(userData, { recursive: true, force: true });
}
