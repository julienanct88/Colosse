import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TRAINING_DAYS, STRENGTH_DAYS, findDay, findExercise, defaultDayForDate,
  getExercisePlan, getTargetRir, isRecoveryDay, DELOAD_WEEK, DELOAD_LOAD_FACTOR,
} from '../program.js';
import { estimateSessionDuration } from '../engine/duration.js';
import * as durationModule from '../engine/duration.js';
import { prescriptionFromHistory, suggestNextSet } from '../engine/progression.js';
import { migrateProfileToV6 } from '../data/database.js';
import { SCHEMA_VERSION, APP_VERSION } from '../defaults.js';

const plan = (id, week) => getExercisePlan(findExercise(id), week);

// 1 — dimanche = récupération, jamais Pull A
test('dimanche renvoie la journée de récupération et jamais Pull A', () => {
  const sunday = new Date('2026-09-13T10:00:00');
  assert.equal(sunday.getDay(), 0);
  const day = defaultDayForDate(sunday);
  assert.equal(day.id, 'recovery');
  assert.notEqual(day.id, 'pull-a');
  assert.ok(isRecoveryDay(day));
});

test('la récupération ne compte pas dans les 6 séances de musculation', () => {
  assert.equal(STRENGTH_DAYS.length, 6);
  assert.ok(!STRENGTH_DAYS.some(isRecoveryDay));
});

// 2 — skipped != completed


// 3 — planche en secondes
test('le gainage est mesuré en secondes, 45-60, repos 60', () => {
  const p = plan('legs-b-plank', 1);
  assert.equal(p.metric, 'seconds');
  assert.equal(p.repMin, 45);
  assert.equal(p.repMax, 60);
  assert.equal(p.restSec, 60);
  assert.equal(p.sets, 3);
});

// 4 — poids du corps validable à charge 0
test('les exercices au poids du corps ont une variante bodyweight', () => {
  for (const id of ['legs-b-plank', 'legs-a-leg-raise']) {
    const ex = findExercise(id);
    assert.ok(ex.variants.some((v) => v.loadMode === 'bodyweight'), `${id} doit avoir une variante bodyweight`);
  }
});

test('la progression accepte une série au poids du corps sans charge', () => {
  const res = suggestNextSet(
    { done: true, weightKg: 0, reps: 50, rir: 2, technique: 'good', pain: 0 },
    { ...plan('legs-b-plank', 3), loadMode: 'bodyweight' },
    findExercise('legs-b-plank'), 1.25,
  );
  assert.notEqual(res.action, 'WAIT');
});

// 5 — unilatéraux
test('les exercices unilatéraux portent perSide, sideSwitchSec et roundRestSec', () => {
  const cases = { 'pull-a-unilateral': [15, 90], 'legs-a-bulgarian': [20, 120], 'push-b-lateral-uni': [15, 60] };
  for (const [id, [sw, rr]] of Object.entries(cases)) {
    const p = plan(id, 3);
    assert.equal(p.perSide, true, `${id} doit être perSide`);
    assert.equal(p.sideSwitchSec, sw);
    assert.equal(p.roundRestSec, rr);
  }
});

test('un exercice unilatéral ne double pas le nombre de séries', () => {
  assert.equal(plan('pull-a-unilateral', 3).sets, 2);
});

// 6 — chrono de repos
test('les repos prescrits sont conservés tels quels', () => {
  assert.equal(plan('pull-a-lat-pronation', 3).restSec, 180);
  assert.equal(plan('push-a-chest-press', 3).restSec, 120);
  assert.equal(plan('legs-a-cable-crunch', 3).restSec, 60);
});

// 7 — RIR différent sur la dernière série d'isolation
test('la dernière série d’isolation passe à RIR 0 en semaine 3', () => {
  const p = plan('push-a-lateral', 3);
  assert.deepEqual(p.rirBySet.slice(0, -1).every((r) => r === 1), true);
  assert.equal(p.rirBySet.at(-1), 0);
});

test('les gros mouvements ne descendent jamais à RIR 0', () => {
  for (const w of [1, 2, 3, 8, 12]) {
    const p = plan('legs-a-hack', w);
    assert.ok(p.rirBySet.every((r) => r >= 1), `semaine ${w} : pas d’échec sur hack squat`);
  }
});

test('semaines 1 et 2 : séries complètes, RIR dégressif, aucun échec', () => {
  assert.equal(plan('push-a-incline-smith', 1).sets, 4);
  assert.equal(getTargetRir(findExercise('push-a-incline-smith'), 1, 0, 4), 3);
  assert.equal(getTargetRir(findExercise('push-a-incline-smith'), 2, 0, 4), 2);
  assert.equal(getTargetRir(findExercise('push-a-lateral'), 1, 3, 4), 2);
});

// 8 — décharge semaine 7
test('semaine 7 : moitié des séries, RIR 4, charge à 87,5 %', () => {
  const p = plan('push-a-incline-smith', DELOAD_WEEK);
  assert.equal(p.sets, 2);
  assert.ok(p.rirBySet.every((r) => r === 4));
  assert.equal(p.deload, true);
  assert.equal(p.loadFactor, DELOAD_LOAD_FACTOR);

  const history = [{ date: '2026-09-01', weekIndex: 6, variantId: 'smith-incline',
    plan: plan('push-a-incline-smith', 6),
    sets: [{ done: true, weightKg: 100, reps: 8, rir: 1, technique: 'good', pain: 0 }] }];
  const pres = prescriptionFromHistory(history, p, findExercise('push-a-incline-smith'), 2.5);
  assert.equal(pres.decision, 'DELOAD');
  assert.ok(pres.loadKg <= 100 * 0.875, `charge ${pres.loadKg} doit être <= 87,5 kg`);
  assert.ok(pres.reason.includes('87,5'));
});

// 9 — aucun trim automatique
test('aucune suppression automatique d’exercice à 60 min', () => {
  // comportement : la fonction de trim n'existe plus dans l'API du moteur
  assert.equal(durationModule.trimSuggestions, undefined, 'trimSuggestions ne doit plus être exporté');
  // et une séance longue ne renvoie jamais d'exercice à supprimer
  const longest = findDay('legs-a');
  const est = estimateSessionDuration(longest, (ex) => getExercisePlan(ex, 3));
  assert.equal(est.skipExerciseIds, undefined);
  assert.equal(est.underLimit, undefined);
  for (const day of STRENGTH_DAYS)
    assert.ok(!day.exercises.some((e) => e.optional === true), `${day.name} ne doit avoir aucun exercice facultatif`);
});

test('la durée est une plage cible informative, pas une limite', () => {
  const expected = { 'pull-a': [80, 90], 'push-a': [85, 95], 'legs-a': [85, 95],
                     'pull-b': [80, 90], 'push-b': [80, 90], 'legs-b': [85, 95] };
  for (const [id, [lo, hi]] of Object.entries(expected)) {
    const day = findDay(id);
    assert.equal(day.targetMinMinutes, lo);
    assert.equal(day.targetMaxMinutes, hi);
    const est = estimateSessionDuration(day, (ex) => getExercisePlan(ex, 3));
    assert.equal(est.targetLabel, `${lo}–${hi} min`);
    assert.ok(!('underLimit' in est), 'plus de notion de limite');
  }
});

// 10 — migration schéma 5 -> 6 sans perte
test('migration v6 : applique les références sans écraser les valeurs personnalisées', () => {
  const untouched = migrateProfileToV6({ currentCalories: 2900, startWeightKg: 97,
    dailyStepTarget: 5000, stepsOnlyTarget: 10000, weeklyLossRatePct: 0.004, sessionLimitMinutes: 60 });
  assert.equal(untouched.currentCalories, 2700);
  assert.equal(untouched.startWeightKg, 96.2);
  assert.equal(untouched.dailyStepTarget, 8000);
  assert.equal(untouched.stepsOnlyTarget, 12000);
  assert.equal(untouched.weeklyLossRatePct, 0.005);
  assert.equal(untouched.programVersion, 'transformation-12s');

  const custom = migrateProfileToV6({ currentCalories: 3100, startWeightKg: 94.5, dailyStepTarget: 6500 });
  assert.equal(custom.currentCalories, 3100, 'valeur personnalisée préservée');
  assert.equal(custom.startWeightKg, 94.5);
  assert.equal(custom.dailyStepTarget, 6500);
});

test('la migration ne supprime aucune donnée existante', () => {
  assert.equal(SCHEMA_VERSION, 6);
  // comportement : la migration complète le profil sans rien supprimer
  const before = { currentCalories: 3100, sessions: 'intact' };
  const after = migrateProfileToV6({ ...before });
  assert.equal(after.currentCalories, 3100);
  assert.equal(after.sessions, 'intact');
});

// 11 — double progression
test('double progression : hausse seulement quand le haut de fourchette est validé', () => {
  const p = plan('push-a-incline-smith', 3);  // 4 x 6-8
  const ex = findExercise('push-a-incline-smith');
  const full = Array.from({ length: 4 }, () => ({ done: true, weightKg: 90, reps: 8, rir: 1, technique: 'good', pain: 0 }));
  const up = prescriptionFromHistory([{ date: '2026-09-01', weekIndex: 3, variantId: 'smith-incline', plan: p, sets: full }], p, ex, 2.5);
  assert.ok(up.loadKg >= 90, 'charge maintenue ou augmentée quand 8/8/8/8');

  const partial = [8, 8, 7, 6].map((r) => ({ done: true, weightKg: 90, reps: r, rir: 1, technique: 'good', pain: 0 }));
  const hold = prescriptionFromHistory([{ date: '2026-09-01', weekIndex: 3, variantId: 'smith-incline', plan: p, sets: partial }], p, ex, 2.5);
  assert.ok(hold.loadKg <= 90, 'pas de hausse tant que la fourchette haute n’est pas validée');
});

test('pas de hausse si technique dégradée ou douleur', () => {
  const p = plan('push-a-incline-smith', 3);
  const ex = findExercise('push-a-incline-smith');
  const bad = Array.from({ length: 4 }, () => ({ done: true, weightKg: 90, reps: 8, rir: 1, technique: 'degraded', pain: 5 }));
  const res = prescriptionFromHistory([{ date: '2026-09-01', weekIndex: 3, variantId: 'smith-incline', plan: p, sets: bad }], p, ex, 2.5);
  assert.ok(res.loadKg <= 90);
});

// 12 — service worker / version
test('la version applicative et le cache du service worker sont à jour', () => {
  assert.equal(APP_VERSION, '3.4.1');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('../asset-manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, '3.4.1');
  assert.ok(sw.includes(manifest.cacheVersion), 'sw.js et asset-manifest doivent partager la même version de cache');
  assert.ok(/colosse-adaptive-v3-[a-z-]+-341/.test(manifest.cacheVersion), `cacheVersion inattendu : ${manifest.cacheVersion}`);
});

// 4bis — cardio du programme
test('Pull A et Pull B se terminent par 10 min de marche inclinée', () => {
  for (const id of ['pull-a', 'pull-b']) {
    const last = findDay(id).exercises.at(-1);
    assert.equal(last.kind, 'cardio');
    assert.equal(last.durationSec, 600);
    assert.equal(last.inclinePct, '7–10');
    assert.equal(last.metric, 'seconds');
  }
});
