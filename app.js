import './pwa.js';
import { renderForgeHeader, renderForgeNav, renderForgeHome, renderForgeTools, normalizeSearch, steppedValue, icon, demoSearch, variantDisplay } from './ui/forge.js';
import { draftKey, readDraft, saveDraft, removeDraft, pruneStoredDrafts, removeSessionDrafts } from './ui/drafts.js';
import { APP_VERSION, defaultSnapshot, emptyDailyLog, makeExerciseLog, makeSession, makeSet, } from './defaults.js';
import { clearAllData, deleteSession, loadSnapshot, saveAdjustment, saveDailyLog, saveProfile, saveSession, saveSettings, saveSnapshot, storageMode, } from './data/database.js';
import { defaultDayForDate, findDay, findExercise, getExercisePlan, getTrainingPhase, TRAINING_DAYS, STRENGTH_DAYS } from './program.js';
import { nextPrescription, prescriptionFromHistory, suggestNextSet, summarizeSession, } from './engine/progression.js';
import { estimateSessionDuration, remainingSessionSeconds, } from './engine/duration.js';
import { aggregateSides, currentSide, bothSidesDone, countSessionSets, isSessionComplete as isSessionCompletePure, countCompletedStrengthSessions, weekdayOffset, targetRirForSet, isSetValid, countsForHistory, finishStatus, formatSeconds, closeSession, trainingWeekIndex, sessionWeekIndex, migrateProgramStart, hasValidatedWork, cancelSessionSummary, cancelSessionMessage, cancelSession, canCancelSession, seededSetIndices, legacySeededSetIndices, withoutSeedMark, resetExerciseLogForVariant, timedExerciseStatus, timedExerciseActions, timedStopRequest, } from './engine/session.js';
import { analyzeWeightTrend, macrosForCalories, targetWeight, weeklyTargets, } from './engine/weight.js';
import { analyzeRecovery, analyzeStrengthTrend, } from './engine/recovery.js';
import { activityGoalHelp, activityGoalLabel, activityModeLabel, activityProgress, activitySummary, } from './engine/activity.js';
import { addDays, isoDate, startOfWeek, uid, weekIndexFromStart, } from './engine/math.js';
import { computeExecutionStep, executionProgress, normalizeExecutionState, STAGES, canReorder, programOrder, normalizeOrder, pickSessionOrder, moveInOrder, deferExercise, isExercisePending, bringToFront, executionChangeDecision, halfDoneUnilateral, restAfterSetDecision, } from './engine/execution.js';
import { createTimer, elapsedSeconds, remainingSeconds as timerRemaining, isExpired as timerExpired, pauseTimer, resumeTimer, adjustTimer as adjustTimerState, timerLabel, timerControls, canShortenTimer, timerEndMessage, } from './engine/timer.js';
import { applyTimerOutcome, createTimerResolutionQueue, startTimerDecision, timerOwnerSession } from './engine/timer-effects.js';
import { computeRampSets, normalizeWarmupState, resolveReferenceLoad, clearExerciseRamps, rampsRequested, getRampProtocol, GENERAL_WARMUP, WARMUP_EQUIPMENT, resolveWarmupEquipment, activationSteps, } from './engine/warmup.js';
import { renderExecution, renderExecMenu, renderReorderPanel, renderExerciseSheet } from './ui/execution.js';
import { decisionMeta, escapeHtml, formatClock, formatDateFr, formatKg, numberInputValue, pct, sparklineSvg, } from './ui/templates.js';
const YOUTUBE_SEARCH = 'https://www.youtube.com/results?search_query=';
function parseNumber(value) {
    const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
}
function parseInteger(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
}
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
function sessionDurationSeconds(session) {
    if (!session.startedAt)
        return 0;
    return Math.max(0, Math.round(((session.endedAt ?? Date.now()) - session.startedAt) / 1000));
}
function sessionTonnage(session) {
    return Math.round(Object.values(session.exercises).reduce((total, exercise) => {
        return total + exercise.sets.reduce((sum, set) => {
            if (!set.done || !set.weightKg || !set.reps)
                return sum;
            return sum + set.weightKg * set.reps;
        }, 0);
    }, 0));
}
export class ColosseApp {
    root;
    snapshot = defaultSnapshot();
    viewWeekStart = startOfWeek(new Date());
    timer = null;
    /** Verrou de résolution : une seule à la fois, garantie « exactly once ». */
    timerQueue = createTimerResolutionQueue();
    tickHandle = null;
    saveDebounce = null;
    toastHandle = null;
    activeToast = null;
    execMenuOpen = false;
    reorderOpen = false;
    drag = null;
    wakeLock = null;
    installPrompt = null;
    timerCollapsed = false;
    updateAvailable = false;
    forgeDraft = null;
    /** Fiche consultée ({ type: 'exercise' | 'activation', id }) : lecture seule. */
    exerciseSheet = null;
    forgeDetails = new Map();
    constructor(root) {
        this.root = root;
    }
    async init() {
        this.root.innerHTML = '<div class="splash"><div class="splash-mark">C</div><strong>COLOSSE</strong><span>Préparation de ton programme…</span></div>';
        this.snapshot = await loadSnapshot();
        await this.migrateProgramStartIfNeeded();
        this.programViewOverride = false;
        this.viewWeekStart = startOfWeek(new Date());
        // Une séance en cours (mode exécution actif) a priorité sur le jour du
        // calendrier : après un reload, un verrouillage ou un kill de la PWA,
        // on revient exactement là où on s'était arrêté.
        // Une séance restée ouverte depuis un AUTRE jour ne reprend pas la main :
        // l'accueil propose de la terminer (séries gardées) ou de la reprendre.
        const running = this.snapshot.sessions.find((item) => item.execution?.active && !item.endedAt && !this.isStaleSession(item));
        const todayDayId = defaultDayForDate().id;
        const targetDayId = running?.dayId ?? todayDayId;
        if (this.snapshot.settings.selectedDayId !== targetDayId) {
            this.snapshot.settings.selectedDayId = targetDayId;
            await saveSettings(this.snapshot.settings);
        }
        if (running) {
            const runningDate = running.date;
            if (runningDate)
                this.viewWeekStart = startOfWeek(new Date(`${runningDate}T12:00:00`));
        }
        // Une séance active garde la priorité ; sinon un vrai accueil, sans changer le programme.
        this.snapshot.settings.currentTab = running ? 'training' : 'home';
        await this.ensureCurrentSession();
        await this.restoreTimerFromSession();
        pruneStoredDrafts(this.draftStorage(), new Set(this.snapshot.sessions.filter((item) => !item.endedAt).map((item) => item.id)));
        this.bindEvents();
        this.tickHandle = window.setInterval(() => this.tick(), 250);
        this.render();
    }
    /** Migration additive : début du programme distinct de la date de départ du profil. */
    async migrateProgramStartIfNeeded() {
        const result = migrateProgramStart(this.snapshot.profile, this.snapshot.sessions);
        if (!result.changed)
            return false;
        const avant = new Map(this.snapshot.sessions.map((item) => [item.id, JSON.stringify(item)]));
        const anciennesSemaines = new Map(this.snapshot.sessions.map((item) => [item.id, Number(item.weekIndex)]));
        this.snapshot.profile = result.profile;
        this.snapshot.sessions = result.sessions;
        // Séances pas encore faites dont la semaine change (ex. décharge → semaine normale) :
        // charges pré-remplies automatiquement recalculées, charges tapées à la main intactes.
        for (const session of this.snapshot.sessions) {
            const ancienne = anciennesSemaines.get(session.id);
            if (!session.endedAt && !hasValidatedWork(session) && Number.isFinite(ancienne) && ancienne !== session.weekIndex)
                this.reseedAfterWeekChange(session, ancienne);
        }
        await saveProfile(this.snapshot.profile);
        for (const session of this.snapshot.sessions)
            if (avant.get(session.id) !== JSON.stringify(session))
                await saveSession(session);
        return true;
    }
    /**
     * Plus aucun travail validé dans une séance jamais enregistrée : sa semaine n'a plus à rester figée
     * (sinon elle basculerait entre deux semaines au gré des validations). Charges pré-remplies recalculées.
     */
    unfreezeWeekIfNoWork(session) {
        if (!session || session.endedAt || session.status || session.reopenedAt || hasValidatedWork(session) || !('planWeekIndex' in session))
            return;
        const ancienne = Number(session.weekIndex);
        delete session.planWeekIndex;
        session.weekIndex = sessionWeekIndex(session, this.snapshot.profile);
        if (Number.isFinite(ancienne) && ancienne !== session.weekIndex)
            this.reseedAfterWeekChange(session, ancienne);
    }
    /** Recalcule les charges pré-remplies d'une séance non faite après un changement de semaine du programme. */
    reseedAfterWeekChange(session, oldWeek) {
        const day = findDay(session.dayId);
        if (!day || day.id !== session.dayId)
            return;
        this.syncSession(session, day, session.weekIndex);
        const recoveryAlert = analyzeRecovery(this.snapshot.dailyLogs).alert;
        for (const exercise of day.exercises) {
            if (exercise.kind === 'cardio')
                continue;
            const log = session.exercises?.[exercise.id];
            if (!log)
                continue;
            const oldPlan = getExercisePlan(exercise, oldWeek);
            const newPlan = getExercisePlan(exercise, session.weekIndex);
            if (oldPlan.deload === newPlan.deload && oldPlan.sets === newPlan.sets)
                continue;
            // Série « libre » = jamais utilisée : ni validée, ni côté fait, ni répétitions ou ressenti saisis.
            const libre = (set) => set && !set.done && !set.sides?.left?.done && !set.sides?.right?.done
                && (set.reps === null || set.reps === undefined) && (set.rir === null || set.rir === undefined);
            let indices = [];
            if (log.autoSeed && Array.isArray(log.autoSeed.sets)) {
                const mark = log.autoSeed;
                indices = log.sets.map((set, index) => ({ set, index }))
                    .filter(({ set, index }) => libre(set) && ((mark.sets.includes(index) && Number(set.weightKg) === Number(mark.loadKg)) || ((set.weightKg === null || set.weightKg === undefined) && index >= oldPlan.sets)))
                    .map(({ index }) => index);
            }
            else {
                const variant = exercise.variants.find((v) => v.id === log.variantId) ?? exercise.variants[0];
                const history = this.exerciseHistory(exercise.id, log.variantId, session.date, session.id);
                const ancienneCharge = prescriptionFromHistory(history, oldPlan, exercise, variant.incrementKg, recoveryAlert).loadKg;
                const poses = log.sets.filter((set) => libre(set) && set.weightKg !== null && set.weightKg !== undefined);
                if (log.sets.every(libre) && ancienneCharge > 0 && poses.length && poses.every((set) => Number(set.weightKg) === Number(ancienneCharge)))
                    indices = log.sets.map((set, index) => ({ set, index })).filter(({ set }) => set.weightKg === null || set.weightKg === undefined || Number(set.weightKg) === Number(ancienneCharge)).map(({ index }) => index);
            }
            if (indices.length)
                this.reseedFutureSets(session, day, exercise.id, indices);
        }
    }
    /** Séance commencée un autre jour, jamais terminée, sans activité depuis plus de 6 h. */
    isStaleSession(session, now = Date.now()) {
        if (!session?.startedAt || session.endedAt)
            return false;
        const last = Number(session.updatedAt || session.startedAt) || 0;
        return session.date < isoDate(new Date(now)) && now - last > 6 * 3600 * 1000;
    }
    staleSessions() {
        return this.snapshot.sessions.filter((item) => this.isStaleSession(item) && (item.execution?.active || this.activeSetCount(item, findDay(item.dayId)).done > 0));
    }
    /**
     * Termine UNE séance précise restée ouverte (jamais la séance affichée par erreur) :
     * effet de son chrono éventuel, puis clôture avec ses séries telles quelles.
     */
    async finishStaleSession(sessionId) {
        let session = this.snapshot.sessions.find((item) => item.id === sessionId);
        if (!session || !session.startedAt || session.endedAt)
            return;
        if (session.activeTimer) {
            const result = applyTimerOutcome(session, session.activeTimer, Date.now());
            if (this.timer?.context?.sessionId === session.id)
                this.timer = null;
            session = result.session;
        }
        const day = findDay(session.dayId);
        const weekIndex = sessionWeekIndex(session, this.snapshot.profile);
        const count = countSessionSets(session, day, (exercise) => getExercisePlan(exercise, weekIndex));
        const outcome = finishStatus(count);
        const closed = closeSession({ ...session, weekIndex, execution: this.execState(session) }, { now: Date.now(), status: outcome.status });
        this.replaceSession(closed);
        await saveSession(closed);
        removeSessionDrafts(this.draftStorage(), closed.id);
        if (!this.snapshot.sessions.some((item) => item.execution?.active && !item.endedAt))
            await this.releaseWakeLock();
        this.render();
        this.showToast(`${day.name} du ${formatDateFr(closed.date, { day: 'numeric', month: 'long' })} terminée : ${count.done} série${count.done > 1 ? 's' : ''} gardée${count.done > 1 ? 's' : ''}.`, 'success', 6000);
    }
    /** Affiche le jour et la semaine d'une séance donnée. */    /** Affiche le jour et la semaine d'une séance donnée. */
    focusSession(session) {
        this.snapshot.settings.selectedDayId = session.dayId;
        this.viewWeekStart = startOfWeek(new Date(`${session.date}T12:00:00`));
    }
    bindEvents() {
        this.root.addEventListener('click', (event) => void this.handleClick(event));
        this.root.addEventListener('change', (event) => void this.handleChange(event));
        this.root.addEventListener('input', (event) => void this.handleInput(event));
        this.root.addEventListener('keydown', (event) => {
            const sheet = this.root.querySelector('.sheet');
            if (!sheet) return;
            if (event.key === 'Escape') {
                this.execMenuOpen = false;
                this.reorderOpen = false;
                this.exerciseSheet = null;
                this.render();
                this.root.querySelector('[data-action="exec-menu"]')?.focus();
            }
            if (event.key === 'Tab') {
                const items = [...sheet.querySelectorAll('button:not(:disabled), input, select, textarea, [tabindex="0"]')];
                if (!items.length) return;
                const first = items[0], last = items.at(-1);
                if (event.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
            }
        });
        // Glisser-déposer : la poignée seule démarre le drag, donc un champ ou
        // un select ne le déclenche jamais et le scroll vertical reste normal.
        this.root.addEventListener('pointerdown', (event) => this.onDragStart(event));
        this.root.addEventListener('pointerdown', () => this.unlockAudio(), { passive: true });
        window.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault();
            this.installPrompt = event;
            this.render();
        });
        window.addEventListener('colosse-update', () => {
            this.updateAvailable = true;
            this.showToast('Une mise à jour de Colosse est disponible.', 'info', 6000);
            const banner = document.getElementById('update-banner');
            banner?.classList.remove('hidden');
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.currentContext().session.startedAt && !this.currentContext().session.endedAt) {
                void this.acquireWakeLock();
            }
            // Retour dans l'app : un chrono terminé pendant l'absence est signalé tout de suite.
            if (document.visibilityState === 'visible')
                this.tick();
        });
    }
    dayDate(day) {
        return isoDate(addDays(this.viewWeekStart, weekdayOffset(day.weekday)));
    }
    currentDay() {
        return findDay(this.snapshot.settings.selectedDayId);
    }
    currentContext() {
        const day = this.currentDay();
        const date = this.dayDate(day);
        let session = this.snapshot.sessions.find((item) => item.id === `${date}:${day.id}`);
        if (!session) {
            session = makeSession(day.id, date, this.snapshot.profile);
            this.snapshot.sessions.push(session);
        }
        // Semaine du PROGRAMME ; une séance terminée garde la sienne.
        const weekIndex = sessionWeekIndex(session, this.snapshot.profile);
        this.syncSession(session, day, weekIndex);
        return { day, date, weekIndex, session };
    }
    async ensureCurrentSession() {
        const context = this.currentContext();
        this.seedSessionPrescriptions(context.session, context.day, context.date, context.weekIndex);
        await saveSession(context.session);
    }
    syncSession(session, day, weekIndex) {
        session.weekIndex = weekIndex;
        session.exerciseOrder = pickSessionOrder({
            sessionOrder: Array.isArray(session.exerciseOrder) ? session.exerciseOrder : [],
            preferredOrder: this.snapshot?.settings?.dayOrders?.[day.id],
            orderCustomized: session.orderCustomized,
            day,
        });
        day.exercises.forEach((exercise) => {
            const plan = getExercisePlan(exercise, weekIndex);
            let log = session.exercises[exercise.id];
            if (!log) {
                log = makeExerciseLog(exercise.id, exercise.variants[0].id, plan.sets);
                session.exercises[exercise.id] = log;
            }
            if (!exercise.variants.some((variant) => variant.id === log.variantId))
                log.variantId = exercise.variants[0].id;
            while (log.sets.length < plan.sets)
                log.sets.push(makeSet());
            log.sets.forEach((set) => {
                if (set.technique !== 'good' && set.technique !== 'degraded' && set.technique !== null)
                    set.technique = null;
                if (set.pain !== null && !Number.isFinite(set.pain))
                    set.pain = null;
            });
        });
    }
    orderedExercises(day, session) {
        const byId = new Map(day.exercises.map((exercise) => [exercise.id, exercise]));
        return (session.exerciseOrder ?? [])
            .map((exerciseId) => byId.get(exerciseId))
            .filter(Boolean);
    }
    seedSessionPrescriptions(session, day, date, weekIndex) {
        const recoveryAlert = analyzeRecovery(this.snapshot.dailyLogs).alert;
        day.exercises.forEach((exercise) => {
            const log = session.exercises[exercise.id];
            const plan = getExercisePlan(exercise, weekIndex);
            if (!log || log.sets.some((set) => set.done || set.weightKg !== null || set.reps !== null))
                return;
            const variant = exercise.variants.find((item) => item.id === log.variantId) ?? exercise.variants[0];
            const history = this.exerciseHistory(exercise.id, log.variantId, date, session.id);
            const prescription = prescriptionFromHistory(history, plan, exercise, variant.incrementKg, recoveryAlert);
            if (prescription.loadKg > 0) {
                log.sets.slice(0, plan.sets).forEach((set) => { set.weightKg = prescription.loadKg; });
                // Marque additive : d'où vient ce pré-remplissage (permet de le refaire si une de ces séances est annulée).
                log.autoSeed = { loadKg: prescription.loadKg, sources: history.map((entry) => entry.sessionId).filter(Boolean), sets: log.sets.slice(0, plan.sets).map((_, index) => index) };
            }
        });
    }
    exerciseHistory(exerciseId, variantId, beforeDate, excludeSessionId = '') {
        return this.snapshot.sessions
            .filter((session) => session.id !== excludeSessionId && session.date < beforeDate)
            .sort((a, b) => a.date.localeCompare(b.date))
            .flatMap((session) => {
            const log = session.exercises[exerciseId];
            const exercise = findExercise(exerciseId);
            if (!log || !exercise || log.variantId !== variantId)
                return [];
            const variantDef = exercise.variants.find((item) => item.id === variantId) ?? exercise.variants[0];
            if (!log.sets.some((set) => countsForHistory(set, variantDef)))
                return [];
            return [{
                    sessionId: session.id,
                    date: session.date,
                    weekIndex: session.weekIndex,
                    sets: log.sets,
                    plan: getExercisePlan(exercise, session.weekIndex),
                    variantId,
                }];
        });
    }
    prescriptionFor(context, exercise, log) {
        const plan = getExercisePlan(exercise, context.weekIndex);
        const variant = exercise.variants.find((item) => item.id === log.variantId) ?? exercise.variants[0];
        const history = this.exerciseHistory(exercise.id, log.variantId, context.date, context.session.id);
        return prescriptionFromHistory(history, plan, exercise, variant.incrementKg, analyzeRecovery(this.snapshot.dailyLogs).alert);
    }
    activeSetCount(session, day) {
        return countSessionSets(session, day, (exercise) => getExercisePlan(exercise, session.weekIndex));
    }
    isSessionComplete(session, day) {
        return isSessionCompletePure(session, day, (exercise) => getExercisePlan(exercise, session.weekIndex));
    }
    completedWeekSessions() {
        return countCompletedStrengthSessions(STRENGTH_DAYS, (day) => {
            const date = this.dayDate(day);
            return this.snapshot.sessions.find((item) => item.id === `${date}:${day.id}`);
        }, (exercise, session) => getExercisePlan(exercise, session.weekIndex));
    }
    captureForgeForm() {
        const form = this.root.querySelector('[data-forge-step]');
        if (form) {
            this.forgeDraft = {
                key: form.dataset.forgeStep,
                fields: Object.fromEntries([...form.querySelectorAll('input[data-exec-field]')].map(el => [el.dataset.execField, el.value])),
                choices: Object.fromEntries([...form.querySelectorAll('.chip-choice.selected')].map(el => [el.dataset.execField, el.dataset.value])),
            };
        }
        this.root.querySelectorAll('details[data-forge-detail]').forEach(el => this.forgeDetails.set(el.dataset.forgeDetail, el.open));
    }
    draftStorage() {
        try {
            return window.localStorage;
        }
        catch {
            return null;
        }
    }
    /** Enregistre la saisie non validée de l'écran guidé (jamais comptée comme série). */
    persistForgeDraft() {
        this.captureForgeForm();
        const draft = this.forgeDraft;
        if (draft?.key)
            saveDraft(this.draftStorage(), draft.key, draft);
    }
    restoreForgeForm() {
        const form = this.root.querySelector('[data-forge-step]');
        // Brouillon de CET écran : d'abord celui en mémoire (dernier rendu), sinon
        // celui enregistré (autre écran, fiche consultée, rechargement de l'app).
        let draft = this.forgeDraft;
        if (form && draft?.key !== form.dataset.forgeStep) {
            const stored = readDraft(this.draftStorage(), form.dataset.forgeStep);
            draft = stored ? { key: form.dataset.forgeStep, fields: stored.fields ?? {}, choices: stored.choices ?? {} } : null;
        }
        if (form && draft?.key === form.dataset.forgeStep) {
            form.querySelectorAll('input[data-exec-field]').forEach(el => {
                if (Object.hasOwn(draft.fields, el.dataset.execField)) el.value = draft.fields[el.dataset.execField];
            });
            form.querySelectorAll('[data-exec-group]').forEach(group => {
                const chosen = draft.choices[group.dataset.execGroup];
                if (chosen === undefined) return;
                group.querySelectorAll('.chip-choice').forEach(el => {
                    const selected = el.dataset.value === chosen;
                    el.classList.toggle('selected', selected);
                    el.setAttribute('aria-pressed', String(selected));
                });
            });
        }
        this.root.querySelectorAll('details[data-forge-detail]').forEach(el => {
            if (this.forgeDetails.has(el.dataset.forgeDetail)) el.open = this.forgeDetails.get(el.dataset.forgeDetail);
        });
    }
    render() {
        this.captureForgeForm();
        const tab = this.snapshot.settings.currentTab;
        const page = tab === 'home' ? renderForgeHome(this)
            : tab === 'tools' ? renderForgeTools()
            : tab === 'weight' ? this.renderWeightPage()
            : tab === 'history' ? this.renderHistoryPage()
            : tab === 'settings' ? this.renderSettingsPage()
            : (this.shouldRenderExecution() ? this.renderExecutionPage() : this.renderTrainingPage());
        const executing = this.shouldRenderExecution();
        const sheetOpen = this.execMenuOpen || this.reorderOpen || !!this.exerciseSheet;
        this.root.innerHTML = `
      <div class="app-shell ${executing ? 'is-executing' : ''} ${this.timer ? 'has-timer' : ''} ${this.timerCollapsed ? 'timer-is-mini' : ''} ${sheetOpen ? 'has-sheet' : ''}" data-current-tab="${escapeHtml(tab)}">
        ${this.renderHeader()}
        <main class="page" id="main-content" ${sheetOpen ? 'inert' : ''}>${page}</main>
        ${sheetOpen ? '' : this.renderNavigation()}
        <div id="toast" class="toast hidden" role="status" aria-live="polite"></div>
        ${this.renderTimerOverlay()}
        ${this.renderExecMenuSheet()}
        ${this.renderReorder()}
        ${this.renderExerciseSheetOverlay()}
        <div id="update-banner" class="update-banner ${this.updateAvailable ? '' : 'hidden'}">
          <span>Nouvelle version disponible</span>
          <button data-action="reload-update">Mettre à jour</button>
        </div>
      </div>`;
        this.restoreForgeForm();
        const dayTabs = this.root.querySelector('.day-tabs');
        const activeDay = dayTabs?.querySelector('.day-tab.active');
        if (dayTabs && activeDay) dayTabs.scrollLeft = Math.max(0, activeDay.offsetLeft - dayTabs.offsetLeft - (dayTabs.clientWidth - activeDay.offsetWidth) / 2);
        this.restoreToast();
        this.tick();
        if (sheetOpen) {
            const sheet = this.root.querySelector('.sheet');
            sheet?.setAttribute('aria-modal', 'true');
            sheet?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
        }
    }
    renderHeader() { return renderForgeHeader(this); }
    renderNavigation() { return renderForgeNav(this.snapshot.settings.currentTab); }
    execState(session) {
        return normalizeExecutionState(session?.execution);
    }
    shouldRenderExecution() {
        if (this.snapshot.settings.currentTab !== 'training')
            return false;
        if (this.programViewOverride)
            return false;
        const context = this.currentContext();
        return this.execState(context.session).active === true;
    }
    executionContext() {
        const context = this.currentContext();
        const resolvePlan = (exercise) => getExercisePlan(exercise, context.weekIndex);
        const step = computeExecutionStep({ day: context.day, session: context.session, resolvePlan });
        const progress = executionProgress({ day: context.day, session: context.session, resolvePlan });
        return { context, resolvePlan, step, progress };
    }
    renderExecutionPage() {
        const { context, resolvePlan, step, progress } = this.executionContext();
        const setCount = this.activeSetCount(context.session, context.day);
        const skipped = context.day.exercises.filter((ex) => context.session.exercises[ex.id]?.skipped).length;
        let cardioSec = 0;
        for (const ex of context.day.exercises)
            if (ex.kind === 'cardio')
                cardioSec += Number(context.session.exercises[ex.id]?.sets?.[0]?.reps) || 0;
        let prescriptionLoadKg = null;
        let lastExposure = null;
        if (step.stage === STAGES.WORK_SET) {
            const log = context.session.exercises[step.exerciseId];
            prescriptionLoadKg = log?.prescription?.loadKg ?? null;
            const history = this.exerciseHistory(step.exerciseId, log.variantId, context.date, context.session.id);
            const last = history.at(-1);
            const lastSet = last?.sets?.filter((x) => x.done).at(-1);
            if (lastSet)
                lastExposure = `${formatKg(lastSet.weightKg)} kg × ${lastSet.reps} — RIR ${lastSet.rir ?? '?'}`;
        }
        const prochain = this.orderedExercises(context.day, context.session)
            .find((ex) => isExercisePending(ex, context.session.exercises[ex.id], resolvePlan(ex)));
        const varianteProchain = prochain ? (prochain.variants?.find((v) => v.id === context.session.exercises[prochain.id]?.variantId) ?? prochain.variants?.[0]) : null;
        return renderExecution(step, {
            day: context.day,
            session: context.session,
            preferredWarmupEquipment: this.snapshot.settings.warmupEquipment ?? null,
            nextExercise: prochain ? { id: prochain.id, name: prochain.name, variantLabel: varianteProchain?.label ?? '' } : null,
            progress,
            elapsedSec: sessionDurationSeconds(context.session),
            prescriptionLoadKg,
            lastExposure,
            summary: {
                exercisesTotal: context.day.exercises.length,
                exercisesDone: context.day.exercises.filter((ex) => {
                    const l = context.session.exercises[ex.id];
                    if (!l || l.skipped)
                        return false;
                    if (ex.kind === 'cardio')
                        return !!l.sets?.[0]?.done;
                    const p = resolvePlan(ex);
                    return l.sets.slice(0, p.sets).every((x) => x.done);
                }).length,
                dayName: context.day.name,
                durationSec: sessionDurationSeconds(context.session),
                setsDone: setCount.done, setsTotal: setCount.total,
                cardioSec, skipped, complete: setCount.complete,
            },
        });
    }
    async saveExecution(patch) {
        const context = this.currentContext();
        context.session.execution = { ...this.execState(context.session), ...patch, updatedAt: Date.now() };
        context.session.updatedAt = Date.now();
        await saveSession(context.session);
    }
    async patchWarmup(mutator) {
        const context = this.currentContext();
        const warmup = normalizeWarmupState(context.session.warmup);
        mutator(warmup);
        context.session.warmup = warmup;
        context.session.updatedAt = Date.now();
        await saveSession(context.session);
    }
    renderTrainingPage() {
        const context = this.currentContext();
        const orderedExercises = this.orderedExercises(context.day, context.session);
        const phase = getTrainingPhase(context.weekIndex);
        const target = weeklyTargets(this.snapshot.profile, 1, weekIndexFromStart(this.snapshot.profile.startDate, context.date))[0];
        const planned = estimateSessionDuration(context.day, (exercise) => getExercisePlan(exercise, context.weekIndex));
        const setCount = this.activeSetCount(context.session, context.day);
        const progress = setCount.total ? Math.round((setCount.done / setCount.total) * 100) : 0;
        const skippedCount = context.day.exercises.filter((exercise) => context.session.exercises[exercise.id]?.skipped).length;
        const elapsed = sessionDurationSeconds(context.session);
        const completedCounts = {};
        orderedExercises.forEach((exercise) => {
            const plan = getExercisePlan(exercise, context.weekIndex);
            const log = context.session.exercises[exercise.id];
            completedCounts[exercise.id] = log?.skipped ? 0 : (log?.sets.slice(0, plan.sets).filter((set) => set.done).length ?? 0);
        });
        const remaining = remainingSessionSeconds(context.day, (exercise) => getExercisePlan(exercise, context.weekIndex), completedCounts);
        const projected = context.session.startedAt ? elapsed + remaining : planned.seconds;
                const complete = this.isSessionComplete(context.session, context.day);
        const nextPendingId = context.session.endedAt ? null : (orderedExercises.find((exercise) => isExercisePending(exercise, context.session.exercises[exercise.id], getExercisePlan(exercise, context.weekIndex)))?.id ?? null);
        const executing = this.execState(context.session).active && !context.session.endedAt;
        return `
      <details class="f-program-phase" data-forge-detail="phase-plan">
      <summary><span><small>Cycle & objectifs · Semaine ${context.weekIndex}</small><strong>${escapeHtml(phase.name)}</strong></span>${icon('chevron')}</summary>
      <section class="phase-card" style="--phase:${phase.color}">
        <div class="phase-top">
          <div><span class="eyebrow">SEMAINE ${context.weekIndex}</span><h1>${escapeHtml(phase.name)}</h1></div>
          <div class="weight-target"><span>cible fin de semaine</span><strong>${formatKg(target.targetWeightKg, 2)} kg</strong></div>
        </div>
        <p>${escapeHtml(phase.description)}</p>
        <div class="phase-metrics">
          <span><b>${planned.targetLabel ?? planned.minutes + ' min'}</b> objectif séance</span>
          <span><b>${this.snapshot.profile.currentCalories}</b> kcal</span>
          <span><b>${this.snapshot.profile.dailyStepTarget.toLocaleString('fr-FR')}\u2013${this.snapshot.profile.stepsOnlyTarget.toLocaleString('fr-FR')}</b> pas/jour</span>
        </div>
      </section>
      </details>

      <section class="week-picker">
        <button class="icon-button" data-action="week-prev" aria-label="Semaine précédente">‹</button>
        <div><strong>${formatDateFr(isoDate(this.viewWeekStart), { day: 'numeric', month: 'short' })} – ${formatDateFr(isoDate(addDays(this.viewWeekStart, 6)), { day: 'numeric', month: 'short' })}</strong><button class="text-button" data-action="week-today">Cette semaine</button></div>
        <button class="icon-button" data-action="week-next" aria-label="Semaine suivante">›</button>
      </section>

      <section class="day-tabs" aria-label="Jours d’entraînement">
        ${TRAINING_DAYS.map((day) => {
            const date = this.dayDate(day);
            const session = this.snapshot.sessions.find((item) => item.id === `${date}:${day.id}`);
            const done = session ? this.isSessionComplete(session, day) : false;
            return `<button class="day-tab ${day.id === context.day.id ? 'active' : ''}" style="--day:${day.color}" data-action="select-day" data-day="${day.id}">
            <span>${day.name}</span><small>${formatDateFr(date, { weekday: 'short', day: 'numeric' })}</small>${done ? '<i>✓</i>' : ''}
          </button>`;
        }).join('')}
      </section>

      ${phase.name === 'Décharge' ? `<section class="f-deload-banner" role="note"><strong>Semaine ${context.weekIndex} du programme · Décharge</strong><span>Moitié des séries (ex. 2 au lieu de 3), charges allégées, garde 4 répétitions. Début du programme : ${escapeHtml(formatDateFr(this.snapshot.profile.programStartDate ?? this.snapshot.profile.startDate, { day: 'numeric', month: 'long' }))} — modifiable dans Réglages › Profil.</span></section>` : ''}
      ${executing ? '<button class="exec-resume-banner" data-action="exec-resume">\u25b6 Revenir à l’étape en cours</button>' : ''}
      <section class="session-card ${complete ? 'complete' : ''}">
        <div class="session-heading">
          <div><span class="eyebrow">${escapeHtml(context.day.focus)}</span><h2>${escapeHtml(context.day.name)}</h2></div>
          <div class="session-progress"><strong>${progress}%</strong><span>${setCount.done}/${setCount.total} séries réalisées</span>${skippedCount ? `<span class="session-status-incomplete">INCOMPL\u00c8TE \u00b7 ${skippedCount} exercice${skippedCount > 1 ? 's' : ''} pass\u00e9${skippedCount > 1 ? 's' : ''}</span>` : ''}</div>
        </div>
        <div class="progress-track"><i style="width:${progress}%"></i></div>
        <div class="time-grid" aria-label="Durée de la séance">
          <div><span>Objectif</span><strong>${planned.targetLabel ?? formatClock(planned.seconds)}</strong></div>
          <div><span>Temps passé</span><strong id="session-elapsed">${formatClock(elapsed)}</strong></div>
          <div class="${planned.targetMaxMinutes && projected > planned.targetMaxMinutes * 60 ? 'over-target' : ''}"><span>Durée estimée</span><strong id="session-projected">${formatClock(projected)}</strong></div>
        </div>
        <div class="session-actions">
          ${!context.session.startedAt ? '<button class="primary-button" data-action="start-session">▶ Démarrer la séance</button>' : !context.session.endedAt ? `${executing ? '' : '<button class="primary-button" data-action="exec-enter">▶ Mode guidé</button>'}<button class="secondary-button" data-action="finish-session">■ Terminer</button>${canCancelSession(context.session) ? '<button class="ghost-button f-cancel-session" data-action="cancel-session">↺ Annuler la séance</button>' : ''}` : '<button class="secondary-button" data-action="resume-session">↻ Reprendre</button>'}
          <a class="ghost-button" href="${YOUTUBE_SEARCH}${encodeURIComponent(context.day.focus + ' échauffement musculation')}" target="_blank" rel="noopener">Échauffement</a>
        </div>
        ${complete ? '<div class="complete-banner">Séance validée. La prochaine prescription est déjà calculée.</div>' : ''}
      </section>

      ${this.renderReadiness(context.session)}
      <section class="f-session-tools" aria-label="Organisation de la séance">
        <div><strong>Tous les exercices</strong><span>${orderedExercises.length} exercices · choisis selon les machines libres</span></div>
        <button class="secondary-button" data-action="exec-reorder">${icon('tune')} Modifier l’ordre</button>
      </section>
      <section class="exercise-list" id="forge-exercises" data-drag-list="programme">
        ${orderedExercises.map((exercise, index) => this.renderExerciseCard(context, exercise, index, orderedExercises.length, nextPendingId)).join('')}
      </section>
      <section class="notes-card card" id="forge-notes">
        <label for="session-notes">Notes de séance</label>
        <textarea id="session-notes" data-session-notes placeholder="Ressenti, congestion, douleurs, observations…">${escapeHtml(context.session.notes)}</textarea>
      </section>`;
    }
    renderReadiness(session) {
        return `<section class="readiness card" id="forge-readiness">
      <div class="card-title"><div><span class="eyebrow">ÉTAT DU JOUR</span><h3>Récupération</h3></div><span class="subtle">Ces réponses évitent d’augmenter tes charges quand tu récupères mal.</span></div>
      <div class="readiness-grid">
        <label>Énergie<select data-readiness="energy">${[1, 2, 3, 4, 5].map((value) => `<option value="${value}" ${session.readiness.energy === value ? 'selected' : ''}>${value}/5</option>`).join('')}</select></label>
        <label>Fatigue<select data-readiness="fatigue">${[1, 2, 3, 4, 5].map((value) => `<option value="${value}" ${session.readiness.fatigue === value ? 'selected' : ''}>${value}/5</option>`).join('')}</select></label>
        <label>Sommeil<input type="number" min="0" max="14" step="0.25" data-readiness="sleepHours" value="${numberInputValue(session.readiness.sleepHours)}" placeholder="h"/></label>
      </div>
    </section>`;
    }
    renderExerciseCard(context, exercise, index, exerciseCount, nextId = null) {
        if (exercise.kind === 'cardio')
            return this.renderCardioCard(context, exercise, index);

        const plan = getExercisePlan(exercise, context.weekIndex);
        const log = context.session.exercises[exercise.id];
        const variant = exercise.variants.find((item) => item.id === log.variantId) ?? exercise.variants[0];
        const prescription = this.prescriptionFor(context, exercise, log);
        const meta = decisionMeta(prescription.decision);
        const activeSets = log.sets.slice(0, plan.sets);
        const doneSets = activeSets.filter((set) => set.done);
        const currentSummary = summarizeSession(activeSets, plan);
        const lastDoneIndex = activeSets.reduce((last, set, setIndex) => set.done ? setIndex : last, -1);
        const nextSet = lastDoneIndex >= 0 && lastDoneIndex < plan.sets - 1
            ? suggestNextSet(activeSets[lastDoneIndex], plan, exercise, variant.incrementKg)
            : null;
        const nextSession = doneSets.length === plan.sets
            ? nextPrescription(activeSets, this.exerciseHistory(exercise.id, log.variantId, context.date, context.session.id), plan, exercise, variant.incrementKg, analyzeRecovery(this.snapshot.dailyLogs).alert)
            : null;
        const targetText = prescription.status === 'CALIBRATION'
            ? 'Trouve ta charge de départ'
            : `${formatKg(prescription.loadKg)} kg × ${plan.repMin}–${plan.repMax}`;
        const displayedReason = prescription.status === 'CALIBRATION'
            ? `Commence prudemment : à la fin de la série, tu dois pouvoir faire encore ${targetRirForSet(plan, 0)} répétitions.`
            : prescription.reason;
        const confidenceLabel = prescription.confidence === 'high'
            ? 'élevée'
            : prescription.confidence === 'medium'
                ? 'moyenne'
                : prescription.confidence === 'low'
                    ? 'faible'
                    : 'à établir';
        return `<article class="exercise-card ${log.skipped ? 'skipped' : ''}" style="--accent:${context.day.color}" data-exercise-card="${exercise.id}" data-drag-item="${exercise.id}" data-drag-locked="false">
      <div class="exercise-head">
        <div class="exercise-index">${String(index + 1).padStart(2, '0')}</div>
        <div class="exercise-title">
          <div class="exercise-name-row"><h3>${escapeHtml(exercise.name)}</h3>${exercise.optional ? '<span class="badge">BONUS</span>' : ''}${exercise.superset ? `<span class="badge muted">SUPERSET ${escapeHtml(exercise.superset.split('-').at(-1) ?? '')}</span>` : ''}</div>
          <div class="exercise-plan"><b>${plan.sets} ×${plan.deload && exercise.sets !== plan.sets ? ` <small class="f-deload-note">(décharge, au lieu de ${exercise.sets})</small>` : ''} ${plan.metric === 'seconds' ? `${formatSeconds(plan.repMin)}\u2013${formatSeconds(plan.repMax)}` : `${plan.repMin}\u2013${plan.repMax} reps`}</b><span>garde ${plan.targetRir} reps</span><span>repos ${formatClock(plan.restSec)}</span>${plan.tempo ? `<span class="tempo-hint" title="Tempo ${escapeHtml(plan.tempo)} : secondes de descente \u2013 pause basse \u2013 mont\u00e9e \u2013 pause haute">tempo ${escapeHtml(plan.tempo)}</span>` : ''}</div>
        </div>
        <a class="video-link" href="${escapeHtml(demoSearch({ name: exercise.name, variantLabel: variant.label }).url)}" target="_blank" rel="noopener noreferrer" aria-label="Rechercher une démonstration de ${escapeHtml(exercise.name)} (YouTube)">▶</a>
      </div>
      ${(() => {
            const pending = isExercisePending(exercise, log, plan);
            const demiSerie = plan.perSide && activeSets.some((set) => !set.done && set.sides?.left?.done);
            const statut = log.skipped ? ['is-skipped', 'Passé'] : !pending ? ['is-done', `Terminé · ${doneSets.length}/${plan.sets}`] : doneSets.length || demiSerie ? ['is-partial', `En cours · ${doneSets.length}/${plan.sets} séries${demiSerie ? ' · gauche fait, droite à faire' : ''}`] : ['', `À faire · 0/${plan.sets} séries`];
            return `<div class="f-card-summary">
        <p class="f-card-variant"><span>${escapeHtml(variantDisplay(variant))}</span><span class="f-card-status ${statut[0]}">${exercise.id === nextId ? 'Prochain · ' : ''}${escapeHtml(statut[1])}</span></p>
        ${exercise.coachingCue ? `<p class="f-card-cue">${escapeHtml(exercise.coachingCue)}</p>` : ''}
        <div class="f-card-actions">
          <button class="f-help-button" data-action="exercise-view" data-exercise="${exercise.id}">${icon('note')}<span>Voir l’exercice</span></button>
          ${log.skipped
                ? `<button class="f-help-button" data-action="toggle-skip-exercise" data-exercise="${exercise.id}">${icon('play')}<span>Réactiver</span></button>`
                : pending && !context.session.endedAt ? `<button class="f-do-now" data-action="exercise-do-now" data-exercise="${exercise.id}">${icon('play')}<span>Faire maintenant</span></button>` : ''}
        </div>
      </div>`;
        })()}

      <details class="f-exercise-detail" data-forge-detail="${escapeHtml(context.session.id)}:${exercise.id}">
      <summary><span>Séries, variante & corrections</span><span>${doneSets.length}/${plan.sets} séries</span></summary>
      <div class="exercise-order-bar" aria-label="Changer la position de ${escapeHtml(exercise.name)}">
        <span class="exercise-order-handle" data-drag-handle role="button" tabindex="0" aria-label="Déplacer ${escapeHtml(exercise.name)}">☰</span>
        <span>Ordre (cette séance)</span>
        <div>
          <button data-action="move-exercise" data-exercise="${exercise.id}" data-direction="up" ${index === 0 ? 'disabled' : ''}>↑ Monter</button>
          <button data-action="move-exercise" data-exercise="${exercise.id}" data-direction="down" ${index === exerciseCount - 1 ? 'disabled' : ''}>↓ Descendre</button>
        </div>
      </div>

      <div class="prescription ${meta.className}">
        <div><span>${meta.icon} ${meta.label}</span><strong>${targetText}</strong></div>
        <p>${escapeHtml(displayedReason)}</p>
        ${prescription.smoothedE1RM > 0 ? `<small>Force estimée ${formatKg(prescription.smoothedE1RM)} kg · fiabilité ${confidenceLabel}${prescription.averageRir !== null ? ` · encore ${formatKg(prescription.averageRir)} reps possibles en moyenne` : ''}</small>` : '<small>Après ta première série, Colosse ajustera la charge suivante.</small>'}
      </div>

      <div class="variant-row">
        <label>Variante
          <select data-exercise-variant="${exercise.id}">
            ${exercise.variants.map((item) => `<option value="${item.id}" ${item.id === log.variantId ? 'selected' : ''}>${escapeHtml(item.label)} · pas ${formatKg(item.incrementKg)} kg</option>`).join('')}
          </select>
        </label>
        ${exercise.variants.length > 1 ? '<span>Machine occupée ? Change ici : l’historique reste séparé.</span>' : ''}
      </div>

      <div class="set-table">
        <div class="set-help"><strong>Après chaque série</strong><span>Indique ce que tu as réellement ressenti. Si tu hésites, choisis « Je ne sais pas ».</span></div>
        ${activeSets.map((set, setIndex) => this.renderSetRow(exercise, set, setIndex, prescription, plan)).join('')}
      </div>

      ${nextSet && nextSet.action !== 'WAIT' ? `<div class="next-set ${nextSet.action === 'STOP_OR_SWAP' ? 'danger' : ''}"><div><span>SÉRIE ${lastDoneIndex + 2}</span><strong>${nextSet.loadKg ? `${formatKg(nextSet.loadKg)} kg` : 'Arrêt'} · ${plan.repMin}–${plan.repMax} reps · garde ${targetRirForSet(plan, lastDoneIndex + 1)} reps</strong><p>${escapeHtml(nextSet.label)}</p></div>${nextSet.loadKg ? `<button data-action="apply-next-load" data-exercise="${exercise.id}" data-set="${lastDoneIndex + 1}" data-load="${nextSet.loadKg}">Appliquer</button>` : ''}</div>` : ''}
      ${nextSession ? `<div class="next-session"><span>PROCHAINE EXPOSITION</span><strong>${formatKg(nextSession.loadKg)} kg · objectif ${nextSession.targetTotalReps} reps totales</strong><p>${escapeHtml(nextSession.reason)}</p></div>` : ''}
      <div class="cue"><span>COACHING</span><p>${escapeHtml(exercise.coachingCue)}</p></div>
      <div class="exercise-footer">
        <span>${currentSummary.totalReps || 0} reps · ${Math.round(activeSets.reduce((sum, set) => sum + (set.done ? Number(set.weightKg || 0) * Number(set.reps || 0) : 0), 0)).toLocaleString('fr-FR')} kg volume</span>
        <button class="text-button danger-text" data-action="toggle-skip-exercise" data-exercise="${exercise.id}">${log.skipped ? 'Réactiver' : 'Passer cet exercice'}</button>
      </div>
      </details>
    </article>`;
    }
    renderCardioCard(context, exercise, index) {
        const plan = getExercisePlan(exercise, context.weekIndex);
        const log = context.session.exercises[exercise.id];
        const set = log?.sets?.[0];
        const doneSec = Number(set?.reps) || 0;
        const targetSec = exercise.durationSec ?? plan.repMin;
        // Accompli = durée réellement chronométrée atteinte ET enregistrée.
        // Jamais un clic.
        const status = timedExerciseStatus(doneSec, targetSec, set?.done === true);
        // `legacy` : validé par l'ancien bug, sans durée. Reste compté comme
        // fait (on ne touche pas à l'historique), mais la carte le dit.
        const done = status.done || status.legacy;
        const running = context.session.activeTimer?.context?.exerciseId === exercise.id;
        const actions = timedExerciseActions(status, running);
        return `<article class="exercise-card cardio-card ${done ? 'complete' : ''}" style="--accent:${context.day.color}" data-exercise-card="${exercise.id}" data-drag-item="${exercise.id}" data-drag-locked="true">
      <div class="exercise-head">
        <div class="exercise-index">${String(index + 1).padStart(2, '0')}</div>
        <div class="exercise-title">
          <div class="exercise-name-row"><h3>${escapeHtml(exercise.name)}</h3><span class="badge cardio-badge">CARDIO</span></div>
          <div class="exercise-plan"><b>${formatSeconds(targetSec)}</b>${exercise.inclinePct ? `<span>inclinaison ${escapeHtml(String(exercise.inclinePct))} %</span>` : ''}${exercise.speedKmh ? `<span>vitesse ${escapeHtml(String(exercise.speedKmh))}${/[0-9]/.test(String(exercise.speedKmh)) ? ' km/h' : ''}</span>` : ''}</div>
        </div>
      </div>
      <p class="coaching-cue">${escapeHtml(exercise.coachingCue ?? '')}</p>
      <div class="f-card-actions"><button class="f-help-button" data-action="exercise-view" data-exercise="${exercise.id}">${icon('note')}<span>Voir l’exercice</span></button><span class="f-card-status">Épinglé en fin de séance</span></div>
      <div class="cardio-actions">
        ${actions.map((item) => `<button class="${item.style}-button" data-action="${item.action}" data-exercise="${exercise.id}" data-duration="${targetSec}" data-kind="${context.day.kind === 'recovery' ? 'recovery' : 'cardio'}">${escapeHtml(item.label)}</button>`).join('')}
        <span class="cardio-status ${done ? 'is-done' : status.partial ? 'is-partial' : ''}">${done ? '✓ ' : ''}${escapeHtml(status.label)}</span>
      </div>
    </article>`;
    }
    renderSetRow(exercise, set, setIndex, prescription, plan) {
        const suggestedWeight = set.weightKg ?? (prescription.loadKg || null);
        const isSeconds = plan.metric === 'seconds';
        const variantDef = exercise.variants.find((item) => item.id === (this.currentContext?.().session.exercises[exercise.id]?.variantId)) ?? exercise.variants[0];
        const needsLoadInput = (variantDef?.loadMode ?? 'external') === 'external';
        const rowTargetRir = targetRirForSet(plan, setIndex);
        const sideState = plan.perSide ? (set.side ?? 'left') : null;
        const sideLabel = sideState === 'right' ? 'CÔTÉ DROIT' : 'CÔTÉ GAUCHE';
        const cote = (value) => `${formatKg(value?.weightKg ?? 0)} kg × ${value?.reps ?? '?'}`;
        const sideSummary = !plan.perSide ? ''
            : set.done && set.sides?.left?.done && set.sides?.right?.done
                ? `<span class="f-side-summary is-done">✓ Gauche ${cote(set.sides.left)} · ✓ Droite ${cote(set.sides.right)}</span>`
                : set.sides?.left?.done
                    ? `<span class="f-side-summary">✓ Gauche fait\u00a0: ${cote(set.sides.left)}${set.sides.left.rir !== null && set.sides.left.rir !== undefined ? ` · RIR ${set.sides.left.rir}` : ''} — <b>droite à faire</b></span>`
                    : '';
        const hit = set.done
            && Number(set.reps) >= plan.repMin
            && Number(set.reps) <= plan.repMax
            && set.technique === 'good'
            && Number(set.pain ?? 0) <= 3;
        return `<div class="set-row ${set.done ? 'done' : ''} ${hit ? 'hit' : ''}" data-set-row data-exercise="${exercise.id}" data-set="${setIndex}">
      ${sideSummary}
      <div class="set-primary">
        <span class="set-number"><small>${isSeconds ? 'Bloc' : 'Série'}</small>${setIndex + 1}</span>
        ${plan.perSide && !set.done ? `<span class="side-badge ${sideState}">${sideLabel}</span>` : ''}
        ${needsLoadInput ? `<label><span>Charge (kg)</span><input type="number" inputmode="decimal" min="0" step="0.25" data-set-field="weightKg" value="${numberInputValue(suggestedWeight)}" placeholder="0" aria-label="Charge série ${setIndex + 1}"/></label>` : ''}
        ${isSeconds
            ? `<label><span>Durée (s)</span><input type="number" inputmode="numeric" min="0" step="5" data-set-field="reps" value="${numberInputValue(set.reps)}" placeholder="${plan.repMin}" aria-label="Durée en secondes du bloc ${setIndex + 1}"/><small class="set-hint">objectif ${formatSeconds(plan.repMin)}${plan.repMax !== plan.repMin ? `\u2013${formatSeconds(plan.repMax)}` : ''}</small></label>`
            : `<label><span>Répétitions</span><input type="number" inputmode="numeric" min="0" max="50" step="1" data-set-field="reps" value="${numberInputValue(set.reps)}" placeholder="0" aria-label="Répétitions série ${setIndex + 1}"/></label>`}
        <button class="set-check" data-action="toggle-set" data-exercise="${exercise.id}" data-set="${setIndex}" aria-label="${set.done ? `Série ${setIndex + 1} validée — toucher pour annuler la validation` : `Valider ${isSeconds ? 'le bloc' : 'la série'} ${setIndex + 1}`}">${set.done ? '✓ Fait' : (plan.perSide ? `Valider ${sideLabel.toLowerCase()}` : 'Valider')}</button>
      </div>
      <div class="set-feedback">
        <label><span>Encore possible <small class="rir-target">(cible ${rowTargetRir})</small></span><select data-set-field="rir" aria-label="Répétitions encore possibles après la série ${setIndex + 1}"><option value="" ${set.rir === null ? 'selected' : ''}>Je ne sais pas</option><option value="0" ${set.rir === 0 ? 'selected' : ''}>Aucune</option>${[1, 2, 3, 4, 5].map((value) => `<option value="${value}" ${set.rir === value ? 'selected' : ''}>${value} rep${value > 1 ? 's' : ''}</option>`).join('')}<option value="6" ${set.rir === 6 ? 'selected' : ''}>6 reps ou +</option></select></label>
        <label><span>Mouvement</span><select data-set-field="technique" aria-label="Qualité du mouvement série ${setIndex + 1}"><option value="" ${set.technique === null ? 'selected' : ''}>Je ne sais pas</option><option value="good" ${set.technique === 'good' ? 'selected' : ''}>Propre</option><option value="degraded" ${set.technique === 'degraded' ? 'selected' : ''}>Dégradé</option></select></label>
        <label><span>Douleur</span><select data-set-field="pain" aria-label="Douleur série ${setIndex + 1}"><option value="" ${set.pain === null ? 'selected' : ''}>Non notée</option><option value="0" ${set.pain === 0 ? 'selected' : ''}>Aucune</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => `<option value="${value}" ${set.pain === value ? 'selected' : ''}>${value}/10</option>`).join('')}</select></label>
      </div>
      ${set.restActualSec ? `<small class="rest-actual">repos ${formatClock(set.restActualSec)}</small>` : ''}
    </div>`;
    }
    renderWeightPage() {
        const today = isoDate();
        const log = this.dailyLog(today);
        const recovery = analyzeRecovery(this.snapshot.dailyLogs);
        const strength = analyzeStrengthTrend(this.snapshot.sessions);
        const analysis = analyzeWeightTrend(this.snapshot.dailyLogs, this.snapshot.profile, this.snapshot.adjustments, { date: today, strengthAlert: strength.alert, recoveryAlert: recovery.alert });
        const currentWeek = weekIndexFromStart(this.snapshot.profile.startDate, today);
        const currentTarget = weeklyTargets(this.snapshot.profile, 1, currentWeek)[0];
        const targets = weeklyTargets(this.snapshot.profile, 8, currentWeek);
        const macros = macrosForCalories(this.snapshot.profile.currentCalories, this.snapshot.profile.proteinG, this.snapshot.profile.fatG);
        const chartStart = addDays(new Date(), -27);
        const targetPoints = Array.from({ length: 28 }, (_, index) => {
            const date = isoDate(addDays(chartStart, index));
            return { date, weight: targetWeight(this.snapshot.profile, date) };
        });
        const recentLogs = [...this.snapshot.dailyLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
        const activity = activityProgress(log, this.snapshot.profile);
        return `
      <section class="weight-hero">
        <div><span class="eyebrow">SUIVI DU POIDS</span><h1>${formatKg(analysis.currentAverageKg || log.weightKg, 2)} kg</h1><p>Ton poids moyen des 7 derniers jours. Colosse ajuste le plan d’après les 14 derniers jours.</p></div>
        <div class="weight-target"><span>cible dimanche</span><strong>${formatKg(currentTarget.targetWeightKg, 2)} kg</strong><small>${formatKg(currentTarget.toleranceLowKg, 2)} – ${formatKg(currentTarget.toleranceHighKg, 2)}</small></div>
      </section>

      <section class="macro-grid">
        <div><span>Calories</span><strong>${macros.calories}</strong><small>kcal/j</small></div>
        <div><span>Protéines</span><strong>${macros.proteinG}</strong><small>g/j</small></div>
        <div><span>Glucides</span><strong>${macros.carbsG}</strong><small>g/j</small></div>
        <div><span>Lipides</span><strong>${macros.fatG}</strong><small>g/j</small></div>
      </section>

      <section id="forge-trend" class="trend-card card status-${analysis.status.toLowerCase()}">
        <div class="card-title"><div><span class="eyebrow">BILAN COLOSSE</span><h2>${this.weightStatusLabel(analysis.status)}</h2></div><span class="status-pill">${analysis.samples} pesées</span></div>
        <p>${escapeHtml(analysis.reason)}</p>
        <div class="trend-metrics">
          <div><span>Perte observée</span><strong>${analysis.enoughData ? `${formatKg(analysis.observedLossKgPerWeek, 3)} kg/sem` : '—'}</strong></div>
          <div><span>Perte cible</span><strong>${formatKg(analysis.targetLossKgPerWeek, 3)} kg/sem</strong></div>
          <div><span>Adhérence</span><strong>${pct(analysis.adherencePct, 0)}</strong></div>
        </div>
        ${analysis.action === 'CALORIES' && analysis.calorieDelta !== 0 ? `<button class="primary-button" data-action="apply-calorie-adjustment">Appliquer ${analysis.calorieDelta > 0 ? '+' : ''}${analysis.calorieDelta} kcal → ${analysis.proposedCalories} kcal</button>` : ''}
        
        ${(strength.alert || recovery.alert) ? `<div class="alert-strip"><strong>Récupération sous surveillance</strong><span>${escapeHtml([strength.alert ? strength.reason : '', ...recovery.reasons].filter(Boolean).join(' '))}</span></div>` : ''}
      </section>

      <section class="card chart-card" id="forge-chart">
        <div class="card-title"><div><span class="eyebrow">28 JOURS</span><h2>Poids réel vs trajectoire</h2></div><div class="chart-legend"><span class="actual">Réel</span><span class="target">Cible</span></div></div>
        ${sparklineSvg(this.snapshot.dailyLogs, targetPoints)}
      </section>

      <section id="forge-activity" class="card activity-card ${activity.complete ? 'complete' : ''}">
        <div class="card-title">
          <div><span class="eyebrow">ACTIVITÉ DU JOUR</span><h2>Pas, vélo ou les deux</h2></div>
          <span class="activity-status">${activity.complete ? '✓ Objectif atteint' : `${activity.percent}%`}</span>
        </div>
        <p class="activity-rule">${escapeHtml(activityGoalLabel(this.snapshot.profile))}</p>
        <div class="progress-track activity-progress"><i style="width:${activity.percent}%"></i></div>
        <div class="form-grid activity-fields">
          ${this.dailyField('steps', 'Pas mesurés par l’iPhone', 'pas', log.steps, '1', 0)}
          ${this.dailyField('bikeMinutes', 'Vélo', 'min', log.bikeMinutes, '1', 0, 240)}
          <label>Intensité du vélo
            <select data-daily-text-field="bikeIntensity">
              <option value="easy" ${log.bikeIntensity === 'easy' ? 'selected' : ''}>Facile</option>
              <option value="moderate" ${log.bikeIntensity === 'moderate' ? 'selected' : ''}>Modérée</option>
              <option value="vigorous" ${log.bikeIntensity === 'vigorous' ? 'selected' : ''}>Soutenue</option>
            </select>
          </label>
          <div class="activity-mode"><span>Mode détecté</span><strong>${activityModeLabel(log)}</strong><small>${activity.bikeMinutes ? `${activity.bikeEquivalentMinutes} min modérées comptées` : 'Saisie manuelle'}</small></div>
        </div>
        <p class="activity-help">Pas de vitesse imposée : modérée = tu peux parler, pas chanter ; soutenue = seulement quelques mots.</p>
      </section>

      <section class="card daily-form" id="forge-checkin">
        <div class="card-title"><div><span class="eyebrow">AUJOURD’HUI · ${formatDateFr(today)}</span><h2>Check-in quotidien</h2></div><span class="subtle">2 minutes</span></div>
        <div class="form-grid">
          ${this.dailyField('weightKg', 'Poids', 'kg', log.weightKg, '0.05')}
          ${this.dailyField('waistCm', 'Tour de taille', 'cm', log.waistCm, '0.1')}
          ${this.dailyField('calories', 'Calories réelles', 'kcal', log.calories, '1')}
          ${this.dailyField('adherencePct', 'Adhérence', '%', log.adherencePct, '1', 0, 100)}
          ${this.dailyField('sleepHours', 'Sommeil', 'h', log.sleepHours, '0.25', 0, 14)}
          ${this.dailyField('fatigue', 'Fatigue', '/5', log.fatigue, '1', 1, 5)}
        </div>
        <label class="full-label">Notes<textarea data-daily-notes="${today}" placeholder="Faim, digestion, alcool, événement inhabituel…">${escapeHtml(log.notes)}</textarea></label>
      </section>

      <section class="card targets-card" id="forge-targets">
        <div class="card-title"><div><span class="eyebrow">TRAJECTOIRE</span><h2>Objectifs hebdomadaires</h2></div><span class="subtle">−${(this.snapshot.profile.weeklyLossRatePct * 100).toFixed(2)} %/sem</span></div>
        <div class="target-table">
          ${targets.map((target, index) => `<div class="target-row ${index === 0 ? 'current' : ''}"><span>S${target.weekIndex}<small>${formatDateFr(target.endDate, { day: 'numeric', month: 'short' })}</small></span><strong>${formatKg(target.targetWeightKg, 2)} kg</strong><small>${formatKg(target.toleranceLowKg, 2)}–${formatKg(target.toleranceHighKg, 2)}</small></div>`).join('')}
        </div>
      </section>

      <section class="card recent-checkins" id="forge-checkins">
        <div class="card-title"><div><span class="eyebrow">DONNÉES</span><h2>Derniers check-ins</h2></div></div>
        ${recentLogs.length ? `<div class="log-list">${recentLogs.map((item) => `<div><span>${formatDateFr(item.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span><strong>${formatKg(item.weightKg, 2)} kg</strong><small>${item.adherencePct !== null ? `${item.adherencePct}%` : '—'} · ${activitySummary(item)}</small></div>`).join('')}</div>` : '<p class="empty-state">Aucune donnée quotidienne.</p>'}
      </section>`;
    }
    dailyField(field, label, unit, value, step, min, max) {
        return `<label>${escapeHtml(label)}<div class="input-unit"><input type="number" inputmode="decimal" step="${step}" ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} data-daily-field="${String(field)}" value="${numberInputValue(value)}"/><span>${escapeHtml(unit)}</span></div></label>`;
    }
    weightStatusLabel(status) {
        switch (status) {
            case 'ON_TRACK': return 'Trajectoire tenue';
            case 'TOO_SLOW': return 'Perte trop lente';
            case 'TOO_FAST': return 'Perte trop rapide';
            case 'ADHERENCE': return 'Exécution à corriger';
            case 'RECOVERY': return 'Récupération prioritaire';
            case 'ACTIVITY': return 'Augmente l’activité';
            case 'HOLD': return 'Maintien du plan';
            default: return 'Collecte des données';
        }
    }
    renderHistoryPage() {
        const sessions = [...this.snapshot.sessions]
            .filter((session) => Object.values(session.exercises).some((exercise) => exercise.sets.some((set) => set.done)))
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 30);
        const strength = analyzeStrengthTrend(this.snapshot.sessions);
        const selectedDay = this.currentDay();
        const previewDate = this.dayDate(selectedDay);
        const mockSession = this.snapshot.sessions.find((session) => session.id === `${previewDate}:${selectedDay.id}`)
            ?? makeSession(selectedDay.id, previewDate, this.snapshot.profile);
        const previewWeek = sessionWeekIndex(mockSession, this.snapshot.profile);
        this.syncSession(mockSession, selectedDay, previewWeek);
        const adjustments = [...this.snapshot.adjustments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
        return `
      <section class="history-hero">
        <div><span class="eyebrow">PROGRESSION</span><h1>${sessions.length} séances enregistrées</h1><p>${escapeHtml(strength.reason)}</p></div>
        <div class="strength-chip ${strength.alert ? 'danger' : ''}"><span>Force récente</span><strong>${strength.changePct >= 0 ? '+' : ''}${strength.changePct.toFixed(1)} %</strong></div>
      </section>

      <section id="forge-prescriptions" class="card prescription-board">
        <div class="card-title"><div><span class="eyebrow">PROCHAINE SÉANCE · ${escapeHtml(selectedDay.name)}</span><h2>Charges prescrites</h2></div></div>
        <div class="prescription-list">
          ${selectedDay.exercises.map((exercise) => {
            const log = mockSession.exercises[exercise.id];
            const context = { day: selectedDay, date: previewDate, weekIndex: previewWeek, session: mockSession };
            const prescription = this.prescriptionFor(context, exercise, log);
            const meta = decisionMeta(prescription.decision);
            return `<div><span>${escapeHtml(exercise.shortName)}<small>${escapeHtml(exercise.variants.find((variant) => variant.id === log.variantId)?.label ?? '')}</small></span><strong>${prescription.loadKg > 0 ? `${formatKg(prescription.loadKg)} kg` : 'Calibration'}</strong><em class="${meta.className}">${meta.icon} ${meta.label}</em></div>`;
        }).join('')}
        </div>
      </section>

      <section id="forge-history" class="card">
        <div class="card-title"><div><span class="eyebrow">JOURNAL</span><h2>Dernières séances</h2></div></div>
        ${sessions.length ? `<div class="session-history">${sessions.map((session) => this.renderHistorySession(session)).join('')}</div>` : '<p class="empty-state">Aucune séance terminée.</p>'}
      </section>

      <section id="forge-adjustments" class="card">
        <div class="card-title"><div><span class="eyebrow">NUTRITION</span><h2>Ajustements appliqués</h2></div></div>
        ${adjustments.length ? `<div class="adjustment-list">${adjustments.map((adjustment) => `<div><span>${formatDateFr(adjustment.date)}</span><strong>${adjustment.previousCalories} → ${adjustment.newCalories} kcal</strong><small>${escapeHtml(adjustment.reason)}</small></div>`).join('')}</div>` : '<p class="empty-state">Aucun ajustement calorique appliqué.</p>'}
      </section>

      ${this.snapshot.legacyArchive ? `<section class="legacy-card"><strong>Historique Colosse v2 importé</strong><span>${this.snapshot.legacyArchive.convertedSessions} séances converties et archive brute conservée.</span></section>` : ''}`;
    }
    renderHistorySession(session) {
        const day = findDay(session.dayId);
        const count = this.activeSetCount(session, day);
        const completion = count.total ? Math.round((count.done / count.total) * 100) : 0;
        const duration = sessionDurationSeconds(session);
        return `<details class="history-session">
      <summary><div><span>${formatDateFr(session.date, { weekday: 'long', day: 'numeric', month: 'short' })}</span><strong>${escapeHtml(day.name)} · ${completion}%</strong></div><div><span>${duration ? formatClock(duration) : '—'}</span><small>${(sessionTonnage(session) / 1000).toFixed(1)} t</small></div></summary>
      <div class="history-detail">
        ${day.exercises.map((exercise) => {
            const log = session.exercises[exercise.id];
            if (!log)
                return '';
            const done = log.sets.filter((set) => set.done && set.weightKg && set.reps);
            if (!done.length && !log.skipped)
                return '';
            return `<div><span>${escapeHtml(exercise.shortName)}</span><strong>${log.skipped ? 'Passé' : done.map((set) => `${formatKg(set.weightKg)}×${set.reps}@${set.rir ?? '?'}`).join(' · ')}</strong></div>`;
        }).join('')}
        ${session.notes ? `<p>${escapeHtml(session.notes)}</p>` : ''}
        <button class="text-button danger-text" data-action="delete-session" data-session="${escapeHtml(session.id)}">Supprimer cette séance</button>
      </div>
    </details>`;
    }
    renderSettingsPage() {
        const profile = this.snapshot.profile;
        const settings = this.snapshot.settings;
        return `
      <section class="settings-hero"><span class="eyebrow">CONFIGURATION</span><h1>Tes réglages Colosse</h1><p>Retrouve ici tes objectifs d’entraînement, de poids, d’activité et de nutrition.</p></section>

      <section id="forge-profile" class="card settings-section">
        <div class="card-title"><div><span class="eyebrow">PROFIL</span><h2>Données de départ</h2></div></div>
        <div class="form-grid">
          ${this.profileField('age', 'Âge', profile.age, 'ans', '1', 18, 90)}
          ${this.profileField('heightCm', 'Taille', profile.heightCm, 'cm', '1', 130, 230)}
          ${this.profileField('startWeightKg', 'Poids de départ', profile.startWeightKg, 'kg', '0.1', 40, 250)}
          <label>Date de départ <small>(suivi du poids)</small><div class="input-unit"><input type="date" data-profile-field="startDate" value="${escapeHtml(profile.startDate)}"/></div></label>
          <label>Début du programme <small>(semaines, séries, décharge)</small><div class="input-unit"><input type="date" data-profile-field="programStartDate" value="${escapeHtml(profile.programStartDate ?? profile.startDate)}"/></div></label>
          <p class="f-program-start-help">${escapeHtml(this.programStartSummary())}</p>
          ${this.profileField('weeklyLossRatePct', 'Perte / semaine', profile.weeklyLossRatePct * 100, '%', '0.05', 0.1, 1)}
          ${this.profileField('sessionLimitMinutes', 'Alerte durée (affichage seul)', profile.sessionLimitMinutes, 'min', '5', 60, 120)}
        </div>
      </section>

      <section id="forge-nutrition" class="card settings-section">
        <div class="card-title"><div><span class="eyebrow">NUTRITION</span><h2>Garde-fous</h2></div></div>
        <div class="form-grid">
          ${this.profileField('currentCalories', 'Calories actuelles', profile.currentCalories, 'kcal', '50', 1500, 6000)}
          ${this.profileField('proteinG', 'Protéines', profile.proteinG, 'g', '5', 80, 350)}
          ${this.profileField('fatG', 'Lipides', profile.fatG, 'g', '5', 40, 200)}
          ${this.profileField('minimumCalories', 'Plancher', profile.minimumCalories, 'kcal', '50', 1500, 5000)}
          ${this.profileField('maximumCalories', 'Plafond', profile.maximumCalories, 'kcal', '50', 2000, 7000)}
          ${this.profileField('dailyStepTarget', 'Bas de la zone de pas', profile.dailyStepTarget, 'pas', '250', 1000, 20000)}
          ${this.profileField('stepsOnlyTarget', 'Haut de la zone de pas', profile.stepsOnlyTarget, 'pas', '250', 3000, 30000)}
          ${this.profileField('bikeMinutesTarget', 'Vélo modéré', profile.bikeMinutesTarget, 'min', '5', 5, 120)}
        </div>
        <p class="subtle-block settings-help">${escapeHtml(activityGoalHelp(profile))}</p>
      </section>

      <section id="forge-preferences" class="card settings-section">
        <div class="card-title"><div><span class="eyebrow">EXPÉRIENCE</span><h2>Comportement de l’application</h2></div></div>
        <div class="toggle-list">
          ${this.settingToggle('autoStartTimer', 'Démarrer automatiquement le repos', settings.autoStartTimer)}
          ${this.settingToggle('soundEnabled', 'Signal sonore en fin de repos', settings.soundEnabled)}
          ${this.settingToggle('vibrationEnabled', 'Vibration en fin de repos', settings.vibrationEnabled)}
          <label class="toggle-row f-select-row"><span>Échauffement général proposé en premier</span><select data-setting-field="warmupEquipment" aria-label="Matériel d’échauffement proposé en premier">${Object.values(WARMUP_EQUIPMENT).map((option) => `<option value="${option.id}" ${(settings.warmupEquipment ?? 'treadmill') === option.id ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></label>
        </div>
        ${this.installPrompt ? '<button class="primary-button" data-action="install-app">Installer Colosse sur cet appareil</button>' : ''}
      </section>

      <section id="forge-data" class="card settings-section">
        <div class="card-title"><div><span class="eyebrow">DONNÉES</span><h2>Sauvegarde et migration</h2></div><span class="status-pill">${storageMode()}</span></div>
        <p class="subtle-block">Les données restent sur cet appareil. Exporte régulièrement un JSON de sauvegarde.</p>
        <div class="data-actions">
          <button class="secondary-button" data-action="export-data">Exporter JSON</button>
          <button class="secondary-button" data-action="import-data">Importer JSON</button>
          <input id="import-file" type="file" accept="application/json,.json" hidden/>
        </div>
        ${this.snapshot.legacyArchive ? `<div class="legacy-note">Migration v2 : ${this.snapshot.legacyArchive.convertedSessions} séances converties le ${formatDateFr(this.snapshot.legacyArchive.importedAt.slice(0, 10))}.</div>` : '<div class="legacy-note">Aucune ancienne base détectée.</div>'}
        <button class="danger-button" data-action="reset-data">Effacer toutes les données</button>
      </section>

      <section class="about-card"><strong>Colosse Adaptive ${APP_VERSION}</strong><span>Moteur déterministe · IndexedDB · PWA hors ligne · aucune donnée envoyée à un serveur.</span></section>`;
    }
    profileField(field, label, value, unit, step, min, max) {
        return `<label>${escapeHtml(label)}<div class="input-unit"><input type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" data-profile-field="${String(field)}" value="${numberInputValue(value)}"/><span>${escapeHtml(unit)}</span></div></label>`;
    }
    settingToggle(field, label, checked) {
        return `<label class="toggle-row"><span>${escapeHtml(label)}</span><input type="checkbox" data-setting-field="${String(field)}" ${checked ? 'checked' : ''}/><i></i></label>`;
    }
    renderTimerOverlay() {
        if (!this.timer) return '';
        const remaining = this.timerRemainingSec();
        return `<section class="timer-overlay f-timer ${this.timerCollapsed ? 'is-mini' : ''}" aria-label="Chronomètre ${escapeHtml(timerLabel(this.timer.kind))}">
          <div class="f-timer-head">${icon('timer')}<span class="timer-label">${escapeHtml(timerLabel(this.timer.kind))}${this.timer.paused ? ' · Pause' : ''}</span><button class="f-timer-toggle" data-action="forge-timer-toggle" aria-expanded="${!this.timerCollapsed}" aria-label="${this.timerCollapsed ? 'Déployer le chronomètre' : 'Réduire le chronomètre'}">${icon(this.timerCollapsed ? 'plus' : 'minus')}</button></div>
          ${this.timer.kind === 'transition' ? (() => { const nom = this.transitionNextName(); return nom ? `<p class="f-timer-next">Ensuite : <b>${escapeHtml(nom)}</b></p>` : ''; })() : ''}
          <strong id="timer-remaining" role="timer" aria-live="off">${formatClock(remaining)}</strong>
          <div class="timer-progress"><i id="timer-progress" style="width:${Math.max(0, Math.min(100, remaining / this.timer.totalSec * 100))}%"></i></div>
          <div class="timer-actions">${this.renderTimerControls()}</div>
          ${this.renderTimerSkip()}
        </section>`;
    }
    /** Exercice qui suit réellement (l'ordre a pu changer : machine occupée, exercice passé). */
    transitionNextName() {
        const owner = this.timerOwner();
        const context = this.currentContext();
        if (owner && owner.id === context.session.id) {
            const next = this.orderedExercises(context.day, context.session).find((item) => isExercisePending(item, context.session.exercises[item.id], getExercisePlan(item, context.weekIndex)));
            return next?.name ?? null;
        }
        return this.timer?.context?.nextName ?? null;
    }
    /** Les contrôles dépendent du kind : une durée prescrite ne se raccourcit pas. */
    renderTimerControls() {
        return timerControls(this.timer.kind)
            .filter((control) => control.id !== 'skip')
            .map((control) => {
            if (control.id === 'pause')
                return `<button class="timer-pause" data-action="timer-pause" aria-label="${this.timer.paused ? 'Reprendre le chronomètre' : 'Mettre le chronomètre en pause'}">${this.timer.paused ? '▶' : 'Ⅱ'}</button>`;
            const action = control.id === 'minus' ? 'timer-minus' : 'timer-plus';
            return `<button data-action="${action}" data-delta="${control.deltaSec}">${escapeHtml(control.label)}</button>`;
        })
            .join('');
    }
    renderTimerSkip() {
        const skip = timerControls(this.timer.kind).find((control) => control.id === 'skip');
        if (!skip)
            return '';
        return `<button class="timer-skip" data-action="timer-skip">${escapeHtml(skip.label)}</button>`;
    }
    async handleClick(event) {
        // Sélection des puces RIR / technique / douleur du mode exécution
        const chip = event.target instanceof Element ? event.target.closest('.chip-choice') : null;
        if (chip) {
            chip.closest('.chip-row')?.querySelectorAll('.chip-choice').forEach((el) => { el.classList.remove('selected'); el.setAttribute('aria-pressed', 'false'); });
            chip.classList.add('selected');
            chip.setAttribute('aria-pressed', 'true');
            if (chip.closest('[data-forge-step]'))
                this.persistForgeDraft();
            return;
        }
        const actionElement = event.target instanceof Element ? event.target.closest('[data-action]') : null;
        if (!actionElement)
            return;
        const action = actionElement.dataset.action;
        switch (action) {
            case 'forge-step': {
                const input = actionElement.closest('.f-value-cell')?.querySelector('input[data-exec-field]');
                if (!input) break;
                input.value = String(steppedValue(input.value || input.placeholder, Number(actionElement.dataset.delta), Number(input.min) || 0));
                input.dispatchEvent(new Event('input', { bubbles: true }));
                break;
            }
            case 'forge-timer-toggle':
                this.timerCollapsed = !this.timerCollapsed;
                this.render();
                break;
            case 'forge-open': {
                const tab = actionElement.dataset.tab;
                if (!['home', 'training', 'weight', 'history', 'settings', 'tools'].includes(tab)) break;
                this.snapshot.settings.currentTab = tab;
                if (tab === 'training') this.programViewOverride = true;
                await saveSettings(this.snapshot.settings);
                this.render();
                const target = document.getElementById(actionElement.dataset.section ?? '');
                if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
                else window.scrollTo({ top: 0, behavior: 'instant' });
                break;
            }
            case 'forge-resume': {
                const running = this.snapshot.sessions.find(item => item.execution?.active && !item.endedAt && !this.isStaleSession(item))
                    ?? this.snapshot.sessions.find(item => item.execution?.active && !item.endedAt && item.date === isoDate());
                if (running) {
                    this.snapshot.settings.selectedDayId = running.dayId;
                    this.viewWeekStart = startOfWeek(new Date(`${running.date}T12:00:00`));
                }
                this.snapshot.settings.currentTab = 'training';
                this.programViewOverride = false;
                await saveSettings(this.snapshot.settings);
                await this.ensureCurrentSession();
                await this.restoreTimerFromSession();
                this.render();
                window.scrollTo({ top: 0, behavior: 'instant' });
                break;
            }
            case 'forge-notes':
                this.programViewOverride = true;
                this.render();
                document.getElementById('forge-notes')?.scrollIntoView({ block: 'start', behavior: 'instant' });
                break;
            case 'tab': {
                const tab = actionElement.dataset.tab;
                if (!['home', 'training', 'weight', 'history', 'settings', 'tools'].includes(tab)) break;
                this.snapshot.settings.currentTab = tab;
                await saveSettings(this.snapshot.settings);
                this.render();
                window.scrollTo({ top: 0, behavior: 'instant' });
                break;
            }
            case 'week-prev':
                this.viewWeekStart = addDays(this.viewWeekStart, -7);
                await this.ensureCurrentSession();
                this.render();
                break;
            case 'week-next':
                this.viewWeekStart = addDays(this.viewWeekStart, 7);
                await this.ensureCurrentSession();
                this.render();
                break;
            case 'week-today':
                {
                    const today = new Date();
                    this.viewWeekStart = startOfWeek(today);
                    this.snapshot.settings.selectedDayId = defaultDayForDate(today).id;
                    await saveSettings(this.snapshot.settings);
                }
                await this.ensureCurrentSession();
                this.render();
                break;
            case 'select-day':
                this.snapshot.settings.selectedDayId = actionElement.dataset.day ?? TRAINING_DAYS[0].id;
                await saveSettings(this.snapshot.settings);
                await this.ensureCurrentSession();
                this.render();
                break;
            case 'start-session':
                await this.startSession();
                this.programViewOverride = false;
                await this.saveExecution({ active: true });
                this.render();
                window.scrollTo({ top: 0, behavior: 'instant' });
                break;
            case 'finish-session':
                await this.finishSession();
                break;
            case 'cancel-session':
                await this.cancelCurrentSession();
                break;
            case 'resume-session': {
                const context = this.currentContext();
                // Marqueur additif : une séance déjà enregistrée ne peut plus être « annulée » (son historique serait effacé).
                context.session.reopenedAt = Date.now();
                context.session.endedAt = null;
                context.session.updatedAt = Date.now();
                await saveSession(context.session);
                await this.acquireWakeLock();
                this.render();
                break;
            }
            case 'toggle-set':
                await this.toggleSet(actionElement.dataset.exercise ?? '', Number(actionElement.dataset.set));
                break;
            case 'move-exercise':
                await this.moveExercise(actionElement.dataset.exercise ?? '', actionElement.dataset.direction === 'up' ? -1 : 1);
                break;
            case 'start-cardio':
                await this.beginTimedExercise(actionElement.dataset.exercise ?? '', Number(actionElement.dataset.duration), actionElement.dataset.kind === 'recovery' ? 'recovery' : 'cardio');
                break;
            case 'finish-cardio':
                await this.stopTimedExercise(actionElement.dataset.exercise ?? '');
                break;
            case 'exec-show-program': {
                this.programViewOverride = true;
                this.render();
                const id = actionElement.dataset.exercise;
                const card = id ? this.root.querySelector(`[data-exercise-card="${CSS.escape(id)}"]`) : null;
                if (card) {
                    const details = card.querySelector('details');
                    if (details) details.open = true;
                    card.scrollIntoView({ block: 'start', behavior: 'instant' });
                } else window.scrollTo({ top: 0, behavior: 'instant' });
                break;
            }
            case 'exec-resume':
                this.programViewOverride = false;
                this.render();
                window.scrollTo({ top: 0, behavior: 'instant' });
                break;
            case 'exec-menu':
                this.execMenuOpen = true;
                this.render();
                break;
            case 'exec-menu-close':
                this.execMenuOpen = false;
                this.render();
                break;
            case 'exec-skip':
                this.execMenuOpen = false;
                await this.execSkipCurrentExercise();
                break;
            case 'exec-defer': {
                this.execMenuOpen = false;
                const { step } = this.executionContext();
                await this.deferCurrentExercise(step.exerciseId ?? '');
                break;
            }
            case 'exec-reorder':
                this.execMenuOpen = false;
                this.reorderOpen = true;
                this.render();
                break;
            case 'reorder-close':
                this.reorderOpen = false;
                this.render();
                break;
            case 'reorder-save-default':
                await this.saveDefaultOrder();
                break;
            case 'reorder-restore':
                await this.restoreProgramOrder();
                break;
            case 'exec-start-general-warmup': {
                // Le matériel choisi est noté AVEC l'échauffement de cette séance.
                const context = this.currentContext();
                const equipment = resolveWarmupEquipment(normalizeWarmupState(context.session.warmup).general, actionElement.dataset.equipment ?? this.snapshot.settings.warmupEquipment);
                await this.patchWarmup((w) => { w.general.equipment = equipment; });
                await this.startGenericTimer('general-warmup', WARMUP_EQUIPMENT[equipment]?.durationSec ?? GENERAL_WARMUP.durationSec, { equipment });
                break;
            }
            case 'warmup-equipment': {
                const equipment = actionElement.dataset.equipment;
                const context = this.currentContext();
                const general = normalizeWarmupState(context.session.warmup).general;
                if (!WARMUP_EQUIPMENT[equipment] || general.done || general.skipped || context.session.activeTimer?.kind === 'general-warmup')
                    break;
                await this.patchWarmup((w) => { w.general.equipment = equipment; });
                this.render();
                break;
            }
            case 'warmup-equipment-default': {
                const equipment = actionElement.dataset.equipment;
                if (!WARMUP_EQUIPMENT[equipment])
                    break;
                this.snapshot.settings.warmupEquipment = equipment;
                await saveSettings(this.snapshot.settings);
                this.render();
                this.showToast(`${WARMUP_EQUIPMENT[equipment].label} sera proposé en premier aux prochaines séances.`, 'success');
                break;
            }
            case 'exercise-view':
                this.exerciseSheet = { type: 'exercise', id: actionElement.dataset.exercise ?? '' };
                this.render();
                break;
            case 'activation-view':
                this.exerciseSheet = { type: 'activation', id: actionElement.dataset.step ?? '' };
                this.render();
                break;
            case 'exercise-sheet-close':
                this.exerciseSheet = null;
                this.render();
                break;
            case 'exercise-do-now':
                await this.doExerciseNow(actionElement.dataset.exercise ?? '');
                break;
            case 'exec-enter':
                // Entrer dans le mode guidé d'une séance déjà commencée, sans remettre le temps à zéro.
                this.programViewOverride = false;
                await this.saveExecution({ active: true });
                this.render();
                window.scrollTo({ top: 0, behavior: 'instant' });
                break;
            case 'reorder-end-timer': {
                const timer = this.timerOwner()?.activeTimer ?? null;
                if (!timer) {
                    this.render();
                    break;
                }
                if (!confirm(this.reorderBlockedMessage(timer) + ' Continuer ?'))
                    break;
                await this.resolveActiveTimer(true);
                this.reorderOpen = true;
                this.render();
                break;
            }
            case 'exec-skip-general-warmup':
                if (!confirm('Passer l’échauffement général ? Ce sera enregistré.'))
                    break;
                await this.patchWarmup((w) => { w.general.skipped = true; });
                this.render();
                break;
            case 'exec-validate-activation': {
                const key = actionElement.dataset.step ?? '';
                const rest = Number(actionElement.dataset.rest) || 0;
                await this.patchWarmup((w) => { w.activation[key] = { done: true, at: Date.now() }; });
                if (rest > 0)
                    await this.startGenericTimer('activation-rest', rest, {});
                else
                    this.render();
                break;
            }
            case 'exec-set-reference': {
                const input = document.getElementById('exec-reference-load');
                const value = Number(input?.value);
                if (!(value > 0)) {
                    this.showToast('Indique une charge de travail supérieure à 0.', 'error');
                    break;
                }
                const exId = actionElement.dataset.exercise ?? '';
                await this.patchWarmup((w) => {
                    w.ramps[exId] = { ...(w.ramps[exId] ?? {}), referenceLoadKg: value, done: w.ramps[exId]?.done ?? [] };
                });
                this.render();
                break;
            }
            case 'exec-start-ramps': {
                // Échauffement demandé depuis la série 1 : il se calcule sur la charge indiquée.
                const exId = actionElement.dataset.exercise ?? '';
                const context = this.currentContext();
                const log = context.session.exercises[exId];
                const champ = this.root.querySelector('.exec-work [data-exec-field="weightKg"]');
                const charge = Number(champ?.value) || Number(log?.sets?.[0]?.weightKg) || Number(log?.prescription?.loadKg) || 0;
                if (!(charge > 0)) {
                    this.showToast('Indique d’abord ta charge de travail dans « Charge », puis touche « Faire l’échauffement ».', 'info', 6000);
                    break;
                }
                this.persistForgeDraft();
                await this.patchWarmup((w) => {
                    w.ramps[exId] = { referenceLoadKg: charge, done: [], requested: true };
                });
                this.render();
                window.scrollTo({ top: 0, behavior: 'instant' });
                break;
            }
            case 'exec-skip-ramps': {
                const exId = actionElement.dataset.exercise ?? '';
                if (this.timer?.kind === 'ramp-rest')
                    await this.resolveActiveTimer(true);
                await this.patchWarmup((w) => {
                    w.ramps[exId] = { ...(w.ramps[exId] ?? {}), requested: false, skipped: true };
                });
                this.render();
                window.scrollTo({ top: 0, behavior: 'instant' });
                break;
            }
            case 'stale-finish': {
                await this.finishStaleSession(actionElement.dataset.session ?? '');
                break;
            }
            case 'stale-resume': {
                const stale = this.snapshot.sessions.find((item) => item.id === actionElement.dataset.session);
                if (!stale)
                    break;
                this.focusSession(stale);
                this.snapshot.settings.currentTab = 'training';
                await saveSettings(this.snapshot.settings);
                await this.ensureCurrentSession();
                const context = this.currentContext();
                if (context.session.id !== stale.id)
                    break; // jamais agir sur une autre séance que celle proposée
                context.session.updatedAt = Date.now();
                await this.restoreTimerFromSession();
                await this.saveExecution({ active: true });
                this.programViewOverride = false;
                this.render();
                window.scrollTo({ top: 0, behavior: 'instant' });
                break;
            }
            case 'exec-validate-ramp': {
                const exId = actionElement.dataset.exercise ?? '';
                const idx = Number(actionElement.dataset.index);
                const rest = Number(actionElement.dataset.rest) || 0;
                await this.patchWarmup((w) => {
                    const entry = w.ramps[exId] ?? { done: [] };
                    const done = Array.isArray(entry.done) ? [...entry.done] : [];
                    done[idx] = true;
                    w.ramps[exId] = { ...entry, done };
                });
                if (!(rest > 0) || !(await this.startGenericTimer('ramp-rest', rest, { exerciseId: exId })))
                    this.render();
                break;
            }
            case 'exec-validate-set':
                await this.execValidateSet(actionElement.dataset.exercise ?? '', Number(actionElement.dataset.set));
                break;
            case 'exec-start-cardio':
                await this.beginTimedExercise(actionElement.dataset.exercise ?? '', Number(actionElement.dataset.duration) || 600, 'cardio');
                break;
            case 'exec-start-recovery':
                await this.beginTimedExercise(actionElement.dataset.exercise ?? '', Number(actionElement.dataset.duration) || 2700, 'recovery');
                break;
            case 'exec-finish':
                await this.finishSession();
                break;
            case 'apply-next-load':
                await this.applyNextLoad(actionElement.dataset.exercise ?? '', Number(actionElement.dataset.set), Number(actionElement.dataset.load));
                break;
            case 'toggle-skip-exercise':
                await this.toggleSkipExercise(actionElement.dataset.exercise ?? '');
                break;
            case 'timer-minus': {
                // Garde-fou : aucune durée prescrite ne se raccourcit au bouton.
                if (!canShortenTimer(this.timer?.kind))
                    break;
                const delta = Number(actionElement.dataset.delta) || -15;
                await this.mutateTimer((t) => adjustTimerState(t, -Math.abs(delta)));
                break;
            }
            case 'timer-plus': {
                const delta = Number(actionElement.dataset.delta) || 15;
                await this.mutateTimer((t) => adjustTimerState(t, Math.abs(delta)));
                break;
            }
            case 'timer-pause':
                await this.mutateTimer((t) => (t.paused ? resumeTimer(t) : pauseTimer(t)));
                break;
            case 'timer-skip': {
                const kind = this.timer?.kind;
                if (kind === 'cardio' && !confirm('Arrêter le cardio avant la fin ? La durée réelle sera enregistrée et l’étape restera incomplète.'))
                    break;
                if (kind === 'recovery' && !confirm('Arrêter cette étape de récupération ?'))
                    break;
                if (kind === 'general-warmup' && !confirm('Passer le reste de l’échauffement ?'))
                    break;
                await this.resolveActiveTimer(true);
                break;
            }
            case 'apply-calorie-adjustment':
                await this.applyCalorieAdjustment();
                break;
            case 'delete-session':
                if (confirm('Supprimer définitivement cette séance ?')) {
                    const sessionId = actionElement.dataset.session ?? '';
                    await deleteSession(sessionId);
                    this.snapshot.sessions = this.snapshot.sessions.filter((session) => session.id !== sessionId);
                    this.render();
                }
                break;
            case 'export-data':
                this.exportData();
                break;
            case 'import-data':
                document.getElementById('import-file')?.click();
                break;
            case 'reset-data':
                await this.resetData();
                break;
            case 'install-app':
                await this.installApp();
                break;
            case 'reload-update':
                await this.applyServiceWorkerUpdate();
                break;
            default:
                break;
        }
    }
    async handleChange(event) {
        const target = event.target;
        if (target.id === 'import-file' && target instanceof HTMLInputElement && target.files?.[0]) {
            await this.importData(target.files[0]);
            return;
        }
        const readiness = target.dataset.readiness;
        if (readiness) {
            const context = this.currentContext();
            const value = parseNumber(target.value);
            if (readiness === 'sleepHours')
                context.session.readiness.sleepHours = value;
            else
                context.session.readiness[readiness] = Number(value ?? 0);
            context.session.updatedAt = Date.now();
            await saveSession(context.session);
            return;
        }
        const variantExerciseId = target.dataset.exerciseVariant;
        if (variantExerciseId) {
            await this.changeVariant(variantExerciseId, target.value);
            return;
        }
        const setField = target.dataset.setField;
        if (setField) {
            const row = target.closest('[data-set-row]');
            if (!row)
                return;
            this.updateSetField(row.dataset.exercise ?? '', Number(row.dataset.set), setField, target.value);
            await saveSession(this.currentContext().session);
            return;
        }
        const dailyField = target.dataset.dailyField;
        if (dailyField) {
            const log = this.dailyLog(isoDate());
            log[dailyField] = parseNumber(target.value);
            await saveDailyLog(log);
            this.render();
            return;
        }
        const dailyTextField = target.dataset.dailyTextField;
        if (dailyTextField) {
            const log = this.dailyLog(isoDate());
            log[dailyTextField] = target.value;
            await saveDailyLog(log);
            this.render();
            return;
        }
        const profileField = target.dataset.profileField;
        if (profileField) {
            await this.updateProfileField(profileField, target.value);
            return;
        }
        const settingField = target.dataset.settingField;
        if (settingField === 'warmupEquipment' && target instanceof HTMLSelectElement) {
            if (WARMUP_EQUIPMENT[target.value]) {
                this.snapshot.settings.warmupEquipment = target.value;
                await saveSettings(this.snapshot.settings);
                this.render();
            }
            return;
        }
        if (settingField && target instanceof HTMLInputElement) {
            this.snapshot.settings[settingField] = target.checked;
            await saveSettings(this.snapshot.settings);
            this.render();
        }
    }
    async handleInput(event) {
        const target = event.target;
        if (target instanceof Element && target.matches('input[data-exec-field]') && target.closest('[data-forge-step]')) {
            this.persistForgeDraft();
            return;
        }
        if (target.id === 'forge-tool-search') {
            const query = normalizeSearch(target.value);
            let visible = 0;
            this.root.querySelectorAll('[data-tool-search]').forEach(item => {
                item.hidden = !query.split(/\s+/).every(term => item.dataset.toolSearch.includes(term));
                if (!item.hidden) visible++;
            });
            this.root.querySelectorAll('.f-tool-group').forEach(group => { group.hidden = !group.querySelector('[data-tool-search]:not([hidden])'); });
            const empty = document.getElementById('forge-no-results');
            if (empty) empty.hidden = visible > 0;
            return;
        }
        if (target.dataset.sessionNotes !== undefined) {
            const context = this.currentContext();
            context.session.notes = target.value;
            context.session.updatedAt = Date.now();
            this.scheduleSnapshotSave();
        }
        if (target.dataset.dailyNotes) {
            const log = this.dailyLog(target.dataset.dailyNotes);
            log.notes = target.value;
            this.scheduleSnapshotSave();
        }
    }
    scheduleSnapshotSave() {
        if (this.saveDebounce !== null)
            window.clearTimeout(this.saveDebounce);
        this.saveDebounce = window.setTimeout(() => {
            void saveSnapshot(this.snapshot);
            this.saveDebounce = null;
        }, 500);
    }
    async startSession() {
        const context = this.currentContext();
        context.session.startedAt = Date.now();
        context.session.endedAt = null;
        context.session.updatedAt = Date.now();
        await saveSession(context.session);
        await this.acquireWakeLock();
        this.render();
    }
    async mutateTimer(mutator) {
        // Les boutons de l'overlay agissent sur la séance propriétaire du
        // chrono, pas sur le jour affiché.
        const owner = this.timerOwner();
        if (!owner?.activeTimer)
            return;
        const next = mutator(owner.activeTimer);
        owner.activeTimer = next;
        this.timer = next;
        owner.updatedAt = Date.now();
        await saveSession(owner);
        this.render();
    }
    /**
     * Après un reload : restaure le timer depuis la session.
     * Un timer expiré pendant que l'app était fermée est résolu ICI, avec son
     * effet métier complet. On ne le marque jamais « traité » d'abord : c'est
     * précisément ce qui faisait perdre l'échauffement, le cardio ou la récup.
     */
    async restoreTimerFromSession() {
        const ctx = this.currentContext();
        const timer = ctx.session.activeTimer;
        if (!timer) {
            this.timer = null;
            return;
        }
        this.timer = timer;
        if (timerExpired(timer))
            await this.resolveActiveTimer(true);
    }
    async beginTimedExercise(exerciseId, durationSec, kind = 'cardio') {
        return this.startGenericTimer(kind, Math.max(30, durationSec || 600), { exerciseId });
    }
    /**
     * Arrête un exercice chronométré. Sans chrono en cours il n'y a RIEN à
     * arrêter : un cardio ou une récupération ne se valide jamais à la main,
     * seule la durée réellement écoulée peut le rendre accompli.
     */
    async stopTimedExercise(exerciseId) {
        const timer = this.timerOwner()?.activeTimer ?? null;
        const request = timedStopRequest(timer, exerciseId);
        if (request.action === 'refuse') {
            this.showToast('Démarre le chrono : un exercice chronométré ne se valide pas à la main.', 'info', 5000);
            return;
        }
        const isRecovery = request.kind === 'recovery';
        if (!confirm(isRecovery ? 'Arrêter cette étape de récupération ?' : 'Arrêter le cardio avant la fin ? La durée réelle sera enregistrée et l’étape restera incomplète.'))
            return;
        await this.resolveActiveTimer(true);
    }
    /**
     * Crée le chrono. DERNIÈRE LIGNE DE DÉFENSE : jamais deux chronos, quoi
     * qu'il arrive en amont (double tap, bouton mal rendu, deux handlers).
     * @returns {Promise<boolean>} true seulement si un chrono a été créé.
     */
    async startGenericTimer(kind, seconds, context = {}) {
        // Le repos avant l'exercice suivant n'enregistre rien : démarrer un autre chrono de CETTE séance le clôt.
        const enCours = this.timerOwner()?.activeTimer ?? null;
        if (enCours?.kind === 'transition' && kind !== 'transition' && (enCours.context?.sessionId ?? this.currentContext().session.id) === this.currentContext().session.id)
            await this.resolveActiveTimer(true);
        const decision = startTimerDecision(this.currentContext().session, this.timer, Date.now());
        if (decision.action === 'resolve-first')
            await this.resolveActiveTimer(true);
        else if (decision.action === 'refuse') {
            this.showToast('Un chrono est déjà en cours.', 'info');
            return false;
        }
        const ctx = this.currentContext();
        if (!ctx.session.startedAt) {
            ctx.session.startedAt = Date.now();
            ctx.session.endedAt = null;
            await this.acquireWakeLock();
        }
        // Le chrono porte l'identité de SA séance : un changement de jour ne
        // déplace pas la propriété.
        const timer = createTimer(kind, seconds, { ...context, sessionId: ctx.session.id });
        ctx.session.activeTimer = timer;
        this.timer = timer;
        ctx.session.updatedAt = Date.now();
        await saveSession(ctx.session);
        this.render();
        return true;
    }
    /**
     * Résout le timer actif : effet métier PUIS fermeture, en une seule écriture.
     * Verrou : les résolutions se mettent en file, jamais en parallèle. La
     * deuxième ne trouve plus de timer actif — d'où le « exactly once ».
     */
    async resolveActiveTimer(force = false) {
        return this.timerQueue.run(() => this.applyActiveTimerResolution(force));
    }
    /**
     * ⚠ Remplace l'objet session dans le snapshot : ne conserve aucune référence
     * prise avant l'appel (session, log, set) — reprends-les après.
     */
    /** La séance à qui appartient le chrono, jamais celle affichée. */
    timerOwner() {
        return timerOwnerSession(this.snapshot.sessions, this.timer, this.currentContext().session);
    }
    async applyActiveTimerResolution(force) {
        // Le chrono appartient à SA séance : on l'applique là où il a été créé,
        // même si l'écran affiche un autre jour.
        const owner = this.timerOwner();
        const timer = owner?.activeTimer ?? null;
        if (!timer) {
            // Déjà résolu : on lâche la référence en mémoire, sinon tick()
            // rejoue la fin du minuteur toutes les 250 ms.
            if (this.timer) {
                this.timer = null;
                this.render(); // retire l'overlay devenu orphelin
            }
            return;
        }
        if (!force && !timerExpired(timer))
            return;
        const result = applyTimerOutcome(owner, timer, Date.now());
        this.replaceSession(result.session);
        this.timer = null;
        await saveSession(result.session);
        if (result.message)
            this.showToast(result.message, 'info', 5000);
        this.render();
    }
    replaceSession(session) {
        const index = this.snapshot.sessions.findIndex((item) => item.id === session.id);
        if (index >= 0)
            this.snapshot.sessions[index] = session;
        else
            this.snapshot.sessions.push(session);
    }
    async execValidateSet(exerciseId, setIndex) {
        const ctx = this.currentContext();
        const exercise = findExercise(exerciseId);
        const log = ctx.session.exercises[exerciseId];
        const set = log?.sets?.[setIndex];
        if (!exercise || !log || !set)
            return;
        const root = document.querySelector('.execution');
        const readField = (name) => root?.querySelector(`[data-exec-field="${name}"]`);
        const weightInput = readField('weightKg');
        const repsInput = readField('reps');
        const chosen = (group) => root?.querySelector(`[data-exec-group="${group}"] .chip-choice.selected`)?.dataset.value;
        if (weightInput && weightInput.value !== '')
            set.weightKg = Number(weightInput.value);
        if (repsInput && repsInput.value !== '')
            set.reps = Number(repsInput.value);
        const rir = chosen('rir');
        if (rir === undefined) {
            this.showToast('Indique ton RIR réel : toute la progression en dépend.', 'error');
            return;
        }
        set.rir = Number(rir);
        const technique = chosen('technique');
        if (technique !== undefined)
            set.technique = technique;
        const pain = chosen('pain');
        if (pain !== undefined)
            set.pain = Number(pain);
        await saveSession(ctx.session);
        await this.toggleSet(exerciseId, setIndex);
    }
    async execSkipCurrentExercise() {
        const { step } = this.executionContext();
        if (!step.exerciseId)
            return;
        if (!confirm('Cette séance restera INCOMPLÈTE. Continuer ?'))
            return;
        await this.toggleSkipExercise(step.exerciseId);
    }
    async finishSession() {
        // Un timer encore actif est résolu selon son kind (un cardio trop court
        // reste incomplet, un échauffement interrompu n'est pas validé).
        await this.resolveActiveTimer(true);
        const context = this.currentContext();
        if (!context.session.startedAt)
            context.session.startedAt = Date.now();
        const finishCount = this.activeSetCount(context.session, context.day);
        const outcome = finishStatus(finishCount);
        // closeSession garantit : plus aucun timer, mode exécution désactivé.
        const closed = closeSession({ ...context.session, execution: this.execState(context.session) }, { now: Date.now(), status: outcome.status });
        this.replaceSession(closed);
        this.timer = null;
        this.programViewOverride = false;
        await saveSession(closed);
        await this.releaseWakeLock();
        this.showToast(outcome.message, outcome.status === 'COMPLETE' ? 'success' : 'info', 6000);
        this.render();
    }
    /**
     * Annuler la séance affichée (commencée, pas terminée) : elle redevient « au
     * programme ». Confirmation qui détaille ce qui serait effacé ; rien n'est
     * enregistré dans l'historique ; variantes, ordre, notes et état du jour restent.
     */
    async cancelCurrentSession() {
        const context = this.currentContext();
        const session = context.session;
        if (!session.startedAt || session.endedAt) {
            this.showToast('Cette séance n’est pas en cours : rien à annuler.', 'info');
            return;
        }
        if (!canCancelSession(session)) {
            this.showToast('Cette séance a déjà été enregistrée puis rouverte : touche « Terminer » pour la refermer, ses séries restent dans l’historique.', 'info', 7000);
            return;
        }
        const dateLabel = formatDateFr(context.date, { weekday: 'long', day: 'numeric', month: 'long' });
        const chronoLabel = session.activeTimer ? `${session.activeTimer.label ?? 'chrono'}, ${formatClock(elapsedSeconds(session.activeTimer, Date.now()))} déjà faites${session.activeTimer.paused ? ', en pause' : ''}` : '';
        // Séances futures du même jour pré-remplies à partir de ces séries : repérées AVANT
        // d'annuler (l'historique contient encore la séance) et annoncées dans la confirmation.
        const aRecalculer = this.futureSeedsFrom(session, context.day);
        const recalcLabel = aRecalculer.map(({ item }) => `${context.day.name} du ${formatDateFr(item.date, { weekday: 'long', day: 'numeric', month: 'long' })}`).join(', ');
        if (!confirm(cancelSessionMessage(cancelSessionSummary(session), context.day.name, { dateLabel, timerLabel: chronoLabel, recalcLabel })))
            return;
        // Seul le chrono EN MÉMOIRE de cette séance est abandonné ; celui d'une autre séance continue.
        const ownTimer = !!this.timer && (this.timer.context?.sessionId ?? session.id) === session.id;
        const cancelled = cancelSession(session, { now: Date.now(), createSet: makeSet });
        this.replaceSession(cancelled);
        if (ownTimer)
            this.timer = null;
        this.execMenuOpen = false;
        this.reorderOpen = false;
        this.exerciseSheet = null;
        this.programViewOverride = false;
        // Semaine du programme recalculée (l'annulation retire toute semaine figée), puis charges prescrites
        // remises comme pour une séance jamais démarrée.
        const semaine = sessionWeekIndex(cancelled, this.snapshot.profile);
        this.syncSession(cancelled, context.day, semaine);
        this.seedSessionPrescriptions(cancelled, context.day, context.date, semaine);
        await saveSession(cancelled);
        for (const { item, exercices } of aRecalculer) {
            for (const { id, indices } of exercices)
                this.reseedFutureSets(item, context.day, id, indices);
            item.updatedAt = Date.now();
            await saveSession(item);
        }
        // Saisies non validées : effacées du stockage ET de la mémoire, et le formulaire
        // encore affiché n'est pas recapturé par le rendu suivant.
        removeSessionDrafts(this.draftStorage(), session.id);
        this.root.querySelectorAll('[data-forge-step]').forEach((el) => el.removeAttribute('data-forge-step'));
        if (this.forgeDraft?.key?.startsWith(`${session.id}:`))
            this.forgeDraft = null;
        for (const key of [...this.forgeDetails.keys()])
            if (key.startsWith(`feedback:${session.id}:`))
                this.forgeDetails.delete(key);
        const autre = this.snapshot.sessions.find((item) => item.id !== session.id && item.execution?.active && !item.endedAt);
        if (!autre)
            await this.releaseWakeLock();
        this.render();
        this.showToast(autre
            ? `Séance ${context.day.name} annulée. Attention : ${findDay(autre.dayId)?.name ?? 'une autre séance'} du ${formatDateFr(autre.date, { weekday: 'long', day: 'numeric', month: 'long' })} est encore en cours.`
            : `Séance ${context.day.name} annulée : elle redevient au programme.`, autre ? 'info' : 'success', autre ? 8000 : 5000);
    }
    unmarkSeededSet(log, setIndex) {
        if (log)
            log.autoSeed = withoutSeedMark(log.autoSeed, setIndex);
    }
    /** Séances futures du même jour pré-remplies à partir de la séance `session` (avant annulation). */
    futureSeedsFrom(session, day) {
        const recoveryAlert = analyzeRecovery(this.snapshot.dailyLogs).alert;
        return this.snapshot.sessions
            .filter((item) => item.id !== session.id && item.dayId === session.dayId && item.date > session.date && !item.startedAt)
            .map((item) => {
            const exercices = [];
            let anciens = false;
            for (const exercise of day.exercises) {
                const log = item.exercises?.[exercise.id];
                if (!log)
                    continue;
                const marquees = seededSetIndices(log, session.id);
                if (marquees.length) {
                    exercices.push({ id: exercise.id, indices: marquees });
                    continue;
                }
                if (log.autoSeed)
                    continue;
                const variant = exercise.variants.find((v) => v.id === log.variantId) ?? exercise.variants[0];
                const plan = getExercisePlan(exercise, item.weekIndex);
                const avec = this.exerciseHistory(exercise.id, log.variantId, item.date, item.id);
                if (!avec.some((entry) => entry.sessionId === session.id))
                    continue;
                const sans = avec.filter((entry) => entry.sessionId !== session.id);
                const indices = legacySeededSetIndices(log,
                    prescriptionFromHistory(avec, plan, exercise, variant.incrementKg, recoveryAlert).loadKg,
                    prescriptionFromHistory(sans, plan, exercise, variant.incrementKg, recoveryAlert).loadKg);
                if (indices.length) {
                    exercices.push({ id: exercise.id, indices });
                    anciens = true;
                }
            }
            return { item, exercices, anciens };
        })
            .filter((entry) => entry.exercices.length);
    }
    /** Recalcule, SANS la séance annulée, uniquement les séries repérées. */
    reseedFutureSets(item, day, exerciseId, indices) {
        const exercise = day.exercises.find((ex) => ex.id === exerciseId);
        const log = item.exercises?.[exerciseId];
        if (!exercise || !log)
            return;
        const variant = exercise.variants.find((v) => v.id === log.variantId) ?? exercise.variants[0];
        const plan = getExercisePlan(exercise, item.weekIndex);
        const history = this.exerciseHistory(exerciseId, log.variantId, item.date, item.id);
        const prescription = prescriptionFromHistory(history, plan, exercise, variant.incrementKg, analyzeRecovery(this.snapshot.dailyLogs).alert);
        indices.forEach((index) => { if (log.sets[index]) log.sets[index].weightKg = prescription.loadKg > 0 ? prescription.loadKg : null; });
        log.autoSeed = prescription.loadKg > 0
            ? { loadKg: prescription.loadKg, sources: history.map((entry) => entry.sessionId).filter(Boolean), sets: [...indices] }
            : { loadKg: 0, sources: [], sets: [] };
    }
    readSetRow(exerciseId, setIndex) {
        const row = this.root.querySelector(`[data-set-row][data-exercise="${CSS.escape(exerciseId)}"][data-set="${setIndex}"]`);
        if (!row)
            return;
        row.querySelectorAll('[data-set-field]').forEach((field) => {
            this.updateSetField(exerciseId, setIndex, field.dataset.setField, field.value, { explicit: false });
        });
    }
    /** `explicit` : saisie de l'utilisateur dans le champ ; false quand l'app relit les valeurs affichées (validation). */
    updateSetField(exerciseId, setIndex, field, rawValue, { explicit = true } = {}) {
        const context = this.currentContext();
        const set = context.session.exercises[exerciseId]?.sets[setIndex];
        if (!set)
            return;
        if (field === 'weightKg') {
            const value = parseNumber(rawValue);
            // Charge choisie par l'utilisateur (même valeur retapée) : plus jamais recalculée.
            // Une simple relecture de la valeur affichée ne compte pas comme un choix.
            if (explicit || value !== set.weightKg)
                this.unmarkSeededSet(context.session.exercises[exerciseId], setIndex);
            set.weightKg = value;
        }
        else if (field === 'reps')
            set.reps = parseInteger(rawValue);
        else if (field === 'rir')
            set.rir = parseNumber(rawValue);
        else if (field === 'pain')
            set.pain = rawValue === '' ? null : Number(parseInteger(rawValue) ?? 0);
        else if (field === 'technique')
            set.technique = rawValue === '' ? null : rawValue === 'degraded' ? 'degraded' : 'good';
        context.session.updatedAt = Date.now();
    }
    async toggleSet(exerciseId, setIndex) {
        let context = this.currentContext();
        this.readSetRow(exerciseId, setIndex);
        const exercise = context.day.exercises.find((item) => item.id === exerciseId);
        let log = context.session.exercises[exerciseId];
        let set = log?.sets[setIndex];
        if (!exercise || !log || !set)
            return;
        if (set.done) {
            // Dévalider efface la série (et ses deux côtés) : toujours sur confirmation explicite.
            const cotes = set.sides?.left?.done && set.sides?.right?.done
                ? ` (gauche ${formatKg(set.sides.left.weightKg)} kg × ${set.sides.left.reps}, droite ${formatKg(set.sides.right.weightKg)} kg × ${set.sides.right.reps})`
                : ` (${formatKg(set.weightKg)} kg × ${set.reps})`;
            if (!confirm(`Annuler la validation de la série ${setIndex + 1}${cotes} ? Elle redeviendra à faire.`))
                return;
            set.done = false;
            set.completedAt = null;
            set.restActualSec = null;
            set.side = 'left';
            set.sides = undefined;
            // La charge de cette série a été réellement soulevée : plus jamais recalculée automatiquement.
            this.unmarkSeededSet(log, setIndex);
            this.unfreezeWeekIfNoWork(context.session);
            context.session.updatedAt = Date.now();
            await saveSession(context.session);
            this.render();
            return;
        }
        const planForCheck = getExercisePlan(exercise, context.weekIndex);
        const variantForCheck = exercise.variants.find((item) => item.id === log.variantId) ?? exercise.variants[0];
        const loadMode = variantForCheck?.loadMode ?? 'external';
        const needsExternalLoad = loadMode === 'external';
        const amountLabel = planForCheck.metric === 'seconds' ? 'la durée en secondes' : 'les répétitions';
        if (!(Number(set.reps) > 0)) {
            this.showToast(`Renseigne ${amountLabel} pour valider la série.`, 'error');
            return;
        }
        if (needsExternalLoad && !(Number(set.weightKg) > 0)) {
            this.showToast('Renseigne la charge pour valider la série.', 'error');
            return;
        }
        if (!needsExternalLoad && set.weightKg === null)
            set.weightKg = 0;
        if (this.timer) {
            await this.resolveActiveTimer(true);
            // La résolution a réécrit la session : reprendre des références vivantes.
            context = this.currentContext();
            log = context.session.exercises[exerciseId];
            set = log?.sets[setIndex];
            if (!log || !set)
                return;
        }
        if (!context.session.startedAt) {
            context.session.startedAt = Date.now();
            context.session.endedAt = null;
            await this.acquireWakeLock();
        }
        const planSide = getExercisePlan(exercise, context.weekIndex);
        // --- Unilatéral : gauche -> changement -> droite -> repos.
        // Chaque côté conserve SES valeurs ; la série globale reste UNE série.
        if (planSide.perSide) {
            const side = currentSide(set);
            set.sides = set.sides ?? {};
            set.sides[side] = {
                done: true,
                reps: Number(set.reps) || null,
                rir: set.rir ?? null,
                technique: set.technique ?? 'good',
                pain: Number(set.pain) || 0,
                weightKg: Number(set.weightKg) || 0,
                completedAt: Date.now(),
            };
            if (side === 'left') {
                set.side = 'right';
                // Côté droit : charge et répétitions reprises du gauche, mais ressenti et douleur à indiquer pour CE côté.
                set.rir = null;
                set.pain = null;
                context.session.updatedAt = Date.now();
                await saveSession(context.session);
                removeDraft(this.draftStorage(), draftKey({ sessionId: context.session.id, exerciseId: exercise.id, variantId: log.variantId, setIndex, side: 'left' }));
                await this.startGenericTimer('side-switch', Math.max(5, planSide.sideSwitchSec || 15), { exerciseId: exercise.id, setIndex });
                this.showToast('Côté gauche validé — passe au côté droit.', 'info');
                return;
            }
            // Côté droit : la série devient réellement faite, valeurs agrégées.
            const merged = aggregateSides(set);
            if (merged) {
                set.reps = merged.reps;
                set.rir = merged.rir;
                set.technique = merged.technique;
                set.pain = merged.pain;
            }
        }
        set.done = true;
        set.completedAt = Date.now();
        this.unmarkSeededSet(log, setIndex);
        context.session.updatedAt = Date.now();
        removeDraft(this.draftStorage(), draftKey({ sessionId: context.session.id, exerciseId: exercise.id, variantId: log.variantId, setIndex, side: planSide.perSide ? 'right' : null }));
        const plan = getExercisePlan(exercise, context.weekIndex);
        const variant = exercise.variants.find((item) => item.id === log.variantId) ?? exercise.variants[0];
        const suggestion = suggestNextSet(set, plan, exercise, variant.incrementKg);
        const nextSet = log.sets[setIndex + 1];
        if (nextSet && !nextSet.done && suggestion.loadKg > 0)
            nextSet.weightKg = suggestion.loadKg;
        await saveSession(context.session);
        if (Number(set.pain) >= 4)
            this.showToast('Douleur ≥ 4/10 : arrête cet exercice et choisis une variante indolore.', 'error', 6000);
        else if (set.technique === 'degraded')
            this.showToast('Technique dégradée : aucune hausse de charge ne sera autorisée.', 'info', 5000);
        const avecCharge = (variant?.loadMode ?? 'external') === 'external';
        const repsHorsFourchette = avecCharge && plan.metric !== 'seconds' && Number(set.reps) > plan.repMax + 2;
        const derniereSerie = setIndex >= plan.sets - 1;
        if (repsHorsFourchette && Number(set.pain) < 4 && set.technique !== 'degraded')
            this.showToast(`${set.reps} répétitions pour ${plan.repMin}–${plan.repMax} prévues : ${derniereSerie ? 'la charge sera augmentée la prochaine fois' : 'augmente la charge à la prochaine série'}.`, 'info', 6000);
        // Repos entre séries, ou repos avant l'exercice suivant après la dernière série.
        const decision = this.restAfterSet(exercise, setIndex, context);
        const exerciceTermine = log.sets.slice(0, plan.sets).every((item) => item.done);
        if (this.snapshot.settings.autoStartTimer && decision.kind) {
            await this.startGenericTimer(decision.kind, decision.durationSec, decision.kind === 'transition'
                ? { exerciseId: exercise.id, setIndex, nextExerciseId: decision.nextExerciseId, nextName: decision.nextName }
                : { exerciseId: exercise.id, setIndex });
        }
        if (exerciceTermine && !repsHorsFourchette && Number(set.pain) < 4 && set.technique !== 'degraded')
            this.showToast(decision.nextName ? `${exercise.name} terminé. Ensuite : ${decision.nextName}.` : `${exercise.name} terminé.`, 'success', 5000);
        this.render();
        // En mode guidé, le nouvel exercice s'affiche depuis le haut (titre visible).
        if (exerciceTermine && this.shouldRenderExecution())
            window.scrollTo({ top: 0, behavior: 'instant' });
    }
    /** Décision pure (engine) alimentée par l'ordre réel de la séance. */
    restAfterSet(exercise, setIndex, context) {
        const plan = getExercisePlan(exercise, context.weekIndex);
        const ordered = this.orderedExercises(context.day, context.session);
        const group = exercise.superset ? ordered.filter((item) => item.superset === exercise.superset) : [];
        const next = ordered.find((item) => item.id !== exercise.id && isExercisePending(item, context.session.exercises[item.id], getExercisePlan(item, context.weekIndex)));
        return restAfterSetDecision({
            plan, setIndex,
            inSuperset: !!exercise.superset,
            isLastOfSuperset: !exercise.superset || group.at(-1)?.id === exercise.id,
            maxSupersetSets: group.length ? Math.max(...group.map((item) => getExercisePlan(item, context.weekIndex).sets)) : null,
            nextExercise: next ? { id: next.id, name: next.name } : null,
        });
    }
    async applyNextLoad(exerciseId, setIndex, loadKg) {
        const context = this.currentContext();
        const set = context.session.exercises[exerciseId]?.sets[setIndex];
        if (!set)
            return;
        if (set.weightKg !== loadKg)
            this.unmarkSeededSet(context.session.exercises[exerciseId], setIndex); // charge choisie par l'utilisateur
        set.weightKg = loadKg;
        context.session.updatedAt = Date.now();
        await saveSession(context.session);
        this.render();
    }
    async changeVariant(exerciseId, variantId) {
        const context = this.currentContext();
        const exercise = context.day.exercises.find((item) => item.id === exerciseId);
        const log = context.session.exercises[exerciseId];
        if (!exercise || !log || !exercise.variants.some((variant) => variant.id === variantId))
            return;
        if (log.sets.some((set) => set.done) && !confirm('Changer de variante efface les séries de cet exercice pour éviter de mélanger les machines. Continuer ?')) {
            this.render();
            return;
        }
        const plan = getExercisePlan(exercise, context.weekIndex);
        context.session.exercises[exerciseId] = resetExerciseLogForVariant(log, variantId, plan.sets, makeSet);
        // Une montée en charge calculée pour une autre machine ne doit JAMAIS
        // être réutilisée : incréments et charges diffèrent.
        context.session.warmup = clearExerciseRamps(context.session.warmup, exerciseId);
        this.unfreezeWeekIfNoWork(context.session);
        this.seedSessionPrescriptions(context.session, context.day, context.date, context.session.weekIndex);
        context.session.updatedAt = Date.now();
        await saveSession(context.session);
        this.render();
    }
    // ---------------------------------------------------------------------
    // Glisser-déposer tactile. Aucune bibliothèque : pointer events + DOM.
    // ---------------------------------------------------------------------
    onDragStart(event) {
        const handle = event.target instanceof Element ? event.target.closest('[data-drag-handle]') : null;
        if (!handle || this.drag)
            return;
        const item = handle.closest('[data-drag-item]');
        const list = handle.closest('[data-drag-list]');
        if (!item || !list || item.dataset.dragLocked === 'true')
            return;
        if (!this.reorderAllowed()) {
            this.refuseReorder();
            return;
        }
        event.preventDefault();
        // Replier la liste change la hauteur de la page : on recale le scroll
        // pour que la carte saisie reste exactement sous le doigt.
        const avant = item.getBoundingClientRect().top;
        list.classList.add('is-reordering');
        item.classList.add('is-dragging');
        const apres = item.getBoundingClientRect().top;
        if (apres !== avant)
            window.scrollBy(0, apres - avant);
        this.drag = {
            list, item, handle,
            // Distance entre le haut de la carte et le doigt : elle ne change
            // jamais, c'est ce qui garde la carte exactement sous le doigt.
            grabOffset: event.clientY - item.getBoundingClientRect().top,
            onMove: (moveEvent) => this.onDragMove(moveEvent),
            onEnd: () => void this.onDragEnd(),
        };
        try {
            handle.setPointerCapture(event.pointerId);
        }
        catch { /* capture non supportée : le drag fonctionne quand même */ }
        window.addEventListener('pointermove', this.drag.onMove, { passive: false });
        window.addEventListener('pointerup', this.drag.onEnd);
        window.addEventListener('pointercancel', this.drag.onEnd);
    }
    /** Position de la carte : toujours collée au doigt, quel que soit son emplacement. */
    followFinger(clientY) {
        const { item, grabOffset } = this.drag;
        item.style.transform = 'translateY(0px)';
        const slotTop = item.getBoundingClientRect().top; // emplacement réel dans la liste
        const offset = clientY - grabOffset - slotTop;
        item.style.transform = `translateY(${offset}px)`;
        return { top: slotTop + offset, height: item.getBoundingClientRect().height };
    }
    onDragMove(event) {
        const drag = this.drag;
        if (!drag)
            return;
        event.preventDefault();
        const visuel = this.followFinger(event.clientY);
        const middle = visuel.top + visuel.height / 2;
        const siblings = [...drag.list.querySelectorAll('[data-drag-item]')]
            .filter((element) => element !== drag.item && element.dataset.dragLocked !== 'true');
        for (const sibling of siblings) {
            const box = sibling.getBoundingClientRect();
            const center = box.top + box.height / 2;
            const isAfter = !!(drag.item.compareDocumentPosition(sibling) & Node.DOCUMENT_POSITION_FOLLOWING);
            if (isAfter && middle > center) {
                drag.list.insertBefore(drag.item, sibling.nextSibling);
                this.followFinger(event.clientY);
                break;
            }
            if (!isAfter && middle < center) {
                drag.list.insertBefore(drag.item, sibling);
                this.followFinger(event.clientY);
                break;
            }
        }
        // Liste plus haute que l'écran : on suit le doigt près des bords.
        const marge = 90;
        if (event.clientY < marge)
            window.scrollBy(0, -14);
        else if (event.clientY > window.innerHeight - marge)
            window.scrollBy(0, 14);
    }
    async onDragEnd() {
        const drag = this.drag;
        if (!drag)
            return;
        this.drag = null;
        window.removeEventListener('pointermove', drag.onMove);
        window.removeEventListener('pointerup', drag.onEnd);
        window.removeEventListener('pointercancel', drag.onEnd);
        drag.item.style.transform = '';
        drag.item.classList.remove('is-dragging');
        drag.list.classList.remove('is-reordering');
        if (!drag.list.isConnected) {
            this.render();
            return;
        }
        const order = [...drag.list.querySelectorAll('[data-drag-item]')].map((element) => element.dataset.dragItem);
        const context = this.currentContext();
        if (order.join('|') === (context.session.exerciseOrder ?? []).join('|')) {
            this.render();
            return;
        }
        await this.applySessionOrder(order, 'Ordre modifié pour cette séance.');
    }
    // ---------------------------------------------------------------------
    // Réorganisation des exercices (l'ordre dépend des machines libres).
    // ---------------------------------------------------------------------
    /** Réorganiser est interdit pendant un chrono de repos ou de changement de côté. */
    reorderAllowed() {
        return canReorder(this.timerOwner()?.activeTimer ?? this.timer ?? null);
    }
    /** Fiche d'exercice ou d'activation : consultation pure, n'écrit rien. */
    renderExerciseSheetOverlay() {
        const sheet = this.exerciseSheet;
        if (!sheet)
            return '';
        const context = this.currentContext();
        const tempoHelp = 'secondes de descente – pause en bas – montée – pause en haut';
        if (sheet.type === 'activation') {
            const step = activationSteps(context.day).find((item) => item.key === sheet.id);
            if (!step)
                return '';
            return renderExerciseSheet({
                eyebrow: 'ACTIVATION · ne compte pas comme série', title: step.name,
                subtitle: step.side ? (step.side === 'left' ? 'Côté gauche' : 'Côté droit') : '',
                planLines: [step.detail, step.tempo ? `tempo ${step.tempo}` : ''].filter(Boolean),
                cue: 'Préparation légère avant les séries : mouvement contrôlé, sans chercher la fatigue.',
                tempo: step.tempo, tempoHelp: step.tempo ? tempoHelp : '',
                demo: demoSearch({ name: step.name, context: 'échauffement activation' }), doNow: false,
            });
        }
        const exercise = context.day.exercises.find((item) => item.id === sheet.id) ?? findExercise(sheet.id);
        if (!exercise)
            return '';
        const plan = getExercisePlan(exercise, context.weekIndex);
        const log = context.session.exercises[exercise.id];
        const variant = exercise.variants?.find((item) => item.id === log?.variantId) ?? exercise.variants?.[0];
        const pending = isExercisePending(exercise, log, plan);
        const doneSets = (log?.sets ?? []).slice(0, plan.sets).filter((set) => set.done).length;
        let lastExposure = null;
        if (log && exercise.kind !== 'cardio') {
            const lastSet = this.exerciseHistory(exercise.id, log.variantId, context.date, context.session.id).at(-1)?.sets?.filter((x) => x.done).at(-1);
            if (lastSet)
                lastExposure = `${formatKg(lastSet.weightKg)} kg × ${lastSet.reps} — RIR ${lastSet.rir ?? '?'} (${variant?.label ?? 'même variante'})`;
        }
        const planLines = exercise.kind === 'cardio'
            ? [formatSeconds(exercise.durationSec ?? plan.repMin), exercise.inclinePct ? `inclinaison ${exercise.inclinePct} %` : '', exercise.speedKmh ? `vitesse ${exercise.speedKmh}${/[0-9]/.test(String(exercise.speedKmh)) ? ' km/h' : ''}` : ''].filter(Boolean)
            : [`${plan.sets} × ${plan.metric === 'seconds' ? `${formatSeconds(plan.repMin)}–${formatSeconds(plan.repMax)}` : `${plan.repMin}–${plan.repMax} reps`}`, `RIR cible ${plan.targetRir}`, `repos ${formatClock(plan.restSec)}`, plan.perSide ? 'gauche puis droite' : ''].filter(Boolean);
        const status = log?.skipped ? 'Passé (réactivable dans les détails de la carte)'
            : exercise.kind === 'cardio' ? (pending ? 'Cardio de fin de séance' : 'Fait')
                : !pending ? `Terminé · ${doneSets}/${plan.sets} séries` : doneSets ? `En cours · ${doneSets}/${plan.sets} séries faites` : `À faire · 0/${plan.sets} séries`;
        return renderExerciseSheet({
            eyebrow: exercise.kind === 'cardio' ? 'FICHE CARDIO' : 'FICHE EXERCICE',
            title: exercise.name,
            subtitle: [variantDisplay(variant), variant?.incrementKg ? `pas de ${formatKg(variant.incrementKg)} kg` : ''].filter(Boolean).join(' · '),
            status, planLines, cue: exercise.coachingCue ?? '', tempo: plan.tempo, tempoHelp: plan.tempo ? tempoHelp : '', lastExposure,
            demo: demoSearch({ name: exercise.name, variantLabel: variant?.label ?? '' }),
            doNow: pending && !log?.skipped && exercise.kind !== 'cardio' && !context.session.endedAt,
            exerciseId: exercise.id,
        });
    }
    /**
     * « Faire maintenant » : l'exercice choisi devient le prochain à faire.
     * Seul l'ordre de la séance du jour change : aucune série n'est touchée,
     * aucun exercice n'est passé, la variante reste la même. Un chrono n'est
     * jamais réaffecté : il est au besoin arrêté, après confirmation explicite.
     */
    async doExerciseNow(exerciseId) {
        const context = this.currentContext();
        const exercise = context.day.exercises.find((item) => item.id === exerciseId);
        if (!exercise)
            return;
        const resolvePlan = (ex) => getExercisePlan(ex, context.weekIndex);
        const log = context.session.exercises[exerciseId];
        if (context.session.endedAt) {
            this.showToast('Cette séance est terminée : touche « Reprendre » pour la rouvrir.', 'info', 5000);
            return;
        }
        if (log?.skipped) {
            this.showToast(`${exercise.name} est passé : réactive-le d’abord.`, 'info', 5000);
            return;
        }
        if (!isExercisePending(exercise, log, resolvePlan(exercise))) {
            this.showToast(`${exercise.name} est déjà terminé.`, 'info');
            return;
        }
        const names = Object.fromEntries(context.day.exercises.map((ex) => [ex.id, ex.name]));
        const timer = this.timerOwner()?.activeTimer ?? null;
        if (timer?.context?.exerciseId && !names[timer.context.exerciseId])
            names[timer.context.exerciseId] = findExercise(timer.context.exerciseId)?.name;
        const decision = executionChangeDecision({ activeTimer: timer, targetExerciseId: exerciseId, halfSetExerciseId: halfDoneUnilateral(context.session, context.day, resolvePlan), names });
        if (decision.action === 'refuse') {
            // On reste sur l'étape en cours (mode guidé), jamais sur une liste repliée.
            if (context.session.startedAt && !context.session.endedAt) {
                this.programViewOverride = false;
                if (!this.execState(context.session).active)
                    await this.saveExecution({ active: true });
                this.render();
                window.scrollTo({ top: 0, behavior: 'instant' });
            }
            this.showToast(decision.message, 'info', 6000);
            return;
        }
        if (decision.action === 'confirm') {
            if (!confirm(decision.message))
                return;
        }
        if (decision.endTimer)
            await this.resolveActiveTimer(true);
        const fresh = this.currentContext(); // une résolution de chrono a pu réécrire la session
        const pendingIds = new Set(fresh.day.exercises.filter((ex) => isExercisePending(ex, fresh.session.exercises[ex.id], resolvePlan(ex))).map((ex) => ex.id));
        const result = bringToFront(fresh.session.exerciseOrder, exerciseId, { isPending: (id) => pendingIds.has(id), day: fresh.day });
        this.exerciseSheet = null;
        // Séance déjà commencée : « Faire maintenant » ouvre directement le mode guidé sur CET exercice,
        // sans imposer l'échauffement général ni les activations (ils restent faisables).
        const warmup = normalizeWarmupState(fresh.session.warmup);
        const warmupPending = fresh.day.kind !== 'recovery' && (!(warmup.general.done || warmup.general.skipped) || activationSteps(fresh.day).some((step) => !warmup.activation[step.key]));
        if (fresh.session.startedAt && !fresh.session.endedAt && !this.execState(fresh.session).active)
            await this.saveExecution({ active: true });
        const running = this.execState(fresh.session).active && !fresh.session.endedAt;
        const echauffementDu = warmupPending && !hasValidatedWork(fresh.session);
        const generalDu = !(warmup.general.done || warmup.general.skipped);
        const activationsDues = activationSteps(fresh.day).filter((step) => !warmup.activation[step.key]).length;
        const apres = generalDu && activationsDues ? `l’échauffement et les ${activationsDues} activations` : generalDu ? 'l’échauffement' : `les ${activationsDues} activation${activationsDues > 1 ? 's' : ''} restante${activationsDues > 1 ? 's' : ''}`;
        const message = !running ? `${exercise.name} sera le premier exercice de la séance.`
            : echauffementDu ? `${exercise.name} passera juste après ${apres}.`
                : `C’est parti : ${exercise.name}.`;
        if (running)
            this.programViewOverride = false;
        if (result.moved)
            await this.applySessionOrder(result.order, message);
        else {
            this.render();
            this.showToast(message, 'success');
        }
        if (running)
            window.scrollTo({ top: 0, behavior: 'instant' });
    }
    /** Ce que change l'arrêt du chrono avant de réorganiser (jamais réaffecté). */
    reorderBlockedMessage(timer) {
        const nom = findExercise(timer.context?.exerciseId)?.name ?? 'l’exercice en cours';
        if (timer.kind === 'side-switch')
            return `Changement de côté en cours sur ${nom} : si tu arrêtes ce chrono, le côté droit de la série restera à faire et sera repris quand tu reviendras sur cet exercice.`;
        return `Repos en cours après ${nom} : il sera arrêté maintenant et sa durée réelle sera enregistrée sur la série concernée.`;
    }
    refuseReorder() {
        this.showToast('Termine ou passe le chrono avant de réorganiser.', 'info', 4000);
    }
    reorderRows(context) {
        const ordered = this.orderedExercises(context.day, context.session);
        return ordered.map((exercise) => {
            const plan = getExercisePlan(exercise, context.weekIndex);
            const log = context.session.exercises[exercise.id];
            const pending = isExercisePending(exercise, log, plan);
            const isCardio = exercise.kind === 'cardio';
            const doneSets = (log?.sets ?? []).slice(0, plan.sets).filter((set) => set.done).length;
            let stateLabel;
            if (isCardio)
                stateLabel = 'fin de séance';
            else if (log?.skipped)
                stateLabel = 'passé';
            else if (!pending)
                stateLabel = 'terminé';
            else if (doneSets > 0)
                stateLabel = `${doneSets}/${plan.sets} séries`;
            else
                stateLabel = 'à faire';
            return { id: exercise.id, name: exercise.shortName ?? exercise.name, stateLabel,
                     done: !pending && !log?.skipped, pending, locked: isCardio };
        });
    }
    renderReorder() {
        if (!this.reorderOpen)
            return '';
        const context = this.currentContext();
        const timer = this.timerOwner()?.activeTimer ?? null;
        const blocked = !this.reorderAllowed();
        return renderReorderPanel({ dayName: context.day.name, rows: this.reorderRows(context), blocked, blockedMessage: blocked && timer ? this.reorderBlockedMessage(timer) : null });
    }
    renderExecMenuSheet() {
        if (!this.execMenuOpen)
            return '';
        const { step } = this.executionContext();
        const deferable = !!step.exerciseId && step.stage !== STAGES.CARDIO && step.stage !== STAGES.RECOVERY;
        return renderExecMenu({ canDefer: deferable, exerciseName: step.exercise?.shortName ?? step.exercise?.name ?? null, canCancel: canCancelSession(this.currentContext().session) });
    }
    /** Écrit un nouvel ordre pour LA SÉANCE DU JOUR uniquement. */
    async applySessionOrder(order, message) {
        const context = this.currentContext();
        context.session.exerciseOrder = normalizeOrder(order, context.day);
        context.session.orderCustomized = true;
        context.session.updatedAt = Date.now();
        await saveSession(context.session);
        this.render();
        if (message)
            this.showToast(message, 'success');
    }
    /** Ordre par défaut : uniquement sur demande explicite. */
    async saveDefaultOrder() {
        const context = this.currentContext();
        if (!confirm(`Utiliser cet ordre pour les prochains ${context.day.name} ?`))
            return;
        if (!this.snapshot.settings.dayOrders)
            this.snapshot.settings.dayOrders = {};
        this.snapshot.settings.dayOrders[context.day.id] = [...context.session.exerciseOrder];
        await saveSettings(this.snapshot.settings);
        this.render();
        this.showToast('Ordre par défaut enregistré.', 'success');
    }
    async restoreProgramOrder() {
        const context = this.currentContext();
        if (!this.reorderAllowed()) {
            this.refuseReorder();
            return;
        }
        const aussiDefaut = this.snapshot.settings.dayOrders?.[context.day.id]
            ? confirm('Restaurer aussi l’ordre par défaut de ce jour ?')
            : false;
        if (aussiDefaut) {
            delete this.snapshot.settings.dayOrders[context.day.id];
            await saveSettings(this.snapshot.settings);
        }
        await this.applySessionOrder(programOrder(context.day),
            aussiDefaut ? 'Ordre du programme restauré (séance et défaut).' : 'Ordre du programme restauré pour cette séance.');
    }
    /** « Machine occupée » : l'exercice passe après ceux qui restent à faire. */
    async deferCurrentExercise(exerciseId) {
        if (!this.reorderAllowed()) {
            this.refuseReorder();
            return;
        }
        const context = this.currentContext();
        const pendingIds = new Set(context.day.exercises
            .filter((exercise) => isExercisePending(exercise, context.session.exercises[exercise.id], getExercisePlan(exercise, context.weekIndex)))
            .map((exercise) => exercise.id));
        const result = deferExercise(context.session.exerciseOrder, exerciseId, { isPending: (id) => pendingIds.has(id), day: context.day });
        if (!result.moved) {
            this.showToast(result.reason === 'nothing-else-pending'
                ? 'C’est le dernier exercice qu’il te reste : rien après quoi le placer.'
                : 'Cet exercice ne peut pas être déplacé.', 'info', 4000);
            return;
        }
        // Aucune série n'est touchée, l'exercice n'est PAS passé.
        await this.applySessionOrder(result.order, 'Déplacé plus tard. Tes séries sont conservées.');
    }
    /**
     * Déplacement d'un cran. Ne touche QUE la séance du jour : l'ordre par
     * défaut ne change que si on le demande explicitement (saveDefaultOrder).
     */
    async moveExercise(exerciseId, offset) {
        if (!this.reorderAllowed()) {
            this.refuseReorder();
            return;
        }
        const context = this.currentContext();
        const next = moveInOrder(context.session.exerciseOrder, exerciseId, offset, context.day);
        if (next.join() === context.session.exerciseOrder.join())
            return;
        await this.applySessionOrder(next, 'Ordre modifié pour cette séance.');
    }
    async toggleSkipExercise(exerciseId) {
        const context = this.currentContext();
        const log = context.session.exercises[exerciseId];
        if (!log)
            return;
        log.skipped = !log.skipped;
        log.skipReason = log.skipped ? 'Décision manuelle / contrainte de temps' : undefined;
        context.session.updatedAt = Date.now();
        await saveSession(context.session);
        this.render();
    }
    dailyLog(date) {
        let log = this.snapshot.dailyLogs.find((item) => item.date === date);
        if (!log) {
            log = emptyDailyLog(date);
            this.snapshot.dailyLogs.push(log);
            this.snapshot.dailyLogs.sort((a, b) => a.date.localeCompare(b.date));
        }
        return log;
    }
    async updateProfileField(field, rawValue) {
        if (field === 'startDate') {
            // Date de départ : suivi du poids uniquement. Les semaines du programme n'en dépendent plus.
            this.snapshot.profile.startDate = rawValue || isoDate();
        }
        else if (field === 'programStartDate') {
            // Le travail déjà fait garde sa semaine ; seules les séances sans série validée suivent le nouveau début.
            this.snapshot.sessions.forEach((session) => {
                if (!session.endedAt && hasValidatedWork(session) && !(Number(session.planWeekIndex) >= 1))
                    session.planWeekIndex = session.weekIndex;
            });
            const anciennes = new Map(this.snapshot.sessions.map((session) => [session.id, Number(session.weekIndex)]));
            this.snapshot.profile.programStartDate = rawValue || isoDate();
            this.snapshot.sessions.forEach((session) => {
                session.weekIndex = sessionWeekIndex(session, this.snapshot.profile);
                const ancienne = anciennes.get(session.id);
                if (!session.endedAt && !hasValidatedWork(session) && Number.isFinite(ancienne) && ancienne !== session.weekIndex)
                    this.reseedAfterWeekChange(session, ancienne);
            });
        }
        else {
            const value = parseNumber(rawValue);
            if (value === null)
                return;
            if (field === 'weeklyLossRatePct')
                this.snapshot.profile.weeklyLossRatePct = value / 100;
            else
                this.snapshot.profile[field] = value;
        }
        await saveProfile(this.snapshot.profile);
        for (const session of this.snapshot.sessions)
            await saveSession(session);
        await this.ensureCurrentSession();
        this.render();
    }
    /** « Aujourd'hui : semaine 2 · Remise en route. Prochaine décharge : semaine du 19 octobre. » */
    programStartSummary(today = isoDate()) {
        const week = trainingWeekIndex(this.snapshot.profile, today);
        const phase = getTrainingPhase(week);
        const cycle = ((Math.max(1, week) - 1) % 12) + 1;
        const semainesAvantDecharge = (7 - cycle + 12) % 12;
        const decharge = formatDateFr(isoDate(addDays(startOfWeek(today), semainesAvantDecharge * 7)), { day: 'numeric', month: 'long' });
        return `Aujourd’hui : semaine ${week} · ${phase.name}. ${cycle === 7 ? 'Cette semaine est la décharge (moitié des séries).' : `Prochaine décharge : semaine du ${decharge}.`} Les séances déjà terminées gardent leur semaine.`;
    }
    async applyCalorieAdjustment() {
        const recovery = analyzeRecovery(this.snapshot.dailyLogs);
        const strength = analyzeStrengthTrend(this.snapshot.sessions);
        const analysis = analyzeWeightTrend(this.snapshot.dailyLogs, this.snapshot.profile, this.snapshot.adjustments, { date: isoDate(), recoveryAlert: recovery.alert, strengthAlert: strength.alert });
        if (analysis.action !== 'CALORIES' || analysis.calorieDelta === 0)
            return;
        const adjustment = {
            id: uid('adjustment'),
            date: isoDate(),
            previousCalories: this.snapshot.profile.currentCalories,
            newCalories: analysis.proposedCalories,
            deltaCalories: analysis.calorieDelta,
            reason: analysis.reason,
        };
        this.snapshot.profile.currentCalories = analysis.proposedCalories;
        this.snapshot.adjustments.push(adjustment);
        await Promise.all([saveProfile(this.snapshot.profile), saveAdjustment(adjustment)]);
        this.showToast(`Calories mises à jour : ${analysis.proposedCalories} kcal/jour.`, 'success');
        this.render();
    }
    timerRemainingSec() {
        return timerRemaining(this.timer);
    }
    /**
     * Un seul contexte audio, créé et « déverrouillé » au premier toucher : sur iPhone,
     * un son lancé hors geste avec un contexte neuf reste muet.
     */
    audioContext() {
        try {
            if (!this.sharedAudio) {
                const Ctor = window.AudioContext || window.webkitAudioContext;
                if (!Ctor)
                    return null;
                this.sharedAudio = new Ctor();
            }
            return this.sharedAudio;
        }
        catch {
            return null;
        }
    }
    unlockAudio() {
        if (this.audioUnlocked || !this.snapshot?.settings?.soundEnabled)
            return;
        const context = this.audioContext();
        if (!context)
            return;
        try {
            const buffer = context.createBuffer(1, 1, 22050);
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(context.destination);
            source.start(0);
            void context.resume?.();
            this.audioUnlocked = true;
        }
        catch { /* ignoré */ }
    }
    notifyTimerEnd() {
        if (this.snapshot.settings.vibrationEnabled) {
            try {
                navigator.vibrate?.([100, 60, 100, 60, 180]);
            }
            catch { /* ignored */ }
        }
        if (this.snapshot.settings.soundEnabled) {
            try {
                const context = this.audioContext();
                if (!context)
                    throw new Error('audio indisponible');
                void context.resume?.();
                [660, 880, 1100].forEach((frequency, index) => {
                    const oscillator = context.createOscillator();
                    const gain = context.createGain();
                    oscillator.connect(gain);
                    gain.connect(context.destination);
                    oscillator.frequency.value = frequency;
                    gain.gain.setValueAtTime(0.20, context.currentTime + index * 0.14);
                    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + index * 0.14 + 0.18);
                    oscillator.start(context.currentTime + index * 0.14);
                    oscillator.stop(context.currentTime + index * 0.14 + 0.22);
                });
            }
            catch { /* ignored */ }
        }
        this.showToast(timerEndMessage(this.timer?.kind), 'success');
    }
    tick() {
        const execElapsed = document.getElementById('exec-elapsed');
        if (execElapsed)
            execElapsed.textContent = formatClock(sessionDurationSeconds(this.currentContext().session));
        const sessionElapsed = document.getElementById('session-elapsed');
        const sessionProjected = document.getElementById('session-projected');
        if (sessionElapsed || sessionProjected) {
            const context = this.currentContext();
            const elapsed = sessionDurationSeconds(context.session);
            if (sessionElapsed)
                sessionElapsed.textContent = formatClock(elapsed);
            if (sessionProjected) {
                const completedCounts = {};
                context.day.exercises.forEach((exercise) => {
                    const plan = getExercisePlan(exercise, context.weekIndex);
                    const log = context.session.exercises[exercise.id];
                    completedCounts[exercise.id] = log?.skipped ? 0 : (log?.sets.slice(0, plan.sets).filter((set) => set.done).length ?? 0);
                });
                const remaining = remainingSessionSeconds(context.day, (exercise) => getExercisePlan(exercise, context.weekIndex), completedCounts);
                const planned = estimateSessionDuration(context.day, (exercise) => getExercisePlan(exercise, context.weekIndex));
                sessionProjected.textContent = formatClock(context.session.startedAt ? elapsed + remaining : planned.seconds);
            }
        }
        if (this.timer) {
            const remaining = this.timerRemainingSec();
            const timerText = document.getElementById('timer-remaining');
            const progress = document.getElementById('timer-progress');
            if (timerText)
                timerText.textContent = formatClock(remaining);
            if (progress)
                progress.style.width = `${Math.max(0, Math.min(100, remaining / this.timer.totalSec * 100))}%`;
            if (!this.timer.paused && remaining <= 0 && !this.timerQueue.busy) {
                this.notifyTimerEnd();
                void this.resolveActiveTimer(true);
            }
        }
    }
    exportData() {
        const payload = clone(this.snapshot);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `colosse-adaptive-${isoDate()}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    }
    async importData(file) {
        try {
            const parsed = JSON.parse(await file.text());
            if (!parsed || !parsed.profile || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.dailyLogs)) {
                throw new Error('Structure de sauvegarde invalide.');
            }
            if (!confirm('Cette importation remplace toutes les données actuelles. Continuer ?'))
                return;
            await saveSnapshot(parsed);
            this.snapshot = await loadSnapshot();
            await this.migrateProgramStartIfNeeded();
            this.viewWeekStart = startOfWeek(new Date());
            await this.ensureCurrentSession();
            this.showToast('Sauvegarde restaurée.', 'success');
            this.render();
        }
        catch (error) {
            this.showToast(`Import impossible : ${error instanceof Error ? error.message : String(error)}`, 'error', 7000);
        }
    }
    async resetData() {
        if (!confirm('Effacer toutes les séances, pesées et réglages ? Cette action est définitive.'))
            return;
        await clearAllData();
        this.snapshot = defaultSnapshot();
        await saveSnapshot(this.snapshot);
        this.viewWeekStart = startOfWeek(new Date());
        await this.ensureCurrentSession();
        this.showToast('Base Colosse réinitialisée.', 'success');
        this.render();
    }
    async installApp() {
        if (!this.installPrompt)
            return;
        await this.installPrompt.prompt();
        await this.installPrompt.userChoice;
        this.installPrompt = null;
        this.render();
    }
    async applyServiceWorkerUpdate() {
        if (this.snapshot.sessions.some(item => item.execution?.active && !item.endedAt) && !confirm('Une séance est en cours. Recharger maintenant ? Les séries déjà validées sont conservées, mais termine ta saisie en cours avant de continuer.')) return;
        if (this.saveDebounce !== null) { window.clearTimeout(this.saveDebounce); this.saveDebounce = null; }
        await saveSnapshot(this.snapshot);
        const registration = await navigator.serviceWorker?.getRegistration();
        if (registration?.waiting)
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        window.setTimeout(() => window.location.reload(), 300);
    }
    async acquireWakeLock() {
        try {
            const wakeLockApi = navigator.wakeLock;
            if (wakeLockApi && !this.wakeLock)
                this.wakeLock = await wakeLockApi.request('screen');
        }
        catch {
            this.wakeLock = null;
        }
    }
    async releaseWakeLock() {
        try {
            await this.wakeLock?.release();
        }
        catch { /* ignored */ }
        this.wakeLock = null;
    }
    showToast(message, type = 'info', duration = 3500) {
        window.clearTimeout(this.toastHandle ?? undefined);
        // Mémorisé : le rendu recrée #toast, un message émis juste avant un
        // render disparaissait avant d'être lu.
        this.activeToast = { message, type };
        const toast = document.getElementById('toast');
        if (!toast) {
            console.log(message);
            return;
        }
        toast.textContent = message;
        toast.className = `toast ${type}`;
        this.toastHandle = window.setTimeout(() => {
            this.activeToast = null;
            document.getElementById('toast')?.classList.add('hidden');
        }, duration);
    }
    /** Réapplique un message encore à l'écran après un rendu. */
    restoreToast() {
        if (!this.activeToast)
            return;
        const toast = document.getElementById('toast');
        if (!toast)
            return;
        toast.textContent = this.activeToast.message;
        toast.className = `toast ${this.activeToast.type}`;
    }
}
const root = document.getElementById('app');
if (!root)
    throw new Error('Élément #app introuvable.');
const app = new ColosseApp(root);
void app.init().catch((error) => {
    console.error(error);
    root.innerHTML = `<div class="fatal"><strong>Colosse n’a pas pu démarrer.</strong><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p><button onclick="location.reload()">Réessayer</button></div>`;
});
//# sourceMappingURL=app.js.map
