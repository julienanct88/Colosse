function variant(id, label, equipment, incrementKg) {
    return { id, label, equipment, incrementKg };
}
function exercise(input) {
    return input;
}
export const TRAINING_DAYS = [
    {
        id: 'push-a',
        name: 'Push A',
        weekday: 1,
        focus: 'Pectoraux · deltoïdes · triceps',
        color: '#ef4444',
        generalWarmupSec: 300,
        occupiedBufferSec: 330,
        exercises: [
            exercise({
                id: 'push-a-chest-press', name: 'Développé couché / presse poitrine', shortName: 'Presse poitrine',
                category: 'upper_compound', sets: 3, repMin: 6, repMax: 10, targetRir: 2, restSec: 150,
                executionSec: 40, transitionSec: 60, warmupSec: 240, priority: 1,
                coachingCue: 'Omoplates fixées, pieds ancrés, descente contrôlée. Aucun rebond.',
                variants: [
                    variant('machine-convergente', 'Machine convergente', 'machine', 2.5),
                    variant('smith', 'Smith', 'machine', 2.5),
                    variant('barre', 'Barre libre', 'barbell', 2.5),
                ],
            }),
            exercise({
                id: 'push-a-incline', name: 'Développé incliné', shortName: 'Développé incliné',
                category: 'upper_compound', sets: 3, repMin: 8, repMax: 12, targetRir: 2, restSec: 120,
                executionSec: 40, transitionSec: 55, warmupSec: 120, priority: 1,
                coachingCue: 'Inclinaison modérée, coudes sous les poignets, amplitude stable.',
                variants: [
                    variant('halteres', 'Haltères', 'dumbbell', 2),
                    variant('machine-inclinee', 'Machine inclinée', 'machine', 2.5),
                    variant('smith-incline', 'Smith incliné', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'push-a-fly', name: 'Écartés', shortName: 'Écartés',
                category: 'isolation', sets: 2, repMin: 12, repMax: 18, targetRir: 2, restSec: 60,
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 2, superset: 'push-a-pair',
                coachingCue: 'Bras légèrement fléchis, poitrine haute, tension continue.',
                variants: [
                    variant('cable-high', 'Poulies hautes', 'cable', 1.25),
                    variant('pec-deck', 'Pec deck', 'machine', 2.5),
                    variant('halteres-fly', 'Haltères', 'dumbbell', 2),
                ],
            }),
            exercise({
                id: 'push-a-lateral', name: 'Élévations latérales', shortName: 'Élévations latérales',
                category: 'isolation', sets: 3, repMin: 12, repMax: 20, targetRir: 2, restSec: 60,
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 1, superset: 'push-a-pair',
                coachingCue: 'Monte les coudes, pas les mains. Pas d’élan du tronc.',
                variants: [
                    variant('machine-lateral', 'Machine', 'machine', 2.5),
                    variant('cable-lateral', 'Poulie unilatérale', 'cable', 1.25),
                    variant('db-lateral', 'Haltères', 'dumbbell', 1),
                ],
            }),
            exercise({
                id: 'push-a-triceps-overhead', name: 'Extension triceps au-dessus de la tête', shortName: 'Triceps overhead',
                category: 'isolation', sets: 3, repMin: 10, repMax: 15, targetRir: 2, restSec: 75,
                executionSec: 30, transitionSec: 50, warmupSec: 0, priority: 2,
                coachingCue: 'Coudes stables, étirement complet de la longue portion.',
                variants: [
                    variant('rope-overhead', 'Corde', 'cable', 1.25),
                    variant('ez-overhead', 'Barre EZ', 'barbell', 2.5),
                    variant('db-overhead', 'Haltère', 'dumbbell', 2),
                ],
            }),
            exercise({
                id: 'push-a-abs', name: 'Crunch lesté', shortName: 'Crunch',
                category: 'core', sets: 2, repMin: 10, repMax: 15, targetRir: 2, restSec: 60,
                executionSec: 30, transitionSec: 40, warmupSec: 0, priority: 4, optional: true,
                coachingCue: 'Enroule le sternum vers le bassin, sans tirer avec les bras.',
                variants: [
                    variant('cable-crunch', 'Poulie haute', 'cable', 1.25),
                    variant('machine-crunch', 'Machine', 'machine', 2.5),
                ],
            }),
        ],
    },
    {
        id: 'pull-a',
        name: 'Pull A',
        weekday: 2,
        focus: 'Largeur et épaisseur du dos · biceps',
        color: '#3b82f6',
        generalWarmupSec: 300,
        occupiedBufferSec: 330,
        exercises: [
            exercise({
                id: 'pull-a-pulldown', name: 'Tirage vertical prise neutre', shortName: 'Tirage vertical',
                category: 'upper_compound', sets: 3, repMin: 6, repMax: 10, targetRir: 2, restSec: 150,
                executionSec: 40, transitionSec: 60, warmupSec: 180, priority: 1,
                coachingCue: 'Déprime les omoplates puis amène les coudes vers les hanches.',
                variants: [
                    variant('neutral-pulldown', 'Poulie prise neutre', 'machine', 2.5),
                    variant('assisted-pullup', 'Tractions assistées', 'machine', 2.5),
                    variant('pullup', 'Tractions / lest', 'bodyweight', 1.25),
                ],
            }),
            exercise({
                id: 'pull-a-row', name: 'Rowing avec appui thoracique', shortName: 'Rowing appuyé',
                category: 'upper_compound', sets: 3, repMin: 8, repMax: 12, targetRir: 2, restSec: 120,
                executionSec: 40, transitionSec: 55, warmupSec: 120, priority: 1,
                coachingCue: 'Poitrine collée au support, pause brève en contraction.',
                variants: [
                    variant('chest-row-machine', 'Machine convergente', 'machine', 2.5),
                    variant('tbar-supported', 'T-bar appuyé', 'machine', 2.5),
                    variant('incline-db-row', 'Haltères sur banc', 'dumbbell', 2),
                ],
            }),
            exercise({
                id: 'pull-a-onearm', name: 'Rowing unilatéral', shortName: 'Rowing unilatéral',
                category: 'upper_compound', sets: 2, repMin: 10, repMax: 15, targetRir: 2, restSec: 75,
                executionSec: 45, transitionSec: 45, warmupSec: 0, priority: 2, superset: 'pull-a-pair',
                coachingCue: 'Épaule basse, coude vers la poche arrière, bassin fixe.',
                variants: [
                    variant('onearm-cable', 'Poulie unilatérale', 'cable', 1.25),
                    variant('onearm-db', 'Haltère', 'dumbbell', 2),
                    variant('onearm-machine', 'Machine unilatérale', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'pull-a-reardelt', name: 'Deltoïdes postérieurs', shortName: 'Arrière d’épaule',
                category: 'isolation', sets: 3, repMin: 12, repMax: 20, targetRir: 2, restSec: 60,
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 1, superset: 'pull-a-pair',
                coachingCue: 'Écarte avec les coudes, sans hausser les épaules.',
                variants: [
                    variant('reverse-pecdeck', 'Reverse pec deck', 'machine', 2.5),
                    variant('facepull', 'Face pull', 'cable', 1.25),
                    variant('rear-db', 'Haltères', 'dumbbell', 1),
                ],
            }),
            exercise({
                id: 'pull-a-ezcurl', name: 'Curl barre EZ', shortName: 'Curl EZ',
                category: 'isolation', sets: 3, repMin: 8, repMax: 12, targetRir: 2, restSec: 75,
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 2,
                coachingCue: 'Coudes fixes, pas de balancier, extension presque complète.',
                variants: [
                    variant('ez-curl', 'Barre EZ', 'barbell', 2.5),
                    variant('cable-curl', 'Poulie', 'cable', 1.25),
                    variant('machine-curl', 'Machine', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'pull-a-hammer', name: 'Curl marteau', shortName: 'Curl marteau',
                category: 'isolation', sets: 2, repMin: 10, repMax: 15, targetRir: 2, restSec: 60,
                executionSec: 30, transitionSec: 40, warmupSec: 0, priority: 3,
                coachingCue: 'Poignets neutres, coude immobile, contrôle de la descente.',
                variants: [
                    variant('db-hammer', 'Haltères', 'dumbbell', 2),
                    variant('rope-hammer', 'Corde', 'cable', 1.25),
                ],
            }),
        ],
    },
    {
        id: 'legs-a',
        name: 'Legs A',
        weekday: 3,
        focus: 'Quadriceps · fessiers · ischio-jambiers',
        color: '#10b981',
        generalWarmupSec: 360,
        occupiedBufferSec: 360,
        exercises: [
            exercise({
                id: 'legs-a-squat', name: 'Hack squat / squat guidé', shortName: 'Hack squat',
                category: 'lower_compound', sets: 3, repMin: 6, repMax: 10, targetRir: 2, restSec: 180,
                executionSec: 50, transitionSec: 70, warmupSec: 300, priority: 1,
                coachingCue: 'Pieds stables, genoux dans l’axe, profondeur reproductible.',
                variants: [
                    variant('hack-squat', 'Hack squat', 'machine', 5),
                    variant('pendulum', 'Pendulum squat', 'machine', 5),
                    variant('smith-squat', 'Smith squat', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'legs-a-hipthrust', name: 'Hip thrust', shortName: 'Hip thrust',
                category: 'lower_compound', sets: 3, repMin: 8, repMax: 12, targetRir: 2, restSec: 150,
                executionSec: 45, transitionSec: 60, warmupSec: 180, priority: 1,
                coachingCue: 'Rétroversion du bassin en haut, tibias verticaux, pas d’hyperextension lombaire.',
                variants: [
                    variant('hip-machine', 'Machine', 'machine', 5),
                    variant('hip-smith', 'Smith', 'machine', 2.5),
                    variant('hip-barbell', 'Barre', 'barbell', 5),
                ],
            }),
            exercise({
                id: 'legs-a-bulgarian', name: 'Split squat bulgare', shortName: 'Bulgare',
                category: 'lower_compound', sets: 2, repMin: 8, repMax: 12, targetRir: 2, restSec: 120,
                executionSec: 60, transitionSec: 55, warmupSec: 60, priority: 2,
                coachingCue: 'Buste légèrement incliné, genou stable, même amplitude des deux côtés.',
                variants: [
                    variant('bulgarian-db', 'Haltères', 'dumbbell', 2),
                    variant('bulgarian-smith', 'Smith', 'machine', 2.5),
                    variant('single-leg-press', 'Presse unilatérale', 'machine', 5),
                ],
            }),
            exercise({
                id: 'legs-a-curl', name: 'Leg curl', shortName: 'Leg curl',
                category: 'isolation', sets: 3, repMin: 10, repMax: 15, targetRir: 2, restSec: 75,
                executionSec: 35, transitionSec: 45, warmupSec: 0, priority: 2,
                coachingCue: 'Bassin plaqué, contraction complète, descente lente.',
                variants: [
                    variant('lying-curl', 'Allongé', 'machine', 2.5),
                    variant('seated-curl', 'Assis', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'legs-a-calves', name: 'Mollets', shortName: 'Mollets',
                category: 'isolation', sets: 3, repMin: 10, repMax: 15, targetRir: 2, restSec: 60,
                executionSec: 35, transitionSec: 40, warmupSec: 0, priority: 3, superset: 'legs-a-pair',
                coachingCue: 'Pause en bas et en haut, amplitude maximale sans rebond.',
                variants: [
                    variant('standing-calf', 'Debout', 'machine', 5),
                    variant('press-calf', 'À la presse', 'machine', 5),
                ],
            }),
            exercise({
                id: 'legs-a-abs', name: 'Relevés de genoux', shortName: 'Abdos',
                category: 'core', sets: 2, repMin: 8, repMax: 15, targetRir: 2, restSec: 60,
                executionSec: 35, transitionSec: 40, warmupSec: 0, priority: 4, optional: true, superset: 'legs-a-pair',
                coachingCue: 'Rétroverse le bassin, évite de simplement balancer les jambes.',
                variants: [
                    variant('hanging-knee', 'Suspendu', 'bodyweight', 1),
                    variant('captain-chair', 'Chaise romaine', 'bodyweight', 1),
                ],
            }),
        ],
    },
    {
        id: 'push-b',
        name: 'Push B',
        weekday: 4,
        focus: 'Haut de pectoraux · épaules · triceps',
        color: '#f97316',
        generalWarmupSec: 300,
        occupiedBufferSec: 330,
        exercises: [
            exercise({
                id: 'push-b-incline', name: 'Développé incliné lourd', shortName: 'Incliné lourd',
                category: 'upper_compound', sets: 3, repMin: 6, repMax: 10, targetRir: 2, restSec: 150,
                executionSec: 40, transitionSec: 60, warmupSec: 240, priority: 1,
                coachingCue: 'Trajectoire constante, poitrine haute, verrouillage sans perdre les omoplates.',
                variants: [
                    variant('incline-machine', 'Machine convergente', 'machine', 2.5),
                    variant('incline-smith', 'Smith', 'machine', 2.5),
                    variant('incline-barbell', 'Barre', 'barbell', 2.5),
                ],
            }),
            exercise({
                id: 'push-b-shoulder', name: 'Développé épaules', shortName: 'Développé épaules',
                category: 'upper_compound', sets: 3, repMin: 8, repMax: 12, targetRir: 2, restSec: 120,
                executionSec: 40, transitionSec: 55, warmupSec: 120, priority: 1,
                coachingCue: 'Avant-bras verticaux, cage contrôlée, pas d’hyperextension.',
                variants: [
                    variant('shoulder-machine', 'Machine', 'machine', 2.5),
                    variant('shoulder-db', 'Haltères', 'dumbbell', 2),
                    variant('shoulder-smith', 'Smith', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'push-b-chest', name: 'Presse poitrine secondaire', shortName: 'Presse secondaire',
                category: 'upper_compound', sets: 2, repMin: 8, repMax: 12, targetRir: 2, restSec: 120,
                executionSec: 40, transitionSec: 50, warmupSec: 60, priority: 2,
                coachingCue: 'Charge modérée, amplitude complète, aucune série forcée.',
                variants: [
                    variant('flat-machine', 'Machine horizontale', 'machine', 2.5),
                    variant('assisted-dips', 'Dips assistés / lestés', 'machine', 2.5),
                    variant('db-flat', 'Haltères', 'dumbbell', 2),
                ],
            }),
            exercise({
                id: 'push-b-lateral', name: 'Élévations latérales câble', shortName: 'Latérales câble',
                category: 'isolation', sets: 3, repMin: 12, repMax: 20, targetRir: 2, restSec: 60,
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 1, superset: 'push-b-pair',
                coachingCue: 'Tension continue, épaule basse, montée contrôlée.',
                variants: [
                    variant('cable-lateral-b', 'Poulie unilatérale', 'cable', 1.25),
                    variant('machine-lateral-b', 'Machine', 'machine', 2.5),
                    variant('db-lateral-b', 'Haltères', 'dumbbell', 1),
                ],
            }),
            exercise({
                id: 'push-b-triceps', name: 'Extension triceps à la poulie', shortName: 'Pushdown',
                category: 'isolation', sets: 3, repMin: 10, repMax: 15, targetRir: 2, restSec: 60,
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 2, superset: 'push-b-pair',
                coachingCue: 'Coudes collés, extension complète, retour contrôlé.',
                variants: [
                    variant('rope-pushdown', 'Corde', 'cable', 1.25),
                    variant('bar-pushdown', 'Barre droite', 'cable', 1.25),
                    variant('machine-dip', 'Machine dips', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'push-b-fly', name: 'Écartés bas vers haut', shortName: 'Écartés inclinés',
                category: 'isolation', sets: 2, repMin: 12, repMax: 18, targetRir: 2, restSec: 60,
                executionSec: 30, transitionSec: 40, warmupSec: 0, priority: 4, optional: true,
                coachingCue: 'Conduis les mains vers le haut du sternum sans hausser les épaules.',
                variants: [
                    variant('low-high-cable', 'Poulie bas-haut', 'cable', 1.25),
                    variant('incline-pecdeck', 'Pec deck incliné', 'machine', 2.5),
                ],
            }),
        ],
    },
    {
        id: 'pull-b',
        name: 'Pull B',
        weekday: 5,
        focus: 'Dorsaux · arrière d’épaule · biceps',
        color: '#8b5cf6',
        generalWarmupSec: 300,
        occupiedBufferSec: 330,
        exercises: [
            exercise({
                id: 'pull-b-pulldown', name: 'Tirage vertical', shortName: 'Tirage vertical',
                category: 'upper_compound', sets: 3, repMin: 8, repMax: 12, targetRir: 2, restSec: 120,
                executionSec: 40, transitionSec: 60, warmupSec: 180, priority: 1,
                coachingCue: 'Étirement contrôlé en haut, coudes vers le bas, pas de balancier.',
                variants: [
                    variant('wide-pulldown', 'Prise semi-large', 'machine', 2.5),
                    variant('neutral-pulldown-b', 'Prise neutre', 'machine', 2.5),
                    variant('pullup-b', 'Tractions', 'bodyweight', 1.25),
                ],
            }),
            exercise({
                id: 'pull-b-tbar', name: 'Rowing lourd', shortName: 'Rowing lourd',
                category: 'upper_compound', sets: 3, repMin: 6, repMax: 10, targetRir: 2, restSec: 150,
                executionSec: 40, transitionSec: 60, warmupSec: 180, priority: 1,
                coachingCue: 'Buste stable, traction par les coudes, pause sans arracher.',
                variants: [
                    variant('tbar-b', 'T-bar appuyé', 'machine', 2.5),
                    variant('machine-row-b', 'Machine convergente', 'machine', 2.5),
                    variant('cable-row-b', 'Poulie basse', 'cable', 2.5),
                ],
            }),
            exercise({
                id: 'pull-b-pullover', name: 'Pull-over bras tendus', shortName: 'Pull-over câble',
                category: 'isolation', sets: 2, repMin: 12, repMax: 15, targetRir: 2, restSec: 60,
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 2, superset: 'pull-b-pair',
                coachingCue: 'Côtes basses, coudes presque fixes, termine vers les poches.',
                variants: [
                    variant('straight-arm', 'Poulie haute', 'cable', 1.25),
                    variant('pullover-machine', 'Machine pull-over', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'pull-b-reardelt', name: 'Oiseau / reverse fly', shortName: 'Arrière d’épaule',
                category: 'isolation', sets: 3, repMin: 12, repMax: 20, targetRir: 2, restSec: 60,
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 1, superset: 'pull-b-pair',
                coachingCue: 'Mouvement depuis l’épaule, cou détendu, amplitude sans élan.',
                variants: [
                    variant('reverse-pecdeck-b', 'Reverse pec deck', 'machine', 2.5),
                    variant('rear-cable-b', 'Poulies', 'cable', 1.25),
                    variant('rear-db-b', 'Haltères', 'dumbbell', 1),
                ],
            }),
            exercise({
                id: 'pull-b-preacher', name: 'Curl pupitre', shortName: 'Curl pupitre',
                category: 'isolation', sets: 3, repMin: 8, repMax: 12, targetRir: 2, restSec: 75,
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 2,
                coachingCue: 'Bras plaqués, pas de rebond en bas, flexion complète.',
                variants: [
                    variant('preacher-machine', 'Machine', 'machine', 2.5),
                    variant('preacher-ez', 'Barre EZ', 'barbell', 2.5),
                    variant('preacher-db', 'Haltère unilatéral', 'dumbbell', 1),
                ],
            }),
            exercise({
                id: 'pull-b-curl', name: 'Curl câble en tension continue', shortName: 'Curl câble',
                category: 'isolation', sets: 2, repMin: 12, repMax: 15, targetRir: 2, restSec: 60,
                executionSec: 30, transitionSec: 40, warmupSec: 0, priority: 3,
                coachingCue: 'Épaules immobiles, paumes vers le haut, contrôle total.',
                variants: [
                    variant('cable-curl-b', 'Poulie', 'cable', 1.25),
                    variant('incline-curl-b', 'Curl incliné', 'dumbbell', 2),
                ],
            }),
        ],
    },
    {
        id: 'legs-b',
        name: 'Legs B',
        weekday: 6,
        focus: 'Fessiers · ischio-jambiers · cuisses',
        color: '#06b6d4',
        generalWarmupSec: 360,
        occupiedBufferSec: 360,
        exercises: [
            exercise({
                id: 'legs-b-rdl', name: 'Soulevé de terre roumain', shortName: 'RDL',
                category: 'lower_compound', sets: 3, repMin: 6, repMax: 10, targetRir: 2, restSec: 180,
                executionSec: 50, transitionSec: 70, warmupSec: 300, priority: 1,
                coachingCue: 'Hanches en arrière, barre proche des jambes, stop avant l’arrondi lombaire.',
                variants: [
                    variant('rdl-smith', 'Smith', 'machine', 2.5),
                    variant('rdl-barbell', 'Barre', 'barbell', 5),
                    variant('rdl-db', 'Haltères', 'dumbbell', 4),
                ],
            }),
            exercise({
                id: 'legs-b-press', name: 'Presse à cuisses pieds hauts', shortName: 'Presse pieds hauts',
                category: 'lower_compound', sets: 3, repMin: 10, repMax: 15, targetRir: 2, restSec: 150,
                executionSec: 50, transitionSec: 65, warmupSec: 180, priority: 1,
                coachingCue: 'Bassin collé, genoux dans l’axe, amplitude sans rétroversion excessive.',
                variants: [
                    variant('legpress-high', 'Presse 45°', 'machine', 5),
                    variant('horizontal-press', 'Presse horizontale', 'machine', 5),
                    variant('hack-high', 'Hack pieds hauts', 'machine', 5),
                ],
            }),
            exercise({
                id: 'legs-b-extension45', name: 'Extension à 45° dominante fessiers', shortName: 'Extension 45°',
                category: 'lower_compound', sets: 2, repMin: 10, repMax: 15, targetRir: 2, restSec: 90,
                executionSec: 40, transitionSec: 50, warmupSec: 60, priority: 2,
                coachingCue: 'Dos neutre, mouvement de hanche, verrouille avec les fessiers.',
                variants: [
                    variant('back-extension', 'Banc 45°', 'bodyweight', 2.5),
                    variant('glute-machine', 'Machine extension hanche', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'legs-b-curl', name: 'Leg curl assis', shortName: 'Leg curl assis',
                category: 'isolation', sets: 3, repMin: 10, repMax: 15, targetRir: 2, restSec: 75,
                executionSec: 35, transitionSec: 45, warmupSec: 0, priority: 2,
                coachingCue: 'Cuisse plaquée, contraction complète, retour en trois secondes.',
                variants: [
                    variant('seated-curl-b', 'Assis', 'machine', 2.5),
                    variant('lying-curl-b', 'Allongé', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'legs-b-abduction', name: 'Abduction de hanches', shortName: 'Abduction',
                category: 'isolation', sets: 2, repMin: 15, repMax: 25, targetRir: 2, restSec: 60,
                executionSec: 35, transitionSec: 40, warmupSec: 0, priority: 2, superset: 'legs-b-pair',
                coachingCue: 'Bassin stable, amplitude contrôlée, pause en ouverture.',
                variants: [
                    variant('abduction-machine', 'Machine', 'machine', 2.5),
                    variant('abduction-cable', 'Poulie', 'cable', 1.25),
                ],
            }),
            exercise({
                id: 'legs-b-calves', name: 'Mollets assis', shortName: 'Mollets assis',
                category: 'isolation', sets: 3, repMin: 12, repMax: 20, targetRir: 2, restSec: 60,
                executionSec: 35, transitionSec: 40, warmupSec: 0, priority: 3, superset: 'legs-b-pair',
                coachingCue: 'Étirement profond, pause en haut, aucune impulsion.',
                variants: [
                    variant('seated-calf', 'Machine assise', 'machine', 2.5),
                    variant('smith-seated-calf', 'Smith', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'legs-b-abs', name: 'Roue abdominale', shortName: 'Ab wheel',
                category: 'core', sets: 2, repMin: 6, repMax: 12, targetRir: 2, restSec: 60,
                executionSec: 35, transitionSec: 40, warmupSec: 0, priority: 4, optional: true,
                coachingCue: 'Bassin rétroversé, amplitude seulement tant que le tronc reste gainé.',
                variants: [
                    variant('ab-wheel', 'Roue', 'bodyweight', 1),
                    variant('stability-ball', 'Swiss ball rollout', 'bodyweight', 1),
                ],
            }),
        ],
    },
];
export function getTrainingPhase(weekIndex) {
    const cycleWeek = ((Math.max(1, weekIndex) - 1) % 24) + 1;
    if (cycleWeek <= 2)
        return {
            name: 'Calibration', color: '#f59e0b',
            description: 'Colosse apprend tes charges. Garde environ 3 répétitions en réserve et ne va pas à l’échec.',
        };
    if (cycleWeek <= 5)
        return {
            name: 'Accumulation', color: '#ef4444',
            description: 'Volume complet, progression contrôlée et technique stricte.',
        };
    if (cycleWeek === 6 || cycleWeek === 12 || cycleWeek === 18 || cycleWeek === 24)
        return {
            name: 'Deload', color: '#10b981',
            description: 'Moins de séries et de charge. Garde environ 4 répétitions en réserve et ne cherche pas de record.',
        };
    if (cycleWeek <= 11)
        return {
            name: 'Hypertrophie', color: '#dc2626',
            description: 'Augmente d’abord les répétitions, puis la charge, tout en respectant le nombre de répétitions à garder.',
        };
    if (cycleWeek <= 17)
        return {
            name: 'Spécialisation', color: '#8b5cf6',
            description: 'Priorité pectoraux, dos, épaules et fessiers, toujours sous une heure.',
        };
    return {
        name: 'Consolidation', color: '#3b82f6',
        description: 'Consolide les meilleures charges sans fatigue inutile.',
    };
}
export function getExercisePlan(exerciseDef, weekIndex) {
    const phase = getTrainingPhase(weekIndex).name;
    let sets = exerciseDef.sets;
    let targetRir = exerciseDef.targetRir;
    let warmupSec = exerciseDef.warmupSec;
    if (phase === 'Calibration') {
        const cycleWeek = ((Math.max(1, weekIndex) - 1) % 24) + 1;
        sets = cycleWeek === 1 ? Math.min(2, exerciseDef.sets) : Math.max(2, exerciseDef.sets - 1);
        targetRir = exerciseDef.category === 'isolation' || exerciseDef.category === 'core' ? 2 : 3;
    }
    else if (phase === 'Deload') {
        sets = Math.max(2, Math.ceil(exerciseDef.sets * 0.60));
        targetRir = 4;
        warmupSec = Math.round(exerciseDef.warmupSec * 0.75);
    }
    return {
        sets,
        repMin: exerciseDef.repMin,
        repMax: exerciseDef.repMax,
        targetRir,
        restSec: exerciseDef.restSec,
        warmupSec,
    };
}
export function findDay(dayId) {
    return TRAINING_DAYS.find((day) => day.id === dayId) ?? TRAINING_DAYS[0];
}
export function findExercise(exerciseId) {
    for (const day of TRAINING_DAYS) {
        const found = day.exercises.find((exerciseDef) => exerciseDef.id === exerciseId);
        if (found)
            return found;
    }
    return null;
}
export function defaultDayForDate(date = new Date()) {
    const weekday = date.getDay();
    return TRAINING_DAYS.find((day) => day.weekday === weekday)
        ?? (weekday === 0 ? TRAINING_DAYS[0] : TRAINING_DAYS[Math.min(TRAINING_DAYS.length - 1, Math.max(0, weekday - 1))]);
}
//# sourceMappingURL=program.js.map
