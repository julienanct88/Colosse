import test from 'node:test';
import assert from 'node:assert/strict';
import { activityProgress, bikeModerateEquivalentMinutes } from '../engine/activity.js';

const profile = {
    dailyStepTarget: 5000,
    stepsOnlyTarget: 10000,
    bikeMinutesTarget: 25,
};

test('10 000 pas valident l’objectif sans vélo', () => {
    const result = activityProgress({ steps: 10000 }, profile);
    assert.equal(result.percent, 100);
    assert.equal(result.complete, true);
});

test('5 000 pas et 25 minutes de vélo modéré valident l’objectif', () => {
    const result = activityProgress({ steps: 5000, bikeMinutes: 25, bikeIntensity: 'moderate' }, profile);
    assert.equal(result.percent, 100);
    assert.equal(result.complete, true);
});

test('le vélo soutenu compte double en minutes modérées', () => {
    assert.equal(bikeModerateEquivalentMinutes(13, 'vigorous'), 26);
    const result = activityProgress({ steps: 5000, bikeMinutes: 13, bikeIntensity: 'vigorous' }, profile);
    assert.equal(result.complete, true);
});

test('le vélo seul ne masque pas une journée entièrement sédentaire', () => {
    const result = activityProgress({ steps: 0, bikeMinutes: 25, bikeIntensity: 'moderate' }, profile);
    assert.equal(result.percent, 60);
    assert.equal(result.complete, false);
});
