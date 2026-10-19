import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanOutput, askLlm } from "../server/llm.mjs";
import { makePrompt } from "../server/prompt-maker.mjs";

const H3_OK = "integrated_multimodal_description: [Shot 1] Live-action, cinematic, a woman walks.\n\noverall_soundscape: Footsteps on gravel.\n\nnon_diegetic_music: N/A";

test("image prompt: the LLM gets the idea and the project context, quotes are stripped", async () => {
  let seen;
  const out = await makePrompt({ target: "image", text: "빨간 자전거", title: "Bike" }, async (system, user) => {
    seen = { system, user };
    return '"A red bicycle leaning on a brick wall."';
  });
  assert.equal(out, "A red bicycle leaning on a brick wall.");
  assert.match(seen.system, /Krea 2/);
  assert.match(seen.user, /IDEA:\n빨간 자전거/);
  assert.match(seen.user, /Project title: Bike/);
});

test("video prompt: alignment line is added by code and the clip length snaps to the frame grid", async () => {
  let user = "";
  const ask = async (_system, text) => {
    user = text;
    return `Sure!\n${H3_OK}`;
  };
  const fl2v = await makePrompt({ target: "video", mode: "fl2v", text: "x", duration: 5 }, ask);
  assert.match(user, /CLIP LENGTH: 5\.17 seconds/);
  assert.match(fl2v, /^How the reference pictures align with the target video/);
  assert.match(fl2v, /5\.17-second mark/);
  assert.ok(fl2v.includes("integrated_multimodal_description: [Shot 1]"));
  assert.ok(!fl2v.includes("Sure!"));
  assert.match(await makePrompt({ target: "video", mode: "i2v", text: "x" }, ask), /^For the target video, at 0\.00 seconds/);
  assert.match(await makePrompt({ target: "video", mode: "t2v", text: "x" }, ask), /^integrated_multimodal_description:/);
});

test("video prompt that is not in H3 format is refused; bad input is refused", async () => {
  await assert.rejects(makePrompt({ target: "video", mode: "i2v", text: "x" }, async () => "just a paragraph"), { status: 502 });
  await assert.rejects(makePrompt({ target: "movie", text: "x" }, async () => ""), { status: 400 });
  await assert.rejects(makePrompt({ target: "image", text: "  " }, async () => ""), { status: 400 });
});

test("LLM chain: the chosen provider first, then the rest; missing CLIs are skipped", async () => {
  const calls = [];
  const providers = {
    "claude-cli": async () => { calls.push("claude"); throw new Error("boom"); },
    "codex-cli": async () => { calls.push("codex"); return "```\nanswer\n```"; },
    "opencode-cli": async () => { calls.push("opencode"); return "never"; },
    ollama: async () => "never",
  };
  const llm = { provider: "claude-cli", chain: ["claude-cli", "codex-cli", "opencode-cli", "ollama"], model: "", ollama: { endpoint: "", model: "" }, timeoutSec: 30 };
  const result = await askLlm(llm, "s", "u", { providers, installed: (command) => command !== "nothing" });
  assert.deepEqual([calls, result], [["claude", "codex"], { text: "answer", provider: "codex-cli" }]);
  await assert.rejects(askLlm(llm, "s", "u", { providers: { ...providers, ollama: async () => { throw new Error("off"); } }, installed: () => false }), { status: 502 });
  assert.equal(cleanOutput("\u001b[1m> build · model\u001b[0m\nhello"), "hello");
});
