# Knechtgarten Mail-Assistent — Neubau-Spezifikation

Diese Datei ist die Grundlage für den Neubau in Claude Code. Sie beschreibt Architektur, Datenmodell, API und die Migration vom bestehenden System.

## 1. Ziel

Der bestehende Mail-Assistent (Chrome-Extension mit voller Sidebar, Vorgaben aus einem Google Doc, Textvorlagen hart in `textvorlagen.js`) wird abgelöst durch:

- Eine schlanke Chrome-Extension, die nur noch einen Button in die Gmail-Toolbar setzt (Antworten *und* Neu verfassen) und ein Popup mit editierbarem KI-Ergebnis öffnet.
- Eine zentrale Verwaltung (Vorgaben, Textvorlagen, Installationsanleitung) als Tool auf knechtgarten.com.
- Supabase als Datenspeicher.
- Eine eigene API-Route auf knechtgarten.com, die den Anthropic-Aufruf serverseitig macht (Key liegt nicht mehr im Browser).

## 2. Architektur — Übersicht

| Teil | Technologie | Aufgabe |
|---|---|---|
| Chrome-Extension | Manifest V3, Vanilla JS | Button in Gmail-Toolbar, Popup/Chatbox, Text ins Mailfeld einfügen |
| Admin-UI | Teil von knechtgarten.com (gleicher Stack wie Offerttool) | Vorgaben & Textvorlagen bearbeiten, Installationsanleitung anzeigen |
| Backend-API | Route(n) auf knechtgarten.com | Prompt bauen, Anthropic-Aufruf, Vorgaben/Vorlagen ausliefern |
| Datenbank | Supabase (Postgres) | Vorgaben, Textvorlagen, Mitarbeiter, optional Nutzungs-Log |

**Wichtig, unveränderbar:** Die Extension muss ein Content-Script bleiben — nur so kann sie Text in Gmail einfügen. Website und Extension sind zwei getrennte Codebasen, die über die Backend-API kommunizieren.

## 3. Ablauf (Chatbox-Flow)

1. Nutzer klickt Button in Gmail-Toolbar (Antwort- oder Compose-Fenster).
2. Popup öffnet sich: Textfeld "Stichworte/Anweisungen" + Chips für feste Vorlagen + Button "Entwurf erstellen".
3. Bei Chip-Klick: Text wird 1:1 aus der Datenbank eingefügt, kein API-Call.
4. Bei "Entwurf erstellen": Extension schickt `{ mailInhalt, stichworte, mitarbeiterEmail }` an die Backend-API.
5. Backend lädt Vorgaben aus Supabase, baut den Prompt, ruft Anthropic auf, gibt Text zurück.
6. Text erscheint editierbar im Popup (Chatbox-Ansicht).
7. Nutzer kann nachbessern ("kürzer", "förmlicher" etc.) — jede Nachricht geht wieder an die gleiche Backend-Route, mit Verlauf.
8. Klick auf "In Mail übernehmen" → Text wird ins offene Gmail-Feld geschrieben, Popup schliesst.

## 4. Supabase-Schema

```sql
create table vorgaben (
  id uuid primary key default gen_random_uuid(),
  inhalt text not null,           -- der komplette Vorgaben-Text (Schreibstil, Distanzlogik, Zonen etc.)
  version int not null default 1,
  aktualisiert_am timestamptz default now(),
  aktualisiert_von text
);

create table textvorlagen (
  id uuid primary key default gen_random_uuid(),
  schluessel text unique not null,   -- z.B. 'offerte', 'gartenplanung', 'nachhaken'
  titel text not null,               -- Anzeigename für den Chip
  inhalt text not null,
  reihenfolge int default 0
);

create table mitarbeiter (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  funktion text
);

create table nutzung_log (
  id uuid primary key default gen_random_uuid(),
  mitarbeiter_email text,
  erstellt_am timestamptz default now(),
  tokens_input int,
  tokens_output int
);
```

Startdaten für `mitarbeiter` (aus dem bisherigen Vorgaben-Dokument):

| email | name | funktion |
|---|---|---|
| mail@knechtgarten.ch | Stefan Knecht | Geschäftsführer / Inhaber |
| pascal.wuethrich@knechtgarten.ch | Pascal Wüthrich | Gartenplaner / Beratung |
| bau@knechtgarten.ch | Benjamin Habegger | Projektleiter Gartenbau |
| fabian.oberholzer@knechtgarten.ch | Fabian Oberholzer | Projektleiter Gartenbau |

## 5. Backend-API (Routen auf knechtgarten.com)

```
POST /api/mail-assistent/draft
  body: { mailInhalt: string, stichworte?: string, mitarbeiterEmail: string, verlauf?: Message[] }
  → lädt Vorgaben aus Supabase, baut Prompt, ruft Anthropic API
  → response: { text: string }

GET  /api/mail-assistent/textvorlagen
  → liefert alle Textvorlagen (für Chips in der Extension)

GET  /api/mail-assistent/vorgaben          (nur Admin-UI)
PUT  /api/mail-assistent/vorgaben          (nur Admin-UI, speichert neue Version)

GET  /api/mail-assistent/textvorlagen/:id  (nur Admin-UI)
PUT  /api/mail-assistent/textvorlagen/:id  (nur Admin-UI)
POST /api/mail-assistent/textvorlagen      (nur Admin-UI, neue Vorlage anlegen)
```

Der Anthropic API Key liegt nur als Umgebungsvariable auf dem Server (z.B. `ANTHROPIC_API_KEY` in `.env` bzw. den Hosting-Secrets von knechtgarten.com), niemals im Extension-Code oder im Browser.

## 6. Chrome-Extension — Struktur

```
extension/
  manifest.json
  background.js       -- ruft Backend-API auf (fetch), kein direkter Anthropic-Call mehr
  content.js          -- injiziert Button in Toolbar, öffnet Popup, schreibt Ergebnis ins Mailfeld
  popup-panel.css
  popup-panel.js       -- Chatbox-Logik (Verlauf, Nachbessern, Übernehmen)
  icons/
```

Wegfallende Teile aus der alten Version: Kalender-Integration, Termin-Fixieren-Panel, Freihalter-Logik, Google-Maps-Distanzberechnung, Mini-Kalender — all das war Teil der alten Sidebar und wird nicht mitgenommen, ausser du möchtest es explizit später wieder ergänzen.

Bleibt gleich: OAuth Client ID und Extension-ID (RSA-Key im Manifest) müssen unverändert bleiben, sonst bricht die bestehende Google-Cloud-Projekt-Einrichtung (Testbenutzer, aktivierte APIs). Diese Werte liegen in `Einrichtung Admin.pdf` in Google Drive.

## 7. Migrations-Hinweise (Kontext für Claude Code)

- Bestehendes Google-Cloud-Projekt: `skillful-camp-500016-s5` (Name: GoogleMapMail), APIs: Gmail, Docs, Drive, Calendar, Maps — für die neue Version werden nur noch Gmail API + `chrome.identity` gebraucht.
- Bestehendes Vorgaben-Dokument (Google Doc, ID `1Br7Gz1SIdIqHy82cc5UDlDA4BMWKm9-UXc6P_9qLGag`) wird einmalig als Ausgangstext in die Supabase-Tabelle `vorgaben` übernommen, danach nicht mehr aus Google Docs gelesen.
- Bestehende `textvorlagen.js`-Inhalte (Offerte, Gartenplanung, Nachhaken) werden einmalig in die Tabelle `textvorlagen` übernommen.
- Firmendaten für Prompts/Signatur-Kontext: Knechtgarten, Badhaus 42, 3615 Heimenschwand, 033 453 10 20.

## 8. Offene Entscheidungen (vor dem Bauen klären)

1. Auth für die Admin-UI auf knechtgarten.com: reicht ein einfaches Passwort, oder soll Google-Workspace-Login (gleiche Domain-Prüfung wie bei der Extension) genutzt werden?
2. Soll `nutzung_log` von Anfang an mitgebaut werden (für Kostenkontrolle pro Mitarbeiter), oder erst später?
3. Hosting/Stack von knechtgarten.com — auf welchem Framework läuft das Offerttool aktuell (Next.js, Node/Express, etc.)? Das entscheidet, wie die neuen API-Routen technisch eingebunden werden.

## 9. Empfohlene Baureihenfolge

1. Supabase-Projekt + Schema anlegen, Startdaten migrieren.
2. Backend-API-Routen bauen (`/draft`, `/textvorlagen`, Admin-CRUD).
3. Admin-UI auf knechtgarten.com (Vorgaben-Editor, Textvorlagen-Editor, Installationsanleitung).
4. Extension neu bauen: Button + Popup + Chatbox-Flow, gegen die neue API.
5. Alte Sidebar-Version deinstallieren, neue Version an Pascal/Benu/Fabian verteilen.
