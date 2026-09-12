import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countSessionSets, isSessionComplete, countCompletedStrengthSessions,
  weekdayOffset, targetRirForSet, isSetValid, countsForHistory,
  nextSideStep, sideStepDuration, finishStatus, formatSeconds,
} from '../engine/session.js';
import { TRAINING_DAYS, STRENGTH_DAYS, findDay, findExercise, getExercisePlan } from '../program.js';
import { activityProgress } from '../engine/activity.js';

const planOf = (week) => (ex) => getExercisePlan(ex, week);
const mkSet = (done = true) => ({ done, weightKg: 50, reps: 8, rir: 1, technique: 'good', pain: 0 });

/** Séance factice : 2 exercices (4 séries + 3 séries). */
function makeSession(doneInFirst, skipSecond) {
  const day = {
    id: 'x', name: 'X', kind: 'strength',
    exercises: [
      { id: 'a', category: 'upper_compound', sets: 4, repMin: 6, repMax: 8, restSec: 120, warmupSec: 0, variants: [] },
      { id: 'b', category: 'isolation', sets: 3, repMin: 10, repMax: 15, restSec: 60, warmupSec: 0, variants: [] },
    ],
  };
  const session = {
    exercises: {
      a: { skipped: false, sets: Array.from({ length: 4 }, (_, i) => mkSet(i < doneInFirst)) },
      b: { skipped: skipSecond, sets: Array.from({ length: 3 }, () => mkSet(false)) },
    },
  };
  const resolve = (ex) => ({ sets: ex.sets });
  return { day, session, resolve };
}

// 1 — skipped = 0 série réalisée
test('1. un exercice passé compte 0 série, pas ses séries prescrites', () => {
  const { day, session, resolve } = makeSession(3, true);
  const count = countSessionSets(session, day, resolve);
  assert.equal(count.done, 3, 'doit être 3, jamais 6');
  assert.equal(count.total, 7);
  assert.equal(count.skipped, 1);
});

// 2 — skipped empêche sessionComplete
test('2. un exercice passé empêche la séance d’être complète', () => {
  const { day, session, resolve } = makeSession(4, true);
  assert.equal(isSessionComplete(session, day, resolve), false);
  const { day: d2, session: s2, resolve: r2 } = makeSession(4, false);
  s2.exercises.b.sets.forEach((set) => { set.done = true; });
  assert.equal(isSessionComplete(s2, d2, r2), true);
});

// 3 — la récupération n'augmente jamais le compteur /6
test('3. six séances muscu + récupération terminées = 6, jamais 7', () => {
  const resolve = (ex) => ({ sets: ex.sets });
  const complete = (day) => ({
    exercises: Object.fromEntries(day.exercises.map((ex) => [ex.id, {
      skipped: false, sets: Array.from({ length: ex.sets }, () => mkSet(true)),
    }])),
  });
  const total = countCompletedStrengthSessions(TRAINING_DAYS, complete, resolve);
  assert.equal(total, 6);
  assert.ok(total <= STRENGTH_DAYS.length);
});

// 14 — plafond du compteur
test('14. le compteur musculation ne peut pas dépasser 6', () => {
  assert.equal(STRENGTH_DAYS.length, 6);
  assert.ok(!STRENGTH_DAYS.some((d) => d.kind === 'recovery'));
});

// 4 — dimanche = offset +6
test('4. dimanche vaut +6 dans une semaine qui commence lundi', () => {
  assert.equal(weekdayOffset(1), 0);
  assert.equal(weekdayOffset(6), 5);
  assert.equal(weekdayOffset(0), 6);
  assert.notEqual(weekdayOffset(0), -1);
});

test('4b. dates réelles de la semaine du lundi 7 septembre 2026', () => {
  const monday = new Date('2026-09-07T00:00:00');
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dateFor = (weekday) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + weekdayOffset(weekday));
    return iso(d);
  };
  assert.equal(dateFor(1), '2026-09-07');
  assert.equal(dateFor(6), '2026-09-12');
  assert.equal(dateFor(0), '2026-09-13', 'le dimanche suit le samedi, pas la semaine précédente');
});

// 5 — RIR isolation semaine 3 = [1,1,0]
test('5. isolation en semaine 3 : toutes les séries à RIR 1 sauf la dernière à 0', () => {
  // Exercice à 3 séries
  const iso3 = getExercisePlan(findExercise('push-a-triceps-overhead'), 3);
  assert.equal(iso3.sets, 3);
  assert.deepEqual(iso3.rirBySet, [1, 1, 0]);
  // Exercice à 4 séries : même règle, la dernière seulement
  const iso4 = getExercisePlan(findExercise('push-a-lateral'), 3);
  assert.equal(iso4.sets, 4);
  assert.deepEqual(iso4.rirBySet, [1, 1, 1, 0]);
  assert.equal(targetRirForSet(iso4, 3), 0);
  assert.equal(targetRirForSet(iso4, 0), 1);
});

// 6 — polyarticulaire jamais RIR 0
test('6. un polyarticulaire ne descend jamais à RIR 0', () => {
  for (const week of [1, 2, 3, 6, 7, 8, 11, 12]) {
    const plan = getExercisePlan(findExercise('legs-a-hack'), week);
    assert.ok(plan.rirBySet.every((r) => r >= 1), `semaine ${week}`);
  }
});

// 7 — metric seconds accepte 60, 600, 2700
test('7. une métrique en secondes accepte 60, 600 et 2700', () => {
  const plan = { metric: 'seconds', repMin: 45, repMax: 60 };
  const variant = { loadMode: 'bodyweight' };
  for (const value of [60, 600, 2700])
    assert.equal(isSetValid({ reps: value, weightKg: 0 }, plan, variant).valid, true, `${value}s`);
  assert.equal(isSetValid({ reps: 0, weightKg: 0 }, plan, variant).reason, 'duration_required');
});

test('7b. formatSeconds rend mm:ss, pas un nombre de répétitions', () => {
  assert.equal(formatSeconds(600), '10:00');
  assert.equal(formatSeconds(45), '0:45');
  assert.equal(formatSeconds(2700), '45:00');
});

// 9 / 10 — historique et validation selon loadMode
test('9. une série au poids du corps à charge 0 entre dans l’historique', () => {
  assert.equal(countsForHistory({ done: true, weightKg: 0, reps: 50 }, { loadMode: 'bodyweight' }), true);
});

test('10. une série external à charge 0 reste refusée', () => {
  assert.equal(isSetValid({ reps: 8, weightKg: 0 }, { metric: 'reps' }, { loadMode: 'external' }).reason, 'load_required');
  assert.equal(countsForHistory({ done: true, weightKg: 0, reps: 8 }, { loadMode: 'external' }), false);
  assert.equal(isSetValid({ reps: 8, weightKg: 60 }, { metric: 'reps' }, { loadMode: 'external' }).valid, true);
});

// 11 / 12 — unilatéral
test('11. unilatéral : gauche -> changement -> droite -> repos', () => {
  assert.equal(nextSideStep('left'), 'switch');
  assert.equal(nextSideStep('switch'), 'right');
  assert.equal(nextSideStep('right'), 'rest');
  assert.equal(nextSideStep('rest'), 'left');
  const plan = getExercisePlan(findExercise('pull-a-unilateral'), 3);
  assert.equal(sideStepDuration('switch', plan), 15);
  assert.equal(sideStepDuration('rest', plan), 90, 'le repos utilise roundRestSec');
});

test('12. une série unilatérale reste UNE seule série', () => {
  const plan = getExercisePlan(findExercise('pull-a-unilateral'), 3);
  assert.equal(plan.sets, 2);
  assert.equal(plan.perSide, true);
  const bulgarian = getExercisePlan(findExercise('legs-a-bulgarian'), 3);
  assert.equal(bulgarian.sets, 3);
  assert.equal(sideStepDuration('rest', bulgarian), 120);
});

// 13 — séance incomplète reste incomplète
test('13. une séance incomplète garde le statut INCOMPLETE après validation', () => {
  const { day, session, resolve } = makeSession(3, true);
  const outcome = finishStatus(countSessionSets(session, day, resolve));
  assert.equal(outcome.status, 'INCOMPLETE');
  assert.match(outcome.message, /INCOMPLÈTE — 3\/7/);
  const { day: d2, session: s2, resolve: r2 } = makeSession(4, false);
  s2.exercises.b.sets.forEach((set) => { set.done = true; });
  assert.equal(finishStatus(countSessionSets(s2, d2, r2)).status, 'COMPLETE');
});

// 15 — aucune escalade automatique du vélo
test('15. le vélo ne remplace plus les pas et n’escalade jamais', () => {
  const profile = { dailyStepTarget: 8000, stepsOnlyTarget: 12000, bikeMinutesTarget: 25 };
  const bikeOnly = activityProgress({ steps: 2000, bikeMinutes: 60 }, profile);
  assert.equal(bikeOnly.complete, false, '60 min de vélo ne valident pas 2 000 pas');
  const walked = activityProgress({ steps: 9000 }, profile);
  assert.equal(walked.complete, true);
  assert.equal(walked.inZone, true);
  assert.equal(walked.stepZoneMin, 8000);
  assert.equal(walked.stepZoneMax, 12000);
});

// carte cardio
test('16. le cardio du programme est une étape chronométrée sans charge ni RIR', () => {
  for (const id of ['pull-a', 'pull-b']) {
    const last = findDay(id).exercises.at(-1);
    assert.equal(last.kind, 'cardio');
    assert.equal(last.metric, 'seconds');
    assert.equal(last.durationSec, 600);
    assert.equal(formatSeconds(last.durationSec), '10:00');
  }
  const recovery = findDay('recovery');
  assert.equal(recovery.kind, 'recovery');
  assert.ok(recovery.exercises.every((e) => e.kind === 'cardio'));
});
