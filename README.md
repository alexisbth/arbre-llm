# Arbre LLM — POC

Une conversation avec un LLM, vue comme un arbre (carte mentale) : chaque question est un nœud, chaque nouvelle question posée depuis un nœud ancien crée une branche.

Ce POC sert à juger l'ergonomie sur téléphone. **Aucun LLM n'est branché** : les réponses sont simulées.

## Ce qu'on peut faire

- **Carte** : glisser pour se déplacer, pincer (ou molette) pour zoomer, toucher un nœud pour le choisir.
- **Panneau du bas** (toucher la poignée pour l'ouvrir) :
  - **Fil** : la conversation de la racine jusqu'au nœud choisi. Toucher un échange y ramène la carte.
  - **Contexte LLM** : ce qui serait envoyé au LLM pour une question posée ici, soit le résumé des étapes anciennes et les 2 derniers échanges en entier, rien des branches voisines.
- **Poser une question** depuis n'importe quel nœud crée une nouvelle branche.
- **Export** copie l'arbre au format JSON, **Réinit.** rétablit l'exemple (deux appuis).

## Fonctionnement

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `style.css` | Apparence (thème clair et sombre) |
| `app.js` | Données, disposition de l'arbre, dessin SVG, gestes, panneau |
| `manifest.webmanifest`, `sw.js` | Rendent le site installable (PWA) et utilisable hors connexion |
| `.github/workflows/pages.yml` | Met le site en ligne sur GitHub Pages et fabrique les icônes PNG à partir de `icon.svg` |

Un nœud est un objet `{ id, parent, q, a, kw, sum }` : question, réponse, mot-clé, résumé. Le seul champ `parent` décrit tout l'arbre.

Les données restent dans le navigateur (`localStorage`). Aucune bibliothèque externe, aucun serveur. Une politique de sécurité (CSP) interdit tout script tiers.

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
2. Générer le mot-clé et le résumé de chaque nœud par un second appel court.
3. Passer le stockage à IndexedDB, avec import et export de fichiers.

## Licence

À choisir avant publication. AGPL-3.0 envisagée (modèle open core).
