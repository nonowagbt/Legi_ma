import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { get, set } from "idb-keyval";
import { ask } from "../core/assistant";
import { searchCode } from "../core/codes";
import { KnowledgeBase } from "../core/knowledge";
import { askLocal } from "../core/localAssistant";
import { isCloud, ollamaConfig, ollamaStatus } from "../core/ollama";
import { OpenLegiClient, searchDecisions } from "../core/openlegi";
import type { Backend } from "../core/types";
import { loadSettings } from "./settings";

/**
 * Version desktop : les appels partent du processus natif de Tauri,
 * ce qui contourne le CORS d'OpenLegi. Les clés viennent des Paramètres,
 * la base locale est enregistrée dans IndexedDB.
 */
export function createDesktopBackend(): Backend {
  const kb = new KnowledgeBase({
    load: async () => (await get<string>("legi.decisions")) ?? null,
    save: (data) => set("legi.decisions", data),
  });

  let client: OpenLegiClient | null = null;
  let clientToken = "";
  const openlegi = () => {
    const { openlegiToken } = loadSettings();
    if (!client || clientToken !== openlegiToken) {
      void client?.close();
      client = new OpenLegiClient(openlegiToken, tauriFetch);
      clientToken = openlegiToken;
    }
    return client;
  };
  const ollama = () => {
    const s = loadSettings();
    return ollamaConfig({ apiKey: s.ollamaApiKey, localUrl: s.ollamaUrl, localModel: s.ollamaModel, fetch: tauriFetch });
  };

  return {
    kind: "desktop",
    async status() {
      const s = loadSettings();
      await kb.ready;
      const config = ollama();
      const o = await ollamaStatus(config);
      return {
        ready: !!s.openlegiToken,
        missing: s.openlegiToken ? [] : ["jeton OpenLegi"],
        claudeAvailable: !!s.anthropicApiKey,
        ollama: { available: o.available, model: config.model, cloud: isCloud(config), reason: o.available ? undefined : o.reason },
        kbSize: kb.size,
      };
    },
    async search(params) {
      const result = await searchDecisions(openlegi(), params);
      if (!result.isError) await kb.addFromResults(params.source, result.text);
      return result;
    },
    searchCode: (params) => searchCode(openlegi(), params),
    searchLocal: (query) => kb.search(query, { limit: 30 }),
    ask(history, engine, onEvent, signal) {
      if (engine === "local") return askLocal({ openlegi: openlegi(), kb, ollama: ollama() }, history, onEvent, signal);
      const s = loadSettings();
      return ask(
        { anthropicApiKey: s.anthropicApiKey, openlegiToken: s.openlegiToken, fetch: tauriFetch, dangerouslyAllowBrowser: true },
        history,
        onEvent,
        signal,
      );
    },
  };
}
