// Supabase-Projektzugangsdaten. Der "anon key" ist bewusst öffentlich im
// Code - das ist von Supabase so vorgesehen, Schutz kommt über Row Level
// Security (siehe supabase/schema.sql), nicht über Geheimhaltung dieses
// Keys. Trotzdem NIE den "service_role"-Key hier eintragen - der umgeht RLS
// komplett und gehört nur in einmalige, lokal ausgeführte Admin-Skripte.
//
// Werte kommen aus Supabase -> Project Settings -> API. Solange hier die
// Platzhalter stehen, bleibt die App exakt im heutigen Offline-Modus -
// Sync.isConfigured() erkennt das automatisch.
window.CONFIG = {
  SUPABASE_URL: 'https://yqllwtbpvkjxbncdqgpq.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_Ro_Wt8XrneDPtvrtkY2zTg_IJXbETVM',
};
