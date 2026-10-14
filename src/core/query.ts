import type { SearchParams, Source } from "./types";

/** Minuscules, sans accents ni apostrophes typographiques. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`]/g, "'");
}

/**
 * Mots sans valeur pour la recherche : mots outils du français et formules
 * habituelles des questions d'étudiants (« quelle est la jurisprudence sur… »).
 */
const STOPWORDS = new Set(
  normalize(
    `a à au aux avec ce ces cet cette d' dans de des du elle en et eux il ils je l' la le les leur leurs lui ma mais me même mes moi mon ne nos notre nous on ou où par pas pour qu' que qui quoi sa se ses si son sont sur ta te tes toi ton tu un une vos votre vous y c' j' m' n' s' t' est sont été être avoir ont a-t-il peut peuvent doit doivent fait faire
     quel quelle quels quelles comment pourquoi quand combien lequel laquelle lesquels lesquelles
     jurisprudence jurisprudences arrêt arrêts arret arrets décision décisions decision decisions principe principes
     droit français française récent récente récents récentes dernier dernière derniers dernières
     explique expliquer explique-moi donne donner donne-moi cite citer trouve trouver retrouve retrouver cherche chercher résume résumer
     moi svp merci bonjour stp concernant matière question selon entre tout tous toute toutes plus moins très bien
     cour cassation conseil état constitutionnel juridiction juridictions chambre qpc`,
  ).split(/\s+/),
);

const ADMINISTRATIVE = /conseil d'?etat|\bcaa\b|cour administrative|tribunal administratif|administratif|administrative|puissance publique|refere-liberte|recours pour exces|service public/;
const CONSTITUTIONNELLE = /conseil constitutionnel|\bqpc\b|question prioritaire|constitutionnalite|constitution\b/;
const POURVOI = /\b\d{2}-\d{2}\.\d{3}\b/;
const REQUETE = /\bn[°o]?\s*(\d{6})\b/;

export interface QueryPlan {
  keywords: string[];
  /** Recherches OpenLegi à lancer pour cette question. */
  searches: SearchParams[];
}

/** Mots significatifs d'un texte, en minuscules mais avec leurs accents. */
export function searchTermsOf(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}0-9'.\- ]/gu, " ")
    .split(/[\s']+/)
    .map((w) => w.replace(/^[.\-]+|[.\-]+$/g, ""))
    .filter((w) => w.length > 2 && !STOPWORDS.has(normalize(w)));
  return [...new Set(words)];
}

/** Mots significatifs normalisés (sans accents), pour comparer des textes. */
export function keywordsOf(text: string): string[] {
  return [...new Set(searchTermsOf(text).map(normalize))];
}

/** Transforme une question en recherches OpenLegi. */
export function planQuery(question: string): QueryPlan {
  const q = normalize(question);
  const keywords = keywordsOf(question);
  const search = searchTermsOf(question).join(" ") || question.trim();

  const pourvoi = question.match(POURVOI);
  if (pourvoi) {
    return { keywords, searches: [{ source: "judiciaire", search: pourvoi[0], champ: "NUM_AFFAIRE" }] };
  }

  const sources: Source[] = [];
  if (CONSTITUTIONNELLE.test(q)) sources.push("constitutionnelle");
  if (ADMINISTRATIVE.test(q)) sources.push("administrative");
  if (sources.length === 0 || /cassation|judiciaire|civil|penal|social|commercial/.test(q)) sources.unshift("judiciaire");

  const requete = q.match(REQUETE);
  const recent = /recent|dernier|actuel|nouveau|2[0-9]{3}/.test(q);
  const principle = /principe|bulletin|celebre|grand arret|fondateur|important/.test(q);

  const searches = sources.map<SearchParams>((source) =>
    source === "judiciaire"
      ? {
          source,
          search,
          sort: recent ? "DATE_DESC" : "PERTINENCE",
          bulletinOnly: principle || undefined,
          juridictions: /appel/.test(q) ? undefined : ["Cour de cassation"],
        }
      : { source, search: source === "administrative" && requete ? requete[1] : search },
  );
  return { keywords, searches };
}

/** Phrases d'un texte classées selon le nombre de mots-clés qu'elles contiennent. */
export function bestSentences(text: string, keywords: string[], max = 2, maxLength = 420, minScore = 1): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.;!?])\s+(?=[A-ZÀ-Ý«"])/)
    .filter((s) => s.length > 30);
  const stems = keywords.map((k) => k.slice(0, Math.max(4, k.length - 2)));
  return sentences
    .map((s, i) => {
      const n = normalize(s);
      return { s, i, score: stems.reduce((acc, k) => acc + (n.includes(k) ? 1 : 0), 0) };
    })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map(({ s }) => (s.length > maxLength ? s.slice(0, maxLength).replace(/\s\S*$/, "") + "…" : s));
}
