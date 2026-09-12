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
    const bikeEquivalent = bikeModerateEquivalentMinutes(bikeMinutes, log.bikeIntensity);
    // Zone recommandée 8 000-12 000 pas. Le vélo est une information,
    // il ne remplace jamais automatiquement les pas (audit, point 9).
    const zoneMin = positiveNumber(profile.dailyStepTarget, 8000);
    const zoneMax = Math.max(zoneMin, positiveNumber(profile.stepsOnlyTarget, 12000));
    const progress = Math.min(1, steps / zoneMin);
    return {
        percent: Math.round(progress * 100),
        complete: steps >= zoneMin,
        inZone: steps >= zoneMin && steps <= zoneMax,
        steps,
        bikeMinutes,
        bikeEquivalentMinutes: Math.round(bikeEquivalent),
        stepZoneMin: zoneMin,
        stepZoneMax: zoneMax,
        // conservés pour compatibilité d'affichage
        stepFloor: zoneMin,
        stepsOnlyTarget: zoneMax,
        bikeTarget: positiveNumber(profile.bikeMinutesTarget, 0),
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
    const zoneMin = positiveNumber(profile.dailyStepTarget, 8000);
    const zoneMax = Math.max(zoneMin, positiveNumber(profile.stepsOnlyTarget, 12000));
    return `${Math.round(zoneMin).toLocaleString('fr-FR')} \u00e0 ${Math.round(zoneMax).toLocaleString('fr-FR')} pas par jour`;
}

/**
 * Phrase affichée dans les réglages. Le vélo est une information : il ne
 * remplace jamais les pas (c'est déjà le comportement d'activityProgress).
 */
export function activityGoalHelp(profileInput) {
    const profile = profileInput ?? {};
    const zoneMin = positiveNumber(profile.dailyStepTarget, 8000);
    const zoneMax = Math.max(zoneMin, positiveNumber(profile.stepsOnlyTarget, 12000));
    const fr = (value) => Math.round(value).toLocaleString('fr-FR');
    return `Objectif quotidien : ${fr(zoneMin)} à ${fr(zoneMax)} pas. Le vélo est suivi séparément et ne remplace pas automatiquement les pas.`;
}
