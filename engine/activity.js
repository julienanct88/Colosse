function positiveNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function bikeModerateEquivalentMinutes(minutes, intensity = 'moderate') {
    const duration = positiveNumber(minutes);
    const factor = intensity === 'vigorous' ? 2 : intensity === 'easy' ? 0.6 : 1;
    return duration * factor;
}

// Équivalence vélo → pas : celle que l'app a toujours utilisée (« 12 000 pas OU 8 000 pas + 25 min de vélo modéré » :
// 25 min = 4 000 pas, soit 160 pas par minute modérée). Modifiable dans Réglages.
export const BIKE_STEPS_PER_MINUTE = 160;
export const BIKE_STEPS_PER_MINUTE_RANGE = [40, 400];
export const BIKE_MAX_EQUIVALENT_MINUTES = 240;
/** Pas par minute de vélo modéré : valeur du profil bornée à 40-400 ; absente ou invalide → 160. */
export function bikeStepsPerMinute(profile = {}) {
    const value = positiveNumber(profile?.bikeStepsPerMinute, BIKE_STEPS_PER_MINUTE);
    return Math.min(BIKE_STEPS_PER_MINUTE_RANGE[1], Math.max(BIKE_STEPS_PER_MINUTE_RANGE[0], value));
}
export function activityProgress(log = {}, profile = {}) {
    const steps = positiveNumber(log.steps);
    const bikeMinutes = positiveNumber(log.bikeMinutes);
    // Plafond : 4 h de vélo modéré par jour au maximum (une faute de frappe — 250 au lieu de 25 — ne valide pas la journée).
    const bikeEquivalent = Math.min(BIKE_MAX_EQUIVALENT_MINUTES, bikeModerateEquivalentMinutes(bikeMinutes, log.bikeIntensity));
    // Zone recommandée 8 000-12 000 pas. Le vélo COMPTE dans la jauge (demande du 06/10/2026) : ses minutes modérées
    // sont converties en pas équivalents et s'ajoutent aux pas mesurés. Il ne déclenche aucune hausse automatique de vélo.
    const perMinute = bikeStepsPerMinute(profile);
    const bikeSteps = Math.round(bikeEquivalent * perMinute);
    const totalSteps = steps + bikeSteps;
    const zoneMin = positiveNumber(profile.dailyStepTarget, 8000);
    const zoneMax = Math.max(zoneMin, positiveNumber(profile.stepsOnlyTarget, 12000));
    const progress = Math.min(1, totalSteps / zoneMin);
    const complete = totalSteps >= zoneMin;
    return {
        // Jamais 100 % tant que l'objectif n'est pas atteint (7 960 / 8 000 s'arrondissait à 100).
        percent: complete ? 100 : Math.min(99, Math.round(progress * 100)),
        complete,
        inZone: totalSteps >= zoneMin && totalSteps <= zoneMax,
        steps,
        bikeSteps,
        totalSteps,
        stepsPerBikeMinute: perMinute,
        bikeMinutes,
        bikeEquivalentMinutes: Math.round(bikeEquivalent),
        bikeEquivalentExact: Math.round(bikeEquivalent * 10) / 10,
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

/** Phrase affichée dans les réglages : le vélo compte dans la jauge, avec son équivalence en pas. */
export function activityGoalHelp(profileInput) {
    const profile = profileInput ?? {};
    const zoneMin = positiveNumber(profile.dailyStepTarget, 8000);
    const zoneMax = Math.max(zoneMin, positiveNumber(profile.stepsOnlyTarget, 12000));
    const fr = (value) => Math.round(value).toLocaleString('fr-FR');
    return `Objectif quotidien : ${fr(zoneMin)} à ${fr(zoneMax)} pas. Le vélo compte dans la jauge : 1 min de vélo modéré = ${fr(bikeStepsPerMinute(profile))} pas.`;
}
