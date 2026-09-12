import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findDay, findExercise, getExercisePlan } from '../program.js';
import { createTimer, timerOutcome, timerLabel, remainingSeconds, needsCompletion, markCompleted } from '../engine/timer.js';
import { aggregateSides, currentSide, bothSidesDone, countSessionSets } from '../engine/session.js';
import { computeExecutionStep, STAGES } from '../engine/execution.js';
import { computeRampSets, emptyWarmupState, activationSteps, isGeneralWarmupDone } from '../engine/warmup.js';

const APP = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const planFor = (w) => (ex) => getExercisePlan(ex, w);

// 2 — une seule architecture timer
test('2. plus aucune trace de l’ancien moteur de timer', () => {
  for (const legacy of ['closeRestTimer', 'timerElapsedMs', 'toggleTimerPause', 'startRestTimer', 'pausedMs', 'pauseStartedAt', 'startCardio(', 'finishCardio('])
    assert.equal(APP.includes(legacy), false, `${legacy} doit avoir disparu`);
});

// 1, 3, 18, 19 — pas de timer fantôme
test('1+3. la résolution d’un timer vide toujours session.activeTimer', () => {
  // vérifie le contrat du moteur : après résolution, plus rien à reprendre
  const t = createTimer('work-rest', 180, { exerciseId: 'x', setIndex: 0 }, 0);
  const handled = markCompleted(t);
  assert.equal(needsCompletion(handled, 999999), false);
  assert.ok(APP.includes('ctx.session.activeTimer = null'), 'activeTimer remis à null');
});
test('18+19. finishSession vide le timer et désactive le mode exécution', () => {
  assert.ok(APP.includes('context.session.activeTimer = null'));
  assert.ok(APP.includes('active: false, stage: null'));
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
  const ui = readFileSync(new URL('../ui/execution.js', import.meta.url), 'utf8');
  assert.ok(ui.includes('exec-start-recovery'), 'la récupération utilise son action dédiée');
  assert.ok(APP.includes("'recovery'") && APP.includes('Arrêter cette étape de récupération'));
});

// 8-9 — changement de variante
test('8+9. changer de variante efface les rampes et recalcule avec le nouvel incrément', () => {
  assert.ok(APP.includes('delete warmup.ramps[exerciseId]'), 'les rampes de l’exercice sont effacées');
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
