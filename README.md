# Legi

Application de recherche de jurisprudence pour étudiants en droit, construite sur [OpenLegi](https://www.openlegi.fr) (accès MCP à Légifrance).

- **Assistant** : posez une question en langage naturel, l'app répond en citant les décisions trouvées. Deux moteurs :
  - **Gratuit** (par défaut) : analyse de la question, recherche OpenLegi, classement dans la base locale, puis synthèse rédigée par [Ollama](https://ollama.com) — Ollama Cloud (`gemma4:31b`, offre gratuite) si `OLLAMA_API_KEY` est défini, sinon Ollama installé en local — ou, à défaut d'IA, réponse composée d'extraits des résumés officiels.
  - **Claude** (facultatif, payant) : Claude interroge lui-même OpenLegi via le connecteur MCP.
- **Recherche d'arrêts** : moteur de recherche direct, avec filtres (juridiction, Bulletin, tri, recherche par numéro de pourvoi) et pagination.
- **Base locale** : chaque décision trouvée est enregistrée et indexée en plein texte (onglet *Ma base*), consultable hors ligne. Fichier `data/decisions.json` en version web, IndexedDB en version desktop.

Deux cibles partagent le même code React/TypeScript :

| | Desktop (Tauri) | Web |
|---|---|---|
| Appels OpenLegi / Claude | directement depuis l'app, via le client HTTP natif de Tauri | via le serveur `server/index.ts` |
| Clés | saisies par l'utilisateur dans *Paramètres* | variables d'environnement du serveur |

Le serveur MCP d'OpenLegi refuse les appels venant d'un navigateur (CORS) : c'est pour cela que la version web passe par un petit serveur. Ce serveur évite aussi d'exposer les clés.

## Structure

```
src/core/        logique partagée : client OpenLegi (MCP), base locale, assistant gratuit, assistant Claude
src/platform/    backend desktop (Tauri) ou web (appels à /api)
src/components/  interface React
server/          serveur web Hono : /api/status, /api/search, /api/ask + fichiers statiques
src-tauri/       application desktop Tauri v2
```

## Prérequis

- Node.js 18 ou plus
- Un jeton OpenLegi (compte gratuit sur openlegi.fr). La jurisprudence judiciaire peut nécessiter une activation dans votre compte.
- Recommandé : une clé [Ollama Cloud](https://ollama.com/settings/keys) (`OLLAMA_API_KEY`) pour les synthèses rédigées, gratuites — ou Ollama installé en local (`ollama pull qwen2.5:3b`)
- Facultatif : une clé API Anthropic pour le moteur Claude
- Desktop uniquement : [Rust et les dépendances système de Tauri](https://v2.tauri.app/start/prerequisites/)

```bash
npm install
```

## Lancer en développement

```bash
cp .env.example .env    # renseigner OPENLEGI_TOKEN (le reste est facultatif)
npm run dev:web         # version web : UI sur http://localhost:1420, API sur :8787
npm run desktop:dev     # version desktop (nécessite Rust)
```

## Installation sur chaque système

Page de téléchargement : **https://nonowagbt.github.io/Legi_ma/** ([site/index.html](site/index.html)). Elle détecte le système du visiteur et propose l'installeur de la dernière release publiée. Elle est déployée par [.github/workflows/pages.yml](.github/workflows/pages.yml) ; à activer une fois dans *Settings › Pages › Source : GitHub Actions*. Pour y afficher le lien vers la version web, renseigner `WEB_APP_URL` en haut du script de la page.

### Windows et macOS (et Linux)

Les installeurs sont compilés automatiquement par GitHub Actions ([.github/workflows/release.yml](.github/workflows/release.yml)) :

1. Pousser un tag de version : `git tag v0.1.0 && git push origin v0.1.0` (ou onglet **Actions › Installeurs › Run workflow**).
2. Récupérer les fichiers dans la release GitHub créée en brouillon (ou dans les *artifacts* du run).

| Système | Fichier | Installation |
|---|---|---|
| Windows 10/11 | `Legi_x.y.z_x64-setup.exe` (ou `.msi`) | Double-clic. Installation sans droits administrateur. Si SmartScreen affiche « Windows a protégé votre ordinateur » : *Informations complémentaires › Exécuter quand même*. |
| macOS Apple Silicon (M1…M4) | `Legi_x.y.z_aarch64.dmg` | Ouvrir le .dmg, glisser Legi dans Applications. |
| macOS Intel | `Legi_x.y.z_x64.dmg` | Idem. |
| Linux | `.deb`, `.rpm` ou `.AppImage` | `sudo apt install ./Legi_x.y.z_amd64.deb`, ou rendre l'AppImage exécutable. |

L'app n'est pas signée tant qu'aucun certificat n'est configuré. Au premier lancement sur macOS : clic droit sur Legi › **Ouvrir** › **Ouvrir** (ou *Réglages Système › Confidentialité et sécurité › Ouvrir quand même*). Pour supprimer ces avertissements : certificat Apple Developer (99 $/an, secrets `APPLE_*` du workflow) et certificat de signature de code Windows.

Compiler soi-même sur sa machine : `npm run desktop:build` (installeurs dans `src-tauri/target/release/bundle/`). Chaque système ne compile que pour lui-même : un Mac pour macOS, un PC Windows pour Windows.

Au premier lancement, ouvrir **Paramètres** et saisir le jeton OpenLegi (et, si souhaité, la clé Ollama Cloud).

### Mobiles

**Option 1 — version web installable (iPhone et Android, recommandée pour commencer).** Héberger la version web (voir ci-dessous), l'ouvrir dans le navigateur du téléphone puis :
- iPhone (Safari) : bouton **Partager › Sur l'écran d'accueil** ;
- Android (Chrome) : menu **⋮ › Installer l'application**.

L'app s'ouvre alors en plein écran, avec son icône, comme une application native.

**Option 2 — application Android native.** Le workflow produit `Legi-…-android.apk` : le copier sur le téléphone et l'ouvrir (autoriser l'installation d'applications de sources inconnues). Cet APK est signé avec une clé de test ; pour publier sur le Play Store, générer une clé (`keytool -genkey -v -keystore legi.jks -keyalg RSA -keysize 2048 -validity 10000 -alias legi`) et suivre le guide [Tauri › Android signing](https://v2.tauri.app/distribute/sign/android/).

En local (Android Studio, SDK et NDK installés) : `npm run android:init` une fois, puis `npm run android:dev` (téléphone branché ou émulateur) ou `npm run android:build`.

**Option 3 — application iOS native.** Nécessite un Mac avec Xcode : `npm run ios:init` puis `npm run ios:dev`. Un identifiant Apple gratuit permet d'installer l'app sur son propre iPhone (à réinstaller tous les 7 jours) ; la publication sur l'App Store demande un compte Apple Developer.

### Version web (serveur)

```bash
npm run build
npm start               # sert l'UI et l'API sur http://localhost:8787
```

Ou avec Docker :

```bash
docker build -t legi .
docker run -d -p 8787:8787 --env-file .env -v legi-data:/app/data legi
```

**Hébergement gratuit sur Render** : le fichier [render.yaml](render.yaml) décrit le service. Sur [render.com](https://render.com), se connecter avec GitHub, puis **New › Blueprint**, choisir ce dépôt et renseigner `OPENLEGI_TOKEN`, `OLLAMA_API_KEY` et `APP_ACCESS_CODE`. Le site est publié en HTTPS sur **https://legi-hq5g.onrender.com** et redéployé à chaque push. Offre gratuite : le service s'endort après 15 minutes sans visite (premier chargement ensuite d'environ une minute) et la base locale repart de zéro à chaque redéploiement.

Pour envoyer ensuite les clés du `.env` local au site sans les recopier : créer une clé API Render (*Account Settings › API Keys*), la mettre dans `RENDER_API_KEY` du `.env` avec le code d'accès dans `SITE_ACCESS_CODE`, puis lancer `npm run render:env` (met à jour les variables et redéploie).

Pour un accès depuis un téléphone, le site doit être servi en HTTPS (hébergeur type Render, Railway, Fly.io, ou VPS avec Caddy). S'il est public, définir `APP_ACCESS_CODE` pour éviter que n'importe qui consomme vos quotas.

## Vérifier la configuration

```bash
npm run check:openlegi   # jeton OpenLegi + recherche de jurisprudence
npm run check:ollama     # connexion à Ollama (cloud ou local) + réponse du modèle
```

## Notes

- Modèle utilisé : `claude-opus-5-5` (voir `src/core/assistant.ts`), avec le connecteur MCP de l'API Claude : Claude appelle lui-même les outils OpenLegi. Le repli automatique (`fallbacks: "default"`) relance la requête sur un autre modèle si la première est refusée.
- Les résultats sont à vérifier sur Légifrance avant toute citation.
