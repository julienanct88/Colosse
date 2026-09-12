function variant(id, label, equipment, incrementKg) {
    return { id, label, equipment, incrementKg };
}
function exercise(input) {
    return input;
}
export const TRAINING_DAYS = [
    {
        id: 'pull-a',
        name: 'Pull A',
        weekday: 1,
        focus: 'Dos épaisseur · arrière d’épaule · biceps',
        color: '#3b82f6',
        generalWarmupSec: 360,
        occupiedBufferSec: 330,
        exercises: [
            exercise({
                id: 'pull-a-lat-pronation', name: 'Tirage vertical pronation', shortName: 'Tirage pronation',
                category: 'upper_compound', sets: 3, repMin: 6, repMax: 8, targetRir: 1, restSec: 180,
                tempo: '3-1-1-1',
                executionSec: 45, transitionSec: 60, warmupSec: 240, priority: 1,
                coachingCue: 'Poitrine haute, épaules basses, coudes vers les hanches. Aucune impulsion du bassin.',
                variants: [
                    variant('lat-pronation', 'Poulie haute pronation', 'machine', 2.5),
                    variant('lat-machine', 'Machine', 'machine', 2.5),
                    variant('assisted-pullup', 'Tractions assistées', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'pull-a-chest-row', name: 'Rowing poitrine appuyée', shortName: 'Rowing appuyé',
                category: 'upper_compound', sets: 3, repMin: 6, repMax: 8, targetRir: 1, restSec: 180,
                tempo: '2-1-1-1',
                executionSec: 45, transitionSec: 60, warmupSec: 120, priority: 1,
                coachingCue: 'Une seconde de contraction en arrière. Ne décolle pas la poitrine du support.',
                variants: [
                    variant('chest-row-machine', 'Machine', 'machine', 2.5),
                    variant('chest-row-incline', 'Banc incliné haltères', 'dumbbell', 2),
                    variant('tbar', 'T-bar', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'pull-a-unilateral', name: 'Tirage unilatéral poulie vers la hanche', shortName: 'Tirage unilatéral',
                category: 'upper_compound', sets: 2, repMin: 10, repMax: 12, targetRir: 1, restSec: 90,
                tempo: '3-1-1-1',
                executionSec: 45, transitionSec: 50, warmupSec: 0, priority: 3,
                coachingCue: 'Par bras. Cherche l’étirement du grand dorsal. 15 s entre les deux côtés, 90 s après les deux.',
                variants: [
                    variant('uni-cable', 'Poulie', 'cable', 1.25),
                    variant('uni-db', 'Haltère', 'dumbbell', 2),
                    variant('uni-machine', 'Machine unilatérale', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'pull-a-reverse-pecdeck', name: 'Reverse pec-deck', shortName: 'Reverse pec-deck',
                category: 'isolation', sets: 3, repMin: 15, repMax: 20, targetRir: 1, restSec: 75,
                tempo: '2-1-2-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 3,
                coachingCue: 'Écarte avec les coudes. Ne transforme pas l’exercice en rowing.',
                variants: [
                    variant('reverse-pecdeck', 'Machine', 'machine', 2.5),
                    variant('reverse-cable', 'Poulie', 'cable', 1.25),
                    variant('rear-db', 'Haltères', 'dumbbell', 1),
                ],
            }),
            exercise({
                id: 'pull-a-incline-curl', name: 'Curl incliné haltères', shortName: 'Curl incliné',
                category: 'isolation', sets: 3, repMin: 8, repMax: 12, targetRir: 1, restSec: 90,
                tempo: '3-1-1-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 4,
                coachingCue: 'Bras derrière le torse pour étirer le biceps. Aucun balancement.',
                variants: [
                    variant('incline-db-curl', 'Haltères banc incliné', 'dumbbell', 1),
                    variant('cable-curl-behind', 'Poulie en arrière', 'cable', 1.25),
                ],
            }),
            exercise({
                id: 'pull-a-hammer', name: 'Curl marteau', shortName: 'Curl marteau',
                category: 'isolation', sets: 2, repMin: 10, repMax: 15, targetRir: 1, restSec: 75,
                tempo: '2-1-1-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 5,
                coachingCue: 'Prise neutre, coudes fixes. Travaille le brachial et le long supinateur.',
                variants: [
                    variant('hammer-db', 'Haltères', 'dumbbell', 1),
                    variant('hammer-rope', 'Corde poulie', 'cable', 1.25),
                ],
            }),
        ],
    },
    {
        id: 'push-a',
        name: 'Push A',
        weekday: 2,
        focus: 'Haut des pectoraux · épaules · triceps',
        color: '#ef4444',
        generalWarmupSec: 360,
        occupiedBufferSec: 330,
        exercises: [
            exercise({
                id: 'push-a-incline-smith', name: 'Développé incliné Smith', shortName: 'Incliné Smith',
                category: 'upper_compound', sets: 4, repMin: 6, repMax: 8, targetRir: 1, restSec: 180,
                tempo: '3-1-1-0',
                executionSec: 45, transitionSec: 60, warmupSec: 240, priority: 1,
                coachingCue: 'Banc à 20-30°. Descente contrôlée vers le haut des pectoraux. Omoplates serrées, aucun rebond.',
                variants: [
                    variant('smith-incline', 'Smith', 'machine', 2.5),
                    variant('barbell-incline', 'Barre', 'barbell', 2.5),
                    variant('machine-incline', 'Machine inclinée', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'push-a-chest-press', name: 'Chest press convergente', shortName: 'Chest press',
                category: 'upper_compound', sets: 3, repMin: 8, repMax: 12, targetRir: 1, restSec: 120,
                tempo: '3-1-1-1',
                executionSec: 40, transitionSec: 55, warmupSec: 120, priority: 2,
                coachingCue: 'Une seconde de contraction en fin de mouvement.',
                variants: [
                    variant('convergente', 'Machine convergente', 'machine', 2.5),
                    variant('chest-press-db', 'Haltères', 'dumbbell', 2),
                ],
            }),
            exercise({
                id: 'push-a-shoulder-press', name: 'Développé épaules machine', shortName: 'Développé épaules',
                category: 'upper_compound', sets: 3, repMin: 8, repMax: 10, targetRir: 1, restSec: 150,
                tempo: '3-0-1-0',
                executionSec: 40, transitionSec: 55, warmupSec: 0, priority: 2,
                coachingCue: 'Pas besoin de descendre les coudes très bas si l’épaule est gênée.',
                variants: [
                    variant('shoulder-machine', 'Machine', 'machine', 2.5),
                    variant('shoulder-db', 'Haltères assis', 'dumbbell', 2),
                    variant('shoulder-smith', 'Smith', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'push-a-low-high-fly', name: 'Écartés poulie bas vers haut', shortName: 'Écartés bas-haut',
                category: 'isolation', sets: 3, repMin: 12, repMax: 15, targetRir: 1, restSec: 75,
                tempo: '3-1-2-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 3,
                coachingCue: 'Cible le faisceau claviculaire du pectoral. Trajectoire montante.',
                variants: [
                    variant('low-high-cable', 'Poulie basse', 'cable', 1.25),
                    variant('pecdeck-incline', 'Pec deck incliné', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'push-a-lateral', name: 'Élévations latérales poulie', shortName: 'Élévations latérales',
                category: 'isolation', sets: 4, repMin: 12, repMax: 20, targetRir: 1, restSec: 75,
                tempo: '2-1-2-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 3,
                coachingCue: 'Légère flexion du coude. Ne monte pas l’épaule vers l’oreille.',
                variants: [
                    variant('lateral-cable', 'Poulie', 'cable', 1.25),
                    variant('lateral-machine', 'Machine', 'machine', 2.5),
                    variant('lateral-db', 'Haltères', 'dumbbell', 1),
                ],
            }),
            exercise({
                id: 'push-a-triceps-overhead', name: 'Extension triceps au-dessus de la tête (corde)', shortName: 'Triceps overhead',
                category: 'isolation', sets: 3, repMin: 10, repMax: 15, targetRir: 1, restSec: 90,
                tempo: '3-1-1-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 4,
                coachingCue: 'Étirement complet du long chef. Coudes stables.',
                variants: [
                    variant('rope-overhead', 'Corde', 'cable', 1.25),
                    variant('ez-overhead', 'Barre EZ', 'barbell', 2.5),
                    variant('db-overhead', 'Haltère', 'dumbbell', 2),
                ],
            }),
            exercise({
                id: 'push-a-pushdown', name: 'Push-down corde', shortName: 'Push-down',
                category: 'isolation', sets: 2, repMin: 12, repMax: 15, targetRir: 1, restSec: 75,
                tempo: '2-1-1-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 5,
                coachingCue: 'Coudes au corps, verrouillage complet en bas.',
                variants: [
                    variant('pushdown-rope', 'Corde', 'cable', 1.25),
                    variant('pushdown-bar', 'Barre', 'cable', 1.25),
                ],
            }),
        ],
    },
    {
        id: 'legs-a',
        name: 'Legs A',
        weekday: 3,
        focus: 'Quadriceps · fessiers · mollets · abdos',
        color: '#10b981',
        generalWarmupSec: 360,
        occupiedBufferSec: 330,
        exercises: [
            exercise({
                id: 'legs-a-hack', name: 'Hack squat', shortName: 'Hack squat',
                category: 'lower_compound', sets: 4, repMin: 6, repMax: 10, targetRir: 1, restSec: 180,
                tempo: '3-1-1-0',
                executionSec: 50, transitionSec: 70, warmupSec: 300, priority: 1,
                coachingCue: 'Descente contrôlée, talons au sol, profondeur maximale sans douleur. Aucun rebond en bas.',
                variants: [
                    variant('hack', 'Hack squat', 'machine', 5),
                    variant('pendulum', 'Pendulum', 'machine', 5),
                    variant('smith-squat', 'Smith squat', 'machine', 5),
                ],
            }),
            exercise({
                id: 'legs-a-press', name: 'Presse à cuisses', shortName: 'Presse',
                category: 'lower_compound', sets: 3, repMin: 10, repMax: 15, targetRir: 1, restSec: 150,
                tempo: '3-1-1-0',
                executionSec: 45, transitionSec: 60, warmupSec: 120, priority: 2,
                coachingCue: 'Ne verrouille pas brutalement les genoux en haut.',
                variants: [
                    variant('press-45', 'Presse 45°', 'machine', 5),
                    variant('press-horizontal', 'Presse horizontale', 'machine', 5),
                ],
            }),
            exercise({
                id: 'legs-a-bulgarian', name: 'Fentes bulgares', shortName: 'Bulgares',
                category: 'lower_compound', sets: 3, repMin: 8, repMax: 12, targetRir: 1, restSec: 120,
                tempo: '3-1-1-0',
                executionSec: 50, transitionSec: 60, warmupSec: 0, priority: 3,
                coachingCue: 'Par jambe. 15-20 s de changement, 120 s après les deux jambes.',
                variants: [
                    variant('bulgarian-db', 'Haltères', 'dumbbell', 2),
                    variant('bulgarian-smith', 'Smith', 'machine', 2.5),
                    variant('press-uni', 'Presse unilatérale', 'machine', 5),
                ],
            }),
            exercise({
                id: 'legs-a-leg-ext', name: 'Leg extension', shortName: 'Leg extension',
                category: 'isolation', sets: 3, repMin: 12, repMax: 20, targetRir: 1, restSec: 75,
                tempo: '2-1-2-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 3,
                coachingCue: 'Contracte réellement les quadriceps en haut.',
                variants: [
                    variant('leg-ext', 'Machine', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'legs-a-seated-curl', name: 'Leg curl assis', shortName: 'Leg curl assis',
                category: 'isolation', sets: 3, repMin: 10, repMax: 15, targetRir: 1, restSec: 90,
                tempo: '3-1-1-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 3,
                coachingCue: 'Contrôle la remontée, ne relâche pas la tension.',
                variants: [
                    variant('seated-curl', 'Assis', 'machine', 2.5),
                    variant('lying-curl', 'Couché', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'legs-a-calves', name: 'Mollets debout ou presse', shortName: 'Mollets',
                category: 'isolation', sets: 4, repMin: 10, repMax: 15, targetRir: 1, restSec: 75,
                tempo: '3-2-1-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 4,
                coachingCue: 'Deux secondes complètes en position étirée en bas.',
                variants: [
                    variant('calf-standing', 'Debout', 'machine', 2.5),
                    variant('calf-press', 'À la presse', 'machine', 5),
                ],
            }),
            exercise({
                id: 'legs-a-cable-crunch', name: 'Crunch câble', shortName: 'Crunch câble',
                category: 'core', sets: 3, repMin: 10, repMax: 15, targetRir: 1, restSec: 60,
                tempo: '3-1-1-1',
                executionSec: 30, transitionSec: 40, warmupSec: 0, priority: 5,
                coachingCue: 'Enroule la colonne, ne tire pas avec les bras.',
                variants: [
                    variant('cable-crunch', 'Poulie', 'cable', 1.25),
                    variant('crunch-machine', 'Machine', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'legs-a-leg-raise', name: 'Relevé de jambes', shortName: 'Relevé de jambes',
                category: 'core', sets: 3, repMin: 10, repMax: 15, targetRir: 1, restSec: 60,
                tempo: 'contrôlé',
                executionSec: 30, transitionSec: 40, warmupSec: 0, priority: 5,
                coachingCue: 'Aucun élan. Bassin qui s’enroule en fin de mouvement.',
                variants: [
                    variant('hanging-raise', 'Suspendu', 'machine', 1),
                    variant('captain-chair', 'Chaise romaine', 'machine', 1),
                ],
            }),
        ],
    },
    {
        id: 'pull-b',
        name: 'Pull B',
        weekday: 4,
        focus: 'Largeur du dos · silhouette en V · biceps',
        color: '#0ea5e9',
        generalWarmupSec: 360,
        occupiedBufferSec: 330,
        exercises: [
            exercise({
                id: 'pull-b-lat-neutral', name: 'Tirage vertical prise neutre', shortName: 'Tirage neutre',
                category: 'upper_compound', sets: 3, repMin: 8, repMax: 12, targetRir: 1, restSec: 150,
                tempo: '3-1-1-1',
                executionSec: 45, transitionSec: 60, warmupSec: 240, priority: 1,
                coachingCue: 'Prise neutre, étirement complet en haut, coudes vers le bas.',
                variants: [
                    variant('lat-neutral', 'Poulie prise neutre', 'machine', 2.5),
                    variant('lat-wide', 'Prise large', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'pull-b-row-neutral', name: 'Rowing machine prise neutre', shortName: 'Rowing neutre',
                category: 'upper_compound', sets: 3, repMin: 8, repMax: 12, targetRir: 1, restSec: 150,
                tempo: '3-1-1-1',
                executionSec: 45, transitionSec: 60, warmupSec: 120, priority: 1,
                coachingCue: 'Tire vers le nombril, contrôle le retour.',
                variants: [
                    variant('row-machine', 'Machine', 'machine', 2.5),
                    variant('row-cable', 'Poulie basse', 'cable', 1.25),
                ],
            }),
            exercise({
                id: 'pull-b-pullover', name: 'Pullover poulie bras presque tendus', shortName: 'Pullover',
                category: 'isolation', sets: 3, repMin: 12, repMax: 15, targetRir: 1, restSec: 75,
                tempo: '3-1-2-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 3,
                coachingCue: 'Ne transforme pas ça en extension triceps. Bras quasi tendus.',
                variants: [
                    variant('pullover-cable', 'Poulie haute', 'cable', 1.25),
                    variant('pullover-machine', 'Machine', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'pull-b-high-row', name: 'Rowing haut coudes ouverts', shortName: 'Rowing haut',
                category: 'upper_compound', sets: 2, repMin: 10, repMax: 15, targetRir: 1, restSec: 90,
                tempo: '2-1-2-1',
                executionSec: 40, transitionSec: 50, warmupSec: 0, priority: 3,
                coachingCue: 'Coudes ouverts, cible le haut du dos et l’arrière d’épaule.',
                variants: [
                    variant('high-row-machine', 'Machine', 'machine', 2.5),
                    variant('face-pull', 'Face pull', 'cable', 1.25),
                ],
            }),
            exercise({
                id: 'pull-b-reverse-fly', name: 'Reverse fly poulie', shortName: 'Reverse fly',
                category: 'isolation', sets: 3, repMin: 15, repMax: 20, targetRir: 1, restSec: 75,
                tempo: '2-1-2-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 4,
                coachingCue: 'Mouvement d’écartement pur, sans rowing.',
                variants: [
                    variant('reverse-fly-cable', 'Poulie', 'cable', 1.25),
                    variant('reverse-pecdeck-b', 'Machine', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'pull-b-preacher', name: 'Curl pupitre', shortName: 'Curl pupitre',
                category: 'isolation', sets: 3, repMin: 8, repMax: 12, targetRir: 1, restSec: 90,
                tempo: '3-1-1-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 4,
                coachingCue: 'Bras plaqués, pas de rebond en bas, flexion complète.',
                variants: [
                    variant('preacher-machine', 'Machine', 'machine', 2.5),
                    variant('preacher-ez', 'Barre EZ', 'barbell', 2.5),
                    variant('preacher-db', 'Haltère', 'dumbbell', 1),
                ],
            }),
            exercise({
                id: 'pull-b-cable-curl', name: 'Curl câble', shortName: 'Curl câble',
                category: 'isolation', sets: 2, repMin: 12, repMax: 15, targetRir: 1, restSec: 75,
                tempo: '2-1-2-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 5,
                coachingCue: 'Tension continue. Dernière série à l’échec technique autorisée dès la semaine 3.',
                variants: [
                    variant('cable-curl-b', 'Poulie', 'cable', 1.25),
                    variant('incline-curl-b', 'Curl incliné', 'dumbbell', 2),
                ],
            }),
        ],
    },
    {
        id: 'push-b',
        name: 'Push B',
        weekday: 5,
        focus: 'Épaules larges · pectoraux · triceps',
        color: '#f97316',
        generalWarmupSec: 360,
        occupiedBufferSec: 330,
        exercises: [
            exercise({
                id: 'push-b-incline-db', name: 'Développé incliné haltères', shortName: 'Incliné haltères',
                category: 'upper_compound', sets: 3, repMin: 8, repMax: 12, targetRir: 1, restSec: 150,
                tempo: '3-1-1-0',
                executionSec: 45, transitionSec: 60, warmupSec: 240, priority: 1,
                coachingCue: 'Inclinaison 20-30°. Descente contrôlée, amplitude complète.',
                variants: [
                    variant('incline-db', 'Haltères', 'dumbbell', 2),
                    variant('incline-machine-b', 'Machine inclinée', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'push-b-chest-press', name: 'Chest press', shortName: 'Chest press',
                category: 'upper_compound', sets: 3, repMin: 10, repMax: 15, targetRir: 1, restSec: 120,
                tempo: '3-1-1-1',
                executionSec: 40, transitionSec: 55, warmupSec: 120, priority: 2,
                coachingCue: 'Contraction marquée en fin de poussée.',
                variants: [
                    variant('chest-press-b', 'Machine', 'machine', 2.5),
                    variant('smith-flat', 'Smith', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'push-b-fly', name: 'Écartés poulie', shortName: 'Écartés',
                category: 'isolation', sets: 2, repMin: 12, repMax: 20, targetRir: 1, restSec: 75,
                tempo: '3-1-2-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 3,
                coachingCue: 'Étirement contrôlé, coudes légèrement fléchis.',
                variants: [
                    variant('fly-cable', 'Poulie', 'cable', 1.25),
                    variant('pecdeck', 'Pec deck', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'push-b-lateral-machine', name: 'Élévations latérales machine', shortName: 'Latérales machine',
                category: 'isolation', sets: 4, repMin: 12, repMax: 20, targetRir: 1, restSec: 75,
                tempo: '2-1-2-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 2,
                coachingCue: 'Monte les coudes, pas les mains. Épaule basse.',
                variants: [
                    variant('lateral-machine-b', 'Machine', 'machine', 2.5),
                    variant('lateral-db-b', 'Haltères', 'dumbbell', 1),
                ],
            }),
            exercise({
                id: 'push-b-lateral-uni', name: 'Élévation latérale unilatérale poulie', shortName: 'Latérale unilatérale',
                category: 'isolation', sets: 3, repMin: 15, repMax: 20, targetRir: 1, restSec: 60,
                tempo: '2-1-2-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 3,
                coachingCue: 'Par côté. 15 s de changement, 60 s après les deux bras. RIR 0 possible après la semaine 2.',
                variants: [
                    variant('lateral-uni-cable', 'Poulie unilatérale', 'cable', 1.25),
                ],
            }),
            exercise({
                id: 'push-b-triceps-overhead', name: 'Extension triceps au-dessus de la tête', shortName: 'Triceps overhead',
                category: 'isolation', sets: 3, repMin: 8, repMax: 12, targetRir: 1, restSec: 90,
                tempo: '3-1-1-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 4,
                coachingCue: 'Barre ou câble. Étirement complet du long chef.',
                variants: [
                    variant('overhead-bar', 'Barre', 'barbell', 2.5),
                    variant('overhead-rope-b', 'Corde', 'cable', 1.25),
                ],
            }),
            exercise({
                id: 'push-b-pushdown', name: 'Push-down', shortName: 'Push-down',
                category: 'isolation', sets: 3, repMin: 12, repMax: 15, targetRir: 1, restSec: 75,
                tempo: '2-1-1-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 5,
                coachingCue: 'Coudes fixes au corps, extension complète.',
                variants: [
                    variant('pushdown-rope-b', 'Corde', 'cable', 1.25),
                    variant('pushdown-bar-b', 'Barre', 'cable', 1.25),
                ],
            }),
        ],
    },
    {
        id: 'legs-b',
        name: 'Legs B',
        weekday: 6,
        focus: 'Ischios · fessiers · chaîne postérieure · abdos',
        color: '#06b6d4',
        generalWarmupSec: 360,
        occupiedBufferSec: 330,
        exercises: [
            exercise({
                id: 'legs-b-rdl', name: 'Soulevé de terre roumain', shortName: 'RDL',
                category: 'lower_compound', sets: 4, repMin: 6, repMax: 10, targetRir: 1, restSec: 180,
                tempo: '3-1-1-0',
                executionSec: 50, transitionSec: 70, warmupSec: 300, priority: 1,
                coachingCue: 'STOP dès que tu perds : colonne neutre, barre proche des jambes, tension ischios, contrôle. Jamais d’échec.',
                variants: [
                    variant('rdl-barbell', 'Barre', 'barbell', 2.5),
                    variant('rdl-db', 'Haltères', 'dumbbell', 2),
                    variant('rdl-smith', 'Smith', 'machine', 2.5),
                    variant('back-ext-45', 'Extension 45° fessiers', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'legs-b-leg-curl', name: 'Leg curl', shortName: 'Leg curl',
                category: 'isolation', sets: 4, repMin: 8, repMax: 12, targetRir: 1, restSec: 90,
                tempo: '3-1-1-1',
                executionSec: 30, transitionSec: 45, warmupSec: 120, priority: 2,
                coachingCue: 'Contrôle la phase négative, ne relâche jamais complètement.',
                variants: [
                    variant('lying-curl-b', 'Couché', 'machine', 2.5),
                    variant('seated-curl-b', 'Assis', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'legs-b-lunges', name: 'Fentes arrière ou bulgares', shortName: 'Fentes arrière',
                category: 'lower_compound', sets: 3, repMin: 10, repMax: 12, targetRir: 1, restSec: 120,
                tempo: '3-1-1-0',
                executionSec: 50, transitionSec: 60, warmupSec: 0, priority: 3,
                coachingCue: 'Par jambe. 120 s de repos après les deux jambes.',
                variants: [
                    variant('reverse-lunge', 'Fentes arrière', 'dumbbell', 2),
                    variant('bulgarian-b', 'Bulgares', 'dumbbell', 2),
                ],
            }),
            exercise({
                id: 'legs-b-press-high', name: 'Presse pieds légèrement plus hauts', shortName: 'Presse pieds hauts',
                category: 'lower_compound', sets: 2, repMin: 12, repMax: 15, targetRir: 1, restSec: 120,
                tempo: '3-1-1-0',
                executionSec: 45, transitionSec: 60, warmupSec: 0, priority: 3,
                coachingCue: 'Pieds hauts sur la plateforme pour cibler ischios et fessiers.',
                variants: [
                    variant('press-high-b', 'Presse', 'machine', 5),
                ],
            }),
            exercise({
                id: 'legs-b-leg-ext', name: 'Leg extension', shortName: 'Leg extension',
                category: 'isolation', sets: 2, repMin: 15, repMax: 20, targetRir: 1, restSec: 75,
                tempo: '2-1-2-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 4,
                coachingCue: 'Finition quadriceps, contraction marquée.',
                variants: [
                    variant('leg-ext-b', 'Machine', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'legs-b-calves', name: 'Mollets', shortName: 'Mollets',
                category: 'isolation', sets: 4, repMin: 12, repMax: 20, targetRir: 1, restSec: 75,
                tempo: '3-2-1-1',
                executionSec: 30, transitionSec: 45, warmupSec: 0, priority: 4,
                coachingCue: 'Deux secondes en position étirée.',
                variants: [
                    variant('calf-seated-b', 'Assis', 'machine', 2.5),
                    variant('calf-standing-b', 'Debout', 'machine', 2.5),
                ],
            }),
            exercise({
                id: 'legs-b-cable-crunch', name: 'Crunch câble', shortName: 'Crunch câble',
                category: 'core', sets: 3, repMin: 12, repMax: 15, targetRir: 1, restSec: 60,
                tempo: '3-1-1-1',
                executionSec: 30, transitionSec: 40, warmupSec: 0, priority: 5,
                coachingCue: 'Enroule la colonne, pas de traction des bras.',
                variants: [
                    variant('cable-crunch-b', 'Poulie', 'cable', 1.25),
                ],
            }),
            exercise({
                id: 'legs-b-plank', name: 'Gainage', shortName: 'Gainage',
                category: 'core', sets: 3, repMin: 45, repMax: 60, targetRir: 1, restSec: 60,
                tempo: 'tenue',
                executionSec: 45, transitionSec: 40, warmupSec: 0, priority: 5,
                coachingCue: 'En secondes. Quand 60 s deviennent faciles, ajoute du poids plutôt que de tenir 3 minutes.',
                variants: [
                    variant('plank', 'Planche', 'machine', 1.25),
                    variant('plank-weighted', 'Planche lestée', 'machine', 1.25),
                ],
            }),
        ],
    },
];
export function getTrainingPhase(weekIndex) {
    const cycleWeek = ((Math.max(1, weekIndex) - 1) % 12) + 1;
    if (cycleWeek === 1)
        return {
            name: 'Remise en route', color: '#f59e0b',
            description: 'Séries complètes, charges contrôlées. Garde environ 3 répétitions en réserve sur les gros mouvements, 2 sur le reste. Aucun échec.',
        };
    if (cycleWeek === 2)
        return {
            name: 'Remise en route', color: '#f59e0b',
            description: 'Séries complètes. Garde 2 répétitions en réserve sur les gros mouvements, 1 sur l’isolation. Toujours aucun échec sur les lourds.',
        };
    if (cycleWeek <= 6)
        return {
            name: 'Travail sérieux', color: '#ef4444',
            description: 'Garde 1 répétition en réserve. Dernière série d’isolation à l’échec technique autorisée. Jamais d’échec sur hack squat, RDL, développé ou rowing lourds.',
        };
    if (cycleWeek === 7)
        return {
            name: 'Décharge', color: '#10b981',
            description: 'Moitié des séries, 85-90 % des charges habituelles, garde 4 répétitions en réserve. Aucune série difficile.',
        };
    if (cycleWeek <= 11)
        return {
            name: 'Deuxième offensive', color: '#dc2626',
            description: 'Volume complet. Garde 1 répétition en réserve. Dernière série de machine ou d’isolation proche de l’échec.',
        };
    return {
        name: 'Performance', color: '#8b5cf6',
        description: 'Pas de 1RM. Tu bats simplement tes performances précédentes en répétitions, en charge ou en qualité d’exécution.',
    };
}
export function getExercisePlan(exerciseDef, weekIndex) {
    const cycleWeek = ((Math.max(1, weekIndex) - 1) % 12) + 1;
    const isCompound = exerciseDef.category === 'upper_compound' || exerciseDef.category === 'lower_compound';
    let sets = exerciseDef.sets;
    let targetRir = 1;
    let warmupSec = exerciseDef.warmupSec;
    if (cycleWeek === 7) {
        // Décharge : moitié des séries, effort réduit. Seule phase qui retire des séries.
        sets = Math.max(1, Math.round(exerciseDef.sets * 0.5));
        targetRir = 4;
        warmupSec = Math.round(exerciseDef.warmupSec * 0.75);
    }
    else if (cycleWeek === 1) {
        targetRir = isCompound ? 3 : 2;
    }
    else if (cycleWeek === 2) {
        targetRir = isCompound ? 2 : 1;
    }
    return {
        sets,
        repMin: exerciseDef.repMin,
        repMax: exerciseDef.repMax,
        targetRir,
        restSec: exerciseDef.restSec,
        warmupSec,
        tempo: exerciseDef.tempo ?? null,
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
