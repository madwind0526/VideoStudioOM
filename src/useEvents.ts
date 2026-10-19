import { useEffect, useRef, useState } from "react";

export interface FileChange {
  project: string;
  path: string;
}

/** Subscribes to /api/events. Returns whether the stream is currently connected. */
export function useEvents(onFile: (change: FileChange) => void, onJob?: () => void): boolean {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onFile);
  handler.current = onFile;
  const jobHandler = useRef(onJob);
  jobHandler.current = onJob;

  useEffect(() => {
    // EventSource reconnects on its own; "hello" fires again after each reconnect.
    const source = new EventSource("/api/events");
    source.addEventListener("hello", () => setConnected(true));
    source.addEventListener("file", (event) => handler.current(JSON.parse((event as MessageEvent<string>).data)));
    source.addEventListener("job", () => jobHandler.current?.());
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, []);

  return connected;
}
