// ============================================================================
// Knechtgarten Mail-Assistent - Content-Script fuer Google Kalender.
//
// Beobachtet Googles eigenes "Schnell-Termin erstellen"-Popup (erscheint
// beim Klick auf eine freie Zeit) und fuegt einen zusaetzlichen Button ein.
// Klick darauf: Termin ganz normal speichern (simuliert Googles eigenen
// "Speichern"-Klick) UND Datum/Zeit an ein offenes Gmail-Fenster uebergeben
// (per chrome.storage.local als gemeinsamer, geteilter Ablage-Ort - Content-
// Scripts auf verschiedenen Tabs/Seiten koennen sich sonst nicht direkt
// erreichen).
//
// Kein Google-Login/OAuth noetig - nutzt einfach die ohnehin eingeloggte
// Kalender-Seite direkt, wie beim Gmail-Content-Script auch.
//
// Wichtiger Hinweis: Googles interne Kalender-Struktur ist nicht offiziell
// dokumentiert und kann sich mit Updates aendern - hier wird bewusst ueber
// sichtbaren Text ("Speichern", "Weitere Optionen") gesucht statt ueber
// interne Klassennamen, das ist stabiler, aber sprachabhaengig (Deutsch).
// ============================================================================

const KG_KALENDER_STORAGE_KEY = 'kg_kalender_vorschlaege';

function kgKalFindeDialogMitSpeichern() {
  const dialoge = document.querySelectorAll('div[role="dialog"]');
  for (const dialog of dialoge) {
    if (dialog.dataset.kgDone) continue;
    const buttons = Array.from(dialog.querySelectorAll('button, div[role="button"]'));
    const speichernBtn = buttons.find(b => (b.textContent || '').trim() === 'Speichern');
    const weitereBtn = buttons.find(b => (b.textContent || '').trim().startsWith('Weitere Optionen'));
    if (speichernBtn && weitereBtn) return { dialog, speichernBtn, weitereBtn };
  }
  return null;
}

// Sucht im Dialog nach Wochentag/Datum + Uhrzeit-Bereich, z.B.
// "Freitag, 18. September" und "09:15 – 11:45", unabhaengig von der
// genauen internen Verschachtelung (dafuer per Text-Muster statt Selektor).
function kgKalLiesTermin(dialog) {
  const text = (dialog.textContent || '').replace(/\s+/g, ' ');
  const datumMatch = text.match(/(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag),\s*(\d{1,2})\.\s*(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)/);
  const zeitMatch = text.match(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/);
  if (!datumMatch || !zeitMatch) return null;
  return {
    anzeige: `${datumMatch[1]}, ${datumMatch[2]}. ${datumMatch[3]}, ${zeitMatch[1]} Uhr`,
  };
}

function kgKalVerdrahteDialog({ dialog, speichernBtn, weitereBtn }) {
  dialog.dataset.kgDone = '1';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'In Mail übernehmen';
  button.className = 'kg-kal-uebernehmen-btn';
  Object.assign(button.style, {
    background: '#323E4E', color: '#fff', border: 'none', borderRadius: '16px',
    padding: '8px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
    marginRight: '8px', fontFamily: 'inherit',
  });
  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const termin = kgKalLiesTermin(dialog);
    if (!termin) {
      button.textContent = 'Zeit nicht erkannt';
      setTimeout(() => { button.textContent = 'In Mail übernehmen'; }, 2000);
      return;
    }
    await kgKalTerminHinzufuegen(termin.anzeige);
    button.textContent = '✓ Übernommen';
    // Termin ganz normal speichern - wie ein normaler Google-Klick.
    speichernBtn.click();
  });
  // Direkt vor "Weitere Optionen" einfuegen (gleiche Zeile wie Speichern).
  weitereBtn.parentElement.insertBefore(button, weitereBtn);
}

async function kgKalTerminHinzufuegen(anzeige) {
  const daten = await chrome.storage.local.get(KG_KALENDER_STORAGE_KEY);
  const liste = daten[KG_KALENDER_STORAGE_KEY] || [];
  liste.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), anzeige });
  await chrome.storage.local.set({ [KG_KALENDER_STORAGE_KEY]: liste });
}

console.log('[Mail-Assistent] calendar.js geladen, Beobachter aktiv.');
const kgKalBeobachter = new MutationObserver(() => {
  const gefunden = kgKalFindeDialogMitSpeichern();
  if (gefunden) kgKalVerdrahteDialog(gefunden);
});
kgKalBeobachter.observe(document.body, { childList: true, subtree: true });
