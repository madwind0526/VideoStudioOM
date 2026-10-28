import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { checkRelativePath, isValidProjectId, resolveInside } from "../server/paths.mjs";

async function sandbox() {
  const base = await mkdtemp(path.join(os.tmpdir(), "vsom-paths-"));
  const root = path.join(base, "project");
  const secret = path.join(base, "secret");
  await mkdir(path.join(root, "studio"), { recursive: true });
  await mkdir(secret);
  await writeFile(path.join(secret, "key.txt"), "secret");
  return { base, root, secret };
}

test("project ids", () => {
  for (const ok of ["bee-waggle-dance", "벌의-춤", "a", "a_1"]) assert.equal(isValidProjectId(ok), true, ok);
  for (const bad of ["", "A", "a b", "a/b", "a\\b", "..", "a:b", "a.b", "x".repeat(61), null, 5]) assert.equal(isValidProjectId(bad), false, String(bad));
});

test("rejects Windows path tricks", () => {
  const bad = [
    "../secret/key.txt",
    "studio/../../secret",
    "..\\secret",
    "/etc/passwd",
    "\\\\server\\share",
    "C:foo",
    "C:\\Windows",
    "studio/file.json::$DATA",
    "studio/a. ",
    "studio/a.",
    "studio//x",
    "studio/",
    "con",
    "studio/NUL.txt",
    "studio/a?b",
    "",
  ];
  for (const rel of bad) assert.throws(() => checkRelativePath(rel), { status: 400 }, JSON.stringify(rel));
  assert.doesNotThrow(() => checkRelativePath("studio/settings.json"));
  assert.doesNotThrow(() => checkRelativePath("assets\\images\\scene1.png"));
});

test("resolves plain paths inside the root, including ones that do not exist yet", async () => {
  const { base, root } = await sandbox();
  try {
    const existing = await resolveInside(root, "studio");
    assert.ok(existing.toLowerCase().endsWith(path.join("project", "studio").toLowerCase()));
    await resolveInside(root, "studio/new/deep/file.json");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("a junction pointing outside the root is refused", async () => {
  const { base, root, secret } = await sandbox();
  try {
    await symlink(secret, path.join(root, "studio", "link"), "junction");
    await assert.rejects(resolveInside(root, "studio/link/key.txt"), { status: 400 });
    await assert.rejects(resolveInside(root, "studio/link/new.txt"), { status: 400 });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("a junction that stays inside the root is followed: the returned path is the real one", async () => {
  const { base, root } = await sandbox();
  try {
    await mkdir(path.join(root, "studio", "real"));
    await writeFile(path.join(root, "studio", "real", "a.txt"), "x");
    await symlink(path.join(root, "studio", "real"), path.join(root, "studio", "link"), "junction");
    const got = await resolveInside(root, "studio/link/a.txt");
    assert.equal(got.toLowerCase(), path.join(await (await import("node:fs/promises")).realpath(root), "studio", "real", "a.txt").toLowerCase());
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
