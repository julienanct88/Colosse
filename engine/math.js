export const DAY_MS = 24 * 60 * 60 * 1000;
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
export function round(value, decimals = 2) {
    const p = 10 ** decimals;
    return Math.round(value * p) / p;
}
export function roundToIncrement(value, increment, mode = 'nearest') {
    const inc = Math.max(increment, 0.01);
    const scaled = value / inc;
    const units = mode === 'down' ? Math.floor(scaled + 1e-9) : mode === 'up' ? Math.ceil(scaled - 1e-9) : Math.round(scaled);
    return round(Math.max(0, units * inc), 3);
}
export function roundTo50(value) {
    return Math.round(value / 50) * 50;
}
export function mean(values) {
    if (!values.length)
        return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
export function median(values) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function isoDate(value = new Date()) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime()))
        return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
export function parseLocalDate(value) {
    if (value instanceof Date)
        return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    const text = String(value ?? '');
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (match)
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const d = new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(value, days) {
    const d = parseLocalDate(value);
    d.setDate(d.getDate() + days);
    return d;
}
export function daysBetween(a, b) {
    return Math.round((parseLocalDate(b).getTime() - parseLocalDate(a).getTime()) / DAY_MS);
}
export function startOfWeek(value) {
    const d = parseLocalDate(value);
    const dow = d.getDay();
    const shift = dow === 0 ? -6 : 1 - dow;
    return addDays(d, shift);
}
export function weekIndexFromStart(startDate, date = new Date()) {
    const start = startOfWeek(startDate);
    const current = startOfWeek(date);
    return Math.max(1, Math.floor(daysBetween(start, current) / 7) + 1);
}
export function linearRegression(points) {
    if (points.length < 2)
        return { slope: 0, intercept: 0, r2: 0 };
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const xMean = mean(xs);
    const yMean = mean(ys);
    let numerator = 0;
    let denominator = 0;
    let totalVariance = 0;
    let residualVariance = 0;
    points.forEach((point) => {
        numerator += (point.x - xMean) * (point.y - yMean);
        denominator += (point.x - xMean) ** 2;
    });
    const slope = denominator === 0 ? 0 : numerator / denominator;
    const intercept = yMean - slope * xMean;
    points.forEach((point) => {
        const predicted = intercept + slope * point.x;
        totalVariance += (point.y - yMean) ** 2;
        residualVariance += (point.y - predicted) ** 2;
    });
    const r2 = totalVariance === 0 ? 1 : Math.max(0, 1 - residualVariance / totalVariance);
    return { slope, intercept, r2 };
}
export function uid(prefix = 'id') {
    const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${random}`;
}
//# sourceMappingURL=math.js.map