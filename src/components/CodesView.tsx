import { useState } from "react";
import {
  articleNumber,
  articleReference,
  MAIN_CODES,
  OTHER_CODES,
  type Article,
  type ArticleResults,
  type CodeName,
} from "../core/codes";
import type { Backend } from "../core/types";
import { openExternal } from "./Markdown";

const EXAMPLES: Partial<Record<CodeName, string[]>> = {
  "Code civil": ["1240", "1103", "544", "9", "1231-1", "vice caché"],
  "Code de commerce": ["L. 110-1", "L. 145-9", "L. 225-1", "L. 631-1", "fonds de commerce"],
  "Code du travail": ["L. 1221-1", "L. 1232-1", "L. 1152-1"],
  "Code pénal": ["121-3", "122-5", "311-1"],
  "Code de procédure civile": ["9", "12", "700"],
};

interface Props {
  backend: Backend;
  /** Lance la recherche des arrêts qui appliquent un article. */
  onCaseLaw: (reference: string) => void;
}

export default function CodesView({ backend, onCaseLaw }: Props) {
  const [code, setCode] = useState<CodeName>("Code civil");
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<ArticleResults | null>(null);
  const [last, setLast] = useState<{ code: CodeName; search: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run(query: { code: CodeName; search: string }, page = 1) {
    setLoading(true);
    setError("");
    try {
      setResult(await backend.searchCode({ ...query, page }));
      setLast(query);
      document.querySelector(".view:not([hidden])")?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (search.trim()) void run({ code, search: search.trim() });
  }

  function selectCode(next: CodeName) {
    setCode(next);
    setResult(null);
    setError("");
  }

  const isNumber = articleNumber(search) !== null;

  return (
    <div className="search">
      <form className="search-form" onSubmit={submit}>
        <div className="code-picker">
          <div className="segmented" role="radiogroup" aria-label="Code">
            {MAIN_CODES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={code === c}
                className={code === c ? "seg active" : "seg"}
                onClick={() => selectCode(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <select
            aria-label="Autres codes"
            className={(OTHER_CODES as readonly string[]).includes(code) ? "active" : ""}
            value={(OTHER_CODES as readonly string[]).includes(code) ? code : ""}
            onChange={(e) => e.target.value && selectCode(e.target.value as CodeName)}
          >
            <option value="">Autres codes…</option>
            {OTHER_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="search-row">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Numéro d'article${EXAMPLES[code] ? ` (ex. ${EXAMPLES[code]![0]})` : ""} ou mots-clés`}
            aria-label={`Rechercher dans le ${code}`}
          />
          <button type="submit" className="primary" disabled={loading || !search.trim()}>
            {loading ? "Recherche…" : isNumber ? "Afficher l'article" : "Rechercher"}
          </button>
        </div>
        <div className="chips" aria-label="Exemples">
          {(EXAMPLES[code] ?? []).map((ex) => (
            <button
              key={ex}
              type="button"
              className="chip"
              onClick={() => {
                setSearch(ex);
                void run({ code, search: ex });
              }}
            >
              {articleNumber(ex) ? `Art. ${ex}` : ex}
            </button>
          ))}
        </div>
      </form>

      <section className="results" aria-live="polite">
        {error && <p className="error">{error}</p>}
        {result &&
          (result.articles.length === 0 ? (
            <p className="muted">Aucun article trouvé dans le {last?.code}.</p>
          ) : (
            <div className="results-list">
              {(result.total ?? 0) > 1 && (
                <p className="muted small">
                  {result.total} articles · {last?.code}
                </p>
              )}
              {result.articles.map((a) => (
                <ArticleCard
                  key={a.id}
                  article={a}
                  onCaseLaw={last ? () => onCaseLaw(articleReference(a.numero, last.code)) : undefined}
                />
              ))}
              {result.page && result.pageCount && result.pageCount > 1 && last && (
                <div className="pager">
                  <button className="secondary" disabled={loading || result.page <= 1} onClick={() => run(last, result.page! - 1)}>
                    ← Précédente
                  </button>
                  <span className="muted small">
                    Page {result.page} / {result.pageCount}
                  </span>
                  <button
                    className="secondary"
                    disabled={loading || result.page >= result.pageCount}
                    onClick={() => run(last, result.page! + 1)}
                  >
                    Suivante →
                  </button>
                </div>
              )}
            </div>
          ))}
      </section>
    </div>
  );
}

function ArticleCard({ article, onCaseLaw }: { article: Article; onCaseLaw?: () => void }) {
  return (
    <article className={article.inForce ? "card article" : "card article repealed"}>
      <header className="article-head">
        <h3>
          {article.url ? (
            <a
              href={article.url}
              onClick={(e) => {
                e.preventDefault();
                void openExternal(article.url!);
              }}
            >
              Article {article.numero}
            </a>
          ) : (
            `Article ${article.numero}`
          )}
        </h3>
        <span className={article.inForce ? "badge ok" : "badge"}>
          {article.inForce ? "En vigueur" : (article.state ?? "Non en vigueur").toLowerCase()}
        </span>
        {article.since && <span className="muted small">depuis le {article.since}</span>}
      </header>
      {article.path.length > 0 && <p className="breadcrumb">{article.path.join(" › ")}</p>}
      <p className="article-text">{article.text || "Texte indisponible."}</p>
      {article.notes && (
        <details>
          <summary>Notes</summary>
          <p className="fulltext">{article.notes}</p>
        </details>
      )}
      {onCaseLaw && (
        <div className="article-actions">
          <button type="button" className="secondary" onClick={onCaseLaw}>
            Jurisprudence sur cet article →
          </button>
        </div>
      )}
    </article>
  );
}
