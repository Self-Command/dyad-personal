import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  readdir,
  readFile,
  mkdir,
  copyFile,
  writeFile,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TARGETS = ["win32-x64", "linux-x64", "darwin-x64", "darwin-arm64"];

export function validateVersionTag(version, tag) {
  if (!/^\d+\.\d+\.\d+-personal\.\d+$/.test(version) || tag !== `v${version}`) {
    throw new Error(
      "Expected immutable tag v<package.json version>, using X.Y.Z-personal.N",
    );
  }
}

export async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(file)));
    else if (entry.isFile()) result.push(file);
  }
  return result.sort();
}

export async function stageArtifacts({
  root,
  version,
  platform,
  arch,
  commit,
}) {
  const target = `${platform}-${arch}`;
  if (!TARGETS.includes(target))
    throw new Error(`Unsupported target: ${target}`);
  const destination = path.join(root, "out/personal-artifacts");
  await mkdir(destination, { recursive: true });
  const sources = (await filesUnder(path.join(root, "out/make"))).filter(
    (file) => /\.(exe|zip|deb|rpm|AppImage)$/.test(file),
  );
  const required =
    platform === "win32"
      ? [".exe", ".zip"]
      : platform === "darwin"
        ? [".zip"]
        : [".deb", ".rpm", ".AppImage"];
  for (const extension of required) {
    if (!sources.some((file) => file.endsWith(extension)))
      throw new Error(`Missing ${target} ${extension} installer`);
  }
  const assets = [];
  const names = new Set();
  for (const source of sources) {
    const name = `dyad-personal-${version}-${target}-${path.basename(source).replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    if (names.has(name)) throw new Error(`Duplicate asset: ${name}`);
    names.add(name);
    await copyFile(source, path.join(destination, name));
    assets.push({
      name,
      bytes: (await stat(source)).size,
      sha256: await digest(source),
    });
  }
  await writeFile(
    path.join(destination, `manifest-${target}.json`),
    JSON.stringify({ version, target, commit, assets }, null, 2) + "\n",
  );
  await writeFile(
    path.join(destination, `SHA256SUMS-${target}.txt`),
    assets.map((asset) => `${asset.sha256}  ${asset.name}`).join("\n") + "\n",
  );
  return assets;
}

export function releaseApi({ token, repository, fetchImpl = fetch }) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? ""))
    throw new Error("GH_TOKEN and GITHUB_REPOSITORY are required");
  return async (endpoint, options = {}) => {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}${endpoint}`,
      {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...options.headers,
        },
      },
    );
    if (response.status === 404 && options.allowMissing) return null;
    if (!response.ok)
      throw new Error(
        `GitHub ${options.method ?? "GET"} ${endpoint}: HTTP ${response.status}`,
      );
    return response.json();
  };
}

function validateExistingRelease(release, marker, commit) {
  if (!release) return;
  if (!release.draft)
    throw new Error(
      "Release already published; use a new personal version. No assets were overwritten.",
    );
  if (release.target_commitish !== commit || !release.body?.includes(marker))
    throw new Error(
      "Existing draft belongs to a different commit or publisher",
    );
}

export async function publishRelease({
  root,
  version,
  tag,
  commit,
  repository,
  token,
  fetchImpl = fetch,
}) {
  validateVersionTag(version, tag);
  const api = releaseApi({ repository, token, fetchImpl });
  const assertTag = async () => {
    const resolved = await api(`/commits/${encodeURIComponent(tag)}`);
    if (resolved.sha !== commit)
      throw new Error("Release tag moved; refusing to publish");
  };
  await assertTag();
  const directory = path.join(root, "out/personal-artifacts");
  const entries = await readdir(directory);
  const expected = new Set();
  for (const target of TARGETS) {
    const manifestName = `manifest-${target}.json`;
    const checksumsName = `SHA256SUMS-${target}.txt`;
    const manifest = JSON.parse(
      await readFile(path.join(directory, manifestName), "utf8"),
    );
    if (
      manifest.version !== version ||
      manifest.target !== target ||
      manifest.commit !== commit ||
      !manifest.assets.length
    )
      throw new Error(`Invalid manifest: ${target}`);
    expected.add(manifestName);
    expected.add(checksumsName);
    const checksums = [];
    for (const asset of manifest.assets) {
      if (
        path.basename(asset.name) !== asset.name ||
        expected.has(asset.name) ||
        !asset.name.startsWith(`dyad-personal-${version}-${target}-`)
      )
        throw new Error("Invalid/duplicate manifest asset");
      const local = path.join(directory, asset.name);
      if (
        (await stat(local)).size !== asset.bytes ||
        (await digest(local)) !== asset.sha256
      )
        throw new Error(`Checksum mismatch: ${asset.name}`);
      expected.add(asset.name);
      checksums.push(`${asset.sha256}  ${asset.name}`);
    }
    if (
      (await readFile(path.join(directory, checksumsName), "utf8")) !==
      checksums.join("\n") + "\n"
    )
      throw new Error(`Invalid checksums: ${target}`);
  }
  if (
    entries.length !== expected.size ||
    entries.some((name) => !expected.has(name))
  )
    throw new Error("Unexpected release files");
  const marker = `Personal source commit: ${commit}`;
  let release = await api(`/releases/tags/${encodeURIComponent(tag)}`, {
    allowMissing: true,
  });
  validateExistingRelease(release, marker, commit);
  if (!release)
    release = await api("/releases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: commit,
        name: `Dyad Personal ${version}`,
        draft: true,
        prerelease: true,
        body: `${marker}\n\nIndependent personal distribution based on dyad-sh/dyad v1.20.0.\n\nWindows x64 (installer and portable ZIP), macOS Intel/Apple Silicon ZIP, Linux x64 (DEB/RPM/AppImage). Builds are unsigned. SHA256 checksums and source manifests accompany each target. Official auto-updates are disabled.\n\nUse Personal mode with your API key or local model. Shell is opt-in, reviewed and requires per-command approval. Official Engine services require their own authorization.\n\nSee docs/PERSONAL.md and docs/PRO-AUDIT.md in the source for setup, limitations and licenses.`,
      }),
    });
  const existing = await api(`/releases/${release.id}/assets?per_page=100`);
  if (existing.some((asset) => !expected.has(asset.name)))
    throw new Error(
      "Draft contains unexpected assets; nothing will be overwritten",
    );
  for (const name of [...expected].sort()) {
    const file = path.join(directory, name);
    const sha256 = await digest(file);
    const bytes = (await stat(file)).size;
    const previous = existing.find((asset) => asset.name === name);
    if (previous) {
      if (previous.size !== bytes || previous.digest !== `sha256:${sha256}`)
        throw new Error(`Existing asset differs: ${name}`);
      continue;
    }
    const uploadUrl = new URL(release.upload_url.split("{")[0]);
    if (uploadUrl.origin !== "https://uploads.github.com")
      throw new Error("Untrusted release upload host");
    uploadUrl.searchParams.set("name", name);
    const response = await fetchImpl(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes),
      },
      body: createReadStream(file),
      duplex: "half",
    });
    if (!response.ok)
      throw new Error(
        `Upload failed: ${name} HTTP ${response.status}; draft retained for safe retry`,
      );
    const uploaded = await response.json();
    if (
      uploaded.name !== name ||
      uploaded.size !== bytes ||
      uploaded.digest !== `sha256:${sha256}`
    )
      throw new Error(`Remote checksum mismatch: ${name}`);
  }
  const uploaded = await api(`/releases/${release.id}/assets?per_page=100`);
  if (uploaded.length !== expected.size)
    throw new Error("Remote asset count mismatch");
  for (const name of expected) {
    const asset = uploaded.find((item) => item.name === name);
    const file = path.join(directory, name);
    if (
      !asset ||
      asset.size !== (await stat(file)).size ||
      asset.digest !== `sha256:${await digest(file)}`
    )
      throw new Error(`Final verification failed: ${name}`);
  }
  await assertTag();
  const published = await api(`/releases/${release.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft: false }),
  });
  if (published.draft) throw new Error("Release is still a draft");
  console.log(
    `Published and verified ${expected.size} assets: ${published.html_url}`,
  );
  return published;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const root = process.cwd();
  const { version } = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const command = process.argv[2];
  const commit = process.env.GITHUB_SHA;
  if (command === "stage") {
    await stageArtifacts({
      root,
      version,
      commit,
      platform: process.env.TARGET_PLATFORM ?? process.platform,
      arch: process.env.TARGET_ARCH ?? process.arch,
    });
  } else if (command === "check") {
    validateVersionTag(version, `v${version}`);
    if (process.env.GITHUB_REF_TYPE === "tag") {
      validateVersionTag(version, process.env.GITHUB_REF_NAME);
      const api = releaseApi({
        repository: process.env.GITHUB_REPOSITORY,
        token: process.env.GH_TOKEN,
      });
      const release = await api(
        `/releases/tags/${encodeURIComponent(process.env.GITHUB_REF_NAME)}`,
        { allowMissing: true },
      );
      validateExistingRelease(
        release,
        `Personal source commit: ${commit}`,
        commit,
      );
    }
    console.log(`Validated personal version ${version}`);
  } else if (command === "publish") {
    await publishRelease({
      root,
      version,
      commit,
      tag: process.env.GITHUB_REF_NAME,
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GH_TOKEN,
    });
  } else
    throw new Error(
      "Usage: node scripts/personal-release.mjs check|stage|publish",
    );
}
