# Knechtgarten Mail-Assistent

Chrome-Erweiterung (Manifest V3) fuer Gmail: KI-Unterstuetzung beim Verfassen
und Beantworten von Mails, basierend auf firmeneigenen Vorlagen, Sonderfaellen
und Distanzlogik. Nur fuer Mitarbeitende der Knecht AG Naturnahe Gaerten.

## Aufbau

- `manifest.json` - Erweiterungs-Konfiguration (Manifest V3)
- `content.js` - Content-Script, laeuft direkt auf mail.google.com
- `content.css` - Styling fuer den Button/das Panel im Compose-/Antwortfenster
- `popup.html` - Kleines Popup beim Klick auf das Symbol in der Toolbar
- `icons/` - Erweiterungs-Icons

Backend: Supabase Edge Function `mail-assistent-draft` im
[Offertentool-Repository](https://github.com/Knechtgarten/knechtgarten.com)
(`supabase/functions/mail-assistent-draft/`). Verwaltung der Inhalte
(Schreibstil, Vorlagen, Sonderfaelle, Distanzlogik) ueber die interne
Verwaltungsseite dort.

## Vertrieb

Veroeffentlicht als "Privat" im Chrome Web Store, nur fuer die
Google-Workspace-Organisation knechtgarten.ch sichtbar. Fuer automatische
Installation bei allen Mitarbeitenden: Google Admin Console -> Geraete ->
Chrome -> Apps und Erweiterungen -> per Erweiterungs-ID auf
"Installation erzwingen" stellen.

## Update-Ablauf

1. Code hier anpassen, Versionsnummer in `manifest.json` erhoehen
2. `manifest.json`, `content.js`, `content.css`, `popup.html`, `icons/` als
   ZIP verpacken (manifest.json muss im Wurzelverzeichnis der ZIP liegen)
3. Im Chrome Web Store Developer Dashboard beim Artikel unter "Paket" die
   neue ZIP hochladen, speichern, "Prufen lassen" klicken
4. Nach Googles Freigabe verteilt sich das Update automatisch an alle
