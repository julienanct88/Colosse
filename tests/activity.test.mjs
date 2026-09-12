import test from 'node:test';
import assert from 'node:assert/strict';
import { activityProgress, bikeModerateEquivalentMinutes } from '../engine/activity.js';

// Règle v3.4.1 (audit, point 9) : socle = zone de pas 8 000-12 000.
// Le vélo est une information, il ne remplace JAMAIS les pas automatiquement.
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
});

test('le vélo ne compense jamais les pas manquants', () => {
  const result = activityProgress({ steps: 5000, bikeMinutes: 25 }, profile);
  assert.equal(result.complete, false, '5 000 pas + 25 min de vélo ne valident plus le socle');
  const heavy = activityProgress({ steps: 2000, bikeMinutes: 90 }, profile);
  assert.equal(heavy.complete, false);
});

test('le vélo reste enregistré comme information', () => {
  const result = activityProgress({ steps: 9000, bikeMinutes: 30 }, profile);
  assert.equal(result.bikeMinutes, 30);
  assert.equal(result.bikeEquivalentMinutes, 30);
  assert.equal(result.complete, true, 'ce sont les pas qui valident, le vélo est un bonus');
});

test('l’équivalence d’intensité du vélo reste calculée', () => {
  assert.equal(bikeModerateEquivalentMinutes(30, 'vigorous'), 60);
  assert.equal(bikeModerateEquivalentMinutes(30, 'easy'), 18);
  assert.equal(bikeModerateEquivalentMinutes(30, 'moderate'), 30);
});
