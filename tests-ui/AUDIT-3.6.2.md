# Colosse 3.6.2 — « Annuler la séance »

Problème réel (dimanche 13/09) : séance du lundi démarrée pour tester, impossible d'en sortir sans « Terminer » (qui l'enregistre).

| Situation | Avant | 3.6.2 | Test |
|---|---|---|---|
| Séance démarrée, rien de fait | seul « Terminer » | « Annuler » sur l'accueil, la liste Séance et le menu ⋯ ; confirmation « Rien n'a été fait » ; redevient « au programme » | S10, S12 |
| Séries, échauffement, rampes, chrono en cours | — | confirmation qui détaille ce qui sera effacé (avec date et durée réelle du chrono, pause comprise) et propose « Terminer » | S11, tests Node |
| Saisie non validée | — | effacée du stockage et de la mémoire : rien ne revient au redémarrage | S11, S13 |
| Séance enregistrée puis rouverte | — | jamais annulable (statut, `reopenedAt`, garde des données anciennes) | S14, tests Node |
| Chrono d'une autre séance | — | jamais coupé ; alerte si une autre séance reste en cours | S15 |
| Charges pré-remplies de la même séance la semaine suivante | — | recalculées série par série sans le test ; charges choisies à la main jamais touchées ; données d'avant 3.6.2 recalculées seulement après annonce | S16, S17, tests Node |

Revue adversariale multi-agents en 5 tours (constats vérifiés par des sceptiques indépendants) jusqu'à ne plus rien trouver ; chaque défaut confirmé a son test et une mutation qui le prouve.
