// Échauffement guidé + séries de montée en charge — fonctions PURES.
// Rien de ce qui est produit ici n'entre dans le volume de travail,
// l'e1RM, les records ou la double progression.

export const GENERAL_WARMUP = {
    id: 'general-warmup',
    name: 'Tapis incliné',
    durationSec: 360,          // 6:00
    speedKmh: '5,5–6',
    inclinePct: '5',
    cue: 'Tu dois être chaud, pas essoufflé.',
};

/** Routines d'activation, après le tapis. Jamais comptées comme travail. */
export const WARMUP_ROUTINES = {
    upper: [
        { id: 'ext-rotation', name: 'Rotation externe poulie', detail: '15 par bras', tempo: '2-1-2-1', perSide: true, restSec: 30 },
        { id: 'scap-pull', name: 'Tirage scapulaire léger', detail: '15 répétitions', tempo: '2-1-2-1', perSide: false, restSec: 30 },
        { id: 'light-lateral', name: 'Élévations latérales très légères', detail: '15 répétitions', tempo: null, perSide: false, restSec: 0 },
    ],
    lower: [
        { id: 'bw-squat', name: 'Squats poids du corps', detail: '10 répétitions', tempo: null, perSide: false, restSec: 0 },
        { id: 'hip-hinge', name: 'Hip hinges sans charge', detail: '10 répétitions', tempo: null, perSide: false, restSec: 0 },
        { id: 'reverse-lunge', name: 'Fentes arrière', detail: '10 par côté', tempo: null, perSide: true, restSec: 0 },
        { id: 'ankle-rock', name: 'Flexions/extensions cheville', detail: '15 par côté', tempo: null, perSide: true, restSec: 0 },
    ],
};

export function warmupRoutineFor(day) {
    const key = day?.warmupRoutine ?? null;
    return key ? (WARMUP_ROUTINES[key] ?? []) : [];
}

/** Étapes d'activation développées (un côté = une étape distincte à valider). */
export function activationSteps(day) {
    const steps = [];
    for (const item of warmupRoutineFor(day)) {
        if (item.perSide) {
            steps.push({ ...item, key: `${item.id}:left`, side: 'left', label: `${item.name} — côté gauche` });
            steps.push({ ...item, key: `${item.id}:right`, side: 'right', label: `${item.name} — côté droit` });
        }
        else {
            steps.push({ ...item, key: item.id, side: null, label: item.name });
        }
    }
    return steps;
}

/** Protocoles de montée en charge (section 7). Pourcentages déterministes. */
export const RAMP_PROTOCOLS = {
    primary: [
        { key: 'A', pct: 0.40, reps: 10, restSec: 60 },
        { key: 'B', pct: 0.60, reps: 6, restSec: 60 },
        { key: 'C', pct: 0.775, reps: 3, restSec: 90 }, // 75-80 % -> 77,5 % retenu
    ],
    secondary: [
        { key: 'A', pct: 0.50, reps: 8, restSec: 60 },
        { key: 'B', pct: 0.70, reps: 4, restSec: 75 },
    ],
};

export function getRampProtocol(exercise) {
    const protocol = exercise?.warmupProtocol ?? null;
    return protocol ? (RAMP_PROTOCOLS[protocol] ?? null) : null;
}

/**
 * Arrondit une charge d'échauffement au palier réel du matériel.
 * Déterministe. Jamais 47,4375 kg.
 */
export function roundWarmupLoad(loadKg, incrementKg) {
    const increment = Number(incrementKg) > 0 ? Number(incrementKg) : 1;
    const raw = Number(loadKg);
    if (!Number.isFinite(raw) || raw <= 0)
        return 0;
    const rounded = Math.round(raw / increment) * increment;
    // Si l'arrondi tombe à 0 alors qu'une charge est requise, garder le plus petit palier.
    const safe = rounded > 0 ? rounded : increment;
    return Math.round(safe * 100) / 100;
}

/**
 * Séries de montée en charge pour un exercice.
 * Renvoie [] si l'exercice n'a pas de protocole ou si la charge de référence est inconnue.
 */
export function computeRampSets(exercise, referenceLoadKg, incrementKg) {
    const protocol = getRampProtocol(exercise);
    if (!protocol)
        return [];
    const reference = Number(referenceLoadKg);
    if (!Number.isFinite(reference) || reference <= 0)
        return []; // jamais 40 % de zéro
    return protocol.map((step) => ({
        key: step.key,
        loadKg: roundWarmupLoad(reference * step.pct, incrementKg),
        reps: step.reps,
        restSec: step.restSec,
        pct: step.pct,
        isWarmup: true, // ne compte jamais comme série de travail
    }));
}

/** La charge de référence pour l'échauffement, par ordre de priorité. */
export function resolveReferenceLoad({ firstWorkSetLoadKg, prescriptionLoadKg, storedReferenceKg }) {
    for (const candidate of [firstWorkSetLoadKg, prescriptionLoadKg, storedReferenceKg]) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0)
            return { loadKg: value, needsInput: false };
    }
    return { loadKg: 0, needsInput: true };
}

/** État d'échauffement vierge, sérialisable et rétrocompatible. */
export function emptyWarmupState() {
    return { general: { done: false, skipped: false, durationSec: 0 }, activation: {}, ramps: {} };
}

export function normalizeWarmupState(state) {
    const base = emptyWarmupState();
    if (!state || typeof state !== 'object')
        return base;
    return {
        general: { ...base.general, ...(state.general ?? {}) },
        activation: { ...(state.activation ?? {}) },
        ramps: { ...(state.ramps ?? {}) },
    };
}

export function isGeneralWarmupDone(state) {
    const w = normalizeWarmupState(state);
    return !!(w.general.done || w.general.skipped);
}

export function isActivationComplete(state, day) {
    const w = normalizeWarmupState(state);
    const steps = activationSteps(day);
    if (steps.length === 0)
        return true;
    return steps.every((step) => !!w.activation[step.key]);
}

export function nextActivationStep(state, day) {
    const w = normalizeWarmupState(state);
    return activationSteps(day).find((step) => !w.activation[step.key]) ?? null;
}

export function isWarmupComplete(state, day) {
    return isGeneralWarmupDone(state) && isActivationComplete(state, day);
}

/** Index de la prochaine série de chauffe non réalisée pour un exercice. */
export function nextRampIndex(state, exerciseId, rampSets) {
    if (!rampSets || rampSets.length === 0)
        return -1;
    const done = normalizeWarmupState(state).ramps[exerciseId]?.done ?? [];
    for (let i = 0; i < rampSets.length; i += 1) {
        if (!done[i])
            return i;
    }
    return -1;
}
