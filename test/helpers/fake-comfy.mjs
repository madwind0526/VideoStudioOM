import { createServer } from "node:http";

/**
 * A small stand-in for a ComfyUI server. It remembers what it was given (`seen`) and answers the endpoints the client uses.
 * options: { nodes: { Class: object_info }, finishAfter: polls before the history shows the run, outputs: history outputs,
 *            files: { filename: Buffer } served by /view, reject: node_errors for /prompt, failure: execution error, running: queue }
 */
export async function fakeComfy({ nodes = {}, finishAfter = 1, outputs = {}, files = {}, reject, failure, running = false } = {}) {
  const seen = { prompts: [], uploads: [], interrupts: 0, views: [], frees: [] };
  let polls = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (data, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      if (url.pathname === "/system_stats") return send({ system: {} });
      if (url.pathname === "/queue") return send({ queue_running: running ? [["run"]] : [], queue_pending: [] });
      if (url.pathname.startsWith("/object_info/")) {
        const cls = decodeURIComponent(url.pathname.split("/").pop());
        return nodes[cls] ? send({ [cls]: nodes[cls] }) : send({});
      }
      if (url.pathname === "/upload/image") {
        const name = /filename="([^"]+)"/.exec(body.toString("latin1"))?.[1] ?? "upload";
        seen.uploads.push(name);
        return send({ name: `up_${name}`, subfolder: "", type: "input" });
      }
      if (url.pathname === "/prompt") {
        const payload = JSON.parse(body.toString());
        seen.prompts.push(payload.prompt);
        if (reject) return send({ error: { message: "Prompt outputs failed validation" }, node_errors: reject }, 400);
        return send({ prompt_id: "p1", number: 1, node_errors: {} });
      }
      if (url.pathname === "/free") {
        seen.frees.push(JSON.parse(body.toString() || "{}"));
        return send({});
      }
      if (url.pathname === "/interrupt") {
        seen.interrupts += 1;
        return send({});
      }
      if (url.pathname === "/history/p1") {
        polls += 1;
        if (polls <= finishAfter) return send({});
        if (failure) return send({ p1: { status: { status_str: "error", messages: [["execution_error", failure]] }, outputs: {} } });
        return send({ p1: { status: { status_str: "success" }, outputs } });
      }
      if (url.pathname === "/view") {
        const name = url.searchParams.get("filename");
        seen.views.push(name);
        if (!files[name]) return send({ error: "nope" }, 404);
        res.writeHead(200, { "content-type": "application/octet-stream" });
        return res.end(files[name]);
      }
      return send({}, 404);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}
