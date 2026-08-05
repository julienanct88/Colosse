import { defaultDayForDate, findDay, getExercisePlan } from './program.js';
import { isoDate, uid, weekIndexFromStart } from './engine/math.js';
export const APP_VERSION = '3.0.1';
export const SCHEMA_VERSION = 3;
export function defaultProfile(today = new Date()) {
    return {
        name: '',
        age: 38,
        heightCm: 197,
        startWeightKg: 97,
        startDate: isoDate(today),
        weeklyLossRatePct: 0.004,
        currentCalories: 2900,
        proteinG: 200,
        fatG: 80,
        minimumCalories: 2400,
        maximumCalories: 3800,
        dailyStepTarget: 10000,
        sessionLimitMinutes: 60,
    };
}
export function defaultSettings(today = new Date()) {
    return {
        currentTab: 'training',
        selectedDayId: defaultDayForDate(today).id,
        soundEnabled: true,
        vibrationEnabled: true,
        autoStartTimer: true,
        lastSeenVersion: APP_VERSION,
    };
}
export function makeSet() {
    return {
        id: uid('set'),
        weightKg: null,
        reps: null,
        rir: null,
        done: false,
        technique: 'good',
        pain: 0,
        restActualSec: null,
        completedAt: null,
    };
}
export function makeExerciseLog(exerciseId, variantId, sets) {
    return {
        exerciseId,
        variantId,
        sets: Array.from({ length: sets }, () => makeSet()),
        skipped: false,
    };
}
export function makeSession(dayId, date, profile) {
    const day = findDay(dayId);
    const weekIndex = weekIndexFromStart(profile.startDate, date);
    const exercises = {};
    day.exercises.forEach((exercise) => {
        const plan = getExercisePlan(exercise, weekIndex);
        exercises[exercise.id] = makeExerciseLog(exercise.id, exercise.variants[0].id, plan.sets);
    });
    const now = Date.now();
    return {
        id: `${date}:${dayId}`,
        date,
        dayId,
        weekIndex,
        startedAt: null,
        endedAt: null,
        notes: '',
        readiness: { energy: 3, fatigue: 2, sleepHours: null },
        exercises,
        createdAt: now,
        updatedAt: now,
    };
}
export function emptyDailyLog(date = isoDate()) {
    return {
        date,
        weightKg: null,
        waistCm: null,
        calories: null,
        adherencePct: null,
        steps: null,
        sleepHours: null,
        fatigue: null,
        notes: '',
    };
}
export function defaultSnapshot(today = new Date()) {
    return {
        schemaVersion: SCHEMA_VERSION,
        profile: defaultProfile(today),
        settings: defaultSettings(today),
        sessions: [],
        dailyLogs: [],
        adjustments: [],
        legacyArchive: null,
    };
}
//# sourceMappingURL=defaults.js.map