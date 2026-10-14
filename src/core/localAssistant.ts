import type { KnowledgeBase, StoredDecision } from "./knowledge";
import { ollamaChat, ollamaStatus, type OllamaConfig } from "./ollama";
import { OpenLegiClient, searchDecisions, toolNameFor } from "./openlegi";
import { bestSentences, planQuery } from "./query";
import type { AssistantEvent, ChatMessage } from "./types";

export interface LocalAssistantDeps {
  openlegi: OpenLegiClient;
  kb: KnowledgeBase;
  /** IA locale facultative : sans elle, la réponse est composée d'extraits. */
  ollama?: OllamaConfig;
}

const MAX_DECISIONS = 5;

/**
 * Assistant gratuit : interroge OpenLegi, enrichit la base locale, puis
 * répond à partir des décisions les plus pertinentes — rédigé par Ollama
 * s'il est disponible, sinon sous forme d'extraits commentés.
 */
export async function askLocal(
  deps: LocalAssistantDeps,
  history: ChatMessage[],
  onEvent: (e: AssistantEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const question = currentQuestion(history);
    const plan = planQuery(question);

    // 1. Recherche sur Légifrance ; chaque décision trouvée rejoint la base locale.
    const fresh: StoredDecision[] = [];
    let offline = false;
    for (const search of plan.searches) {
      if (signal?.aborted) return;
      onEvent({ type: "tool_call", name: toolNameFor(search.source) });
      try {
        const result = await searchDecisions(deps.openlegi, search);
        if (!result.isError) fresh.push(...(await deps.kb.addFromResults(search.source, result.text)));
        onEvent({ type: "tool_result", isError: result.isError });
      } catch {
        offline = true;
        onEvent({ type: "tool_result", isError: true });
      }
    }

    // 2. Classement dans la base locale (résultats du jour + recherches passées).
    onEvent({ type: "tool_call", name: "base_locale" });
    // Recherche par numéro : seules les décisions trouvées pour ce numéro comptent.
    const byNumber = plan.searches[0]?.champ === "NUM_AFFAIRE";
    const sources = plan.searches.map((s) => s.source);
    const ranked = byNumber ? [] : await deps.kb.search(plan.keywords.join(" "), { limit: 15, sources });
    // On écarte les résultats locaux nettement moins pertinents que le meilleur.
    const relevant = ranked.filter((d) => d.score >= (ranked[0]?.score ?? 0) * 0.35);
    const decisions = dedupe(byNumber ? fresh : [...relevant, ...fresh]).slice(0, MAX_DECISIONS);
    onEvent({ type: "tool_result", isError: false });

    if (signal?.aborted) return;
    let answer: string;
    if (decisions.length === 0) {
      answer = noResult(offline);
      onEvent({ type: "text", text: answer });
    } else {
      const ollama = deps.ollama && (await ollamaStatus(deps.ollama));
      answer =
        deps.ollama && ollama?.available
          ? await synthesize(deps.ollama, question, decisions, onEvent, signal)
          : extractive(decisions, byNumber ? [] : plan.keywords, fresh.length, offline, ollama && !ollama.available ? ollama.reason : "");
      if (!(deps.ollama && ollama?.available)) onEvent({ type: "text", text: answer });
    }
    onEvent({ type: "done", messages: [{ role: "assistant", content: answer }] });
  } catch (err) {
    if (signal?.aborted) return;
    onEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

/** Question courante ; une relance (« et en droit administratif ? ») reprend la précédente. */
function currentQuestion(history: ChatMessage[]): string {
  const questions = history
    .filter((m) => m.role === "user" && typeof m.content === "string")
    .map((m) => m.content as string);
  const last = questions.at(-1) ?? "";
  const previous = questions.at(-2);
  const followUp = /^\s*(et|mais|aussi|idem|qu.en est-il|même question)\b/i.test(last) || planQuery(last).keywords.length === 0;
  return previous && followUp ? `${previous} ${last}` : last;
}

function dedupe(list: StoredDecision[]): StoredDecision[] {
  const seen = new Set<string>();
  return list.filter((d) => !seen.has(d.id) && seen.add(d.id));
}

function link(d: StoredDecision): string {
  return d.url ? `[${d.title}](${d.url})` : d.title;
}

function extractive(
  decisions: StoredDecision[],
  keywords: string[],
  _freshCount: number,
  offline: boolean,
  ollamaHint: string,
): string {
  const intro = offline
    ? "Légifrance est injoignable pour le moment ; voici les décisions les plus proches de votre question dans votre base locale."
    : decisions.length === 1
      ? "Voici la décision correspondante :"
      : `Voici les ${decisions.length} décisions les plus pertinentes (recherche Légifrance du jour et décisions déjà présentes dans votre base locale).`;

  const body = decisions.map((d, i) => {
    const meta = d.fields
      .filter(([k]) => ["Formation", "Solution"].includes(k))
      .map(([, v]) => v)
      .join(" · ");
    // Sans mots-clés (recherche par numéro), on cite le début du résumé.
    const passages = keywords.length ? bestSentences(d.summary ?? "", keywords) : [];
    if (keywords.length && passages.length === 0 && !d.excerpt && d.fullText) {
      passages.push(...bestSentences(d.fullText, keywords, 2, 420, Math.min(2, keywords.length)));
    }
    const quote = passages.length ? passages : [d.summary ?? d.excerpt ?? ""].filter(Boolean);
    return [
      `### ${i + 1}. ${link(d)}`,
      meta && `*${meta}*`,
      ...quote.map((p) => `> ${p.length > 600 ? p.slice(0, 600) + "…" : p}`),
    ]
      .filter(Boolean)
      .join("\n\n");
  });

  const footer = [
    "---",
    "*Réponse composée sans IA, à partir des résumés officiels des décisions. Vérifiez chaque décision sur Légifrance avant de la citer.*",
    ollamaHint && `*Synthèse rédigée indisponible (${ollamaHint}) — voir Paramètres.*`,
  ].filter(Boolean);

  return [intro, ...body, ...footer].join("\n\n");
}

async function synthesize(
  ollama: OllamaConfig,
  question: string,
  decisions: StoredDecision[],
  onEvent: (e: AssistantEvent) => void,
  signal?: AbortSignal,
): Promise<string> {
  const context = decisions
    .map((d, i) => {
      const summary = (d.summary ?? d.excerpt ?? d.fullText ?? "").replace(/\*\*/g, "").slice(0, 800);
      return `[${i + 1}] ${d.title}\n${summary}`;
    })
    .join("\n\n");

  const system =
    "Tu es un assistant de recherche juridique pour étudiants en droit français. " +
    "Réponds en français, uniquement à partir des décisions fournies, sans rien inventer. " +
    "Cite les décisions par leur numéro entre crochets, par exemple [1]. " +
    "Si les décisions ne permettent pas de répondre, dis-le clairement.";
  const user = `Question : ${question}\n\nDécisions trouvées sur Légifrance :\n\n${context}\n\nRédige une réponse structurée et concise (un court paragraphe de synthèse, puis l'apport de chaque décision utile).`;

  const text = await ollamaChat(
    ollama,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    (chunk) => onEvent({ type: "text", text: chunk }),
    signal,
  );

  // Les liens sont ajoutés par le programme, pas par le modèle : ils sont donc exacts.
  const sources = [
    "\n\n**Sources**",
    ...decisions.map((d, i) => `${i + 1}. ${link(d)}`),
    "\n*Synthèse rédigée par une IA (Ollama) : vérifiez chaque décision sur Légifrance avant de la citer.*",
  ].join("\n");
  onEvent({ type: "text", text: sources });
  return text + sources;
}

function noResult(offline: boolean): string {
  return offline
    ? "Légifrance est injoignable et votre base locale ne contient aucune décision sur ce sujet. Réessayez dans un instant."
    : "Je n'ai trouvé aucune décision correspondant à cette question. Essayez d'autres mots-clés (notion juridique, article de loi) ou l'onglet *Recherche d'arrêts* pour filtrer plus finement.";
}
