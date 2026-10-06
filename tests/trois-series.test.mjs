// 3.6.5 — « 3 séries minimum, jamais 2 » (demande du 06/10/2026). Tests de COMPORTEMENT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TRAINING_DAYS, findExercise, getExercisePlan, getExercisePlanForSession, isPreRevisionSession, markSetsRevision,
    hasWorkTraces, SETS_REVISION, SETS_BEFORE_REVISION } from '../program.js';
import { makeSession } from '../defaults.js';
import { prescriptionFromHistory, summarizeSession } from '../engine/progression.js';

const timed = (ex) => ex.kind === 'cardio' || ex.kind === 'recovery';
const musculation = TRAINING_DAYS.filter((d) => d.kind === 'strength').flatMap((d) => d.exercises.filter((ex) => !timed(ex)));

test('Chaque exercice de musculation a au moins 3 séries, toutes les semaines sauf la décharge', () => {
    assert.equal(musculation.length, 43, '39 exercices de la spec + 4 exercices de taille (crunch ×2, relevé de jambes, gainage)');
    for (const ex of musculation)
        for (const week of [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12])
            assert.ok(getExercisePlan(ex, week).sets >= 3, `${ex.name} semaine ${week} : ${getExercisePlan(ex, week).sets} séries`);
});

test('Les 8 exercices qui étaient à 2 séries sont à 3 ; les 35 autres gardent exactement leurs séries', () => {
    const avant = new Set(Object.keys(SETS_BEFORE_REVISION));
    assert.equal(avant.size, 8);
    for (const ex of musculation) {
        const attendu = avant.has(ex.id) ? 3 : ex.sets;
        assert.equal(getExercisePlan(ex, 3).sets, attendu, ex.name);
        if (!avant.has(ex.id)) assert.ok(ex.sets === 3 || ex.sets === 4, `${ex.name} : ${ex.sets} séries (inchangé)`);
    }
});

test('Les répétitions, repos et tempos des 8 exercices ne bougent pas', () => {
    const attendu = { 'pull-a-unilateral': [10, 12, 90], 'pull-a-hammer': [10, 15, 75], 'push-a-pushdown': [12, 15, 75], 'pull-b-high-row': [10, 15, 90],
        'pull-b-cable-curl': [12, 15, 75], 'push-b-fly': [12, 20, 75], 'legs-b-press-high': [12, 15, 120], 'legs-b-leg-ext': [15, 20, 75] };
    for (const [id, [min, max, rest]] of Object.entries(attendu)) {
        const p = getExercisePlan(findExercise(id), 3);
        assert.deepEqual([p.repMin, p.repMax, p.restSec], [min, max, rest], id);
    }
});

test('Semaine 7 (décharge) : la moitié des séries, jamais moins de 1 ; les 3 séries donnent 2', () => {
    for (const ex of musculation) {
        const p = getExercisePlan(ex, 7);
        assert.equal(p.sets, Math.max(1, Math.round(ex.sets * 0.5)), ex.name);
        assert.equal(p.deload, true);
    }
    assert.equal(getExercisePlan(findExercise('pull-a-hammer'), 7).sets, 2);
});

const fait = (n) => Array.from({ length: n }, () => ({ done: true, weightKg: 14, reps: 15, rir: 3 }));
const seance = (extra = {}) => ({ date: '2026-10-06', weekIndex: 5, exercises: { 'pull-a-hammer': { sets: [] } }, ...extra });

test('Une séance faite SANS marqueur (écrite par l\u2019ancienne version) garde ses 2 séries, quelle que soit l\u2019heure', () => {
    const ex = findExercise('pull-a-hammer');
    // Même faite aujourd\u2019hui, après la mise en ligne, sur un appareil resté à l\u2019ancienne version :
    assert.equal(getExercisePlanForSession(ex, seance({ startedAt: Date.now(), endedAt: Date.now() })).sets, 2);
    assert.equal(getExercisePlanForSession(ex, seance({ startedAt: Date.now(), endedAt: null })).sets, 2, 'commencée, pas terminée');
    assert.equal(getExercisePlanForSession(ex, seance({ date: '2026-10-05', weekIndex: 5, startedAt: 1, endedAt: 2 })).sets, 2);
    assert.equal(isPreRevisionSession(null), false);
});

test('Une séance importée de Colosse v2 (sans heure de début ni de fin, séries validées) garde ses 2 séries', () => {
    const ex = findExercise('pull-a-hammer');
    const v2 = seance({ startedAt: null, endedAt: null, exercises: { 'pull-a-hammer': { sets: fait(2) } } });
    assert.equal(hasWorkTraces(v2), true);
    assert.equal(getExercisePlanForSession(ex, v2).sets, 2);
    const reps = seance({ startedAt: null, endedAt: null, exercises: { 'pull-a-hammer': { sets: [{ done: false, reps: 12 }] } } });
    assert.equal(hasWorkTraces(reps), true, 'des répétitions saisies sont une trace de travail');
    const cote = seance({ startedAt: null, endedAt: null, exercises: { 'pull-a-unilateral': { sets: [{ done: false, sides: { left: { done: true } } }] } } });
    assert.equal(hasWorkTraces(cote), true, 'un côté fait est une trace de travail');
});

test('Une séance préparée (sans trace de travail) reçoit le marqueur et suit le programme actuel : 3 séries', () => {
    const ex = findExercise('pull-a-hammer');
    const preparee = seance({ startedAt: null, endedAt: null, exercises: { 'pull-a-hammer': { sets: [{ done: false, weightKg: 14, reps: null }] } } });
    assert.equal(hasWorkTraces(preparee), false, 'une charge pré-remplie n\u2019est pas du travail');
    assert.equal(getExercisePlanForSession(ex, preparee).sets, 3);
    markSetsRevision(preparee);
    assert.equal(preparee.setsRevision, SETS_REVISION);
    assert.equal(getExercisePlanForSession(ex, preparee).sets, 3);
});

test('Le marqueur n\u2019est JAMAIS posé sur une séance qui porte du travail déjà fait', () => {
    const faite = seance({ startedAt: 5, endedAt: 9, exercises: { 'pull-a-hammer': { sets: fait(2) } } });
    markSetsRevision(faite);
    assert.equal('setsRevision' in faite, false);
    assert.equal(isPreRevisionSession(faite), true);
});

test('Une séance marquée garde 3 séries même une fois commencée ou terminée (séance faite avec la nouvelle version)', () => {
    const ex = findExercise('pull-a-hammer');
    const faiteApres = seance({ setsRevision: SETS_REVISION, startedAt: Date.now(), endedAt: Date.now(), exercises: { 'pull-a-hammer': { sets: fait(3) } } });
    assert.equal(isPreRevisionSession(faiteApres), false);
    assert.equal(getExercisePlanForSession(ex, faiteApres).sets, 3);
});

test('Toute séance créée par la nouvelle version porte le marqueur dès sa création', () => {
    const s = makeSession('pull-a', '2026-10-12', { startDate: '2026-08-05', programStartDate: '2026-09-07' });
    assert.equal(s.setsRevision, SETS_REVISION);
    assert.equal(s.exercises['pull-a-hammer'].sets.length, 3);
    assert.equal(s.exercises['pull-a-unilateral'].sets.length, 3);
});

test('Séance antérieure en décharge : la décharge d\u2019alors (1 série) est conservée', () => {
    const ex = findExercise('pull-a-hammer');
    assert.equal(getExercisePlanForSession(ex, seance({ weekIndex: 7, startedAt: 1, endedAt: 2 })).sets, 1);
    assert.equal(getExercisePlanForSession(ex, seance({ weekIndex: 7, setsRevision: SETS_REVISION, startedAt: 1 })).sets, 2);
});

test('Les 35 autres exercices sont identiques pour une séance antérieure', () => {
    for (const ex of musculation.filter((e) => !SETS_BEFORE_REVISION[e.id]))
        assert.deepEqual(getExercisePlanForSession(ex, { date: '2026-09-14', weekIndex: 2, startedAt: 1, endedAt: 2 }), getExercisePlan(ex, 2), ex.name);
});

test('Historique : une exposition faite à 2 séries (avant la révision) n’est PAS « trop incomplète »', () => {
    const ex = findExercise('pull-a-hammer');
    const faite = [0, 1].map(() => ({ done: true, weightKg: 14, reps: 15, rir: 3, technique: 'good', pain: 0 })).concat([{ done: false, weightKg: null, reps: null, rir: null }]);
    const session = { date: '2026-10-05', weekIndex: 5, startedAt: 1, endedAt: 2 };
    const jugeeSurTrois = prescriptionFromHistory([{ date: session.date, weekIndex: 5, sets: faite, plan: getExercisePlan(ex, 5), variantId: 'x' }], getExercisePlan(ex, 6), ex, 1);
    assert.equal(jugeeSurTrois.decision, 'HOLD_INCOMPLETE', 'sans la prise en compte de la révision, la charge resterait bloquée');
    const jugeeSurDeux = prescriptionFromHistory([{ date: session.date, weekIndex: 5, sets: faite, plan: getExercisePlanForSession(ex, session), variantId: 'x' }], getExercisePlan(ex, 6), ex, 1);
    assert.notEqual(jugeeSurDeux.decision, 'HOLD_INCOMPLETE');
    assert.ok(jugeeSurDeux.loadKg > 14, 'haut de fourchette, RIR 3 : la charge monte ' + JSON.stringify(jugeeSurDeux));
    assert.equal(summarizeSession(faite, getExercisePlanForSession(ex, session)).completedSets, 2);
});
