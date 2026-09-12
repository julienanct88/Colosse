// v3.5.2 — le bug bloquant : un timer qui expire PENDANT que l'app est fermée.
// Ces tests portent sur la TRANSFORMATION DE LA SESSION, pas sur des drapeaux.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findDay, findExercise, getExercisePlan } from '../program.js';
import { createTimer } from '../engine/timer.js';
import { applyTimerOutcome, createTimerResolutionQueue } from '../engine/timer-effects.js';
import { computeExecutionStep, STAGES } from '../engine/execution.js';
import { emptyWarmupState, activationSteps, GENERAL_WARMUP } from '../engine/warmup.js';
import { currentSide } from '../engine/session.js';

const planFor = (w) => (ex) => getExercisePlan(ex, w);

/** Session réaliste, telle qu'elle est persistée dans IndexedDB. */
function makeSessionFor(dayId, { warmupDone = false } = {}) {
    const day = findDay(dayId);
    assert.equal(day.id, dayId, 'le jour de test doit exister réellement');
    const exercises = {};
    for (const ex of day.exercises) {
        const plan = getExercisePlan(ex, 1);
        exercises[ex.id] = {
            exerciseId: ex.id, variantId: ex.variants?.[0]?.id ?? null, skipped: false,
            sets: Array.from({ length: plan.sets }, () => ({
                done: false, weightKg: null, reps: null, rir: null,
                technique: 'good', pain: 0, restActualSec: null, completedAt: null,
            })),
        };
    }
    const session = {
        id: `2026-09-12:${dayId}`, dayId, weekIndex: 1, startedAt: 1_000, endedAt: null,
        exerciseOrder: day.exercises.map((e) => e.id), exercises,
        warmup: emptyWarmupState(), execution: { active: true }, activeTimer: null,
    };
    if (warmupDone) {
        session.warmup.general = { done: true, skipped: false, durationSec: 360 };
        for (const st of activationSteps(day))
            session.warmup.activation[st.key] = { done: true };
    }
    return { day, session };
}

// ---------------------------------------------------------------- ÉCHAUFFEMENT
test('warmup : 360 s expirés app fermée -> done, durée 360, plus aucun timer', () => {
    const { day, session } = makeSessionFor('push-a');
    const startedAt = 10_000;
    session.activeTimer = createTimer('general-warmup', GENERAL_WARMUP.durationSec, {}, startedAt);
    assert.equal(session.activeTimer.totalSec, 360);

    // L'app était fermée : on revient 400 s après le démarrage.
    const now = startedAt + 400_000;
    const { session: after } = applyTimerOutcome(session, session.activeTimer, now);

    assert.equal(after.activeTimer, null, 'aucun timer fantôme');
    assert.equal(after.warmup.general.done, true, 'effet métier appliqué, pas perdu');
    assert.equal(after.warmup.general.skipped, false);
    assert.equal(after.warmup.general.durationSec, 360);

    // Et l'étape suivante est bien l'activation.
    const step = computeExecutionStep({ day, session: after, resolvePlan: planFor(1) });
    assert.equal(step.stage, STAGES.ACTIVATION);
});

test('warmup : interrompu app fermée reste "passé", jamais accompli', () => {
    const { session } = makeSessionFor('push-a');
    const startedAt = 0;
    // Timer mis en pause à 90 s puis app fermée : elapsed figé à 90 s.
    const timer = { ...createTimer('general-warmup', 360, {}, startedAt), paused: true, pausedRemainingSec: 270 };
    const { session: after } = applyTimerOutcome(session, timer, startedAt + 999_000);
    assert.equal(after.warmup.general.done, false);
    assert.equal(after.warmup.general.skipped, true);
    assert.equal(after.warmup.general.durationSec, 90);
    assert.equal(after.activeTimer, null);
});

// ----------------------------------------------------------------------- CARDIO
test('cardio : 600 s expirés app fermée -> set done, reps = 600, plus aucun timer', () => {
    const { day, session } = makeSessionFor('pull-a', { warmupDone: true });
    const cardio = day.exercises.find((ex) => ex.kind === 'cardio');
    assert.ok(cardio, 'la journée de test contient bien un cardio');
    const startedAt = 5_000;
    session.activeTimer = createTimer('cardio', 600, { exerciseId: cardio.id }, startedAt);

    const { session: after } = applyTimerOutcome(session, session.activeTimer, startedAt + 700_000);

    assert.equal(after.activeTimer, null);
    const set = after.exercises[cardio.id].sets[0];
    assert.equal(set.done, true, 'le cardio accompli est enregistré');
    assert.equal(set.reps, 600, 'la durée réelle est écrite');
    assert.equal(set.weightKg, 0);
});

test('cardio : arrêté avant la fin -> incomplet et message cardio', () => {
    const { day, session } = makeSessionFor('pull-a', { warmupDone: true });
    const cardio = day.exercises.find((ex) => ex.kind === 'cardio');
    const timer = { ...createTimer('cardio', 600, { exerciseId: cardio.id }, 0), paused: true, pausedRemainingSec: 598 };
    const { session: after, message } = applyTimerOutcome(session, timer, 999_000);
    assert.equal(after.exercises[cardio.id].sets[0].done, false, 'étape incomplète');
    assert.equal(after.exercises[cardio.id].sets[0].reps, 2);
    assert.match(message, /^Cardio arrêté/);
});

// ------------------------------------------------------------------- RÉCUPÉRATION
test('recovery : 2700 s expirées app fermée -> set done, plus aucun timer', () => {
    const { day, session } = makeSessionFor('recovery');
    const walk = day.exercises[0];
    const startedAt = 0;
    session.activeTimer = createTimer('recovery', 2700, { exerciseId: walk.id }, startedAt);

    const { session: after } = applyTimerOutcome(session, session.activeTimer, startedAt + 3_000_000);

    assert.equal(after.activeTimer, null);
    assert.equal(after.exercises[walk.id].sets[0].done, true);
    assert.equal(after.exercises[walk.id].sets[0].reps, 2700);
});

test('recovery : arrêtée avant la fin -> message RÉCUPÉRATION, pas "Cardio"', () => {
    const { day, session } = makeSessionFor('recovery');
    const walk = day.exercises[0];
    const timer = { ...createTimer('recovery', 2700, { exerciseId: walk.id }, 0), paused: true, pausedRemainingSec: 2698 };
    const { session: after, message } = applyTimerOutcome(session, timer, 9_999_000);
    assert.equal(after.exercises[walk.id].sets[0].done, false);
    assert.match(message, /^Récupération arrêtée/);
    assert.doesNotMatch(message, /Cardio/);
});

// --------------------------------------------------------------------- WORK REST
test('work-rest : 180 s expirés app fermée -> restActualSec ≈ 180, plus aucun timer', () => {
    const { session } = makeSessionFor('push-a', { warmupDone: true });
    const exId = 'push-a-incline-smith';
    session.exercises[exId].sets[0].done = true;
    const startedAt = 0;
    session.activeTimer = createTimer('work-rest', 180, { exerciseId: exId, setIndex: 0 }, startedAt);

    const { session: after } = applyTimerOutcome(session, session.activeTimer, startedAt + 400_000);

    assert.equal(after.activeTimer, null);
    assert.equal(after.exercises[exId].sets[0].restActualSec, 180);
    assert.equal(after.exercises[exId].sets[0].done, true, 'la série reste faite');
});

test('ramp-rest : n’écrit jamais restActualSec (ce n’est pas une série de travail)', () => {
    const { session } = makeSessionFor('push-a', { warmupDone: true });
    const exId = 'push-a-incline-smith';
    session.activeTimer = createTimer('ramp-rest', 60, { exerciseId: exId, setIndex: 0 }, 0);
    const { session: after } = applyTimerOutcome(session, session.activeTimer, 200_000);
    assert.equal(after.activeTimer, null);
    assert.equal(after.exercises[exId].sets[0].restActualSec, null);
});

// -------------------------------------------------------------------- SIDE SWITCH
test('side-switch : 20 s expirées app fermée -> plus aucun timer, étape suivante = DROITE', () => {
    const { day, session } = makeSessionFor('legs-a', { warmupDone: true });
    // On amène la séance jusqu'à la première série des fentes bulgares.
    session.warmup.ramps['legs-a-hack'] = { referenceLoadKg: 100, done: [true, true, true] };
    session.warmup.ramps['legs-a-press'] = { referenceLoadKg: 200, done: [true, true] };
    for (const id of ['legs-a-hack', 'legs-a-press']) {
        const plan = getExercisePlan(findExercise(id), 1);
        session.exercises[id].sets.slice(0, plan.sets).forEach((set) => { set.done = true; });
    }
    const set = session.exercises['legs-a-bulgarian'].sets[0];
    set.sides = { left: { done: true, reps: 12, rir: 2, technique: 'good', pain: 0 } };
    session.activeTimer = createTimer('side-switch', 20, { exerciseId: 'legs-a-bulgarian', setIndex: 0 }, 0);

    const { session: after } = applyTimerOutcome(session, session.activeTimer, 60_000);

    assert.equal(after.activeTimer, null);
    assert.equal(currentSide(after.exercises['legs-a-bulgarian'].sets[0]), 'right');
    const step = computeExecutionStep({ day, session: after, resolvePlan: planFor(1) });
    assert.equal(step.stage, STAGES.WORK_SET);
    assert.equal(step.exerciseId, 'legs-a-bulgarian');
    assert.equal(step.side, 'right', 'après le switch on est à DROITE');
    assert.equal(step.setIndex, 0, 'toujours la même série');
    assert.equal(after.exercises['legs-a-bulgarian'].sets[0].sides.left.reps, 12, 'le côté gauche est intact');
});

// ------------------------------------------------------------- AUCUN EFFET PERDU
test('aucun effet métier perdu : chaque kind laisse une trace ou avance l’étape', () => {
    const cases = [
        ['general-warmup', {}, (a) => a.warmup.general.done === true],
        ['cardio', { exerciseId: 'pull-a-incline-walk' }, (a) => a.exercises['pull-a-incline-walk']?.sets[0].done === true],
        ['work-rest', { exerciseId: 'push-a-incline-smith', setIndex: 0 }, (a) => a.exercises['push-a-incline-smith'].sets[0].restActualSec === 60],
    ];
    for (const [kind, context, check] of cases) {
        const { session } = makeSessionFor(kind === 'cardio' ? 'pull-a' : 'push-a', { warmupDone: kind !== 'general-warmup' });
        const timer = createTimer(kind, 60, context, 0);
        const { session: after } = applyTimerOutcome(session, timer, 100_000);
        assert.equal(after.activeTimer, null, `${kind} : timer fermé`);
        assert.ok(check(after), `${kind} : effet métier appliqué`);
    }
});

test('la session d’origine n’est jamais modifiée (fonction pure)', () => {
    const { session } = makeSessionFor('push-a');
    const timer = createTimer('general-warmup', 360, {}, 0);
    session.activeTimer = timer;
    const { session: after } = applyTimerOutcome(session, timer, 400_000);
    assert.notEqual(after, session);
    assert.equal(session.activeTimer, timer, 'l’originale garde son timer');
    assert.equal(session.warmup.general.done, false, 'l’originale n’est pas touchée');
    assert.equal(after.warmup.general.done, true);
});

test('résoudre deux fois de suite n’applique rien la seconde fois', () => {
    const { session } = makeSessionFor('pull-a', { warmupDone: true });
    const timer = createTimer('cardio', 600, { exerciseId: 'pull-a-incline-walk' }, 0);
    session.activeTimer = timer;
    const first = applyTimerOutcome(session, timer, 700_000).session;
    // Deuxième passage : plus de timer actif, donc rien à appliquer.
    const second = applyTimerOutcome(first, first.activeTimer, 800_000).session;
    assert.equal(second.activeTimer, null);
    assert.equal(second.exercises['pull-a-incline-walk'].sets[0].reps, 600, 'la donnée n’est ni doublée ni écrasée');
});

// ----------------------------------------------------- VERROU « EXACTLY ONCE »
test('verrou : deux résolutions concurrentes n’appliquent l’effet qu’une fois', async () => {
    const queue = createTimerResolutionQueue();
    // État partagé, comme la session en mémoire + IndexedDB.
    let store = { activeTimer: createTimer('cardio', 600, { exerciseId: 'bike' }, 0),
                  exercises: { bike: { sets: [{ done: false, reps: null }] } } };
    const order = [];
    const resolve = async (tag) => {
        order.push(`début:${tag}`);
        const timer = store.activeTimer;
        if (!timer) { order.push(`rien:${tag}`); return; }
        const { session } = applyTimerOutcome(store, timer, 700_000);
        await new Promise((r) => setTimeout(r, 10)); // simule la sauvegarde
        store = session;
        order.push(`écrit:${tag}`);
    };
    // tick() et un clic au même instant.
    await Promise.all([queue.run(() => resolve('tick')), queue.run(() => resolve('clic'))]);

    assert.equal(store.activeTimer, null);
    assert.equal(store.exercises.bike.sets[0].reps, 600, 'la durée n’est écrite qu’une fois');
    assert.deepEqual(order, ['début:tick', 'écrit:tick', 'début:clic', 'rien:clic'],
        'jamais deux résolutions en parallèle, la seconde ne trouve plus de timer');
    assert.equal(queue.busy, false, 'le verrou est relâché à la fin');
});

test('verrou : une résolution qui échoue ne bloque pas les suivantes', async () => {
    const queue = createTimerResolutionQueue();
    await assert.rejects(queue.run(async () => { throw new Error('save KO'); }), /save KO/);
    assert.equal(queue.busy, false);
    assert.equal(await queue.run(async () => 'ok'), 'ok');
});
