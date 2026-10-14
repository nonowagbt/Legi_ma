import type Anthropic from "@anthropic-ai/sdk";
import type { ArticleResults, CodeSearchParams } from "./codes";
import type { StoredDecision } from "./knowledge";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type Source = "judiciaire" | "administrative" | "constitutionnelle";

export const JURIDICTIONS_JUDICIAIRES = [
  "Cour de cassation",
  "Juridictions d'appel",
  "Juridictions du premier degré",
] as const;

export interface SearchParams {
  source: Source;
  search: string;
  /** Page de résultats (OpenLegi renvoie 7 décisions par page). */
  page?: number;
  /** Filtres propres à la jurisprudence judiciaire. */
  juridictions?: string[];
  bulletinOnly?: boolean;
  sort?: "PERTINENCE" | "DATE_ASC" | "DATE_DESC";
  champ?: "ALL" | "TITLE" | "ABSTRACTS" | "TEXTE" | "NUM_AFFAIRE";
}

export interface SearchResult {
  text: string;
  isError: boolean;
}

/** Un tour de conversation, tel qu'il est renvoyé à l'API Claude. */
export type ChatMessage = Anthropic.Beta.Messages.BetaMessageParam;

/** Événements diffusés pendant qu'une réponse de l'assistant est générée. */
export type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string }
  | { type: "tool_result"; isError: boolean }
  /** Messages assistant à ajouter tels quels à l'historique. */
  | { type: "done"; messages: ChatMessage[] }
  | { type: "error"; message: string };

/** « local » : assistant gratuit (base locale + Ollama facultatif) ; « claude » : API Claude, payante. */
export type Engine = "local" | "claude";

export interface BackendStatus {
  /** Vrai si OpenLegi est configuré (seul prérequis). */
  ready: boolean;
  missing: string[];
  needsAccessCode?: boolean;
  claudeAvailable: boolean;
  ollama: { available: boolean; model: string; cloud: boolean; reason?: string };
  /** Nombre de décisions dans la base locale. */
  kbSize: number;
}

export interface Backend {
  kind: "desktop" | "web";
  status(): Promise<BackendStatus>;
  /** Recherche sur Légifrance ; les décisions trouvées rejoignent la base locale. */
  search(params: SearchParams): Promise<SearchResult>;
  /** Recherche d'articles dans le Code civil ou le Code de commerce. */
  searchCode(params: CodeSearchParams): Promise<ArticleResults>;
  /** Recherche hors ligne dans la base locale. */
  searchLocal(query: string): Promise<StoredDecision[]>;
  ask(
    history: ChatMessage[],
    engine: Engine,
    onEvent: (e: AssistantEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}
