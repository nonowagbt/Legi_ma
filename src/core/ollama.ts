import type { FetchLike } from "./types";

/**
 * IA servie par Ollama (https://ollama.com) : en local sur la machine, ou via
 * Ollama Cloud quand une clé API est fournie.
 */
export interface OllamaConfig {
  url: string;
  model: string;
  /** Clé Ollama Cloud, envoyée en `Authorization: Bearer` (jamais nécessaire en local). */
  apiKey?: string;
  fetch?: FetchLike;
}

export const OLLAMA_DEFAULTS = { url: "http://localhost:11434", model: "qwen2.5:3b" };
/** gemma4:31b est inclus dans l'offre gratuite d'Ollama Cloud. */
export const OLLAMA_CLOUD_DEFAULTS = { url: "https://ollama.com", model: "gemma4:31b" };

/** Configuration cloud si une clé est fournie, locale sinon. */
export function ollamaConfig(options: { apiKey?: string; localUrl?: string; localModel?: string; cloudModel?: string; fetch?: FetchLike }): OllamaConfig {
  const apiKey = options.apiKey?.trim();
  return apiKey
    ? { url: OLLAMA_CLOUD_DEFAULTS.url, model: options.cloudModel || OLLAMA_CLOUD_DEFAULTS.model, apiKey, fetch: options.fetch }
    : { url: options.localUrl || OLLAMA_DEFAULTS.url, model: options.localModel || OLLAMA_DEFAULTS.model, fetch: options.fetch };
}

export const isCloud = (config: OllamaConfig) => !!config.apiKey;

function authHeaders(config: OllamaConfig): Record<string, string> {
  return config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
}

/** Message d'erreur lisible selon le code HTTP renvoyé par Ollama. */
function httpError(status: number, model: string): string {
  switch (status) {
    case 401:
      return "Clé Ollama invalide ou manquante.";
    case 402:
      return `Le modèle ${model} n'est pas inclus dans votre offre Ollama.`;
    case 404:
      return `Modèle Ollama introuvable : ${model}.`;
    case 429:
      return "Limite d'utilisation Ollama atteinte, réessayez plus tard.";
    default:
      return `Ollama a renvoyé une erreur (${status}).`;
  }
}

export type OllamaStatus = { available: true } | { available: false; reason: string };

export async function ollamaStatus(config: OllamaConfig): Promise<OllamaStatus> {
  const doFetch = config.fetch ?? fetch;
  try {
    const res = await doFetch(`${config.url}/api/tags`, {
      headers: authHeaders(config),
      signal: AbortSignal.timeout(isCloud(config) ? 5000 : 1500),
    });
    if (!res.ok) return { available: false, reason: httpError(res.status, config.model) };
    const { models = [] } = (await res.json()) as { models?: { name: string }[] };
    const wanted = config.model.includes(":") ? config.model : `${config.model}:latest`;
    if (!models.some((m) => m.name === wanted || m.name === config.model)) {
      return {
        available: false,
        reason: isCloud(config)
          ? `Modèle ${config.model} absent du catalogue Ollama Cloud.`
          : `Modèle absent : lancez « ollama pull ${config.model} ».`,
      };
    }
    return { available: true };
  } catch {
    return { available: false, reason: isCloud(config) ? "Ollama Cloud est injoignable." : "Ollama n'est pas lancé." };
  }
}

/** Génère une réponse en flux ; renvoie le texte complet. */
export async function ollamaChat(
  config: OllamaConfig,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const doFetch = config.fetch ?? fetch;
  const res = await doFetch(`${config.url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(config) },
    body: JSON.stringify({ model: config.model, messages, stream: true, options: { temperature: 0.2 } }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(httpError(res.status, config.model));

  // Réponse en NDJSON : {"message":{"content":"…"},"done":false} par ligne.
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let full = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string };
      if (chunk.error) throw new Error(`Ollama : ${chunk.error}`);
      const text = chunk.message?.content ?? "";
      if (text) {
        full += text;
        onText(text);
      }
    }
  }
  return full;
}
