/** Une décision extraite du texte renvoyé par les outils de recherche OpenLegi. */
export interface Decision {
  /** Identifiant Légifrance (ex. JURITEXT000051743650), ou à défaut le titre. */
  id: string;
  title: string;
  /** Date de la décision au format JJ/MM/AAAA. */
  date?: string;
  /** Numéro de pourvoi ou de requête. */
  numero?: string;
  url?: string;
  /** Métadonnées « clé : valeur » (juridiction, formation, solution…). */
  fields: [string, string][];
  summary?: string;
  /** Extrait du texte ; les termes recherchés sont entourés de `**`. */
  excerpt?: string;
  fullText?: string;
}

export interface ParsedResults {
  /** Ligne d'en-tête, ex. « 122404 résultats ». */
  total?: string;
  page?: number;
  pageCount?: number;
  decisions: Decision[];
}

const SEPARATOR = /^={5,}\s*$/;
/** En-tête d'une décision détaillée : « === JURISPRUDENCE 1 === », « === DECISION CETAT 1 === »… */
const DETAILED_HEADER = /^=== (?:JURISPRUDENCE|DECISION)\b[^=]*\d+ ===$/m;
/** Champs déjà présents dans le titre ou sans intérêt pour l'étudiant (comparés sans accents). */
const HIDDEN_FIELDS = new Set(["identifiant", "juridiction", "nature", "date de decision", "numero d'affaire", "recueil"]);

const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * OpenLegi renvoie du texte mis en forme, avec deux formats observés :
 * - détaillé : blocs « === JURISPRUDENCE n === » ou « === DECISION CETAT n === » ;
 * - panorama (administrative, constitutionnelle) : liste numérotée « n. titre ».
 * Si aucun format n'est reconnu, `decisions` est vide et l'appelant affiche le texte brut.
 */
export function parseResults(text: string): ParsedResults {
  const totalMatch = text.match(/\((\d[\d\s]*) r[ée]sultats/i);
  const total = totalMatch ? `${totalMatch[1].trim()} résultats` : undefined;
  const pages = text.match(/Page (\d+)\/(\d+)/);
  const raw = DETAILED_HEADER.test(text) ? parseDetailed(text) : parsePanorama(text);
  const decisions = raw.map(withIdentity);
  return { total, decisions, page: pages ? Number(pages[1]) : undefined, pageCount: pages ? Number(pages[2]) : undefined };
}

type RawDecision = Omit<Decision, "id">;

function withIdentity(d: RawDecision): Decision {
  const fromUrl = d.url?.match(/\/id\/([A-Z]+TEXT\d+)/)?.[1];
  // Titres du Conseil d'État : « nPublié au recueil Lebon », « n396116 ».
  const title = shortenNumbers(d.title.replace(/\bn(?=[A-ZÉ])/g, "").replace(/\bn(?=\d)/g, "n° "));
  const numero = title.match(/\bn[°o]\s*([0-9][\w.\-]*)/i)?.[1];
  return {
    ...d,
    title,
    id: fromUrl ?? d.title,
    date: d.title.match(/\b\d{2}\/\d{2}\/\d{4}\b/)?.[0],
    numero: numero?.replace(/[.\-]$/, ""),
  };
}

function parseDetailed(text: string): RawDecision[] {
  return text
    .split(new RegExp(DETAILED_HEADER.source, "gm"))
    .slice(1)
    .map((block) => {
      const lines = block.split("\n");
      const decision: RawDecision = { title: lines.find((l) => l.trim())?.trim() ?? "Décision", fields: [] };
      const fullTextAt = lines.findIndex((l) => /^Texte int[ée]gral\s*:/i.test(l));

      for (const line of fullTextAt >= 0 ? lines.slice(0, fullTextAt) : lines) {
        const field = line.match(/^[•*]\s*([^:]+):\s*(.+)$/);
        if (field) {
          const [, key, value] = field;
          const k = plain(key.trim());
          if (k === "lien legifrance") decision.url = value.trim();
          else if (!HIDDEN_FIELDS.has(k)) decision.fields.push([key.trim(), prettify(value.trim())]);
          continue;
        }
        const summary = line.match(/^R[ée]sum[ée](?: sommaire)?\s*:\s*(.+)$/i);
        if (summary && !decision.summary) decision.summary = summary[1].trim();
      }

      if (fullTextAt >= 0) {
        const sameLine = lines[fullTextAt].replace(/^Texte int[ée]gral\s*:\s*/i, "");
        const rest = [sameLine, ...lines.slice(fullTextAt + 1)];
        const end = rest.findIndex((l) => SEPARATOR.test(l));
        decision.fullText = (end >= 0 ? rest.slice(0, end) : rest).join("\n").trim() || undefined;
      }
      return decision;
    });
}

function parsePanorama(text: string): RawDecision[] {
  const decisions: RawDecision[] = [];
  let current: RawDecision | null = null;

  for (const line of text.split("\n")) {
    const head = line.match(/^(\d+)\.\s+(.+)$/);
    if (head) {
      current = { title: head[2].trim(), fields: [] };
      decisions.push(current);
      continue;
    }
    if (!current || !/^\s+\S/.test(line)) continue;
    const content = line.trim();
    const url = content.match(/^(?:->|→)\s*(https?:\/\/\S+)/);
    const labelled = content.match(/^(Resume|Résumé|Titre|Extrait|Textes cités):\s*(.+)$/);
    if (url) current.url = url[1];
    else if (labelled?.[1] === "Extrait") current.excerpt = labelled[2];
    else if (labelled?.[1] === "Textes cités") current.fields.push(["Textes cités", labelled[2]]);
    else if (labelled) current.summary = labelled[2];
  }
  return decisions;
}

/** « n° 17-24.879, 17-24.880, … » (arrêts joints) → « n° 17-24.879 et 40 autres ». */
function shortenNumbers(title: string): string {
  return title.replace(/(n[°o]\s*[\w.\-]+)((?:,\s*[\w.\-]+)+)/i, (_, first: string, rest: string) => {
    const others = rest.split(",").filter((x) => x.trim()).length;
    return others > 1 ? `${first} et ${others} autres` : first + rest;
  });
}

/** « CHAMBRE_CIVILE_1 » → « Chambre civile 1 ». */
function prettify(value: string): string {
  if (!/^[A-Z0-9_]+$/.test(value) || !value.includes("_")) return value;
  const words = value.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
