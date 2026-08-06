function positiveNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function bikeModerateEquivalentMinutes(minutes, intensity = 'moderate') {
    const duration = positiveNumber(minutes);
    const factor = intensity === 'vigorous' ? 2 : intensity === 'easy' ? 0.6 : 1;
    return duration * factor;
}

export function activityProgress(log = {}, profile = {}) {
    const steps = positiveNumber(log.steps);
    const bikeMinutes = positiveNumber(log.bikeMinutes);
    const stepFloor = positiveNumber(profile.dailyStepTarget, 5000);
    const stepsOnlyTarget = Math.max(stepFloor, positiveNumber(profile.stepsOnlyTarget, 10000));
    const bikeTarget = positiveNumber(profile.bikeMinutesTarget, 25);
    const bikeEquivalent = bikeModerateEquivalentMinutes(bikeMinutes, log.bikeIntensity);

    const walkingRoute = Math.min(1, steps / stepsOnlyTarget);
    const mixedRoute = Math.min(1, steps / stepFloor) * 0.4
        + Math.min(1, bikeEquivalent / bikeTarget) * 0.6;
    const progress = Math.min(1, Math.max(walkingRoute, mixedRoute));

    return {
        percent: Math.round(progress * 100),
        complete: progress >= 1,
        steps,
        bikeMinutes,
        bikeEquivalentMinutes: Math.round(bikeEquivalent),
        stepFloor,
        stepsOnlyTarget,
        bikeTarget,
    };
}

export function activityModeLabel(log = {}) {
    const hasSteps = positiveNumber(log.steps) > 0;
    const hasBike = positiveNumber(log.bikeMinutes) > 0;
    if (hasSteps && hasBike)
        return 'Mixte';
    if (hasBike)
        return 'Vélo';
    if (hasSteps)
        return 'Pas';
    return 'À saisir';
}

export function activitySummary(log = {}) {
    const parts = [];
    const steps = positiveNumber(log.steps);
    const bikeMinutes = positiveNumber(log.bikeMinutes);
    if (steps)
        parts.push(`${Math.round(steps).toLocaleString('fr-FR')} pas`);
    if (bikeMinutes)
        parts.push(`${Math.round(bikeMinutes)} min vélo`);
    return parts.length ? parts.join(' · ') : 'activité —';
}

export function activityGoalLabel(profile = {}) {
    const stepFloor = positiveNumber(profile.dailyStepTarget, 5000);
    const stepsOnlyTarget = Math.max(stepFloor, positiveNumber(profile.stepsOnlyTarget, 10000));
    const bikeTarget = positiveNumber(profile.bikeMinutesTarget, 25);
    return `${Math.round(stepsOnlyTarget).toLocaleString('fr-FR')} pas, ou ${Math.round(stepFloor).toLocaleString('fr-FR')} pas + ${Math.round(bikeTarget)} min de vélo modéré`;
}
