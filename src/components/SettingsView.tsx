import { useState } from "react";
import type { Backend, BackendStatus } from "../core/types";
import { loadAccessCode, loadSettings, saveAccessCode, saveSettings } from "../platform/settings";

interface Props {
  backend: Backend;
  status: BackendStatus | null;
  /** Revérifie la configuration ; renvoie le nouvel état (null si le serveur est injoignable). */
  onSaved: () => Promise<BackendStatus | null>;
  /** Appelé quand tout est prêt, pour revenir à l'assistant. */
  onReady: () => void;
}

export default function SettingsView({ backend, status, onSaved, onReady }: Props) {
  return (
    <div className="settings">
      <h2>Paramètres</h2>
      {backend.kind === "desktop" ? (
        <DesktopSettings onSaved={onSaved} />
      ) : (
        <WebSettings status={status} onSaved={onSaved} onReady={onReady} />
      )}
      <EngineStatus status={status} />
    </div>
  );
}

function DesktopSettings({ onSaved }: { onSaved: () => Promise<unknown> }) {
  const [settings, setSettings] = useState(loadSettings);
  const [saved, setSaved] = useState(false);
  const update = (patch: Partial<typeof settings>) => {
    setSettings({ ...settings, ...patch });
    setSaved(false);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        saveSettings({
          openlegiToken: settings.openlegiToken.trim(),
          anthropicApiKey: settings.anthropicApiKey.trim(),
          ollamaUrl: settings.ollamaUrl.trim(),
          ollamaModel: settings.ollamaModel.trim(),
          ollamaApiKey: settings.ollamaApiKey.trim(),
        });
        setSaved(true);
        void onSaved();
      }}
    >
      <label className="field block">
        Jeton OpenLegi
        <input
          type="password"
          value={settings.openlegiToken}
          onChange={(e) => update({ openlegiToken: e.target.value })}
          autoComplete="off"
        />
        <span className="hint">
          Sur auth.openlegi.fr › Dashboard › Connexion › « Votre token API ». L'URL complète du connecteur est aussi
          acceptée.
        </span>
      </label>
      <label className="field block">
        Clé Ollama Cloud (IA gratuite, recommandée)
        <input
          type="password"
          value={settings.ollamaApiKey}
          onChange={(e) => update({ ollamaApiKey: e.target.value })}
          autoComplete="off"
        />
        <span className="hint">
          Sur ollama.com › Settings › API keys. Avec cette clé, les synthèses sont rédigées par gemma4:31b (offre
          gratuite), sans rien installer.
        </span>
      </label>
      <label className="field block">
        Modèle Ollama local (si pas de clé cloud)
        <input type="text" value={settings.ollamaModel} onChange={(e) => update({ ollamaModel: e.target.value })} />
        <span className="hint">Adresse : {settings.ollamaUrl}</span>
      </label>
      <label className="field block">
        Clé API Anthropic (facultative, payante)
        <input
          type="password"
          value={settings.anthropicApiKey}
          onChange={(e) => update({ anthropicApiKey: e.target.value })}
          autoComplete="off"
          placeholder="sk-ant-…"
        />
        <span className="hint">Ajoute le moteur Claude à l'assistant. Le mode gratuit fonctionne sans elle.</span>
      </label>
      <p className="hint">Les clés restent sur cet ordinateur et ne sont envoyées qu'à OpenLegi et, le cas échéant, à Anthropic.</p>
      <button type="submit" className="primary">
        Enregistrer
      </button>
      {saved && <span className="muted"> Enregistré.</span>}
    </form>
  );
}

type Feedback = { kind: "ok" | "error"; text: string } | null;

/** Message affiché après vérification du code auprès du serveur. */
function feedbackFor(s: BackendStatus | null): Feedback {
  if (!s) return { kind: "error", text: "Le serveur ne répond pas. Réessayez dans une minute (il peut être en train de démarrer)." };
  if (s.needsAccessCode) return { kind: "error", text: "Code incorrect. Vérifiez-le auprès de la personne qui vous l'a donné." };
  if (!s.ready) {
    return {
      kind: "error",
      text: `Code accepté, mais le serveur n'est pas configuré : ${s.missing.join(", ")} manquant. L'administrateur doit l'ajouter sur l'hébergeur.`,
    };
  }
  const ai = s.ollama.available ? `IA ${s.ollama.model} disponible` : "IA indisponible (réponses en extraits)";
  return { kind: "ok", text: `Accès validé : OpenLegi disponible, ${ai}.` };
}

function WebSettings({
  status,
  onSaved,
  onReady,
}: {
  status: BackendStatus | null;
  onSaved: () => Promise<BackendStatus | null>;
  onReady: () => void;
}) {
  const [code, setCode] = useState(loadAccessCode);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setChecking(true);
        setFeedback(null);
        saveAccessCode(code.trim());
        const s = await onSaved();
        setChecking(false);
        const result = feedbackFor(s);
        setFeedback(result);
        if (result?.kind === "ok") setTimeout(onReady, 1200);
      }}
    >
      <p>Dans la version web, les clés OpenLegi et IA sont configurées par l'administrateur sur l'hébergeur.</p>
      <p>
        Legi existe aussi en application pour Windows, macOS, Linux et Android :{" "}
        <a href="https://nonowagbt.github.io/Legi_ma/" target="_blank" rel="noreferrer">
          télécharger l'application
        </a>
        .
      </p>
      {!feedback && status && !status.ready && !status.needsAccessCode && (
        <p className="error">Le serveur n'est pas configuré : {status.missing.join(", ")} manquant.</p>
      )}
      <label className="field block">
        Code d'accès
        <input
          type="password"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setFeedback(null);
          }}
          autoComplete="off"
        />
        <span className="hint">Le code fourni par l'administrateur du site. Il est mémorisé sur cet appareil.</span>
      </label>
      <button type="submit" className="primary" disabled={checking}>
        {checking ? "Vérification…" : "Valider"}
      </button>
      {feedback && (
        <p className={feedback.kind === "ok" ? "success" : "error"} role="status">
          {feedback.text}
        </p>
      )}
    </form>
  );
}

function EngineStatus({ status }: { status: BackendStatus | null }) {
  if (!status) return null;
  return (
    <section className="engine-status">
      <h3>État</h3>
      <ul>
        <li>
          <strong>OpenLegi</strong> : {status.ready ? "configuré" : "jeton manquant"}
        </li>
        <li>
          <strong>Base locale</strong> : {status.kbSize} décision{status.kbSize > 1 ? "s" : ""} enregistrée
          {status.kbSize > 1 ? "s" : ""}
        </li>
        <li>
          <strong>
            IA {status.ollama.cloud ? "Ollama Cloud" : "locale"} ({status.ollama.model})
          </strong>{" "}
          : {status.ollama.available ? "disponible" : `indisponible — ${status.ollama.reason}`}
        </li>
        <li>
          <strong>Claude</strong> : {status.claudeAvailable ? "disponible" : "non configuré (facultatif)"}
        </li>
      </ul>
      {!status.ollama.available && !status.ollama.cloud && (
        <p className="hint">
          Pour activer l'IA gratuite : créez une clé sur ollama.com (Ollama Cloud), ou installez Ollama et lancez{" "}
          <code>ollama pull {status.ollama.model}</code>. Sans IA, l'assistant répond avec des extraits des décisions.
        </p>
      )}
    </section>
  );
}
