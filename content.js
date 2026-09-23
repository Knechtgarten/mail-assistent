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

// Fuer Modi, die die Antwort gestreamt (Wort fuer Wort statt am Stueck)
// liefern (z.B. 'rueckfrage-antwort') - ruft onChunk bei jedem neu
// eingetroffenen Textstueck mit dem BISHER GESAMTEN Text auf. Ein Fehler
// mitten im Stream wird vom Server als "\u0000FEHLER:..."-Marker gesendet,
// da zu dem Zeitpunkt schon eine 200-Antwort laeuft.
async function kgRufeApiStreamend(payload, onChunk) {
  const res = await fetch(KG_EDGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KG_ANON_KEY },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Serverfehler (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let voll = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    voll += decoder.decode(value, { stream: true });
    const fehlerAb = voll.indexOf('\u0000FEHLER:');
    if (fehlerAb !== -1) throw new Error(voll.slice(fehlerAb + 8));
    onChunk(voll);
  }
  return voll;
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
// Ein sichtbares Betreff-Feld gibt es nur beim Verfassen einer neuen Mail,
// nicht beim Antworten (dort ist "Betreff" standardmaessig ausgeblendet).
// "container" reicht oft nicht bis zum Betreff-Feld hoch (das liegt in einer
// eigenen Zeile ueber der Toolbar). Bewusst NICHT auf der ganzen Seite
// (document.querySelector) - sind mehrere Compose-/Antwortfenster
// gleichzeitig offen (z.B. mehrere Mails parallel), wuerde das
// faelschlicherweise das Betreff-Feld eines ANDEREN, gerade offenen Fensters
// finden. Frueher wurde dafuer der naechste div[role="dialog"]-Vorfahre
// gesucht - Gmails KOMPAKTES "Neue Nachricht"-Popup (unten rechts, nicht
// ausgeklappt) hat aber offenbar keinen solchen Dialog-Container, darum
// blieb das Betreff-Feld dort unauffindbar. Robusterer, struktur-
// unabhaengiger Ansatz: ALLE Betreff-Felder auf der Seite einsammeln (meist
// eh nur eines, ausser mehrere Compose-Fenster sind gleichzeitig offen) und
// dasjenige nehmen, dessen Vorfahren-Kette auch startEl (das Mailtext-Feld)
// enthaelt - das ist garantiert das gleiche Fenster, unabhaengig davon, ob
// Gmail gerade ein Dialog, ein kompaktes Popup oder eine eingebettete
// Antwort im Thread verwendet.
function kgFindeSubjectbox(startEl) {
  const kandidaten = Array.from(document.querySelectorAll('input[name="subjectbox"]'));
  if (kandidaten.length <= 1) return kandidaten[0] || null;
  for (const feld of kandidaten) {
    let el = feld.parentElement;
    let ebenen = 0;
    while (el && ebenen < 60) {
      if (el.contains(startEl)) return feld;
      el = el.parentElement;
      ebenen++;
    }
  }
  return null;
}
function kgIstVerfassenFenster(container) {
  const subjectbox = kgFindeSubjectbox(container);
  return !!subjectbox && subjectbox.offsetParent !== null;
}

function kgInitialisiere(bodyEl, container, toolbar) {
  const button = document.createElement('span');
  button.className = 'kg-btn';
  button.innerHTML = 'Mail-Assistent';
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

  const zustand = { offen: false, aktuellerEntwurf: null, aktuelleVorlageId: null, aktuellerBetreff: null, anrede: null, mailInhalt: null, istIntern: false, panel, button };

  button.addEventListener('click', async () => {
    zustand.offen = !zustand.offen;
    panel.classList.toggle('kg-show', zustand.offen);
    button.classList.toggle('kg-on', zustand.offen);
    if (!zustand.offen) return;

    // Gmail verwendet fuer ein neues Compose-Fenster manchmal denselben
    // DOM-Container weiter, den vorher schon ein anderes Fenster (z.B. ein
    // Antwort-Entwurf ODER ein fruehers, bereits geschlossenes "Neue
    // Nachricht"-Fenster) benutzt hat - darum bei jedem Oeffnen frisch pruefen.
    // Bei "verfassen" IMMER neu aufbauen (kein Vorlagen-Cache über einzelne
    // Fenster hinweg): liste-verfassen ist ein schneller, reiner Lese-Aufruf
    // ohne KI, das Risiko eines veralteten/falschen Entwurfs aus einem
    // frueheren, wiederverwendeten Fenster wiegt schwerer als der minimale
    // Mehraufwand. Bei "antworten" bleibt der Cache bestehen (echter KI-
    // Aufruf, nicht kostenlos) - dort nur bei einem Wechsel der Fensterart
    // zuruecksetzen.
    const istVerfassenJetzt = kgIstVerfassenFenster(container);
    const typJetzt = istVerfassenJetzt ? 'verfassen' : 'antworten';
    const mussNeuLaden = !panel.dataset.geladen || panel.dataset.typ !== typJetzt || istVerfassenJetzt;
    if (mussNeuLaden) {
      panel.dataset.geladen = '1';
      panel.dataset.typ = typJetzt;
      zustand.aktuellerEntwurf = null;
      zustand.aktuelleVorlageId = null;
      zustand.aktuellerBetreff = null;
      zustand.anrede = null;
      zustand.mailInhalt = null;
      if (istVerfassenJetzt) await kgZeigeVerfassenChips(panel, bodyEl, zustand);
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
  // nicht unuebersichtlich wird. Untermenue ist ein echtes, klein bemessenes
  // Dropdown direkt unter dem jeweiligen Button (per JS positioniert, da die
  // Chips zeilenumbrechen) - anders als beim grossen Panel frueher ist das
  // hier ein kleiner, begrenzter Bereich, darum unproblematisch.
  const obersteEbene = vorlagen.filter(v => !v.parent_id);
  const kinderVon = (elternId) => vorlagen.filter(v => v.parent_id === elternId);
  const chipHtml = (v) => `<span class="kg-chip${istExpress(v) ? ' kg-chip-express' : ''}" data-id="${v.id}" title="${istExpress(v) ? 'Express - wird sofort eingefuegt' : ''}">${kgEscape(v.titel)}</span>`;

  scroll.innerHTML = `
    <div class="kg-chips">${obersteEbene.map(v => v.typ === 'dropdown'
      ? `<span class="kg-chip kg-chip-dropdown" data-dropdown-id="${v.id}">${kgEscape(v.titel)}${kgSvg(KG_ICON_CHEVRON, 13)}</span>`
      : chipHtml(v)
    ).join('')}</div>
    ${obersteEbene.filter(v => v.typ === 'dropdown').map(gruppe => `
      <div class="kg-chips kg-dropdown-submenu" data-dropdown-id="${gruppe.id}">${kinderVon(gruppe.id).map(chipHtml).join('') || '<span class="kg-dropdown-leer">Keine Vorlagen in dieser Gruppe.</span>'}</div>
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
  kgAutoWachsen(textarea);
  kgVerdrahteAnredeChips(scroll.querySelector('.kg-anrede-chips'), chatBereich, bodyEl, zustand);
  kgAktualisiereAnredeChips(zustand);

  // Sichtbarkeit bewusst per Inline-Style (nicht nur per CSS-Klasse) steuern -
  // so haengt "geschlossen beim Start" nicht davon ab, dass eine externe
  // Stylesheet-Datei im Browser schon aktualisiert ist. Position wird beim
  // Oeffnen live berechnet, weil die Chips zeilenumbrechen koennen - der
  // Button steht also nicht immer an derselben Stelle.
  const kgSchliesseAlleDropdowns = () => {
    scroll.querySelectorAll('.kg-dropdown-submenu').forEach(s => { s.style.display = 'none'; });
    scroll.querySelectorAll('.kg-chip-dropdown').forEach(b => b.classList.remove('kg-chip-aktiv'));
  };
  kgSchliesseAlleDropdowns();
  scroll.querySelectorAll('.kg-chip-dropdown').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const submenu = scroll.querySelector(`.kg-dropdown-submenu[data-dropdown-id="${btn.dataset.dropdownId}"]`);
      const warOffen = submenu.style.display !== 'none';
      kgSchliesseAlleDropdowns();
      if (!warOffen) {
        const scrollRect = scroll.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        submenu.style.top = Math.round(btnRect.bottom - scrollRect.top + 4) + 'px';
        submenu.style.left = Math.round(btnRect.left - scrollRect.left) + 'px';
        submenu.style.display = 'flex';
        btn.classList.add('kg-chip-aktiv');
      }
    });
  });
  // Klick irgendwo sonst im Panel schliesst ein offenes Dropdown wieder.
  scroll.addEventListener('click', (e) => {
    if (!e.target.closest('.kg-chip-dropdown') && !e.target.closest('.kg-dropdown-submenu')) kgSchliesseAlleDropdowns();
  });

  scroll.querySelectorAll('.kg-chips .kg-chip:not(.kg-chip-dropdown)').forEach(chip => {
    chip.addEventListener('click', () => {
      kgSchliesseAlleDropdowns();
      const vorlage = vorlagen.find(v => v.id === chip.dataset.id);
      const zusatzfensterListe = vorlage ? kgZusatzfensterVon(vorlage) : [];
      if (vorlage && zusatzfensterListe.length) {
        // Strukturierte Eingabemaske(n) (z.B. Bestell-Tabelle) zuerst zeigen -
        // die daraus gebaute Liste ersetzt den jeweiligen Platzhalter direkt,
        // ganz ohne KI-Aufruf (die Daten sind schon vollstaendig strukturiert).
        const eingabeListe = zusatzfensterListe.filter(zf => zf.typ === 'eingabe');
        const andereListe = zusatzfensterListe.filter(zf => zf.typ !== 'eingabe');
        const opts = { vorlageId: vorlage.id, betreff: vorlage.betreff, titelLabel: `Vorlage: ${vorlage.titel}` };
        if (eingabeListe.length) {
          kgZeigeEingabePopup(eingabeListe, andereListe, vorlage.inhalt || '', chatBereich, bodyEl, zustand, opts);
        } else {
          kgZeigeZusatzfenster(andereListe, vorlage.inhalt || '', chatBereich, bodyEl, zustand, opts);
        }
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
      textarea.dispatchEvent(new Event('input'));
    }
  });
  kgAktiviereMikrofon(scroll.querySelector('.kg-micbtn'), textarea);
}

// ----------------------------------------------------------------------------
// Antworten: sofort automatisch Entwurf/Rueckfrage anhand der eingehenden
// Mail erstellen - keine Chips.
// ----------------------------------------------------------------------------
// Betreff der eingehenden Mail (Gmail-Klasse "hP" fuer die Thread-Ueberschrift
// - seit Jahren stabil, aber nicht offiziell dokumentiert). Wichtig, weil im
// Betreff manchmal Angaben stehen (z.B. Namen), die im Mailtext selbst gar
// nicht mehr vorkommen. Von bodyEl aus nach oben klettern und pro Ebene im
// Teilbaum nach "h2.hP" suchen - findet garantiert die Ueberschrift des
// gleichen Threads, auch wenn mehrere Mails/Fenster gleichzeitig offen sind.
function kgHoleBetreffEingehend(bodyEl) {
  let el = bodyEl;
  let ebenen = 0;
  while (el && ebenen < 80) {
    const h2 = el.querySelector && el.querySelector('h2.hP');
    if (h2 && (h2.textContent || '').trim()) return h2.textContent.trim();
    el = el.parentElement;
    ebenen++;
  }
  const global = document.querySelector('h2.hP');
  return global ? (global.textContent || '').trim() : null;
}

// Container des ganzen Mail-Threads (ueber die Ueberschrift "h2.hP") - wird
// sowohl fuer den Betreff als auch fuer die Von/An/Cc-Suche gebraucht, damit
// bei mehreren gleichzeitig offenen Mails nicht der falsche Thread erwischt
// wird.
function kgFindeMailContainer(bodyEl) {
  let el = bodyEl;
  let ebenen = 0;
  while (el && ebenen < 80) {
    if (el.querySelector && el.querySelector('h2.hP')) return el;
    el = el.parentElement;
    ebenen++;
  }
  return null;
}

// Von/An/Cc-Personen der eingehenden Mail (Gmail markiert Absender- und
// Empfaenger-Namen mit "email"/"name"-Attributen - gleiches stabile Muster
// wie kgHoleAbsenderEmail). Wichtig, damit die KI z.B. bei einem Handwerker,
// Architekten oder einer im Cc erwaehnten Person erkennt, wer zu welcher
// Seite gehoert, statt das zu erraten. Cc-Empfaenger stehen in Gmail teils
// erst nach Klick auf "Details" (Pfeil neben dem Absendernamen) vollstaendig
// im DOM - wurde nicht geklickt, liefert das ggf. nur den Absender.
function kgHoleEmpfaengerKontext(bodyEl) {
  const container = kgFindeMailContainer(bodyEl);
  if (!container) return [];
  const kandidaten = Array.from(container.querySelectorAll('[email]'))
    .filter(node => node !== bodyEl && !node.contains(bodyEl) && !bodyEl.contains(node));
  const gesehen = new Set();
  const liste = [];
  for (const node of kandidaten) {
    const email = (node.getAttribute('email') || '').trim();
    if (!email || !email.includes('@') || gesehen.has(email.toLowerCase())) continue;
    gesehen.add(email.toLowerCase());
    const name = (node.getAttribute('name') || '').trim();
    liste.push(name ? `${name} <${email}>` : email);
  }
  return liste;
}

// Findet innerhalb eines Threads (mehrere Nachrichten moeglich, z.B.
// Kundenanfrage + spaetere interne Weiterleitung) das Element, das selector
// matcht und im Dokument UNMITTELBAR VOR bodyEl liegt - bewusst NICHT "das
// letzte im ganzen Thread", sonst wuerde beim Antworten auf eine AELTERE
// Nachricht faelschlich der Inhalt/Absender einer JUENGEREN Nachricht im
// gleichen Thread genommen (z.B. eine interne Weiterleitung, die zeitlich
// nach der eigentlichen Kundenanfrage kam, aber im Thread weiter unten,
// also spaeter im DOM steht). scope grenzt zusaetzlich auf den aktuellen
// Thread/Container ein, damit bei mehreren gleichzeitig offenen Mails nicht
// eine ganz andere Konversation erwischt wird. nichtLeer (optional):
// Kandidaten ohne brauchbaren Inhalt werden uebersprungen, der naechst-
// vorherige wird dann versucht.
function kgFindeVorherigesElement(bodyEl, selector, scope, nichtLeer) {
  const kandidaten = Array.from((scope || document).querySelectorAll(selector))
    .filter(el => el !== bodyEl && !el.contains(bodyEl) && !bodyEl.contains(el));
  const davor = kandidaten.filter(el => (el.compareDocumentPosition(bodyEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  const liste = davor.length ? davor : kandidaten; // Rueckfall, falls das Antwortfeld doch vor allen Kandidaten steht
  for (let i = liste.length - 1; i >= 0; i--) {
    if (!nichtLeer || nichtLeer(liste[i])) return liste[i];
  }
  return null;
}

function kgHoleMailInhalt(bodyEl, container) {
  // 1. Manche Antwortfenster haben den zitierten Verlauf direkt im Editierfeld
  //    (blockquote/.gmail_quote). Falls nicht (Gmail klappt das oft erst nach
  //    Klick auf "..." auf), 2. stattdessen die Nachricht direkt darueber im
  //    Thread suchen (Gmail-Klasse "a3s" fuer den reinen Nachrichtentext -
  //    seit Jahren stabil, aber nicht offiziell dokumentiert).
  const zitat = bodyEl.querySelector('blockquote, .gmail_quote');
  let text = ((zitat ? zitat.textContent : '') || '').trim();
  if (!text) {
    const threadContainer = kgFindeMailContainer(bodyEl);
    const nachricht = kgFindeVorherigesElement(bodyEl, 'div.a3s.aiL, div.a3s', threadContainer, el => (el.textContent || '').trim());
    text = nachricht ? (nachricht.textContent || '').trim() : '';
  }
  if (!text) text = (bodyEl.textContent || '').trim();
  if (!text) return '(kein Mailinhalt gefunden)';
  const kopf = [];
  const betreff = kgHoleBetreffEingehend(bodyEl);
  if (betreff) kopf.push(`Betreff: ${betreff}`);
  const empfaenger = kgHoleEmpfaengerKontext(bodyEl);
  if (empfaenger.length) kopf.push(`Beteiligte Personen laut Mailkopf (Von/An/Cc): ${empfaenger.join(', ')}`);
  return kopf.length ? `${kopf.join('\n')}\n\n${text}` : text;
}

// Absender der Mail, auf die geantwortet wird - fuer den Express-Pfad bei
// internen Mails (@knechtgarten.ch). Gmail markiert den Absender-Namen mit
// einem "email"-Attribut (aehnlich stabil wie die "a3s"-Klasse oben).
function kgHoleAbsenderEmail(bodyEl) {
  const threadContainer = kgFindeMailContainer(bodyEl);
  const el = kgFindeVorherigesElement(bodyEl, '[email]', threadContainer, e => (e.getAttribute('email') || '').includes('@'));
  return el ? el.getAttribute('email') : null;
}

// Direkt beim Oeffnen startet automatisch die Klassifizierung (kein
// separater Eingabeschritt mehr vorher) - das dunkle Popup ist von Anfang an
// da und uebernimmt gleich die Ladeanzeige.
async function kgStarteAntworten(panel, bodyEl, container, zustand) {
  const scroll = panel.querySelector('.kg-scroll');
  kgAntwortenStarten(scroll, bodyEl, container, zustand);
}

// Dunkles Popup (bewusst gleiche Farbe wie der Mail-Assistent-Button):
// zeigt zuerst "am Ueberlegen". Trifft eine Rueckfrage-Vorlage zu, bleibt
// das Popup stehen und zeigt Frage + Antworten uebereinander, dazu unten
// ein optionales Ergaenzungsfeld. Trifft keine zu, fragt das Popup kurz
// nach, ob noch etwas ergaenzt werden soll, bevor das (helle) Mail-Fenster
// mit dem fertigen Entwurf aufgeht - so bleibt man bis zum Schluss "noch
// nicht im Mail drin" und kann jederzeit noch etwas dazugeben.
async function kgAntwortenStarten(scroll, bodyEl, container, zustand) {
  scroll.innerHTML = `
    <div class="kg-dunkel-popup">
      <div class="kg-dunkel-spinner"></div>
      <div class="kg-dunkel-text">Einen Moment, ich bereite die Antwort vor …</div>
    </div>`;
  const popup = scroll.querySelector('.kg-dunkel-popup');

  zustand.mailInhalt = kgHoleMailInhalt(bodyEl, container);
  const absender = kgHoleAbsenderEmail(bodyEl);
  const istIntern = !!absender && absender.toLowerCase().endsWith('@knechtgarten.ch');
  zustand.istIntern = istIntern;

  try {
    const data = await kgRufeApiAuf({ modus: 'antworten', mailInhalt: zustand.mailInhalt, intern: istIntern, mitarbeiterEmail: kgHoleMitarbeiterEmail() });
    // TEMPORAERES DEBUGGING (wieder entfernen, sobald die Kundenanfrage-
    // Erkennung sicher funktioniert) - zeigt exakt, was erkannt wurde.
    console.log('[Mail-Assistent DEBUG] absender:', absender, '| istIntern:', istIntern, '| mailInhalt:', zustand.mailInhalt, '| Antwort vom Server:', data);
    if (data.aktion === 'rueckfrage' || data.aktion === 'auswahl') {
      // "auswahl": die KI war sich zwischen zwei aehnlichen Vorlagen unsicher
      // - gleiches Popup wie bei einer echten Rueckfrage (Frage + Buttons
      // uebereinander), nur dass die Buttons hier Vorlagen-Titel statt
      // vordefinierter Antwort-Zweige sind.
      kgZeigeRueckfrageImPopup(popup, data, scroll, bodyEl, zustand);
    } else if (data.aktion === 'zweig' && data.hatDistanzlogik) {
      // Zweig mit Ast-Funktion "distanzlogik" (z.B. Kundenanfragen): keine
      // automatische Entscheidung, der Mitarbeiter waehlt manuell aus allen
      // moeglichen Antworten - dafuer eigenes Layout mit zwei Buttons-Spalten
      // + Info-Spalte (Distanz).
      kgZeigeKundenanfrageImPopup(popup, data, scroll, bodyEl, zustand);
    } else if (data.aktion === 'zweig') {
      // Ast/Zweig-Modell: ein Zweig mit Aktionstyp "Mitarbeiter entscheidet"
      // - KI erkennt nur den Zweig, der Mitarbeiter waehlt manuell die
      // passende Vorlage aus (frage_mitarbeiter erscheint als Ueberschrift).
      kgZeigeZweigImPopup(popup, data, scroll, bodyEl, zustand);
    } else if (istIntern) {
      // Interne Kollegen-Mail: kein "noch was ergaenzen?"-Zwischenschritt,
      // direkt zum fertigen (knappen) Entwurf.
      kgZeigeAntwortenErgebnis(scroll, bodyEl, zustand, data);
    } else {
      kgZeigeErgaenzungImPopup(popup, data, scroll, bodyEl, zustand);
    }
  } catch (e) {
    popup.innerHTML = `<div class="kg-dunkel-text">Fehler: ${kgEscape(e.message)}</div>`;
  }
}

// Kleine Ergaenzungszeile (Mikrofon + Textfeld), wiederverwendet in beiden
// Popup-Varianten unten.
function kgDunkelErgaenzungHtml(placeholder) {
  return `
    <div class="kg-dunkel-ergaenzung-row">
      <button type="button" class="kg-micbtn kg-dunkel-micbtn" title="Diktieren">${kgSvg(KG_ICON_MIC)}</button>
      <textarea rows="1" class="kg-dunkel-ergaenzung" placeholder="${kgEscape(placeholder)}"></textarea>
    </div>`;
}

function kgZeigeRueckfrageImPopup(popup, data, scroll, bodyEl, zustand) {
  popup.innerHTML = `
    <div class="kg-dunkel-frage">${kgEscape(data.frage)}</div>
    <div class="kg-dunkel-antworten">${data.antworten.map(a => `<button type="button" class="kg-dunkel-antwort" data-label="${kgEscape(a.label)}">${kgEscape(a.label)}</button>`).join('')}</div>
    ${kgDunkelErgaenzungHtml('Optional: noch etwas ergänzen …')}`;
  const ergaenzungFeld = popup.querySelector('.kg-dunkel-ergaenzung');
  kgAutoWachsen(ergaenzungFeld);
  kgAktiviereMikrofon(popup.querySelector('.kg-dunkel-micbtn'), ergaenzungFeld);
  popup.querySelectorAll('.kg-dunkel-antwort').forEach(btn => {
    btn.addEventListener('click', async () => {
      const anweisung = ergaenzungFeld.value.trim() || undefined;
      if (data.aktion === 'rueckfrage') zustand.aktuelleVorlageId = data.vorlageId;
      // Popup zeigt weiter die Ladeanzeige, bis das ERSTE Textstueck da ist -
      // sonst wechselt die Anzeige zu frueh auf ein noch leeres Feld mit nur
      // dem blinkenden Cursor, bevor ueberhaupt etwas lesbar ist.
      popup.innerHTML = `<div class="kg-dunkel-spinner"></div><div class="kg-dunkel-text">Einen Moment, ich bereite die Antwort vor …</div>`;
      let chatBereich = null;
      let liveBubble = null;
      // "auswahl": der Button-Text IST der exakte Vorlagen-Titel (siehe
      // Backend), darum reicht data-label direkt als vorlageTitel.
      const payload = data.aktion === 'auswahl'
        ? { modus: 'auswahl-antwort', vorlageTitel: btn.dataset.label, anweisung, mailInhalt: zustand.mailInhalt, mitarbeiterEmail: kgHoleMitarbeiterEmail() }
        : { modus: 'rueckfrage-antwort', vorlageId: data.vorlageId, antwortLabel: btn.dataset.label, anweisung, mailInhalt: zustand.mailInhalt, mitarbeiterEmail: kgHoleMitarbeiterEmail() };
      try {
        const text = await kgRufeApiStreamend(
          payload,
          (vollText) => {
            if (!chatBereich) {
              scroll.innerHTML = '<div class="kg-chat-bereich"></div>';
              chatBereich = scroll.querySelector('.kg-chat-bereich');
              chatBereich.innerHTML = '<div class="kg-msg kg-ai"><div class="kg-bubble kg-live-entwurf"></div></div>';
              liveBubble = chatBereich.querySelector('.kg-live-entwurf');
            }
            liveBubble.innerHTML = kgMarkdownZuHtml(vollText);
            chatBereich.scrollTop = chatBereich.scrollHeight;
          }
        );
        zustand.aktuellerEntwurf = text.trim();
        chatBereich.innerHTML = '';
        kgZeigeEntwurf(chatBereich, bodyEl, zustand);
      } catch (e) {
        if (chatBereich) chatBereich.innerHTML = `<div class="kg-lade" style="color:#B4655F;">Fehler: ${kgEscape(e.message)}</div>`;
        else popup.innerHTML = `<div class="kg-dunkel-text">Fehler: ${kgEscape(e.message)}</div>`;
      }
    });
  });
}

// Kundenanfragen: kein Topf, keine Vorauswahl - eine flache Liste aller
// Antwort-Vorlagen (koennen 10-20 sein), darum zwei Buttons-Spalten statt
// einer Liste, plus eine dritte Info-Spalte mit der Fahrdistanz zu
// Knechtgarten und allen Partnerbetrieben (falls die KI eine Kundenadresse
// erkennen konnte) und dem admin-hinterlegten Hinweistext. Der Mitarbeiter
// entscheidet komplett selbst, welche Antwort-Vorlage passt. Jede
// Antwort-Vorlage ist eine vollwertige Vorlage (kann eigene Zusatzfenster
// haben) - darum nach dem Streamen ueber kgZeigeAntwortenErgebnis geroutet,
// genau wie ein normaler direkter Entwurf.
// Gemeinsame Erzeugungs-Routine fuer beide Button-Arten im Kundenanfragen-
// Popup (grosse Antwort-Vorlagen-Buttons UND die kleinen Weiterleiten-
// Buttons je Partnerbetrieb) - unterscheiden sich nur im Payload und ob es
// Zusatzfenster geben kann.
async function kgKaGeneriereUndZeige(popup, scroll, bodyEl, zustand, ergaenzungFeld, payloadZusatz, zusatzfenster) {
  const anweisung = ergaenzungFeld.value.trim() || undefined;
  popup.innerHTML = `<div class="kg-dunkel-spinner"></div><div class="kg-dunkel-text">Einen Moment, ich bereite die Antwort vor …</div>`;
  let chatBereich = null;
  let liveBubble = null;
  const payload = { modus: 'auswahl-antwort', anweisung, mailInhalt: zustand.mailInhalt, mitarbeiterEmail: kgHoleMitarbeiterEmail(), ...payloadZusatz };
  try {
    const text = await kgRufeApiStreamend(
      payload,
      (vollText) => {
        if (!chatBereich) {
          scroll.innerHTML = '<div class="kg-chat-bereich"></div>';
          chatBereich = scroll.querySelector('.kg-chat-bereich');
          chatBereich.innerHTML = '<div class="kg-msg kg-ai"><div class="kg-bubble kg-live-entwurf"></div></div>';
          liveBubble = chatBereich.querySelector('.kg-live-entwurf');
        }
        liveBubble.innerHTML = kgMarkdownZuHtml(vollText);
        chatBereich.scrollTop = chatBereich.scrollHeight;
      }
    );
    chatBereich.innerHTML = '';
    kgZeigeAntwortenErgebnis(scroll, bodyEl, zustand, {
      text: text.trim(), vorlageId: payloadZusatz.vorlageId || null,
      zusatzfenster: zusatzfenster?.length ? zusatzfenster : undefined,
    });
  } catch (e) {
    if (chatBereich) chatBereich.innerHTML = `<div class="kg-lade" style="color:#B4655F;">Fehler: ${kgEscape(e.message)}</div>`;
    else popup.innerHTML = `<div class="kg-dunkel-text">Fehler: ${kgEscape(e.message)}</div>`;
  }
}
// Zweig-Fenster (Ast/Zweig-Modell): wie kgZeigeRueckfrageImPopup, aber die
// Buttons sind eigenstaendige Vorlagen (data.antworten[].id) statt Zweige
// EINER Vorlage - darum ueber kgKaGeneriereUndZeige (auswahl-antwort mit
// vorlageId) statt rueckfrage-antwort erzeugt. Ueberschrift ist die vom Admin
// hinterlegte "Frage an den Mitarbeiter" (frage_mitarbeiter), falls schon
// erfasst - sonst als Rueckfall der Zweig-Titel.
function kgZeigeZweigImPopup(popup, data, scroll, bodyEl, zustand) {
  popup.innerHTML = `
    <div class="kg-dunkel-frage">${kgEscape(data.frage || data.titel)}</div>
    <div class="kg-dunkel-antworten">${data.antworten.map(a => `<button type="button" class="kg-dunkel-antwort" data-id="${kgEscape(a.id)}">${kgEscape(a.label)}</button>`).join('')}</div>
    ${kgDunkelErgaenzungHtml('Optional: noch etwas ergänzen …')}`;
  const ergaenzungFeld = popup.querySelector('.kg-dunkel-ergaenzung');
  kgAutoWachsen(ergaenzungFeld);
  kgAktiviereMikrofon(popup.querySelector('.kg-dunkel-micbtn'), ergaenzungFeld);
  popup.querySelectorAll('.kg-dunkel-antwort').forEach(btn => {
    btn.addEventListener('click', () => {
      const gewaehlt = data.antworten.find(a => a.id === btn.dataset.id);
      kgKaGeneriereUndZeige(popup, scroll, bodyEl, zustand, ergaenzungFeld, { vorlageId: btn.dataset.id }, gewaehlt?.zusatzfenster);
    });
  });
}

function kgZeigeKundenanfrageImPopup(popup, data, scroll, bodyEl, zustand) {
  const zeigeInfo = !!(data.distanz || data.hinweistext || data.kundenStandort);
  const partnerListe = data.distanz?.partner || [];
  // Von den Partnerbetrieben nur der naechstgelegene wird gruen hervorgehoben
  // (Entscheidungshilfe: "der hier waere am naechsten") - die anderen bleiben
  // in der neutralen Textfarbe. Liegt KEINER innerhalb der admin-konfigurierten
  // "in der Naehe"-Schwelle, wird gar keiner hervorgehoben (Backend
  // entscheidet das schon, siehe distanz.naechsterPartnerId - kein
  // separates Minuten-Minimum mehr im Frontend, damit die Schwelle nicht
  // doppelt gepflegt werden muss). Der eigene Standort (Knechtgarten) ist
  // davon unabhaengig immer gruen.
  const naechsterPartnerId = data.distanz?.naechsterPartnerId || null;
  const partnerZeileHtml = p => {
    const istNaeher = p.id === naechsterPartnerId;
    const weiterleitenBtn = p.weiterleitungText
      ? `<button type="button" class="kg-ka-weiterleiten-btn${istNaeher ? ' kg-ka-info-naeher' : ''}" data-partner-id="${kgEscape(p.id)}" title="Antwort mit Weiterleitungstext von ${kgEscape(p.name)} erstellen">Weiterleiten</button>`
      : '<span></span>';
    return `<span class="kg-ka-info-name">${kgEscape(p.name)}</span><span class="kg-ka-info-wert${istNaeher ? ' kg-ka-info-naeher' : ''}">${p.km} km · ${p.minuten} Min</span>${weiterleitenBtn}`;
  };
  const infoHtml = zeigeInfo ? `
    <div class="kg-ka-info">
      <div class="kg-ka-info-label">Distanz</div>
      ${data.kundenStandort ? `<div class="kg-ka-info-standort">${kgEscape(data.kundenStandort)}</div>` : ''}
      <div class="kg-ka-info-tabelle">
        ${data.distanz?.eigene ? `<span class="kg-ka-info-name kg-ka-info-eigene-name">Knechtgarten</span><span class="kg-ka-info-wert kg-ka-info-eigene-wert">${data.distanz.eigene.km} km · ${data.distanz.eigene.minuten} Min</span>${data.eigeneAbsageText ? '<button type="button" class="kg-ka-weiterleiten-btn kg-ka-info-naeher kg-ka-absagen-btn" title="Absage wegen zu grosser Distanz erstellen">Absagen</button>' : '<span></span>'}` : ''}
        ${data.distanz?.eigene && partnerListe.length ? '<span class="kg-ka-info-trenner"></span>' : ''}
        ${data.distanzErklaerung ? `<div class="kg-ka-info-erklaerung">${kgMarkdownZuHtml(data.distanzErklaerung)}</div>` : ''}
        ${partnerListe.map(partnerZeileHtml).join('')}
      </div>
      ${data.hinweistext ? `<div class="kg-ka-info-hinweis">${kgMarkdownZuHtml(data.hinweistext)}</div>` : ''}
    </div>` : '';
  const buttonsHtml = `<div class="kg-ka-buttons">${data.antworten.map(a => `<button type="button" class="kg-ka-btn" data-id="${kgEscape(a.id)}">${kgEscape(a.label)}</button>`).join('')}</div>`;

  popup.innerHTML = `
    <div class="kg-dunkel-frage">${kgEscape(data.frage || data.titel || 'Kundenanfrage')}</div>
    ${zeigeInfo ? `<div class="kg-ka-layout">${buttonsHtml}${infoHtml}</div>` : buttonsHtml}
    ${kgDunkelErgaenzungHtml('Optional: noch etwas ergänzen …')}`;
  const ergaenzungFeld = popup.querySelector('.kg-dunkel-ergaenzung');
  kgAutoWachsen(ergaenzungFeld);
  kgAktiviereMikrofon(popup.querySelector('.kg-dunkel-micbtn'), ergaenzungFeld);
  popup.querySelectorAll('.kg-ka-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const antwortInfo = data.antworten.find(a => a.id === btn.dataset.id);
      kgKaGeneriereUndZeige(popup, scroll, bodyEl, zustand, ergaenzungFeld, { vorlageId: btn.dataset.id }, antwortInfo?.zusatzfenster);
    });
  });
  popup.querySelectorAll('.kg-ka-weiterleiten-btn:not(.kg-ka-absagen-btn)').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      kgKaGeneriereUndZeige(popup, scroll, bodyEl, zustand, ergaenzungFeld, { partnerbetriebId: btn.dataset.partnerId }, undefined);
    });
  });
  popup.querySelector('.kg-ka-absagen-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    kgKaGeneriereUndZeige(popup, scroll, bodyEl, zustand, ergaenzungFeld, { eigeneAbsage: true, astId: data.astId }, undefined);
  });
}

// Klassifizierung liefert bei Fall 1 nur noch die Einordnung (vorlageId oder
// null fuer Auffangfall), noch KEINEN Text - der wird erst hier erzeugt,
// gestreamt ueber kgKaGeneriereUndZeige (gleicher Mechanismus wie bei Zweig-/
// Kundenanfrage-Antworten), damit der Text ueberall Wort fuer Wort erscheint
// statt dass man auf den kompletten Block warten muss.
function kgZeigeErgaenzungImPopup(popup, data, scroll, bodyEl, zustand) {
  popup.innerHTML = `
    <div class="kg-dunkel-text">Möchtest du noch etwas ergänzen?</div>
    ${kgDunkelErgaenzungHtml('Optional … (Enter für weiter)')}
    <button type="button" class="kg-dunkel-weiter">Weiter</button>`;
  const ergaenzungFeld = popup.querySelector('.kg-dunkel-ergaenzung');
  kgAutoWachsen(ergaenzungFeld);
  kgAktiviereMikrofon(popup.querySelector('.kg-dunkel-micbtn'), ergaenzungFeld);
  ergaenzungFeld.focus();

  const weiter = () => {
    const payloadZusatz = data.vorlageId ? { vorlageId: data.vorlageId } : { auffangfall: true };
    kgKaGeneriereUndZeige(popup, scroll, bodyEl, zustand, ergaenzungFeld, payloadZusatz, data.zusatzfenster);
  };
  popup.querySelector('.kg-dunkel-weiter').addEventListener('click', weiter);
  ergaenzungFeld.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); weiter(); } });
}

// Wechselt vom dunklen Popup ins normale (helle) Mail-Fenster mit dem
// fertigen Entwurf - ab hier wie gewohnt (Nachbessern, Anrede, usw.).
function kgZeigeAntwortenErgebnis(scroll, bodyEl, zustand, data) {
  scroll.innerHTML = '<div class="kg-chat-bereich"></div>';
  const chatBereich = scroll.querySelector('.kg-chat-bereich');
  zustand.aktuellerEntwurf = data.text;
  zustand.aktuelleVorlageId = data.vorlageId || zustand.aktuelleVorlageId || null;
  if (data.zusatzfenster?.length) {
    // Die passende Vorlage hat z.B. einen Kalender-Baustein oder ein
    // Eingabe-Popup zugewiesen - erst die strukturierte Eingabe zeigen, die
    // den/die Platzhalter im schon generierten Entwurf ersetzt.
    const eingabeListe = data.zusatzfenster.filter(zf => zf.typ === 'eingabe');
    const andereListe = data.zusatzfenster.filter(zf => zf.typ !== 'eingabe');
    const opts = { vorlageId: data.vorlageId };
    if (eingabeListe.length) {
      kgZeigeEingabePopup(eingabeListe, andereListe, data.text, chatBereich, bodyEl, zustand, opts);
    } else {
      kgZeigeZusatzfenster(andereListe, data.text, chatBereich, bodyEl, zustand, opts);
    }
  } else {
    kgZeigeEntwurf(chatBereich, bodyEl, zustand);
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

// ----------------------------------------------------------------------------
// Platzhalter im fertigen Entwurf klickbar machen - egal ob aus einer Vorlage
// oder frei von der KI erfunden. Zwei Formen (siehe Backend-Prompt):
//   [Name]     - noch leer/unausgefuellt, Button zeigt den Platzhalter-Namen
//   [[Wert]]   - die KI hat selbst einen Wert eingesetzt, Button zeigt den
//                Wert direkt (ohne Klammern) und bleibt trotzdem klickbar/
//                aenderbar, damit sichtbar bleibt, wo die KI etwas ergaenzt
//                hat.
// [ZF:...] wird bewusst NICHT erfasst (eigener, komplexerer Zusatzfenster-
// Mechanismus). Enthaelt ein noch leerer Platzhalter das Wort "Datum",
// oeffnet der Klick das spezielle Datums-/Kalender-Popover, sonst ein
// einfaches Popover mit einem einzelnen Textfeld.
// ----------------------------------------------------------------------------
const KG_PLATZHALTER_REGEX = /\[\[([^[\]<>]+)\]\]|\[(?!ZF:)([^[\]<>]+)\]/g;

function kgVerlinkePlatzhalter(html) {
  let i = 0;
  return html.replace(KG_PLATZHALTER_REGEX, (match, gefuellt, leer) => {
    const slot = i++;
    if (gefuellt !== undefined) {
      return `<span class="kg-platzhalter-btn" data-slot="${slot}" data-art="gefuellt">${gefuellt}</span>`;
    }
    const art = /datum/i.test(leer) ? 'datum' : 'leer';
    return `<span class="kg-platzhalter-btn" data-slot="${slot}" data-art="${art}">${match}</span>`;
  });
}
// Position des n-ten Platzhalters im ROHEN Text (nicht im HTML) - Reihenfolge
// ist identisch, da kgEscape keine Klammern veraendert und daher weder
// Anzahl noch Reihenfolge der Treffer verschiebt.
function kgPlatzhalterPosition(text, slot) {
  const regex = new RegExp(KG_PLATZHALTER_REGEX.source, 'g');
  let match, i = 0;
  while ((match = regex.exec(text))) {
    if (i === slot) return { start: match.index, end: match.index + match[0].length };
    i++;
  }
  return null;
}
function kgFormatiereDatum(datumStr) {
  const [jahr, monat, tag] = datumStr.split('-').map(Number);
  const d = new Date(jahr, monat - 1, tag);
  const wochentage = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const monate = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  return `${wochentage[d.getDay()]}, ${d.getDate()}. ${monate[d.getMonth()]} ${d.getFullYear()}`;
}

function kgOeffneDatumPopover(span, dieserText, chatBereich, bodyEl, zustand) {
  document.querySelectorAll('.kg-datum-popover').forEach(p => p.remove());
  const slot = parseInt(span.dataset.slot, 10);
  const popover = document.createElement('div');
  popover.className = 'kg-datum-popover';
  popover.innerHTML = `
    <div class="kg-datum-popover-optionen">
      <button type="button" class="kg-datum-opt" data-opt="einzeln">Ein Datum eintragen</button>
      <button type="button" class="kg-datum-opt" data-opt="kalender">Termin(e) aus Kalender vorschlagen</button>
    </div>`;
  document.body.appendChild(popover);
  const rect = span.getBoundingClientRect();
  popover.style.top = Math.round(rect.bottom + 4) + 'px';
  popover.style.left = Math.round(rect.left) + 'px';

  let kalenderAufraeumen = null;
  const schliessen = () => {
    if (kalenderAufraeumen) kalenderAufraeumen();
    popover.remove();
    document.removeEventListener('mousedown', ausserhalbKlick, true);
  };
  const ausserhalbKlick = (e) => { if (!popover.contains(e.target)) schliessen(); };
  setTimeout(() => document.addEventListener('mousedown', ausserhalbKlick, true), 0);

  // Ergebnis in doppelte eckige Klammern schreiben (nicht als reinen Text) -
  // so bleibt der eingetragene Termin weiterhin ein Button und laesst sich
  // spaeter per Klick nochmals aendern, statt endgueltig fixer Text zu sein.
  const ersetzeImText = (ersatz, label) => {
    const pos = kgPlatzhalterPosition(dieserText, slot);
    schliessen();
    if (!pos) return;
    zustand.aktuellerEntwurf = dieserText.slice(0, pos.start) + `[[${ersatz}]]` + dieserText.slice(pos.end);
    kgZeigeEntwurf(chatBereich, bodyEl, zustand, label);
  };

  popover.querySelector('[data-opt="einzeln"]').addEventListener('click', () => {
    popover.innerHTML = `<input type="date" class="kg-datum-input">`;
    const input = popover.querySelector('.kg-datum-input');
    input.addEventListener('change', () => {
      if (!input.value) return;
      const formatiert = kgFormatiereDatum(input.value);
      ersetzeImText(formatiert, `Datum eingetragen: ${formatiert}`);
    });
    input.focus();
    try { input.showPicker?.(); } catch (e) { /* nicht in jedem Browser vorhanden */ }
  });

  popover.querySelector('[data-opt="kalender"]').addEventListener('click', () => {
    // Hier (anders als beim Zusatzfenster vor dem Erstellen einer Vorlage)
    // ist "Termin(e) vorschlagen" schon die bewusste zweite Wahl im Popup -
    // der Kalender soll darum sofort aufgehen, ohne noch einen Button dafuer
    // anzuzeigen.
    kgKalenderOeffnen();
    popover.innerHTML = `
      <div class="kg-zf-block" data-zf-kalender-index="datum-popover">
        <div class="kg-zf-kalender-liste"></div>
        <div class="kg-zf-kalender-hinweis">Wähle im geöffneten Kalender eine freie Zeit und klicke dort auf „In Mail übernehmen" – der Termin erscheint hier automatisch.</div>
      </div>
      <div class="kg-zf-btns">
        <button type="button" class="kg-zf-abbrechen">Abbrechen</button>
        <button type="button" class="kg-zf-uebernehmen">Übernehmen</button>
      </div>`;
    const block = popover.querySelector('[data-zf-kalender-index="datum-popover"]');
    kgZfKalenderListeRendern(block);
    if (chrome.storage?.onChanged) {
      const listener = (changes, area) => { if (area === 'local' && changes[KG_KALENDER_STORAGE_KEY]) kgZfKalenderListeRendern(block); };
      chrome.storage.onChanged.addListener(listener);
      kalenderAufraeumen = () => chrome.storage.onChanged.removeListener(listener);
    }
    popover.querySelector('.kg-zf-abbrechen').addEventListener('click', schliessen);
    popover.querySelector('.kg-zf-uebernehmen').addEventListener('click', async () => {
      if (!chrome.storage?.local) return;
      let liste;
      try {
        const daten = await chrome.storage.local.get(KG_KALENDER_STORAGE_KEY);
        liste = daten[KG_KALENDER_STORAGE_KEY] || [];
      } catch (e) { return; }
      if (!liste.length) return;
      await chrome.storage.local.set({ [KG_KALENDER_STORAGE_KEY]: [] });
      if (liste.length === 1) {
        ersetzeImText(liste[0].anzeige, `Termin eingetragen: ${liste[0].anzeige}`);
        return;
      }
      // Mehrere Termine: erst grob als Liste einsetzen, dann den umliegenden
      // Satz per eng eingegrenzter Nachbessern-Anweisung sprachlich passend
      // machen lassen - der Rest des Texts darf sich dabei nicht aendern.
      const pos = kgPlatzhalterPosition(dieserText, slot);
      schliessen();
      if (!pos) return;
      const platzhalterText = dieserText.slice(pos.start, pos.end);
      const terminListe = liste.map(e => `- ${e.anzeige}`).join('\n');
      const zwischenText = dieserText.slice(0, pos.start) + terminListe + dieserText.slice(pos.end);
      const anweisung = `An der Stelle, wo vorher "${platzhalterText}" stand, steht jetzt eine Liste mit ${liste.length} vorgeschlagenen Terminen. Passe NUR den Satz direkt rund um diese Stelle sprachlich an, damit er zu mehreren Terminen passt (z.B. "an einem der folgenden Termine" statt einem einzelnen Datum). Der Rest des Mailtexts muss exakt gleich bleiben, nichts sonst umformulieren.`;
      kgGeneriere({ modus: 'nachbessern', aktuellerEntwurf: zwischenText, anweisung, vorlageId: zustand.aktuelleVorlageId }, chatBereich, bodyEl, zustand, `${liste.length} Termine vorgeschlagen`);
    });
  });
}

// Einfaches Popover fuer alle Platzhalter ausser Datum: ein Textfeld, Wert
// eintragen, ersetzt den Platzhalter direkt (in doppelten Klammern, bleibt
// also weiterhin klickbar/aenderbar). aktuellerWert ist vorbefuellt, falls
// die KI hier schon selbst etwas eingesetzt hatte.
function kgOeffneEinfachesPlatzhalterPopover(span, dieserText, chatBereich, bodyEl, zustand, aktuellerWert) {
  document.querySelectorAll('.kg-datum-popover').forEach(p => p.remove());
  const slot = parseInt(span.dataset.slot, 10);
  const popover = document.createElement('div');
  popover.className = 'kg-datum-popover';
  popover.innerHTML = `
    <input type="text" class="kg-datum-input" value="${kgEscape(aktuellerWert || '')}" placeholder="Wert eintragen …">
    <button type="button" class="kg-btn" style="margin-top:8px;width:100%;justify-content:center;">Übernehmen</button>`;
  document.body.appendChild(popover);
  const rect = span.getBoundingClientRect();
  popover.style.top = Math.round(rect.bottom + 4) + 'px';
  popover.style.left = Math.round(rect.left) + 'px';

  const schliessen = () => { popover.remove(); document.removeEventListener('mousedown', ausserhalbKlick, true); };
  const ausserhalbKlick = (e) => { if (!popover.contains(e.target)) schliessen(); };
  setTimeout(() => document.addEventListener('mousedown', ausserhalbKlick, true), 0);

  const input = popover.querySelector('.kg-datum-input');
  input.focus();
  input.select();

  const uebernehmen = () => {
    const wert = input.value.trim();
    const pos = kgPlatzhalterPosition(dieserText, slot);
    schliessen();
    if (!pos || !wert) return;
    zustand.aktuellerEntwurf = dieserText.slice(0, pos.start) + `[[${wert}]]` + dieserText.slice(pos.end);
    kgZeigeEntwurf(chatBereich, bodyEl, zustand, `Eingetragen: ${wert}`);
  };
  popover.querySelector('.kg-btn').addEventListener('click', uebernehmen);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); uebernehmen(); } });
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

    // Interne Kollegen-Mail: keine Ton-/Anrede-Buttons (Kuerzer/Foermlicher,
    // Du/Sie) - bei einer knappen "Ist ok, mache ich."-Antwort unnoetiger
    // Ballast. Freies Nachbessern-Feld bleibt als einfacher Korrekturweg.
    chatBereich.insertAdjacentHTML('beforeend', `
      <div class="kg-verlauf"></div>
      ${zustand.istIntern ? '' : '<div class="kg-quickchips kg-quick-nachbessern"></div>'}
      <div class="kg-followuprow">
        ${zustand.istIntern ? '' : `<div class="kg-anrede-chips">${kgAnredeChipsHtml()}</div>`}
        <button class="kg-micbtn" title="Diktieren">${kgSvg(KG_ICON_MIC)}</button>
        <textarea rows="1" placeholder="Nachbessern oder eigene Anweisung…"></textarea>
      </div>`);
    verlauf = chatBereich.querySelector('.kg-verlauf');

    if (!zustand.istIntern) {
      // Anrede-Chips: immer fest vorhanden (unabhaengig von den anpassbaren
      // Nachbessern-Buttons), da Du/Ihr/Sie eine Grundfunktion ist, kein
      // optionales Extra. Sobald ein Entwurf steht (hier immer der Fall),
      // loest ein Klick sofort eine Umformulierung aus.
      kgVerdrahteAnredeChips(chatBereich.querySelector('.kg-followuprow .kg-anrede-chips'), chatBereich, bodyEl, zustand);
      kgAktualisiereAnredeChips(zustand);

      kgLadeNachbesserButtons(chatBereich.querySelector('.kg-quick-nachbessern'), (anweisung) => {
        kgGeneriere({ modus: 'nachbessern', aktuellerEntwurf: zustand.aktuellerEntwurf, anweisung, vorlageId: zustand.aktuelleVorlageId }, chatBereich, bodyEl, zustand, anweisung);
      });
    }

    const input = chatBereich.querySelector('.kg-followuprow textarea');
    kgAutoWachsen(input);
    kgSchuetzeFokus(input);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && input.value.trim()) {
        e.preventDefault();
        const text = input.value.trim();
        kgGeneriere({ modus: 'nachbessern', aktuellerEntwurf: zustand.aktuellerEntwurf, anweisung: text, vorlageId: zustand.aktuelleVorlageId }, chatBereich, bodyEl, zustand, text);
        input.value = '';
        input.dispatchEvent(new Event('input'));
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
  aiDiv.innerHTML = `<div class="kg-bubble">${kgVerlinkePlatzhalter(kgMarkdownZuHtml(dieserText))}</div><button class="kg-diese-version">In Mail übernehmen</button>`;
  verlauf.appendChild(aiDiv);
  // Farbe/Form direkt hier statt nur ueber die externe CSS-Datei setzen -
  // die liess sich in Gmail schon einmal (Dropdown-Menue) nicht zuverlaessig
  // aktualisieren, inline ist das unabhaengig von jeglichem CSS-Cache.
  const uebernehmenBtn = aiDiv.querySelector('.kg-diese-version');
  Object.assign(uebernehmenBtn.style, {
    display: 'inline-block', marginTop: '6px', background: '#D1DB5F', color: '#323E4E',
    border: 'none', borderRadius: '10px', fontSize: '10px', fontWeight: '700',
    textDecoration: 'none', cursor: 'pointer', padding: '3px 9px', fontFamily: 'inherit',
  });
  uebernehmenBtn.addEventListener('mouseenter', () => { uebernehmenBtn.style.background = '#c3d454'; });
  uebernehmenBtn.addEventListener('mouseleave', () => { uebernehmenBtn.style.background = '#D1DB5F'; });
  uebernehmenBtn.addEventListener('click', () => {
    zustand.aktuellerEntwurf = dieserText;
    kgSetzeBetreff(zustand.aktuellerBetreff, bodyEl);
    kgUebernehmeInMail(bodyEl, dieserText);
    kgSchliessePanel(zustand);
  });
  aiDiv.querySelectorAll('.kg-platzhalter-btn').forEach(span => {
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      if (span.dataset.art === 'datum') {
        kgOeffneDatumPopover(span, dieserText, chatBereich, bodyEl, zustand);
      } else {
        const aktuellerWert = span.dataset.art === 'gefuellt' ? span.textContent : '';
        kgOeffneEinfachesPlatzhalterPopover(span, dieserText, chatBereich, bodyEl, zustand, aktuellerWert);
      }
    });
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
      const anweisung = zustand.anrede ? KG_ANREDE_ANWEISUNG[zustand.anrede] : undefined;
      kgGeneriere({ modus: 'rueckfrage-antwort', vorlageId: data.vorlageId, antwortLabel: btn.dataset.label, anweisung }, chatBereich, bodyEl, zustand, btn.dataset.label);
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
// Definierte Position: Dropdown (typ='dropdown'), Zahlenfeld (typ='zahl')
// oder freies Textfeld (typ='text'), wie in der Verwaltung konfiguriert.
// Breite kommt in ungefaehren Zeichen aus der Verwaltung - als CSS
// "ch"-Einheit direkt auf das Feld angewendet (max-width:none, damit die
// allgemeine Tabellen-CSS-Obergrenze eine bewusst breiter gewaehlte Spalte
// nicht wieder einschraenkt).
function kgZfSpalteBreiteStyle(s) {
  return s.breite ? ` style="width:${s.breite}ch;max-width:none;"` : '';
}
function kgZfSpalteFeldHtml(s) {
  const breiteStyle = kgZfSpalteBreiteStyle(s);
  if (s.typ === 'zahl') {
    return `<td><input type="number" class="kg-zf-spalte" data-spalte="${kgEscape(s.titel)}"${breiteStyle}>${s.einheit ? ` <span class="kg-zf-einheit">${kgEscape(s.einheit)}</span>` : ''}</td>`;
  }
  if (s.typ === 'text') {
    return `<td><input type="text" class="kg-zf-spalte" data-spalte="${kgEscape(s.titel)}"${breiteStyle}></td>`;
  }
  const optionen = (s.mailassistent_zusatzfenster_spalte_option || []).slice().sort((a, b) => a.reihenfolge - b.reihenfolge);
  return `<td><select class="kg-zf-spalte" data-spalte="${kgEscape(s.titel)}"${breiteStyle}>
    <option value=""></option>
    ${optionen.map(o => `<option value="${kgEscape(o.wert)}">${kgEscape(o.wert)}</option>`).join('')}
  </select></td>`;
}
// Eigene Position: exakt dieselben Spalten wie oben, aber immer als leeres
// Freitextfeld statt Dropdown/Zahlenfeld - die vorgegebenen Optionen decken
// eine eigene Position per Definition nicht ab.
function kgZfEigeneZeileHtml(spalten, zeigtAnzahl) {
  return `
    <tr class="kg-zf-zeile kg-zf-eigene-zeile" data-position="">
      ${zeigtAnzahl ? '<td><input type="number" min="0" class="kg-zf-anzahl" value="0"></td>' : ''}
      <td><input type="text" class="kg-zf-eigenname" placeholder="Eigene Position"></td>
      ${spalten.map(s => `<td><input type="text" class="kg-zf-spalte" data-spalte="${kgEscape(s.titel)}" placeholder="frei"${kgZfSpalteBreiteStyle(s)}></td>`).join('')}
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
function kgZfGenerischeZeileHtml(spalten, zeigtAnzahl) {
  return `
    <tr class="kg-zf-zeile kg-zf-generische-zeile">
      ${zeigtAnzahl ? '<td><input type="number" min="0" class="kg-zf-anzahl" value="0"></td>' : ''}
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
  // Manche Tabellen brauchen keine Anzahl (z.B. reine Materialangaben wie
  // Flaeche/Holzart/Laenge ohne Stueckzahl) - per Zusatzfenster abschaltbar.
  const zeigtAnzahl = zf.zeigt_anzahl !== false;
  let kopfHtml, zeilenHtml;
  if (istFix) {
    const zeileHtml = (titel) => `
      <tr class="kg-zf-zeile" data-position="${kgEscape(titel)}">
        ${zeigtAnzahl ? '<td><input type="number" min="0" class="kg-zf-anzahl" value="0"></td>' : ''}
        <td>${kgEscape(titel)}</td>
        ${spalten.map(s => kgZfSpalteFeldHtml(s)).join('')}
      </tr>`;
    kopfHtml = `${zeigtAnzahl ? '<th>Anzahl</th>' : ''}<th>Position</th>${spaltenHtml}`;
    zeilenHtml = positionen.map(p => zeileHtml(p.titel)).join('')
      + (zf.erlaubt_eigene_eingabe ? kgZfEigeneZeileHtml(spalten, zeigtAnzahl) : '');
  } else {
    // Keine Positionen erfasst: immer mindestens eine ausfuellbare Zeile
    // zeigen, sonst waere die Tabelle leer und unbenutzbar.
    kopfHtml = `${zeigtAnzahl ? '<th>Anzahl</th>' : ''}${spaltenHtml}`;
    zeilenHtml = kgZfGenerischeZeileHtml(spalten, zeigtAnzahl);
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
// ----------------------------------------------------------------------------
// Zusatzfenster Typ "kalender": zeigt Termine, die auf calendar.google.com
// per "In Mail übernehmen"-Button gesammelt wurden (siehe calendar.js). Die
// Uebergabe laeuft ueber chrome.storage.local, da Content-Scripts auf
// unterschiedlichen Seiten sich sonst nicht direkt erreichen koennen.
// ----------------------------------------------------------------------------
const KG_KALENDER_STORAGE_KEY = 'kg_kalender_vorschlaege';
function kgZfKalenderBlockHtml(zf, index) {
  return `
    <div class="kg-zf-block" data-zf-kalender-index="${index}">
      <div class="kg-zf-titel">${kgEscape(zf.titel)}</div>
      <div class="kg-zf-kalender-liste"></div>
      <div class="kg-zf-kalender-hinweis">
        <button class="kg-zf-kalender-oeffnen" type="button">Google Kalender öffnen</button>
        Klicke dort auf eine freie Zeit und dann auf „In Mail übernehmen" – die Termine erscheinen hier automatisch. Dein Mail-Entwurf bleibt in diesem Fenster erhalten.
      </div>
    </div>`;
}
function kgKalenderChipHtml(eintrag) {
  return `<span class="kg-kal-chip" data-id="${kgEscape(eintrag.id)}">${kgEscape(eintrag.anzeige)}<span class="kg-kal-chip-del">✕</span></span>`;
}
// Kleines eigenstaendiges Fenster statt neuem Tab - laesst sich einfach
// schliessen/wegklicken, ohne dass man den Gmail-Tab erst wiederfinden muss.
function kgKalenderOeffnen() {
  // Direkt beim Gmail-Fenster platzieren (gleicher Bildschirm bei mehreren
  // Monitoren/geteiltem Bildschirm) - ohne left/top setzt der Browser sonst
  // eine Standardposition, die z.B. auf dem falschen Monitor landen kann.
  const breite = 900, hoehe = 800;
  const left = Math.round(window.screenX + Math.max(0, (window.outerWidth - breite) / 2));
  const top = Math.round(window.screenY + Math.max(0, (window.outerHeight - hoehe) / 2));
  window.open('https://calendar.google.com/calendar/u/0/r?kgPopup=1', 'kg-kalender', `width=${breite},height=${hoehe},left=${left},top=${top},noopener`);
}
async function kgZfKalenderListeRendern(block) {
  // Falls die "storage"-Berechtigung (noch) nicht wirksam ist (z.B. nach
  // einem Update, das nicht vollstaendig neu geladen wurde), verstaendlich
  // scheitern statt die ganze Seite mit einem Fehler zu blockieren.
  if (!chrome.storage?.local) {
    block.querySelector('.kg-zf-kalender-hinweis').textContent = 'Erweiterung bitte komplett neu laden (chrome://extensions → entfernen → neu laden), dann funktioniert die Kalender-Übernahme.';
    return;
  }
  let daten;
  try {
    daten = await chrome.storage.local.get(KG_KALENDER_STORAGE_KEY);
  } catch (e) {
    // "Extension context invalidated" - passiert, wenn die Erweiterung neu
    // geladen wurde, waehrend dieser Gmail-Tab noch mit der alten Version
    // offen war. Harmlos, verschwindet nach dem Neuladen des Tabs.
    return;
  }
  const liste = daten[KG_KALENDER_STORAGE_KEY] || [];
  block.querySelector('.kg-zf-kalender-liste').innerHTML = liste.map(kgKalenderChipHtml).join('');
  block.querySelector('.kg-zf-kalender-hinweis').style.display = liste.length ? 'none' : '';
  block.querySelectorAll('.kg-kal-chip-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const id = btn.parentElement.dataset.id;
        const d = await chrome.storage.local.get(KG_KALENDER_STORAGE_KEY);
        const neu = (d[KG_KALENDER_STORAGE_KEY] || []).filter(e => e.id !== id);
        await chrome.storage.local.set({ [KG_KALENDER_STORAGE_KEY]: neu });
      } catch (e) { /* Extension context invalidated - harmlos, siehe oben */ }
    });
  });
}
// Wert einer Spalte fuers Zusammenfassen formatieren - bei Zahl-Spalten mit
// hinterlegter Einheit (z.B. "m2", "Meter") wird diese angehaengt, das fehlte
// bisher komplett in der Zusammenfassung (nur im Eingabefeld selbst sichtbar).
function kgZfWertMitEinheit(s, wert) {
  if (!wert) return '';
  const einheit = s.typ === 'zahl' && s.einheit ? ` ${s.einheit}` : '';
  return `${wert}${einheit}`;
}
function kgZfSammleEintraege(tabelle, zf) {
  const spalten = (zf.mailassistent_zusatzfenster_spalte || []).slice().sort((a, b) => a.reihenfolge - b.reihenfolge);
  const zeigtAnzahl = zf.zeigt_anzahl !== false;
  const eintraege = [];
  tabelle.querySelectorAll('.kg-zf-zeile').forEach(zeile => {
    // Ohne Anzahl-Spalte zaehlt jede Zeile mit mindestens einer ausgefuellten
    // Spalte als Eintrag - es gibt kein "0x" mehr, das eine Zeile aussortieren
    // koennte.
    const anzahl = zeigtAnzahl ? (parseInt(zeile.querySelector('.kg-zf-anzahl').value, 10) || 0) : null;
    const praefix = zeigtAnzahl ? `${anzahl}x ` : '';
    // Generische Zeile (keine Positionen definiert, z.B. reine Materialangaben
    // ohne eigenen "Artikelnamen"): OHNE Anzahl werden alle Spalten gleich-
    // wertig als "Titel: Wert" aneinandergereiht. MIT Anzahl uebernimmt die
    // erste Spalte (z.B. "Artikel") weiterhin die Rolle des Positionsnamens,
    // der Rest wird in Klammern als Detail angehaengt (kompakter fuer
    // "3x Deckenlampe (Farbe: Weiss)"-artige Faelle).
    if (zeile.classList.contains('kg-zf-generische-zeile')) {
      if (!spalten.length) return;
      const werte = spalten.map(s => {
        const feld = zeile.querySelector(`.kg-zf-spalte[data-spalte="${CSS.escape(s.titel)}"]`);
        return feld ? feld.value.trim() : '';
      });
      if (!zeigtAnzahl) {
        const teile = spalten.map((s, i) => werte[i] ? `${s.titel}: ${kgZfWertMitEinheit(s, werte[i])}` : null).filter(Boolean);
        if (!teile.length) return;
        eintraege.push(`- ${teile.join(' · ')}`);
        return;
      }
      const positionsname = werte[0];
      if (!positionsname || anzahl <= 0) return;
      const positionseinheit = spalten[0].typ === 'zahl' && spalten[0].einheit ? ` ${spalten[0].einheit}` : '';
      const details = spalten.slice(1)
        .map((s, i) => werte[i + 1] ? `${s.titel}: ${kgZfWertMitEinheit(s, werte[i + 1])}` : null)
        .filter(Boolean)
        .join(', ');
      eintraege.push(`- ${praefix}${positionsname}${positionseinheit}${details ? ' (' + details + ')' : ''}`);
      return;
    }
    const eigennameEl = zeile.querySelector('.kg-zf-eigenname');
    const positionsname = eigennameEl ? eigennameEl.value.trim() : zeile.dataset.position;
    if (!positionsname || (zeigtAnzahl && anzahl <= 0)) return;
    const details = spalten
      .map(s => {
        const feld = zeile.querySelector(`.kg-zf-spalte[data-spalte="${CSS.escape(s.titel)}"]`);
        const wert = feld ? feld.value.trim() : '';
        return wert ? `${s.titel}: ${kgZfWertMitEinheit(s, wert)}` : null;
      })
      .filter(Boolean)
      .join(', ');
    eintraege.push(`- ${praefix}${positionsname}${details ? ' (' + details + ')' : ''}`);
  });
  return eintraege;
}
// Zusatzfenster vom Typ "eingabe": kleines dunkles Popup mit frei
// definierten Textfeldern (z.B. "Objekt") - erscheint vor dem Erstellen.
// Anders als bei Tabelle/Kalender hat hier JEDES Feld seinen EIGENEN
// Platzhalter, der sowohl im Mailtext als auch im Betreff ersetzt wird.
// andereListe sind weitere (nicht-"eingabe") Zusatzfenster derselben Vorlage -
// die erscheinen danach ganz normal ueber kgZeigeZusatzfenster.
function kgZeigeEingabePopup(eingabeListe, andereListe, basisText, chatBereich, bodyEl, zustand, opts = {}) {
  const felder = eingabeListe.flatMap(zf => (zf.mailassistent_zusatzfenster_spalte || []).slice().sort((a, b) => a.reihenfolge - b.reihenfolge));

  // Schwebend (eigenes Overlay auf document.body statt im Panel-Ablauf
  // eingebettet) - macht sofort klar: hier geht es zuerst nicht weiter, bis
  // das ausgefuellt ist. Kein Klick-Aussen-schliesst, dafuer ein eigener
  // Abbrechen-Button als Notausgang.
  document.querySelectorAll('.kg-eingabe-overlay').forEach(el => el.remove());
  const overlay = document.createElement('div');
  overlay.className = 'kg-eingabe-overlay';
  overlay.innerHTML = `
    <div class="kg-dunkel-popup">
      ${felder.map(f => `
        <div class="kg-dunkel-feld">
          <div class="kg-dunkel-feld-label">${kgEscape(f.titel)}</div>
          <input type="text" class="kg-dunkel-ergaenzung kg-zf-eingabe-input" data-platzhalter="${kgEscape(f.platzhalter)}" placeholder="${kgEscape(f.titel)} eintragen …">
        </div>`).join('')}
      <div class="kg-dunkel-popup-btns">
        <button type="button" class="kg-zf-eingabe-abbrechen">Abbrechen</button>
        <button type="button" class="kg-dunkel-weiter kg-zf-eingabe-weiter">Weiter</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Ungefaehr an der Stelle platzieren, wo das Panel selbst sitzt - nicht
  // irgendwo zufaellig auf dem Bildschirm.
  const panelRect = chatBereich.closest('.kg-panel')?.getBoundingClientRect();
  if (panelRect) {
    overlay.style.top = Math.max(8, Math.round(panelRect.top + 8)) + 'px';
    overlay.style.left = Math.round(panelRect.left + panelRect.width / 2) + 'px';
  }

  overlay.querySelector('.kg-zf-eingabe-input')?.focus();
  overlay.querySelector('.kg-zf-eingabe-abbrechen').addEventListener('click', () => overlay.remove());

  overlay.querySelector('.kg-zf-eingabe-weiter').addEventListener('click', () => {
    let text = basisText || '';
    let betreff = opts.betreff || '';
    overlay.querySelectorAll('.kg-zf-eingabe-input').forEach(input => {
      const platzhalter = input.dataset.platzhalter;
      const wert = input.value.trim();
      if (!wert) return;
      text = text.replaceAll(platzhalter, wert);
      betreff = betreff.replaceAll(platzhalter, wert);
    });
    overlay.remove();
    if (andereListe.length) {
      kgZeigeZusatzfenster(andereListe, text, chatBereich, bodyEl, zustand, { ...opts, betreff });
    } else {
      zustand.aktuellerEntwurf = text;
      if (opts.vorlageId) zustand.aktuelleVorlageId = opts.vorlageId;
      if (betreff) zustand.aktuellerBetreff = betreff;
      kgZeigeEntwurf(chatBereich, bodyEl, zustand, opts.titelLabel);
    }
  });
}

// zfListe: alle Zusatzfenster, die dieser Vorlage zugewiesen sind - erscheinen
// gemeinsam untereinander in einem Fenster mit einer gemeinsamen
// "Übernehmen"-Aktion, die jede Tabelle in ihren eigenen Platzhalter einsetzt.
// basisText ist entweder der rohe Vorlagentext (Verfassen, ohne KI-Aufruf)
// oder ein bereits von der KI generierter Entwurf (Antworten) - in beiden
// Faellen werden die Platzhalter der Zusatzfenster direkt im Text ersetzt.
// opts.vorlageId/betreff/titelLabel sind optional (bei Antworten oft nicht
// bekannt, da die KI die Vorlage frei anwendet statt sie 1:1 zu uebernehmen).
function kgZeigeZusatzfenster(zfListe, basisText, chatBereich, bodyEl, zustand, opts = {}) {
  chatBereich.innerHTML = `
    <div class="kg-zusatzfenster">
      ${zfListe.map((zf, i) => zf.typ === 'kalender' ? kgZfKalenderBlockHtml(zf, i) : kgZfTabelleHtml(zf, i)).join('')}
      <div class="kg-zf-btns">
        <button class="kg-zf-abbrechen" type="button">Abbrechen</button>
        <button class="kg-zf-uebernehmen" type="button">Übernehmen &amp; Entwurf erstellen</button>
      </div>
    </div>`;
  const container = chatBereich.querySelector('.kg-zusatzfenster');
  const kalenderAufraeumen = [];

  zfListe.forEach((zf, i) => {
    if (zf.typ === 'kalender') {
      const block = container.querySelector(`[data-zf-kalender-index="${i}"]`);
      block.querySelector('.kg-zf-kalender-oeffnen').addEventListener('click', kgKalenderOeffnen);
      kgZfKalenderListeRendern(block);
      if (chrome.storage?.onChanged) {
        const listener = (changes, area) => {
          if (area === 'local' && changes[KG_KALENDER_STORAGE_KEY]) kgZfKalenderListeRendern(block);
        };
        chrome.storage.onChanged.addListener(listener);
        kalenderAufraeumen.push(() => chrome.storage.onChanged.removeListener(listener));
      }
      return;
    }
    const tbody = container.querySelector(`table[data-zf-index="${i}"] tbody`);
    const spalten = (zf.mailassistent_zusatzfenster_spalte || []).slice().sort((a, b) => a.reihenfolge - b.reihenfolge);
    const istFix = zf.typ === 'tabelle_fix';
    const zeigtAnzahl = zf.zeigt_anzahl !== false;

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
        if (hatInhalt) tbody.appendChild(kgZfZeileAusHtml(kgZfGenerischeZeileHtml(spalten, zeigtAnzahl)));
      });
    } else if (zf.erlaubt_eigene_eingabe) {
      tbody.addEventListener('input', (e) => {
        const zeile = e.target.closest('.kg-zf-eigene-zeile');
        if (!zeile) return;
        const eigeneZeilen = tbody.querySelectorAll('.kg-zf-eigene-zeile');
        if (zeile !== eigeneZeilen[eigeneZeilen.length - 1]) return;
        const hatInhalt = Array.from(zeile.querySelectorAll('input')).some(f => f.value.trim());
        if (hatInhalt) tbody.appendChild(kgZfZeileAusHtml(kgZfEigeneZeileHtml(spalten, zeigtAnzahl)));
      });
    }
  });

  container.querySelector('.kg-zf-abbrechen').addEventListener('click', () => {
    kalenderAufraeumen.forEach(fn => fn());
    chatBereich.innerHTML = '';
  });
  container.querySelector('.kg-zf-uebernehmen').addEventListener('click', async () => {
    let text = basisText || '';
    let betreff = opts.betreff || '';
    let irgendwasAusgefuellt = false;
    for (let i = 0; i < zfListe.length; i++) {
      const zf = zfListe[i];
      if (zf.typ === 'kalender') {
        if (!chrome.storage?.local) continue;
        try {
          const daten = await chrome.storage.local.get(KG_KALENDER_STORAGE_KEY);
          const liste = daten[KG_KALENDER_STORAGE_KEY] || [];
          if (!liste.length) continue;
          irgendwasAusgefuellt = true;
          // Untereinander als Liste statt in einer Zeile mit "oder" - Kunde
          // soll die Optionen klar getrennt sehen.
          const terminText = liste.length === 1 ? liste[0].anzeige : liste.map(e => `- ${e.anzeige}`).join('\n');
          text = text.includes(zf.platzhalter) ? text.replace(zf.platzhalter, terminText) : `${text}\n\n${terminText}`;
          betreff = betreff.replaceAll(zf.platzhalter, terminText);
          await chrome.storage.local.set({ [KG_KALENDER_STORAGE_KEY]: [] });
        } catch (e) { /* Extension context invalidated - harmlos, siehe oben */ }
        continue;
      }
      const tabelle = container.querySelector(`table[data-zf-index="${i}"]`);
      const eintraege = kgZfSammleEintraege(tabelle, zf);
      if (!eintraege.length) continue;
      irgendwasAusgefuellt = true;
      const liste = eintraege.join('\n');
      text = text.includes(zf.platzhalter) ? text.replace(zf.platzhalter, liste) : `${text}\n\n${liste}`;
      betreff = betreff.replaceAll(zf.platzhalter, liste);
    }
    if (!irgendwasAusgefuellt) {
      if (!container.querySelector('.kg-zf-hinweis')) {
        const hinweis = document.createElement('div');
        hinweis.className = 'kg-zf-hinweis';
        hinweis.textContent = 'Bitte mindestens eine Position mit Anzahl grösser 0 ausfüllen oder einen Termin aus dem Kalender übernehmen.';
        container.insertBefore(hinweis, container.querySelector('.kg-zf-btns'));
      }
      return;
    }
    kalenderAufraeumen.forEach(fn => fn());
    zustand.aktuellerEntwurf = text;
    if (opts.vorlageId) zustand.aktuelleVorlageId = opts.vorlageId;
    if (betreff) zustand.aktuellerBetreff = betreff;
    chatBereich.innerHTML = '';
    kgZeigeEntwurf(chatBereich, bodyEl, zustand, opts.titelLabel);
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
// die Aenderung nicht. kgFindeSubjectbox uebernimmt die Zuordnung zum
// richtigen Fenster (siehe dort) - bei mehreren gleichzeitig offenen
// Compose-Fenstern landet das Betreff sonst im falschen Fenster oder gar
// nicht (genau dieser Bug wurde mehrfach gemeldet).
function kgSetzeBetreff(betreff, bodyEl) {
  if (!betreff) return;
  const feld = kgFindeSubjectbox(bodyEl);
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
// Textarea waechst mit dem Text mit (bis zu einer Obergrenze, danach eigener
// Scrollbalken) - sonst wird laengerer/diktierter Text im kleinen Einzeiler
// abgeschnitten. Reagiert auch auf programmatisch gesetzten Text (z.B. vom
// Mikrofon), weil kgAktiviereMikrofon nach jedem Ergebnis ein "input"-Event
// ausloest.
// ----------------------------------------------------------------------------
function kgAutoWachsen(textarea) {
  const anpassen = () => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  };
  textarea.addEventListener('input', anpassen);
  anpassen();
}

// ----------------------------------------------------------------------------
// Mikrofon (Web Speech API) - diktiert direkt ins uebergebene Feld.
// ----------------------------------------------------------------------------
function kgAktiviereMikrofon(button, feld) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { button.style.display = 'none'; return; }
  const erkennung = new SpeechRecognition();
  erkennung.lang = 'de-CH';
  // Ohne "continuous" schaltet Chrome das Mikrofon automatisch aus, sobald
  // nach dem ersten Satz eine kurze Sprechpause erkannt wird (Standard: nur
  // ein einzelner Satz pro Aufnahme). Mit continuous=true laeuft es weiter,
  // bis man selber auf Stopp klickt (oder laenger gar nichts gesagt wird).
  erkennung.continuous = true;
  // interimResults=true zeigt Woerter sofort waehrend des Sprechens an (auch
  // wenn Chrome sie spaeter beim Satzende noch leicht korrigiert), statt erst
  // auf den fertigen, "endgueltigen" Satz zu warten - das war der Grund fuer
  // die spuerbare Verzoegerung von mehreren Sekunden/Woertern.
  erkennung.interimResults = true;
  let laeuft = false;
  let textVorAufnahme = '';
  button.addEventListener('click', () => { laeuft ? erkennung.stop() : erkennung.start(); });
  erkennung.addEventListener('start', () => {
    laeuft = true;
    button.classList.add('kg-recording');
    textVorAufnahme = feld.value;
  });
  erkennung.addEventListener('end', () => { laeuft = false; button.classList.remove('kg-recording'); });
  erkennung.addEventListener('error', () => { laeuft = false; button.classList.remove('kg-recording'); });
  erkennung.addEventListener('result', (e) => {
    // e.results enthaelt die ganze Aufnahme seit dem Start - endgueltige und
    // noch schwebende ("interim") Teile werden bei jedem Event neu aus allen
    // bisherigen Ergebnissen zusammengesetzt, damit sich nichts verdoppelt
    // und ein noch schwebender Teil beim naechsten Event einfach ersetzt wird.
    let endgueltig = '';
    let schwebend = '';
    for (let i = 0; i < e.results.length; i++) {
      const stueck = e.results[i][0].transcript;
      if (e.results[i].isFinal) endgueltig += (endgueltig ? ' ' : '') + stueck;
      else schwebend += (schwebend ? ' ' : '') + stueck;
    }
    const basis = textVorAufnahme ? textVorAufnahme + ' ' : '';
    feld.value = basis + [endgueltig, schwebend].filter(Boolean).join(' ');
    feld.dispatchEvent(new Event('input'));
  });
}
