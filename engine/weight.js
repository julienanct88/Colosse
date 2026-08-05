import { addDays, clamp, daysBetween, isoDate, linearRegression, mean, parseLocalDate, round, roundTo50, startOfWeek, } from './math.js';
function sortedWeightLogs(logs) {
    return logs
        .filter((log) => Number.isFinite(log.weightKg) && Number(log.weightKg) > 0)
        .map((log) => ({ ...log, parsedDate: parseLocalDate(log.date) }))
        .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());
}
export function movingAverageWeight(logs, endDate, windowDays = 7) {
    const end = parseLocalDate(endDate);
    const start = addDays(end, -(windowDays - 1));
    const rows = sortedWeightLogs(logs).filter((log) => log.parsedDate >= start && log.parsedDate <= end);
    return rows.length ? mean(rows.map((row) => Number(row.weightKg))) : 0;
}
export function targetWeight(profile, date) {
    const elapsedDays = Math.max(0, daysBetween(profile.startDate, date));
    const weeks = elapsedDays / 7;
    const weeklyMultiplier = 1 - clamp(profile.weeklyLossRatePct, 0, 0.015);
    return profile.startWeightKg * weeklyMultiplier ** weeks;
}
export function weeklyTargets(profile, count = 24, fromWeek = 1) {
    const firstMonday = startOfWeek(profile.startDate);
    const targets = [];
    for (let i = fromWeek; i < fromWeek + count; i += 1) {
        const start = addDays(firstMonday, (i - 1) * 7);
        const end = addDays(start, 6);
        const target = targetWeight(profile, end);
        const targetLoss = target * profile.weeklyLossRatePct;
        const tolerance = Math.max(0.15, targetLoss * 0.40);
        targets.push({
            weekIndex: i,
            startDate: isoDate(start),
            endDate: isoDate(end),
            targetWeightKg: round(target, 2),
            toleranceLowKg: round(target - tolerance, 2),
            toleranceHighKg: round(target + tolerance, 2),
        });
    }
    return targets;
}
export function analyzeWeightTrend(logs, profile, adjustments, options = {}) {
    const now = parseLocalDate(options.date ?? new Date());
    const startWindow = addDays(now, -13);
    const rows = sortedWeightLogs(logs).filter((row) => row.parsedDate >= startWindow && row.parsedDate <= now);
    const points = rows.map((row) => ({ x: daysBetween(startWindow, row.parsedDate), y: Number(row.weightKg) }));
    const spanDays = rows.length > 1 ? daysBetween(rows[0].parsedDate, rows.at(-1).parsedDate) : 0;
    const regression = linearRegression(points);
    const observedChange = regression.slope * 7;
    const observedLoss = -observedChange;
    const currentAverage = movingAverageWeight(logs, now, 7);
    const currentForTarget = currentAverage || profile.startWeightKg;
    const targetLoss = currentForTarget * clamp(profile.weeklyLossRatePct, 0, 0.015);
    const adherenceValues = rows
        .map((row) => row.adherencePct)
        .filter((value) => Number.isFinite(value));
    const adherence = adherenceValues.length ? mean(adherenceValues) : null;
    const tolerance = Math.max(0.12, targetLoss * 0.35);
    const error = observedLoss - targetLoss;
    const sortedAdjustments = [...adjustments].sort((a, b) => a.date.localeCompare(b.date));
    const lastAdjustmentDate = sortedAdjustments.at(-1)?.date ?? '';
    const daysSinceAdjustment = lastAdjustmentDate ? daysBetween(lastAdjustmentDate, now) : 999;
    const enoughData = rows.length >= 10 && spanDays >= 9;
    let calorieDelta = 0;
    let status = 'COLLECT';
    let action = 'NONE';
    let reason = '';
    if (!enoughData) {
        reason = 'Il faut au moins 10 pesées couvrant 10 jours avant de modifier les calories.';
    }
    else if (daysSinceAdjustment < 12) {
        status = 'HOLD';
        reason = 'Le dernier ajustement est trop récent. Laisse au moins 12 jours de réponse.';
    }
    else if (adherence !== null && adherence < 85) {
        status = 'ADHERENCE';
        reason = 'Adhérence moyenne sous 85 % : corrige l’exécution avant de réduire les calories.';
    }
    else if (options.strengthAlert || options.recoveryAlert) {
        status = 'RECOVERY';
        if (observedLoss > targetLoss + tolerance) {
            calorieDelta = 150;
            action = 'CALORIES';
            reason = 'Perte trop rapide avec récupération ou force en baisse : remonte les calories.';
        }
        else {
            reason = 'Récupération ou performance en alerte : aucun déficit supplémentaire.';
        }
    }
    else if (Math.abs(error) <= tolerance) {
        status = 'ON_TRACK';
        reason = 'La tendance est dans la zone cible : aucune modification.';
    }
    else {
        calorieDelta = roundTo50(clamp(550 * error, -250, 250));
        if (calorieDelta === 0)
            calorieDelta = error < 0 ? -50 : 50;
        if (profile.currentCalories + calorieDelta < profile.minimumCalories) {
            calorieDelta = 0;
            status = 'ACTIVITY';
            action = 'STEPS';
            reason = 'Plancher calorique atteint : ajoute 1 000 à 1 500 pas par jour plutôt que de couper davantage.';
        }
        else if (profile.currentCalories + calorieDelta > profile.maximumCalories) {
            calorieDelta = 0;
            status = 'HOLD';
            reason = 'Plafond calorique atteint : vérifie les données et l’objectif.';
        }
        else {
            status = calorieDelta < 0 ? 'TOO_SLOW' : 'TOO_FAST';
            action = 'CALORIES';
            reason = calorieDelta < 0
                ? 'La perte est plus lente que la cible malgré une adhérence suffisante.'
                : 'La perte est trop rapide : protège la force et la masse maigre.';
        }
    }
    return {
        enoughData,
        samples: rows.length,
        spanDays,
        currentAverageKg: round(currentAverage, 2),
        targetKgToday: round(targetWeight(profile, now), 2),
        observedChangeKgPerWeek: round(observedChange, 3),
        observedLossKgPerWeek: round(observedLoss, 3),
        targetLossKgPerWeek: round(targetLoss, 3),
        errorKgPerWeek: round(error, 3),
        adherencePct: adherence === null ? null : round(adherence, 1),
        trendR2: round(regression.r2, 2),
        toleranceKg: round(tolerance, 3),
        calorieDelta,
        proposedCalories: profile.currentCalories + calorieDelta,
        status,
        action,
        reason,
        daysSinceAdjustment,
    };
}
export function macrosForCalories(calories, proteinG, fatG) {
    const kcal = Math.max(0, Math.round(calories));
    const protein = Math.max(0, Math.round(proteinG));
    const fat = Math.max(0, Math.round(fatG));
    const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
    return { calories: kcal, proteinG: protein, fatG: fat, carbsG: carbs };
}
//# sourceMappingURL=weight.js.map