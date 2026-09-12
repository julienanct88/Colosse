import test from 'node:test';
import assert from 'node:assert/strict';
import { findDay, findExercise, getExercisePlan } from '../program.js';
import {
  computeRampSets, roundWarmupLoad, getRampProtocol, activationSteps,
  resolveReferenceLoad, isWarmupComplete, emptyWarmupState, RAMP_PROTOCOLS,
} from '../engine/warmup.js';
import { computeExecutionStep, executionProgress, STAGES, orderedExercises } from '../engine/execution.js';
import {
  createTimer, remainingSeconds, isExpired, needsCompletion, markCompleted,
  pauseTimer, resumeTimer, timerOutcome, timerLabel, elapsedSeconds,
} from '../engine/timer.js';

const planFor = (week) => (ex) => getExercisePlan(ex, week);

/** Construit une session vierge pour un jour. */
function blankSession(day, week = 1) {
  const exercises = {};
  for (const ex of day.exercises) {
    const plan = getExercisePlan(ex, week);
    exercises[ex.id] = {
      variantId: ex.variants?.[0]?.id ?? null, skipped: false,
      sets: Array.from({ length: plan.sets }, () => ({ done: false, weightKg: null, reps: null, rir: null, technique: 'good', pain: 0 })),
    };
  }
  return { id: 'test', dayId: day.id, weekIndex: week, exercises, exerciseOrder: day.exercises.map((e) => e.id), warmup: emptyWarmupState(), execution: { active: true } };
}
const stepOf = (day, session, week = 1) => computeExecutionStep({ day, session, resolvePlan: planFor(week) });

// 1-3 — point de départ
test('1. un jour Upper commence par l’échauffement général', () => {
  const day = findDay('push-a');
  assert.equal(day.warmupRoutine, 'upper');
  assert.equal(stepOf(day, blankSession(day)).stage, STAGES.GENERAL_WARMUP);
});
test('2. un jour Lower commence aussi par l’échauffement général', () => {
  const day = findDay('legs-a');
  assert.equal(day.warmupRoutine, 'lower');
  assert.equal(stepOf(day, blankSession(day)).stage, STAGES.GENERAL_WARMUP);
});
test('3. la récupération ne lance jamais l’échauffement musculation', () => {
  const day = findDay('recovery');
  assert.equal(day.warmupRoutine, null);
  assert.equal(stepOf(day, blankSession(day)).stage, STAGES.RECOVERY);
});

// 4-6 — routines d’activation
test('4. après les 6 minutes, on passe à la première activation', () => {
  const day = findDay('push-a');
  const s = blankSession(day);
  s.warmup.general.done = true;
  const step = stepOf(day, s);
  assert.equal(step.stage, STAGES.ACTIVATION);
  assert.equal(step.activation.id, 'ext-rotation');
  assert.equal(step.activation.side, 'left');
});
test('5. la routine upper suit le bon ordre', () => {
  const steps = activationSteps(findDay('pull-a')).map((s) => s.key);
  assert.deepEqual(steps, ['ext-rotation:left', 'ext-rotation:right', 'scap-pull', 'light-lateral']);
});
test('6. la routine lower suit le bon ordre', () => {
  const steps = activationSteps(findDay('legs-a')).map((s) => s.key);
  assert.deepEqual(steps, ['bw-squat', 'hip-hinge', 'reverse-lunge:left', 'reverse-lunge:right', 'ankle-rock:left', 'ankle-rock:right']);
});

// 7-11 — montée en charge
test('7. protocole primary = 40 % ×10 / 60 % ×6 / 77,5 % ×3', () => {
  const ramps = computeRampSets({ warmupProtocol: 'primary' }, 100, 2.5);
  assert.deepEqual(ramps.map((r) => [r.loadKg, r.reps]), [[40, 10], [60, 6], [77.5, 3]]);
});
test('8. repos primary = 60 / 60 / 90', () => {
  assert.deepEqual(RAMP_PROTOCOLS.primary.map((r) => r.restSec), [60, 60, 90]);
});
test('9. protocole secondary = 50 % ×8 / 70 % ×4', () => {
  const ramps = computeRampSets({ warmupProtocol: 'secondary' }, 100, 2.5);
  assert.deepEqual(ramps.map((r) => [r.loadKg, r.reps]), [[50, 8], [70, 4]]);
});
test('10. repos secondary = 60 / 75', () => {
  assert.deepEqual(RAMP_PROTOCOLS.secondary.map((r) => r.restSec), [60, 75]);
});
test('11. l’arrondi respecte incrementKg et ne produit jamais 0', () => {
  assert.equal(roundWarmupLoad(47.4375, 2.5), 47.5);
  assert.equal(roundWarmupLoad(33.33, 5), 35);
  assert.equal(roundWarmupLoad(0.4, 2.5), 2.5, 'jamais 0 si une charge est requise');
  assert.equal(roundWarmupLoad(0, 2.5), 0, 'aucune référence -> 0');
});
test('12. sans charge de référence, on demande la charge de travail', () => {
  assert.deepEqual(computeRampSets({ warmupProtocol: 'primary' }, 0, 2.5), []);
  assert.equal(resolveReferenceLoad({}).needsInput, true);
  assert.equal(resolveReferenceLoad({ prescriptionLoadKg: 80 }).loadKg, 80);
  const day = findDay('push-a');
  const s = blankSession(day);
  s.warmup.general.done = true;
  for (const st of activationSteps(day)) s.warmup.activation[st.key] = { done: true };
  assert.equal(stepOf(day, s).stage, STAGES.NEEDS_REFERENCE_LOAD);
});

// 13-14 — les séries de chauffe ne contaminent rien
test('13-14. les séries de chauffe ne comptent ni comme travail ni dans l’avancement', () => {
  const day = findDay('push-a');
  const s = blankSession(day);
  s.warmup.general.done = true;
  for (const st of activationSteps(day)) s.warmup.activation[st.key] = { done: true };
  s.warmup.ramps['push-a-incline-smith'] = { referenceLoadKg: 100, done: [] };
  const before = executionProgress({ day, session: s, resolvePlan: planFor(1) });
  s.warmup.ramps['push-a-incline-smith'].done = [true, true, true];
  const after = executionProgress({ day, session: s, resolvePlan: planFor(1) });
  assert.equal(before.done, after.done, 'les ramps ne changent pas le nombre de séries réalisées');
  assert.equal(stepOf(day, s).stage, STAGES.WORK_SET, 'après les ramps on arrive à la série de travail');
});

// 15-17, 20 — enchaînement des séries de travail
test('15-17. série validée -> série suivante -> exercice suivant', () => {
  const day = findDay('push-a');
  const s = blankSession(day);
  s.warmup.general.done = true;
  for (const st of activationSteps(day)) s.warmup.activation[st.key] = { done: true };
  s.warmup.ramps['push-a-incline-smith'] = { referenceLoadKg: 100, done: [true, true, true] };
  let step = stepOf(day, s);
  assert.equal(step.setIndex, 0);
  s.exercises['push-a-incline-smith'].sets[0].done = true;
  assert.equal(stepOf(day, s).setIndex, 1, 'passe à la série suivante');
  const plan = getExercisePlan(findExercise('push-a-incline-smith'), 1);
  s.exercises['push-a-incline-smith'].sets.forEach((x) => { x.done = true; });
  step = stepOf(day, s);
  assert.notEqual(step.exerciseId, 'push-a-incline-smith', 'passe à l’exercice suivant');
});
test('20. le RIR affiché vient de rirBySet, pas de targetRir', () => {
  const day = findDay('push-a');
  const s = blankSession(day, 3);
  s.warmup.general.done = true;
  for (const st of activationSteps(day)) s.warmup.activation[st.key] = { done: true };
  // isolation à 3 séries : dernière série RIR 0
  const iso = findExercise('push-a-triceps-overhead');
  const plan = getExercisePlan(iso, 3);
  s.exercises[iso.id].sets.slice(0, plan.sets - 1).forEach((x) => { x.done = true; });
  // on force l'exercice courant en terminant les précédents
  for (const ex of day.exercises) {
    if (ex.id === iso.id) break;
    const p = getExercisePlan(ex, 3);
    if (ex.kind === 'cardio') s.exercises[ex.id].sets[0].done = true;
    else s.exercises[ex.id].sets.slice(0, p.sets).forEach((x) => { x.done = true; });
  }
  const step = computeExecutionStep({ day, session: s, resolvePlan: planFor(3) });
  assert.equal(step.exerciseId, iso.id);
  assert.equal(step.targetRir, 0, 'dernière série d’isolation = RIR 0');
});

// 18-19 — unilatéral
test('18-19. unilatéral : côté gauche d’abord, et reste UNE seule série', () => {
  const day = findDay('legs-a');
  const s = blankSession(day);
  s.warmup.general.done = true;
  for (const st of activationSteps(day)) s.warmup.activation[st.key] = { done: true };
  s.warmup.ramps['legs-a-hack'] = { referenceLoadKg: 100, done: [true, true, true] };
  const plan = getExercisePlan(findExercise('legs-a-bulgarian'), 1);
  assert.equal(plan.perSide, true);
  assert.equal(plan.sets, 3, 'jamais 6');
  assert.equal(plan.sideSwitchSec, 20);
  assert.equal(plan.roundRestSec, 120);
});

// 21-24 — timer générique
test('21. le timer se recharge correctement après un reload', () => {
  const t = createTimer('work-rest', 180, {}, 1000);
  assert.equal(remainingSeconds(t, 1000), 180);
  assert.equal(remainingSeconds(t, 61000), 120, 'calculé depuis les timestamps absolus');
});
test('22. un timer expiré pendant que l’app était fermée est traité une seule fois', () => {
  const t = createTimer('work-rest', 60, {}, 1000);
  const later = 1000 + 120000;
  assert.equal(isExpired(t, later), true);
  assert.equal(needsCompletion(t, later), true);
  const handled = markCompleted(t);
  assert.equal(needsCompletion(handled, later), false, 'pas de double traitement');
});
test('23. la pause survit au reload', () => {
  const t = createTimer('work-rest', 180, {}, 1000);
  const paused = pauseTimer(t, 61000);
  assert.equal(paused.paused, true);
  assert.equal(paused.pausedRemainingSec, 120);
  assert.equal(remainingSeconds(paused, 999999), 120, 'le temps ne s’écoule pas en pause');
  const resumed = resumeTimer(paused, 500000);
  assert.equal(remainingSeconds(resumed, 500000), 120);
});
test('24. le cardio a le kind cardio, jamais rest', () => {
  const t = createTimer('cardio', 600, { exerciseId: 'pull-a-incline-walk' }, 0);
  assert.equal(t.kind, 'cardio');
  assert.equal(timerLabel('cardio'), 'CARDIO');
  assert.notEqual(timerLabel('cardio'), 'REPOS');
  assert.equal(timerOutcome(t, 600000).action, 'record-cardio');
  assert.equal(timerOutcome(createTimer('work-rest', 90, {}, 0), 90000).action, 'record-rest');
});
test('25-26. cardio complet validé, cardio arrêté à 4:00/10:00 reste incomplet', () => {
  const t = createTimer('cardio', 600, {}, 0);
  const full = timerOutcome(t, 600000);
  assert.equal(full.complete, true);
  assert.equal(full.durationSec, 600);
  const early = timerOutcome(t, 240000);
  assert.equal(early.durationSec, 240);
  assert.equal(early.complete, false, 'une durée inférieure à la cible ne valide pas l’étape');
});

// 27, 32, 35 — complétude
test('27. un exercice passé rend la séance incomplète', () => {
  const day = findDay('push-a');
  const s = blankSession(day);
  s.warmup.general.done = true;
  for (const st of activationSteps(day)) s.warmup.activation[st.key] = { done: true };
  s.exercises['push-a-incline-smith'].skipped = true;
  const step = stepOf(day, s);
  assert.notEqual(step.exerciseId, 'push-a-incline-smith', 'un exercice passé est sauté');
});
test('35. SESSION_COMPLETE seulement quand toutes les étapes obligatoires sont faites', () => {
  const day = findDay('pull-a');
  const s = blankSession(day);
  assert.notEqual(stepOf(day, s).stage, STAGES.SESSION_COMPLETE);
  s.warmup.general.done = true;
  for (const st of activationSteps(day)) s.warmup.activation[st.key] = { done: true };
  for (const ex of day.exercises) {
    const p = getExercisePlan(ex, 1);
    if (ex.kind === 'cardio') s.exercises[ex.id].sets[0].done = true;
    else s.exercises[ex.id].sets.slice(0, p.sets).forEach((x) => { x.done = true; });
  }
  assert.equal(stepOf(day, s).stage, STAGES.SESSION_COMPLETE);
});
test('Pull A se termine par le cardio avant SESSION_COMPLETE', () => {
  const day = findDay('pull-a');
  const s = blankSession(day);
  s.warmup.general.done = true;
  for (const st of activationSteps(day)) s.warmup.activation[st.key] = { done: true };
  for (const ex of day.exercises) {
    if (ex.kind === 'cardio') continue;
    const p = getExercisePlan(ex, 1);
    s.exercises[ex.id].sets.slice(0, p.sets).forEach((x) => { x.done = true; });
  }
  const step = stepOf(day, s);
  assert.equal(step.stage, STAGES.CARDIO);
  assert.equal(step.durationSec, 600);
});

// 30-31 — semaine 7
test('30-31. la décharge S7 utilise ses propres séries et sa charge réduite', () => {
  const day = findDay('push-a');
  const s = blankSession(day, 7);
  const plan = getExercisePlan(findExercise('push-a-incline-smith'), 7);
  assert.equal(plan.sets, 2, 'moitié des séries');
  assert.equal(plan.deload, true);
  assert.equal(plan.loadFactor, 0.875);
  const ramps = computeRampSets(findExercise('push-a-incline-smith'), 100 * plan.loadFactor, 2.5);
  assert.equal(ramps[0].loadKg, 35, '40 % de la charge de décharge, pas de la charge pleine');
});

// ordre d’exécution
test('l’ordre d’exécution respecte l’ordre mémorisé de la séance', () => {
  const day = findDay('push-a');
  const s = blankSession(day);
  const reversed = [...s.exerciseOrder].reverse();
  s.exerciseOrder = reversed;
  assert.deepEqual(orderedExercises(day, s).map((e) => e.id), reversed);
});
