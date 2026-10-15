import type { SessionSummaryMessages } from "./en-CA";

const messages: SessionSummaryMessages = {
  "summary.open": "Zusammenfassung teilen",
  "summary.title": "Sitzungszusammenfassung",
  "summary.close": "Schließen",
  "summary.description":
    "Prüfen Sie die aggregierte Zusammenfassung, laden Sie sie herunter oder erstellen Sie einen befristeten Freigabelink.",
  "summary.loading": "Zusammenfassung wird geladen…",
  "summary.failed":
    "Die Zusammenfassung konnte nicht aktualisiert werden. Aktualisieren Sie die Seite und versuchen Sie es erneut.",
  "summary.unavailable":
    "Diese Zusammenfassung ist nicht verfügbar. Bitten Sie den Veranstalter um einen gültigen Link.",
  "summary.downloads": "Zusammenfassung herunterladen",
  "summary.download.pdf": "PDF herunterladen",
  "summary.download.png": "Bild herunterladen",
  "summary.download.xlsx": "Tabelle herunterladen",
  "summary.downloadsUnavailable": "Für diese Zusammenfassung sind keine Downloads verfügbar.",
  "summary.downloadFailed":
    "Der Download ist fehlgeschlagen. Versuchen Sie es erneut oder bitten Sie den Veranstalter um einen gültigen Link.",
  "summary.downloaded": "Zusammenfassung heruntergeladen.",
  "summary.imageContent": "Bildinhalt",
  "summary.wholeSummary": "Gesamte Zusammenfassung",
  "summary.create": "Freigabelink erstellen",
  "summary.expiryDays": "Gültigkeit in Tagen (1–30)",
  "summary.allowDownloads": "Empfängern den Download der Zusammenfassung erlauben",
  "summary.bearerNotice":
    "Jeder mit diesem Link kann die aggregierte Zusammenfassung bis zum Ablauf oder Widerruf lesen. Heruntergeladene Kopien können nicht widerrufen werden.",
  "summary.nextSteps": "Nächste Schritte",
  "summary.nextStepsHint":
    "Optionale Veranstalternotizen (2.000 Zeichen). Diese werden geteilt; lassen Sie Namen und persönliche Angaben weg.",
  "summary.expires": "Gültig bis {date}",
  "summary.retention":
    "Links können die Aufbewahrungsfrist dieser Sitzung nicht überschreiten: {date}.",
  "summary.working": "Wird verarbeitet…",
  "summary.created": "Freigabelink erstellt.",
  "summary.replayed":
    "Diese Freigabe wurde bereits angenommen. Der ursprüngliche Link ist nicht erneut verfügbar. Prüfen Sie bestehende Links, bevor Sie einen weiteren erstellen.",
  "summary.uncertain":
    "Die Anfrage konnte nicht bestätigt werden. Die Linkliste wurde aktualisiert; ein erneuter Versuch mit unveränderten Angaben verwendet dieselbe Anfrage.",
  "summary.saveLink":
    "Speichern Sie diesen Link jetzt. Sein Geheimnis wird nicht gespeichert und dieser genaue Link wird nicht erneut angezeigt.",
  "summary.link": "Freigabelink",
  "summary.copy": "Link kopieren",
  "summary.copied": "Link kopiert.",
  "summary.copyFailed": "Kopieren wurde blockiert. Markieren und kopieren Sie den Link manuell.",
  "summary.links": "Bestehende Freigabelinks",
  "summary.noLinks": "Es wurden noch keine Freigabelinks erstellt.",
  "summary.refresh": "Links aktualisieren",
  "summary.linkCreated": "Erstellt am {date}",
  "summary.linkActive": "Aktiv",
  "summary.linkExpired": "Abgelaufen",
  "summary.linkRevoked": "Widerrufen",
  "summary.revoke": "Link widerrufen",
  "summary.revoked": "Freigabelink widerrufen.",
  "summary.reason.feature_disabled":
    "Neue Freigaben sind pausiert. Bestehende Links können weiterhin verwaltet werden.",
  "summary.reason.role":
    "Ihre Rolle erlaubt das Anzeigen von Zusammenfassungen, aber nicht das Erstellen oder Widerrufen von Links.",
  "summary.reason.exports_entitlement":
    "Zusammenfassungsexporte und Freigaben waren für diese Sitzung nicht enthalten.",
  "summary.participants": "Teilnehmende",
  "summary.responses": "Antworten",
  "summary.questions": "Prüfpunkte",
  "summary.results": "Fragenergebnisse",
  "summary.questionRegion": "Ergebnisse für Frage {number}: {prompt}",
  "summary.response": "Antwort",
  "summary.value": "Wert",
  "summary.sample": "{count} Antwortende",
  "summary.notAssessed": "Inhaltsfolie · Nicht bewertet",
  "summary.notScored": "Meinungsrückmeldung · Ohne Wertung",
  "summary.multiSelect":
    "Mehrfachauswahl erlaubt. Gezählt werden Personen, die die jeweilige Option gewählt haben; die Summe kann die Anzahl der Antwortenden überschreiten.",
  "summary.accuracyValue":
    "Richtigkeit: {percent}% ({correct} von {responses} bewerteten Antworten)",
  "summary.initialAccuracy":
    "Anfängliche Richtigkeit: {percent}% ({correct} von {responses} bewerteten Antworten)",
  "summary.recovery": "Nachweise für Lernfortschritt",
  "summary.recovery.linked": "Verknüpfte Nachprüfung",
  "summary.recovery.revote": "Erneute Abstimmung",
  "summary.recoveryValue": "{recovered} von {eligible} geeigneten Paaren verbessert ({percent}%)",
  "summary.measure.respondents": "Anzahl der Antwortenden",
  "summary.measure.selections": "Anzahl der Auswahlwerte",
  "summary.measure.weighted_points": "Gewichtete Rangpunkte",
  "summary.suppression.insufficient_sample":
    "Nachweise werden bei weniger als fünf Antwortenden ausgeblendet.",
  "summary.suppression.participant_text":
    "Von Teilnehmenden verfasster Text wird aus geteilten Zusammenfassungen ausgeschlossen.",
  "summary.suppression.unavailable": "Dieser Nachweis ist nicht verfügbar.",
  "summary.note.aggregate_only":
    "Nur aggregierte Ergebnisse. Namen, individuelle Ergebnisse und Rohbeiträge werden ausgeschlossen.",
  "summary.note.insufficient_sample": "Nachweise aus Stichproben unter fünf werden ausgeblendet.",
  "summary.note.participant_text_excluded":
    "Teilnehmertexte und Begriffe aus Wortwolken werden ausgeschlossen.",
  "summary.note.paired_evidence":
    "Fortschritt zählt gepaarte Ergebnisse von Nachprüfungen, keine eindeutigen Personen oder bewiesenen kausalen Effekte.",
  "summary.note.no_scored_evidence":
    "Keine bewerteten Lernnachweise verfügbar; Meinungsrückmeldungen messen keine Richtigkeit.",
};

export default messages;
