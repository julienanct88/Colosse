import test from 'node:test';
import assert from 'node:assert/strict';
import { activityProgress, bikeModerateEquivalentMinutes } from '../engine/activity.js';

// Règle 3.6.6 (demande du 06/10/2026) : la zone de pas reste 8 000-12 000 ; le VÉLO COMPTE dans la jauge, converti en
// pas équivalents (160 pas par minute de vélo modéré, l'équivalence historique « 12 000 pas OU 8 000 + 25 min »).
// Il ne déclenche aucune hausse automatique de vélo.
const profile = { dailyStepTarget: 8000, stepsOnlyTarget: 12000, bikeMinutesTarget: 25 };

test('la zone de pas recommandée est 8 000 à 12 000', () => {
  const result = activityProgress({ steps: 9000 }, profile);
  assert.equal(result.stepZoneMin, 8000);
  assert.equal(result.stepZoneMax, 12000);
  assert.equal(result.inZone, true);
  assert.equal(result.complete, true);
});

test('sous le socle, la journée n’est pas validée', () => {
  const result = activityProgress({ steps: 5000 }, profile);
  assert.equal(result.complete, false);
  assert.equal(result.inZone, false);
  assert.equal(result.percent, 63);
});

test('le vélo compte dans la jauge : 5 000 pas + 25 min de vélo modéré = 9 000 pas comptés', () => {
  const result = activityProgress({ steps: 5000, bikeMinutes: 25 }, profile);
  assert.equal(result.bikeSteps, 4000);
  assert.equal(result.totalSteps, 9000);
  assert.equal(result.complete, true);
  assert.equal(result.inZone, true);
  assert.equal(result.percent, 100);
  assert.equal(result.steps, 5000, 'les pas mesurés restent les pas mesurés');
});

test('le vélo seul fait avancer la jauge (aucun pas saisi)', () => {
  const result = activityProgress({ bikeMinutes: 25 }, profile);
  assert.equal(result.totalSteps, 4000);
  assert.equal(result.percent, 50);
  assert.equal(result.complete, false);
});

test('l’intensité du vélo pèse dans le total : facile 0,6 ×, soutenu 2 ×', () => {
  assert.equal(activityProgress({ bikeMinutes: 25, bikeIntensity: 'easy' }, profile).bikeSteps, 2400);
  assert.equal(activityProgress({ bikeMinutes: 25, bikeIntensity: 'moderate' }, profile).bikeSteps, 4000);
  assert.equal(activityProgress({ bikeMinutes: 25, bikeIntensity: 'vigorous' }, profile).bikeSteps, 8000);
});

test('l’équivalence est réglable dans le profil et ne tombe jamais à zéro par erreur', () => {
  assert.equal(activityProgress({ bikeMinutes: 10 }, { ...profile, bikeStepsPerMinute: 100 }).bikeSteps, 1000);
  assert.equal(activityProgress({ bikeMinutes: 10 }, profile).bikeSteps, 1600, 'défaut : 160 pas/min');
  assert.equal(activityProgress({ bikeMinutes: 10 }, { ...profile, bikeStepsPerMinute: 0 }).bikeSteps, 1600, 'valeur invalide : défaut');
});

test('le vélo ne retire rien et ne dépasse pas 100 % de la jauge', () => {
  const result = activityProgress({ steps: 9000, bikeMinutes: 90 }, profile);
  assert.equal(result.percent, 100);
  assert.equal(result.steps, 9000);
  assert.equal(result.inZone, false, 'au-dessus de la zone 8 000-12 000 : fait, mais hors zone');
  assert.equal(activityProgress({}, profile).percent, 0);
});

test('le vélo reste enregistré comme minutes de vélo', () => {
  const result = activityProgress({ steps: 9000, bikeMinutes: 30 }, profile);
  assert.equal(result.bikeMinutes, 30);
  assert.equal(result.bikeEquivalentMinutes, 30);
});

test('l’équivalence d’intensité du vélo reste calculée', () => {
  assert.equal(bikeModerateEquivalentMinutes(30, 'vigorous'), 60);
  assert.equal(bikeModerateEquivalentMinutes(30, 'easy'), 18);
  assert.equal(bikeModerateEquivalentMinutes(30, 'moderate'), 30);
});
