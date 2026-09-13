# Colosse 3.6.1 — audit des fonctions (design Forge conservé)

Référence : `v3.6.0-avant-forge` (aaf2c1a) et production `forge-360` (e3df8c7).
Méthode : chaque fonction est atteinte **au doigt** dans l'interface réelle (émulation iPhone 15, 393×852, Chrome headless — pas un vrai iPhone). Un bouton replié, hors écran ou recouvert compte comme un échec.
Résultat : production 33/45 → 3.6.1 44/44 (les deux contrôles « monter/descendre » et « poignée » sont regroupés), 0 erreur JavaScript.

| Fonction d'origine | Accès en production (forge-360) | Problème | Correction 3.6.1 | Test |
|---|---|---|---|---|
| Voir tous les exercices avant de commencer | Liste Séance | Variante, matériel et avancement cachés dans « Séries & variantes » replié | Résumé visible sur chaque carte : variante + matériel en français, statut (Prochain / À faire / x/y séries / Passé), consigne | inventaire « Voir TOUS les exercices » |
| Explication / technique d'un exercice | Carte repliée ; en guidé dans « Technique & douleur » | Consigne invisible sans ouvrir un volet | Consigne visible sur la carte et sur référence, montée en charge, série ; bouton « Voir l'exercice » → fiche (variante, plan, consignes, tempo, dernière exposition de CETTE variante) | S2, S9, test Node « Chaque étape… » |
| Démonstration vidéo | ▶ sur la carte seulement | Absente en mode guidé, présentée comme une vidéo | « Rechercher une démonstration · Recherche YouTube » sur fiche, échauffement, activations, rampes, série, cardio ; variante incluse ; saisie conservée au retour | S2 |
| Choisir l'exercice suivant (machine libre) | ⋯ → Réorganiser | Pas de « Faire maintenant » | « Faire maintenant » sur carte et fiche : l'exercice passe avant le premier exercice à faire, séries/variante/« passé » intacts ; ordre par défaut non modifié | S3, tests Node bringToFront |
| Modifier l'ordre | ⋯ → Réorganiser | Pas d'accès direct dans la vue séance | « Modifier l'ordre » dans la liste et en tête de chaque écran guidé (flèches + poignée au doigt) ; mémoriser / restaurer inchangés | S4, inventaire |
| Revenir à la liste depuis l'échauffement | Flèche retour | Pas de « Tous les exercices » | « Tous les exercices » + « Modifier l'ordre » sur toutes les étapes | inventaire, test Node |
| Revenir à la liste depuis une série | « Toutes les séries & variantes » en bas | Libellé ambigu | « Tous les exercices » en tête ; bouton du bas renommé « Séries, variante & corrections de cet exercice » | inventaire |
| Échauffement général | Tapis uniquement | Pas de vélo | Choix Vélo / Tapis avant de démarrer, préférence mémorisable (bouton ou Réglages), choix figé pendant le chrono, écran vélo sans vitesse ni inclinaison, anciens échauffements non convertis | S1, tests Node vélo |
| Saisie non validée | Brouillon en mémoire, un seul | Perdu en changeant d'exercice ou en rechargeant | Brouillons isolés séance/exercice/variante/série/côté, récupérés après rechargement ou hors ligne, jamais comptés comme séries, nettoyés à la fin | S4, S6, maj.cjs, tests Node brouillons |
| Changer d'exercice pendant un chrono | — | — | Repos : confirmation explicite, repos arrêté sur SA série (durée réelle) ; changement de côté : refus expliqué ; cardio : arrêt incomplet confirmé ; aucun chrono réaffecté | S5, S6, tests Node décision |
| Réorganiser pendant un chrono | Panneau bloqué | Aucune issue proposée | Explication + « Arrêter le chrono et modifier l'ordre » (confirmation) | test Node |
| Messages temporaires | Toast en haut du mode guidé | Recouvrait « Tous les exercices » | Toast placé sous l'en-tête et ne capte plus les touchers | S1 |
| Variantes, séries, passer/réactiver, état du jour, notes, démarrer/terminer/reprendre, chronos (−, pause, +15, passer), check-in, pas/vélo, courbes, historique, prescriptions, recherche, profil, nutrition, préférences, export/import | Inchangés | — | Aucune modification | inventaire (44), S7, S8, suite Node |
| Mise à jour et hors ligne | forge-360 | — | forge-361 : bannière, ancien cache supprimé, données identiques (empreinte IndexedDB), séance reprise au bon endroit, hors ligne complet | maj.cjs (11/11) |

## Rejouer

```bash
node --test tests/*.test.mjs
node tests-ui/scenarios.cjs <dossier de l'app>
node tests-ui/inventaire.cjs <dossier de l'app>
node tests-ui/maj.cjs <dossier version précédente> <dossier nouvelle version>
```
