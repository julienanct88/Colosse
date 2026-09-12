export function estimateExerciseDuration(exercise, plan) {
    const sets = Math.max(1, plan.sets);
    const rest = Math.max(30, plan.restSec);
    const execution = Math.max(20, exercise.executionSec);
    const transition = Math.max(20, exercise.transitionSec);
    const warmup = Math.max(0, plan.warmupSec);
    return warmup + sets * execution + Math.max(0, sets - 1) * rest + transition;
}
export function estimateSessionDuration(day, resolvePlan) {
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
    // Plage cible propre à la séance (section 2). Purement informatif :
    // aucun exercice n'est jamais retiré à cause du temps.
    const targetMin = day.targetMinMinutes ?? null;
    const targetMax = day.targetMaxMinutes ?? null;
    const minutes = Math.ceil(total / 60);
    return {
        seconds: Math.round(total),
        minutes,
        targetMinMinutes: targetMin,
        targetMaxMinutes: targetMax,
        targetLabel: targetMin && targetMax ? `${targetMin}\u2013${targetMax} min` : null,
        withinTarget: targetMin && targetMax ? minutes >= targetMin && minutes <= targetMax : true,
        overTarget: targetMax ? minutes > targetMax : false,
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
