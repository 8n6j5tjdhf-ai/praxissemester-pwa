// Cloud-Sync-Modul (Supabase). Läuft komplett im Browser-Kontext, damit derselbe
// Code sowohl in der Electron-App (Renderer-Prozess, siehe electron/main.js -
// bewusst NICHT angefasst für diese Funktion) als auch in der PWA auf iPhone/
// iPad funktioniert. app.js bleibt die einzige Stelle, die rendert - dieses
// Modul kennt keine DOM-Elemente und wirft nie unbehandelt in den Aufrufer,
// wenn es um Hintergrund-Sync geht (siehe backgroundSyncAfterLoad/backgroundPush).
//
// Setup: CONFIG.SUPABASE_URL/SUPABASE_ANON_KEY kommen aus config.js (vor
// diesem Skript geladen). Ohne echte Werte bleibt Sync.isConfigured() false
// und jede Cloud-Funktion ist ein no-op - die App funktioniert dann exakt wie
// vor dieser Änderung (siehe README für die Erklärung, warum der anon key
// öffentlich im Code stehen darf: Row Level Security schützt die Daten, nicht
// die Geheimhaltung des Keys).
'use strict';

const Sync = (() => {
  const TABLE = 'app_data';
  const BUCKET = 'documents';
  const HEALTH_TIMEOUT_MS = 1500;

  let client = null;
  let localServerPromise = null;
  let realtimeChannel = null;

  function isConfigured() {
    return !!(window.CONFIG && window.CONFIG.SUPABASE_URL && window.CONFIG.SUPABASE_ANON_KEY
      && window.CONFIG.SUPABASE_URL.startsWith('https://') && !window.CONFIG.SUPABASE_URL.includes('DEIN-PROJEKT'));
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (!client && window.supabase) {
      client = window.supabase.createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON_KEY);
    }
    return client;
  }

  // Probes the local Python server once and caches the result - true on the Mac
  // Electron app (server.py running), false on GitHub Pages (no /api/* route
  // exists there at all, so this fails fast and cleanly).
  function hasLocalServer() {
    if (localServerPromise) return localServerPromise;
    localServerPromise = (async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
        const res = await fetch('/api/health', { signal: controller.signal });
        clearTimeout(timer);
        return res.ok;
      } catch {
        return false;
      }
    })();
    return localServerPromise;
  }

  async function getSession() {
    const c = getClient();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    return data.session || null;
  }

  function onAuthChange(cb) {
    const c = getClient();
    if (!c) return () => {};
    const { data } = c.auth.onAuthStateChange((_event, session) => cb(session));
    return () => data.subscription.unsubscribe();
  }

  async function signIn(email, password) {
    const c = getClient();
    if (!c) throw new Error('Supabase ist nicht konfiguriert (config.js prüfen).');
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
  }

  // First-time account creation. Supabase schickt je nach Projekteinstellung
  // eine Bestätigungs-E-Mail - dann existiert zwar ein Nutzer, aber noch keine
  // aktive Session, bis die E-Mail bestätigt wurde (siehe Rückgabewert
  // needsEmailConfirmation).
  async function signUp(email, password) {
    const c = getClient();
    if (!c) throw new Error('Supabase ist nicht konfiguriert (config.js prüfen).');
    const { data, error } = await c.auth.signUp({ email, password });
    if (error) throw error;
    return { session: data.session, needsEmailConfirmation: !data.session };
  }

  async function signOut() {
    const c = getClient();
    if (!c) return;
    await c.auth.signOut();
  }

  async function pullAppData() {
    const c = getClient();
    const session = await getSession();
    if (!c || !session) return null;
    const { data, error } = await c
      .from(TABLE)
      .select('data, updated_at')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error) throw error;
    return data; // { data, updated_at } | null (noch nie synchronisiert)
  }

  async function pushAppData(fullData) {
    const c = getClient();
    const session = await getSession();
    if (!c || !session) throw new Error('Nicht angemeldet.');
    const { error } = await c
      .from(TABLE)
      .upsert({ user_id: session.user.id, data: fullData, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  function subscribeRealtime(onRemoteChange) {
    const c = getClient();
    if (!c) return () => {};
    if (realtimeChannel) { c.removeChannel(realtimeChannel); realtimeChannel = null; }
    realtimeChannel = c
      .channel('app_data-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, onRemoteChange)
      .subscribe();
    return () => { if (realtimeChannel) { c.removeChannel(realtimeChannel); realtimeChannel = null; } };
  }

  async function uploadDocument(relPath, blob) {
    const c = getClient();
    const session = await getSession();
    if (!c || !session) throw new Error('Nicht angemeldet.');
    const path = `${session.user.id}/${relPath}`;
    const { error } = await c.storage.from(BUCKET).upload(path, blob, { upsert: true });
    if (error) throw error;
    return path;
  }

  async function getSignedUrl(relPath, expiresInSeconds = 3600) {
    const c = getClient();
    const session = await getSession();
    if (!c || !session) throw new Error('Nicht angemeldet.');
    const path = `${session.user.id}/${relPath}`;
    const { data, error } = await c.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
    if (error) throw error;
    return data.signedUrl;
  }

  // Best-effort: pushes the current local dataset after a local save. Never
  // throws into the caller - a failed cloud push must never affect the local
  // save the user already saw succeed (setConn('ok') in app.js persist()).
  async function backgroundPush(fullData) {
    try {
      if (!isConfigured() || !(await getSession())) return { ok: false, skipped: true };
      await pushAppData(fullData);
      return { ok: true };
    } catch (e) {
      console.warn('Cloud-Sync (Hintergrund-Push) fehlgeschlagen:', e);
      return { ok: false, error: e.message };
    }
  }

  // Compares local vs. remote updated_at (whole-dataset last-write-wins - see
  // README for why this is coarse-grained on purpose) and returns what should
  // happen, without mutating anything itself - app.js decides how to apply it
  // so this module never needs to know about DATA/checkMap/rendering.
  async function reconcile(localData) {
    if (!isConfigured() || !(await getSession())) return { action: 'skip' };
    const remote = await pullAppData();
    if (!remote) {
      await pushAppData(localData);
      return { action: 'pushed-initial' };
    }
    const localUpdatedAt = localData.syncMeta && localData.syncMeta.updatedAt;
    const remoteNewer = !localUpdatedAt || new Date(remote.updated_at) > new Date(localUpdatedAt);
    if (remoteNewer) {
      const merged = remote.data;
      merged.syncMeta = { updatedAt: remote.updated_at };
      return { action: 'pulled', data: merged };
    }
    await pushAppData(localData);
    return { action: 'pushed' };
  }

  return {
    isConfigured, hasLocalServer, getSession, onAuthChange, signIn, signUp, signOut,
    pullAppData, pushAppData, subscribeRealtime, uploadDocument, getSignedUrl,
    backgroundPush, reconcile,
  };
})();
