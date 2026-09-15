# Colosse 3.6.4 — écran de série (retours de la séance Push A du 15/09/2026)

Vérifications en **émulation iPhone 15 dans Chrome** (393×852, zones sûres simulées 59/34 px), pas sur un vrai iPhone.

## Retours de Julien et corrections

| Retour | Cause trouvée | Correction |
|---|---|---|
| « Tu scrolles vers le bas, t'as du texte et après tu as les poids » | La consigne, « Voir l'exercice », la démonstration et l'offre d'échauffement passaient avant la série ; la barre « Tous les exercices / Modifier l'ordre » était collée dans l'en-tête et coupait les chiffres | Série d'abord : pastilles, Charge, Répétitions, RIR, Valider ; consigne et aide sous le bouton ; barre d'outils hors de l'en-tête collant |
| « Je ne sais pas où est son RIR » | Aucun élément ne s'appelait RIR (« Répétitions encore possibles ») ; le blocage s'affichait en bandeau en haut, loin des cases | Libellé « RIR · répétitions encore possibles », cases dans le bloc de la série, oubli signalé sur les cases avec message juste dessous ; « Technique & douleur » marqué facultatif |
| « J'ai annulé et je suis sur la deuxième série » | Non reproduit en données (4 façons d'annuler : série 1 à chaque fois). La série en cours était une barre orange pleine, identique à une barre de progression déjà remplie | Pastilles numérotées : ✓ = faite, contour = en cours |
| Capture : contenu derrière l'heure, bandeau sur l'en-tête | En-tête collant sous la zone de l'heure transparente ; bandeaux placés en haut | Zone de l'heure couverte ; messages de fin de série dans le chrono ; bandeaux sous l'en-tête |

Poids : non modifiés (Julien : « ce n'est pas le problème des poids »).

## Relecture adverse (4 tours)

- Tour 1 : champ vidé validé avec l'ancienne valeur ; paysage ; note cachée chrono réduit ; bas des cases RIR non touchable ; cases < 44 px ; champ manquant caché par le chrono ; tests trop faibles → corrigés (S33–S35 renforcés, mutations détectées).
- Tour 2 : côté droit non recadré ; changement de variante après le seul côté gauche sans confirmation (préexistant) ; message « répétitions » pour le gainage → corrigés (S36, S37).
- Tour 3 : bouton principal hors écran sur échauffement, activation, montée en charge (préexistant) ; série 1 non cadrée après les montées ; bannière de mise à jour sur la série et sur le ✕ d'une fiche ; bandeau sur la progression → corrigés (S38).
- Tour 4 : voir la conclusion de publication.

Limite connue : sur le premier écran d'un nouvel exercice pendant « Repos avant l'exercice suivant », le chrono déployé recouvre la charge tant qu'il tourne (réduire ou passer le chrono la montre).

## Résultats

- `node --test tests/*.test.mjs` : 210/210
- `tests-ui/scenarios.cjs` : 38/38 (S33–S38 ajoutés ; S30, S32, S24 rendus indépendants du jour de la semaine)
- `tests-ui/inventaire.cjs` : 44/44
- `tests-ui/maj.cjs` 3.6.3 → 3.6.4 : 12/12, 0 écart de données d'entraînement, hors ligne OK
