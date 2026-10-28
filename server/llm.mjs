import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import spawn from "cross-spawn";

import { HttpError } from "./http.mjs";
import { killTree } from "./proc.mjs";
import { isCommandInstalled, CLI_COMMANDS } from "./llm-status.mjs";

// Both CLIs colour their output and opencode prints a "> agent · model" header line.
const ANSI = /\u001B\[[0-9;?]*[A-Za-z]/g;

export function cleanOutput(text) {
  const lines = String(text ?? "")
    .replace(ANSI, "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*>\s/.test(line));
  const trimmed = lines.join("\n").trim();
  const fenced = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return (fenced ? fenced[1] : trimmed).trim();
}

/** Runs a CLI with the prompt on stdin (a large argument gets mangled by the Windows .cmd wrappers). */
function runCli(command, args, { stdin, timeoutMs, env }) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { cwd: os.tmpdir(), windowsHide: true, env: { ...process.env, ...env } });
    const timer = setTimeout(() => killTree(child), timeoutMs);
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr = (stderr + chunk).slice(-600)));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(stdout) : reject(new Error(`종료 코드 ${code}: ${stderr.trim()}`));
    });
    child.stdin?.end(stdin);
  });
}

const PROVIDERS = {
  // The system prompt goes through a file: a multi-line argument is cut at the first newline by the Windows .cmd wrapper.
  "claude-cli": async (system, user, { model, timeoutMs }) => {
    const file = path.join(os.tmpdir(), `vsom-system-${randomUUID()}.md`);
    await writeFile(file, system, "utf8");
    try {
      return await runCli("claude", ["-p", "--system-prompt-file", file, "--no-session-persistence", "--setting-sources", "project", ...(model ? ["--model", model] : [])], {
        stdin: user,
        timeoutMs,
        // Without the user's settings and CLAUDE.md the answer is the bare text, not an assistant reply with notes.
        env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" },
      });
    } finally {
      await rm(file, { force: true });
    }
  },
  "codex-cli": (system, user, { model, timeoutMs }) =>
    runCli("codex", ["exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--color", "never", ...(model ? ["--model", model] : []), "-"], { stdin: `${system}\n\n${user}`, timeoutMs }),
  "opencode-cli": (system, user, { model, timeoutMs }) => runCli("opencode", ["run", "--pure", ...(model ? ["--model", model] : [])], { stdin: `${system}\n\n${user}`, timeoutMs }),
  ollama: async (system, user, { ollama, timeoutMs }) => {
    if (!ollama.model) throw new Error("Ollama 모델 이름이 설정에 없습니다.");
    const res = await fetch(`${ollama.endpoint.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: ollama.model, stream: false, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Ollama가 ${res.status}로 답했습니다.`);
    return (await res.json()).message?.content ?? "";
  },
};

/**
 * One text answer from the LLM chosen in the settings; when it fails, the other providers of the fallback chain are tried.
 * `providers` can be replaced (tests); `installed` tells which CLIs exist so missing ones are skipped quickly.
 */
export async function askLlm(llm, system, user, { providers = PROVIDERS, installed = isCommandInstalled } = {}) {
  const order = [llm.provider, ...llm.chain.filter((id) => id !== llm.provider)];
  const options = { model: llm.model, ollama: llm.ollama, timeoutMs: llm.timeoutSec * 1000 };
  const failures = [];
  for (const id of order) {
    const command = CLI_COMMANDS[id];
    if (command && !installed(command)) {
      failures.push(`${id}: 설치되지 않음`);
      continue;
    }
    try {
      const answer = cleanOutput(await providers[id](system, user, options));
      if (answer) return { text: answer, provider: id };
      failures.push(`${id}: 빈 답변`);
    } catch (error) {
      failures.push(`${id}: ${error.message}`);
    }
  }
  throw new HttpError(502, `LLM이 답하지 못했습니다. ${failures.join(" / ")}`);
}
