# Colosse 3.6.6 — le vélo compte dans la jauge d'activité (demande du 06/10/2026)

Vérifications en **émulation iPhone 15 dans Chrome**, pas sur un vrai iPhone.

## Constat

- La jauge « Activité du jour » (accueil et onglet Poids) ne comptait que les pas : `steps / 8 000`. Le vélo saisi était affiché mais ne faisait pas avancer la jauge ; la tuile d'accueil disait « Pas et vélo à renseigner » avec 25 min de vélo saisies.
- Ce comportement venait d'une règle que Julien avait lui-même écrite le 12/09 (« PROBLÈME 9 : le vélo ne remplace pas les pas »). Il demande maintenant l'inverse pour la jauge : les tests de l'ancienne règle (activity.test, session.test 15, timed-exercises 3/3c/8) ont été réécrits.

## Règle

- Zone de pas inchangée : 8 000–12 000.
- Pas comptés = pas mesurés + minutes de vélo × facteur d'intensité (facile 0,6 · modéré 1 · soutenu 2, existant) × **160 pas par minute** (équivalence historique de l'app : « 12 000 pas OU 8 000 pas + 25 min de vélo modéré »). Réglable dans Réglages › Nutrition (« Pas par minute de vélo modéré », 40–400, champ additif `profile.bikeStepsPerMinute`).
- Aucune escalade automatique de vélo ; aucune saisie modifiée (calcul à l'affichage uniquement).
- Texte du bilan de poids (« plancher calorique atteint ») aligné sur la même équivalence.

## Relecture (1 tour)

4 défauts mineurs corrigés : réglage non borné (valeur affichée ≠ valeur utilisée) ; vélo sans plafond (faute de frappe 250 min ≈ journée validée) → plafonné à 240 min modérées ; « 100 % » affiché à 7 960 pas sans objectif atteint → 99 % ; « 4 min modérées ≈ 672 pas » incohérent → minutes affichées avec décimale.

## Corrigé au passage

La page Réglages débordait de 13 px à 393 px (champs de date : largeur minimale imposée dans une grille `1fr`) : l'iPhone la rétrécissait et les touches pouvaient se décaler. `grid-template-columns: repeat(2, minmax(0,1fr))` + `min-width:0` ; vérifié par S43 (largeur de page ≤ 393) et par mutation.

## Tests

`tests/activity.test.mjs` (comportement : vélo seul, pas + vélo, intensités, plafond, bornes, pourcentage), scénario d'interface S43 (jauge de l'onglet Poids, tuile d'accueil, réglage persistant et borné, saisies intactes ; mutation « le vélo ne compte plus » détectée).
