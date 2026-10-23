import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

// Production packages disable Node inspection. Start the real binary normally
// and inspect only its renderer through Chromium's loopback CDP endpoint.
const target = (await readdir("out")).find((name) => name.endsWith("-linux-x64"));
assert(target, "Missing packaged Linux app");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const scratch = await mkdtemp(path.join(os.tmpdir(), "dyad-personal-smoke-"));
const userData = path.join(scratch, "data");
await mkdir(userData, { recursive: true });
const diagnostics = path.resolve("out/smoke-diagnostics");
await mkdir(diagnostics, { recursive: true });
const child = spawn(path.resolve("out", target, "dyad-personal"), [
  "--no-sandbox", "--disable-gpu", "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=0", `--user-data-dir=${userData}`,
], {
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NODE_ENV: "production", XDG_CONFIG_HOME: path.join(scratch, "config"), XDG_CACHE_HOME: path.join(scratch, "cache") },
});
let output = "";
let browser;
let page;
const capture = (chunk) => { output = (output + chunk.toString()).slice(-64_000); };
child.stdout.on("data", capture);
child.stderr.on("data", capture);
const exit = once(child, "exit");
try {
  const deadline = Date.now() + 120_000;
  let endpoint;
  while (!endpoint && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`App exited before opening a window: ${child.exitCode}`);
    endpoint = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)?.[1];
    if (!endpoint) await delay(200);
  }
  assert(endpoint, "Production app did not expose its renderer endpoint");
  browser = await chromium.connectOverCDP(endpoint, { timeout: 30_000 });
  while (!page && Date.now() < deadline) {
    page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith("file:"));
    if (!page) await delay(200);
  }
  assert(page, "Production app did not create its packaged renderer");
  page.on("pageerror", (error) => capture(`\nRenderer error: ${error.message}\n`));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => document.querySelector("#root")?.textContent?.trim().length > 20, null, { timeout: 90_000 });
  const identity = await page.evaluate(async () => {
    const ipc = window.electron.ipcRenderer;
    const appVersion = await ipc.invoke("get-app-version");
    const settings = await ipc.invoke("get-user-settings");
    return { version: appVersion.version, personal: settings.enablePersonalMode, autoUpdate: settings.enableAutoUpdate };
  });
  assert.equal(identity.version, version);
  assert.equal(identity.personal, true);
  assert.equal(identity.autoUpdate, false);
  const possibleDataDirs = [userData, path.join(scratch, "config", "Dyad Personal"), path.join(scratch, "config", "dyad-personal")];
  let isolatedSettings;
  for (const directory of possibleDataDirs) {
    try { isolatedSettings = JSON.parse(await readFile(path.join(directory, "user-settings.json"), "utf8")); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  assert(isolatedSettings?.enablePersonalMode, "App did not persist settings inside its isolated smoke data directory");
  await page.screenshot({ path: path.join(diagnostics, "startup.png") });
  console.log(`Production binary started; renderer and real IPC work; isolated Personal settings verified: ${identity.version}`);
} catch (error) {
  console.error(output.slice(-12_000));
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(diagnostics, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(diagnostics, "startup.log"), output);
  await browser?.close().catch(() => {});
  if (child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
    await Promise.race([exit, delay(3_000)]);
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
      await exit;
    }
  }
  await rm(scratch, { recursive: true, force: true });
}
