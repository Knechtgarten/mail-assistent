// ============================================================================
// Knechtgarten Mail-Assistent v2 - Content-Script fuer Gmail.
//
// Setzt einen Button in die Toolbar jedes Compose-/Antwortfensters. Beim
// Verfassen zeigt das Panel Vorlagen-Chips + ein Freitextfeld; beim
// Antworten wird sofort automatisch ein Entwurf erstellt (kein Klick auf
// eine Vorlage noetig - die KI liest die eingehende Mail direkt).
//
// Kein Google-Login/OAuth noetig - die Erweiterung liest/schreibt nur die
// Gmail-Seite selbst, ruft sonst nur die eigene Supabase Edge Function auf.
//
// Wichtiger Hinweis fuer die Einrichtung: Gmails interne HTML-Struktur ist
// nicht offiziell dokumentiert und kann sich mit Google-Updates aendern -
// die Selektoren unten (aria-label "Nachrichtentext"/"Message Body",
// "Senden"/"Send", input[name=subjectbox]) sind seit Jahren stabil, aber
// nicht garantiert. Falls der Button irgendwo nicht erscheint, zuerst hier
// pruefen.
// ============================================================================

const KG_EDGE_URL = 'https://oalapdxinqlnzwxhyuzy.supabase.co/functions/v1/mail-assistent-draft';
const KG_ANON_KEY = 'sb_publishable_DoeD4uEnwemmnFu4AxE9uw_5lmQYc5P';

const KG_ICON_BLITZ = '<path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5 19 19M19 5l-2.5 2.5M7.5 16.5 5 19"/>';
const KG_ICON_MIC = '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 18v3"/>';
const KG_ICON_CHEVRON = '<path d="M6 9l6 6 6-6"/>';
const KG_ICON_PERSON = '<circle cx="12" cy="7.5" r="3.5"/><path d="M4.5 19.5c1-4 4-6 7.5-6s6.5 2 7.5 6"/>';
const KG_ICON_PERSONEN = '<circle cx="8" cy="7.5" r="3.1"/><path d="M1.5 19.7c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17.5" cy="8.3" r="2.7"/><path d="M12.7 19.9c.6-3 2.7-4.7 4.8-4.7 2.4 0 4.4 1.8 5 4.7"/>';

// Anrede-Umschalter: vier Varianten statt einem eigenen "Ihr"-Wort - das
// wurde als verwirrend empfunden, wenn eigentlich "zwei Personen, mit denen
// man per Du ist" gemeint ist. Die Buttons zeigen darum nur "Du"/"Sie", die
// Anzahl Personen steckt im Icon (ein bzw. zwei Koepfe). Von Anfang an
// sichtbar (schon bevor eine Vorlage gewaehlt ist), damit man die Praeferenz
// vorher setzen kann statt hinterher nachzubessern. Wirkt aber genauso, wenn
// schon ein Entwurf steht - dann sofort umformulieren statt nur merken.
const KG_ANREDE_ANWEISUNG = {
  Du: 'Die ganze Mail konsequent per "Du" formulieren, adressiert an eine einzelne Person (Anrede, Verbformen und Pronomen anpassen).',
  DuMehrere: 'Die ganze Mail konsequent per "Ihr" formulieren - informelle Mehrzahl-Anrede fuer mehrere Personen, mit denen man per Du ist (Anrede, Verbformen und Pronomen anpassen).',
  Sie: 'Die ganze Mail konsequent per "Sie" formulieren, adressiert an eine einzelne Person (Anrede, Verbformen und Pronomen anpassen).',
  SieMehrere: 'Die ganze Mail konsequent per "Sie" formulieren, adressiert an mehrere Personen gemeinsam (z.B. Begruessung wie "Guten Tag zusammen" statt an eine einzelne Person, Anrede/Verbformen entsprechend anpassen).',
};
// Kurze Erklaerung als Tooltip, weil die Buttons "Du"/"Sie" doppelt vorkommen
// und sich nur durchs Icon unterscheiden.
const KG_ANREDE_ERKLAERUNG = {
  Du: 'Eine Person, mit der man per Du ist',
  DuMehrere: 'Mehrere Personen, mit denen man per Du ist',
  Sie: 'Eine Person, formell',
  SieMehrere: 'Mehrere Personen, formell',
};
const KG_ANREDE_ICON = { Du: KG_ICON_PERSON, DuMehrere: KG_ICON_PERSONEN, Sie: KG_ICON_PERSON, SieMehrere: KG_ICON_PERSONEN };
const KG_ANREDE_KURZ = { Du: 'Du', DuMehrere: 'Du', Sie: 'Sie', SieMehrere: 'Sie' };
// Fuer die Chat-Verlauf-Meldung ("Auf ... umstellen") braucht es die
// ausfuehrlichere Bezeichnung, sonst waeren zwei Eintraege nicht
// unterscheidbar.
const KG_ANREDE_LABEL = { Du: 'Du', DuMehrere: 'Du (mehrere Personen)', Sie: 'Sie', SieMehrere: 'Sie (mehrere Personen)' };
function kgAnredeChipsHtml() {
  // Icon nur bei der Mehrzahl-Variante - bei "Du"/"Sie" alleine (Einzahl)
  // reicht der Text, das Icon braucht es erst zur Unterscheidung von der
  // Mehrzahl-Variante.
  return ['Du', 'DuMehrere', 'Sie', 'SieMehrere'].map(a => `<span class="kg-chip kg-chip-anrede" data-anrede="${a}" title="${kgEscape(KG_ANREDE_ERKLAERUNG[a])}">${a.endsWith('Mehrere') ? kgSvg(KG_ANREDE_ICON[a], 13) : ''}${KG_ANREDE_KURZ[a]}</span>`).join('');
}
function kgAktualisiereAnredeChips(zustand) {
  zustand.panel.querySelectorAll('.kg-anrede-chips .kg-chip').forEach(chip => {
    chip.classList.toggle('kg-chip-aktiv', chip.dataset.anrede === zustand.anrede);
  });
}
function kgAnredeKlick(anrede, chatBereich, bodyEl, zustand) {
  // Nochmaliges Klicken auf die aktive Anrede hebt sie wieder auf (zurueck zu
  // neutral/Standard aus Vorlage bzw. Schreibstil).
  zustand.anrede = zustand.anrede === anrede ? null : anrede;
  kgAktualisiereAnredeChips(zustand);
  if (zustand.aktuellerEntwurf) {
    // Es steht schon ein Entwurf - sofort umformulieren statt nur merken.
    const anweisung = zustand.anrede
      ? KG_ANREDE_ANWEISUNG[zustand.anrede]
      : 'Keine feste Anrede-Form vorgeben - nach Vorlage bzw. Schreibstil formulieren.';
    kgGeneriere(
      { modus: 'nachbessern', aktuellerEntwurf: zustand.aktuellerEntwurf, anweisung, vorlageId: zustand.aktuelleVorlageId },
      chatBereich, bodyEl, zustand,
      zustand.anrede ? `Auf "${KG_ANREDE_LABEL[zustand.anrede]}" umstellen` : 'Anrede zurücksetzen'
    );
  }
}
function kgVerdrahteAnredeChips(container, chatBereich, bodyEl, zustand) {
  container.querySelectorAll('.kg-chip').forEach(chip => {
    chip.addEventListener('click', () => kgAnredeKlick(chip.dataset.anrede, chatBereich, bodyEl, zustand));
  });
}

function kgSvg(pfad, groesse) {
  groesse = groesse || 13;
  return `<svg width="${groesse}" height="${groesse}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${pfad}</svg>`;
}
function kgEscape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function kgRufeApiAuf(payload) {
  const res = await fetch(KG_EDGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KG_ANON_KEY },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Serverfehler (${res.status})`);
  return data;
}

// Gmail zeigt die eingeloggte Adresse im Konto-Symbol oben rechts (Tooltip/
// aria-label enthaelt die Mailadresse). Fallback: irgendeine
// @knechtgarten.ch-Adresse auf der Seite suchen.
function kgHoleMitarbeiterEmail() {
  const kontoEl = document.querySelector('a[aria-label*="Google-Konto"], a[aria-label*="Google Account"], a[aria-label*="Account"]');
  if (kontoEl) {
    const treffer = (kontoEl.getAttribute('aria-label') || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (treffer) return treffer[0];
  }
  const treffer = document.body.innerText.match(/[\w.+-]+@knechtgarten\.ch/);
  return treffer ? treffer[0] : 'unbekannt@knechtgarten.ch';
}

// ----------------------------------------------------------------------------
// Erkennung neuer Compose-/Antwortfenster
// ----------------------------------------------------------------------------
console.log('[Mail-Assistent] content.js geladen, Beobachter aktiv.');

const kgBeobachter = new MutationObserver(() => {
  document.querySelectorAll('div[g_editable="true"][role="textbox"], div[aria-label*="Nachrichtentext" i], div[aria-label*="Message Body" i]').forEach(body => {
    if (body.dataset.kgDone) return;
    // Gmail haelt teils versteckte Entwurfsfelder auch in der Listenansicht im
    // DOM (z.B. fuer Autosave) - ohne Sichtbarkeitspruefung wuerde dort faelsch-
    // licherweise auch ein Button erscheinen. offsetParent ist null bei
    // display:none/nicht gerendert.
    if (body.offsetParent === null) return;
    const container = kgFindeContainer(body);
    const toolbar = container ? kgFindeToolbar(container) : null;
    if (!container) { console.log('[Mail-Assistent] Textfeld gefunden, aber keinen Senden-Button in den Elternelementen entdeckt.', body); return; }
    if (!toolbar) { console.log('[Mail-Assistent] Senden-Button gefunden, aber keine passende Symbolleiste.', body); return; }
    body.dataset.kgDone = '1';
    console.log('[Mail-Assistent] Fenster erkannt, Button wird eingefuegt.', { body, container, toolbar });
    kgInitialisiere(body, container, toolbar);
  });
});
kgBeobachter.observe(document.body, { childList: true, subtree: true });

const KG_SEND_SELEKTOR = '[aria-label*="Senden" i], [aria-label*="Send" i], [data-tooltip*="Senden" i], [data-tooltip*="Send" i]';

function kgFindeContainer(bodyEl) {
  let el = bodyEl.parentElement;
  for (let i = 0; i < 25 && el; i++) {
    if (el.querySelector(KG_SEND_SELEKTOR)) return el;
    el = el.parentElement;
  }
  return null;
}
function kgFindeToolbar(container) {
  const sendBtn = container.querySelector(KG_SEND_SELEKTOR);
  if (!sendBtn) return null;
  let row = sendBtn;
  for (let i = 0; i < 4 && row.parentElement; i++) {
    if (row.parentElement.children.length >= 2) return row.parentElement;
    row = row.parentElement;
  }
  return sendBtn.parentElement;
}

// ----------------------------------------------------------------------------
// Aufbau von Button + Panel pro Fenster
// ----------------------------------------------------------------------------
function kgInitialisiere(bodyEl, container, toolbar) {
  // "container" reicht oft nicht bis zum Betreff-Feld hoch (das liegt in
  // einer eigenen Zeile ueber der Toolbar) - darum hier auf der ganzen Seite
  // suchen. Ein sichtbares Betreff-Feld gibt es nur beim Verfassen einer
  // neuen Mail, nicht beim Antworten (dort ist "Betreff" standardmaessig
  // ausgeblendet).
  const subjectbox = document.querySelector('input[name="subjectbox"]');
  const istVerfassen = !!subjectbox && subjectbox.offsetParent !== null;

  const button = document.createElement('span');
  button.className = 'kg-btn';
  button.innerHTML = kgSvg(KG_ICON_BLITZ) + 'Mail-Assistent';
  toolbar.appendChild(button);

  // Panel wird VOR dem Mailtext-Feld eingefuegt (wie Googles eigene "Hilf mir
  // schreiben"-Box) - also dort, wo man zu tippen beginnt, oberhalb der
  // Signatur (die steht am Ende von bodyEl). Als normaler Teil des Inhalts,
  // nicht als schwebendes Overlay, damit es beim Wachsen die Sende-Leiste
  // nicht verdeckt und stattdessen die normale Seiten-Bildlaufleiste zum
  // Scrollen verwendet wird. bodyEl.insertAdjacentElement ist immer sicher,
  // da bodyEl selbst garantiert im DOM haengt.
  const panel = document.createElement('div');
  panel.className = 'kg-panel';
  panel.innerHTML = '<div class="kg-scroll"></div>';
  bodyEl.insertAdjacentElement('beforebegin', panel);

  // Gmail haengt am Mailtext-Bereich einen Klick-Handler, der bei jedem Klick
  // versucht, den Fokus zurueck auf das Editierfeld zu holen - da unser Panel
  // jetzt ein direktes Geschwister von bodyEl ist, schnappt sich das sonst
  // auch Klicks in unsere Eingabefelder. Events hier abfangen, bevor sie zu
  // Gmails Handlern hochblubbern.
  ['mousedown', 'click'].forEach(ev => panel.addEventListener(ev, e => e.stopPropagation()));

  const zustand = { offen: false, aktuellerEntwurf: null, aktuelleVorlageId: null, aktuellerBetreff: null, anrede: null, mailInhalt: null, panel, button };

  button.addEventListener('click', async () => {
    zustand.offen = !zustand.offen;
    panel.classList.toggle('kg-show', zustand.offen);
    button.classList.toggle('kg-on', zustand.offen);
    if (zustand.offen && !panel.dataset.geladen) {
      panel.dataset.geladen = '1';
      if (istVerfassen) await kgZeigeVerfassenChips(panel, bodyEl, zustand);
      else await kgStarteAntworten(panel, bodyEl, container, zustand);
    }
  });
}

function kgSchliessePanel(zustand) {
  zustand.offen = false;
  zustand.panel.classList.remove('kg-show');
  zustand.button.classList.remove('kg-on');
}

// ----------------------------------------------------------------------------
// Verfassen: Vorlagen-Chips + Freitextfeld
// ----------------------------------------------------------------------------
async function kgZeigeVerfassenChips(panel, bodyEl, zustand) {
  const scroll = panel.querySelector('.kg-scroll');
  scroll.innerHTML = '<div class="kg-lade">Lade Vorlagen …</div>';
  let vorlagen = [];
  try {
    const res = await kgRufeApiAuf({ modus: 'liste-verfassen' });
    vorlagen = res.vorlagen || [];
  } catch (e) { /* Chips bleiben dann einfach leer */ }

  // Express: jede einfache Vorlage wird 1:1 sofort angezeigt, ganz ohne
  // KI-Aufruf (spart 2-4 Sekunden und Kosten) - auch wenn sie noch
  // [Platzhalter] enthaelt, die dann von Hand ausgefuellt werden.
  const istExpress = (v) => v.typ === 'einfach' && !!v.inhalt;

  // Dropdown-Gruppen buendeln mehrere Vorlagen unter einem Button (z.B.
  // "Bestellungen"), damit die Chip-Leiste bei vielen aehnlichen Vorlagen
  // nicht unuebersichtlich wird. Untermenues bleiben im Fluss statt als
  // schwebendes Overlay (wie das Panel selbst) - vermeidet Positionierungs-
  // Probleme innerhalb von Gmail.
  const obersteEbene = vorlagen.filter(v => !v.parent_id);
  const kinderVon = (elternId) => vorlagen.filter(v => v.parent_id === elternId);
  const chipHtml = (v) => `<span class="kg-chip${istExpress(v) ? ' kg-chip-express' : ''}" data-id="${v.id}" title="${istExpress(v) ? 'Express - wird sofort eingefuegt' : ''}">${kgEscape(v.titel)}</span>`;

  scroll.innerHTML = `
    <div class="kg-chips">${obersteEbene.map(v => v.typ === 'dropdown'
      ? `<span class="kg-chip kg-chip-dropdown" data-dropdown-id="${v.id}">${kgEscape(v.titel)}${kgSvg(KG_ICON_CHEVRON, 13)}</span>`
      : chipHtml(v)
    ).join('')}</div>
    ${obersteEbene.filter(v => v.typ === 'dropdown').map(gruppe => `
      <div class="kg-chips kg-dropdown-submenu" data-dropdown-id="${gruppe.id}" style="display:none;">${kinderVon(gruppe.id).map(chipHtml).join('') || '<span class="kg-dropdown-leer">Keine Vorlagen in dieser Gruppe.</span>'}</div>
    `).join('')}
    <div class="kg-row">
      <div class="kg-anrede-chips">${kgAnredeChipsHtml()}</div>
      <button class="kg-micbtn" title="Diktieren">${kgSvg(KG_ICON_MIC)}</button>
      <textarea class="kg-textarea" rows="1" placeholder="Eigene Stichworte oder Anweisung … (Enter zum Erstellen)"></textarea>
    </div>
    <div class="kg-chat-bereich"></div>`;

  const chatBereich = scroll.querySelector('.kg-chat-bereich');
  const textarea = scroll.querySelector('.kg-textarea');
  kgSchuetzeFokus(textarea);
  kgVerdrahteAnredeChips(scroll.querySelector('.kg-anrede-chips'), chatBereich, bodyEl, zustand);
  kgAktualisiereAnredeChips(zustand);

  // Sichtbarkeit bewusst per Inline-Style (nicht nur per CSS-Klasse) steuern -
  // so haengt "geschlossen beim Start" nicht davon ab, dass eine externe
  // Stylesheet-Datei im Browser schon aktualisiert ist.
  scroll.querySelectorAll('.kg-dropdown-submenu').forEach(s => { s.style.display = 'none'; });
  scroll.querySelectorAll('.kg-chip-dropdown').forEach(btn => {
    btn.addEventListener('click', () => {
      const submenu = scroll.querySelector(`.kg-dropdown-submenu[data-dropdown-id="${btn.dataset.dropdownId}"]`);
      const warOffen = submenu.style.display !== 'none';
      scroll.querySelectorAll('.kg-dropdown-submenu').forEach(s => { s.style.display = 'none'; });
      scroll.querySelectorAll('.kg-chip-dropdown').forEach(b => b.classList.remove('kg-chip-aktiv'));
      if (!warOffen) { submenu.style.display = 'flex'; btn.classList.add('kg-chip-aktiv'); }
    });
  });

  scroll.querySelectorAll('.kg-chips .kg-chip:not(.kg-chip-dropdown)').forEach(chip => {
    chip.addEventListener('click', () => {
      const vorlage = vorlagen.find(v => v.id === chip.dataset.id);
      const zusatzfensterListe = vorlage ? kgZusatzfensterVon(vorlage) : [];
      if (vorlage && zusatzfensterListe.length) {
        // Strukturierte Eingabemaske(n) (z.B. Bestell-Tabelle) zuerst zeigen -
        // die daraus gebaute Liste ersetzt den jeweiligen Platzhalter direkt,
        // ganz ohne KI-Aufruf (die Daten sind schon vollstaendig strukturiert).
        kgZeigeZusatzfenster(zusatzfensterListe, vorlage, chatBereich, bodyEl, zustand);
        return;
      }
      const anredeUeberschreibung = zustand.anrede ? KG_ANREDE_ANWEISUNG[zustand.anrede] : null;
      if (vorlage && istExpress(vorlage) && !anredeUeberschreibung) {
        // Express: kein KI-Aufruf noetig (kein Platzhalter zum Ausfuellen),
        // aber trotzdem als Entwurf im Chat zeigen statt blind einzufuegen -
        // so bleibt die Moeglichkeit zum Nachbessern vor dem Uebernehmen.
        zustand.aktuellerEntwurf = vorlage.inhalt;
        zustand.aktuelleVorlageId = vorlage.id;
        if (vorlage.betreff) zustand.aktuellerBetreff = vorlage.betreff;
        kgZeigeEntwurf(chatBereich, bodyEl, zustand, `Vorlage: ${vorlage.titel}`);
      } else {
        // Entweder keine reine Express-Vorlage, oder eine Anrede-Praeferenz
        // ist gesetzt -> braucht in beiden Faellen die KI (fuer Platzhalter
        // bzw. fuer die Umformulierung der Anrede).
        kgGeneriere({ modus: 'verfassen', vorlageId: chip.dataset.id, stichworte: anredeUeberschreibung || undefined }, chatBereich, bodyEl, zustand, vorlage ? `Vorlage: ${vorlage.titel}` : undefined);
      }
    });
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = textarea.value.trim();
      if (!text) return;
      if (zustand.aktuellerEntwurf) {
        kgGeneriere({ modus: 'nachbessern', aktuellerEntwurf: zustand.aktuellerEntwurf, anweisung: text, richtung: 'verfassen', vorlageId: zustand.aktuelleVorlageId }, chatBereich, bodyEl, zustand, text);
      } else {
        const anredeUeberschreibung = zustand.anrede ? KG_ANREDE_ANWEISUNG[zustand.anrede] : '';
        kgGeneriere({ modus: 'verfassen', stichworte: [text, anredeUeberschreibung].filter(Boolean).join('\n') }, chatBereich, bodyEl, zustand, text);
      }
      textarea.value = '';
    }
  });
  kgAktiviereMikrofon(scroll.querySelector('.kg-micbtn'), textarea);
}

// ----------------------------------------------------------------------------
// Antworten: sofort automatisch Entwurf/Rueckfrage anhand der eingehenden
// Mail erstellen - keine Chips.
// ----------------------------------------------------------------------------
function kgHoleMailInhalt(bodyEl, container) {
  // 1. Manche Antwortfenster haben den zitierten Verlauf direkt im Editierfeld
  //    (blockquote/.gmail_quote). Falls nicht (Gmail klappt das oft erst nach
  //    Klick auf "..." auf), 2. stattdessen die zuletzt angezeigte Nachricht
  //    im Thread darueber suchen (Gmail-Klasse "a3s" fuer den reinen
  //    Nachrichtentext - seit Jahren stabil, aber nicht offiziell dokumentiert).
  const zitat = bodyEl.querySelector('blockquote, .gmail_quote');
  let text = ((zitat ? zitat.textContent : '') || '').trim();
  if (!text) {
    const nachrichten = Array.from(document.querySelectorAll('div.a3s.aiL, div.a3s'))
      .filter(el => el !== bodyEl && !el.contains(bodyEl) && !bodyEl.contains(el));
    for (let i = nachrichten.length - 1; i >= 0; i--) {
      const t = (nachrichten[i].textContent || '').trim();
      if (t) { text = t; break; }
    }
  }
  if (!text) text = (bodyEl.textContent || '').trim();
  return text || '(kein Mailinhalt gefunden)';
}

// Absender der Mail, auf die geantwortet wird - fuer den Express-Pfad bei
// internen Mails (@knechtgarten.ch). Gmail markiert den Absender-Namen mit
// einem "email"-Attribut (aehnlich stabil wie die "a3s"-Klasse oben).
function kgHoleAbsenderEmail(bodyEl) {
  const kandidaten = Array.from(document.querySelectorAll('[email]'))
    .filter(el => el !== bodyEl && !el.contains(bodyEl) && !bodyEl.contains(el));
  for (let i = kandidaten.length - 1; i >= 0; i--) {
    const email = kandidaten[i].getAttribute('email');
    if (email && email.includes('@')) return email;
  }
  return null;
}

async function kgStarteAntworten(panel, bodyEl, container, zustand) {
  const scroll = panel.querySelector('.kg-scroll');
  scroll.innerHTML = '<div class="kg-chat-bereich"><div class="kg-lade">Lese Mail und erstelle Entwurf …</div></div>';
  const chatBereich = scroll.querySelector('.kg-chat-bereich');
  zustand.mailInhalt = kgHoleMailInhalt(bodyEl, container);
  const absender = kgHoleAbsenderEmail(bodyEl);
  const istIntern = !!absender && absender.toLowerCase().endsWith('@knechtgarten.ch');

  try {
    const data = await kgRufeApiAuf({ modus: 'antworten', mailInhalt: zustand.mailInhalt, intern: istIntern, mitarbeiterEmail: kgHoleMitarbeiterEmail() });
    chatBereich.innerHTML = '';
    if (data.aktion === 'entwurf') {
      zustand.aktuellerEntwurf = data.text;
      kgZeigeEntwurf(chatBereich, bodyEl, zustand);
    } else if (data.aktion === 'rueckfrage') {
      kgZeigeRueckfrage(chatBereich, data, bodyEl, zustand);
    }
  } catch (e) {
    chatBereich.innerHTML = `<div class="kg-lade" style="color:#B4655F;">Fehler: ${kgEscape(e.message)}</div>`;
  }
}

// ----------------------------------------------------------------------------
// Gemeinsame Bausteine: KI-Aufruf mit Ladeanzeige, Entwurf/Rueckfrage anzeigen
// ----------------------------------------------------------------------------
async function kgGeneriere(payload, chatBereich, bodyEl, zustand, nutzerNachricht) {
  // Ladeanzeige moeglichst im Chat-Verlauf zeigen (falls schon vorhanden),
  // damit sie an der richtigen Stelle im Scroll-Bereich erscheint.
  const ziel = chatBereich.querySelector('.kg-verlauf') || chatBereich;
  const lade = document.createElement('div');
  lade.className = 'kg-lade';
  lade.textContent = 'Erstelle Entwurf …';
  ziel.appendChild(lade);
  ziel.scrollTop = ziel.scrollHeight;
  try {
    const data = await kgRufeApiAuf({ ...payload, mailInhalt: payload.mailInhalt ?? zustand.mailInhalt, mitarbeiterEmail: kgHoleMitarbeiterEmail() });
    lade.remove();
    if (data.aktion === 'entwurf') {
      zustand.aktuellerEntwurf = data.text;
      if (payload.vorlageId) zustand.aktuelleVorlageId = payload.vorlageId;
      if (data.betreff) zustand.aktuellerBetreff = data.betreff;
      kgZeigeEntwurf(chatBereich, bodyEl, zustand, nutzerNachricht);
    } else if (data.aktion === 'rueckfrage') {
      kgZeigeRueckfrage(chatBereich, data, bodyEl, zustand);
    }
  } catch (e) {
    lade.style.color = '#B4655F';
    lade.textContent = 'Fehler: ' + e.message;
  }
}

let kgNachbesserCache = null;
async function kgLadeNachbesserButtons(container, onClick) {
  if (!kgNachbesserCache) {
    try { kgNachbesserCache = (await kgRufeApiAuf({ modus: 'liste-nachbessern' })).buttons || []; }
    catch (e) { kgNachbesserCache = []; }
  }
  container.innerHTML = kgNachbesserCache.map(b => `<span class="kg-chip" data-anweisung="${kgEscape(b.anweisung)}">${kgEscape(b.titel)}</span>`).join('');
  container.querySelectorAll('.kg-chip').forEach(chip => chip.addEventListener('click', () => onClick(chip.dataset.anweisung)));
}

function kgZeigeEntwurf(chatBereich, bodyEl, zustand, nutzerNachricht) {
  // Chat-Verlauf: jede Version bleibt sichtbar (hoch-/runterscrollbar) statt
  // die vorherige zu ersetzen - so laesst sich bei Bedarf auch zu einer
  // frueheren Version zurueckkehren. Aufbau (Verlauf + Nachbessern-Zeile +
  // Uebernehmen-Button) wird nur beim allerersten Entwurf erstellt, danach
  // wird nur noch in den Verlauf hinein ergaenzt.
  let verlauf = chatBereich.querySelector('.kg-verlauf');

  if (!verlauf) {
    // Sobald ein Entwurf steht, braucht es das urspruengliche "Eigene
    // Stichworte"-Feld oben nicht mehr (Nachbessern passiert ab jetzt ueber
    // das Feld im Chat-Verlauf) - sonst wirkt es wie ein zweites,
    // ueberfluessiges leeres Feld.
    const obereZeile = chatBereich.closest('.kg-scroll')?.querySelector(':scope > .kg-row');
    if (obereZeile) obereZeile.style.display = 'none';

    chatBereich.insertAdjacentHTML('beforeend', `
      <div class="kg-verlauf"></div>
      <div class="kg-quickchips kg-quick-nachbessern"></div>
      <div class="kg-followuprow">
        <div class="kg-anrede-chips">${kgAnredeChipsHtml()}</div>
        <button class="kg-micbtn" title="Diktieren">${kgSvg(KG_ICON_MIC)}</button>
        <input type="text" placeholder="Nachbessern oder eigene Anweisung…">
      </div>`);
    verlauf = chatBereich.querySelector('.kg-verlauf');

    // Anrede-Chips: immer fest vorhanden (unabhaengig von den anpassbaren
    // Nachbessern-Buttons), da Du/Ihr/Sie eine Grundfunktion ist, kein
    // optionales Extra. Sobald ein Entwurf steht (hier immer der Fall),
    // loest ein Klick sofort eine Umformulierung aus.
    kgVerdrahteAnredeChips(chatBereich.querySelector('.kg-followuprow .kg-anrede-chips'), chatBereich, bodyEl, zustand);
    kgAktualisiereAnredeChips(zustand);

    kgLadeNachbesserButtons(chatBereich.querySelector('.kg-quick-nachbessern'), (anweisung) => {
      kgGeneriere({ modus: 'nachbessern', aktuellerEntwurf: zustand.aktuellerEntwurf, anweisung, vorlageId: zustand.aktuelleVorlageId }, chatBereich, bodyEl, zustand, anweisung);
    });

    const input = chatBereich.querySelector('.kg-followuprow input');
    kgSchuetzeFokus(input);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        const text = input.value.trim();
        kgGeneriere({ modus: 'nachbessern', aktuellerEntwurf: zustand.aktuellerEntwurf, anweisung: text, vorlageId: zustand.aktuelleVorlageId }, chatBereich, bodyEl, zustand, text);
        input.value = '';
      }
    });
    kgAktiviereMikrofon(chatBereich.querySelector('.kg-followuprow .kg-micbtn'), input);
  }

  if (nutzerNachricht) {
    verlauf.insertAdjacentHTML('beforeend', `<div class="kg-msg kg-user"><div class="kg-bubble">${kgEscape(nutzerNachricht)}</div></div>`);
  }

  // Bisherige "aktuelle" Markierung entfernen - es gibt immer nur eine
  // hervorgehobene (aktive) Version, alle aelteren werden dezenter.
  verlauf.querySelectorAll('.kg-msg.kg-ai.kg-aktuell').forEach(el => el.classList.remove('kg-aktuell'));

  // Eigene, unveraenderliche Kopie des Texts fuer DIESE Bubble - falls spaeter
  // weiter nachgebessert wird, soll "Diese Version verwenden" trotzdem noch
  // genau diesen (aelteren) Stand einfuegen koennen.
  const dieserText = zustand.aktuellerEntwurf;
  const aiDiv = document.createElement('div');
  aiDiv.className = 'kg-msg kg-ai kg-aktuell';
  aiDiv.innerHTML = `<div class="kg-bubble">${kgMarkdownZuHtml(dieserText)}</div><button class="kg-diese-version">In Mail übernehmen</button>`;
  verlauf.appendChild(aiDiv);
  aiDiv.querySelector('.kg-diese-version').addEventListener('click', () => {
    zustand.aktuellerEntwurf = dieserText;
    kgSetzeBetreff(zustand.aktuellerBetreff);
    kgUebernehmeInMail(bodyEl, dieserText);
    kgSchliessePanel(zustand);
  });

  verlauf.scrollTop = verlauf.scrollHeight;
}

function kgZeigeRueckfrage(chatBereich, data, bodyEl, zustand) {
  const div = document.createElement('div');
  div.className = 'kg-msg kg-frage';
  div.innerHTML = `<div class="kg-bubble">${kgEscape(data.frage)}</div>
    <div class="kg-answers">${data.antworten.map(a => `<span class="kg-answer" data-label="${kgEscape(a.label)}">${kgEscape(a.label)}</span>`).join('')}</div>`;
  chatBereich.appendChild(div);
  div.querySelectorAll('.kg-answer').forEach(btn => {
    btn.addEventListener('click', () => {
      div.querySelectorAll('.kg-answer').forEach(b => b.classList.remove('kg-picked'));
      btn.classList.add('kg-picked');
      zustand.aktuelleVorlageId = data.vorlageId;
      kgGeneriere({ modus: 'rueckfrage-antwort', vorlageId: data.vorlageId, antwortLabel: btn.dataset.label }, chatBereich, bodyEl, zustand, btn.dataset.label);
    });
  });
}

// ----------------------------------------------------------------------------
// Zusatzfenster (Typ Tabelle): strukturierte Eingabemaske(n) vor dem
// Erstellen einer Vorlage mit Positionsliste (z.B. Bestellungen). Ein
// Zusatzfenster ist eine eigenstaendige, wiederverwendbare Bibliothek -
// einer Vorlage koennen mehrere zugewiesen sein (ueber die
// Zuordnungstabelle), die dann gemeinsam in einem Fenster erscheinen.
// ----------------------------------------------------------------------------
function kgZusatzfensterVon(vorlage) {
  const eintraege = vorlage.mailassistent_vorlage_zusatzfenster;
  if (!eintraege) return [];
  const liste = Array.isArray(eintraege) ? eintraege : [eintraege];
  return liste.map(e => e.mailassistent_zusatzfenster).filter(Boolean);
}
// Definierte Position: Dropdown (typ='dropdown') oder Zahlenfeld (typ='zahl'),
// wie in der Verwaltung konfiguriert.
function kgZfSpalteFeldHtml(s) {
  if (s.typ === 'zahl') {
    return `<td><input type="number" class="kg-zf-spalte" data-spalte="${kgEscape(s.titel)}">${s.einheit ? ` <span class="kg-zf-einheit">${kgEscape(s.einheit)}</span>` : ''}</td>`;
  }
  const optionen = (s.mailassistent_zusatzfenster_spalte_option || []).slice().sort((a, b) => a.reihenfolge - b.reihenfolge);
  return `<td><select class="kg-zf-spalte" data-spalte="${kgEscape(s.titel)}">
    <option value=""></option>
    ${optionen.map(o => `<option value="${kgEscape(o.wert)}">${kgEscape(o.wert)}</option>`).join('')}
  </select></td>`;
}
// Eigene Position: exakt dieselben Spalten wie oben, aber immer als leeres
// Freitextfeld statt Dropdown/Zahlenfeld - die vorgegebenen Optionen decken
// eine eigene Position per Definition nicht ab.
function kgZfEigeneZeileHtml(spalten) {
  return `
    <tr class="kg-zf-zeile kg-zf-eigene-zeile" data-position="">
      <td><input type="number" min="0" class="kg-zf-anzahl" value="0"></td>
      <td><input type="text" class="kg-zf-eigenname" placeholder="Eigene Position"></td>
      ${spalten.map(s => `<td><input type="text" class="kg-zf-spalte" data-spalte="${kgEscape(s.titel)}" placeholder="frei"></td>`).join('')}
    </tr>`;
}
function kgZfZeileAusHtml(html) {
  const wrapper = document.createElement('tbody');
  wrapper.innerHTML = html;
  return wrapper.firstElementChild;
}
// Ohne definierte Positionen (z.B. wenn eine Dropdown-Spalte wie "Artikel"
// die Zeile schon eindeutig genug beschreibt) gibt es keine eigene
// Positions-Spalte - stattdessen einfach eine wachsende Liste ganz normaler
// Dropdown/Zahl-Zeilen, die sich beim Ausfuellen der letzten automatisch
// vermehrt.
function kgZfGenerischeZeileHtml(spalten) {
  return `
    <tr class="kg-zf-zeile kg-zf-generische-zeile">
      <td><input type="number" min="0" class="kg-zf-anzahl" value="0"></td>
      ${spalten.map(s => kgZfSpalteFeldHtml(s)).join('')}
    </tr>`;
}
// Baut nur die Tabelle EINES Zusatzfensters (ohne Titel/Buttons drumherum -
// die werden einmal gemeinsam fuer alle zugewiesenen Zusatzfenster gebaut,
// siehe kgZeigeZusatzfenster).
function kgZfTabelleHtml(zf, index) {
  const spalten = (zf.mailassistent_zusatzfenster_spalte || []).slice().sort((a, b) => a.reihenfolge - b.reihenfolge);
  const positionen = (zf.mailassistent_zusatzfenster_position || []).slice().sort((a, b) => a.reihenfolge - b.reihenfolge);
  const spaltenHtml = spalten.map(s => `<th>${kgEscape(s.titel)}</th>`).join('');
  // Zwei getrennte Zusatzfenster-Typen (nicht mehr eine Tabelle mit
  // optionalem Positionen-Zusatz): 'tabelle_fix' hat feste, in der
  // Verwaltung erfasste Zeilen, 'tabelle' waechst in Gmail frei.
  const istFix = zf.typ === 'tabelle_fix';
  let kopfHtml, zeilenHtml;
  if (istFix) {
    const zeileHtml = (titel) => `
      <tr class="kg-zf-zeile" data-position="${kgEscape(titel)}">
        <td><input type="number" min="0" class="kg-zf-anzahl" value="0"></td>
        <td>${kgEscape(titel)}</td>
        ${spalten.map(s => kgZfSpalteFeldHtml(s)).join('')}
      </tr>`;
    kopfHtml = `<th>Anzahl</th><th>Position</th>${spaltenHtml}`;
    zeilenHtml = positionen.map(p => zeileHtml(p.titel)).join('')
      + (zf.erlaubt_eigene_eingabe ? kgZfEigeneZeileHtml(spalten) : '');
  } else {
    // Keine Positionen erfasst: immer mindestens eine ausfuellbare Zeile
    // zeigen, sonst waere die Tabelle leer und unbenutzbar.
    kopfHtml = `<th>Anzahl</th>${spaltenHtml}`;
    zeilenHtml = kgZfGenerischeZeileHtml(spalten);
  }
  return `
    <div class="kg-zf-block">
      <div class="kg-zf-titel">${kgEscape(zf.titel)}</div>
      <table class="kg-zf-tabelle" data-zf-index="${index}">
        <thead><tr>${kopfHtml}</tr></thead>
        <tbody>${zeilenHtml}</tbody>
      </table>
    </div>`;
}
function kgZfSammleEintraege(tabelle, zf) {
  const spalten = (zf.mailassistent_zusatzfenster_spalte || []).slice().sort((a, b) => a.reihenfolge - b.reihenfolge);
  const eintraege = [];
  tabelle.querySelectorAll('.kg-zf-zeile').forEach(zeile => {
    const anzahl = parseInt(zeile.querySelector('.kg-zf-anzahl').value, 10) || 0;
    // Generische Zeile (keine Positionen definiert): keine eigene
    // Positions-Bezeichnung vorhanden - die erste Spalte (z.B. "Artikel")
    // uebernimmt diese Rolle, der Rest wird als Detail angehaengt.
    if (zeile.classList.contains('kg-zf-generische-zeile')) {
      if (!spalten.length) return;
      const werte = spalten.map(s => {
        const feld = zeile.querySelector(`.kg-zf-spalte[data-spalte="${CSS.escape(s.titel)}"]`);
        return feld ? feld.value.trim() : '';
      });
      const positionsname = werte[0];
      if (!positionsname || anzahl <= 0) return;
      const details = spalten.slice(1)
        .map((s, i) => werte[i + 1] ? `${s.titel}: ${werte[i + 1]}` : null)
        .filter(Boolean)
        .join(', ');
      eintraege.push(`- ${anzahl}x ${positionsname}${details ? ' (' + details + ')' : ''}`);
      return;
    }
    const eigennameEl = zeile.querySelector('.kg-zf-eigenname');
    const positionsname = eigennameEl ? eigennameEl.value.trim() : zeile.dataset.position;
    if (!positionsname || anzahl <= 0) return;
    const details = spalten
      .map(s => {
        const feld = zeile.querySelector(`.kg-zf-spalte[data-spalte="${CSS.escape(s.titel)}"]`);
        const wert = feld ? feld.value.trim() : '';
        return wert ? `${s.titel}: ${wert}` : null;
      })
      .filter(Boolean)
      .join(', ');
    eintraege.push(`- ${anzahl}x ${positionsname}${details ? ' (' + details + ')' : ''}`);
  });
  return eintraege;
}
// zfListe: alle Zusatzfenster, die dieser Vorlage zugewiesen sind - erscheinen
// gemeinsam untereinander in einem Fenster mit einer gemeinsamen
// "Übernehmen"-Aktion, die jede Tabelle in ihren eigenen Platzhalter einsetzt.
function kgZeigeZusatzfenster(zfListe, vorlage, chatBereich, bodyEl, zustand) {
  chatBereich.innerHTML = `
    <div class="kg-zusatzfenster">
      ${zfListe.map((zf, i) => kgZfTabelleHtml(zf, i)).join('')}
      <div class="kg-zf-btns">
        <button class="kg-zf-abbrechen" type="button">Abbrechen</button>
        <button class="kg-zf-uebernehmen" type="button">Übernehmen &amp; Entwurf erstellen</button>
      </div>
    </div>`;
  const container = chatBereich.querySelector('.kg-zusatzfenster');

  zfListe.forEach((zf, i) => {
    const tbody = container.querySelector(`table[data-zf-index="${i}"] tbody`);
    const spalten = (zf.mailassistent_zusatzfenster_spalte || []).slice().sort((a, b) => a.reihenfolge - b.reihenfolge);
    const istFix = zf.typ === 'tabelle_fix';

    // Typ "tabelle": generische Dropdown-Zeilen wachsen automatisch nach.
    // Typ "tabelle_fix": die "Eigene Position"-Zeilen wachsen nach (falls
    // erlaubt) - jeweils sobald die letzte Zeile befuellt wird.
    if (!istFix) {
      tbody.addEventListener('input', (e) => {
        const zeile = e.target.closest('.kg-zf-generische-zeile');
        if (!zeile) return;
        const zeilen = tbody.querySelectorAll('.kg-zf-generische-zeile');
        if (zeile !== zeilen[zeilen.length - 1]) return;
        const hatInhalt = Array.from(zeile.querySelectorAll('input, select')).some(f => f.value.trim());
        if (hatInhalt) tbody.appendChild(kgZfZeileAusHtml(kgZfGenerischeZeileHtml(spalten)));
      });
    } else if (zf.erlaubt_eigene_eingabe) {
      tbody.addEventListener('input', (e) => {
        const zeile = e.target.closest('.kg-zf-eigene-zeile');
        if (!zeile) return;
        const eigeneZeilen = tbody.querySelectorAll('.kg-zf-eigene-zeile');
        if (zeile !== eigeneZeilen[eigeneZeilen.length - 1]) return;
        const hatInhalt = Array.from(zeile.querySelectorAll('input')).some(f => f.value.trim());
        if (hatInhalt) tbody.appendChild(kgZfZeileAusHtml(kgZfEigeneZeileHtml(spalten)));
      });
    }
  });

  container.querySelector('.kg-zf-abbrechen').addEventListener('click', () => { chatBereich.innerHTML = ''; });
  container.querySelector('.kg-zf-uebernehmen').addEventListener('click', () => {
    let text = vorlage.inhalt || '';
    let irgendwasAusgefuellt = false;
    zfListe.forEach((zf, i) => {
      const tabelle = container.querySelector(`table[data-zf-index="${i}"]`);
      const eintraege = kgZfSammleEintraege(tabelle, zf);
      if (!eintraege.length) return;
      irgendwasAusgefuellt = true;
      const liste = eintraege.join('\n');
      text = text.includes(zf.platzhalter) ? text.replace(zf.platzhalter, liste) : `${text}\n\n${liste}`;
    });
    if (!irgendwasAusgefuellt) {
      if (!container.querySelector('.kg-zf-hinweis')) {
        const hinweis = document.createElement('div');
        hinweis.className = 'kg-zf-hinweis';
        hinweis.textContent = 'Bitte mindestens eine Position mit Anzahl grösser 0 ausfüllen.';
        container.insertBefore(hinweis, container.querySelector('.kg-zf-btns'));
      }
      return;
    }
    zustand.aktuellerEntwurf = text;
    zustand.aktuelleVorlageId = vorlage.id;
    if (vorlage.betreff) zustand.aktuellerBetreff = vorlage.betreff;
    chatBereich.innerHTML = '';
    kgZeigeEntwurf(chatBereich, bodyEl, zustand, `Vorlage: ${vorlage.titel}`);
  });
}

// ----------------------------------------------------------------------------
// Kleine, kontrollierte Markdown-Teilmenge in HTML umwandeln: **fett**,
// *kursiv*, "- " Aufzaehlungen und "1. " nummerierte Listen. Text wird zuerst
// escaped (kein rohes HTML aus Vorlagen/KI-Text moeglich) - erst danach
// werden gezielt eigene Tags eingefuegt, das ist sicher, weil nur unsere
// eigenen festen Muster erkannt werden.
// ----------------------------------------------------------------------------
function kgInlineFormat(s) {
  let out = kgEscape(s);
  out = out.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  out = out.replace(/\*(.+?)\*/g, '<i>$1</i>');
  return out;
}
function kgMarkdownZuHtml(text) {
  const zeilen = String(text ?? '').split('\n');
  const htmlZeilen = [];
  let listenTyp = null; // 'ul' | 'ol' | null
  const listeSchliessen = () => { if (listenTyp) { htmlZeilen.push(`</${listenTyp}>`); listenTyp = null; } };

  zeilen.forEach(zeile => {
    const bulletMatch = zeile.match(/^\s*-\s+(.*)$/);
    const nummeriertMatch = zeile.match(/^\s*\d+\.\s+(.*)$/);
    if (bulletMatch) {
      if (listenTyp !== 'ul') { listeSchliessen(); htmlZeilen.push('<ul>'); listenTyp = 'ul'; }
      htmlZeilen.push(`<li>${kgInlineFormat(bulletMatch[1])}</li>`);
    } else if (nummeriertMatch) {
      if (listenTyp !== 'ol') { listeSchliessen(); htmlZeilen.push('<ol>'); listenTyp = 'ol'; }
      htmlZeilen.push(`<li>${kgInlineFormat(nummeriertMatch[1])}</li>`);
    } else {
      listeSchliessen();
      htmlZeilen.push(zeile.trim() === '' ? '<br>' : `<div>${kgInlineFormat(zeile)}</div>`);
    }
  });
  listeSchliessen();
  return htmlZeilen.join('');
}

// Betreff-Feld setzen (nur beim Verfassen vorhanden, bei Antworten gibt es
// keins - Gmail behaelt dort automatisch "Re: ..."). Muss ueber die native
// Value-Setter-Funktion laufen, sonst merkt Gmails eigenes React-artiges UI
// die Aenderung nicht.
function kgSetzeBetreff(betreff) {
  if (!betreff) return;
  const feld = document.querySelector('input[name="subjectbox"]');
  if (!feld) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(feld, betreff);
  feld.dispatchEvent(new Event('input', { bubbles: true }));
  feld.dispatchEvent(new Event('change', { bubbles: true }));
}

// ----------------------------------------------------------------------------
// Entwurf ins Mailfeld uebernehmen - eigenen Text vor einem evtl. zitierten
// Verlauf einfuegen, das Zitat selbst bleibt unveraendert stehen. Als HTML
// eingefuegt (nicht nur Text), damit Fett/Kursiv/Listen wirklich als
// Formatierung ankommen statt als rohe Sternchen/Striche.
// ----------------------------------------------------------------------------
function kgUebernehmeInMail(bodyEl, text) {
  bodyEl.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  const zitat = bodyEl.querySelector('blockquote, .gmail_quote');
  const html = kgMarkdownZuHtml(text) + '<br><br>';
  try {
    range.setStart(bodyEl, 0);
    // Ohne Zitat NICHT den ganzen Inhalt auswaehlen (das wuerde die am Ende
    // stehende Gmail-Signatur mit ueberschreiben) - stattdessen den Bereich an
    // Position 0 kollabieren, dann fuegt insertHTML nur ein, ohne etwas zu
    // loeschen, und die Signatur bleibt unten stehen.
    if (zitat) range.setEndBefore(zitat); else range.setEnd(bodyEl, 0);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertHTML', false, html);
  } catch (e) {
    // Falls die Bereichs-Auswahl fehlschlaegt (z.B. ungewohnte Gmail-Struktur):
    // Text einfach am aktuellen Cursor einfuegen, nichts loeschen.
    document.execCommand('insertHTML', false, html);
  }
}

// ----------------------------------------------------------------------------
// Fokus-Schutz: Gmails Mailtext-Feld holt sich bei einem Blur-Ereignis oft
// sofort wieder selbst den Fokus zurueck (z.B. um den Cursor "an Ort und
// Stelle" zu halten) - das faengt auch Klicks in unsere Eingabefelder ab,
// weil unser Panel direkt daneben im DOM sitzt. Fokus einen Tick spaeter
// (nach Gmails eigener Reaktion) erneut erzwingen.
// ----------------------------------------------------------------------------
function kgSchuetzeFokus(el) {
  el.addEventListener('mousedown', () => {
    setTimeout(() => el.focus(), 0);
  });
}

// ----------------------------------------------------------------------------
// Mikrofon (Web Speech API) - diktiert direkt ins uebergebene Feld.
// ----------------------------------------------------------------------------
function kgAktiviereMikrofon(button, feld) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { button.style.display = 'none'; return; }
  const erkennung = new SpeechRecognition();
  erkennung.lang = 'de-CH';
  erkennung.interimResults = false;
  let laeuft = false;
  button.addEventListener('click', () => { laeuft ? erkennung.stop() : erkennung.start(); });
  erkennung.addEventListener('start', () => { laeuft = true; button.classList.add('kg-recording'); });
  erkennung.addEventListener('end', () => { laeuft = false; button.classList.remove('kg-recording'); });
  erkennung.addEventListener('error', () => { laeuft = false; button.classList.remove('kg-recording'); });
  erkennung.addEventListener('result', (e) => {
    const text = Array.from(e.results).map(r => r[0].transcript).join(' ');
    feld.value = (feld.value ? feld.value + ' ' : '') + text;
  });
}
