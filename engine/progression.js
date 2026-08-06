import { clamp, mean, round, roundToIncrement } from './math.js';
export function normalizeSet(set) {
    return {
        weightKg: Number.isFinite(set.weightKg) ? Number(set.weightKg) : 0,
        reps: Number.isFinite(set.reps) ? Number(set.reps) : 0,
        rir: Number.isFinite(set.rir) ? clamp(Number(set.rir), 0, 6) : null,
        done: set.done === true,
        techniqueGood: set.technique !== 'degraded',
        techniqueKnown: set.technique === 'good' || set.technique === 'degraded',
        pain: Number.isFinite(set.pain) ? clamp(Number(set.pain), 0, 10) : 0,
        painKnown: Number.isFinite(set.pain),
        restActualSec: Number.isFinite(set.restActualSec) ? Number(set.restActualSec) : 0,
    };
}
export function estimateE1RM(weightKg, reps, rir) {
    const w = Number(weightKg);
    const r = clamp(Number(reps), 0, 30);
    const reserve = clamp(Number(rir), 0, 6);
    if (!(w > 0) || !(r > 0))
        return 0;
    return w * (1 + (r + reserve) / 30);
}
function validWorkSets(sets) {
    return sets.map(normalizeSet).filter((set) => set.done && set.weightKg > 0 && set.reps > 0);
}
function capacityFromSets(sets, fallbackRir) {
    const estimates = sets
        .filter((set) => set.techniqueGood && set.pain <= 3)
        .map((set) => estimateE1RM(set.weightKg, set.reps, set.rir ?? fallbackRir))
        .filter((value) => value > 0)
        .sort((a, b) => b - a);
    if (!estimates.length)
        return 0;
    return mean(estimates.slice(0, Math.min(2, estimates.length)));
}
export function summarizeSession(sets, plan) {
    const targetSets = Math.max(1, plan.sets);
    const repMin = Math.max(1, plan.repMin);
    const repMax = Math.max(repMin, plan.repMax);
    const targetRir = clamp(plan.targetRir, 0, 5);
    const completed = validWorkSets(sets).slice(0, targetSets);
    const valid = completed.filter((set) => set.techniqueGood && set.pain <= 3);
    const reps = valid.map((set) => set.reps);
    const rirs = valid.filter((set) => set.rir !== null).map((set) => Number(set.rir));
    const weights = valid.map((set) => set.weightKg);
    const first = valid[0] ?? null;
    const last = valid[valid.length - 1] ?? null;
    const sameLoad = weights.length > 1 && Math.max(...weights) - Math.min(...weights) < 0.001;
    const repDropPct = first && last && sameLoad && first.reps > 0 ? ((first.reps - last.reps) / first.reps) * 100 : 0;
    const totalReps = reps.reduce((sum, value) => sum + value, 0);
    const belowCount = valid.filter((set) => set.reps < repMin).length;
    const topCount = valid.filter((set) => set.reps >= repMax).length;
    const rirZeroCount = valid.filter((set) => set.rir !== null && Number(set.rir) <= 0).length;
    const badTechniqueCount = completed.filter((set) => set.techniqueKnown && !set.techniqueGood).length;
    const knownPain = completed.filter((set) => set.painKnown).map((set) => set.pain);
    const maxPain = knownPain.length ? Math.max(...knownPain) : 0;
    const averageRir = rirs.length ? mean(rirs) : null;
    const e1rm = capacityFromSets(valid, targetRir);
    const confidence = valid.length >= targetSets
        && rirs.length >= Math.min(2, targetSets)
        && valid.every((set) => set.techniqueKnown && set.painKnown)
        ? 'high'
        : valid.length >= 2
            ? 'medium'
            : valid.length === 1
                ? 'low'
                : 'none';
    return {
        targetSets,
        completedSets: completed.length,
        validSets: valid.length,
        completionRate: completed.length / targetSets,
        repMin,
        repMax,
        targetRir,
        totalReps,
        minTotalReps: targetSets * repMin,
        maxTotalReps: targetSets * repMax,
        belowCount,
        topCount,
        allInRange: valid.length >= targetSets && belowCount === 0,
        allAtTop: valid.length >= targetSets && topCount === targetSets,
        averageRir,
        rirZeroCount,
        badTechniqueCount,
        maxPain,
        repDropPct,
        e1rm,
        lastWeightKg: last?.weightKg ?? 0,
        firstWeightKg: first?.weightKg ?? 0,
        averageWeightKg: weights.length ? mean(weights) : 0,
        confidence,
    };
}
function categoryCaps(category) {
    switch (category) {
        case 'lower_compound': return { up: 0.075, down: 0.10 };
        case 'upper_compound': return { up: 0.05, down: 0.10 };
        case 'isolation': return { up: 0.10, down: 0.12 };
        default: return { up: 0.06, down: 0.10 };
    }
}
function capLoadChange(current, candidate, category, direction) {
    if (!(current > 0))
        return candidate;
    const caps = categoryCaps(category);
    return direction === 'down'
        ? Math.max(candidate, current * (1 - caps.down))
        : Math.min(candidate, current * (1 + caps.up));
}
export function suggestNextSet(set, plan, exercise, incrementKg) {
    const normalized = normalizeSet(set);
    const increment = Math.max(incrementKg, 0.25);
    if (!normalized.done || !(normalized.weightKg > 0) || !(normalized.reps > 0)) {
        return { action: 'WAIT', loadKg: 0, label: 'Termine la série de calibration.' };
    }
    if (!normalized.techniqueGood || normalized.pain >= 4) {
        return {
            action: 'STOP_OR_SWAP',
            loadKg: normalized.weightKg,
            label: normalized.pain >= 4
                ? 'Douleur significative : arrête et choisis une variante indolore.'
                : 'Technique dégradée : ne charge pas davantage.',
        };
    }
    const rir = normalized.rir ?? plan.targetRir;
    let raw = normalized.weightKg;
    let action = 'HOLD';
    let label = 'Charge bien calibrée : conserve-la.';
    if (normalized.reps < plan.repMin || rir <= Math.max(0, plan.targetRir - 2)) {
        raw = normalized.weightKg * (normalized.reps < plan.repMin - 1 || rir === 0 ? 0.925 : 0.95);
        raw = Math.min(raw, normalized.weightKg - increment);
        action = 'DECREASE';
        label = 'Trop lourd pour la cible : baisse dès la prochaine série.';
    }
    else if (normalized.reps >= plan.repMax && rir >= plan.targetRir + 2) {
        raw = Math.max(normalized.weightKg * 1.10, normalized.weightKg + increment);
        raw = capLoadChange(normalized.weightKg, raw, exercise.category, 'up');
        action = 'INCREASE_FAST';
        label = 'Charge nettement trop légère : hausse contrôlée.';
    }
    else if (normalized.reps >= plan.repMax && rir >= plan.targetRir + 1) {
        raw = normalized.weightKg + increment;
        action = 'INCREASE';
        label = 'Tu pouvais encore faire plus de répétitions que prévu : ajoute un incrément.';
    }
    return {
        action,
        loadKg: roundToIncrement(raw, increment, action === 'DECREASE' ? 'down' : 'nearest'),
        label,
        targetReps: `${plan.repMin}–${plan.repMax}`,
        targetRir: plan.targetRir,
    };
}
function buildModel(history, fallbackPlan) {
    let smoothed = 0;
    const sessions = [];
    history.forEach((item) => {
        const summary = summarizeSession(item.sets, item.plan ?? fallbackPlan);
        if (summary.e1rm > 0)
            smoothed = smoothed > 0 ? 0.70 * smoothed + 0.30 * summary.e1rm : summary.e1rm;
        sessions.push({ item, summary, smoothedE1RM: smoothed });
    });
    return { smoothedE1RM: smoothed, sessions, last: sessions.at(-1) ?? null };
}
function repeatedRegression(model) {
    if (model.sessions.length < 2)
        return false;
    const recent = model.sessions.slice(-2).map((item) => item.summary);
    return recent.every((summary) => summary.completedSets >= Math.ceil(summary.targetSets * 0.67)
        && (summary.belowCount >= 1 || summary.rirZeroCount >= 1 || summary.repDropPct >= 25));
}
export function prescriptionFromHistory(history, plan, exercise, incrementKg, recoveryAlert = false) {
    const model = buildModel(history, plan);
    if (!model.last || !(model.last.summary.lastWeightKg > 0)) {
        return {
            status: 'CALIBRATION',
            decision: 'CALIBRATE',
            loadKg: 0,
            repMin: plan.repMin,
            repMax: plan.repMax,
            targetRir: plan.targetRir,
            targetTotalReps: plan.sets * plan.repMin,
            reason: 'Choisis une charge prudente. La première série calibre immédiatement la suite.',
            confidence: 'none',
            smoothedE1RM: 0,
            sessionE1RM: 0,
            deltaKg: 0,
            previousLoadKg: 0,
            lastTotalReps: 0,
            averageRir: null,
            repDropPct: 0,
        };
    }
    const last = model.last.summary;
    const current = last.lastWeightKg || last.averageWeightKg;
    const increment = Math.max(incrementKg, 0.25);
    let decision = 'HOLD';
    let reason = '';
    let load = current;
    let targetTotal = Math.min(last.totalReps + 1, plan.sets * plan.repMax);
    if (last.maxPain >= 4) {
        decision = 'SWAP';
        reason = 'Douleur ≥ 4/10 : aucune progression. Passe à une variante indolore.';
    }
    else if (last.badTechniqueCount > 0) {
        decision = 'HOLD_TECHNIQUE';
        reason = 'Technique dégradée : charge maintenue jusqu’à exécution propre.';
    }
    else if (last.completedSets < Math.ceil(plan.sets * 0.67)) {
        decision = 'HOLD_INCOMPLETE';
        reason = 'Séance trop incomplète pour recalculer la charge avec confiance.';
    }
    else if (recoveryAlert && repeatedRegression(model)) {
        decision = 'DELOAD';
        load = roundToIncrement(Math.max(0, current * 0.90), increment, 'down');
        targetTotal = Math.max(2, Math.ceil(plan.sets * 0.60)) * plan.repMin;
        reason = 'Deux expositions en régression avec récupération basse : réduction temporaire de charge et de volume.';
    }
    else if (last.belowCount >= 2 || last.rirZeroCount >= 2 || (last.averageRir !== null && last.averageRir < plan.targetRir - 1.25)) {
        decision = 'DECREASE';
        let decreaseRaw = current * (last.belowCount >= 2 || last.rirZeroCount >= 2 ? 0.925 : 0.95);
        decreaseRaw = Math.min(decreaseRaw, current - increment);
        load = roundToIncrement(capLoadChange(current, decreaseRaw, exercise.category, 'down'), increment, 'down');
        targetTotal = plan.sets * plan.repMin;
        reason = 'Plusieurs signes montrent que la charge est trop lourde : baisse-la pour retrouver le nombre de répétitions encore possibles prévu.';
    }
    else if (last.allAtTop && (last.averageRir === null || last.averageRir >= plan.targetRir - 0.5)) {
        const easy = last.averageRir !== null && last.averageRir >= plan.targetRir + 1.5;
        const theoretical = model.smoothedE1RM > 0
            ? model.smoothedE1RM / (1 + (plan.repMin + plan.targetRir) / 30)
            : current + increment;
        const minimum = current + increment * (easy ? 2 : 1);
        let increaseRaw = Math.max(theoretical, minimum);
        increaseRaw = capLoadChange(current, increaseRaw, exercise.category, 'up');
        load = roundToIncrement(increaseRaw, increment, 'nearest');
        if (load <= current)
            load = roundToIncrement(current + increment, increment, 'nearest');
        decision = easy ? 'INCREASE_FAST' : 'INCREASE';
        targetTotal = plan.sets * plan.repMin;
        reason = easy
            ? 'Haut de fourchette validé en pouvant encore faire plusieurs répétitions : hausse accélérée mais plafonnée.'
            : 'Toutes les séries sont en haut de la fourchette avec le nombre de répétitions encore possibles prévu : augmente d’un incrément.';
    }
    else if (last.allInRange) {
        decision = 'ADD_REP';
        reason = 'Charge maîtrisée : conserve-la et ajoute une répétition totale.';
    }
    else {
        decision = 'HOLD';
        targetTotal = Math.max(plan.sets * plan.repMin, last.totalReps);
        reason = 'Signal insuffisant pour charger davantage : maintien et consolidation.';
    }
    return {
        status: 'READY',
        decision,
        loadKg: roundToIncrement(load, increment, 'nearest'),
        repMin: plan.repMin,
        repMax: plan.repMax,
        targetRir: plan.targetRir,
        targetTotalReps: targetTotal,
        reason,
        confidence: last.confidence,
        smoothedE1RM: round(model.smoothedE1RM, 1),
        sessionE1RM: round(last.e1rm, 1),
        deltaKg: round(load - current, 2),
        previousLoadKg: current,
        lastTotalReps: last.totalReps,
        averageRir: last.averageRir === null ? null : round(last.averageRir, 1),
        repDropPct: round(last.repDropPct, 1),
    };
}
export function nextPrescription(currentSets, history, plan, exercise, incrementKg, recoveryAlert = false) {
    return prescriptionFromHistory([...history, { date: '9999-12-31', weekIndex: 9999, sets: currentSets, plan, variantId: '' }], plan, exercise, incrementKg, recoveryAlert);
}
//# sourceMappingURL=progression.js.map
