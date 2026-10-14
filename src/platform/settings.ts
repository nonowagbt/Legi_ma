/** Clés saisies par l'utilisateur dans la version desktop (stockées localement). */
import { OLLAMA_DEFAULTS } from "../core/ollama";

export interface DesktopSettings {
  openlegiToken: string;
  /** Facultative : seulement pour le moteur Claude. */
  anthropicApiKey: string;
  ollamaUrl: string;
  ollamaModel: string;
  /** Clé Ollama Cloud : si elle est renseignée, l'IA tourne sur ollama.com. */
  ollamaApiKey: string;
}

const KEY = "legi.settings";
const DEFAULTS: DesktopSettings = {
  openlegiToken: "",
  anthropicApiKey: "",
  ollamaUrl: OLLAMA_DEFAULTS.url,
  ollamaModel: OLLAMA_DEFAULTS.model,
  ollamaApiKey: "",
};

export function loadSettings(): DesktopSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // stockage indisponible : valeurs par défaut
  }
  return { ...DEFAULTS };
}

export function saveSettings(settings: DesktopSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

/** Code d'accès à l'API de la version web, si le serveur en exige un. */
const ACCESS_CODE_KEY = "legi.accessCode";

export function loadAccessCode(): string {
  try {
    return localStorage.getItem(ACCESS_CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveAccessCode(code: string): void {
  localStorage.setItem(ACCESS_CODE_KEY, code);
}
