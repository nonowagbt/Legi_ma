/**
 * Vérifie le jeton OpenLegi du fichier .env, sans clé Anthropic :
 * liste les outils disponibles puis lance une recherche de jurisprudence.
 */
import "dotenv/config";
import { OpenLegiClient, searchDecisions } from "../src/core/openlegi";

const client = new OpenLegiClient(process.env.OPENLEGI_TOKEN ?? "");
try {
  const tools = await client.listTools();
  console.log(`✔ Jeton accepté — ${tools.length} outils disponibles :\n  ${tools.join("\n  ")}`);
  const result = await searchDecisions(client, {
    source: "judiciaire",
    search: "responsabilité civile",
    juridictions: ["Cour de cassation"],
  });
  console.log(result.isError ? "✘ La recherche a échoué :" : "✔ Recherche de jurisprudence OK. Extrait :");
  console.log(result.text.slice(0, 1500));
} catch (err) {
  console.error("✘", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.close();
}
