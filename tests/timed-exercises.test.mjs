// v3.5.3 — trois comportements : cardio non validable à la main, message de fin
// selon le kind, texte d'activité conforme au moteur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findDay, findExercise, getExercisePlan } from '../program.js';
import { createTimer, timerEndMessage, TIMER_KINDS, TIMER_END_MESSAGES } from '../engine/timer.js';
import { applyTimerOutcome } from '../engine/timer-effects.js';
import { timedExerciseStatus, timedExerciseActions, timedStopRequest } from '../engine/session.js';
import { activityGoalHelp, activityProgress } from '../engine/activity.js';
import { computeExecutionStep, STAGES } from '../engine/execution.js';
import { emptyWarmupState, activationSteps } from '../engine/warmup.js';

/** Session minimale portant un exercice chronométré. */
function timedSession(exerciseId, { activeTimer = null, recordedSec = null, done = false } = {}) {
    return {
        id: 's', dayId: 'pull-a', startedAt: 1000, endedAt: null, activeTimer,
        exercises: { [exerciseId]: { exerciseId, skipped: false,
            sets: [{ done, reps: recordedSec, weightKg: 0, completedAt: null, restActualSec: null }] } },
        warmup: emptyWarmupState(), execution: { active: true },
    };
}

/**
 * Reproduit EXACTEMENT ce que fait app.js quand on demande « Terminer » sur un
 * exercice chronométré : refus s'il n'y a pas de chrono, sinon résolution.
 */
function commandeTerminer(session, exerciseId, now) {
    const request = timedStopRequest(session.activeTimer, exerciseId);
    if (request.action === 'refuse')
        return session; // l'app ne touche à rien
    return applyTimerOutcome(session, session.activeTimer, now).session;
}

// ============================== 1. CARDIO NON VALIDABLE À LA MAIN

test('1. cardio 600 s, aucun timer, commande Terminer -> done reste false', () => {
    const session = timedSession('pull-a-incline-walk');
    const after = commandeTerminer(session, 'pull-a-incline-walk', 500_000);
    const set = after.exercises['pull-a-incline-walk'].sets[0];
    assert.equal(set.done, false, 'aucune validation instantanée possible');
    assert.equal(set.reps, null, 'aucune durée inventée');
    assert.equal(timedStopRequest(null, 'pull-a-incline-walk').action, 'refuse');
});

test('1b. le refus vaut aussi si un timer tourne pour un AUTRE exercice', () => {
    const other = createTimer('work-rest', 150, { exerciseId: 'pull-a-lat-pronation', setIndex: 0 }, 0);
    const session = timedSession('pull-a-incline-walk', { activeTimer: other });
    const after = commandeTerminer(session, 'pull-a-incline-walk', 200_000);
    assert.equal(after.exercises['pull-a-incline-walk'].sets[0].done, false);
    assert.equal(timedStopRequest(other, 'pull-a-incline-walk').action, 'refuse');
});

test('1c. 240 s enregistrées sur 600 -> done false', () => {
    // Chrono arrêté à 240 s (mis en pause puis arrêté).
    const timer = { ...createTimer('cardio', 600, { exerciseId: 'pull-a-incline-walk' }, 0), paused: true, pausedRemainingSec: 360 };
    const session = timedSession('pull-a-incline-walk', { activeTimer: timer });
    const after = commandeTerminer(session, 'pull-a-incline-walk', 9_999_000);
    const set = after.exercises['pull-a-incline-walk'].sets[0];
    assert.equal(set.reps, 240, 'la durée réelle est enregistrée');
    assert.equal(set.done, false, '240 s sur 600 ne valide pas l’étape');
    assert.equal(set.completedAt, null);
    assert.equal(after.activeTimer, null);
});

test('1d. 600 s enregistrées sur 600 -> done true', () => {
    const timer = createTimer('cardio', 600, { exerciseId: 'pull-a-incline-walk' }, 0);
    const session = timedSession('pull-a-incline-walk', { activeTimer: timer });
    const after = commandeTerminer(session, 'pull-a-incline-walk', 600_000);
    const set = after.exercises['pull-a-incline-walk'].sets[0];
    assert.equal(set.reps, 600);
    assert.equal(set.done, true);
});

test('1e. même règle pour la récupération (2700 s)', () => {
    const partiel = { ...createTimer('recovery', 2700, { exerciseId: 'recovery-walk' }, 0), paused: true, pausedRemainingSec: 1200 };
    const apresPartiel = commandeTerminer(timedSession('recovery-walk', { activeTimer: partiel }), 'recovery-walk', 9_999_000);
    assert.equal(apresPartiel.exercises['recovery-walk'].sets[0].reps, 1500);
    assert.equal(apresPartiel.exercises['recovery-walk'].sets[0].done, false, '1500 s sur 2700 : incomplet');

    const complet = createTimer('recovery', 2700, { exerciseId: 'recovery-walk' }, 0);
    const apresComplet = commandeTerminer(timedSession('recovery-walk', { activeTimer: complet }), 'recovery-walk', 2_700_000);
    assert.equal(apresComplet.exercises['recovery-walk'].sets[0].done, true);
});

test('1f. la règle timedExerciseStatus : accompli seulement si la durée est atteinte', () => {
    assert.equal(timedExerciseStatus(0, 600).done, false);
    assert.equal(timedExerciseStatus(240, 600).done, false);
    assert.equal(timedExerciseStatus(599, 600).done, false);
    assert.equal(timedExerciseStatus(600, 600).done, true);
    assert.equal(timedExerciseStatus(700, 600).done, true, 'dépasser la consigne reste accompli');
    // Une durée prescrite nulle ou absente ne rend jamais rien accompli.
    assert.equal(timedExerciseStatus(0, 0).done, false);
    assert.equal(timedExerciseStatus(120, null).done, false);
});

test('1g. l’étiquette affichée dit la vérité sur un cardio interrompu', () => {
    const rien = timedExerciseStatus(0, 600);
    assert.equal(rien.label, '10:00');
    assert.equal(rien.actionLabel, '▶ Démarrer');
    const partiel = timedExerciseStatus(252, 600);
    assert.equal(partiel.label, '4:12 / 10:00 — incomplet');
    assert.equal(partiel.partial, true);
    assert.equal(partiel.actionLabel, '↻ Reprendre', 'on peut reprendre, jamais valider');
    const fait = timedExerciseStatus(600, 600);
    assert.equal(fait.label, '10:00 réalisé');
    assert.equal(fait.actionLabel, '↻ Refaire');
});

test('1h. un cardio incomplet laisse le mode exécution sur l’étape cardio', () => {
    const day = findDay('pull-a');
    const session = { id: 's', dayId: 'pull-a', exerciseOrder: day.exercises.map((e) => e.id),
        exercises: {}, warmup: emptyWarmupState(), execution: { active: true }, activeTimer: null };
    for (const ex of day.exercises) {
        const plan = getExercisePlan(ex, 1);
        session.exercises[ex.id] = { skipped: ex.kind !== 'cardio', sets: Array.from({ length: plan.sets }, () => ({ done: false })) };
    }
    session.warmup.general = { done: true, skipped: false, durationSec: 360 };
    for (const st of activationSteps(day)) session.warmup.activation[st.key] = { done: true };
    // 240 s enregistrées, pas done : l'étape cardio reste à faire.
    session.exercises['pull-a-incline-walk'].sets[0] = { done: false, reps: 240 };
    const step = computeExecutionStep({ day, session, resolvePlan: (ex) => getExercisePlan(ex, 1) });
    assert.equal(step.stage, STAGES.CARDIO);
    assert.equal(step.exerciseId, 'pull-a-incline-walk');
});

// ============================== 2. MESSAGE DE FIN SELON LE KIND

test('2. chaque kind a son propre message de fin', () => {
    assert.equal(timerEndMessage('work-rest'), 'Repos terminé. Série suivante.');
    assert.equal(timerEndMessage('ramp-rest'), 'Repos terminé. Prochaine série de montée en charge.');
    assert.equal(timerEndMessage('side-switch'), 'Changement terminé. Côté droit.');
    assert.equal(timerEndMessage('general-warmup'), 'Échauffement terminé.');
    assert.equal(timerEndMessage('activation-rest'), 'Transition terminée.');
    assert.equal(timerEndMessage('cardio'), 'Cardio terminé.');
    assert.equal(timerEndMessage('recovery'), 'Étape de récupération terminée.');
});

test('2b. les 7 kinds ont un message, tous distincts, et un seul parle de série suivante', () => {
    assert.equal(TIMER_KINDS.length, 7);
    for (const kind of TIMER_KINDS)
        assert.ok(TIMER_END_MESSAGES[kind], `${kind} doit avoir un message`);
    const messages = TIMER_KINDS.map(timerEndMessage);
    assert.equal(new Set(messages).size, 7, 'aucun message dupliqué');
    assert.deepEqual(messages.filter((m) => m.includes('Série suivante')), ['Repos terminé. Série suivante.']);
    assert.equal(messages.filter((m) => m.includes('Cardio')).length, 1, 'la récup ne dit pas "Cardio"');
});

test('2c. un kind inconnu ne casse rien', () => {
    assert.equal(timerEndMessage('inconnu'), 'Minuteur terminé.');
    assert.equal(timerEndMessage(undefined), 'Minuteur terminé.');
});

// ============================== 3. TEXTE D'ACTIVITÉ

// Les milliers sont séparés par une espace fine insécable (U+202F), comme
// partout ailleurs dans l'app (toLocaleString('fr-FR')).
const plat = (texte) => texte.replace(/[\u202f\u00a0]/g, ' ');

test('3. le texte des réglages dit que le vélo ne remplace pas les pas', () => {
    const help = activityGoalHelp({ dailyStepTarget: 8000, stepsOnlyTarget: 12000 });
    assert.equal(plat(help), 'Objectif quotidien : 8 000 à 12 000 pas. Le vélo est suivi séparément et ne remplace pas automatiquement les pas.');
    assert.doesNotMatch(help, /socle/i, 'plus de vocabulaire « socle + vélo »');
    assert.doesNotMatch(help, /valide l’activité/);
    assert.match(help, /ne remplace pas automatiquement les pas/);
});

test('3b. le texte suit les valeurs réelles du profil', () => {
    assert.match(plat(activityGoalHelp({ dailyStepTarget: 9000, stepsOnlyTarget: 14000 })), /9 000 à 14 000 pas/);
    // Bornes incohérentes : le haut ne descend jamais sous le bas.
    assert.match(plat(activityGoalHelp({ dailyStepTarget: 10000, stepsOnlyTarget: 5000 })), /10 000 à 10 000 pas/);
    assert.match(plat(activityGoalHelp({})), /8 000 à 12 000 pas/, 'valeurs par défaut');
});

test('3c. le texte est cohérent avec le moteur : le vélo ne complète jamais les pas', () => {
    const profile = { dailyStepTarget: 8000, stepsOnlyTarget: 12000 };
    const avecVelo = activityProgress({ steps: 3000, bikeMinutes: 60, bikeIntensity: 'vigorous' }, profile);
    assert.equal(avecVelo.complete, false, '60 min de vélo ne valident pas 3 000 pas');
    assert.equal(avecVelo.bikeMinutes, 60, 'mais le vélo reste enregistré');
    assert.equal(activityProgress({ steps: 8000 }, profile).complete, true);
});

// ====================== CORRECTIFS ISSUS DE LA REVUE ADVERSARIALE

test('4. les seules actions possibles sur un exercice chronométré : lancer ou arrêter', () => {
    const cas = [
        [timedExerciseStatus(0, 600, false), false],
        [timedExerciseStatus(252, 600, false), false],
        [timedExerciseStatus(600, 600, true), false],
        [timedExerciseStatus(0, 600, true), false],
        [timedExerciseStatus(120, 600, false), true],
    ];
    for (const [status, running] of cas) {
        const actions = timedExerciseActions(status, running);
        assert.equal(actions.length, 1, 'une seule action à l’écran');
        const noms = actions.map((a) => a.action);
        assert.deepEqual(noms, running ? ['finish-cardio'] : ['start-cardio']);
        // Aucune action ne valide l'étape : il n'existe pas de « marquer terminé ».
        for (const nom of noms)
            assert.ok(['start-cardio', 'finish-cardio'].includes(nom), `action inattendue : ${nom}`);
    }
    // « Arrêter » n'est proposé QUE si un chrono tourne.
    assert.equal(timedExerciseActions(timedExerciseStatus(0, 600, false), false)[0].action, 'start-cardio');
    assert.equal(timedExerciseActions(timedExerciseStatus(0, 600, false), true)[0].action, 'finish-cardio');
});

test('5. un chrono rallongé puis arrêté avant la fin n’est pas accompli, et le dit', () => {
    // +30 s -> 630 s prescrites par le chrono ; arrêté à 610 s.
    const timer = { ...createTimer('cardio', 630, { exerciseId: 'pull-a-incline-walk' }, 0), paused: true, pausedRemainingSec: 20 };
    const after = commandeTerminer(timedSession('pull-a-incline-walk', { activeTimer: timer }), 'pull-a-incline-walk', 9_999_000);
    const set = after.exercises['pull-a-incline-walk'].sets[0];
    assert.equal(set.reps, 610);
    assert.equal(set.done, false, '610 s sur 630 demandées : incomplet');
    // La carte ne doit pas annoncer « réalisé » pour une étape non validée.
    const status = timedExerciseStatus(set.reps, 600, set.done);
    assert.equal(status.done, false);
    assert.match(status.label, /^10:10 \/ 10:00 — incomplet$/);
});

test('6. reprendre un cardio ne fait jamais régresser ce qui est acquis', () => {
    // 600/600 déjà accompli, puis « Refaire » arrêté au bout de 2 s.
    const session = timedSession('pull-a-incline-walk', { recordedSec: 600, done: true });
    const court = { ...createTimer('cardio', 600, { exerciseId: 'pull-a-incline-walk' }, 0), paused: true, pausedRemainingSec: 598 };
    session.activeTimer = court;
    const after = commandeTerminer(session, 'pull-a-incline-walk', 9_999_000);
    const set = after.exercises['pull-a-incline-walk'].sets[0];
    assert.equal(set.reps, 600, 'les 10 minutes réellement faites ne sont pas effacées');
    assert.equal(set.done, true, 'une étape acquise reste acquise');
    // Et une reprise plus longue améliore le résultat.
    const session2 = timedSession('pull-a-incline-walk', { recordedSec: 240, done: false });
    session2.activeTimer = createTimer('cardio', 600, { exerciseId: 'pull-a-incline-walk' }, 0);
    const after2 = commandeTerminer(session2, 'pull-a-incline-walk', 600_000);
    assert.equal(after2.exercises['pull-a-incline-walk'].sets[0].reps, 600);
    assert.equal(after2.exercises['pull-a-incline-walk'].sets[0].done, true);
});

test('7. donnée héritée (validée à la main avant v3.5.3) : affichage aligné sur les compteurs', () => {
    // L'ancien repli écrivait done:true sans jamais toucher reps.
    const status = timedExerciseStatus(null, 600, true);
    assert.equal(status.legacy, true);
    assert.equal(status.done, false, 'la règle de durée n’est pas satisfaite');
    assert.equal(status.label, 'validé sans chrono', 'la carte ne prétend pas que rien n’a été fait');
    assert.equal(status.actionLabel, '↻ Refaire');
    assert.equal(status.partial, false);
    // Une étape neuve n'est jamais « legacy ».
    assert.equal(timedExerciseStatus(0, 600, false).legacy, false);
    assert.equal(timedExerciseStatus(600, 600, true).legacy, false);
});

test('8. activityGoalHelp tolère un profil absent ou nul', () => {
    for (const entree of [null, undefined, {}, { dailyStepTarget: 'x' }, { dailyStepTarget: -5 }])
        assert.match(activityGoalHelp(entree), /ne remplace pas automatiquement les pas/);
});
