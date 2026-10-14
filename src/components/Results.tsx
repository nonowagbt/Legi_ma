import { Fragment } from "react";
import { parseResults, type Decision } from "../core/parseResults";
import { openExternal } from "./Markdown";

/** Affiche le texte d'un outil de recherche OpenLegi sous forme de fiches. */
interface Props {
  text: string;
  loading?: boolean;
  onPage?: (page: number) => void;
}

export default function Results({ text, loading, onPage }: Props) {
  const { total, decisions, page, pageCount } = parseResults(text);
  if (decisions.length === 0) return <pre className="raw">{text}</pre>;

  const pager = page && pageCount && pageCount > 1 && onPage && (
    <div className="pager">
      <button className="secondary" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>
        ← Précédente
      </button>
      <span className="muted small">
        Page {page} / {pageCount}
      </span>
      <button className="secondary" disabled={loading || page >= pageCount} onClick={() => onPage(page + 1)}>
        Suivante →
      </button>
    </div>
  );

  return (
    <div className="results-list">
      <p className="muted small">{total ?? `${decisions.length} décisions`}</p>
      {decisions.map((d, i) => (
        <DecisionCard key={d.id + i} decision={d} />
      ))}
      {pager}
    </div>
  );
}

/** Fiches de décisions déjà découpées (base locale). */
export function DecisionList({ decisions }: { decisions: Decision[] }) {
  return (
    <div className="results-list">
      {decisions.map((d) => (
        <DecisionCard key={d.id} decision={d} />
      ))}
    </div>
  );
}

function DecisionCard({ decision }: { decision: Decision }) {
  return (
    <article className="card">
      <h3>
        {decision.url ? (
          <a
            href={decision.url}
            onClick={(e) => {
              e.preventDefault();
              void openExternal(decision.url!);
            }}
          >
            {decision.title}
          </a>
        ) : (
          decision.title
        )}
      </h3>
      {decision.fields.length > 0 && (
        <dl className="meta">
          {decision.fields.map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {decision.summary && <p className="summary">{decision.summary}</p>}
      {decision.excerpt && <p className="excerpt">{highlight(decision.excerpt)}</p>}
      {decision.fullText && (
        <details>
          <summary>Texte intégral</summary>
          <p className="fulltext">{decision.fullText}</p>
        </details>
      )}
    </article>
  );
}

/** Les termes recherchés arrivent entourés de `**`. */
function highlight(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}
