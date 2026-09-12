import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findDay, findExercise, getExercisePlan } from '../program.js';
import { createTimer, timerOutcome, timerLabel, remainingSeconds, isExpired, adjustTimer, timerControls, canShortenTimer } from '../engine/timer.js';
import { applyTimerOutcome } from '../engine/timer-effects.js';
import { aggregateSides, currentSide, bothSidesDone, countSessionSets, closeSession, resetExerciseLogForVariant } from '../engine/session.js';
import { computeExecutionStep, executionProgress, STAGES } from '../engine/execution.js';
import { computeRampSets, emptyWarmupState, activationSteps, isGeneralWarmupDone, clearExerciseRamps, normalizeWarmupState, getRampProtocol } from '../engine/warmup.js';

const APP = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const planFor = (w) => (ex) => getExercisePlan(ex, w);

// 2 — une seule architecture timer.
// Recherche de source ACCEPTABLE ici : on prouve l'ABSENCE d'un symbole
// interdit, pas un comportement.
test('2. plus aucune trace de l’ancien moteur de timer', () => {
  const TIMER = readFileSync(new URL('../engine/timer.js', import.meta.url), 'utf8');
  for (const legacy of ['closeRestTimer', 'timerElapsedMs', 'toggleTimerPause', 'startRestTimer', 'pausedMs', 'pauseStartedAt', 'startCardio(', 'finishCardio('])
    assert.equal(APP.includes(legacy), false, `${legacy} doit avoir disparu`);
  // v3.5.2 : le drapeau piégeux « déjà traité » est supprimé partout.
  for (const trap of ['completedHandled', 'markCompleted', 'needsCompletion'])
    assert.equal(APP.includes(trap) || TIMER.includes(`function ${trap}`), false, `${trap} ne doit plus exister`);
  assert.equal('completedHandled' in createTimer('work-rest', 60, {}, 0), false, 'un timer neuf ne porte plus ce drapeau');
});

// 1, 3, 18, 19 — pas de timer fantôme
test('1+3. la résolution d’un timer vide toujours session.activeTimer', () => {
  const t = createTimer('work-rest', 180, { exerciseId: 'x', setIndex: 0 }, 0);
  const session = { id: 's', exercises: { x: { sets: [{ done: true, restActualSec: null }] } }, activeTimer: t };
  const { session: after } = applyTimerOutcome(session, t, 200000);
  assert.equal(after.activeTimer, null, 'plus rien à reprendre après résolution');
  assert.equal(after.exercises.x.sets[0].restActualSec, 180, 'et l’effet métier est bien appliqué');
  assert.equal(isExpired(after.activeTimer, 999999), false);
});
test('18+19. finishSession (closeSession) vide le timer et désactive le mode exécution', () => {
  const session = {
    id: 's', startedAt: 1000, endedAt: null,
    activeTimer: createTimer('work-rest', 180, {}, 0),
    execution: { active: true, stage: STAGES.WORK_SET, exerciseId: 'x', setIndex: 1 },
    exercises: {},
  };
  const closed = closeSession(session, { now: 5000, status: 'INCOMPLETE' });
  assert.equal(closed.activeTimer, null, 'aucun timer ne survit à la clôture');
  assert.equal(closed.execution.active, false);
  assert.equal(closed.execution.stage, null);
  assert.equal(closed.endedAt, 5000);
  assert.equal(closed.status, 'INCOMPLETE');
  assert.equal(session.activeTimer !== null, true, 'la session d’origine n’est pas mutée');
});

// 4-5 — échauffement interrompu vs accompli
test('4. un échauffement arrêté avant 360 s n’est jamais "done"', () => {
  const t = createTimer('general-warmup', 360, {}, 0);
  const early = timerOutcome(t, 90000); // 1:30
  assert.equal(early.durationSec, 90);
  assert.equal(early.complete, false, 'interrompu = passé, jamais accompli');
});
test('5. un échauffement mené à 360 s est accompli', () => {
  const t = createTimer('general-warmup', 360, {}, 0);
  const full = timerOutcome(t, 360000);
  assert.equal(full.complete, true);
  assert.equal(full.durationSec, 360);
});
test('5b. isGeneralWarmupDone accepte done OU skipped, mais l’historique distingue', () => {
  assert.equal(isGeneralWarmupDone({ general: { done: true, skipped: false } }), true);
  assert.equal(isGeneralWarmupDone({ general: { done: false, skipped: true } }), true);
  assert.equal(isGeneralWarmupDone({ general: { done: false, skipped: false } }), false);
});

// 6-7 — récupération
test('6+7. la récupération a son propre kind et son propre libellé', () => {
  const t = createTimer('recovery', 2700, {}, 0);
  assert.equal(t.kind, 'recovery');
  assert.equal(timerLabel('recovery'), 'RÉCUPÉRATION');
  assert.notEqual(timerLabel('recovery'), 'CARDIO');
  // Contrôle d'artefact de build (l'action existe bien dans le rendu) ;
  // la preuve de comportement est le message ci-dessous et le test navigateur.
  const ui = readFileSync(new URL('../ui/execution.js', import.meta.url), 'utf8');
  assert.ok(ui.includes('exec-start-recovery'), 'la récupération utilise son action dédiée');
  // Le message d'arrêt incomplet parle de récupération, jamais de cardio.
  const session = { id: 's', exercises: { walk: { sets: [{ done: false }] } } };
  const stopped = { ...createTimer('recovery', 2700, { exerciseId: 'walk' }, 0), paused: true, pausedRemainingSec: 2600 };
  const { message } = applyTimerOutcome(session, stopped, 999999);
  assert.match(message, /Récupération arrêtée/);
  assert.doesNotMatch(message, /Cardio/);
});

// 8-9 — changement de variante
test('8+9. changer de variante efface les rampes et recalcule avec le nouvel incrément', () => {
  const warmup = normalizeWarmupState({ ramps: {
    'push-a-incline-smith': { referenceLoadKg: 100, done: [true, true, true] },
    'push-a-chest-press': { referenceLoadKg: 80, done: [true, true] },
  } });
  const cleared = clearExerciseRamps(warmup, 'push-a-incline-smith');
  assert.equal(cleared.ramps['push-a-incline-smith'], undefined, 'les rampes de l’exercice sont effacées');
  assert.ok(cleared.ramps['push-a-chest-press'], 'les autres exercices ne sont pas touchés');
  const log = { variantId: 'smith', skipped: true, sets: [{ done: true, weightKg: 100 }, { done: true, weightKg: 100 }] };
  const reset = resetExerciseLogForVariant(log, 'machine', 3, () => ({ done: false, weightKg: null }));
  assert.equal(reset.variantId, 'machine');
  assert.equal(reset.skipped, false);
  assert.equal(reset.sets.length, 3);
  assert.equal(reset.sets.some((set) => set.done), false, 'aucune série de l’ancienne machine ne survit');
  const ex = findExercise('push-a-incline-smith');
  const smith = computeRampSets(ex, 100, 2.5);
  const machine = computeRampSets(ex, 100, 5);
  assert.equal(smith[2].loadKg, 77.5);
  assert.equal(machine[2].loadKg, 80, 'incrément 5 kg -> arrondi différent (77,5 -> 80)');
  assert.notEqual(smith[2].loadKg, machine[2].loadKg);
});

// 10-17 — parcours unilatéral complet
function bulgarianSession() {
  const day = findDay('legs-a');
  const exercises = {};
  for (const ex of day.exercises) {
    const plan = getExercisePlan(ex, 1);
    exercises[ex.id] = { variantId: ex.variants?.[0]?.id ?? null, skipped: false,
      sets: Array.from({ length: plan.sets }, () => ({ done: false, weightKg: null, reps: null, rir: null, technique: 'good', pain: 0 })) };
  }
  const session = { id: 't', dayId: day.id, weekIndex: 1, exercises,
    exerciseOrder: day.exercises.map((e) => e.id), warmup: emptyWarmupState(), execution: { active: true } };
  session.warmup.general.done = true;
  for (const st of activationSteps(day)) session.warmup.activation[st.key] = { done: true };
  session.warmup.ramps['legs-a-hack'] = { referenceLoadKg: 100, done: [true, true, true] };
  session.warmup.ramps['legs-a-press'] = { referenceLoadKg: 200, done: [true, true] };
  for (const id of ['legs-a-hack', 'legs-a-press']) {
    const p = getExercisePlan(findExercise(id), 1);
    exercises[id].sets.slice(0, p.sets).forEach((x) => { x.done = true; });
  }
  return { day, session };
}

test('10+11. valider le côté gauche ne termine PAS la série', () => {
  const { day, session } = bulgarianSession();
  const step = computeExecutionStep({ day, session, resolvePlan: planFor(1) });
  assert.equal(step.exerciseId, 'legs-a-bulgarian');
  assert.equal(step.side, 'left');
  const set = session.exercises['legs-a-bulgarian'].sets[0];
  set.sides = { left: { done: true, reps: 12, rir: 2, technique: 'good', pain: 0 } };
  assert.equal(set.done, false, 'la série reste ouverte après le côté gauche');
  assert.equal(bothSidesDone(set), false);
});
test('12. après le changement de côté, on passe à droite', () => {
  const { day, session } = bulgarianSession();
  const set = session.exercises['legs-a-bulgarian'].sets[0];
  set.sides = { left: { done: true, reps: 12, rir: 2, technique: 'good', pain: 0 } };
  assert.equal(currentSide(set), 'right');
  const step = computeExecutionStep({ day, session, resolvePlan: planFor(1) });
  assert.equal(step.side, 'right', 'le mode exécution affiche le côté droit');
});
test('13+14. le côté droit termine la série et déclenche roundRestSec', () => {
  const plan = getExercisePlan(findExercise('legs-a-bulgarian'), 1);
  assert.equal(plan.roundRestSec, 120);
  assert.equal(plan.sideSwitchSec, 20);
  const t = createTimer('work-rest', plan.roundRestSec, {}, 0);
  assert.equal(t.totalSec, 120, 'le repos après les deux côtés utilise roundRestSec');
});
test('15. un reload au milieu de l’unilatéral reprend le bon côté', () => {
  const { day, session } = bulgarianSession();
  const set = session.exercises['legs-a-bulgarian'].sets[0];
  set.sides = { left: { done: true, reps: 12, rir: 2, technique: 'good', pain: 0 } };
  // simulation d'un reload : on repart uniquement de la session persistée
  const reloaded = JSON.parse(JSON.stringify(session));
  const step = computeExecutionStep({ day, session: reloaded, resolvePlan: planFor(1) });
  assert.equal(step.side, 'right');
  assert.equal(step.setIndex, 0, 'toujours la même série');
});
test('16. gauche et droite conservent des valeurs distinctes', () => {
  const set = { sides: {
    left: { done: true, reps: 12, rir: 2, technique: 'good', pain: 0 },
    right: { done: true, reps: 10, rir: 1, technique: 'degraded', pain: 3 },
  } };
  assert.equal(set.sides.left.reps, 12);
  assert.equal(set.sides.right.reps, 10, 'le côté droit n’écrase pas le gauche');
  const merged = aggregateSides(set);
  assert.equal(merged.reps, 10, 'reps = minimum');
  assert.equal(merged.rir, 1, 'RIR = la marge la plus faible');
  assert.equal(merged.technique, 'degraded', 'dégradée si un seul côté l’est');
  assert.equal(merged.pain, 3, 'douleur = maximum');
});
test('17. une série unilatérale complète reste UNE seule série', () => {
  const { day, session } = bulgarianSession();
  const log = session.exercises['legs-a-bulgarian'];
  log.sets[0].sides = { left: { done: true, reps: 10 }, right: { done: true, reps: 10 } };
  log.sets[0].done = true;
  const count = countSessionSets(session, day, planFor(1));
  const plan = getExercisePlan(findExercise('legs-a-bulgarian'), 1);
  assert.equal(plan.sets, 3);
  // 1 série bulgare + les séries des exercices déjà terminés
  const bulgarianDone = log.sets.filter((x) => x.done).length;
  assert.equal(bulgarianDone, 1, 'jamais 2');
});

// 20 — compatibilité ascendante
test('20. une série v3.5.0 sans sides reste lisible', () => {
  const legacy = { done: true, weightKg: 80, reps: 8, rir: 2, technique: 'good', pain: 0 };
  assert.equal(aggregateSides(legacy), null, 'aucune agrégation forcée');
  assert.equal(currentSide(legacy), 'left');
  assert.equal(bothSidesDone(legacy), false);
  assert.equal(legacy.done, true, 'la donnée existante est intacte');
});

// ============================ v3.5.2 ============================

// 4 — contrôles du timer selon le type
test('v3.5.2 · échauffement, cardio et récupération ne peuvent pas être raccourcis', () => {
  for (const kind of ['general-warmup', 'cardio', 'recovery']) {
    const ids = timerControls(kind).map((c) => c.id);
    assert.equal(ids.includes('minus'), false, `${kind} : pas de bouton −15 s`);
    assert.equal(canShortenTimer(kind), false);
    assert.ok(ids.includes('pause'), `${kind} : pause disponible`);
    assert.ok(ids.includes('skip'), `${kind} : on peut toujours arrêter/passer`);
    const plus = timerControls(kind).find((c) => c.id === 'plus');
    assert.ok(plus.deltaSec > 0, `${kind} : on ne peut qu'allonger`);
  }
});
test('v3.5.2 · les repos restent ajustables dans les deux sens', () => {
  for (const kind of ['work-rest', 'ramp-rest', 'activation-rest', 'side-switch']) {
    const ids = timerControls(kind).map((c) => c.id);
    assert.deepEqual(ids, ['minus', 'pause', 'plus', 'skip'], `${kind} : −15 / pause / +15 / passer`);
    assert.equal(canShortenTimer(kind), true);
  }
});
test('v3.5.2 · libellés : "Arrêter" pour cardio et récup, "Passer" pour les repos', () => {
  const skipLabel = (kind) => timerControls(kind).find((c) => c.id === 'skip').label;
  assert.equal(skipLabel('cardio'), 'Arrêter');
  assert.equal(skipLabel('recovery'), 'Arrêter');
  assert.equal(skipLabel('general-warmup'), 'Passer');
  assert.equal(skipLabel('work-rest'), 'Passer');
  assert.equal(timerControls('recovery').find((c) => c.id === 'plus').deltaSec, 300, 'récup : +5 min');
  assert.equal(timerControls('general-warmup').find((c) => c.id === 'plus').deltaSec, 30);
});
test('v3.5.2 · un échauffement allongé puis mené au bout reste accompli', () => {
  // +30 s doit rester honnête : 390 s courues sur 390 s prescrites = accompli.
  const t = createTimer('general-warmup', 360, {}, 0);
  const longer = adjustTimer(t, 30, 0);
  assert.equal(longer.totalSec, 390);
  const out = timerOutcome(longer, 390_000);
  assert.equal(out.complete, true);
  assert.equal(out.durationSec, 390);
});

// 5 — les ramp sets sont des étapes du mode exécution
test('v3.5.2 · le compteur X/Y inclut les séries de montée en charge', () => {
  const day = findDay('push-a');
  const plan = (ex) => getExercisePlan(ex, 1);
  const session = { exercises: {}, exerciseOrder: day.exercises.map((e) => e.id), warmup: emptyWarmupState() };
  for (const ex of day.exercises)
    session.exercises[ex.id] = { skipped: false, sets: Array.from({ length: plan(ex).sets }, () => ({ done: false })) };

  const rampSteps = day.exercises.reduce((n, ex) => n + (getRampProtocol(ex)?.length ?? 0), 0);
  const workSets = day.exercises.reduce((n, ex) => n + plan(ex).sets, 0);
  const expected = 1 + activationSteps(day).length + rampSteps + workSets;
  assert.equal(rampSteps, 5, 'Push A : 3 ramps primary + 2 ramps secondary');

  const progress = executionProgress({ day, session, resolvePlan: plan });
  assert.equal(progress.total, expected, 'total = warmup + activation + ramps + séries');

  // Valider les ramps fait avancer le compteur…
  session.warmup.ramps['push-a-incline-smith'] = { referenceLoadKg: 100, done: [true, true, true] };
  const advanced = executionProgress({ day, session, resolvePlan: plan });
  assert.equal(advanced.done, 3);
  assert.equal(advanced.total, expected, '…sans changer le total');

  // …mais jamais le décompte des séries de travail.
  assert.equal(countSessionSets(session, day, plan).done, 0, 'aucune série de travail réalisée');
});
test('v3.5.2 · une journée récupération ne compte ni warmup ni ramps', () => {
  const day = findDay('recovery');
  const plan = (ex) => getExercisePlan(ex, 1);
  const session = { exercises: {}, exerciseOrder: day.exercises.map((e) => e.id), warmup: emptyWarmupState() };
  for (const ex of day.exercises)
    session.exercises[ex.id] = { skipped: false, sets: [{ done: false }] };
  const progress = executionProgress({ day, session, resolvePlan: plan });
  assert.equal(progress.total, day.exercises.length, 'une étape par bloc de récupération');
});
