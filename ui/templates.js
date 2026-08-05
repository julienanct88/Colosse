import { parseLocalDate, round } from '../engine/math.js';
export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
export function formatKg(value, decimals = 1) {
    if (!Number.isFinite(value))
        return '—';
    const rounded = round(Number(value), decimals);
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}
export function formatClock(seconds) {
    const safe = Math.max(0, Math.round(seconds || 0));
    const minutes = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${minutes}:${String(secs).padStart(2, '0')}`;
}
export function formatDateFr(value, options = { weekday: 'short', day: 'numeric', month: 'short' }) {
    try {
        return new Intl.DateTimeFormat('fr-FR', options).format(parseLocalDate(value));
    }
    catch {
        return value;
    }
}
export function pct(value, digits = 0) {
    return Number.isFinite(value) ? `${Number(value).toFixed(digits)} %` : '—';
}
export function decisionMeta(decision) {
    switch (decision) {
        case 'CALIBRATE': return { label: 'Calibration', icon: '🎯', className: 'decision-calibrate' };
        case 'INCREASE_FAST': return { label: 'Hausse accélérée', icon: '🚀', className: 'decision-up' };
        case 'INCREASE': return { label: 'Augmente', icon: '↗', className: 'decision-up' };
        case 'ADD_REP': return { label: 'Ajoute 1 rep', icon: '+1', className: 'decision-hold' };
        case 'DECREASE': return { label: 'Réduis', icon: '↘', className: 'decision-down' };
        case 'SWAP': return { label: 'Change de variante', icon: '⚠', className: 'decision-danger' };
        case 'DELOAD': return { label: 'Allège', icon: '🛡', className: 'decision-down' };
        case 'HOLD_TECHNIQUE': return { label: 'Technique d’abord', icon: '◎', className: 'decision-hold' };
        case 'HOLD_INCOMPLETE': return { label: 'Séance incomplète', icon: '…', className: 'decision-hold' };
        default: return { label: 'Maintiens', icon: '=', className: 'decision-hold' };
    }
}
export function sparklineSvg(logs, targetPoints) {
    const rows = logs
        .filter((log) => Number.isFinite(log.weightKg))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-28);
    const all = [
        ...rows.map((row) => ({ date: row.date, weight: Number(row.weightKg) })),
        ...targetPoints,
    ].sort((a, b) => a.date.localeCompare(b.date));
    if (all.length < 2) {
        return '<div class="empty-chart">Ajoute au moins deux pesées pour afficher la tendance.</div>';
    }
    const width = 680;
    const height = 220;
    const padX = 28;
    const padY = 20;
    const minDate = parseLocalDate(all[0].date).getTime();
    const maxDate = parseLocalDate(all.at(-1).date).getTime();
    const values = all.map((point) => point.weight);
    let minWeight = Math.min(...values);
    let maxWeight = Math.max(...values);
    if (maxWeight - minWeight < 1) {
        minWeight -= 0.5;
        maxWeight += 0.5;
    }
    else {
        minWeight -= 0.4;
        maxWeight += 0.4;
    }
    const x = (date) => padX + ((parseLocalDate(date).getTime() - minDate) / Math.max(1, maxDate - minDate)) * (width - 2 * padX);
    const y = (weight) => height - padY - ((weight - minWeight) / (maxWeight - minWeight)) * (height - 2 * padY);
    const actualPath = rows.map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(row.date).toFixed(1)} ${y(Number(row.weightKg)).toFixed(1)}`).join(' ');
    const targetPath = targetPoints.map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(row.date).toFixed(1)} ${y(row.weight).toFixed(1)}`).join(' ');
    const circles = rows.map((row) => `<circle cx="${x(row.date).toFixed(1)}" cy="${y(Number(row.weightKg)).toFixed(1)}" r="4" class="chart-dot"><title>${escapeHtml(formatDateFr(row.date))} · ${formatKg(row.weightKg, 2)} kg</title></circle>`).join('');
    const grid = [0, 0.5, 1].map((ratio) => {
        const yy = padY + ratio * (height - 2 * padY);
        const label = maxWeight - ratio * (maxWeight - minWeight);
        return `<line x1="${padX}" y1="${yy}" x2="${width - padX}" y2="${yy}" class="chart-grid"/><text x="4" y="${yy + 4}" class="chart-label">${formatKg(label, 1)}</text>`;
    }).join('');
    return `<svg class="weight-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Évolution du poids sur 28 jours">
    ${grid}
    ${targetPath ? `<path d="${targetPath}" class="chart-target"/>` : ''}
    ${actualPath ? `<path d="${actualPath}" class="chart-actual"/>` : ''}
    ${circles}
  </svg>`;
}
export function numberInputValue(value) {
    return Number.isFinite(value) ? String(value) : '';
}
//# sourceMappingURL=templates.js.map