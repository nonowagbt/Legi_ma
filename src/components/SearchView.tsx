import { useEffect, useState } from "react";
import type { StoredDecision } from "../core/knowledge";
import { JURIDICTIONS_JUDICIAIRES, type Backend, type SearchParams, type SearchResult } from "../core/types";
import Results, { DecisionList } from "./Results";

type Tab = SearchParams["source"] | "base";

const SOURCES: { id: Tab; label: string }[] = [
  { id: "judiciaire", label: "Judiciaire" },
  { id: "administrative", label: "Administrative" },
  { id: "constitutionnelle", label: "Constitutionnelle" },
  { id: "base", label: "Ma base" },
];

/** Recherche demandée depuis un autre onglet (ex. « Jurisprudence sur cet article »). */
export interface SearchRequest {
  id: number;
  params: SearchParams;
}

interface Props {
  backend: Backend;
  kbSize: number;
  onSearched: () => void;
  request: SearchRequest | null;
}

export default function SearchView({ backend, kbSize, onSearched, request }: Props) {
  const [tab, setTab] = useState<Tab>("judiciaire");
  const [local, setLocal] = useState<StoredDecision[] | null>(null);
  const [params, setParams] = useState<SearchParams>({
    source: "judiciaire",
    search: "",
    juridictions: ["Cour de cassation"],
    bulletinOnly: false,
    sort: "PERTINENCE",
    champ: "ALL",
  });
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = <K extends keyof SearchParams>(key: K, value: SearchParams[K]) =>
    setParams((p) => ({ ...p, [key]: value }));

  const toggleJuridiction = (j: string) =>
    set(
      "juridictions",
      params.juridictions?.includes(j)
        ? params.juridictions.filter((x) => x !== j)
        : [...(params.juridictions ?? []), j],
    );

  // Paramètres de la dernière recherche lancée, réutilisés pour changer de page.
  const [lastQuery, setLastQuery] = useState<SearchParams | null>(null);

  async function run(query: SearchParams) {
    setLoading(true);
    setError("");
    try {
      setResult(await backend.search(query));
      setLocal(null);
      setLastQuery(query);
      onSearched();
      document.querySelector(".view:not([hidden])")?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function runLocal(query: string) {
    setLoading(true);
    setError("");
    try {
      setLocal(await backend.searchLocal(query));
      setResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!request) return;
    setTab(request.params.source);
    setParams((p) => ({ ...p, ...request.params }));
    void run({ ...request.params, page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seule une nouvelle demande doit relancer
  }, [request?.id]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const search = params.search.trim();
    if (!search) return;
    if (tab === "base") void runLocal(search);
    else void run({ ...params, search, page: 1 });
  }

  function selectTab(next: Tab) {
    setTab(next);
    if (next !== "base") set("source", next);
  }

  const judiciaire = tab === "judiciaire";

  return (
    <div className="search">
      <form className="search-form" onSubmit={submit}>
        <div className="segmented" role="radiogroup" aria-label="Type de jurisprudence">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={tab === s.id}
              className={tab === s.id ? "seg active" : "seg"}
              onClick={() => selectTab(s.id)}
            >
              {s.id === "base" ? `${s.label} (${kbSize})` : s.label}
            </button>
          ))}
        </div>

        <div className="search-row">
          <input
            type="search"
            value={params.search}
            onChange={(e) => set("search", e.target.value)}
            placeholder={
              tab === "base"
                ? "Chercher dans les décisions déjà consultées (hors ligne)"
                : params.champ === "NUM_AFFAIRE"
                  ? "Numéro de pourvoi, ex. 99-13.701"
                  : "Mots-clés, ex. vice caché vendeur professionnel"
            }
            aria-label="Termes de recherche"
          />
          <button type="submit" className="primary" disabled={loading || !params.search.trim()}>
            {loading ? "Recherche…" : "Rechercher"}
          </button>
        </div>

        <div className="filters">
          {judiciaire && (
            <>
              <fieldset>
                <legend>Juridictions</legend>
                {JURIDICTIONS_JUDICIAIRES.map((j) => (
                  <label key={j} className="check">
                    <input type="checkbox" checked={params.juridictions?.includes(j) ?? false} onChange={() => toggleJuridiction(j)} />
                    {j}
                  </label>
                ))}
              </fieldset>
              <label className="check">
                <input type="checkbox" checked={params.bulletinOnly} onChange={(e) => set("bulletinOnly", e.target.checked)} />
                Publiés au Bulletin uniquement
              </label>
              <label className="field">
                Chercher dans
                <select value={params.champ} onChange={(e) => set("champ", e.target.value as SearchParams["champ"])}>
                  <option value="ALL">Tout</option>
                  <option value="TITLE">Titre</option>
                  <option value="ABSTRACTS">Sommaires</option>
                  <option value="TEXTE">Texte intégral</option>
                  <option value="NUM_AFFAIRE">Numéro d'affaire</option>
                </select>
              </label>
              <label className="field">
                Tri
                <select value={params.sort} onChange={(e) => set("sort", e.target.value as SearchParams["sort"])}>
                  <option value="PERTINENCE">Pertinence</option>
                  <option value="DATE_DESC">Plus récents</option>
                  <option value="DATE_ASC">Plus anciens</option>
                </select>
              </label>
            </>
          )}
        </div>
      </form>

      <section className="results" aria-live="polite">
        {error && <p className="error">{error}</p>}
        {tab === "base" && kbSize === 0 && !local && (
          <p className="muted">
            Votre base est vide. Chaque décision trouvée par une recherche ou par l'assistant y est ajoutée
            automatiquement, puis reste consultable hors ligne.
          </p>
        )}
        {local &&
          (local.length ? (
            <>
              <p className="muted small">{local.length} décision(s) dans votre base</p>
              <DecisionList decisions={local} />
            </>
          ) : (
            <p className="muted">Aucune décision de votre base ne correspond.</p>
          ))}
        {result &&
          (result.isError ? (
            <p className="error">{result.text || "OpenLegi a renvoyé une erreur."}</p>
          ) : result.text ? (
            <>
              <Results
                text={result.text}
                loading={loading}
                onPage={(page) => lastQuery && void run({ ...lastQuery, page })}
              />
              <p className="muted small">Vérifiez chaque décision sur Légifrance avant de la citer.</p>
            </>
          ) : (
            <p className="muted">Aucune décision trouvée.</p>
          ))}
      </section>
    </div>
  );
}
