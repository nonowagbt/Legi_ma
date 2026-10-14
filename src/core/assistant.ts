import Anthropic from "@anthropic-ai/sdk";
import { normalizeToken, OPENLEGI_MCP_URL } from "./openlegi";
import type { AssistantEvent, ChatMessage, FetchLike } from "./types";

export const MODEL = "claude-opus-5-5";
const MCP_SERVER_NAME = "openlegi";
/** Nombre maximal de relances quand l'API met le tour en pause (outils longs). */
const MAX_CONTINUATIONS = 5;

const SYSTEM_PROMPT = `Tu es Legi, un assistant de recherche juridique pour les étudiants en droit français.
Tu as accès aux outils OpenLegi, qui interrogent Légifrance : jurisprudence judiciaire et administrative, décisions du Conseil constitutionnel, codes, textes consolidés, Journal officiel, décisions CNIL et conventions collectives.

Méthode :
- Pour toute question de droit, cherche les sources avec les outils avant de répondre. Ne te fie pas à ta seule mémoire pour citer une décision ou un article.
- Pour retrouver une décision précise à partir de son numéro, utilise le champ NUM_AFFAIRE.
- Pour présenter l'état du droit, privilégie les arrêts publiés au Bulletin et signale les revirements de jurisprudence que tu trouves.

Réponse :
- Commence par une réponse courte, puis développe : principe, arrêts clés et leur apport, textes applicables.
- Cite chaque décision avec la juridiction, la chambre ou formation, la date, le numéro de pourvoi ou de requête et le lien Légifrance fourni par l'outil.
- N'invente jamais de référence. Si tes recherches ne donnent rien de pertinent, dis-le et propose d'autres pistes de recherche.
- Termine par la liste des sources consultées, en rappelant de les vérifier sur Légifrance avant de les citer.
- Réponds en français, en Markdown.`;

export interface AssistantConfig {
  anthropicApiKey: string;
  openlegiToken: string;
  /** Implémentation de fetch à utiliser (celle de Tauri sur desktop). */
  fetch?: FetchLike;
  /** Nécessaire quand le SDK tourne dans une webview (desktop). */
  dangerouslyAllowBrowser?: boolean;
}

/**
 * Pose la question (dernier message de `history`) à Claude, qui interroge
 * OpenLegi via le connecteur MCP de l'API, et diffuse la réponse via `onEvent`.
 */
export async function ask(
  config: AssistantConfig,
  history: ChatMessage[],
  onEvent: (e: AssistantEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!config.anthropicApiKey) return onEvent({ type: "error", message: "Clé API Anthropic manquante." });
  if (!config.openlegiToken) return onEvent({ type: "error", message: "Jeton OpenLegi manquant." });

  const client = new Anthropic({
    apiKey: config.anthropicApiKey,
    fetch: config.fetch,
    dangerouslyAllowBrowser: config.dangerouslyAllowBrowser,
  });

  const produced: ChatMessage[] = [];
  try {
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      const stream = client.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 64000,
          betas: ["mcp-client-2025-11-20", "server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          system: SYSTEM_PROMPT,
          mcp_servers: [
            {
              type: "url",
              url: OPENLEGI_MCP_URL,
              name: MCP_SERVER_NAME,
              authorization_token: normalizeToken(config.openlegiToken),
            },
          ],
          tools: [{ type: "mcp_toolset", mcp_server_name: MCP_SERVER_NAME }],
          messages: [...history, ...produced],
        },
        { signal },
      );

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const block = event.content_block;
          if (block.type === "mcp_tool_use") onEvent({ type: "tool_call", name: block.name });
          else if (block.type === "mcp_tool_result") onEvent({ type: "tool_result", isError: block.is_error });
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          onEvent({ type: "text", text: event.delta.text });
        }
      }

      const message = await stream.finalMessage();
      produced.push({ role: "assistant", content: message.content as ChatMessage["content"] });

      if (message.stop_reason === "refusal") {
        onEvent({ type: "error", message: "La demande a été refusée par le modèle." });
        break;
      }
      if (message.stop_reason !== "pause_turn") break;
    }
    onEvent({ type: "done", messages: produced });
  } catch (err) {
    if (signal?.aborted) return;
    onEvent({ type: "error", message: describeError(err) });
  }
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Clé API Anthropic invalide.";
  if (err instanceof Anthropic.RateLimitError) return "Limite de requêtes atteinte, réessayez dans un instant.";
  if (err instanceof Anthropic.APIError) return `Erreur de l'API Claude (${err.status ?? "réseau"}) : ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
