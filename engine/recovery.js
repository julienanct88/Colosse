import { findDay, getExercisePlan } from '../program.js';
import { mean } from './math.js';
import { summarizeSession } from './progression.js';
export function analyzeRecovery(logs) {
    const recent = [...logs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
    const sleepValues = recent.map((log) => log.sleepHours).filter((value) => Number.isFinite(value));
    const fatigueValues = recent.map((log) => log.fatigue).filter((value) => Number.isFinite(value));
    const averageSleepHours = sleepValues.length ? mean(sleepValues) : null;
    const averageFatigue = fatigueValues.length ? mean(fatigueValues) : null;
    const reasons = [];
    if (averageSleepHours !== null && averageSleepHours < 6.5)
        reasons.push('Sommeil moyen inférieur à 6 h 30.');
    if (averageFatigue !== null && averageFatigue >= 4)
        reasons.push('Fatigue moyenne élevée.');
    if (recent.filter((log) => Number(log.fatigue) >= 5).length >= 2)
        reasons.push('Au moins deux journées de fatigue maximale.');
    return { alert: reasons.length > 0, averageSleepHours, averageFatigue, reasons };
}
function primarySessionScore(session) {
    const day = findDay(session.dayId);
    const values = [];
    day.exercises.filter((exercise) => exercise.priority === 1).forEach((exercise) => {
        const log = session.exercises[exercise.id];
        if (!log)
            return;
        const plan = getExercisePlan(exercise, session.weekIndex);
        const summary = summarizeSession(log.sets, plan);
        if (summary.e1rm > 0)
            values.push(summary.e1rm);
    });
    return values.length ? mean(values) : 0;
}
export function analyzeStrengthTrend(sessions) {
    const completed = [...sessions]
        .filter((session) => Object.values(session.exercises).some((exercise) => exercise.sets.some((set) => set.done)))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-6)
        .map((session) => ({ session, score: primarySessionScore(session) }))
        .filter((item) => item.score > 0);
    if (completed.length < 4)
        return { alert: false, changePct: 0, reason: 'Historique de force insuffisant.' };
    const previous = mean(completed.slice(-4, -2).map((item) => item.score));
    const recent = mean(completed.slice(-2).map((item) => item.score));
    const changePct = previous > 0 ? ((recent - previous) / previous) * 100 : 0;
    return {
        alert: changePct <= -3,
        changePct,
        reason: changePct <= -3
            ? 'Les estimations de force des mouvements prioritaires ont baissé d’au moins 3 %.'
            : 'La force est stable ou en progression.',
    };
}
export function painAlert(sessions) {
    return [...sessions].slice(-4).some((session) => Object.values(session.exercises).some((exercise) => exercise.sets.some((set) => set.done && Number(set.pain) >= 4)));
}
//# sourceMappingURL=recovery.js.map