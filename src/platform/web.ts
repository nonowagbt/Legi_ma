import type { ArticleResults } from "../core/codes";
import type { StoredDecision } from "../core/knowledge";
import type { AssistantEvent, Backend, BackendStatus, SearchResult } from "../core/types";
import { loadAccessCode } from "./settings";

/** Version web : tout passe par le serveur (server/index.ts), qui détient les clés. */
export function createWebBackend(): Backend {
  const headers = () => ({ "Content-Type": "application/json", "X-Access-Code": loadAccessCode() });

  async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const res = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body), signal });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `Erreur serveur (${res.status})`);
    }
    return res;
  }

  return {
    kind: "web",
    async status() {
      const res = await fetch("/api/status", { headers: headers() }).catch(() => null);
      if (!res?.ok || !res.headers.get("content-type")?.includes("json")) {
        throw new Error("Serveur API injoignable. En développement, lancez « npm run dev:web » (et non « npm run dev »).");
      }
      return (await res.json()) as BackendStatus;
    },
    async search(params) {
      const res = await post("/api/search", params);
      return (await res.json()) as SearchResult;
    },
    async searchCode(params) {
      const res = await post("/api/code-search", params);
      return (await res.json()) as ArticleResults;
    },
    async searchLocal(query) {
      const res = await post("/api/local-search", { query });
      return (await res.json()) as StoredDecision[];
    },
    async ask(history, engine, onEvent, signal) {
      try {
        const res = await post("/api/ask", { history, engine }, signal);
        // Réponse en NDJSON : un AssistantEvent par ligne.
        const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as AssistantEvent);
        }
      } catch (err) {
        if (signal?.aborted) return;
        onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
