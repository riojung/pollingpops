import type { SessionSummaryMessages } from "./en-CA";

const messages: SessionSummaryMessages = {
  "summary.open": "Condividi riepilogo",
  "summary.title": "Riepilogo della sessione",
  "summary.close": "Chiudi",
  "summary.description":
    "Visualizza il riepilogo aggregato, scaricalo o crea un link temporaneo per condividerlo.",
  "summary.loading": "Caricamento del riepilogo…",
  "summary.failed": "Impossibile aggiornare il riepilogo. Aggiorna e riprova.",
  "summary.unavailable":
    "Questo riepilogo non è disponibile. Chiedi all’organizzatore un link valido.",
  "summary.downloads": "Scarica riepilogo",
  "summary.download.pdf": "Scarica PDF",
  "summary.download.png": "Scarica immagine",
  "summary.download.xlsx": "Scarica foglio di calcolo",
  "summary.downloadsUnavailable": "I download non sono disponibili per questo riepilogo.",
  "summary.downloadFailed":
    "Download non completato. Riprova o chiedi all’organizzatore un link valido.",
  "summary.downloaded": "Riepilogo scaricato.",
  "summary.imageContent": "Contenuto dell’immagine",
  "summary.wholeSummary": "Riepilogo completo",
  "summary.create": "Crea link di condivisione",
  "summary.expiryDays": "Durata del link in giorni (1–30)",
  "summary.allowDownloads": "Consenti ai destinatari di scaricare il riepilogo",
  "summary.bearerNotice":
    "Chiunque abbia il link può leggere il riepilogo aggregato fino alla scadenza o alla revoca. Le copie scaricate non possono essere revocate.",
  "summary.nextSteps": "Prossimi passi",
  "summary.nextStepsHint":
    "Note facoltative dell’organizzatore (2000 caratteri). Saranno condivise; ometti nomi e informazioni personali.",
  "summary.expires": "Scade il {date}",
  "summary.retention":
    "I link non possono superare la scadenza di conservazione della sessione: {date}.",
  "summary.working": "Elaborazione…",
  "summary.created": "Link di condivisione creato.",
  "summary.replayed":
    "Questa condivisione è già stata accettata. Il link originale non è più disponibile. Controlla i link esistenti prima di crearne un altro.",
  "summary.uncertain":
    "La richiesta non è stata confermata. L’elenco è stato aggiornato; riprovare con gli stessi dati usa la stessa richiesta.",
  "summary.saveLink":
    "Salva questo link ora. Il suo segreto non viene conservato e questo link esatto non sarà mostrato di nuovo.",
  "summary.link": "Link di condivisione",
  "summary.copy": "Copia link",
  "summary.copied": "Link copiato.",
  "summary.copyFailed": "Copia bloccata. Seleziona e copia il link manualmente.",
  "summary.links": "Link esistenti",
  "summary.noLinks": "Non è stato creato alcun link.",
  "summary.refresh": "Aggiorna link",
  "summary.linkCreated": "Creato il {date}",
  "summary.linkActive": "Attivo",
  "summary.linkExpired": "Scaduto",
  "summary.linkRevoked": "Revocato",
  "summary.revoke": "Revoca link",
  "summary.revoked": "Link revocato.",
  "summary.reason.feature_disabled":
    "La creazione di link è sospesa. I link esistenti possono ancora essere gestiti.",
  "summary.reason.role":
    "Il tuo ruolo consente di vedere i riepiloghi, ma non di creare o revocare link.",
  "summary.reason.exports_entitlement":
    "Esportazioni e condivisione non erano incluse per questa sessione.",
  "summary.participants": "Partecipanti",
  "summary.responses": "Risposte",
  "summary.questions": "Punti di controllo",
  "summary.results": "Risultati per domanda",
  "summary.questionRegion": "Risultati della domanda {number}: {prompt}",
  "summary.response": "Risposta",
  "summary.value": "Valore",
  "summary.sample": "{count} rispondenti",
  "summary.notAssessed": "Diapositiva di contenuto · Non valutata",
  "summary.notScored": "Opinioni · Senza punteggio",
  "summary.multiSelect":
    "Sono consentite più selezioni. I conteggi indicano i rispondenti per ogni opzione; il totale può superare il numero di rispondenti.",
  "summary.accuracyValue": "Accuratezza: {percent}% ({correct} di {responses} risposte valutate)",
  "summary.initialAccuracy":
    "Accuratezza iniziale: {percent}% ({correct} di {responses} risposte valutate)",
  "summary.recovery": "Evidenze di recupero",
  "summary.recovery.linked": "Verifica collegata",
  "summary.recovery.revote": "Nuova votazione",
  "summary.recoveryValue": "{recovered} di {eligible} coppie idonee sono migliorate ({percent}%)",
  "summary.measure.respondents": "Conteggi dei rispondenti",
  "summary.measure.selections": "Conteggi delle selezioni",
  "summary.measure.weighted_points": "Punti di classifica ponderati",
  "summary.suppression.insufficient_sample":
    "Le evidenze sono nascoste con meno di cinque rispondenti.",
  "summary.suppression.participant_text":
    "Il testo scritto dai partecipanti è escluso dai riepiloghi condivisi.",
  "summary.suppression.unavailable": "Questa evidenza non è disponibile.",
  "summary.note.aggregate_only":
    "Solo risultati aggregati. Nomi, risultati individuali e contributi grezzi sono esclusi.",
  "summary.note.insufficient_sample": "Le evidenze di campioni inferiori a cinque sono nascoste.",
  "summary.note.participant_text_excluded":
    "I testi dei partecipanti e i termini delle nuvole di parole sono esclusi.",
  "summary.note.paired_evidence":
    "Il recupero conta i risultati appaiati delle verifiche, non persone uniche o un effetto causale dimostrato.",
  "summary.note.no_scored_evidence":
    "Non sono disponibili evidenze di apprendimento con punteggio; le opinioni non misurano la correttezza.",
};

export default messages;
