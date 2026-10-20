import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** A problem the user can read: ComfyUI refused the graph, a node or model is missing, the run failed or was cancelled. */
export class ComfyError extends Error {
  constructor(message, { promptId, cancelled = false } = {}) {
    super(message);
    this.promptId = promptId;
    this.cancelled = cancelled;
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac" };

/** What ComfyUI's /prompt rejection says, in a sentence: which node, which input, which value. */
export function describeNodeErrors(nodeErrors, graph = {}) {
  const lines = [];
  for (const [id, entry] of Object.entries(nodeErrors ?? {})) {
    const cls = entry.class_type ?? graph[id]?.class_type ?? "?";
    for (const error of entry.errors ?? []) {
      const extra = error.extra_info?.input_name ? ` (${error.extra_info.input_name}${error.extra_info.received_value !== undefined ? `=${error.extra_info.received_value}` : ""})` : "";
      lines.push(`노드 ${id} ${cls}: ${error.message}${extra}${error.details ? ` ${String(error.details).slice(0, 160)}` : ""}`);
    }
  }
  return lines.join(" / ");
}

/**
 * A client for one ComfyUI server: upload files, queue a graph, follow its progress, download the result.
 * Progress comes from the websocket (when available); completion is always decided from /history, so a broken socket
 * never loses a result.
 */
export function createComfy(baseUrl, { fetchImpl = fetch, WebSocketImpl = globalThis.WebSocket } = {}) {
  const url = baseUrl.replace(/\/+$/, "");
  const clientId = randomUUID();

  async function json(pathname, init, timeoutMs = 30_000) {
    const res = await fetchImpl(`${url}${pathname}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    return { res, data, text };
  }

  return {
    url,
    clientId,

    async isUp() {
      try {
        return (await fetchImpl(`${url}/system_stats`, { signal: AbortSignal.timeout(3000) })).ok;
      } catch {
        return false;
      }
    },

    /** The server is running a prompt of its own (queue_running not empty): do not start another on the same GPU. */
    async busy() {
      try {
        const { data } = await json("/queue", {}, 5000);
        return (data.queue_running?.length ?? 0) > 0;
      } catch {
        return false;
      }
    },

    /** object_info of one node class, null when the server does not know it, undefined when it cannot be asked. */
    async nodeInfo(cls) {
      try {
        const { res, data } = await json(`/object_info/${encodeURIComponent(cls)}`, {}, 15_000);
        if (!res.ok) return null;
        return data[cls] ?? null;
      } catch {
        return undefined;
      }
    },

    /** The values a combo input offers (model files of a loader), [] when unknown. */
    async options(cls, field) {
      const info = await this.nodeInfo(cls);
      const list = info?.input?.required?.[field]?.[0];
      return Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
    },

    /** Uploads a local file into ComfyUI's input folder (images, videos and audio all go through the image endpoint). */
    async upload(file, name = path.basename(file)) {
      const form = new FormData();
      form.append("image", new Blob([await readFile(file)], { type: MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" }), name);
      const { res, data, text } = await json("/upload/image", { method: "POST", body: form }, 180_000);
      if (!res.ok || !data.name) throw new ComfyError(`ComfyUI에 파일을 올리지 못했습니다 (${res.status}): ${text.slice(0, 200)}`);
      return data.name;
    },

    async submit(graph) {
      const { res, data, text } = await json("/prompt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: graph, client_id: clientId }) });
      if (data.node_errors && Object.keys(data.node_errors).length > 0) throw new ComfyError(`ComfyUI가 워크플로를 거부했습니다. ${describeNodeErrors(data.node_errors, graph)}`);
      if (!res.ok || !data.prompt_id) throw new ComfyError(`ComfyUI가 작업을 받지 않았습니다 (${res.status}): ${data.error?.message ?? text.slice(0, 300)}`);
      return data.prompt_id;
    },

    /** Stops the run in progress (ComfyUI's /interrupt). */
    async interrupt() {
      await fetchImpl(`${url}/interrupt`, { method: "POST", signal: AbortSignal.timeout(5000) }).catch(() => undefined);
    },

    /**
     * Waits until `promptId` is in the history. `onProgress({ value, max })` follows the sampler; `signal` cancels
     * (the run is interrupted on the server too); after `timeoutMs` the wait fails (the run itself is not stopped).
     */
    async wait(promptId, { timeoutMs = 3_600_000, signal, onProgress, pollMs = 2000 } = {}) {
      let socket;
      if (WebSocketImpl && onProgress) {
        try {
          socket = new WebSocketImpl(`${url.replace(/^http/, "ws")}/ws?clientId=${clientId}`);
          socket.addEventListener("message", (event) => {
            if (typeof event.data !== "string") return;
            try {
              const message = JSON.parse(event.data);
              if (message.type === "progress" && (!message.data?.prompt_id || message.data.prompt_id === promptId)) onProgress({ value: message.data.value, max: message.data.max });
            } catch {
              // A frame that is not JSON is not a progress message.
            }
          });
          socket.addEventListener("error", () => undefined);
        } catch {
          socket = undefined;
        }
      }
      const deadline = Date.now() + timeoutMs;
      try {
        for (;;) {
          if (signal?.aborted) {
            await this.interrupt();
            throw new ComfyError("사용자가 취소했습니다.", { promptId, cancelled: true });
          }
          let entry;
          try {
            entry = (await json(`/history/${promptId}`, {}, 10_000)).data[promptId];
          } catch {
            entry = undefined; // a busy server may miss one answer; try again
          }
          if (entry) {
            if (entry.status?.status_str === "error") {
              const failure = (entry.status.messages ?? []).find((item) => item[0] === "execution_error")?.[1];
              throw new ComfyError(`ComfyUI 실행 오류${failure ? `: 노드 ${failure.node_id} ${failure.node_type} - ${failure.exception_message}` : ""}`.slice(0, 700), { promptId });
            }
            return entry;
          }
          if (Date.now() > deadline) throw new ComfyError(`제한 시간 안에 끝나지 않았습니다. ComfyUI에서는 계속 실행 중일 수 있습니다. (${promptId})`, { promptId });
          await sleep(pollMs, signal);
        }
      } finally {
        try {
          socket?.close();
        } catch {
          // Already closed.
        }
      }
    },

    async download(item, dest) {
      const query = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder ?? "", type: item.type ?? "output" });
      const res = await fetchImpl(`${url}/view?${query}`, { signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new ComfyError(`결과 파일을 받지 못했습니다 (${res.status}): ${item.filename}`);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      return dest;
    },

    /**
     * Submit, wait and download the result of `outputNode` to `dest`. Several files go to `dest` with an index.
     * Returns { paths, promptId }.
     */
    async generate(graph, outputNode, dest, options = {}) {
      const promptId = await this.submit(graph);
      const entry = await this.wait(promptId, options);
      const output = entry.outputs?.[outputNode] ?? {};
      const items = [...(output.images ?? []), ...(output.gifs ?? []), ...(output.audio ?? []), ...(output.video ?? [])];
      if (items.length === 0) throw new ComfyError(`노드 ${outputNode}의 결과 파일이 없습니다. 결과가 있는 노드: ${Object.keys(entry.outputs ?? {}).join(", ") || "없음"}`, { promptId });
      const paths = [];
      for (const [index, item] of items.entries()) {
        const target = items.length === 1 ? dest : dest.replace(/(\.[^.]+)$/, `_${String(index).padStart(3, "0")}$1`);
        paths.push(await this.download(item, target));
      }
      return { paths, promptId, entry };
    },
  };
}
