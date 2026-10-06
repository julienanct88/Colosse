# Colosse 3.6.5 — « 3 séries minimum, jamais 2 » (demande du 06/10/2026)

Vérifications en **émulation iPhone 15 dans Chrome** (393×852), pas sur un vrai iPhone.

## Constat avant de coder

- Le programme installé le 12/09 correspond **exactement** à la spécification de Julien (39 exercices sur 39, séries et répétitions identiques).
- Cette spécification contenait **8 exercices à 2 séries** : tirage unilatéral (2 × 10–12 *par bras*), curl marteau, push-down corde, rowing haut coudes ouverts, curl câble, écartés poulie (Push B), presse pieds plus hauts, leg extension (Legs B).
- Lundi 05/10 (Pull A, semaine 5, pas de décharge) : tirage unilatéral et curl marteau affichaient donc 2 séries — conformément à la spec, pas un recul.
- Julien veut 3 séries minimum : les 8 exercices passent à 3. Répétitions, repos, tempos, catégories : inchangés. Unilatéral : 3 **par bras** (comme les fentes).

## Ce qui est protégé

| Risque | Protection |
|---|---|
| Une séance déjà faite (2 séries) rejugée sur 3 → « trop incomplète », charge bloquée (`HOLD_INCOMPLETE`) | `getExercisePlanForSession` : une séance antérieure à la révision (`date < 2026-10-06`, ou terminée avant `SETS_REVISION_TIMESTAMP`) garde son plan d'alors ; utilisée par l'historique, les comptes de séries, le statut, la récupération, le pré-remplissage |
| Une séance terminée « complétée » d'une série vide en la consultant | Le plan d'une séance antérieure reste à 2 : `syncSession` n'ajoute rien |
| Une séance préparée à 2 séries | Elle reçoit sa 3e série ; si les séries précédentes portent la charge **pré-remplie**, la 3e la reprend (marque `autoSeed` étendue) ; une charge saisie à la main n'est jamais copiée |
| Décharge (semaine 7) | 3 séries → 2 (50 %), comme avant pour les exercices à 3 ; séance de décharge antérieure à 1 série conservée |

## Tests

- `tests/trois-series.test.mjs` (comportement) : 43 exercices de musculation ≥ 3 séries hors décharge ; 8 passent à 3, 35 inchangés ; répétitions/repos inchangés ; décharge ; plan d'une séance antérieure ; historique d'une exposition à 2 séries non « incomplète » et charge qui monte.
- Scénarios d'interface S39 (séance du 05/10 intacte, lundi 12 à 3 séries avec charge recalculée) et S40 (3e série ajoutée avec la charge pré-remplie, charge saisie non copiée), sur horloge simulée.
- Ancien tests « 2 séries » mis à jour (tirage unilatéral, Pull A).
