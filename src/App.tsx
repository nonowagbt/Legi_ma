import { useCallback, useEffect, useState } from "react";
import ChatView from "./components/ChatView";
import CodesView from "./components/CodesView";
import SearchView, { type SearchRequest } from "./components/SearchView";
import SettingsView from "./components/SettingsView";
import type { Backend, BackendStatus } from "./core/types";
import { loadBackend } from "./platform";

type Tab = "chat" | "codes" | "search" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "Assistant" },
  { id: "codes", label: "Codes" },
  { id: "search", label: "Recherche d'arrêts" },
  { id: "settings", label: "Paramètres" },
];

export default function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [tab, setTab] = useState<Tab>("chat");
  const [searchRequest, setSearchRequest] = useState<SearchRequest | null>(null);

  // Depuis un article de code : arrêts publiés au Bulletin qui l'appliquent.
  const showCaseLaw = (reference: string) => {
    setSearchRequest((prev) => ({
      id: (prev?.id ?? 0) + 1,
      params: {
        source: "judiciaire",
        search: reference,
        bulletinOnly: true,
        juridictions: ["Cour de cassation"],
        sort: "PERTINENCE",
        champ: "ALL",
      },
    }));
    setTab("search");
  };

  const refreshStatus = useCallback(async (b: Backend) => {
    try {
      const s = await b.status();
      setStatus(s);
      setStatusError("");
      if (!s.ready || s.needsAccessCode) setTab((t) => (t === "chat" ? "settings" : t));
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    loadBackend().then((b) => {
      setBackend(b);
      void refreshStatus(b);
    });
  }, [refreshStatus]);

  if (!backend) return null;

  const warning =
    statusError ||
    (status?.needsAccessCode && "Saisissez le code d'accès dans les Paramètres.") ||
    (status && !status.ready && `Configuration incomplète : ${status.missing.join(", ")}.`);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>§</span>
          <span>Legi</span>
          <span className="brand-sub">jurisprudence via OpenLegi</span>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "tab active" : "tab"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {warning && <div className="banner">{warning}</div>}

      <main className="content">
        {/* Les vues restent montées pour conserver la conversation et les résultats. */}
        <div hidden={tab !== "chat"} className="view">
          <ChatView backend={backend} status={status} onAnswered={() => refreshStatus(backend)} />
        </div>
        <div hidden={tab !== "codes"} className="view">
          <CodesView backend={backend} onCaseLaw={showCaseLaw} />
        </div>
        <div hidden={tab !== "search"} className="view">
          <SearchView
            backend={backend}
            kbSize={status?.kbSize ?? 0}
            onSearched={() => refreshStatus(backend)}
            request={searchRequest}
          />
        </div>
        <div hidden={tab !== "settings"} className="view">
          <SettingsView backend={backend} status={status} onSaved={() => refreshStatus(backend)} />
        </div>
      </main>
    </div>
  );
}
