import { useEffect, useRef, useState } from "react";
import type { AssistantEvent, Backend, BackendStatus, ChatMessage, Engine } from "../core/types";
import Markdown from "./Markdown";
import { toolLabel } from "./toolLabels";

interface ToolCall {
  name: string;
  state: "running" | "ok" | "error";
}

interface Turn {
  role: "user" | "assistant";
  text: string;
  tools: ToolCall[];
  error?: string;
  pending?: boolean;
}

const EXAMPLES = [
  "Quels sont les arrêts de principe sur l'obligation de sécurité de résultat de l'employeur ?",
  "Retrouve l'arrêt Perruche et explique sa portée.",
  "Quelle est la jurisprudence récente de la Cour de cassation sur la clause de non-concurrence ?",
  "Résume la jurisprudence du Conseil d'État sur le référé-liberté.",
];

interface Props {
  backend: Backend;
  status: BackendStatus | null;
  onAnswered: () => void;
}

export default function ChatView({ backend, status, onAnswered }: Props) {
  const [engine, setEngine] = useState<Engine>("local");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const updateLast = (fn: (t: Turn) => Turn) =>
    setTurns((prev) => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

  async function send(question: string) {
    const text = question.trim();
    if (!text || busy) return;

    const previous = history;
    const nextHistory: ChatMessage[] = [...previous, { role: "user", content: text }];
    setHistory(nextHistory);
    setTurns((prev) => [
      ...prev,
      { role: "user", text, tools: [] },
      { role: "assistant", text: "", tools: [], pending: true },
    ]);
    setInput("");
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let completed = false;

    const onEvent = (event: AssistantEvent) => {
      switch (event.type) {
        case "text":
          updateLast((t) => ({ ...t, text: t.text + event.text }));
          break;
        case "tool_call":
          updateLast((t) => ({ ...t, tools: [...t.tools, { name: event.name, state: "running" }] }));
          break;
        case "tool_result":
          updateLast((t) => {
            const i = t.tools.findIndex((c) => c.state === "running");
            if (i < 0) return t;
            const tools = [...t.tools];
            tools[i] = { ...tools[i], state: event.isError ? "error" : "ok" };
            return { ...t, tools };
          });
          break;
        case "done":
          completed = true;
          setHistory([...nextHistory, ...event.messages]);
          break;
        case "error":
          updateLast((t) => ({ ...t, error: event.message }));
          break;
      }
    };

    await backend.ask(nextHistory, engine, onEvent, controller.signal);

    // Réponse interrompue ou en erreur : la question est retirée de l'historique
    // envoyé à l'API, pour que la suite de la conversation reste cohérente.
    if (!completed) setHistory(previous);
    if (controller.signal.aborted) updateLast((t) => ({ ...t, error: t.error ?? "Réponse interrompue." }));
    updateLast((t) => ({ ...t, pending: false }));
    abortRef.current = null;
    setBusy(false);
    onAnswered();
  }

  function reset() {
    abortRef.current?.abort();
    setHistory([]);
    setTurns([]);
  }

  // Les deux moteurs ne partagent pas le même historique : changer de moteur repart de zéro.
  function switchEngine(next: Engine) {
    if (next === engine) return;
    reset();
    setEngine(next);
  }

  const engineInfo =
    engine === "claude"
      ? "Claude (API payante) interroge Légifrance et rédige la réponse."
      : status?.ollama.available
        ? `Gratuit · IA ${status.ollama.cloud ? "Ollama Cloud" : "locale"} ${status.ollama.model} · base de ${status.kbSize} décisions`
        : `Gratuit · réponses composées d'extraits (IA non disponible) · base de ${status?.kbSize ?? 0} décisions`;

  return (
    <div className="chat">
      <div className="chat-scroll">
        {turns.length === 0 ? (
          <div className="empty">
            <h1>Posez votre question de droit</h1>
            <p>
              L'assistant recherche les décisions pertinentes sur Légifrance via OpenLegi, puis vous répond en
              citant ses sources.
            </p>
            <div className="examples">
              {EXAMPLES.map((ex) => (
                <button key={ex} className="example" onClick={() => send(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn, i) => (
            <div key={i} className={`turn ${turn.role}`}>
              {turn.tools.length > 0 && (
                <ul className="tools" aria-label="Recherches effectuées">
                  {turn.tools.map((tool, j) => (
                    <li key={j} className={`tool ${tool.state}`}>
                      {tool.state === "running" ? "Recherche…" : tool.state === "error" ? "Échec" : "Consulté"} ·{" "}
                      {toolLabel(tool.name)}
                    </li>
                  ))}
                </ul>
              )}
              {turn.role === "user" ? (
                <p className="bubble">{turn.text}</p>
              ) : (
                <>
                  {turn.text && <Markdown text={turn.text} />}
                  {turn.pending && !turn.text && <p className="muted">L'assistant réfléchit…</p>}
                </>
              )}
              {turn.error && <p className="error">{turn.error}</p>}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder="Ex. : quelle est la jurisprudence sur le trouble anormal de voisinage ?"
          rows={2}
          aria-label="Votre question"
        />
        <div className="composer-actions">
          <span className="engine muted small" title={status?.ollama.reason}>
            {status?.claudeAvailable && (
              <select
                value={engine}
                onChange={(e) => switchEngine(e.target.value as Engine)}
                disabled={busy}
                aria-label="Moteur de l'assistant"
              >
                <option value="local">Gratuit</option>
                <option value="claude">Claude</option>
              </select>
            )}
            {engineInfo}
          </span>
          {turns.length > 0 && !busy && (
            <button type="button" className="ghost" onClick={reset}>
              Nouvelle conversation
            </button>
          )}
          {busy ? (
            <button type="button" className="secondary" onClick={() => abortRef.current?.abort()}>
              Arrêter
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!input.trim()}>
              Envoyer
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
