# Arbre LLM — POC

Une conversation avec un LLM, vue comme un arbre (carte mentale) : chaque question est un nœud, chaque nouvelle question posée depuis un nœud ancien crée une branche.

Ce POC sert à juger l'ergonomie sur téléphone. Sans clé API, il fonctionne en **mode démo** (réponses simulées). Avec une clé API Anthropic, il interroge **Claude**.

## Ce qu'on peut faire

- **Carte** : glisser pour se déplacer, pincer (ou molette) pour zoomer, toucher une case pour la choisir. Les flèches vont de chaque question vers ses suites.
- **Icônes** : un emoji devant le mot-clé quand il illustre bien le contenu.
- **Fusion** : « Sélection », puis toucher les cases à réunir. Les cases qui les relient s'ajoutent automatiquement (en plus pâle). « Fusionner » en fait une seule case avec une pastille « +N ». Toucher cette case l'éclate.
- **Jauges** (en bas à droite) : tokens du chemin en cours et de tout l'arbre, rapportés au contexte maximal du modèle. Toucher les jauges change ce maximum (200 k, 128 k, 32 k, ou 100 pour voir l'alerte). Au-delà de 80 % du chemin, « Repartir du résumé » crée une nouvelle conversation qui part du résumé.
- **Panneau du bas** (toucher la poignée pour l'ouvrir) :
  - **Fil** : la conversation de la racine jusqu'à la case choisie. Toucher un échange y ramène la carte.
  - **Contexte LLM** : ce qui serait envoyé au LLM pour une question posée ici, soit le résumé des étapes anciennes et les 2 derniers échanges en entier, rien des branches voisines.
- **Poser une question** depuis n'importe quelle case crée une nouvelle branche.
- **Claude** : menu ⋯ → « Réglages du LLM », coller sa clé API (créée dans la Claude Console, platform.claude.com) et choisir le modèle. La réponse s'affiche au fil de l'eau. Ensuite, Haiku remplit la fiche de la case (mot-clé, emoji, résumé). En cas d'erreur, un bouton « Réessayer » apparaît dans le fil.
- **Menu ⋯** : réglages du LLM, copier l'arbre en JSON, réinitialiser l'exemple (deux appuis).

## Clé API et sécurité

- La clé reste sur l'appareil. Elle n'est envoyée qu'à `api.anthropic.com`, que la politique de sécurité (CSP) de la page est seule à autoriser.
- Elle n'est gardée après fermeture que si « Garder la clé sur cet appareil » est coché. Elle n'est jamais incluse dans l'export JSON.
- L'abonnement Claude (Pro…) n'inclut pas l'API : elle est facturée à part dans la Claude Console. Fixer une limite de dépenses.

## Fonctionnement

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `style.css` | Apparence (thème clair et sombre) |
| `app.js` | Données, fusion, disposition de l'arbre, dessin SVG, gestes, panneau, jauges |
| `manifest.webmanifest`, `sw.js` | Rendent le site installable (PWA) et utilisable hors connexion |
| `.github/workflows/pages.yml` | Met le site en ligne sur GitHub Pages et fabrique les icônes PNG à partir de `icon.svg` |

Un nœud est un objet `{ id, parent, q, a, kw, sum, ico }` : question, réponse, mot-clé, résumé, emoji. Le seul champ `parent` décrit tout l'arbre. Une fusion est une liste de nœuds d'un seul tenant, affichée comme une case.

Pour une question posée depuis une case, l'appli envoie à Claude : une consigne, le résumé des étapes anciennes du chemin, les 2 derniers échanges en entier, puis la question. Les branches voisines ne sont jamais envoyées.

Les données restent dans le navigateur (`localStorage`). Aucune bibliothèque externe, aucun serveur. Une politique de sécurité (CSP) interdit tout script tiers. Les jauges utilisent le nombre réel de tokens de réponse renvoyé par l'API quand il est connu, sinon une estimation (1 token ≈ 4 caractères).

## Installer sur téléphone

- **Android (Chrome)** : ouvrir le lien, menu ⋮ puis « Installer l'application ».
- **iPhone (Safari)** : ouvrir le lien, bouton Partager puis « Sur l'écran d'accueil ».

## Tester en local

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Étapes suivantes

1. Synchronisation et partage avec Supabase (données chiffrées sur l'appareil) : partie premium.
2. Autres fournisseurs de LLM (OpenAI, Mistral, modèle local).
3. Résumé par le LLM de chaque case fusionnée.
4. Passer le stockage à IndexedDB, avec import et export de fichiers.

## Licence

À choisir avant publication. AGPL-3.0 envisagée (modèle open core).
