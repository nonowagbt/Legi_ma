import type { OpenLegiClient } from "./openlegi";

/** Codes mis en avant dans l'interface. */
export const MAIN_CODES = ["Code civil", "Code de commerce"] as const;
/** Autres codes proposés (noms exacts attendus par Légifrance). */
export const OTHER_CODES = [
  "Code du travail",
  "Code pénal",
  "Code de procédure civile",
  "Code de procédure pénale",
  "Code de la consommation",
  "Code de la propriété intellectuelle",
  "Code de la sécurité sociale",
  "Code monétaire et financier",
  "Code de justice administrative",
  "Code général des collectivités territoriales",
] as const;
export const CODES = [...MAIN_CODES, ...OTHER_CODES] as const;
export type CodeName = (typeof CODES)[number];

/** « L145-9 » + « Code de commerce » → « article L. 145-9 du code de commerce ». */
export function articleReference(numero: string, code: CodeName): string {
  const formatted = numero.replace(/^([LRDA])\*?(?=\d)/, "$1. ");
  return `article ${formatted} du ${code.charAt(0).toLowerCase()}${code.slice(1)}`;
}

export interface CodeSearchParams {
  code: CodeName;
  /** Mots-clés, ou numéro d'article (« 1240 », « L. 142-1 », « article 1103 »). */
  search: string;
  page?: number;
}

export interface Article {
  id: string;
  /** Ex. « L142-1 ». */
  numero: string;
  /** Section parente, ex. « Chapitre Ier : La responsabilité extracontractuelle en général ». */
  section?: string;
  /** Chemin complet dans le code (livres, titres, chapitres). */
  path: string[];
  inForce: boolean;
  /** Libellé brut de l'état (VIGUEUR, ABROGE…). */
  state?: string;
  since?: string;
  url?: string;
  text: string;
  notes?: string;
}

export interface ArticleResults {
  articles: Article[];
  total?: number;
  page?: number;
  pageCount?: number;
}

const PAGE_SIZE = 10;
const ARTICLE_NUMBER = /^(?:art(?:icle)?\.?\s*)?([LRDA]\*?\.?\s*)?(\d+(?:\s*[-–]\s*\d+)*)$/i;

/** « article L. 142-1 » → « L142-1 » ; renvoie null si ce n'est pas un numéro d'article. */
export function articleNumber(search: string): string | null {
  const m = search.trim().match(ARTICLE_NUMBER);
  if (!m) return null;
  const prefix = (m[1] ?? "").replace(/[.\s]/g, "").toUpperCase();
  return prefix + m[2].replace(/\s/g, "").replace("–", "-");
}

export async function searchCode(client: OpenLegiClient, params: CodeSearchParams): Promise<ArticleResults> {
  const numero = articleNumber(params.search);
  const result = await client.callTool("rechercher_code", {
    code_name: params.code,
    search: numero ?? params.search,
    champ: numero ? "NUM_ARTICLE" : "ALL",
    page_number: params.page ?? 1,
    page_size: PAGE_SIZE,
  });
  if (result.isError) throw new Error(result.text || "OpenLegi a renvoyé une erreur.");
  return parseArticles(result.text);
}

const decode = (s: string) =>
  s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** Découpe la réponse texte de `rechercher_code` (blocs « === ARTICLE CODE n === »). */
export function parseArticles(text: string): ArticleResults {
  const header = text.match(/Page (\d+)\/(\d+) \((\d+) article/);
  const articles = text
    .split(/^=== ARTICLE CODE \d+ ===$/m)
    .slice(1)
    .map((block): Article => {
      const lines = block.split("\n");
      const field = (name: string) =>
        lines.find((l) => l.startsWith(`• ${name}:`))?.slice(name.length + 3).trim() || undefined;
      const title = lines.find((l) => l.trim())?.trim() ?? "";

      const start = lines.findIndex((l) => l.startsWith("Texte de l'article:"));
      const body: string[] = [];
      let notes: string | undefined;
      for (const line of start >= 0 ? lines.slice(start + 1) : []) {
        if (/^ARTICLES CIT|^={5,}/.test(line)) break;
        if (line.startsWith("Notes:")) notes = line.slice(6).trim();
        else if (notes !== undefined) notes += "\n" + line;
        else body.push(line);
      }

      const state = field("État juridique");
      return {
        id: field("Identifiant article") ?? title,
        numero: field("Numéro article") ?? title.match(/^Article (\S+)/)?.[1] ?? "",
        section: field("Section parente") && decode(field("Section parente")!),
        path: decode(field("Chemin complet") ?? "")
          .split(">")
          .map((s) => s.trim())
          .filter(Boolean),
        inForce: state === "VIGUEUR",
        state,
        since: field("Date début vigueur"),
        url: field("Lien article Légifrance"),
        text: decode(body.join("\n").trim()),
        notes: notes?.trim() || undefined,
      };
    });
  return {
    articles,
    page: header ? Number(header[1]) : undefined,
    pageCount: header ? Number(header[2]) : undefined,
    total: header ? Number(header[3]) : undefined,
  };
}
