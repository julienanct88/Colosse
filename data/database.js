import { defaultSnapshot, emptyDailyLog, SCHEMA_VERSION } from '../defaults.js';
import { convertLegacyState } from './legacy.js';
const DB_NAME = 'colosse-adaptive-db';
const DB_VERSION = 1;
const FALLBACK_KEY = 'colosse-adaptive-v3-fallback';
const LEGACY_KEY = 'colosse-coach-v2';
const STORES = {
    meta: 'meta',
    profile: 'profile',
    settings: 'settings',
    sessions: 'sessions',
    dailyLogs: 'dailyLogs',
    adjustments: 'adjustments',
    legacy: 'legacy',
};
let dbPromise = null;
let useFallback = false;
let useMemoryFallback = false;
let memorySnapshot = null;
function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
}
function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
}
async function openDatabase() {
    if (dbPromise)
        return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB unavailable'));
            return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORES.meta))
                db.createObjectStore(STORES.meta, { keyPath: 'key' });
            if (!db.objectStoreNames.contains(STORES.profile))
                db.createObjectStore(STORES.profile, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(STORES.settings))
                db.createObjectStore(STORES.settings, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(STORES.sessions)) {
                const sessions = db.createObjectStore(STORES.sessions, { keyPath: 'id' });
                sessions.createIndex('date', 'date', { unique: false });
                sessions.createIndex('dayId', 'dayId', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORES.dailyLogs))
                db.createObjectStore(STORES.dailyLogs, { keyPath: 'date' });
            if (!db.objectStoreNames.contains(STORES.adjustments))
                db.createObjectStore(STORES.adjustments, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(STORES.legacy))
                db.createObjectStore(STORES.legacy, { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB'));
        request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another Colosse tab'));
    }).catch((error) => {
        useFallback = true;
        dbPromise = null;
        throw error;
    });
    return dbPromise;
}
async function getAll(storeName) {
    const db = await openDatabase();
    const transaction = db.transaction(storeName, 'readonly');
    const result = await requestToPromise(transaction.objectStore(storeName).getAll());
    await transactionDone(transaction);
    return result;
}
async function getOne(storeName, key) {
    const db = await openDatabase();
    const transaction = db.transaction(storeName, 'readonly');
    const result = await requestToPromise(transaction.objectStore(storeName).get(key));
    await transactionDone(transaction);
    return result;
}
async function putOne(storeName, value) {
    const db = await openDatabase();
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
}
async function clearStore(storeName) {
    const db = await openDatabase();
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).clear();
    await transactionDone(transaction);
}
function cloneSnapshot(snapshot) {
    return JSON.parse(JSON.stringify(snapshot));
}
function readFallback() {
    if (memorySnapshot)
        return cloneSnapshot(memorySnapshot);
    try {
        const raw = localStorage.getItem(FALLBACK_KEY);
        return raw ? JSON.parse(raw) : null;
    }
    catch {
        useMemoryFallback = true;
        return memorySnapshot ? cloneSnapshot(memorySnapshot) : null;
    }
}
function writeFallback(snapshot) {
    const safeSnapshot = cloneSnapshot(snapshot);
    try {
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(safeSnapshot));
        useMemoryFallback = false;
    }
    catch {
        memorySnapshot = safeSnapshot;
        useMemoryFallback = true;
    }
}
function normalizeSnapshot(snapshot) {
    const defaults = defaultSnapshot();
    const profile = { ...defaults.profile, ...(snapshot.profile ?? {}) };
    if (snapshot.profile && snapshot.profile.bikeMinutesTarget === undefined) {
        profile.dailyStepTarget = 5000;
        profile.stepsOnlyTarget = 10000;
        profile.bikeMinutesTarget = 25;
    }
    return {
        schemaVersion: SCHEMA_VERSION,
        profile,
        settings: { ...defaults.settings, ...(snapshot.settings ?? {}) },
        sessions: Array.isArray(snapshot.sessions) ? snapshot.sessions : [],
        dailyLogs: Array.isArray(snapshot.dailyLogs)
            ? snapshot.dailyLogs.map((log) => ({ ...emptyDailyLog(log.date), ...log }))
            : [],
        adjustments: Array.isArray(snapshot.adjustments) ? snapshot.adjustments : [],
        legacyArchive: snapshot.legacyArchive ?? null,
    };
}
async function initializeIndexedDb() {
    const profileRecord = await getOne(STORES.profile, 'profile');
    const settingsRecord = await getOne(STORES.settings, 'settings');
    const meta = await getOne(STORES.meta, 'schemaVersion');
    if (!profileRecord || !settingsRecord) {
        const initial = defaultSnapshot();
        await saveSnapshot(initial);
    }
    else if (Number(meta?.value ?? 0) < SCHEMA_VERSION) {
        await putOne(STORES.meta, { key: 'schemaVersion', value: SCHEMA_VERSION });
    }
    const migrated = await getOne(STORES.meta, 'legacyMigrated');
    if (!migrated?.value) {
        try {
            const legacyRaw = localStorage.getItem(LEGACY_KEY);
            if (legacyRaw) {
                const parsed = JSON.parse(legacyRaw);
                const profile = (await getOne(STORES.profile, 'profile'))?.value ?? defaultSnapshot().profile;
                const converted = convertLegacyState(parsed, profile);
                for (const session of converted.sessions)
                    await putOne(STORES.sessions, session);
                for (const daily of converted.dailyLogs) {
                    const existing = await getOne(STORES.dailyLogs, daily.date);
                    if (!existing)
                        await putOne(STORES.dailyLogs, daily);
                }
                await putOne(STORES.legacy, { id: 'legacy-v2', value: converted.archive });
            }
        }
        catch (error) {
            console.warn('Legacy migration failed:', error);
        }
        await putOne(STORES.meta, { key: 'legacyMigrated', value: true });
    }
    return loadSnapshotFromIndexedDb();
}
async function loadSnapshotFromIndexedDb() {
    const [profileRecord, settingsRecord, sessions, dailyLogs, adjustments, legacyRecord] = await Promise.all([
        getOne(STORES.profile, 'profile'),
        getOne(STORES.settings, 'settings'),
        getAll(STORES.sessions),
        getAll(STORES.dailyLogs),
        getAll(STORES.adjustments),
        getOne(STORES.legacy, 'legacy-v2'),
    ]);
    return normalizeSnapshot({
        profile: profileRecord?.value,
        settings: settingsRecord?.value,
        sessions: sessions.sort((a, b) => a.date.localeCompare(b.date)),
        dailyLogs: dailyLogs.sort((a, b) => a.date.localeCompare(b.date)),
        adjustments: adjustments.sort((a, b) => a.date.localeCompare(b.date)),
        legacyArchive: legacyRecord?.value ?? null,
    });
}
export async function loadSnapshot() {
    try {
        return await initializeIndexedDb();
    }
    catch (error) {
        console.warn('IndexedDB unavailable, using localStorage fallback:', error);
        useFallback = true;
        const fallback = readFallback();
        if (fallback)
            return normalizeSnapshot(fallback);
        const initial = defaultSnapshot();
        try {
            const legacyRaw = localStorage.getItem(LEGACY_KEY);
            if (legacyRaw) {
                const converted = convertLegacyState(JSON.parse(legacyRaw), initial.profile);
                initial.sessions = converted.sessions;
                initial.dailyLogs = converted.dailyLogs;
                initial.legacyArchive = converted.archive;
            }
        }
        catch {
            // Keep a clean initial snapshot.
        }
        writeFallback(initial);
        return initial;
    }
}
export async function saveProfile(profile) {
    if (useFallback) {
        const snapshot = normalizeSnapshot(readFallback() ?? defaultSnapshot());
        snapshot.profile = profile;
        writeFallback(snapshot);
        return;
    }
    await putOne(STORES.profile, { id: 'profile', value: profile });
}
export async function saveSettings(settings) {
    if (useFallback) {
        const snapshot = normalizeSnapshot(readFallback() ?? defaultSnapshot());
        snapshot.settings = settings;
        writeFallback(snapshot);
        return;
    }
    await putOne(STORES.settings, { id: 'settings', value: settings });
}
export async function saveSession(session) {
    if (useFallback) {
        const snapshot = normalizeSnapshot(readFallback() ?? defaultSnapshot());
        const index = snapshot.sessions.findIndex((item) => item.id === session.id);
        if (index >= 0)
            snapshot.sessions[index] = session;
        else
            snapshot.sessions.push(session);
        writeFallback(snapshot);
        return;
    }
    await putOne(STORES.sessions, session);
}
export async function deleteSession(sessionId) {
    if (useFallback) {
        const snapshot = normalizeSnapshot(readFallback() ?? defaultSnapshot());
        snapshot.sessions = snapshot.sessions.filter((session) => session.id !== sessionId);
        writeFallback(snapshot);
        return;
    }
    const db = await openDatabase();
    const transaction = db.transaction(STORES.sessions, 'readwrite');
    transaction.objectStore(STORES.sessions).delete(sessionId);
    await transactionDone(transaction);
}
export async function saveDailyLog(log) {
    if (useFallback) {
        const snapshot = normalizeSnapshot(readFallback() ?? defaultSnapshot());
        const index = snapshot.dailyLogs.findIndex((item) => item.date === log.date);
        if (index >= 0)
            snapshot.dailyLogs[index] = log;
        else
            snapshot.dailyLogs.push(log);
        writeFallback(snapshot);
        return;
    }
    await putOne(STORES.dailyLogs, log);
}
export async function saveAdjustment(adjustment) {
    if (useFallback) {
        const snapshot = normalizeSnapshot(readFallback() ?? defaultSnapshot());
        const index = snapshot.adjustments.findIndex((item) => item.id === adjustment.id);
        if (index >= 0)
            snapshot.adjustments[index] = adjustment;
        else
            snapshot.adjustments.push(adjustment);
        writeFallback(snapshot);
        return;
    }
    await putOne(STORES.adjustments, adjustment);
}
export async function saveSnapshot(snapshotInput) {
    const snapshot = normalizeSnapshot(snapshotInput);
    if (useFallback) {
        writeFallback(snapshot);
        return;
    }
    const db = await openDatabase();
    const transaction = db.transaction(Object.values(STORES), 'readwrite');
    const profileStore = transaction.objectStore(STORES.profile);
    const settingsStore = transaction.objectStore(STORES.settings);
    const sessionsStore = transaction.objectStore(STORES.sessions);
    const dailyStore = transaction.objectStore(STORES.dailyLogs);
    const adjustmentStore = transaction.objectStore(STORES.adjustments);
    const legacyStore = transaction.objectStore(STORES.legacy);
    const metaStore = transaction.objectStore(STORES.meta);
    profileStore.clear();
    settingsStore.clear();
    sessionsStore.clear();
    dailyStore.clear();
    adjustmentStore.clear();
    legacyStore.clear();
    profileStore.put({ id: 'profile', value: snapshot.profile });
    settingsStore.put({ id: 'settings', value: snapshot.settings });
    snapshot.sessions.forEach((session) => sessionsStore.put(session));
    snapshot.dailyLogs.forEach((log) => dailyStore.put(log));
    snapshot.adjustments.forEach((adjustment) => adjustmentStore.put(adjustment));
    if (snapshot.legacyArchive)
        legacyStore.put({ id: 'legacy-v2', value: snapshot.legacyArchive });
    metaStore.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
    metaStore.put({ key: 'legacyMigrated', value: true });
    await transactionDone(transaction);
}
export async function clearAllData() {
    if (useFallback) {
        memorySnapshot = null;
        try {
            localStorage.removeItem(FALLBACK_KEY);
        }
        catch {
            useMemoryFallback = true;
        }
        return;
    }
    await Promise.all([
        clearStore(STORES.profile),
        clearStore(STORES.settings),
        clearStore(STORES.sessions),
        clearStore(STORES.dailyLogs),
        clearStore(STORES.adjustments),
        clearStore(STORES.legacy),
        clearStore(STORES.meta),
    ]);
}
export function storageMode() {
    if (!useFallback)
        return 'indexeddb';
    return useMemoryFallback ? 'memory' : 'localstorage';
}
//# sourceMappingURL=database.js.map
