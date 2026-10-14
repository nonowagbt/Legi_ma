import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike, SearchParams, SearchResult } from "./types";

/** Serveur MCP OpenLegi exposant les outils Légifrance. */
export const OPENLEGI_MCP_URL = "https://mcp.openlegi.fr/legifrance/mcp";

/**
 * Accepte le jeton seul ou l'URL de connecteur copiée depuis la console OpenLegi
 * (`…/mcp?token=XXX` ou `…/mcp/token/XXX`) et renvoie le jeton.
 */
export function normalizeToken(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/[?&]token=([^&#\s]+)/) ?? trimmed.match(/\/token\/([^/?#\s]+)/);
  return match ? decodeURIComponent(match[1]) : trimmed;
}

const TOOL_BY_SOURCE: Record<SearchParams["source"], string> = {
  judiciaire: "rechercher_jurisprudence_judiciaire",
  administrative: "rechercher_jurisprudence_administrative",
  constitutionnelle: "rechercher_decisions_constitutionnelles",
};

/**
 * Client MCP OpenLegi. La session est ouverte à la première requête puis
 * réutilisée ; elle est recréée automatiquement si le serveur l'a fermée.
 */
export class OpenLegiClient {
  private client: Promise<Client> | null = null;
  private readonly token: string;

  constructor(
    token: string,
    private readonly fetchImpl?: FetchLike,
  ) {
    this.token = normalizeToken(token);
  }

  private connect(): Promise<Client> {
    if (!this.client) {
      const transport = new StreamableHTTPClientTransport(new URL(OPENLEGI_MCP_URL), {
        fetch: this.fetchImpl,
        requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
      });
      const client = new Client({ name: "legi", version: "0.1.0" });
      this.client = client.connect(transport).then(
        () => client,
        (err) => {
          this.client = null;
          throw err;
        },
      );
    }
    return this.client;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<SearchResult> {
    if (!this.token) throw new Error("Jeton OpenLegi manquant.");
    const hadSession = this.client !== null;
    try {
      return await this.callOnce(name, args);
    } catch (err) {
      if (!hadSession || isUnauthorized(err)) throw friendlyError(err);
      // Session expirée côté serveur : on retente une fois avec une session neuve.
      await this.close();
      return this.callOnce(name, args).catch((e) => Promise.reject(friendlyError(e)));
    }
  }

  private async callOnce(name: string, args: Record<string, unknown>): Promise<SearchResult> {
    const client = await this.connect();
    const result = await client.callTool({ name, arguments: args });
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .map((item) => (item.type === "text" ? item.text : ""))
      .filter(Boolean)
      .join("\n\n");
    return { text, isError: result.isError === true };
  }

  async listTools(): Promise<string[]> {
    if (!this.token) throw new Error("Jeton OpenLegi manquant (OPENLEGI_TOKEN dans .env).");
    const client = await this.connect().catch((e) => Promise.reject(friendlyError(e)));
    const { tools } = await client.listTools();
    return tools.map((t) => t.name);
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) await client.then((c) => c.close()).catch(() => {});
  }
}

function isUnauthorized(err: unknown): boolean {
  return (err as { code?: unknown })?.code === 401;
}

function friendlyError(err: unknown): Error {
  if (isUnauthorized(err)) return new Error("Jeton OpenLegi invalide ou expiré.");
  if ((err as { code?: unknown })?.code === 429) return new Error("Quota OpenLegi atteint, réessayez plus tard.");
  return err instanceof Error ? err : new Error(String(err));
}

export function toolNameFor(source: SearchParams["source"]): string {
  return TOOL_BY_SOURCE[source];
}

/** Traduit les paramètres du formulaire en appel d'outil OpenLegi. */
export function searchDecisions(client: OpenLegiClient, params: SearchParams): Promise<SearchResult> {
  const args: Record<string, unknown> = { search: params.search };
  if (params.page && params.page > 1) args.page_number = params.page;
  if (params.source === "judiciaire") {
    if (params.juridictions?.length) args.juridiction_judiciaire = params.juridictions;
    if (params.bulletinOnly) args.publication_bulletin = ["T"];
    if (params.sort) args.sort = params.sort;
    if (params.champ) args.champ = params.champ;
  }
  return client.callTool(TOOL_BY_SOURCE[params.source], args);
}
