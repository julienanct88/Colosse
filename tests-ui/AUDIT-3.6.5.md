# Colosse 3.6.5 — « 3 séries minimum, jamais 2 » (demande du 06/10/2026)

Vérifications en **émulation iPhone 15 dans Chrome** (393×852), pas sur un vrai iPhone.

## Constat avant de coder

- Le programme installé le 12/09 correspond **exactement** à la spécification de Julien (39 exercices sur 39, séries et répétitions identiques).
- Cette spécification contenait **8 exercices à 2 séries** : tirage unilatéral (2 × 10–12 *par bras*), curl marteau, push-down corde, rowing haut coudes ouverts, curl câble, écartés poulie (Push B), presse pieds plus hauts, leg extension (Legs B).
- Lundi 05/10 (Pull A, semaine 5, pas de décharge) : tirage unilatéral et curl marteau affichaient donc 2 séries — conformément à la spec, pas un recul.
- Julien veut 3 séries minimum : les 8 exercices passent à 3. Répétitions, repos, tempos, catégories : inchangés. Unilatéral : 3 **par bras** (comme les fentes).

## Ce qui est protégé

Règle (marqueur `setsRevision` écrit sur chaque séance par la nouvelle version, `getExercisePlanForSession`) : une séance **sans marqueur et avec des traces de travail** (début, fin, série validée, côté fait, répétitions saisies) a été faite avec l'ancien programme et garde ses 2 séries prévues. Une séance sans trace de travail reçoit le marqueur et suit le programme actuel. Une séance créée par la nouvelle version a le marqueur dès sa création.

Ni la date de la séance (c'est le jour *prévu*) ni une heure de mise en ligne ne sont utilisées : un premier essai avec un repère horaire a été écarté par la relecture (une séance faite aujourd'hui sur l'ancienne version, avant la mise à jour de l'appareil, aurait été rejugée sur 3 séries ; les séances importées de Colosse v2, sans heure de début, aussi).

| Risque | Protection |
|---|---|
| Une séance déjà faite (2 séries) rejugée sur 3 → « trop incomplète », charge bloquée (`HOLD_INCOMPLETE`) | plan d'avant pour toute séance faite sans marqueur : historique, comptes de séries, statut, récupération, pré-remplissage |
| Une séance terminée « complétée » d'une série vide en la consultant | son plan reste à 2 : `syncSession` n'ajoute rien |
| Une séance préparée à 2 séries | elle reçoit le marqueur et sa 3e série ; si les séries précédentes portent la charge **pré-remplie**, la 3e la reprend (marque `autoSeed` étendue) ; une charge saisie n'est jamais copiée |
| Séance faite sur l'ancienne version après la mise en ligne, appareil pas encore mis à jour | pas de marqueur + traces → ancien plan |
| Décharge (semaine 7) | 3 séries → 2 (50 %) ; séance de décharge antérieure à 1 série conservée |

## Tests

- `tests/trois-series.test.mjs` (comportement) : 43 exercices de musculation ≥ 3 séries hors décharge ; 8 passent à 3, 35 inchangés ; répétitions/repos inchangés ; décharge ; plan d'une séance antérieure ; historique d'une exposition à 2 séries non « incomplète » et charge qui monte.
- Scénarios d'interface S39 (séance du 05/10 intacte, lundi 12 à 3 séries avec charge recalculée), S40 (3e série ajoutée avec la charge pré-remplie, charge saisie non copiée) et S41 (séance faite aujourd'hui sur l'ancienne version : inchangée, 22/22), sur horloge simulée pour S39/S40. Chaque protection est vérifiée par mutation (retirée → le scénario échoue).
- Ancien tests « 2 séries » mis à jour (tirage unilatéral, Pull A).
