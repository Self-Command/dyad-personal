import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import {
  validateVersionTag,
  stageArtifacts,
  publishRelease,
  releaseApi,
  TARGETS,
} from "./personal-release.mjs";

test("only exact immutable personal tags are accepted", () => {
  validateVersionTag("1.20.0-personal.1", "v1.20.0-personal.1");
  for (const tag of ["v1.20.0", "v1.20.0-personal.2", "1.20.0-personal.1"]) {
    assert.throws(() => validateVersionTag("1.20.0-personal.1", tag));
  }
});

test("authentication failures are never mistaken for a missing release", async () => {
  const api = releaseApi({
    repository: "owner/repo",
    token: "secret",
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  await assert.rejects(
    api("/releases/tags/v1", { allowMissing: true }),
    /HTTP 401/,
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "personal-release-"));
  const version = "1.20.0-personal.1";
  const commit = "a".repeat(40);
  for (const target of TARGETS) {
    const make = path.join(root, "out/make");
    await rm(make, { force: true, recursive: true });
    await mkdir(make, { recursive: true });
    const [platform, arch] = target.split("-");
    const extensions =
      platform === "win32"
        ? ["exe", "zip"]
        : platform === "darwin"
          ? ["zip"]
          : ["deb", "rpm", "AppImage"];
    for (const extension of extensions)
      await writeFile(
        path.join(make, `Test App.${extension}`),
        `${target} ${extension}`,
      );
    await stageArtifacts({ root, version, commit, platform, arch });
  }
  return {
    root,
    version,
    commit,
    tag: `v${version}`,
    repository: "owner/repo",
    token: "test-secret",
  };
}

function server(commit) {
  const state = {
    release: null,
    assets: [],
    creates: 0,
    publishes: 0,
    moved: false,
  };
  const response = (json, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => structuredClone(json),
  });
  const fetchImpl = async (url, options = {}) => {
    const endpoint = new URL(url);
    const method = options.method ?? "GET";
    if (endpoint.pathname.includes("/commits/"))
      return response({ sha: state.moved ? "b".repeat(40) : commit });
    if (endpoint.pathname.includes("/releases/tags/"))
      return state.release ? response(state.release) : response({}, 404);
    if (endpoint.hostname === "uploads.github.com") {
      const chunks = [];
      for await (const chunk of options.body) chunks.push(chunk);
      const data = Buffer.concat(chunks);
      const asset = {
        name: endpoint.searchParams.get("name"),
        size: data.length,
        digest: `sha256:${createHash("sha256").update(data).digest("hex")}`,
      };
      state.assets.push(asset);
      return response(asset, 201);
    }
    if (endpoint.pathname.endsWith("/assets")) return response(state.assets);
    if (method === "POST" && endpoint.pathname.endsWith("/releases")) {
      state.creates++;
      state.release = {
        ...JSON.parse(options.body),
        id: 1,
        upload_url:
          "https://uploads.github.com/repos/owner/repo/releases/1/assets{?name,label}",
        html_url: "https://github.com/owner/repo/releases/tag/v1",
      };
      return response(state.release, 201);
    }
    if (method === "PATCH") {
      state.publishes++;
      state.release = { ...state.release, ...JSON.parse(options.body) };
      return response(state.release);
    }
    throw new Error(`Unexpected request: ${method} ${endpoint}`);
  };
  return { state, fetchImpl };
}

test("publishes all four targets only after upload digest verification; never overwrites a published version", async () => {
  const setup = await fixture();
  const fake = server(setup.commit);
  try {
    const release = await publishRelease({
      ...setup,
      fetchImpl: fake.fetchImpl,
    });
    assert.equal(release.draft, false);
    assert.equal(fake.state.assets.length, 15);
    assert.equal(fake.state.creates, 1);
    assert.equal(fake.state.publishes, 1);
    await assert.rejects(
      publishRelease({ ...setup, fetchImpl: fake.fetchImpl }),
      /already published/,
    );
    assert.equal(fake.state.creates, 1);
  } finally {
    await rm(setup.root, { force: true, recursive: true });
  }
});

test("resumes only matching drafts and rejects tampered local assets or moved tags", async () => {
  const setup = await fixture();
  const fake = server(setup.commit);
  try {
    fake.state.release = {
      id: 1,
      draft: true,
      target_commitish: setup.commit,
      body: `Personal source commit: ${setup.commit}`,
      upload_url:
        "https://uploads.github.com/repos/owner/repo/releases/1/assets{?name,label}",
    };
    await publishRelease({ ...setup, fetchImpl: fake.fetchImpl });
    assert.equal(fake.state.creates, 0);
    fake.state.moved = true;
    await assert.rejects(
      publishRelease({ ...setup, fetchImpl: fake.fetchImpl }),
      /tag moved/,
    );
    fake.state.moved = false;
    const directory = path.join(setup.root, "out/personal-artifacts");
    await writeFile(
      path.join(directory, "SHA256SUMS-linux-x64.txt"),
      "tampered",
    );
    await assert.rejects(
      publishRelease({ ...setup, fetchImpl: fake.fetchImpl }),
      /Invalid checksums/,
    );
  } finally {
    await rm(setup.root, { force: true, recursive: true });
  }
});

test("a partial upload stays private and a retry reuses matching assets without duplication", async () => {
  const setup = await fixture();
  const fake = server(setup.commit);
  try {
    let uploads = 0;
    const failOnce = async (url, options) => {
      if (new URL(url).hostname === "uploads.github.com" && ++uploads === 3) {
        return { ok: false, status: 503 };
      }
      return fake.fetchImpl(url, options);
    };
    await assert.rejects(
      publishRelease({ ...setup, fetchImpl: failOnce }),
      /Upload failed/,
    );
    assert.equal(fake.state.release.draft, true);
    assert.equal(fake.state.assets.length, 2);
    assert.equal(fake.state.publishes, 0);
    await publishRelease({ ...setup, fetchImpl: fake.fetchImpl });
    assert.equal(fake.state.creates, 1);
    assert.equal(fake.state.assets.length, 15);
    assert.equal(
      new Set(fake.state.assets.map((asset) => asset.name)).size,
      15,
    );
    assert.equal(fake.state.publishes, 1);
  } finally {
    await rm(setup.root, { force: true, recursive: true });
  }
});
