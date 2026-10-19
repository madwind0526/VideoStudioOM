import { existsSync } from "node:fs";
import path from "node:path";

// Order matters: the bare name first covers the Unix shim, and .cmd/.ps1 are the Windows wrappers
// that npm installs (claude and opencode live behind one of these).
const WINDOWS_EXECUTABLE_EXTENSIONS = ["", ".cmd", ".exe", ".ps1", ".bat"];

export const CLI_COMMANDS = { "claude-cli": "claude", "codex-cli": "codex", "opencode-cli": "opencode" };

/**
 * Cheap existence check: scans PATH for the command and never spawns, so the Settings screen can
 * poll it. (Same approach as MusicAutomation's llm-cli.mjs.)
 */
export function isCommandInstalled(command, env = process.env) {
  const directories = (env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const extension of WINDOWS_EXECUTABLE_EXTENSIONS) {
      try {
        if (existsSync(path.join(directory, `${command}${extension}`))) return true;
      } catch {
        // An unreadable PATH entry is skipped rather than failing the whole check.
      }
    }
  }
  return false;
}

/** Installed models of a local Ollama (`/api/tags`), or null when it does not answer. */
export async function ollamaModels(endpoint) {
  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, "")}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const body = await res.json();
    return (body.models ?? []).map((model) => model.name).filter((name) => typeof name === "string");
  } catch {
    return null;
  }
}

/** What each LLM provider needs and whether it is usable right now. */
export async function llmStatus({ ollamaEndpoint, env = process.env, installed = isCommandInstalled, models = ollamaModels }) {
  const providers = Object.entries(CLI_COMMANDS).map(([id, command]) => ({ id, kind: "cli", command, ready: installed(command, env) }));
  const found = await models(ollamaEndpoint);
  providers.push({ id: "ollama", kind: "local", ready: found !== null, models: found ?? [] });
  return { providers };
}
