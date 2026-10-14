import MiniSearch from "minisearch";
import { parseResults } from "./parseResults";
import { keywordsOf } from "./query";
import type { Source } from "./types";

/** Une décision conservée dans la base locale. */
export interface StoredDecision {
  id: string;
  source: Source;
  title: string;
  url?: string;
  date?: string;
  numero?: string;
  fields: [string, string][];
  summary?: string;
  excerpt?: string;
  fullText?: string;
  /** Date d'ajout (ISO 8601). */
  savedAt: string;
}

export interface ScoredDecision extends StoredDecision {
  score: number;
}

/** Où la base est enregistrée : fichier JSON (serveur) ou IndexedDB (desktop). */
export interface Persistence {
  load(): Promise<string | null>;
  save(data: string): Promise<void>;
}

interface Snapshot {
  version: 1;
  decisions: StoredDecision[];
}

const MAX_FULLTEXT = 40_000;

function createIndex() {
  return new MiniSearch<StoredDecision>({
    fields: ["title", "summary", "excerpt", "fullText", "numero"],
    extractField: (doc, field) => (doc as unknown as Record<string, string | undefined>)[field] ?? "",
    // Même découpage que l'analyse des questions : sans accents ni mots vides.
    processTerm: (term) => {
      const [kw] = keywordsOf(term);
      return kw ?? null;
    },
    searchOptions: {
      boost: { title: 2, summary: 3, numero: 5 },
      prefix: (term) => term.length > 4,
      fuzzy: (term) => (term.length > 6 ? 0.15 : false),
    },
  });
}

/**
 * Base locale des décisions récupérées sur OpenLegi, avec index plein texte.
 * Elle s'enrichit à chaque recherche et reste consultable hors ligne.
 */
export class KnowledgeBase {
  private decisions = new Map<string, StoredDecision>();
  private index = createIndex();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  readonly ready: Promise<void>;

  constructor(private readonly persistence: Persistence) {
    this.ready = this.load();
  }

  get size(): number {
    return this.decisions.size;
  }

  private async load() {
    try {
      const raw = await this.persistence.load();
      if (!raw) return;
      const snapshot = JSON.parse(raw) as Snapshot;
      for (const d of snapshot.decisions ?? []) this.decisions.set(d.id, d);
      this.index.addAll([...this.decisions.values()]);
    } catch (err) {
      console.warn("Base locale illisible, elle repart à zéro :", err);
    }
  }

  /** Ajoute à la base les décisions contenues dans une réponse OpenLegi. */
  async addFromResults(source: Source, text: string): Promise<StoredDecision[]> {
    await this.ready;
    const added = parseResults(text).decisions.map((d) => {
      const previous = this.decisions.get(d.id);
      const decision: StoredDecision = {
        ...previous,
        id: d.id,
        source,
        title: d.title,
        url: d.url ?? previous?.url,
        date: d.date ?? previous?.date,
        numero: d.numero ?? previous?.numero,
        fields: d.fields.length ? d.fields : previous?.fields ?? [],
        summary: d.summary ?? previous?.summary,
        excerpt: d.excerpt ?? previous?.excerpt,
        fullText: d.fullText?.slice(0, MAX_FULLTEXT) ?? previous?.fullText,
        savedAt: previous?.savedAt ?? new Date().toISOString(),
      };
      this.decisions.set(decision.id, decision);
      if (this.index.has(decision.id)) this.index.replace(decision);
      else this.index.add(decision);
      return decision;
    });
    if (added.length) this.scheduleSave();
    return added;
  }

  /** Recherche plein texte dans la base locale. */
  async search(query: string, options: { limit?: number; sources?: Source[] } = {}): Promise<ScoredDecision[]> {
    await this.ready;
    const { sources } = options;
    const filter = sources?.length
      ? (r: { id: string }) => sources.includes(this.decisions.get(r.id)!.source)
      : undefined;
    // On exige d'abord tous les mots ; à défaut, on accepte n'importe lequel.
    let hits = this.index.search(query, { combineWith: "AND", filter });
    if (hits.length === 0) hits = this.index.search(query, { combineWith: "OR", filter });
    return hits.slice(0, options.limit ?? 20).map((h) => ({ ...this.decisions.get(h.id)!, score: h.score }));
  }

  get(id: string): StoredDecision | undefined {
    return this.decisions.get(id);
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const snapshot: Snapshot = { version: 1, decisions: [...this.decisions.values()] };
      this.persistence.save(JSON.stringify(snapshot)).catch((err) => console.error("Sauvegarde de la base impossible :", err));
    }, 1000);
  }

  /** Enregistre immédiatement (à appeler avant l'arrêt du processus). */
  async flush(): Promise<void> {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.persistence.save(JSON.stringify({ version: 1, decisions: [...this.decisions.values()] }));
  }
}

