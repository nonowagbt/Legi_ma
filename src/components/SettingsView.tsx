import { useState } from "react";
import type { Backend, BackendStatus } from "../core/types";
import { loadAccessCode, loadSettings, saveAccessCode, saveSettings } from "../platform/settings";

interface Props {
  backend: Backend;
  status: BackendStatus | null;
  onSaved: () => void;
}

export default function SettingsView({ backend, status, onSaved }: Props) {
  return (
    <div className="settings">
      <h2>Paramètres</h2>
      {backend.kind === "desktop" ? <DesktopSettings onSaved={onSaved} /> : <WebSettings status={status} onSaved={onSaved} />}
      <EngineStatus status={status} />
    </div>
  );
}

function DesktopSettings({ onSaved }: { onSaved: () => void }) {
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
        onSaved();
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

function WebSettings({ status, onSaved }: { status: BackendStatus | null; onSaved: () => void }) {
  const [code, setCode] = useState(loadAccessCode);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        saveAccessCode(code.trim());
        onSaved();
      }}
    >
      <p>Dans la version web, les clés sont configurées sur le serveur (fichier .env).</p>
      {status && !status.ready && <p className="error">Variable manquante côté serveur : {status.missing.join(", ")}.</p>}
      <label className="field block">
        Code d'accès
        <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
        <span className="hint">Uniquement si l'administrateur du site en a défini un.</span>
      </label>
      <button type="submit" className="primary">
        Valider
      </button>
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
