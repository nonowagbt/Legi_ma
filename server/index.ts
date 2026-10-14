import "dotenv/config";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { join } from "node:path";
import { z } from "zod";
import { ask } from "../src/core/assistant";
import { CODES, searchCode } from "../src/core/codes";
import { KnowledgeBase } from "../src/core/knowledge";
import { askLocal } from "../src/core/localAssistant";
import { isCloud, ollamaConfig, ollamaStatus } from "../src/core/ollama";
import { OpenLegiClient, searchDecisions } from "../src/core/openlegi";
import { JURIDICTIONS_JUDICIAIRES, type BackendStatus, type ChatMessage } from "../src/core/types";
import { filePersistence } from "./filePersistence";

const { OPENLEGI_TOKEN = "", ANTHROPIC_API_KEY = "", APP_ACCESS_CODE = "" } = process.env;
const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.DATA_DIR ?? "data";
// Ollama Cloud si OLLAMA_API_KEY est défini, sinon Ollama installé localement.
const ollama = ollamaConfig({
  apiKey: process.env.OLLAMA_API_KEY,
  cloudModel: process.env.OLLAMA_CLOUD_MODEL,
  localUrl: process.env.OLLAMA_URL,
  localModel: process.env.OLLAMA_MODEL,
});

const openlegi = new OpenLegiClient(OPENLEGI_TOKEN);
const kb = new KnowledgeBase(filePersistence(join(DATA_DIR, "decisions.json")));

const searchSchema = z.object({
  source: z.enum(["judiciaire", "administrative", "constitutionnelle"]),
  search: z.string().trim().min(1).max(500),
  page: z.number().int().min(1).max(10000).optional(),
  juridictions: z.array(z.enum(JURIDICTIONS_JUDICIAIRES)).optional(),
  bulletinOnly: z.boolean().optional(),
  sort: z.enum(["PERTINENCE", "DATE_ASC", "DATE_DESC"]).optional(),
  champ: z.enum(["ALL", "TITLE", "ABSTRACTS", "TEXTE", "NUM_AFFAIRE"]).optional(),
});

const askSchema = z.object({
  engine: z.enum(["local", "claude"]).default("local"),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.unknown() }))
    .min(1)
    .max(100),
});

const app = new Hono();

app.use("/api/*", async (c, next) => {
  if (c.req.path !== "/api/status" && APP_ACCESS_CODE && c.req.header("x-access-code") !== APP_ACCESS_CODE) {
    return c.json({ error: "Code d'accès invalide." }, 401);
  }
  await next();
});

app.get("/api/status", async (c) => {
  await kb.ready;
  const o = await ollamaStatus(ollama);
  const status: BackendStatus = {
    ready: !!OPENLEGI_TOKEN,
    missing: OPENLEGI_TOKEN ? [] : ["OPENLEGI_TOKEN"],
    needsAccessCode: !!APP_ACCESS_CODE && c.req.header("x-access-code") !== APP_ACCESS_CODE,
    claudeAvailable: !!ANTHROPIC_API_KEY,
    ollama: { available: o.available, model: ollama.model, cloud: isCloud(ollama), reason: o.available ? undefined : o.reason },
    kbSize: kb.size,
  };
  return c.json(status);
});

app.post("/api/search", async (c) => {
  const parsed = searchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Requête invalide." }, 400);
  try {
    const result = await searchDecisions(openlegi, parsed.data);
    if (!result.isError) await kb.addFromResults(parsed.data.source, result.text);
    return c.json(result);
  } catch (err) {
    console.error("search", err);
    const message = err instanceof Error && /OpenLegi/.test(err.message) ? err.message : "OpenLegi est injoignable.";
    return c.json({ error: message }, 502);
  }
});

app.post("/api/code-search", async (c) => {
  const schema = z.object({
    code: z.enum(CODES),
    search: z.string().trim().min(1).max(300),
    page: z.number().int().min(1).max(10000).optional(),
  });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Requête invalide." }, 400);
  try {
    return c.json(await searchCode(openlegi, parsed.data));
  } catch (err) {
    console.error("code-search", err);
    const message = err instanceof Error && /OpenLegi/.test(err.message) ? err.message : "OpenLegi est injoignable.";
    return c.json({ error: message }, 502);
  }
});

app.post("/api/local-search", async (c) => {
  const parsed = z.object({ query: z.string().trim().min(1).max(500) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Requête invalide." }, 400);
  return c.json(await kb.search(parsed.data.query, { limit: 30 }));
});

app.post("/api/ask", async (c) => {
  const parsed = askSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Requête invalide." }, 400);
  const history = parsed.data.history as ChatMessage[];
  const { engine } = parsed.data;

  c.header("Content-Type", "application/x-ndjson; charset=utf-8");
  return stream(c, async (out) => {
    const controller = new AbortController();
    out.onAbort(() => controller.abort());
    const send = (event: object) => void out.write(JSON.stringify(event) + "\n");
    if (engine === "claude") {
      await ask({ anthropicApiKey: ANTHROPIC_API_KEY, openlegiToken: OPENLEGI_TOKEN }, history, send, controller.signal);
    } else {
      await askLocal({ openlegi, kb, ollama }, history, send, controller.signal);
    }
  });
});

// En production, le même serveur sert l'interface compilée par Vite.
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Legi web : http://localhost:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void kb.flush().finally(() => process.exit(0));
  });
}
