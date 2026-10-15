/**
 * Configure les variables d'environnement du site hébergé sur Render à partir
 * du fichier .env local, puis relance un déploiement.
 *
 * Prérequis dans .env : RENDER_API_KEY (Render › Account Settings › API Keys)
 * et SITE_ACCESS_CODE (code d'accès du site public).
 * Aucune valeur n'est affichée : seuls les noms des variables le sont.
 */
import "dotenv/config";

const API = "https://api.render.com/v1";
const { RENDER_API_KEY = "", RENDER_SERVICE = "legi" } = process.env;

/** Variable sur Render ← variable du .env local. */
const MAPPING: [remote: string, local: string][] = [
  ["OPENLEGI_TOKEN", "OPENLEGI_TOKEN"],
  ["OLLAMA_API_KEY", "OLLAMA_API_KEY"],
  ["ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"],
  ["APP_ACCESS_CODE", "SITE_ACCESS_CODE"],
];

async function render<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${RENDER_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
  });
  if (res.status === 401) throw new Error("RENDER_API_KEY invalide.");
  if (!res.ok) throw new Error(`Render a répondu ${res.status} sur ${path} : ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

if (!RENDER_API_KEY) {
  console.error("✘ RENDER_API_KEY manquant dans .env (Render › Account Settings › API Keys › Create API Key).");
  process.exit(1);
}

try {
  type Item = { service: { id: string; name: string; serviceDetails?: { url?: string } } };
  const services = await render<Item[]>(`/services?name=${encodeURIComponent(RENDER_SERVICE)}&limit=20`);
  const service = services.map((s) => s.service).find((s) => s.name === RENDER_SERVICE);
  if (!service) throw new Error(`Service « ${RENDER_SERVICE} » introuvable sur Render : créez-le d'abord (New › Blueprint).`);
  console.log(`Service ${service.name} (${service.serviceDetails?.url ?? service.id})`);

  for (const [remote, local] of MAPPING) {
    const value = process.env[local]?.trim();
    if (!value) {
      console.log(`  - ${remote} : ignoré (${local} vide dans .env)`);
      continue;
    }
    await render(`/services/${service.id}/env-vars/${remote}`, { method: "PUT", body: JSON.stringify({ value }) });
    console.log(`  ✔ ${remote}`);
  }

  await render(`/services/${service.id}/deploys`, { method: "POST", body: JSON.stringify({}) });
  console.log("✔ Variables enregistrées, redéploiement lancé (quelques minutes).");
} catch (err) {
  console.error("✘", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
