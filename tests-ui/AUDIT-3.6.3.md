# Colosse 3.6.3 — corrections de la vraie séance Pull A du 14/09/2026

| Problème vécu | Cause | Correction | Tests |
|---|---|---|---|
| « Il n'y a que deux séries par exo » | Semaines comptées depuis la date de départ du profil (5 août) → semaine 7 « Décharge » deux jours après l'installation du programme | `programStartDate` (lundi 7/09 pour un profil antérieur), réglage « Début du programme », date de départ réservée au poids ; séance terminée ou déjà travaillée figée dans sa semaine ; charges de décharge pré-remplies recalculées ; décharge annoncée clairement ; progression après décharge sur la charge habituelle | seance-reelle.test.mjs, S18, S24, S30, S32, maj.cjs |
| Pas de compte-à-rebours à la fin de l'exercice | Aucun chrono après la dernière série | « Repos avant l'exercice suivant » (repos de l'exercice, « Ensuite : … »), jamais enregistré comme repos de série ; ne bloque ni cardio ni échauffement ; son débloqué au premier toucher | S20, S25, S27 |
| « Faire maintenant » : une page qui ne sert qu'à mettre le poids | Écran « charge de référence » + montée en charge imposés | Série 1 directement ; échauffement proposé (« Faire l'échauffement », « Aller directement aux séries ») calculé sur la charge tapée ; retour au côté droit pendant les 15 s ; séance menée depuis la liste → pas d'échauffement imposé | S19, S21, S26, S27, S31 |
| Revenir à la liste et appuyer sur « + » | Refus et séance hors mode guidé laissaient sur la liste repliée | « Faire maintenant » ouvre toujours l'exercice en mode guidé | S21, S26 |
| « Bras droit puis rien » | Côté gauche invisible en liste, ressenti du gauche recopié, aucun repos après la dernière série | « ✓ Gauche fait », statut « gauche fait, droite à faire », ressenti/douleur à indiquer pour le droit (inconnu jamais compté comme RIR 0), confirmation avant d'annuler « ✓ Fait » | S20, S21, S29 |
| Bandeau orange sur la variante | Bandeau collant translucide | Bandeau à sa place, opaque ; titres jamais cachés | S22 |
| Séance restée ouverte | Reprenait la main au lancement | Accueil : « Terminer et garder mes séries » / « Reprendre » ; « En séance » mène à la séance du jour | S23, S28 |

Relecture adversariale multi-agents en 5 tours (4 tours avec défauts corrigés, 5ᵉ tour sans constat). Tests Node 210/210, scénarios iPhone 15 émulé 32/32, inventaire 44/44, mise à jour 3.6.2 → 3.6.3 12/12.
