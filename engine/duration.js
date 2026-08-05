export function estimateExerciseDuration(exercise, plan) {
    const sets = Math.max(1, plan.sets);
    const rest = Math.max(30, plan.restSec);
    const execution = Math.max(20, exercise.executionSec);
    const transition = Math.max(20, exercise.transitionSec);
    const warmup = Math.max(0, plan.warmupSec);
    return warmup + sets * execution + Math.max(0, sets - 1) * rest + transition;
}
export function estimateSessionDuration(day, resolvePlan, limitMinutes = 60) {
    const grouped = new Map();
    const singles = [];
    day.exercises.forEach((exercise) => {
        const item = { exercise, plan: resolvePlan(exercise) };
        if (exercise.superset) {
            if (!grouped.has(exercise.superset))
                grouped.set(exercise.superset, []);
            grouped.get(exercise.superset).push(item);
        }
        else {
            singles.push(item);
        }
    });
    let total = day.generalWarmupSec;
    singles.forEach(({ exercise, plan }) => {
        total += estimateExerciseDuration(exercise, plan);
    });
    grouped.forEach((items) => {
        const rounds = Math.max(...items.map(({ plan }) => plan.sets));
        const rest = Math.max(...items.map(({ plan }) => plan.restSec));
        const transition = Math.max(...items.map(({ exercise }) => exercise.transitionSec));
        const warmups = items.reduce((sum, { plan }) => sum + plan.warmupSec, 0);
        const execution = items.reduce((sum, { exercise, plan }) => sum + exercise.executionSec * plan.sets, 0);
        total += warmups + execution + Math.max(0, rounds - 1) * rest + transition;
    });
    total += day.occupiedBufferSec;
    const limitSeconds = Math.max(30, limitMinutes) * 60;
    return {
        seconds: Math.round(total),
        minutes: Math.ceil(total / 60),
        underLimit: total <= limitSeconds,
        limitSeconds,
        bufferSeconds: day.occupiedBufferSec,
    };
}
export function remainingSessionSeconds(day, resolvePlan, completedSetCounts) {
    const remainingDay = {
        ...day,
        generalWarmupSec: 0,
        occupiedBufferSec: 60,
        exercises: day.exercises
            .map((exercise) => {
            const plan = resolvePlan(exercise);
            const done = Math.min(plan.sets, completedSetCounts[exercise.id] ?? 0);
            if (done >= plan.sets)
                return null;
            return {
                ...exercise,
                sets: plan.sets - done,
                warmupSec: done > 0 ? 0 : exercise.warmupSec,
            };
        })
            .filter((exercise) => exercise !== null),
    };
    if (!remainingDay.exercises.length)
        return 0;
    return estimateSessionDuration(remainingDay, (exercise) => ({
        sets: exercise.sets,
        repMin: exercise.repMin,
        repMax: exercise.repMax,
        targetRir: exercise.targetRir,
        restSec: exercise.restSec,
        warmupSec: exercise.warmupSec,
    }), 120).seconds;
}
export function trimSuggestions(day, resolvePlan, completedSetCounts, availableSeconds) {
    const remaining = remainingSessionSeconds(day, resolvePlan, completedSetCounts);
    if (remaining <= availableSeconds) {
        return {
            overBySec: 0,
            savedSeconds: 0,
            skipExerciseIds: [],
            message: 'Tu restes dans le temps prévu.',
        };
    }
    const candidates = day.exercises
        .filter((exercise) => (completedSetCounts[exercise.id] ?? 0) === 0 && (exercise.optional || exercise.priority >= 3))
        .sort((a, b) => b.priority - a.priority);
    const skipExerciseIds = [];
    let savedSeconds = 0;
    for (const exercise of candidates) {
        if (remaining - savedSeconds <= availableSeconds)
            break;
        savedSeconds += estimateExerciseDuration(exercise, resolvePlan(exercise));
        skipExerciseIds.push(exercise.id);
    }
    const overBySec = Math.max(0, remaining - savedSeconds - availableSeconds);
    return {
        overBySec,
        savedSeconds,
        skipExerciseIds,
        message: skipExerciseIds.length
            ? 'Pour finir avant la limite, saute uniquement les exercices bonus indiqués.'
            : 'Aucun bonus supprimable : raccourcis les transitions, pas les repos lourds.',
    };
}
//# sourceMappingURL=duration.js.map