// v3.5.4 — deux garde-fous : un seul chrono à la fois, et un chrono appartient
// à SA séance, jamais au jour affiché.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findDay, getExercisePlan } from '../program.js';
import { createTimer, isExpired } from '../engine/timer.js';
import { applyTimerOutcome, startTimerDecision, timerOwnerSession } from '../engine/timer-effects.js';
import { emptyWarmupState, activationSteps } from '../engine/warmup.js';
import { renderExecution } from '../ui/execution.js';
import { STAGES } from '../engine/execution.js';

function sessionFor(dayId, date, { warmupDone = true } = {}) {
    const day = findDay(dayId);
    const exercises = {};
    for (const ex of day.exercises) {
        const plan = getExercisePlan(ex, 1);
        exercises[ex.id] = { exerciseId: ex.id, variantId: ex.variants?.[0]?.id ?? null, skipped: false,
            sets: Array.from({ length: plan.sets }, () => ({ done: false, weightKg: null, reps: null,
                rir: null, technique: 'good', pain: 0, restActualSec: null, completedAt: null })) };
    }
    const session = { id: `${date}:${dayId}`, date, dayId, weekIndex: 1, startedAt: 1000, endedAt: null,
        exerciseOrder: day.exercises.map((e) => e.id), exercises, warmup: emptyWarmupState(),
        execution: { active: true }, activeTimer: null, updatedAt: 1000 };
    if (warmupDone) {
        session.warmup.general = { done: true, skipped: false, durationSec: 360 };
        for (const st of activationSteps(day))
            session.warmup.activation[st.key] = { done: true };
    }
    return { day, session };
}

/**
 * Reproduit startGenericTimer : décision, puis création. C'est la dernière
 * ligne de défense de l'app, réduite à ses deux appels moteur.
 */
function demarrerChrono(session, runningTimer, kind, seconds, context, now) {
    const decision = startTimerDecision(session, runningTimer, now);
    if (decision.action === 'refuse')
        return { cree: false, timer: runningTimer, decision };
    const timer = createTimer(kind, seconds, { ...context, sessionId: session.id }, now);
    session.activeTimer = timer;
    session.updatedAt = now;
    return { cree: true, timer, decision };
}

// ================================ 1. UN SEUL CHRONO

test('1. un deuxième démarrage 100 ms plus tard ne remplace RIEN', () => {
    const { session } = sessionFor('pull-a', '2026-09-07');
    const T0 = 1_000_000;
    const premier = demarrerChrono(session, null, 'cardio', 600, { exerciseId: 'pull-a-incline-walk' }, T0);
    assert.equal(premier.cree, true, 'le premier chrono est bien créé');
    const avant = JSON.parse(JSON.stringify(session.activeTimer));

    // Double tap : deuxième appel 100 ms plus tard.
    const second = demarrerChrono(session, premier.timer, 'cardio', 600, { exerciseId: 'pull-a-incline-walk' }, T0 + 100);
    assert.equal(second.cree, false, 'aucun deuxième chrono');
    assert.equal(second.decision.action, 'refuse');
    assert.equal(second.decision.reason, 'timer-already-running');

    assert.equal(session.activeTimer.startedAt, avant.startedAt, 'même startedAt');
    assert.equal(session.activeTimer.endsAt, avant.endsAt, 'même endsAt');
    assert.equal(session.activeTimer.kind, avant.kind, 'même kind');
    assert.deepEqual(session.activeTimer, avant, 'aucune donnée remplacée');
});

test('1b. un chrono d’un AUTRE kind ne passe pas non plus', () => {
    const { session } = sessionFor('pull-a', '2026-09-07');
    const T0 = 500;
    demarrerChrono(session, null, 'cardio', 600, { exerciseId: 'pull-a-incline-walk' }, T0);
    const avant = JSON.parse(JSON.stringify(session.activeTimer));
    for (const kind of ['work-rest', 'general-warmup', 'side-switch', 'recovery']) {
        const res = demarrerChrono(session, session.activeTimer, kind, 120, {}, T0 + 50);
        assert.equal(res.cree, false, `${kind} refusé`);
        assert.deepEqual(session.activeTimer, avant, `${kind} n’a rien écrasé`);
    }
});

test('1c. un chrono tenu en mémoire bloque même si la séance affichée n’en a pas', () => {
    // Chrono de la séance A, on tente de démarrer sur la séance B.
    const a = sessionFor('pull-a', '2026-09-07').session;
    const b = sessionFor('legs-b', '2026-09-12').session;
    const timerA = createTimer('cardio', 600, { exerciseId: 'pull-a-incline-walk', sessionId: a.id }, 0);
    a.activeTimer = timerA;
    const res = demarrerChrono(b, timerA, 'work-rest', 150, {}, 100);
    assert.equal(res.cree, false, 'un chrono tourne ailleurs : refus');
    assert.equal(b.activeTimer, null, 'la séance B ne reçoit aucun chrono');
    assert.deepEqual(a.activeTimer, timerA, 'le chrono de A est intact');
});

test('1d. un chrono déjà EXPIRÉ ne bloque pas le suivant (il est résolu d’abord)', () => {
    const { session } = sessionFor('pull-a', '2026-09-07');
    session.activeTimer = createTimer('work-rest', 60, { exerciseId: 'pull-a-lat-pronation', setIndex: 0, sessionId: session.id }, 0);
    const now = 200_000;
    assert.equal(isExpired(session.activeTimer, now), true);
    assert.equal(startTimerDecision(session, session.activeTimer, now).action, 'resolve-first');
    // Après résolution, la place est libre.
    const resolved = applyTimerOutcome(session, session.activeTimer, now).session;
    assert.equal(resolved.activeTimer, null);
    assert.equal(startTimerDecision(resolved, null, now).action, 'start');
});

test('1e. le chrono créé porte l’identité de sa séance', () => {
    const { session } = sessionFor('pull-a', '2026-09-07');
    demarrerChrono(session, null, 'cardio', 600, { exerciseId: 'pull-a-incline-walk' }, 42);
    assert.equal(session.activeTimer.context.sessionId, '2026-09-07:pull-a');
    assert.equal(session.activeTimer.context.exerciseId, 'pull-a-incline-walk', 'le contexte métier est conservé');
});

// ================================ 2. ÉCHAUFFEMENT : BOUTON DÉSACTIVÉ

test('2. pendant le chrono d’échauffement, le bouton est désactivé', () => {
    const day = findDay('push-a');
    const base = { day, progress: { done: 0, total: 10, percent: 0 }, elapsedSec: 0 };
    const step = { stage: STAGES.GENERAL_WARMUP };
    const sansTimer = renderExecution(step, { ...base, session: { activeTimer: null } });
    assert.match(sansTimer, />DÉMARRER</);
    assert.doesNotMatch(sansTimer, /disabled/);

    const avecTimer = renderExecution(step, { ...base,
        session: { activeTimer: createTimer('general-warmup', 360, { sessionId: 'x' }, 0) } });
    assert.match(avecTimer, /CHRONO EN COURS/);
    assert.match(avecTimer, /disabled/);
    assert.doesNotMatch(avecTimer, />DÉMARRER</, 'plus de bouton DÉMARRER pendant le chrono');
    // L'échappatoire « Passer » reste disponible.
    assert.match(avecTimer, /exec-skip-general-warmup/);
});

test('2b. un chrono d’un autre kind ne désactive pas l’échauffement', () => {
    const day = findDay('push-a');
    const html = renderExecution({ stage: STAGES.GENERAL_WARMUP }, {
        day, progress: { done: 0, total: 10, percent: 0 }, elapsedSec: 0,
        session: { activeTimer: createTimer('work-rest', 150, { sessionId: 'x' }, 0) },
    });
    assert.match(html, />DÉMARRER</);
});

// ================================ 3+4. PROPRIÉTÉ DU CHRONO

test('3. le propriétaire est la séance du chrono, jamais celle affichée', () => {
    const a = sessionFor('pull-a', '2026-09-07').session;
    const b = sessionFor('legs-b', '2026-09-12').session;
    const timer = createTimer('cardio', 600, { exerciseId: 'pull-a-incline-walk', sessionId: a.id }, 0);
    a.activeTimer = timer;
    // Le jour affiché est B : le propriétaire reste A.
    assert.equal(timerOwnerSession([a, b], timer, b).id, a.id);
    // Timer d'avant v3.5.4 (sans sessionId) : on retombe sur la séance affichée.
    assert.equal(timerOwnerSession([a, b], createTimer('cardio', 600, {}, 0), b).id, b.id);
    // Séance propriétaire absente du snapshot : on ne casse pas.
    assert.equal(timerOwnerSession([b], timer, b).id, b.id);
    assert.equal(timerOwnerSession([], timer, null), null);
});

test('4. cardio : changement de jour puis expiration -> A mise à jour, B intacte', () => {
    const a = sessionFor('pull-a', '2026-09-07').session;
    const b = sessionFor('legs-b', '2026-09-12').session;
    const T0 = 1_000_000;
    demarrerChrono(a, null, 'cardio', 600, { exerciseId: 'pull-a-incline-walk' }, T0);
    const bAvant = JSON.parse(JSON.stringify(b));
    const sessions = [a, b];

    // L'écran affiche B quand le chrono de A expire.
    const now = T0 + 700_000;
    const owner = timerOwnerSession(sessions, a.activeTimer, b);
    assert.equal(owner.id, a.id, 'la résolution cible A, pas le jour affiché');
    const result = applyTimerOutcome(owner, owner.activeTimer, now);
    sessions[sessions.findIndex((s) => s.id === result.session.id)] = result.session;

    const aApres = sessions.find((s) => s.id === a.id);
    assert.equal(aApres.activeTimer, null, 'A : plus aucun chrono');
    assert.equal(aApres.exercises['pull-a-incline-walk'].sets[0].reps, 600, 'A : cardio enregistré');
    assert.equal(aApres.exercises['pull-a-incline-walk'].sets[0].done, true);
    assert.deepEqual(sessions.find((s) => s.id === b.id), bAvant, 'B : absolument aucune donnée modifiée');
});

test('4b. work-rest : changement de jour puis expiration -> A mise à jour, B intacte', () => {
    const a = sessionFor('pull-a', '2026-09-07').session;
    const b = sessionFor('legs-b', '2026-09-12').session;
    a.exercises['pull-a-lat-pronation'].sets[0].done = true;
    const T0 = 0;
    demarrerChrono(a, null, 'work-rest', 180, { exerciseId: 'pull-a-lat-pronation', setIndex: 0 }, T0);
    const bAvant = JSON.parse(JSON.stringify(b));
    const sessions = [a, b];

    const owner = timerOwnerSession(sessions, a.activeTimer, b);
    const result = applyTimerOutcome(owner, owner.activeTimer, T0 + 400_000);
    sessions[sessions.findIndex((s) => s.id === result.session.id)] = result.session;

    const aApres = sessions.find((s) => s.id === a.id);
    assert.equal(aApres.activeTimer, null);
    assert.equal(aApres.exercises['pull-a-lat-pronation'].sets[0].restActualSec, 180, 'A : repos réel enregistré');
    assert.equal(aApres.exercises['pull-a-lat-pronation'].sets[0].done, true, 'A : la série reste faite');
    assert.deepEqual(sessions.find((s) => s.id === b.id), bAvant, 'B : intacte');
});

test('4c. après résolution, aucun chrono fantôme à reprendre dans A ni dans B', () => {
    const a = sessionFor('pull-a', '2026-09-07').session;
    const b = sessionFor('legs-b', '2026-09-12').session;
    demarrerChrono(a, null, 'cardio', 600, { exerciseId: 'pull-a-incline-walk' }, 0);
    const resolved = applyTimerOutcome(a, a.activeTimer, 700_000).session;
    const sessions = [resolved, b];
    // Ce que fait restoreTimerFromSession au reload, sur l'une comme sur l'autre.
    for (const session of sessions) {
        assert.equal(session.activeTimer, null, `${session.id} : rien à restaurer`);
        assert.equal(isExpired(session.activeTimer), false);
    }
});
