/**
 * Vérifie la connexion à Ollama (cloud si OLLAMA_API_KEY est défini, local sinon)
 * en passant par le client de l'app, puis affiche la réponse reçue.
 */
import "dotenv/config";
import { isCloud, ollamaChat, ollamaConfig, ollamaStatus } from "../src/core/ollama";

const config = ollamaConfig({
  apiKey: process.env.OLLAMA_API_KEY,
  cloudModel: process.env.OLLAMA_CLOUD_MODEL,
  localUrl: process.env.OLLAMA_URL,
  localModel: process.env.OLLAMA_MODEL,
});
console.log(`Ollama ${isCloud(config) ? "Cloud" : "local"} · ${config.url} · modèle ${config.model}`);

const status = await ollamaStatus(config);
console.log(status.available ? "✔ Modèle disponible" : `✘ ${status.reason}`);

try {
  const reply = await ollamaChat(
    config,
    [{ role: "user", content: "En une phrase, qu'est-ce qu'un arrêt de cassation ?" }],
    (chunk) => process.stdout.write(chunk),
  );
  console.log(`\n✔ Réponse reçue (${reply.length} caractères)`);
} catch (err) {
  console.error("✘", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
