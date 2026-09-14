// 3.6.3 — corrections issues de la vraie séance Pull A du 14/09/2026 :
// semaine du programme, repos après la dernière série, « Faire maintenant »,
// montée en charge proposée, progression après décharge. Tests de COMPORTEMENT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findDay, findExercise, getExercisePlan, getTrainingPhase } from '../program.js';
import {
    TRANSFORMATION_INSTALL_WEEK, trainingWeekIndex, sessionWeekIndex, migrateProgramStart, closeSession,
} from '../engine/session.js';
import { restAfterSetDecision, executionChangeDecision, computeExecutionStep, STAGES } from '../engine/execution.js';
import { createTimer, timerLabel, timerEndMessage, timerControls, timerOutcome } from '../engine/timer.js';
import { applyTimerOutcome } from '../engine/timer-effects.js';
import { prescriptionFromHistory } from '../engine/progression.js';
import { emptyWarmupState, activationSteps, rampsRequested } from '../engine/warmup.js';

const julien = { startDate: '2026-08-05', programVersion: 'transformation-12s' };

test('Semaine du programme : le 14/09 n’est plus une décharge (3 séries, pas 2)', () => {
    assert.equal(trainingWeekIndex(julien, '2026-09-14'), 7, 'état d’avant : semaine 7 comptée depuis la date de départ du profil');
    const { profile } = migrateProgramStart(julien, []);
    assert.equal(profile.programStartDate, TRANSFORMATION_INSTALL_WEEK);
    assert.equal(profile.startDate, '2026-08-05', 'la date de départ (poids) ne change pas');
    const week = trainingWeekIndex(profile, '2026-09-14');
    assert.equal(week, 2);
    assert.notEqual(getTrainingPhase(week).name, 'Décharge');
    const pullA = findDay('pull-a');
    assert.deepEqual(pullA.exercises.filter((ex) => ex.kind !== 'cardio').map((ex) => getExercisePlan(ex, week).sets), [3, 3, 2, 3, 3, 2]);
    assert.equal(getTrainingPhase(trainingWeekIndex(profile, '2026-10-19')).name, 'Décharge', 'la décharge revient en semaine 7 du programme');
});

test('Migration : séances terminées figées, séance en cours recalculée, idempotente, rien de supprimé', () => {
    const terminee = { id: '2026-09-01:pull-a', date: '2026-09-01', dayId: 'pull-a', weekIndex: 5, startedAt: 1, endedAt: 2, status: 'COMPLETE', exercises: { a: { sets: [{ done: true, weightKg: 60, reps: 8 }] } } };
    const enCours = { id: '2026-09-14:pull-a', date: '2026-09-14', dayId: 'pull-a', weekIndex: 7, startedAt: 3, endedAt: null, exercises: { a: { sets: [{ done: true, weightKg: 12, reps: 20 }, { done: false }] } } };
    const avant = JSON.stringify([terminee, enCours]);
    const r = migrateProgramStart(julien, [terminee, enCours]);
    assert.equal(JSON.stringify([terminee, enCours]), avant, 'objets reçus non modifiés');
    assert.equal(r.changed, true);
    const [t, c] = r.sessions;
    assert.deepEqual([t.planWeekIndex, t.weekIndex], [5, 5], 'l’historique garde sa semaine');
    assert.equal(c.weekIndex, 2, 'la séance en cours suit le programme');
    assert.equal(c.planWeekIndex, undefined);
    assert.deepEqual(c.exercises, enCours.exercises, 'séries intactes');
    assert.equal(sessionWeekIndex(t, r.profile), 5);
    assert.equal(sessionWeekIndex(c, r.profile), 2);
    const encore = migrateProgramStart(r.profile, r.sessions);
    assert.equal(encore.changed, false, 'idempotente');
    // Nouveau profil créé après l’installation : le programme démarre avec lui.
    assert.equal(migrateProgramStart({ startDate: '2026-09-21', programVersion: 'transformation-12s' }, []).profile.programStartDate, '2026-09-21');
    // Clôturer une séance fige sa semaine ; changer le début du programme ne la touche plus.
    const close = closeSession({ ...c }, { now: 9 });
    assert.equal(close.planWeekIndex, 2);
    assert.equal(sessionWeekIndex(close, { programStartDate: '2026-09-14' }), 2);
    assert.equal(sessionWeekIndex({ date: '2026-09-21' }, { programStartDate: '2026-09-14' }), 2);
});

test('Repos après une série : entre séries, puis AVANT L’EXERCICE SUIVANT après la dernière', () => {
    const unilateral = getExercisePlan(findExercise('pull-a-unilateral'), 2);
    const next = { id: 'pull-a-reverse-pec-deck', name: 'Reverse pec-deck' };
    assert.deepEqual(restAfterSetDecision({ plan: unilateral, setIndex: 0, nextExercise: next }).kind, 'work-rest');
    assert.equal(restAfterSetDecision({ plan: unilateral, setIndex: 0, nextExercise: next }).durationSec, 90, 'unilatéral : 90 s après les deux côtés');
    const derniere = restAfterSetDecision({ plan: unilateral, setIndex: unilateral.sets - 1, nextExercise: next });
    assert.deepEqual([derniere.kind, derniere.durationSec, derniere.nextName], ['transition', 90, 'Reverse pec-deck'], 'plus jamais « bras droit puis rien »');
    assert.equal(restAfterSetDecision({ plan: unilateral, setIndex: unilateral.sets - 1, nextExercise: null }).kind, null, 'fin de séance : pas de repos');
    const pronation = getExercisePlan(findExercise('pull-a-lat-pronation'), 2);
    assert.equal(restAfterSetDecision({ plan: pronation, setIndex: 2, nextExercise: next }).durationSec, pronation.restSec);
    assert.equal(restAfterSetDecision({ plan: pronation, setIndex: 0, inSuperset: true, isLastOfSuperset: false, nextExercise: next }).kind, null, 'superset : pas de repos au milieu du tour');
});

test('Repos avant l’exercice suivant : libellé, message, contrôles, et jamais enregistré comme repos de série', () => {
    assert.match(timerLabel('transition'), /EXERCICE SUIVANT/);
    assert.match(timerEndMessage('transition'), /exercice suivant/);
    assert.deepEqual(timerControls('transition').map((c) => c.id), ['minus', 'pause', 'plus', 'skip']);
    const session = { id: 's', exercises: { x: { sets: [{ done: true, restActualSec: null }] } }, activeTimer: null };
    const timer = createTimer('transition', 90, { exerciseId: 'x', setIndex: 0, sessionId: 's', nextName: 'Y' }, 0);
    session.activeTimer = timer;
    assert.equal(timerOutcome(timer, 60_000).action, 'none', 'aucun effet métier : ce n’est pas un repos entre séries');
    const r = applyTimerOutcome(session, timer, 60_000);
    assert.equal(r.session.activeTimer, null);
    assert.equal(r.session.exercises.x.sets[0].restActualSec, null);
});

test('« Faire maintenant » : l’exercice du changement de côté y ramène, un autre est refusé, le repos avant l’exercice suivant ne bloque pas', () => {
    const t = (kind, exerciseId) => createTimer(kind, 15, { exerciseId, setIndex: 0, sessionId: 's' }, 0);
    const meme = executionChangeDecision({ activeTimer: t('side-switch', 'uni'), targetExerciseId: 'uni' });
    assert.deepEqual([meme.action, meme.endTimer], ['proceed', false]);
    assert.equal(executionChangeDecision({ activeTimer: t('side-switch', 'uni'), targetExerciseId: 'autre' }).action, 'refuse');
    const transition = executionChangeDecision({ activeTimer: t('transition', 'fini'), targetExerciseId: 'suivant' });
    assert.deepEqual([transition.action, transition.endTimer, transition.message], ['proceed', true, null]);
});

test('« Faire maintenant » sur un exercice lourd : la série 1 tout de suite, sans écran de charge, échauffement seulement proposé', () => {
    const day = findDay('pull-a');
    const exercises = {};
    for (const ex of day.exercises)
        exercises[ex.id] = { variantId: ex.variants[0].id, skipped: false, sets: Array.from({ length: getExercisePlan(ex, 2).sets }, () => ({ done: false, weightKg: null, reps: null })) };
    const warmup = emptyWarmupState();
    warmup.general.done = true;
    for (const st of activationSteps(day)) warmup.activation[st.key] = { done: true };
    const session = { exercises, warmup, exerciseOrder: ['pull-a-chest-row', ...day.exercises.map((e) => e.id).filter((id) => id !== 'pull-a-chest-row')] };
    const step = computeExecutionStep({ day, session, resolvePlan: (ex) => getExercisePlan(ex, 2) });
    assert.equal(step.stage, STAGES.WORK_SET);
    assert.equal(step.exerciseId, 'pull-a-chest-row');
    assert.equal(step.totalSets, 3);
    assert.deepEqual(step.rampOffer, { count: 2 });
    assert.equal(rampsRequested(warmup, 'pull-a-chest-row', 2), false);
    // Même avec une charge déjà connue (pré-remplie), la montée en charge n'est jamais imposée.
    exercises['pull-a-chest-row'].sets.forEach((set) => { set.weightKg = 50; });
    const avecCharge = computeExecutionStep({ day, session, resolvePlan: (ex) => getExercisePlan(ex, 2) });
    assert.equal(avecCharge.stage, STAGES.WORK_SET);
    assert.deepEqual(avecCharge.rampOffer, { count: 2 });
    session.warmup.ramps['pull-a-chest-row'] = { referenceLoadKg: 50, done: [], requested: true };
    assert.equal(computeExecutionStep({ day, session, resolvePlan: (ex) => getExercisePlan(ex, 2) }).stage, STAGES.RAMP_SET, 'demandée : elle s’affiche');
});

test('Après une décharge, la progression repart de la charge habituelle (plus de « séance trop incomplète »)', () => {
    const ex = findExercise('pull-a-lat-pronation');
    const serie = (kg, reps, rir) => ({ done: true, weightKg: kg, reps, rir, technique: 'good', pain: 0 });
    const s6 = { date: '2026-10-12', weekIndex: 6, plan: getExercisePlan(ex, 6), sets: [serie(70, 8, 1), serie(70, 8, 1), serie(70, 7, 1)] };
    const s7 = { date: '2026-10-19', weekIndex: 7, plan: getExercisePlan(ex, 7), sets: [serie(60, 8, 4), serie(60, 8, 4)] };
    assert.equal(s7.plan.sets, 2);
    const s8 = prescriptionFromHistory([s6, s7], getExercisePlan(ex, 8), ex, ex.variants[0].incrementKg);
    assert.notEqual(s8.decision, 'HOLD_INCOMPLETE');
    assert.ok(s8.loadKg >= 70, `charge de reprise ${s8.loadKg} kg, pas la charge allégée`);
    // Seule exposition connue = la décharge (2/2) : complète pour ce qu'elle prévoyait.
    const seule = prescriptionFromHistory([s7], getExercisePlan(ex, 8), ex, ex.variants[0].incrementKg);
    assert.notEqual(seule.decision, 'HOLD_INCOMPLETE', 'une décharge faite en entier n’est pas une séance incomplète');
    // Une vraie séance incomplète reste signalée.
    const incomplete = { ...s6, sets: [serie(70, 8, 1)] };
    assert.equal(prescriptionFromHistory([incomplete], getExercisePlan(ex, 6), ex, ex.variants[0].incrementKg).decision, 'HOLD_INCOMPLETE');
});
