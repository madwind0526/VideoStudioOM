import { randomBytes } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

// Windows briefly locks files that a scanner, indexer or player has open.
const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Writes to a temp file next to the target, then renames over it, so readers never see half a file. */
export async function writeFileAtomic(target, content) {
  const temp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temp, content);
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temp, target);
        return;
      } catch (error) {
        if (attempt >= 4 || !RETRY_CODES.has(error.code)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** Runs async functions one at a time per key (single process; enough for one user on one PC). */
export function createMutex() {
  const tails = new Map();
  return function run(key, fn) {
    const previous = tails.get(key) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    const tail = next.catch(() => {});
    tails.set(key, tail);
    tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return next;
  };
}
