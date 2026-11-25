# Arbre LLM — POC

Une conversation avec un LLM, vue comme un arbre (carte mentale) : chaque question est un nœud, chaque nouvelle question posée depuis un nœud ancien crée une branche.

Ce POC sert à juger l'ergonomie sur téléphone. **Aucun LLM n'est branché** : les réponses sont simulées.

## Ce qu'on peut faire

- **Carte** : glisser pour se déplacer, pincer (ou molette) pour zoomer, toucher une case pour la choisir. Les flèches vont de chaque question vers ses suites.
- **Icônes** : un emoji devant le mot-clé quand il illustre bien le contenu.
- **Fusion** : « Sélection », puis toucher les cases à réunir. Les cases qui les relient s'ajoutent automatiquement (en plus pâle). « Fusionner » en fait une seule case avec une pastille « +N ». Toucher cette case l'éclate.
- **Jauges** (en bas à droite) : tokens du chemin en cours et de tout l'arbre, rapportés au contexte maximal du modèle. Toucher les jauges change ce maximum (200 k, 128 k, 32 k, ou 100 pour voir l'alerte). Au-delà de 80 % du chemin, « Repartir du résumé » crée une nouvelle conversation qui part du résumé.
- **Panneau du bas** (toucher la poignée pour l'ouvrir) :
  - **Fil** : la conversation de la racine jusqu'à la case choisie. Toucher un échange y ramène la carte.
  - **Contexte LLM** : ce qui serait envoyé au LLM pour une question posée ici, soit le résumé des étapes anciennes et les 2 derniers échanges en entier, rien des branches voisines.
- **Poser une question** depuis n'importe quelle case crée une nouvelle branche.
- **Menu ⋯** : copier l'arbre en JSON, réinitialiser l'exemple (deux appuis).

## Fonctionnement

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `style.css` | Apparence (thème clair et sombre) |
| `app.js` | Données, fusion, disposition de l'arbre, dessin SVG, gestes, panneau, jauges |
| `manifest.webmanifest`, `sw.js` | Rendent le site installable (PWA) et utilisable hors connexion |
| `.github/workflows/pages.yml` | Met le site en ligne sur GitHub Pages et fabrique les icônes PNG à partir de `icon.svg` |

Un nœud est un objet `{ id, parent, q, a, kw, sum, ico }` : question, réponse, mot-clé, résumé, emoji. Le seul champ `parent` décrit tout l'arbre. Une fusion est une liste de nœuds d'un seul tenant, affichée comme une case.

Les données restent dans le navigateur (`localStorage`). Aucune bibliothèque externe, aucun serveur. Une politique de sécurité (CSP) interdit tout script tiers. Les tokens sont estimés (1 token ≈ 4 caractères).

## Installer sur téléphone

- **Android (Chrome)** : ouvrir le lien, menu ⋮ puis « Installer l'application ».
- **iPhone (Safari)** : ouvrir le lien, bouton Partager puis « Sur l'écran d'accueil ».

## Tester en local

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Étapes suivantes

1. Brancher un LLM avec la clé API de l'utilisateur (gardée sur l'appareil).
2. Générer le mot-clé, l'emoji et le résumé de chaque nœud par un second appel court, et un résumé pour chaque fusion.
3. Compter les tokens réels renvoyés par l'API au lieu de l'estimation.
4. Passer le stockage à IndexedDB, avec import et export de fichiers.

## Licence

À choisir avant publication. AGPL-3.0 envisagée (modèle open core).
