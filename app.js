// Praxissemester Tracker — frontend logic. Talks to server.py via /api/companies.
// Data model lives entirely in data/companies.json (fetched once, edited in memory,
// saved back on every change) so nothing depends on browser localStorage.
//
// Layout: a fixed sidebar switches between 9 "pages" (plain show/hide of <section
// class="page">, no router/history needed for a single-window desktop app). Each
// page has its own render* function; they all read from the same DATA object.

// ============================================================== Constants

// Pipeline order matters: it drives the "Bewerbungsstatus"-sort and the board view
// on the Bewerbungen page. DEAD_STATUS stays last - it's a terminal off-ramp, not a
// pipeline step.
const STATUSES = [
  'Interessant', 'Unterlagen werden erstellt', 'Bereit zur Bewerbung', 'Beworben',
  'Eingangsbestätigung erhalten', 'Rückfrage', 'Vorstellungsgespräch',
  'Follow-up erforderlich', 'Keine Antwort', 'Zusage', 'Absage',
  'Nicht zustellbar / Unternehmen insolvent',
];
const DEAD_STATUS = 'Nicht zustellbar / Unternehmen insolvent';
const STATUS_ORDER = Object.fromEntries(STATUSES.map((s, i) => [s, i]));

const STATUS_CLASS = {
  'Interessant': 's-interessant', 'Unterlagen werden erstellt': 's-unterlagen',
  'Bereit zur Bewerbung': 's-vorbereitet', 'Beworben': 's-beworben',
  'Eingangsbestätigung erhalten': 's-eingang', 'Rückfrage': 's-rueckfrage',
  'Vorstellungsgespräch': 's-interview', 'Follow-up erforderlich': 's-followupstatus',
  'Keine Antwort': 's-keineantwort', 'Zusage': 's-zusage', 'Absage': 's-absage',
  [DEAD_STATUS]: 's-dead',
};

// Topic tags for the industry filter - independent of "category" (which is the
// coarser industry/medtech/fraunhofer/tum-backup grouping used for the two
// list sections on the Unternehmen page).
const TAG_OPTIONS = [
  { key: 'medizintechnik', label: 'Medizintechnik' },
  { key: 'medizinrobotik', label: 'Medizinrobotik' },
  { key: 'robotik', label: 'Robotik' },
  { key: 'mechatronik', label: 'Mechatronik' },
  { key: 'automatisierung', label: 'Automatisierung' },
  { key: 'diagnostik-bildgebung', label: 'Diagnostik & Bildgebung' },
  { key: 'sensorik', label: 'Sensorik' },
  { key: 'deep-tech', label: 'Deep Tech' },
];
const TAG_LABEL = Object.fromEntries(TAG_OPTIONS.map(t => [t.key, t.label]));
const MEDTECH_TAGS = ['medizintechnik', 'medizinrobotik'];

const TIMELINE_TYPES = [
  { type: 'recherchiert', label: 'Firma recherchiert' },
  { type: 'vorbereitet', label: 'Bewerbung vorbereitet' },
  { type: 'erstellt', label: 'Bewerbungsmappe erstellt' },
  { type: 'versendet', label: 'Bewerbung versendet' },
  { type: 'eingangsbestaetigung', label: 'Eingangsbestätigung' },
  { type: 'rueckfrage', label: 'Rückfrage' },
  { type: 'nachfassen', label: 'Nachfass-E-Mail' },
  { type: 'telefonat', label: 'Telefonat' },
  { type: 'interview', label: 'Interview' },
  { type: 'zusage', label: 'Zusage' },
  { type: 'absage', label: 'Absage' },
  { type: 'archiviert', label: 'Archiviert' },
  { type: 'notiz', label: 'Notiz ergänzt' },
  { type: 'datei_ersetzt', label: 'Datei ersetzt' },
  { type: 'unzustellbar', label: 'Unzustellbar / insolvent festgestellt' },
];
const TL_LABEL = Object.fromEntries(TIMELINE_TYPES.map(t => [t.type, t.label]));
const RESPONSE_TYPES = ['eingangsbestaetigung', 'rueckfrage', 'telefonat', 'interview', 'zusage', 'absage'];

const LOGO_PALETTE = ['#9b8cfa', '#6ea3ff', '#4ade9b', '#f5b95c', '#f77272', '#7bd4d4', '#c792ea', '#82aaff', '#ffcb6b', '#89ddff'];

const SCORE_WEIGHTS = { fit: 0.25, interesse: 0.15, entfernung: 0.15, groesse: 0.10, innovation: 0.15, chance: 0.20 };
const SCORE_DIM_LABELS = {
  fit: 'Fachliche Passung', interesse: 'Interesse', entfernung: 'Entfernung',
  groesse: 'Unternehmensgröße', innovation: 'Innovationsgrad', chance: 'Chance auf Zusage',
};

// Registry of known document keys -> label. Unknown keys still render (raw key as
// fallback), so a brand-new document type only needs a new key under a company's
// "documents" in companies.json - no code change required to show it.
const DOCUMENT_LABELS = {
  anschreiben_docx: 'Anschreiben (DOCX)', anschreiben_pdf: 'Anschreiben (PDF)', anschreiben_md: 'Anschreiben (MD)',
  lebenslauf_docx: 'Lebenslauf (DOCX)', lebenslauf_pdf: 'Lebenslauf (PDF)',
  notenuebersicht_pdf: 'Notenübersicht', bewerbungsmappe_pdf: 'Bewerbungsmappe',
  email_eml: 'E-Mail-Entwurf (.eml)',
};

// Optional documents the user can pick when (re-)building a Bewerbungsmappe -
// beyond the always-included Anschreiben/Lebenslauf/Notenübersicht. Paths are
// relative to the project root; only offered if the file actually exists
// (checked server-side too, see /api/companies/<id>/regenerate).
const IMMATRIKULATION_PATH = 'Immatrikulationsbescheinigung/Immatrikulationsbescheinigung-auch-BAfoeG-Deutsche-Bahn-Familienkasse-fuer-das-SoSe-2026_ME-B.pdf';
const IMMATRIKULATION_VORLAEUFIG_PATH = 'Immatrikulationsbescheinigung/Aktuelle-Rueckmeldebestaetigung-vorlaeufige-Immatrikulationsbescheinigung_ME-B.pdf';

const OPTIONAL_MAPPE_DOCS = [
  { key: 'includeImmatrikulation', label: 'Immatrikulationsbescheinigung', path: IMMATRIKULATION_PATH },
  { key: 'includeAbitur', label: 'Abiturzeugnis', path: 'Abiturzeugnis/2023_07_06_Abitur.pdf' },
];
const DEFAULT_PRIMARY_DOCUMENT = 'bewerbungsmappe_pdf';

// General (non-firm-specific) documents shown on the Dokumente page. "path" is
// relative to the project root; "missing" ones are flagged rather than invented.
const GENERAL_DOCS = [
  { label: 'Lebenslauf (DE, mit Foto, PDF)', path: 'Lebenslauf/Lebenslauf_Pedro_Kraemer_DE_mit_Foto.pdf' },
  { label: 'Lebenslauf (DE, mit Foto, DOCX)', path: 'Lebenslauf/Lebenslauf_Pedro_Kraemer_DE_mit_Foto.docx' },
  { label: 'Notenübersicht', path: 'Lebenslauf/Notenuebersicht_Pedro_Kraemer.pdf' },
  { label: 'Abiturzeugnis', path: 'Abiturzeugnis/2023_07_06_Abitur.pdf' },
  { label: 'Immatrikulationsbescheinigung (SoSe 2026, 4. Fachsemester)', path: IMMATRIKULATION_PATH },
  { label: 'Vorläufige Rückmeldebestätigung (WiSe 2026/27)', path: IMMATRIKULATION_VORLAEUFIG_PATH, note: 'Gilt bis die endgültige Immatrikulationsbescheinigung fürs WiSe 2026/27 ab Mitte September online verfügbar ist.' },
  { label: 'Unterschrift', path: 'Brainlab-Bewerbung/Foto/Unterschrift_Pedro_Kraemer.png' },
  { label: 'Tätigkeitsplan-Vorlage', path: null, note: 'Noch nicht angelegt — wird benötigt, sobald eine Zusage vorliegt.' },
];

// Vollständigkeits-Checkliste laut Praktikumsrichtlinie/Prüfungsordnung. "present: false"
// Einträge werden nie erfunden — nur was wirklich im Projektordner liegt, gilt als vorhanden.
// "external: true" heißt: kein lokales Dokument nötig, ein Link genügt (z. B. HM-Richtlinie).
const REQUIRED_DOCS_CHECKLIST = [
  { label: 'Lebenslauf', present: true, path: 'Lebenslauf/Lebenslauf_Pedro_Kraemer_DE_mit_Foto.pdf' },
  { label: 'Individuelles Anschreiben (pro Firma)', present: true, note: 'Für jede aktive Firma vorhanden — siehe Firmenkarte.' },
  { label: 'Aktuelle Notenübersicht', present: true, path: 'Lebenslauf/Notenuebersicht_Pedro_Kraemer.pdf' },
  { label: 'Abiturzeugnis', present: true, path: 'Abiturzeugnis/2023_07_06_Abitur.pdf' },
  { label: 'Immatrikulationsbescheinigung', present: true, path: IMMATRIKULATION_PATH, note: 'Offizielle Bescheinigung fürs Sommersemester 2026 (4. Fachsemester). Zusätzlich liegt eine vorläufige Rückmeldebestätigung fürs WiSe 2026/27 vor (siehe Dokumente-Seite).' },
  { label: 'Praktikumsrichtlinie / HM-Hinweise zum Praxissemester', present: true, external: true, url: 'https://mediapool.hm.edu/media/dachmarke/dm_lokal/hauptabteilung2/pruefung_praktikum/ausbildungsplaene/Richtlinien_Praktisches_Studiensemester_Mechatronik~1.pdf', note: 'Offizielles PDF der HM, extern verlinkt (siehe HM-Prozess-Seite).' },
  { label: 'Arbeits-/Praktikums-/Tätigkeitszeugnisse', present: false, note: 'Bisher keine vorherigen Praktika/Anstellungen mit Zeugnis im Projektordner gefunden.' },
  { label: 'Relevante Zertifikate', present: false, note: 'Keine Zertifikate im Projektordner gefunden.' },
  { label: 'Unterschrift', present: true, path: 'Brainlab-Bewerbung/Foto/Unterschrift_Pedro_Kraemer.png' },
  { label: 'Vollständige Bewerbungsmappe als PDF (pro Firma)', present: true, note: 'Wird pro Firma automatisch erzeugt — siehe „Bewerbungsmappen pro Firma“ unten.' },
];

// Follow-up reminders as a rule list: add another {id, label, severity, check}
// object here for a new reminder type without touching any render code.
const FOLLOWUP_RULES = [
  {
    id: 'no-response-14d',
    label: 'Nachfassen empfohlen (≥14 Tage ohne Rückmeldung)',
    severity: 'warn',
    check(c) {
      if (!c.applicationDate) return false;
      if (['Zusage', 'Absage', DEAD_STATUS].includes(c.status)) return false;
      if (firstResponseEvent(c)) return false;
      return daysBetween(c.applicationDate, todayISO()) >= 14;
    },
  },
];

const SORT_OPTIONS = [
  { key: 'score', label: 'Score (Standard)' },
  { key: 'fit', label: 'Beste fachliche Übereinstimmung' },
  { key: 'priority', label: 'Höchste Priorität' },
  { key: 'medtechFirst', label: 'Medizintechnik zuerst' },
  { key: 'commute', label: 'Entfernung / Fahrzeit' },
  { key: 'addedDate', label: 'Zuletzt hinzugefügt' },
  { key: 'status', label: 'Bewerbungsstatus' },
  { key: 'followUpDate', label: 'Follow-up-Datum' },
  { key: 'applicationDate', label: 'Bewerbungsdatum (neueste zuerst)' },
  { key: 'name', label: 'Name (A-Z)' },
  { key: 'lastChanged', label: 'Zuletzt geändert' },
];

// 15-item checklist auto-generated the moment a company's status becomes "Zusage".
const ZUSAGE_CHECKLIST_TEMPLATE = [
  'Ansprechpartner der Firma vollständig?',
  'Tätigkeitsbeschreibung erhalten?',
  'Tätigkeitsplan erstellt?',
  'Tätigkeitsplan von Firma bestätigt?',
  'Tätigkeitsplan an HM gesendet?',
  'HM-Genehmigung erhalten?',
  'Genehmigung in PRIMUSS hochgeladen?',
  'Praktikumsvertrag erhalten?',
  'Vertrag geprüft?',
  'Vertrag hochgeladen?',
  'Praktikumsbeginn freigegeben?',
  'Begleitmodule organisiert?',
  'Berichtsvorgaben geprüft?',
  'Kolloquium vorgemerkt?',
  'Praktikumszeugnis am Ende eingeplant?',
];

const HM_STEPS = [
  'Mit der Firma einen Tätigkeitsplan erstellen',
  'Aufgaben und Zeitanteile festhalten',
  'Ansprechpartner der Firma eintragen',
  'Tätigkeitsplan als PDF speichern',
  'Tätigkeitsplan an den Praktikantenbeauftragten senden',
  'Genehmigung abwarten',
  'Genehmigung in PRIMUSS hochladen',
  'Praktikumsvertrag hochladen',
  'Prüfung durch Bereich Prüfung und Praktikum abwarten',
  'Praktikum erst nach vollständiger Genehmigung antreten',
];

const HM_WARNINGS = [
  'Werkstudentenverträge gelten NICHT automatisch als Praktikumsvertrag.',
  'Hiwi-Verträge gelten NICHT automatisch als Praktikumsvertrag.',
  'Bei TUM-Instituten vorher einen echten Praktikumsvertrag bestätigen lassen.',
  'Nachträglich eingereichte Verträge können problematisch sein (§12 Abs. 7 APO) — erst nach vollständiger Prüfung antreten.',
];

const FETCH_TIMEOUT_MS = 8000;

// ================================================================== State

let DATA = null;
let checkMap = {};
let saveTimer = null;
let lastSaveFailed = false;

const UI = {
  search: '', statusFilter: 'all', categoryFilter: 'all', phaseFilter: 'all', sort: 'score',
  followupOnly: false, docsOnly: false, initiativOnly: false, concreteOnly: false, tags: new Set(),
};
const NAV = { page: 'dashboard', companyId: null };

// ================================================================== Utils

function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDaysISO(iso, n) { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function addBusinessDaysISO(iso, n) {
  const d = new Date(iso);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}
function colorForId(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LOGO_PALETTE[h % LOGO_PALETTE.length];
}
function firstResponseEvent(c) {
  const evs = (c.timeline || []).filter(e => RESPONSE_TYPES.includes(e.type)).sort((a, b) => a.date.localeCompare(b.date));
  return evs[0] || null;
}
function hasEventType(c, type) { return (c.timeline || []).some(e => e.type === type); }
function getActiveReminders(c) { return FOLLOWUP_RULES.filter(r => r.check(c)); }
function needsFollowUp(c) { return getActiveReminders(c).length > 0; }
function lastChangedDate(c) {
  const dates = (c.timeline || []).map(e => e.date);
  return dates.length ? dates.sort().slice(-1)[0] : null;
}
function fmtDate(iso) {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function parseCommuteMinutes(commute) {
  if (!commute) return 999;
  const primary = commute.split('/')[0];
  const isHours = /Std\.|Stunde/i.test(primary);
  const nums = (primary.match(/\d+(?:[.,]\d+)?/g) || []).map(s => parseFloat(s.replace(',', '.')));
  if (!nums.length) return 999;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return isHours ? avg * 60 : avg;
}
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
function copyToClipboard(text, feedbackEl) {
  navigator.clipboard.writeText(text).then(() => {
    if (feedbackEl) {
      feedbackEl.textContent = '✓ kopiert';
      setTimeout(() => { feedbackEl.textContent = ''; }, 1800);
    }
  });
}
function fileNameFromPath(p) { return p ? p.split('/').pop() : ''; }

// ================================================================== Score

function computeScore(c) {
  const b = c.scoreBreakdown;
  if (!b) return null;
  const weighted = Object.entries(SCORE_WEIGHTS).reduce((sum, [dim, w]) => sum + (b[dim] || 0) * w, 0);
  return Math.round(weighted * 20);
}
function scoreBand(score) { return score === null ? 'score-mid' : score >= 75 ? 'score-high' : score >= 55 ? 'score-mid' : 'score-low'; }
function renderScoreBreakdown(c) {
  const b = c.scoreBreakdown;
  if (!b) return '';
  const rows = Object.keys(SCORE_WEIGHTS).map(dim =>
    `<div class="sb-row"><span>${SCORE_DIM_LABELS[dim]}</span><b>${b[dim] ?? '–'}/5</b></div>`
  ).join('');
  return `<details class="section-collapse"><summary>Score-Details anzeigen</summary><div class="score-breakdown">${rows}</div></details>`;
}

// ============================================================= Data I/O

// Local Mac/Electron path is untouched from here on - same fetch, same shape,
// same error contract as before. The only addition is a fire-and-forget cloud
// reconcile that can never throw into this function or change its behavior.
async function loadData() {
  if (await Sync.hasLocalServer()) {
    const res = await fetchWithTimeout('/api/companies');
    if (!res.ok) throw new Error('GET /api/companies failed: ' + res.status);
    DATA = await res.json();
    if (!DATA.checklistState) DATA.checklistState = {};
    checkMap = DATA.checklistState;
    reconcileInBackground();
  } else {
    // PWA-Modus ohne lokalen Server: Supabase ist die einzige Datenquelle.
    // initApp() stellt sicher, dass hier bereits eine Session existiert
    // (siehe renderLoginGate) - sonst würde pullAppData() leer zurückkommen.
    const remote = await Sync.pullAppData();
    DATA = (remote && remote.data) || { companies: [], archived: [], checklistState: {}, hmInfo: {} };
    if (remote) DATA.syncMeta = { updatedAt: remote.updated_at };
    if (!DATA.checklistState) DATA.checklistState = {};
    checkMap = DATA.checklistState;
  }
}

// Raw local save, no cloud involved - used by persist() (local path) and by
// reconcileInBackground() when a remote pull needs to be written back to disk.
async function postLocalCompanies(data) {
  const res = await fetchWithTimeout('/api/companies', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('save failed: ' + res.status);
}

// Whole-dataset last-write-wins against Supabase (see README für die
// Begründung, warum bewusst nicht pro Firma verglichen wird). Läuft im
// Hintergrund nach jedem loadData() auf dem Mac; wenn Supabase nicht
// konfiguriert/nicht angemeldet ist, ist Sync.reconcile() ein no-op.
async function reconcileInBackground() {
  try {
    const result = await Sync.reconcile(DATA);
    if (result.action === 'pulled') {
      DATA = result.data;
      checkMap = DATA.checklistState || {};
      await postLocalCompanies(DATA);
      renderCurrentPage();
      renderNavBadges();
    }
  } catch (e) {
    console.warn('Cloud-Sync (Hintergrund) fehlgeschlagen:', e);
  }
}

function scheduleSave() {
  setConn('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 500);
}
async function persist() {
  DATA.syncMeta = { updatedAt: new Date().toISOString() };
  if (await Sync.hasLocalServer()) {
    try {
      await postLocalCompanies(DATA);
      lastSaveFailed = false;
      setConn('ok');
    } catch (e) {
      lastSaveFailed = true;
      setConn('err');
      console.error('Speichern fehlgeschlagen:', e);
    }
    Sync.backgroundPush(DATA); // best-effort, nie blockierend, siehe sync.js
  } else {
    try {
      await Sync.pushAppData(DATA);
      lastSaveFailed = false;
      setConn('ok');
    } catch (e) {
      lastSaveFailed = true;
      setConn('err');
      console.error('Cloud-Speichern fehlgeschlagen:', e);
    }
  }
}
function setConn(state) {
  const el = document.getElementById('connState');
  if (!el) return;
  if (state === 'ok') { el.textContent = 'Gespeichert'; el.className = 'ok'; }
  else if (state === 'saving') { el.textContent = 'Speichere …'; el.className = ''; }
  else { el.textContent = 'Fehler – klicken'; el.className = 'err'; }
}
function companyById(id) { return DATA.companies.find(c => c.id === id); }
window.addEventListener('online', () => { if (lastSaveFailed) persist(); });

function addTimelineEvent(c, type, note) {
  c.timeline = c.timeline || [];
  c.timeline.push({ type, date: todayISO(), note: note || '' });
}

// Central place status transitions happen, so every side effect (dates, timeline,
// zusage-checklist) always fires together no matter which UI control triggered it.
function setCompanyStatus(c, newStatus, { skipTimeline } = {}) {
  const old = c.status;
  if (old === newStatus) return;
  c.status = newStatus;
  if (!skipTimeline) {
    const typeMap = {
      'Beworben': 'versendet', 'Eingangsbestätigung erhalten': 'eingangsbestaetigung',
      'Rückfrage': 'rueckfrage', 'Vorstellungsgespräch': 'interview',
      'Zusage': 'zusage', 'Absage': 'absage', [DEAD_STATUS]: 'unzustellbar',
    };
    if (typeMap[newStatus]) addTimelineEvent(c, typeMap[newStatus]);
  }
  if (newStatus === 'Beworben' && !c.applicationDate) {
    c.applicationDate = todayISO();
    // 7-10 Werktage Standardfrist fürs Nachfassen; manuell änderbar im Detail.
    c.followUpDate = addBusinessDaysISO(todayISO(), 8);
  }
  if (newStatus === 'Zusage' && !c.zusageChecklist) {
    c.zusageChecklist = ZUSAGE_CHECKLIST_TEMPLATE.map(label => ({ label, done: false }));
  }
  if (['Zusage', 'Absage', DEAD_STATUS].includes(newStatus)) {
    c.followUpDate = null;
  }
}

// ================================================================== KPIs

function computeKPIs() {
  const cs = DATA.companies;
  const sent = cs.filter(c => !!c.applicationDate && c.status !== DEAD_STATUS);
  const interviews = cs.filter(c => c.status === 'Vorstellungsgespräch' || hasEventType(c, 'interview'));
  const zusagen = cs.filter(c => c.status === 'Zusage');
  const absagen = cs.filter(c => c.status === 'Absage');
  const vorbereitet = cs.filter(c => ['Unterlagen werden erstellt', 'Bereit zur Bewerbung'].includes(c.status));
  const ohneKontakt = cs.filter(c => c.status === 'Interessant');
  const responded = sent.filter(hasResponded);
  const keineAntwort = cs.filter(c => c.status === 'Keine Antwort');
  const nachfassen = cs.filter(needsFollowUp);
  const vollstaendig = cs.filter(c => c.documents && c.documents[c.primaryDocument || DEFAULT_PRIMARY_DOCUMENT]);
  const zusageCompanies = cs.filter(c => c.zusageChecklist);
  let hmDone = 0, hmTotal = 0;
  zusageCompanies.forEach(c => { hmTotal += c.zusageChecklist.length; hmDone += c.zusageChecklist.filter(i => i.done).length; });
  return {
    sentCount: sent.length,
    vorbereitetCount: vorbereitet.length,
    ohneKontaktCount: ohneKontakt.length,
    respondedCount: responded.length,
    interviewCount: interviews.length,
    zusageCount: zusagen.length,
    absageCount: absagen.length,
    keineAntwortCount: keineAntwort.length,
    nachfassenCount: nachfassen.length,
    vollstaendigCount: vollstaendig.length,
    totalCount: cs.length,
    hmDone, hmTotal,
  };
}

// ============================================================== Navigation

function switchPage(page) {
  NAV.page = page;
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  if (page === 'unternehmen' && !NAV.companyId) showCompanyList();
  renderCurrentPage();
}
function renderCurrentPage() {
  const renderers = {
    dashboard: renderDashboard, unternehmen: renderUnternehmenPage, bewerbungen: renderBewerbungenBoard,
    nachfassen: renderNachfassen, dokumente: renderDokumente, hmprozess: renderHmProzess,
    termine: renderTermine, archiv: renderArchiv, einstellungen: renderEinstellungen,
  };
  renderers[NAV.page]?.();
  renderNavBadges();
}
function renderNavBadges() {
  const n = DATA.companies.filter(needsFollowUp).length;
  const badge = document.getElementById('navBadgeNachfassen');
  badge.hidden = n === 0;
  badge.textContent = n;
}
function initNav() {
  document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => switchPage(btn.dataset.page)));
}

// ============================================================== Dashboard

function renderDashboard() {
  const k = computeKPIs();
  const kpis = [
    ['Bewerbungen versendet', k.sentCount, ''],
    ['Bewerbungen vorbereitet', k.vorbereitetCount, 'accent-warning'],
    ['Noch nicht kontaktiert', k.ohneKontaktCount, ''],
    ['Antworten erhalten', k.respondedCount, 'accent-info'],
    ['Interviews', k.interviewCount, 'accent-info'],
    ['Zusagen', k.zusageCount, 'accent-success'],
    ['Absagen', k.absageCount, 'accent-danger'],
    ['Keine Antwort', k.keineAntwortCount, ''],
    ['Nachfassen fällig', k.nachfassenCount, k.nachfassenCount > 0 ? 'accent-warning' : ''],
    ['Vollständige Mappe', `${k.vollstaendigCount}/${k.totalCount}`, ''],
    ['HM-Fortschritt', k.hmTotal ? `${k.hmDone}/${k.hmTotal}` : '–', 'accent-info'],
  ];
  document.getElementById('dashboardKpis').innerHTML = kpis.map(([label, val, accent]) => `
    <div class="kpi-card ${accent}${label === 'Nachfassen fällig' && k.nachfassenCount > 0 ? ' attention' : ''}">
      <div class="kpi-num">${val}</div><div class="kpi-label">${label}</div>
    </div>`).join('');

  const active = activeCompanies();
  const lead = sortCompanies(active).find(c => (STATUS_ORDER[c.status] ?? 0) < STATUS_ORDER['Beworben']) || sortCompanies(active)[0];
  document.getElementById('dashNextSteps').innerHTML = lead ? `
    <p style="font-size:13px; margin:0 0 10px;">Nächste priorisierte Firma: <b>${lead.name}</b> (Score ${computeScore(lead) ?? '–'}, Status: ${lead.status})</p>
    <div class="btn-row">
      <button class="btn btn-primary" data-goto-company="${lead.id}">Zur Firma</button>
      <button class="btn" data-goto-page="hmprozess">HM-Prozess ansehen</button>
    </div>` : '<p class="mini-empty">Keine aktiven Firmen.</p>';

  const followups = DATA.companies.filter(needsFollowUp).sort((a, b) => (a.followUpDate || '').localeCompare(b.followUpDate || ''));
  document.getElementById('dashFollowups').innerHTML = followups.length
    ? followups.slice(0, 6).map(c => miniListItem(c, `Fällig seit ${fmtDate(c.followUpDate)}`)).join('')
    : '<li class="mini-empty">Aktuell nichts fällig.</li>';

  const recent = DATA.companies.filter(c => lastChangedDate(c)).sort((a, b) => lastChangedDate(b).localeCompare(lastChangedDate(a)));
  document.getElementById('dashRecent').innerHTML = recent.length
    ? recent.slice(0, 6).map(c => miniListItem(c, fmtDate(lastChangedDate(c)))).join('')
    : '<li class="mini-empty">Noch keine Aktivität.</li>';

  const topScore = sortCompanies(activeCompanies()).slice(0, 6);
  document.getElementById('dashTopScore').innerHTML = topScore.length
    ? topScore.map(c => miniListItem(c, `Score ${computeScore(c) ?? '–'}`)).join('')
    : '<li class="mini-empty">–</li>';

  const zusageCompanies = DATA.companies.filter(c => c.zusageChecklist);
  document.getElementById('dashHmProgress').innerHTML = zusageCompanies.length ? zusageCompanies.map(c => {
    const done = c.zusageChecklist.filter(i => i.done).length;
    const pct = Math.round((done / c.zusageChecklist.length) * 100);
    return `<div style="margin-bottom:10px;"><div style="display:flex; justify-content:space-between; font-size:12px;"><b>${c.name}</b><span>${done}/${c.zusageChecklist.length}</span></div><div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div></div>`;
  }).join('') : '<p class="mini-empty">Noch keine Zusage vorhanden.</p>';

  wireGotoButtons(document.getElementById('page-dashboard'));
}
function miniListItem(c, subtext) {
  return `<li data-goto-company="${c.id}"><span class="ml-main">${c.name}</span><span class="ml-sub">${subtext}</span></li>`;
}
function wireGotoButtons(root) {
  root.querySelectorAll('[data-goto-company]').forEach(el => el.addEventListener('click', () => {
    switchPage('unternehmen');
    showCompanyDetail(el.dataset.gotoCompany);
  }));
  root.querySelectorAll('[data-goto-page]').forEach(el => el.addEventListener('click', () => switchPage(el.dataset.gotoPage)));
}

// ============================================================ Filter/sort

function matchesSearch(c, query) {
  if (!query) return true;
  const haystack = [c.name, c.field, c.address, c.description, c.whyFit, c.contactPerson].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query.toLowerCase());
}
function isMedtech(c) { return (c.tags || []).some(t => MEDTECH_TAGS.includes(t)); }
function hasResponded(c) { return !!firstResponseEvent(c) || ['Vorstellungsgespräch', 'Zusage', 'Absage'].includes(c.status); }

const PHASE_FILTERS = {
  all: () => true,
  'not-applied': c => !c.applicationDate,
  applied: c => !!c.applicationDate,
  responded: c => hasResponded(c),
  rejected: c => c.status === 'Absage',
  followup: c => needsFollowUp(c),
};
const PHASE_OPTIONS = [
  { key: 'all', label: 'Alle Bewerbungsphasen' },
  { key: 'not-applied', label: 'Noch nicht beworben' },
  { key: 'applied', label: 'Bereits beworben' },
  { key: 'responded', label: 'Antwort erhalten' },
  { key: 'rejected', label: 'Absage' },
  { key: 'followup', label: 'Follow-up erforderlich' },
];

function passesToolbarFilters(c) {
  if (UI.followupOnly && !needsFollowUp(c)) return false;
  if (UI.docsOnly && !(c.documents && c.documents[c.primaryDocument || DEFAULT_PRIMARY_DOCUMENT])) return false;
  if (UI.initiativOnly && !c.initiativPossible) return false;
  if (UI.concreteOnly && !c.concretePosition) return false;
  if (UI.tags.size > 0 && !(c.tags || []).some(t => UI.tags.has(t))) return false;
  if (UI.statusFilter !== 'all' && c.status !== UI.statusFilter) return false;
  if (UI.phaseFilter !== 'all' && !(PHASE_FILTERS[UI.phaseFilter] || PHASE_FILTERS.all)(c)) return false;
  if (!matchesSearch(c, UI.search)) return false;
  return true;
}
function sortCompanies(list) {
  const sorters = {
    score: (a, b) => (computeScore(b) ?? -1) - (computeScore(a) ?? -1),
    fit: (a, b) => ((b.scoreBreakdown?.fit ?? -1) - (a.scoreBreakdown?.fit ?? -1)) || ((computeScore(b) ?? -1) - (computeScore(a) ?? -1)),
    priority: (a, b) => a.priority - b.priority,
    medtechFirst: (a, b) => (isMedtech(b) - isMedtech(a)) || ((computeScore(b) ?? -1) - (computeScore(a) ?? -1)),
    name: (a, b) => a.name.localeCompare(b.name, 'de'),
    commute: (a, b) => parseCommuteMinutes(a.commute) - parseCommuteMinutes(b.commute),
    addedDate: (a, b) => (b.addedDate || '').localeCompare(a.addedDate || ''),
    status: (a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99),
    applicationDate: (a, b) => (b.applicationDate || '').localeCompare(a.applicationDate || ''),
    followUpDate: (a, b) => (a.followUpDate || '9999').localeCompare(b.followUpDate || '9999'),
    lastChanged: (a, b) => (lastChangedDate(b) || '').localeCompare(lastChangedDate(a) || ''),
  };
  return list.slice().sort(sorters[UI.sort] || sorters.score);
}
function activeCompanies() { return DATA.companies.filter(c => c.category !== 'tum-backup'); }

// ========================================================= Unternehmen page

function showCompanyList() {
  NAV.companyId = null;
  document.getElementById('unternehmenList').hidden = false;
  document.getElementById('unternehmenDetail').hidden = true;
}
function showCompanyDetail(id) {
  NAV.companyId = id;
  document.getElementById('unternehmenList').hidden = true;
  const detail = document.getElementById('unternehmenDetail');
  detail.hidden = false;
  renderCompanyDetail(companyById(id));
}

function renderUnternehmenPage() {
  if (NAV.companyId) { renderCompanyDetail(companyById(NAV.companyId)); return; }
  const industryPool = DATA.companies.filter(c => c.category !== 'tum-backup');
  const backupPool = DATA.companies.filter(c => c.category === 'tum-backup');
  const showActive = UI.categoryFilter === 'all' || UI.categoryFilter !== 'tum-backup';
  const showBackup = UI.categoryFilter === 'all' || UI.categoryFilter === 'tum-backup';
  const activeList = showActive ? industryPool.filter(c => UI.categoryFilter === 'all' || c.category === UI.categoryFilter) : [];
  const backupList = showBackup ? backupPool : [];

  const filtered1 = sortCompanies(activeList.filter(passesToolbarFilters));
  const filtered2 = sortCompanies(backupList.filter(passesToolbarFilters));
  const cardsEl = document.getElementById('cards');
  cardsEl.innerHTML = filtered1.map(renderCompanyCard).join('');
  document.getElementById('cardsEmpty').hidden = filtered1.length > 0 || activeList.length === 0;
  document.getElementById('backupCards').innerHTML = filtered2.map(renderCompanyCard).join('');
  document.getElementById('resultCount').textContent = `${filtered1.length + filtered2.length} Firma(en) angezeigt`;

  cardsEl.parentElement.querySelectorAll('.company-card').forEach(el => {
    el.addEventListener('click', () => showCompanyDetail(el.dataset.id));
  });
}

function renderCompanyCard(c) {
  const score = computeScore(c);
  const followUp = needsFollowUp(c);
  const isDead = c.status === DEAD_STATUS;
  return `
    <div class="company-card${isDead ? ' dead' : ''}" data-id="${c.id}">
      <div class="cc-top">
        <div class="cc-left">
          <div class="logo-avatar" style="background:${colorForId(c.id)}">${c.logoInitials || c.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <div class="cc-name-row">
              ${score !== null ? `<span class="score-badge ${scoreBand(score)}">${score}</span>` : ''}
              <h3 class="cc-name">${c.name}</h3>
              <span class="status-pill ${STATUS_CLASS[c.status] || ''}">${c.status}</span>
            </div>
            <div class="cc-field">${c.field || ''}</div>
          </div>
        </div>
      </div>
      <div class="cc-meta-row">
        <span><b>Standort:</b> ${c.address || '–'}</span>
        <span><b>Fahrzeit:</b> ${c.commute || '–'}</span>
        <span><b>Priorität:</b> ${c.priority}</span>
      </div>
      ${(c.tags && c.tags.length) ? `<div class="cc-tags">${c.tags.map(t => `<span class="mini-tag${MEDTECH_TAGS.includes(t) ? ' medtech' : ''}">${TAG_LABEL[t] || t}</span>`).join('')}</div>` : ''}
      ${followUp ? `<div class="followup-badge${daysBetween(c.followUpDate || c.applicationDate, todayISO()) > 0 ? ' overdue' : ''}">Nachfassen empfohlen</div>` : ''}
    </div>`;
}

function renderCompanyDetail(c) {
  const wrap = document.getElementById('unternehmenDetail');
  const score = computeScore(c);
  wrap.innerHTML = `
    <button class="detail-back" id="backToList">← Zurück zur Liste</button>
    <div class="glass-card" style="padding:22px;">
      <div class="detail-header">
        <div class="logo-avatar" style="background:${colorForId(c.id)}">${c.logoInitials || c.name.slice(0, 2).toUpperCase()}</div>
        <div style="flex:1; min-width:240px;">
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            ${score !== null ? `<span class="score-badge ${scoreBand(score)}">${score}</span>` : ''}
            <h2 class="detail-title">${c.name}</h2>
            <span class="tag">${categoryLabel(c.category)}</span>
          </div>
          <div class="detail-field">${c.field || ''}</div>
        </div>
        <div class="detail-controls">
          <select class="status-select" id="detailStatus">${STATUSES.map(s => `<option value="${s}" ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <div style="font-size:11.5px; color:var(--text-muted);">Priorität <input type="number" id="detailPriority" value="${c.priority}" min="1" style="width:48px; background:var(--surface); border:1px solid var(--border); border-radius:6px; color:var(--text); padding:3px 6px;"></div>
        </div>
      </div>
      ${needsFollowUp(c) ? '<div class="followup-badge">Nachfassen empfohlen (≥14 Tage ohne Rückmeldung)</div>' : ''}

      <div class="badge-row">
        ${(c.tags || []).map(t => `<span class="mini-tag${MEDTECH_TAGS.includes(t) ? ' medtech' : ''}">${TAG_LABEL[t] || t}</span>`).join('')}
        <span class="mini-flag${c.initiativPossible ? ' on' : ''}">${c.initiativPossible ? '✓' : '–'} Initiativbewerbung möglich</span>
        <span class="mini-flag${c.concretePosition ? ' on' : ''}">${c.concretePosition ? '✓' : '–'} Konkrete Stelle vorhanden</span>
      </div>

      <div class="field-grid">
        ${fieldItem('Standort', c.address ? `<a href="${c.mapsUrl}" target="_blank">${c.address} ↗</a>` : '–')}
        ${fieldItem('Fahrzeit / Entfernung', c.commute || '–')}
        ${fieldItem('Ansprechpartner', c.contactPerson || '–')}
        ${fieldItem('Telefonnummer', c.phone ? `<a href="tel:${escapeAttr(c.phone.replace(/[^\d+]/g, ''))}">${c.phone}</a> <button class="btn btn-sm" data-copy="${escapeAttr(c.phone)}">Kopieren</button><span class="copy-feedback" data-copy-feedback></span>` : '<span class="field-item unverified" style="display:inline">nicht verifiziert</span>')}
        ${fieldItem('E-Mail-Adresse', c.email ? `<a href="mailto:${c.email}">${c.email}</a> <button class="btn btn-sm" data-copy="${escapeAttr(c.email)}">Kopieren</button>` : '<span class="field-item unverified" style="display:inline">nicht verifiziert</span>')}
        ${fieldItem('Bewerbungsdatum', `<input type="date" id="detailAppDate" value="${c.applicationDate || ''}">`)}
        ${fieldItem('Erwartetes Nachfassdatum', `<input type="date" id="detailFollowupDate" value="${c.followUpDate || ''}">`)}
        ${fieldItem('Letzte Aktivität', lastChangedDate(c) ? fmtDate(lastChangedDate(c)) : 'noch keine')}
      </div>
      ${c.contactMeta && (c.contactMeta.lastChecked || c.contactMeta.sourceNote) ? `<p class="contact-source-note">Kontaktdaten geprüft am ${c.contactMeta.lastChecked ? fmtDate(c.contactMeta.lastChecked) : '–'}${c.contactMeta.sourceNote ? ' · ' + escapeHtml(c.contactMeta.sourceNote) : ''}</p>` : ''}

      <div class="btn-row" style="margin:16px 0;">
        ${c.website ? `<a class="btn" href="${c.website}" target="_blank">🌐 Website öffnen</a>` : ''}
        ${c.careerPortal ? `<a class="btn" href="${c.careerPortal}" target="_blank">🧭 Karriereportal öffnen</a>` : ''}
        ${c.jobPostingUrl ? `<a class="btn" href="${c.jobPostingUrl}" target="_blank">📌 Stellenanzeige öffnen</a>` : ''}
        ${c.address ? `<a class="btn" href="${c.mapsUrl}" target="_blank">📍 Google Maps</a>` : ''}
        ${c.email ? `<button class="btn" data-mailto="${c.id}">✉️ E-Mail schreiben</button>` : ''}
        ${c.phone ? `<button class="btn" data-copy="${escapeAttr(c.phone)}">📋 Telefonnummer kopieren</button>` : ''}
      </div>
      ${c.jobPostingTitle ? `<p style="font-size:12px; color:var(--text-muted); margin-top:-8px;">Referenzierte Anzeige: „${c.jobPostingTitle}“</p>` : (c.category !== 'tum-backup' ? '<p style="font-size:12px; color:var(--text-faint); margin-top:-8px; font-style:italic;">Keine konkrete Stellenanzeige gefunden — Initiativbewerbung.</p>' : '')}

      ${c.description ? `<div class="prose-box">${escapeHtml(c.description)}</div>` : ''}
      ${c.whyFit ? `<div class="prose-box why"><b>Warum passt die Firma zu mir?</b><br>${escapeHtml(c.whyFit)}</div>` : ''}

      ${(c.pros && c.pros.length) ? `
      <details class="section-collapse" open>
        <summary>Vor- und Nachteile</summary>
        <div class="pros-cons">
          <div class="pros"><div class="h">Vorteile</div><ul>${c.pros.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul></div>
          <div class="cons"><div class="h">Nachteile</div><ul>${(c.cons || []).map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul></div>
        </div>
      </details>` : ''}

      ${renderScoreBreakdown(c)}

      <hr class="divider">
      ${renderBewerbungsmappeBox(c)}
      ${renderEmailWorkflowBox(c)}
      ${renderPhoneWorkflowBox(c)}

      <hr class="divider">
      <div class="section-block-title">Timeline</div>
      ${renderTimeline(c)}

      <hr class="divider">
      <div class="section-block-title">Notizen</div>
      <textarea class="notes" id="detailNotes" placeholder="Notizen (Kontaktperson, Rückmeldung, Besonderheiten ...)">${c.notes || ''}</textarea>
    </div>`;

  document.getElementById('backToList').addEventListener('click', showCompanyList);
  attachDetailHandlers(wrap, c);
}
function categoryLabel(cat) { return { industry: 'Industrie', medtech: 'Medizintechnik', fraunhofer: 'Fraunhofer', research: 'Forschungseinrichtung', 'tum-backup': 'TUM-Backup' }[cat] || cat; }
function fieldItem(label, valueHtml) { return `<div class="field-item"><label>${label}</label><div class="field-value">${valueHtml}</div></div>`; }

function renderBewerbungsmappeBox(c) {
  const docs = c.documents || {};
  const primaryKey = c.primaryDocument || DEFAULT_PRIMARY_DOCUMENT;
  const primaryPath = docs[primaryKey];
  const present = !!primaryPath;
  const opts = c.mappeOptions || {};
  const subLinks = Object.keys(docs).filter(k => k !== primaryKey).map(k => `<a href="/${docs[k]}" target="_blank">${DOCUMENT_LABELS[k] || k}</a>`).join('');
  const optionRows = OPTIONAL_MAPPE_DOCS.map(o => `
    <label class="mappe-opt${o.path ? '' : ' disabled'}">
      <input type="checkbox" class="mappe-opt-check" data-opt="${o.key}" ${opts[o.key] ? 'checked' : ''} ${o.path ? '' : 'disabled'}>
      <span>${o.label}</span>
      ${o.path ? '' : '<span class="mini-flag">Datei fehlt noch</span>'}
    </label>`).join('');
  return `
    <div class="doc-box">
      <div class="doc-box-header">
        <span class="doc-box-title">📄 Bewerbungsmappe</span>
        <span class="doc-status ${present ? 'present' : 'missing'}">${present ? 'Datei vorhanden' : 'Datei fehlt'}</span>
      </div>
      ${present ? `<div class="doc-meta">Dateiname: <b>${fileNameFromPath(primaryPath)}</b><br>Speicherort: ${primaryPath}</div>` : '<div class="doc-meta">Noch nicht generiert — auf „Neu generieren“ klicken.</div>'}
      <div class="doc-meta" style="margin-top:10px;">Standard-Inhalt: Anschreiben, Lebenslauf, Notenübersicht. Zusätzlich mitschicken (wird beim E-Mail-Versand als eigene, separate Datei angehängt — für eine gemeinsame PDF stattdessen unten "Neue Version generieren" klicken):</div>
      <div class="mappe-opts">${optionRows}</div>
      <div class="btn-row" style="margin-top:12px;">
        ${present ? `<a class="btn btn-primary" href="/${primaryPath}" target="_blank">Öffnen</a>` : ''}
        ${window.electronAPI ? `<button class="btn finder-btn" data-folder="Bewerbungen/${c.folder}">Im Finder anzeigen</button>` : ''}
        <button class="btn replace-btn" data-doc="${primaryKey}">Datei ersetzen</button>
        <button class="btn regen-btn">Neue Version generieren</button>
        <input type="file" accept="application/pdf" class="replace-input" data-doc="${primaryKey}">
        ${present ? `<button class="btn" data-copy-path="/${primaryPath}">Pfad kopieren</button>` : ''}
      </div>
      <div class="doc-sub-links">${subLinks}</div>
      <div class="doc-status-msg" id="docStatusMsg"></div>
    </div>`;
}

function renderEmailWorkflowBox(c) {
  const primaryKey = c.primaryDocument || DEFAULT_PRIMARY_DOCUMENT;
  const primaryPath = (c.documents || {})[primaryKey];
  const emlPath = (c.documents || {}).email_eml;
  const alreadySent = !!c.applicationDate;
  const hasEmail = !!c.email;
  const hasPortal = !!c.careerPortal;
  if (!hasEmail && !hasPortal) return '';

  return `
    <div class="doc-box">
      <div class="doc-box-header"><span class="doc-box-title">✉️ ${hasEmail ? 'E-Mail-Workflow' : 'Bewerbungsportal'}</span></div>
      ${hasEmail ? `
      <p style="font-size:12px; color:var(--text-muted); margin:0 0 10px;">
        ${window.electronAPI
          ? '„Mail-Entwurf mit Anhang öffnen“ öffnet ein echtes, bearbeitbares Mail.app-Fenster mit Empfänger, Betreff, Text und der Bewerbungsmappe bereits angehängt — dort nur noch kurz prüfen und selbst auf Senden klicken. (Ein bloß geöffnetes .eml zeigt in Mail.app nur eine Vorschau ohne Senden-Button — deshalb dieser Weg.)'
          : 'Bester Weg: „.eml mit Anhang erzeugen“ legt eine fertige E-Mail inkl. Bewerbungsmappe als Anhang an. Browser können .eml-Dateien meist nur herunterladen, nicht direkt als Entwurf öffnen — die heruntergeladene Datei danach in Mail/Outlook öffnen und dort senden.'}
        mailto: bleibt als Fallback (öffnet ohne Anhang, Anhang danach manuell hinzufügen; technisch bedingt, mailto: kann keine Dateien anhängen).
      </p>
      <div class="btn-row">
        <button class="btn btn-primary" id="prepEmlBtn">${window.electronAPI ? '✉️ Mail-Entwurf mit Anhang öffnen' : '📎 .eml mit Anhang erzeugen'}</button>
        <button class="btn" id="prepMailBtn">mailto: öffnen (ohne Anhang)</button>
        <button class="btn" id="markSentBtn" ${alreadySent ? 'disabled' : ''}>${alreadySent ? '✓ Bereits als versendet markiert' : 'Als versendet markieren'}</button>
      </div>
      <div class="btn-row" style="margin-top:8px;">
        <button class="btn btn-sm" data-copy="${escapeAttr(c.email)}">E-Mail-Adresse kopieren</button>
        <button class="btn btn-sm" id="copyEmailTextBtn">E-Mail-Text kopieren</button>
        ${emlPath ? `<a class="btn btn-sm" href="/${emlPath}" target="_blank">.eml öffnen/erneut ansehen</a>` : ''}
        ${window.electronAPI && emlPath ? `<button class="btn btn-sm finder-btn" data-folder="Bewerbungen/${c.folder}">.eml im Finder anzeigen</button>` : ''}
      </div>
      <span class="copy-feedback" id="emailCopyFeedback"></span>
      ` : `<p style="font-size:12px; color:var(--text-muted); margin:10px 0 4px;">Keine bestätigte E-Mail-Adresse vorhanden — Bewerbung über das Portal einreichen, Bewerbungsmappe dort hochladen:</p>
      <div class="btn-row"><a class="btn btn-primary" id="prepPortalBtn" href="${c.careerPortal}" target="_blank">Bewerbungsportal öffnen</a>
      <button class="btn" id="markSentBtn" ${alreadySent ? 'disabled' : ''}>${alreadySent ? '✓ Bereits als versendet markiert' : 'Als versendet markieren'}</button></div>`}
      <p style="font-size:12.5px; margin:12px 0 6px;"><b>${primaryPath ? `Bewerbungsmappe: ${fileNameFromPath(primaryPath)}` : 'Bewerbungsmappe fehlt noch — bitte zuerst generieren.'}</b></p>
      <div class="btn-row">
        ${primaryPath ? `<a class="btn btn-sm" href="/${primaryPath}" target="_blank">Bewerbungsmappe öffnen</a>` : ''}
        ${window.electronAPI && primaryPath ? `<button class="btn btn-sm finder-btn" data-folder="Bewerbungen/${c.folder}">Im Finder anzeigen</button>` : ''}
        ${primaryPath ? `<button class="btn btn-sm" data-copy-path="/${primaryPath}">Dateipfad kopieren</button>` : ''}
      </div>
      ${hasEmail ? `<details class="section-collapse"><summary>E-Mail-Entwurf anzeigen/bearbeiten</summary>
        <div style="margin-top:8px;">
          <div class="field-item" style="margin-bottom:8px;"><label>Betreff</label><input type="text" id="emailSubjectInput" value="${escapeAttr(c.emailSubject || '')}"></div>
          <textarea class="notes" id="emailBodyInput" rows="7">${c.emailBody || ''}</textarea>
          <p style="font-size:11px; color:var(--text-faint); margin-top:6px;">Änderungen hier wirken sich erst nach erneutem Erzeugen des .eml-Entwurfs auf die Anhang-Mail aus.</p>
        </div>
      </details>` : ''}
    </div>`;
}

function renderPhoneWorkflowBox(c) {
  if (!c.phone && !c.callNotes) return '';
  const telHref = c.phone ? `tel:${c.phone.replace(/[^\d+]/g, '')}` : '';
  return `
    <div class="doc-box">
      <div class="doc-box-header"><span class="doc-box-title">📞 Telefon-Workflow</span></div>
      ${c.phone ? `
      <div class="btn-row">
        <a class="btn btn-primary" href="${telHref}">Anrufen (${c.phone})</a>
        <button class="btn" data-copy="${escapeAttr(c.phone)}">Nummer kopieren</button>
      </div>` : '<p class="mini-empty">Keine Telefonnummer hinterlegt.</p>'}
      <details class="section-collapse"><summary>Gesprächsleitfaden</summary>
        <ul style="font-size:12.5px; line-height:1.7; margin:8px 0 0; padding-left:18px;">
          <li>Vorstellen: Name, Studiengang (Mechatronik, Schwerpunkt Medizintechnik, HM), Anliegen (Praxissemester ca. 19 Wochen, Frühjahr/Sommer 2027).</li>
          <li>Fragen, ob grundsätzlich Interesse an einer Praktikant:in besteht bzw. wer dafür zuständig ist.</li>
          <li>Nach dem passenden Bewerbungsweg fragen (E-Mail-Adresse, Ansprechperson, Portal).</li>
          <li>Falls Interesse: Zeitraum und einen echten HM-Praktikumsvertrag (kein Werk-/Hiwi-Vertrag) ansprechen.</li>
          <li>Für Rückfragen die eigene Telefonnummer/E-Mail hinterlassen, Ergebnis direkt danach unten notieren.</li>
        </ul>
      </details>
      <div class="field-item" style="margin-top:10px;">
        <label>Gesprächsnotiz / Ergebnis</label>
        <textarea class="notes" id="detailCallNotes" rows="3" placeholder="z. B. Datum, Ansprechpartner, Ergebnis des Telefonats …">${c.callNotes || ''}</textarea>
      </div>
    </div>`;
}

function attachDetailHandlers(root, c) {
  root.querySelector('#detailStatus')?.addEventListener('change', (e) => {
    setCompanyStatus(c, e.target.value);
    scheduleSave();
    renderCompanyDetail(c);
    renderNavBadges();
  });
  root.querySelector('#detailPriority')?.addEventListener('change', (e) => {
    c.priority = parseInt(e.target.value) || c.priority;
    scheduleSave();
  });
  root.querySelector('#detailAppDate')?.addEventListener('change', (e) => {
    c.applicationDate = e.target.value || null;
    scheduleSave();
    renderCompanyDetail(c);
  });
  root.querySelector('#detailFollowupDate')?.addEventListener('change', (e) => {
    c.followUpDate = e.target.value || null;
    scheduleSave();
  });
  root.querySelector('#detailNotes')?.addEventListener('input', (e) => {
    c.notes = e.target.value;
    scheduleSave();
  });
  root.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', (e) => {
    copyToClipboard(e.target.dataset.copy, root.querySelector('[data-copy-feedback]'));
  }));
  root.querySelectorAll('[data-copy-path]').forEach(btn => btn.addEventListener('click', (e) => {
    copyToClipboard(location.origin + e.target.dataset.copyPath);
    const msg = root.querySelector('#docStatusMsg');
    if (msg) { msg.textContent = '✓ Pfad kopiert'; setTimeout(() => msg.textContent = '', 1800); }
  }));
  root.querySelector('[data-mailto]')?.addEventListener('click', () => openMailto(c));
  root.querySelector('#prepMailBtn')?.addEventListener('click', () => openMailto(c));
  root.querySelector('#markSentBtn')?.addEventListener('click', () => {
    setCompanyStatus(c, 'Beworben');
    scheduleSave();
    renderCompanyDetail(c);
    renderNavBadges();
  });
  root.querySelector('#emailSubjectInput')?.addEventListener('input', (e) => { c.emailSubject = e.target.value; scheduleSave(); });
  root.querySelector('#emailBodyInput')?.addEventListener('input', (e) => { c.emailBody = e.target.value; scheduleSave(); });
  root.querySelector('#copyEmailTextBtn')?.addEventListener('click', () => {
    copyToClipboard(`${c.emailSubject || ''}\n\n${c.emailBody || ''}`, root.querySelector('#emailCopyFeedback'));
  });
  root.querySelector('#detailCallNotes')?.addEventListener('input', (e) => { c.callNotes = e.target.value; scheduleSave(); });
  root.querySelector('#prepEmlBtn')?.addEventListener('click', async (e) => {
    const btn = e.target;
    const feedback = root.querySelector('#emailCopyFeedback');
    btn.disabled = true;
    if (feedback) feedback.textContent = window.electronAPI ? 'Öffne Mail-Entwurf …' : 'Erzeuge .eml …';
    try {
      const primaryKey = c.primaryDocument || DEFAULT_PRIMARY_DOCUMENT;
      // Same checkboxes that control the merged Bewerbungsmappe also decide what
      // goes along as an extra, separate attachment - simpler and more robust than
      // requiring a merge/regenerate step just to get the Abitur into the email.
      const opts = c.mappeOptions || {};
      const extraKeys = [];
      if (opts.includeAbitur) extraKeys.push('abitur');
      if (opts.includeImmatrikulation) extraKeys.push('immatrikulation');
      // .eml is still generated as an on-disk record even in Electron (useful as an
      // archive / for other mail clients) - but a bare .eml only opens as a read-only
      // Mail.app preview with no Send button, so Electron takes a second, better path.
      const res = await fetchWithTimeout(`/api/companies/${encodeURIComponent(c.id)}/prepare-email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docs: [primaryKey], extra: extraKeys }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await loadData();
      const fresh = companyById(c.id);
      if (window.electronAPI && window.electronAPI.createMailDraft) {
        const draftRes = await window.electronAPI.createMailDraft({
          to: c.email, subject: c.emailSubject || '', body: c.emailBody || '', attachmentPaths: json.attached || [],
        });
        if (feedback) feedback.textContent = draftRes.ok
          ? `✓ Mail-Entwurf geöffnet — ${(json.attached || []).length} Anhang/Anhänge bereits drin, bitte prüfen und selbst senden`
          : ('Fehler beim Öffnen des Mail-Entwurfs: ' + draftRes.error);
      } else if (window.electronAPI) {
        const openRes = await window.electronAPI.openPath(json.path);
        if (feedback) feedback.textContent = openRes.ok ? '✓ .eml erzeugt und geöffnet' : ('Erzeugt, aber Öffnen fehlgeschlagen: ' + openRes.error);
      } else {
        window.open('/' + json.path, '_blank');
        if (feedback) feedback.textContent = '✓ .eml erzeugt — Download prüfen und in Mail/Outlook öffnen';
      }
      renderCompanyDetail(fresh);
    } catch (err) {
      if (feedback) feedback.textContent = 'Fehler: ' + err.message;
      btn.disabled = false;
    }
  });

  attachDocAndTimelineHandlers(root, c);
}

function openMailto(c) {
  const url = `mailto:${c.email}?subject=${encodeURIComponent(c.emailSubject || '')}&body=${encodeURIComponent(c.emailBody || '')}`;
  if (window.electronAPI) window.electronAPI.openExternal(url); else window.location.href = url;
}

// ------------------------------------------------------- shared doc/timeline

async function regenerateDocuments(c, msgEl) {
  if (msgEl) msgEl.textContent = 'Generiere neu …';
  try {
    // mappeOptions must be on disk before generate.py (a separate process) reads
    // companies.json, otherwise a just-toggled checkbox would be ignored this round.
    clearTimeout(saveTimer);
    await persist();
    const res = await fetchWithTimeout(`/api/companies/${encodeURIComponent(c.id)}/regenerate`, { method: 'POST' });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    addTimelineEvent(c, 'datei_ersetzt', 'Neu generiert');
    await loadData();
    const fresh = companyById(c.id);
    if (msgEl) msgEl.textContent = '✓ Neu generiert (' + new Date().toLocaleTimeString('de-DE') + ')';
    renderCompanyDetail(fresh);
    renderNavBadges();
  } catch (err) {
    if (msgEl) msgEl.textContent = 'Fehler: ' + err.message;
  }
}

function attachDocAndTimelineHandlers(root, c) {
  const msgEl = root.querySelector('#docStatusMsg');
  root.querySelectorAll('.mappe-opt-check').forEach(cb => cb.addEventListener('change', (e) => {
    c.mappeOptions = c.mappeOptions || {};
    c.mappeOptions[e.target.dataset.opt] = e.target.checked;
    // Deliberately NOT merged into the Bewerbungsmappe PDF automatically: the
    // checkbox now just decides what gets sent as an extra, separate e-mail
    // attachment (see prepEmlBtn) - simpler and more robust than depending on
    // a regenerate step. "Neue Version generieren" still merges it into one
    // PDF for people who explicitly want that (e.g. for a portal upload).
    scheduleSave();
  }));
  root.querySelector('.regen-btn')?.addEventListener('click', () => regenerateDocuments(c, msgEl));
  root.querySelector('.replace-btn')?.addEventListener('click', () => root.querySelector('.replace-input').click());
  root.querySelector('.replace-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const docKey = e.target.dataset.doc;
    if (msgEl) msgEl.textContent = 'Lade hoch …';
    try {
      const buf = await file.arrayBuffer();
      const res = await fetchWithTimeout(`/api/companies/${encodeURIComponent(c.id)}/replace-document?doc=${encodeURIComponent(docKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: buf,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      addTimelineEvent(c, 'datei_ersetzt', file.name);
      scheduleSave();
      if (msgEl) msgEl.textContent = '✓ Ersetzt (' + file.name + ')';
      renderCompanyDetail(c);
    } catch (err) {
      if (msgEl) msgEl.textContent = 'Fehler: ' + err.message;
    }
  });
  root.querySelectorAll('.finder-btn').forEach(btn => btn.addEventListener('click', async (e) => {
    const res = await window.electronAPI.showInFinder(e.target.dataset.folder);
    if (msgEl && !res.ok) msgEl.textContent = 'Fehler: ' + res.error;
  }));

  root.querySelector('.tl-add-btn')?.addEventListener('click', () => {
    const type = root.querySelector('.tl-type').value;
    const date = root.querySelector('.tl-date-input').value || todayISO();
    addTimelineEvent(c, type);
    c.timeline[c.timeline.length - 1].date = date;
    if (type === 'zusage') setCompanyStatus(c, 'Zusage', { skipTimeline: true });
    if (type === 'absage') setCompanyStatus(c, 'Absage', { skipTimeline: true });
    if (type === 'interview') setCompanyStatus(c, 'Vorstellungsgespräch', { skipTimeline: true });
    if (type === 'eingangsbestaetigung') setCompanyStatus(c, 'Eingangsbestätigung erhalten', { skipTimeline: true });
    if (type === 'rueckfrage') setCompanyStatus(c, 'Rückfrage', { skipTimeline: true });
    scheduleSave();
    renderCompanyDetail(c);
    renderNavBadges();
  });
}

function renderTimeline(c) {
  const chips = (c.timeline || []).slice().sort((a, b) => a.date.localeCompare(b.date)).map(ev =>
    `<span class="tl-chip"><b>${TL_LABEL[ev.type] || ev.type}</b><span class="tl-date">${fmtDate(ev.date)}</span></span>`
  ).join('');
  const options = TIMELINE_TYPES.map(t => `<option value="${t.type}">${t.label}</option>`).join('');
  return `
    <div class="timeline">${chips || '<span class="tl-chip">Noch keine Ereignisse</span>'}</div>
    <div class="tl-add">
      <select class="tl-type">${options}</select>
      <input type="date" class="tl-date-input" value="${todayISO()}">
      <button class="btn btn-sm tl-add-btn">+ Ereignis hinzufügen</button>
    </div>`;
}

// ========================================================= Bewerbungen page

function renderBewerbungenBoard() {
  const groups = STATUSES;
  const wrap = document.getElementById('bewerbungenBoard');
  wrap.innerHTML = groups.map(status => {
    const items = DATA.companies.filter(c => c.status === status);
    if (!items.length) return '';
    return `
      <div class="section-block">
        <div class="section-block-title">${status} <span style="color:var(--text-faint); font-weight:400;">(${items.length})</span></div>
        <div class="company-list">${sortCompanies(items).map(renderCompanyCard).join('')}</div>
      </div>`;
  }).join('') || '<p class="empty-state">Keine Firmen vorhanden.</p>';
  wrap.querySelectorAll('.company-card').forEach(el => el.addEventListener('click', () => {
    switchPage('unternehmen');
    showCompanyDetail(el.dataset.id);
  }));
}

// ========================================================== Nachfassen page

function renderNachfassen() {
  const cs = DATA.companies.filter(c => c.category !== 'tum-backup' || c.followUpDate);
  const overdue = [], today = [], week = [], done = [];
  cs.forEach(c => {
    if (needsFollowUp(c) || (c.followUpDate && c.followUpDate < todayISO())) {
      if (c.followUpDate && c.followUpDate < todayISO()) overdue.push(c);
      else if (c.followUpDate === todayISO()) today.push(c);
    } else if (c.followUpDate && daysBetween(todayISO(), c.followUpDate) <= 7 && daysBetween(todayISO(), c.followUpDate) >= 0) {
      week.push(c);
    } else if (c.applicationDate && !needsFollowUp(c)) {
      done.push(c);
    }
  });
  const listHtml = (items, emptyMsg) => items.length
    ? items.map(c => `<li data-goto-company="${c.id}"><span class="ml-main">${c.name}</span><span class="ml-sub">${c.followUpDate ? fmtDate(c.followUpDate) : '–'}</span></li>`).join('')
    : `<li class="mini-empty">${emptyMsg}</li>`;
  document.getElementById('nfOverdue').innerHTML = listHtml(overdue, 'Nichts überfällig.');
  document.getElementById('nfToday').innerHTML = listHtml(today, 'Heute nichts fällig.');
  document.getElementById('nfWeek').innerHTML = listHtml(week, 'Nächste 7 Tage: nichts geplant.');
  document.getElementById('nfDone').innerHTML = listHtml(done, 'Noch nichts erledigt.');
  wireGotoButtons(document.getElementById('page-nachfassen'));
}

// =========================================================== Dokumente page

function renderDokumente() {
  const missing = REQUIRED_DOCS_CHECKLIST.filter(d => !d.present);
  const checklistEl = document.getElementById('missingDocsChecklist');
  if (checklistEl) {
    checklistEl.innerHTML = REQUIRED_DOCS_CHECKLIST.map(d => `
      <div class="checklist-row ${d.present ? 'ok' : 'missing'}">
        <span class="checklist-icon">${d.present ? '✓' : '✗'}</span>
        <div class="checklist-row-body">
          <span class="checklist-row-label">${d.label}${d.external ? ' <span class="mini-tag">extern</span>' : ''}</span>
          ${d.note ? `<span class="checklist-row-note">${escapeHtml(d.note)}</span>` : ''}
        </div>
        ${d.path ? `<a class="btn btn-sm" href="/${d.path}" target="_blank">Öffnen</a>` : ''}
        ${d.url ? `<a class="btn btn-sm" href="${d.url}" target="_blank">Öffnen</a>` : ''}
      </div>`).join('');
    const banner = document.getElementById('missingDocsBanner');
    if (banner) {
      banner.hidden = missing.length === 0;
      banner.textContent = missing.length
        ? `${missing.length} Unterlage(n) fehlen noch: ${missing.map(m => m.label).join(', ')}.`
        : '';
    }
  }

  document.getElementById('generalDocs').innerHTML = GENERAL_DOCS.map(d => `
    <div class="doc-box">
      <div class="doc-box-header">
        <span class="doc-box-title">${d.label}</span>
        <span class="doc-status ${d.path ? 'present' : 'missing'}">${d.path ? 'Datei vorhanden' : 'Datei fehlt'}</span>
      </div>
      ${d.path ? `<div class="doc-meta">${d.path}</div><div class="btn-row" style="margin-top:10px;"><a class="btn btn-sm" href="/${d.path}" target="_blank">Öffnen</a>${window.electronAPI ? `<button class="btn btn-sm finder-btn-general" data-path="${d.path}">Im Finder anzeigen</button>` : ''}</div>` : `<div class="doc-meta">${d.note || ''}</div>`}
    </div>`).join('');
  document.getElementById('generalDocs').querySelectorAll('.finder-btn-general').forEach(btn => {
    btn.addEventListener('click', (e) => window.electronAPI.showInFinder(e.target.dataset.path));
  });

  const companies = sortCompanies(DATA.companies.filter(c => c.documents));
  document.getElementById('docsPerCompany').innerHTML = companies.map(c => {
    const primaryKey = c.primaryDocument || DEFAULT_PRIMARY_DOCUMENT;
    const path = (c.documents || {})[primaryKey];
    return `
      <div class="company-card" data-id="${c.id}" style="cursor:default;">
        <div class="cc-top">
          <div class="cc-left">
            <div class="logo-avatar" style="background:${colorForId(c.id)}">${c.logoInitials || c.name.slice(0, 2).toUpperCase()}</div>
            <div><h3 class="cc-name">${c.name}</h3><div class="cc-field">${path ? fileNameFromPath(path) : 'Noch keine Bewerbungsmappe'}</div></div>
          </div>
          <div class="btn-row">
            ${path ? `<a class="btn btn-sm" href="/${path}" target="_blank">Öffnen</a>` : ''}
            ${window.electronAPI ? `<button class="btn btn-sm doc-finder-link" data-folder="Bewerbungen/${c.folder}">Im Finder</button>` : ''}
            <button class="btn btn-sm doc-detail-link" data-id="${c.id}">Zur Firma</button>
          </div>
        </div>
      </div>`;
  }).join('') || '<p class="empty-state">Keine Dokumente vorhanden.</p>';
  document.getElementById('docsPerCompany').querySelectorAll('.doc-detail-link').forEach(btn => btn.addEventListener('click', (e) => {
    switchPage('unternehmen'); showCompanyDetail(e.target.dataset.id);
  }));
  document.getElementById('docsPerCompany').querySelectorAll('.doc-finder-link').forEach(btn => btn.addEventListener('click', (e) => {
    window.electronAPI.showInFinder(e.target.dataset.folder);
  }));
}

// =========================================================== HM-Prozess page

function renderHmProzess() {
  const hm = DATA.hmInfo || {};
  const contact = hm.contact || {};
  document.getElementById('hmContact').innerHTML = `
    <div class="contact-card">
      <div class="contact-avatar">${(contact.name || '?').split(' ').filter(w => /^[A-ZÄÖÜ]/.test(w)).map(w => w[0]).slice(-2).join('')}</div>
      <div class="contact-details">
        <b>${contact.name || 'Unbekannt'} ${contact.emailVerified ? '<span class="verified-badge">✓ verifiziert</span>' : '<span class="unverified-badge">unbestätigt</span>'}</b>
        <span>${contact.role || ''}</span><br>
        <span>${contact.email ? `<a href="mailto:${contact.email}">${contact.email}</a>` : 'E-Mail noch aus offizieller HM-Quelle bestätigen'} · ${contact.phone || ''} ${contact.room ? '· Raum ' + contact.room : ''}</span>
        ${contact.emailSource ? `<div style="font-size:10.5px; color:var(--text-faint); margin-top:4px;">Quelle: ${contact.emailSource}</div>` : ''}
      </div>
    </div>`;

  const links = hm.links || {};
  const linkDefs = [
    ['PRIMUSS öffnen', links.primuss], ['HM-Hinweise zum Praxissemester', links.hmHinweisePdf],
    ['Fakultätsseite (FK06)', links.fakultaet], ['Ansprechpartner Prüfung & Praktikum', links.ansprechpartnerPP],
    ['Praktikantenbeauftragten kontaktieren', contact.email ? `mailto:${contact.email}?subject=${encodeURIComponent('Anfrage Tätigkeitsplan Praxissemester')}` : null],
  ];
  document.getElementById('hmLinks').innerHTML = linkDefs.map(([label, url]) =>
    url ? `<a class="btn" href="${url}" target="_blank">${label}</a>` : `<button class="btn" disabled title="Link noch zu bestätigen">${label} (unbestätigt)</button>`
  ).join('');

  document.getElementById('hmSteps').innerHTML = HM_STEPS.map(s => `<li>${s}</li>`).join('');
  document.getElementById('hmWarnings').innerHTML = HM_WARNINGS.map(w => `<li>⚠ ${w}</li>`).join('');

  const zusageCompanies = DATA.companies.filter(c => c.zusageChecklist);
  document.getElementById('hmChecklistsEmpty').hidden = zusageCompanies.length > 0;
  document.getElementById('hmChecklists').innerHTML = zusageCompanies.map(c => {
    const done = c.zusageChecklist.filter(i => i.done).length;
    return `
      <div class="glass-card" style="padding:16px; margin-bottom:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <b>${c.name}</b><span class="checklist-progress">${done}/${c.zusageChecklist.length} erledigt</span>
        </div>
        <div class="checklist" data-checklist-for="${c.id}">
          ${c.zusageChecklist.map((item, i) => `
            <label class="${item.done ? 'checked' : ''}"><input type="checkbox" data-idx="${i}" ${item.done ? 'checked' : ''}><span>${item.label}</span></label>
          `).join('')}
        </div>
      </div>`;
  }).join('');
  document.querySelectorAll('[data-checklist-for] input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const companyId = e.target.closest('[data-checklist-for]').dataset.checklistFor;
      const c = companyById(companyId);
      c.zusageChecklist[parseInt(e.target.dataset.idx)].done = e.target.checked;
      scheduleSave();
      renderHmProzess();
      if (NAV.page === 'dashboard') renderDashboard();
    });
  });
}

// =============================================================== Termine page

function renderTermine() {
  const items = DATA.companies.filter(c => c.followUpDate).map(c => ({ c, date: c.followUpDate, label: 'Nachfassen' }))
    .sort((a, b) => a.date.localeCompare(b.date));
  document.getElementById('terminList').innerHTML = items.length
    ? items.map(({ c, date, label }) => `<li data-goto-company="${c.id}"><span class="ml-main">${label}: ${c.name}</span><span class="ml-sub">${fmtDate(date)}</span></li>`).join('')
    : '<li class="mini-empty">Aktuell keine anstehenden Termine.</li>';
  wireGotoButtons(document.getElementById('page-termine'));
}

// ================================================================= Archiv page

function renderArchiv() {
  const wrap = document.getElementById('archivedCards');
  const archived = DATA.archived || [];
  const deadCompanies = DATA.companies.filter(c => c.status === DEAD_STATUS);
  wrap.innerHTML = archived.map(c => `
    <div class="company-card" style="cursor:default; opacity:.7;">
      <div class="cc-top"><div class="cc-left"><div><h3 class="cc-name">${c.name}</h3><div class="cc-field">${c.field}</div></div></div><span class="tag">Archiviert</span></div>
      <p style="font-size:12.5px; color:var(--text-muted); margin:10px 0 0;">${c.note}</p>
      ${c.docsPath ? `<div class="doc-meta">Abgelegt in: ${c.docsPath}</div>` : ''}
    </div>`).join('') +
    deadCompanies.map(c => `
    <div class="company-card dead" data-id="${c.id}">
      <div class="cc-top"><div class="cc-left"><div><h3 class="cc-name">${c.name}</h3><div class="cc-field">${c.field}</div></div></div><span class="status-pill ${STATUS_CLASS[DEAD_STATUS]}">${DEAD_STATUS}</span></div>
      <p style="font-size:12.5px; color:var(--text-muted); margin:10px 0 0;">${c.notes || ''}</p>
    </div>`).join('');
  if (!archived.length && !deadCompanies.length) wrap.innerHTML = '<p class="empty-state">Nichts archiviert.</p>';
  wrap.querySelectorAll('.company-card[data-id]').forEach(el => el.addEventListener('click', () => {
    switchPage('unternehmen'); showCompanyDetail(el.dataset.id);
  }));
}

// ============================================================ Einstellungen page

function renderEinstellungen() {
  document.getElementById('settingsDataInfo').innerHTML = `
    <p style="font-size:12.8px; color:var(--text-muted); line-height:1.6;">
      Alle Daten liegen dauerhaft in <code>praxissemester-tracker/data/companies.json</code> (atomar geschrieben,
      niemals als reines localStorage). Bewerbungsdokumente liegen in <code>Bewerbungen/&lt;Firma&gt;/</code>.
    </p>
    ${window.electronAPI ? '<button class="btn" id="openDataFolderBtn">Datenordner im Finder öffnen</button>' : ''}
  `;
  document.getElementById('openDataFolderBtn')?.addEventListener('click', () => window.electronAPI.showInFinder('praxissemester-tracker/data'));
  document.getElementById('settingsBackupInfo').innerHTML = `
    <p style="font-size:12.8px; color:var(--text-muted); line-height:1.6;">
      Vor jedem Speichern wird automatisch eine Sicherungskopie in <code>data/backups/</code> abgelegt
      (die letzten 30 Versionen bleiben erhalten, nichts wird ungefragt überschrieben).
    </p>
    ${window.electronAPI ? '<button class="btn" id="openBackupFolderBtn">Backup-Ordner öffnen</button>' : ''}
  `;
  document.getElementById('openBackupFolderBtn')?.addEventListener('click', () => window.electronAPI.showInFinder('praxissemester-tracker/data/backups'));
  renderSyncSettings();
}

// ------------------------------------------------------------ Cloud-Sync UI
// Rein additiv zur bestehenden Einstellungen-Seite - drei Zustände:
// nicht konfiguriert (config.js hat noch Platzhalter), konfiguriert aber
// nicht angemeldet, angemeldet (Status + manueller Sync-Button).
async function renderSyncSettings() {
  const el = document.getElementById('settingsSyncInfo');
  if (!el) return;

  if (!Sync.isConfigured()) {
    el.innerHTML = `<p style="font-size:12.8px; color:var(--text-muted); line-height:1.6;">
      Noch nicht eingerichtet. Trage Supabase-URL und anon key in <code>config.js</code> ein
      (siehe README, Abschnitt "Cloud-Sync einrichten"). Bis dahin funktioniert die App
      unverändert rein lokal.</p>`;
    return;
  }

  const session = await Sync.getSession();
  if (!session) {
    el.innerHTML = `
      <p style="font-size:12.8px; color:var(--text-muted); line-height:1.6; margin:0 0 12px;">
        Noch nicht angemeldet — ohne Anmeldung bleibt die App wie bisher rein lokal, es wird nichts
        in die Cloud übertragen.
      </p>
      <div class="field-item" style="margin-bottom:8px;"><label>E-Mail</label><input type="email" id="syncEmail"></div>
      <div class="field-item" style="margin-bottom:10px;"><label>Passwort</label><input type="password" id="syncPassword"></div>
      <div class="btn-row"><button class="btn btn-primary" id="syncLoginBtn">Anmelden</button><button class="btn" id="syncSignupBtn">Neu registrieren</button></div>
      <p id="syncSettingsMsg" style="font-size:12px; color:var(--text-muted); margin-top:10px;"></p>`;
    const msgEl = document.getElementById('syncSettingsMsg');
    document.getElementById('syncLoginBtn').addEventListener('click', async () => {
      msgEl.textContent = 'Melde an …';
      try {
        await Sync.signIn(document.getElementById('syncEmail').value.trim(), document.getElementById('syncPassword').value);
        setupRealtimeSync();
        renderSyncSettings();
      } catch (e) { msgEl.textContent = 'Fehler: ' + e.message; }
    });
    document.getElementById('syncSignupBtn').addEventListener('click', async () => {
      msgEl.textContent = 'Registriere …';
      try {
        const { needsEmailConfirmation } = await Sync.signUp(document.getElementById('syncEmail').value.trim(), document.getElementById('syncPassword').value);
        msgEl.textContent = needsEmailConfirmation ? '✓ Bitte Bestätigungslink in der E-Mail öffnen, danach hier anmelden.' : 'Angemeldet …';
        if (!needsEmailConfirmation) { setupRealtimeSync(); renderSyncSettings(); }
      } catch (e) { msgEl.textContent = 'Fehler: ' + e.message; }
    });
    return;
  }

  el.innerHTML = `
    <p style="font-size:12.8px; color:var(--text-muted); line-height:1.6; margin:0 0 10px;">
      Angemeldet als <b>${escapeHtml(session.user.email)}</b>.
    </p>
    <div class="btn-row"><button class="btn btn-primary" id="syncNowBtn">Jetzt synchronisieren</button><button class="btn" id="syncLogoutBtn">Abmelden</button></div>
    <p id="syncSettingsMsg" style="font-size:12px; color:var(--text-muted); margin-top:10px;"></p>`;
  const msgEl2 = document.getElementById('syncSettingsMsg');
  document.getElementById('syncNowBtn').addEventListener('click', () => manualSync(msgEl2));
  document.getElementById('syncLogoutBtn').addEventListener('click', async () => { await Sync.signOut(); renderSyncSettings(); });
}

async function manualSync(msgEl) {
  msgEl.textContent = 'Synchronisiere …';
  try {
    await Sync.pushAppData(DATA);
    const remote = await Sync.pullAppData();
    const localIds = new Set(DATA.companies.map(c => c.id));
    const remoteIds = new Set((remote?.data?.companies || []).map(c => c.id));
    const missing = [...localIds].filter(id => !remoteIds.has(id));
    msgEl.textContent = missing.length
      ? `⚠ ${remoteIds.size}/${localIds.size} Firmen synchronisiert — fehlen in der Cloud: ${missing.join(', ')}`
      : `✓ ${remoteIds.size}/${localIds.size} Firmen synchronisiert (${new Date().toLocaleTimeString('de-DE')})`;
  } catch (e) {
    msgEl.textContent = 'Fehler: ' + e.message;
  }
}

// ==================================================================== Toolbar

function populateToolbar() {
  const statusSel = document.getElementById('statusFilter');
  statusSel.innerHTML = '<option value="all">Alle Status</option>' + STATUSES.map(s => `<option value="${s}">${s}</option>`).join('');
  const phaseSel = document.getElementById('phaseFilter');
  phaseSel.innerHTML = PHASE_OPTIONS.map(o => `<option value="${o.key}">${o.label}</option>`).join('');
  const sortSel = document.getElementById('sortSelect');
  sortSel.innerHTML = SORT_OPTIONS.map(o => `<option value="${o.key}">${o.label}</option>`).join('');
  sortSel.value = UI.sort;

  const tagBar = document.getElementById('tagFilterBar');
  tagBar.innerHTML = TAG_OPTIONS.map(t => `<button type="button" class="tag-chip" data-tag="${t.key}">${t.label}</button>`).join('');
  tagBar.querySelectorAll('.tag-chip').forEach(chip => chip.addEventListener('click', () => {
    const key = chip.dataset.tag;
    if (UI.tags.has(key)) UI.tags.delete(key); else UI.tags.add(key);
    chip.classList.toggle('active', UI.tags.has(key));
    renderUnternehmenPage();
  }));

  document.getElementById('searchInput').addEventListener('input', (e) => { UI.search = e.target.value.trim(); renderUnternehmenPage(); });
  statusSel.addEventListener('change', (e) => { UI.statusFilter = e.target.value; renderUnternehmenPage(); });
  phaseSel.addEventListener('change', (e) => { UI.phaseFilter = e.target.value; renderUnternehmenPage(); });
  document.getElementById('categoryFilter').addEventListener('change', (e) => { UI.categoryFilter = e.target.value; renderUnternehmenPage(); });
  sortSel.addEventListener('change', (e) => { UI.sort = e.target.value; renderUnternehmenPage(); });
  document.getElementById('followupOnlyCheck').addEventListener('change', (e) => { UI.followupOnly = e.target.checked; renderUnternehmenPage(); });
  document.getElementById('docsOnlyCheck').addEventListener('change', (e) => { UI.docsOnly = e.target.checked; renderUnternehmenPage(); });
  document.getElementById('initiativOnlyCheck').addEventListener('change', (e) => { UI.initiativOnly = e.target.checked; renderUnternehmenPage(); });
  document.getElementById('concreteOnlyCheck').addEventListener('change', (e) => { UI.concreteOnly = e.target.checked; renderUnternehmenPage(); });
  document.getElementById('connState').addEventListener('click', () => { if (lastSaveFailed) persist(); });
}

// ======================================================================= Init

function setupElectronBridge() {
  if (!window.electronAPI) return;
  window.electronAPI.onFocusSearch(() => document.getElementById('searchInput')?.focus());
  window.electronAPI.onReloadData(() => loadData().then(() => { renderCurrentPage(); setConn('ok'); }).catch(() => setConn('err')));
}

let realtimeUnsubscribe = null;
function setupRealtimeSync() {
  if (realtimeUnsubscribe) return;
  realtimeUnsubscribe = Sync.subscribeRealtime(() => reconcileInBackground());
}

// PWA ohne lokalen Server hat keine andere Datenquelle als Supabase - ohne
// Session gibt es hier nichts zu laden. Minimaler, eigenständiger Login-
// Screen (nicht Teil der bestehenden Seiten/Navigation), erscheint nie in
// der Electron-App, solange server.py erreichbar ist.
function renderLoginGate() {
  document.querySelector('.main-content').innerHTML = `
    <div class="glass-card" style="max-width:360px; margin:80px auto; padding:28px;">
      <h2 style="margin:0 0 6px;">Anmelden</h2>
      <p style="font-size:12.5px; color:var(--text-muted); margin:0 0 18px;">Cloud-Sync-Zugang (Supabase) — dieselben Daten wie am Mac.</p>
      <div class="field-item" style="margin-bottom:10px;"><label>E-Mail</label><input type="email" id="loginEmail" autocomplete="username"></div>
      <div class="field-item" style="margin-bottom:14px;"><label>Passwort</label><input type="password" id="loginPassword" autocomplete="current-password"></div>
      <div class="btn-row">
        <button class="btn btn-primary" id="loginBtn">Anmelden</button>
        <button class="btn" id="signupBtn">Neu registrieren</button>
      </div>
      <p id="loginMsg" style="font-size:12px; color:var(--text-muted); margin-top:12px;"></p>
    </div>`;
  const emailEl = document.getElementById('loginEmail');
  const pwEl = document.getElementById('loginPassword');
  const msgEl = document.getElementById('loginMsg');
  document.getElementById('loginBtn').addEventListener('click', async () => {
    msgEl.textContent = 'Melde an …';
    try {
      await Sync.signIn(emailEl.value.trim(), pwEl.value);
      init();
    } catch (e) {
      msgEl.textContent = 'Fehler: ' + e.message;
    }
  });
  document.getElementById('signupBtn').addEventListener('click', async () => {
    msgEl.textContent = 'Registriere …';
    try {
      const { needsEmailConfirmation } = await Sync.signUp(emailEl.value.trim(), pwEl.value);
      msgEl.textContent = needsEmailConfirmation
        ? '✓ Konto erstellt — bitte Bestätigungslink in der E-Mail öffnen, danach hier anmelden.'
        : 'Konto erstellt, angemeldet …';
      if (!needsEmailConfirmation) init();
    } catch (e) {
      msgEl.textContent = 'Fehler: ' + e.message;
    }
  });
}

async function init() {
  initNav();
  populateToolbar();
  setupElectronBridge();

  const localMode = await Sync.hasLocalServer();
  if (!localMode && Sync.isConfigured() && !(await Sync.getSession())) {
    renderLoginGate();
    return;
  }

  try {
    await loadData();
    setConn('ok');
    switchPage('dashboard');
    if (Sync.isConfigured() && (await Sync.getSession())) setupRealtimeSync();
    // Service Worker nur in der PWA registrieren (siehe sw.js) - in der
    // Electron-App würde er riskieren, veraltete Dateien zwischenzuspeichern.
    if (!localMode && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service Worker Registrierung fehlgeschlagen:', e));
    }
  } catch (e) {
    setConn('err');
    document.querySelector('.main-content').innerHTML = localMode
      ? `<div class="glass-card" style="padding:24px; margin-top:40px;"><b>Server nicht erreichbar.</b><br>Bitte <code>python3 server.py</code> im Ordner praxissemester-tracker starten und die Seite über http://127.0.0.1:8420/ öffnen.<br><button class="btn btn-primary" onclick="init()" style="margin-top:12px;">Erneut versuchen</button></div>`
      : `<div class="glass-card" style="padding:24px; margin-top:40px;"><b>Cloud-Daten konnten nicht geladen werden.</b><br>${escapeHtml(e.message)}<br><button class="btn btn-primary" onclick="init()" style="margin-top:12px;">Erneut versuchen</button></div>`;
    console.error(e);
  }
}

init();
