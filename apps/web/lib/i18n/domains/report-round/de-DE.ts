import type { ReportRoundMessages } from "./en-CA";

const messages = {
  "reportRound.common.checkpointSet": "Checkpoint-Set",
  "reportRound.common.checkpoints": "Kontrollpunkte",
  "reportRound.common.notMeasured": "Nicht gemessen",
  "reportRound.common.question": "Frage",
  "reportRound.common.questions": "Fragen",
  "reportRound.status.archived": "archiviert",
  "reportRound.status.draft": "Entwurf",
  "reportRound.status.open": "offen",
  "reportRound.status.published": "veröffentlicht",
  "reportRound.status.scheduled": "geplant",
  "reportRound.assign.title": "Übung zuweisen",
  "reportRound.assign.description":
    "Teilen Sie eine veröffentlichte Runde für privates, kontenloses Üben.",
  "reportRound.assign.defaultTitle": "Übung: {title}",
  "reportRound.assign.closeAfterOpen": "Wählen Sie einen Schließzeitpunkt nach Öffnung der Praxis.",
  "reportRound.assign.tooManyLabels": "Fügen Sie nicht mehr als {maximum}-Labels hinzu.",
  "reportRound.assign.labelTooLong": "Jedes Etikett darf maximal 80 Zeichen lang sein.",
  "reportRound.assign.copied": "{label} kopiert.",
  "reportRound.assign.copyBlocked":
    "Die Kopie wurde gesperrt. Wählen Sie stattdessen den Link aus und kopieren Sie ihn.",
  "reportRound.assign.linksDownloaded": "Übungslinks heruntergeladen.",
  "reportRound.assign.loading": "Die veröffentlichte Runde wird geladen…",
  "reportRound.assign.notEnabledTitle": "Übungsaufgaben sind nicht aktiviert",
  "reportRound.assign.notEnabledDescription":
    "Dieser Arbeitsbereich kann weiterhin Live-Runden und berichtsbasierte Wiederherstellungsnachverfolgungen verwenden.",
  "reportRound.assign.returnToRounds": "Zurück zu Runden",
  "reportRound.assign.editorRequiredTitle": "Editorzugriff ist erforderlich",
  "reportRound.assign.editorRequiredDescription":
    "Bitten Sie einen Arbeitsbereichsinhaber oder Redakteur, diese Übungsaufgabe zu erstellen.",
  "reportRound.assign.viewRound": "Runde ansehen",
  "reportRound.assign.publishFirstTitle": "Veröffentlichen Sie diese Runde zuerst",
  "reportRound.assign.publishFirstDescription":
    "In der Praxis wird immer eine unveränderliche veröffentlichte Version verwendet, niemals unvollendete Entwurfsänderungen.",
  "reportRound.assign.openEditor": "Editor öffnen",
  "reportRound.assign.requiresProTitle": "Übungsaufgaben erfordern Pro",
  "reportRound.assign.requiresProDescription":
    "Führen Sie ein Upgrade durch, um kontenlose Übungslinks zu teilen, den Abschluss zu verfolgen und Privatunterkunftsausweise zu erstellen.",
  "reportRound.assign.addMainTitle": "Fügen Sie eine geeignete Hauptfrage hinzu",
  "reportRound.assign.addMainDescription":
    "Diese veröffentlichte Version enthält nur bedingte Nachprüfungen. Übungsaufgaben benötigen mindestens eine Hauptfrage.",
  "reportRound.assign.ready": "Übung bereit",
  "reportRound.assign.saveLinks": "Speichern und teilen Sie diese Links jetzt",
  "reportRound.assign.hashNotice":
    "Polling Pops speichert nur Token-Hashes. Diese genauen Links können nach Verlassen dieser Seite nicht mehr angezeigt werden.",
  "reportRound.assign.genericLink": "Allgemeiner anonymer Link",
  "reportRound.assign.genericPracticeLink": "Allgemeiner Link zur Praxis",
  "reportRound.assign.copy": "Kopie",
  "reportRound.assign.personalLinks": "Persönliche Links für einen Versuch",
  "reportRound.assign.personalLinkNumber": "Persönlicher Link {number}",
  "reportRound.assign.downloadCsv": "Laden Sie Links als CSV herunter",
  "reportRound.assign.managePractice": "Praxis verwalten",
  "reportRound.assign.done": "Erledigt",
  "reportRound.assign.publishedSource": "Veröffentlichte Quelle",
  "reportRound.assign.publishedVersion": "Veröffentlicht v{version}",
  "reportRound.assign.mainQuestions": "Hauptfrage(n)",
  "reportRound.assign.flexible": "Flexibel",
  "reportRound.assign.timed": "Zeitgesteuert",
  "reportRound.assign.participantPacing": "Tempo der Teilnehmer",
  "reportRound.assign.oneAttempt": "Ein Versuch",
  "reportRound.assign.perPersonalLink": "per persönlichem Link",
  "reportRound.assign.immutableDescription":
    "Die Praxis verwendet die unveränderliche veröffentlichte Version. Bedingte Live-Nachprüfungen werden nicht als separate Übungsfragen wiederholt.",
  "reportRound.assign.unpublishedNotice":
    "In dieser Runde gibt es neuere Entwurfsänderungen. Veröffentlichen Sie sie zuerst, wenn sie enthalten sein sollen.",
  "reportRound.assign.settings": "Übungseinstellungen",
  "reportRound.assign.titleField": "Titel",
  "reportRound.assign.timing": "Timing",
  "reportRound.assign.timeFlex": "Zeitflexibel",
  "reportRound.assign.timeFlexDescription":
    "Kein Countdown. Empfohlen, wenn Geschwindigkeit nicht Teil des Lernziels ist.",
  "reportRound.assign.useTimers": "Verwenden Sie Frage-Timer",
  "reportRound.assign.useTimersDescription":
    "Erzwingen Sie den Timer jeder veröffentlichten Frage auf dem Server.",
  "reportRound.assign.openPractice": "Offene Praxis",
  "reportRound.assign.now": "Jetzt",
  "reportRound.assign.nowDescription": "Der Link funktioniert, sobald er erstellt wurde.",
  "reportRound.assign.scheduleLater": "Planen Sie für später",
  "reportRound.assign.scheduleLaterDescription":
    "Links bleiben bis zum ausgewählten Zeitpunkt geschlossen.",
  "reportRound.assign.openDate": "Datum und Uhrzeit des Öffnens",
  "reportRound.assign.closeDate": "Datum und Uhrzeit des Abschlusses",
  "reportRound.assign.createPersonalLinks":
    "Persönliche Links für einen Versuch erstellen (optional)",
  "reportRound.assign.oneLabelPerLine": "Ein Etikett pro Zeile",
  "reportRound.assign.labelsPlaceholder": "Lernender 1\nLernender 2",
  "reportRound.assign.labelsHelp":
    "Etiketten kennzeichnen Links nur für den Moderator. Polling Pops sendet keine E-Mails an Dritte und erstellt keine Lernerkonten. In diesem Plan sind bis zu {maximum} Etiketten verfügbar. Persönliche {count}-Link(s) werden erstellt.",
  "reportRound.assign.creating": "Praxis schaffen…",
  "reportRound.assign.create": "Aufgabe erstellen",
  "reportRound.import.eyebrow": "Portabilität",
  "reportRound.import.roundTitle": "Importieren Sie eine Runde",
  "reportRound.import.legacyTitle": "Importieren Sie einen Prüfpunktsatz",
  "reportRound.import.draftOnly": "Nur Entwurf",
  "reportRound.import.description":
    "Importe werden validiert, bevor etwas gespeichert wird. Nicht unterstützte oder unvollständige Inhalte werden ausdrücklich zur Überprüfung aufgeführt.",
  "reportRound.import.proRound": "Rundenimport und -export sind in Hosted Pro enthalten.",
  "reportRound.import.proLegacy":
    "Import- und Checkpoint-Set-Exporte sind in Hosted Pro enthalten.",
  "reportRound.import.format": "Importformat",
  "reportRound.import.bulkPaste": "Massenpaste",
  "reportRound.import.qtiPackage": "QTI 3-Paket",
  "reportRound.import.newRoundTitle": "Neuer Rundentitel (optional)",
  "reportRound.import.newTitle": "Neuer Titel (optional)",
  "reportRound.import.keepSourceTitle": "Behalten Sie den Quellentitel bei",
  "reportRound.import.chooseQti": "Wählen Sie ein QTI 3 ZIP-Paket",
  "reportRound.import.chooseTextFile": "Wählen Sie eine UTF-8-Datei (optional)",
  "reportRound.import.qtiReady": "QTI-Paket geladen und bereit zur Validierung.",
  "reportRound.import.selectZip": "Wählen Sie ein ZIP-Paket aus, um fortzufahren.",
  "reportRound.import.content": "Inhalte importieren",
  "reportRound.import.bulkExample":
    "Was ist die sicherste Maßnahme?\n* Befolgen Sie die vollständige Prozedur\n- Nehmen Sie eine Abkürzung",
  "reportRound.import.pasteContent": "Fügen Sie hier den {format}-Inhalt ein",
  "reportRound.import.jsonHelpRound":
    "Fügen Sie einen Polling Pops-JSON-Export ein oder wählen Sie dessen JSON-Datei aus.",
  "reportRound.import.jsonHelpLegacy":
    "Fügen Sie einen Polling Pops-Checkpoint-Set-Export ein oder wählen Sie dessen JSON-Datei aus.",
  "reportRound.import.csvHelp":
    "Fügen Sie einen Polling Pops-CSV-Export ein oder wählen Sie dessen CSV-Datei aus.",
  "reportRound.import.bulkHelpRound":
    "Trennen Sie Fragen durch eine Leerzeile. Beginnen Sie Ihre Auswahl mit „*“ für richtig oder „-“ für falsch.",
  "reportRound.import.bulkHelpLegacy":
    "Trennen Sie Kontrollpunkte durch eine Leerzeile. Beginnen Sie Ihre Auswahl mit „*“ für richtig oder „-“ für falsch.",
  "reportRound.import.qtiHelp":
    "Wählen Sie ein QTI 3 ZIP-Paket. Ausgewählte Antwort-, Mehrfachauswahl-, Wahr/Falsch- und numerische Elemente werden unterstützt.",
  "reportRound.import.validating": "Validierung…",
  "reportRound.import.validate": "Entwurf validieren und importieren",
  "reportRound.import.validationDetails": "Validierungsdetails",
  "reportRound.import.error": "Fehler",
  "reportRound.import.warning": "Warnung",
  "reportRound.import.row": "Zeile {row}",
  "reportRound.import.fileTooLarge": "Diese Datei ist größer als das {limit} MB-Importlimit.",
  "reportRound.import.fileReady": "{file} ist zur Validierung bereit.",
  "reportRound.import.fileReadError":
    "Die ausgewählte Datei konnte nicht gelesen werden. Versuchen Sie, es als UTF-8-Text zu speichern.",
  "reportRound.import.failedStatus": "Der {artifact} konnte nicht importiert werden ({status}).",
  "reportRound.import.failed": "Der {artifact} konnte nicht importiert werden.",
  "reportRound.import.success": "{title} wurde als Entwurf mit {count} {items} importiert.",
  "reportRound.preview.checkpointSet": "Checkpoint-Set",
  "reportRound.preview.checkpointSetTitle": "Titel des Checkpoint-Sets",
  "reportRound.preview.checkpointNumber": "Kontrollpunkt {number}",
  "reportRound.preview.checkpointAnswer": "Checkpoint {checkpoint}, Antwort {answer}",
  "reportRound.preview.checkpoints": "Kontrollpunkte",
  "reportRound.preview.completeSet": "Vervollständigen Sie den Prüfpunktsatz vor der Vorschau",
  "reportRound.preview.validationError":
    "Vorschau nicht verfügbar. {source}: {issue}. Kehren Sie zum Editor zurück und beenden Sie diesen Entwurf.",
  "reportRound.preview.returnToEditor": "Zurück zum Herausgeber",
  "reportRound.preview.loading": "Vorschau wird geladen…",
  "reportRound.preview.addCheckpoint":
    "Fügen Sie einen Prüfpunkt hinzu, um eine Vorschau dieses Satzes anzuzeigen.",
  "reportRound.preview.progress": "Kontrollpunkt {current} von {total}",
  "reportRound.preview.timerLabel": "{seconds} zweiter Timer",
  "reportRound.preview.answerChoices": "Antwortmöglichkeiten",
  "reportRound.preview.numericResponse": "Numerische Antwort {unit}",
  "reportRound.preview.acceptedValue": "Akzeptierter Wert: {value} ± {tolerance} {unit}",
  "reportRound.preview.chooseRating": "Wählen Sie eine Bewertung",
  "reportRound.preview.correctRevealed": "Richtige Antwort enthüllt",
  "reportRound.preview.previous": "Vorheriger Kontrollpunkt",
  "reportRound.preview.hideAnswer": "Antwort ausblenden",
  "reportRound.preview.next": "Nächster Kontrollpunkt",
  "reportRound.story.syntheticLabel": "Geschichte der synthetischen Wiederherstellung",
  "reportRound.story.label": "Genesungsgeschichte",
  "reportRound.story.title": "Was hat sich während dieser Sitzung geändert?",
  "reportRound.story.syntheticEvidence": "Synthetische Praxisbeweise · nie gespeichert",
  "reportRound.story.sessionEvidence": "Sitzungsbeweise, keine langfristige Aufbewahrung",
  "reportRound.story.recovered": "Was erholte sich",
  "reportRound.story.ratio": "{recovered}/{total}",
  "reportRound.story.noPairedEvidence":
    "Es wurden keine gepaarten Erst- und Nachprüfungsnachweise gesammelt.",
  "reportRound.story.recoveryNarrative":
    "{percent} von anfänglich falschen Teilnehmern, wobei beide Antworten über {evidence} wiederhergestellt wurden.",
  "reportRound.story.unresolved": "Was bleibt ungelöst",
  "reportRound.story.facilitatorTried": "Was der Moderator versucht hat",
  "reportRound.story.noIntervention": "Es wurde kein Eingriff aufgezeichnet.",
  "reportRound.story.nextAction": "Empfohlene nächste Aktion",
  "reportRound.story.comparisonLabel": "Erste Genauigkeit und Wiederherstellungsnachweise",
  "reportRound.story.initialAccuracy": "Anfängliche Genauigkeit",
  "reportRound.story.accuracyRatio": "{correct}/{total} · {percent}",
  "reportRound.story.pairedRecovery":
    "Unter gepaarten zunächst falschen Antworten wiederhergestellt",
  "reportRound.story.confidenceContradiction": "Vertrauenswiderspruch:",
  "reportRound.story.confidenceSummary":
    "{highWrong} falsche Antwort(en) mit hoher Konfidenz; {correctUnsure} richtige, aber unsichere Antwort(en).",
  "reportRound.story.smallSample":
    "Mindestens ein Wiederherstellungsvergleich weist weniger als fünf Antwortpaare auf.",
  "reportRound.story.interventionTimeline": "Zeitleiste der Intervention",
  "reportRound.story.syntheticAction": "Synthetische Aktion",
  "reportRound.story.timeUnavailable": "Zeit nicht verfügbar",
  "reportRound.story.followedByRecheck": "gefolgt von einer verknüpften erneuten Überprüfung",
  "reportRound.rehearsal.skip": "Zum Inhalt der Probe springen",
  "reportRound.rehearsal.readOnlyBadge": "Schreibgeschützte Übung",
  "reportRound.rehearsal.backToPreview": "Zurück zur Round-Vorschau",
  "reportRound.rehearsal.backToRounds": "Zurück zu den Runden",
  "reportRound.rehearsal.preparing": "Vorbereitung der Genesungsprobe…",
  "reportRound.rehearsal.eyebrow": "Erholungsprobe",
  "reportRound.rehearsal.openError": "Die Wiederherstellungsprobe konnte nicht geöffnet werden",
  "reportRound.rehearsal.archivedTitle": "Archivierte Runden können nicht geprobt werden",
  "reportRound.rehearsal.archivedDescription":
    "Stellen Sie diese Runde wieder her, bevor Sie eine Probe eröffnen.",
  "reportRound.rehearsal.unavailableTitle": "Die Wiederherstellungsprobe ist nicht verfügbar",
  "reportRound.rehearsal.unavailableDescription":
    "Diese private Beta steht Workspace-Mitgliedern zur Verfügung, wenn die Probenfunktion aktiviert ist.",
  "reportRound.rehearsal.noRecordCreated":
    "Es wurde kein Sitzungs- oder Teilnehmerdatensatz erstellt.",
  "reportRound.rehearsal.questionChoices": "Fragenauswahl",
  "reportRound.rehearsal.patternLabel":
    "{correct} richtig, {wrong} falsch, {missing} keine Antwort",
  "reportRound.rehearsal.correct": "Richtig",
  "reportRound.rehearsal.leadingWrong": "Falsch führen",
  "reportRound.rehearsal.noResponse": "Keine Antwort",
  "reportRound.rehearsal.linkedRecovery": "verlinkte Recheck-Wiederherstellung",
  "reportRound.rehearsal.revoteImprovement": "Verbesserung revotieren",
  "reportRound.rehearsal.syntheticUnresolved":
    "Die synthetischen Lernenden {count} blieben nach der erneuten Überprüfung falsch.",
  "reportRound.rehearsal.noneUnresolved":
    "Nach der erneuten Überprüfung blieb kein synthetischer Lernender falsch.",
  "reportRound.rehearsal.intervention.peer_discussion": "Peer-Diskussion",
  "reportRound.rehearsal.intervention.explain": "erklären",
  "reportRound.rehearsal.intervention.example": "Beispiel",
  "reportRound.rehearsal.intervention.break": "brechen",
  "reportRound.rehearsal.targetPractice": "Schießübungen",
  "reportRound.rehearsal.reviewEvidence": "Überprüfen Sie die Beweise",
  "reportRound.rehearsal.targetPracticeDescription":
    "Nutzen Sie das ungelöste synthetische Muster, um gezielte Übungen zu planen.",
  "reportRound.rehearsal.reviewEvidenceDescription":
    "Überprüfen Sie die simulierten Beweise und üben Sie dann ein anderes Muster.",
  "reportRound.rehearsal.linkedEvidence":
    "Für den Vergleich wird die erstellte verknüpfte erneute Prüfung verwendet.",
  "reportRound.rehearsal.revoteEvidence":
    "Der Vergleich verwendet eine Wiederholung derselben Frage.",
  "reportRound.rehearsal.syntheticEvidenceNote":
    "{mode} Synthetische Probendaten werden niemals gespeichert.",
  "reportRound.rehearsal.reviewOutcomes": "Überprüfen Sie die synthetischen Lernergebnisse",
  "reportRound.rehearsal.resultsCaption":
    "Synthetische Ergebnisse für die Ausgangsfrage und {recheck}",
  "reportRound.rehearsal.linkedRecheck": "verlinkte erneute Überprüfung",
  "reportRound.rehearsal.revote": "erneut abstimmen",
  "reportRound.rehearsal.learner": "Lerner",
  "reportRound.rehearsal.syntheticLearnerNumber": "Synthetischer Lerner {number}",
  "reportRound.rehearsal.initial": "Anfänglich",
  "reportRound.rehearsal.recheck": "Überprüfen Sie es noch einmal",
  "reportRound.rehearsal.outcome.correct": "richtig",
  "reportRound.rehearsal.outcome.incorrect": "falsch",
  "reportRound.rehearsal.outcome.no_response": "keine Antwort",
  "reportRound.rehearsal.command.start": "Runde beginnen",
  "reportRound.rehearsal.command.pause": "Pause",
  "reportRound.rehearsal.command.resume": "Wieder aufnehmen",
  "reportRound.rehearsal.command.lock": "Antworten sperren",
  "reportRound.rehearsal.command.reveal": "Antwort verraten",
  "reportRound.rehearsal.command.next": "Weitermachen",
  "reportRound.rehearsal.command.show_leaderboard": "Rangliste anzeigen",
  "reportRound.rehearsal.command.end": "Runde beenden",
  "reportRound.rehearsal.command.lock_lobby": "Lobby sperren",
  "reportRound.rehearsal.command.unlock_lobby": "Lobby freischalten",
  "reportRound.rehearsal.command.kick": "Teilnehmer entfernen",
  "reportRound.rehearsal.command.intervention.start": "Beginnen Sie mit der Intervention",
  "reportRound.rehearsal.command.intervention.finish": "Beenden Sie den Eingriff",
  "reportRound.rehearsal.command.recheck.open": "Öffnen Sie die erneute Überprüfung",
  "reportRound.rehearsal.command.intervention.peer_discussion": "Starten Sie eine Peer-Diskussion",
  "reportRound.rehearsal.command.intervention.explain": "Erklären oder verstärken Sie",
  "reportRound.rehearsal.command.intervention.example": "Arbeiten Sie ein Beispiel",
  "reportRound.rehearsal.command.intervention.break": "Machen Sie eine kurze Pause",
  "reportRound.rehearsal.command.linkedRecheck": "Öffnen Sie die verknüpfte erneute Überprüfung",
  "reportRound.rehearsal.command.revote": "Erneute Prüfung durch erneutes Abstimmen",
  "reportRound.rehearsal.phase.briefing": "Lobby",
  "reportRound.rehearsal.phase.question_open": "Frage offen",
  "reportRound.rehearsal.phase.responses": "Frage offen",
  "reportRound.rehearsal.phase.diagnosis": "Diagnostizieren",
  "reportRound.rehearsal.phase.revealed": "Wählen Sie den nächsten Schritt",
  "reportRound.rehearsal.phase.intervention": "Intervention im Gange",
  "reportRound.rehearsal.phase.verify": "Wiederherstellung überprüfen",
  "reportRound.rehearsal.phase.recheck": "Erneut prüfen, öffnen",
  "reportRound.rehearsal.phase.debrief": "Nachbesprechung zur Genesung",
  "reportRound.rehearsal.scenario.low_participation.title": "Geringe Beteiligung",
  "reportRound.rehearsal.scenario.low_participation.short": "6 von 10 antworten",
  "reportRound.rehearsal.scenario.low_participation.description":
    "Üben Sie, ein Zugriffsproblem von einem Verständnisproblem zu trennen, bevor Sie auf das Ergebnis reagieren.",
  "reportRound.rehearsal.scenario.split_room.title": "Geteiltes Antwortmuster",
  "reportRound.rehearsal.scenario.split_room.short": "5 richtig · 5 wähle eine falsche Option",
  "reportRound.rehearsal.scenario.split_room.description":
    "Üben Sie das Lesen einer gleichmäßigen Aufteilung, ohne die Produktionseinblickspriorität von Polling Pops zu ersetzen.",
  "reportRound.rehearsal.scenario.confident_misconception.title": "Selbstbewusstes Missverständnis",
  "reportRound.rehearsal.scenario.confident_misconception.short":
    "4 ganz sicher falsch · 6 richtig",
  "reportRound.rehearsal.scenario.confident_misconception.description":
    "Üben Sie, zu reagieren, wenn eine bedeutungsvolle Gruppe sicher falsch liegt, und prüfen Sie dann, ob sich etwas erholt.",
  "reportRound.rehearsal.briefingTitle": "{scenario}: {pattern}",
  "reportRound.rehearsal.respondedTitle": "{count} von 10 synthetischen Lernenden antworteten",
  "reportRound.rehearsal.insight.insufficient_sample": "Nutzen Sie Ihr Urteilsvermögen",
  "reportRound.rehearsal.insight.low_participation":
    "Überprüfen Sie den Zugang, bevor Sie dolmetschen",
  "reportRound.rehearsal.insight.high_confidence_error":
    "Beheben Sie das selbstbewusste Missverständnis",
  "reportRound.rehearsal.insight.dominant_misconception":
    "Beheben Sie das vorherrschende Missverständnis",
  "reportRound.rehearsal.insight.low_correctness": "Erklären oder arbeiten Sie ein Beispiel durch",
  "reportRound.rehearsal.insight.split_understanding":
    "Versuchen Sie es mit einer Diskussion unter Gleichgesinnten",
  "reportRound.rehearsal.insight.correct_but_uncertain": "Bekräftigen Sie, warum es richtig ist",
  "reportRound.rehearsal.insight.continue": "Fahren Sie fort oder prüfen Sie optional erneut",
  "reportRound.rehearsal.insight.opinion_result": "Überprüfen Sie die Reaktion des Publikums",
  "reportRound.rehearsal.interventionTitle.peer_discussion":
    "Laden Sie zu einer kurzen Peer-Diskussion ein",
  "reportRound.rehearsal.interventionTitle.explain":
    "Konzentrieren Sie sich auf die Argumentation, nicht auf den Lernenden",
  "reportRound.rehearsal.interventionTitle.example":
    "Arbeiten Sie ein kontrastierendes Beispiel durch",
  "reportRound.rehearsal.interventionTitle.break": "Treffen Sie eine bewusste Entscheidung",
  "reportRound.rehearsal.collectEvidence": "Sammeln Sie neue Beweise",
  "reportRound.rehearsal.debriefTitle": "Nachbesprechung zur Genesung",
  "reportRound.rehearsal.guidance.briefing":
    "Zehn klar gekennzeichnete synthetische Lernende stehen bereit. Nichts in dieser Probe fügt sich in eine Live-Session ein oder verändert diese.",
  "reportRound.rehearsal.guidance.question_open":
    "Stellen Sie sich vor, Sie stellen diese Frage. Die Übungsuhr ist deterministisch und es kann kein echter Teilnehmer teilnehmen.",
  "reportRound.rehearsal.guidance.responses":
    "Überprüfen Sie das synthetische Antwortmuster, bevor Sie Antworten sperren.",
  "reportRound.rehearsal.guidance.diagnosis":
    "Nutzen Sie Beteiligung, Korrektheit und Selbstvertrauen, bevor Sie handeln.",
  "reportRound.rehearsal.guidance.revealed":
    "Wählen Sie eine verhältnismäßige Intervention basierend auf dem Antwortmuster.",
  "reportRound.rehearsal.guidance.intervention":
    "Gehen Sie auf das Argumentationsmuster ein, ohne einen Lernenden zu identifizieren.",
  "reportRound.rehearsal.guidance.verify": "Sammeln Sie nach dem Eingriff neue Beweise.",
  "reportRound.rehearsal.guidance.recheck":
    "Synthetische Lernende reagieren nun auf die erneute Überprüfung.",
  "reportRound.rehearsal.guidance.debrief":
    "Vergleichen Sie die ursprünglichen Beweise, prüfen Sie sie erneut und planen Sie dann die nächste Maßnahme.",
  "reportRound.rehearsal.stepEyebrow.briefing": "{number} · Informieren Sie den Raum",
  "reportRound.rehearsal.stepEyebrow.question_open": "{number} · Fragen Sie",
  "reportRound.rehearsal.stepEyebrow.responses": "{number} · Hinweis",
  "reportRound.rehearsal.stepEyebrow.diagnosis": "{number} · Diagnose",
  "reportRound.rehearsal.stepEyebrow.revealed": "{number} · Wählen Sie einen Eingriff",
  "reportRound.rehearsal.stepEyebrow.intervention": "{number} · Eingreifen",
  "reportRound.rehearsal.stepEyebrow.verify": "{number} · Überprüfen",
  "reportRound.rehearsal.stepEyebrow.recheck": "{number} · Erneut prüfen",
  "reportRound.rehearsal.stepEyebrow.debrief": "{number} · Nachbesprechung",
  "reportRound.rehearsal.step.briefing": "Einweisung",
  "reportRound.rehearsal.step.question_open": "Frage offen",
  "reportRound.rehearsal.step.responses": "Antworten",
  "reportRound.rehearsal.step.diagnosis": "Diagnose",
  "reportRound.rehearsal.step.revealed": "enthüllt",
  "reportRound.rehearsal.step.intervention": "Intervention",
  "reportRound.rehearsal.step.verify": "verifizieren",
  "reportRound.rehearsal.step.recheck": "noch einmal prüfen",
  "reportRound.rehearsal.step.debrief": "Nachbesprechung",
  "reportRound.rehearsal.continue.briefing": "Runde beginnen",
  "reportRound.rehearsal.continue.question_open": "Sammeln Sie synthetische Antworten",
  "reportRound.rehearsal.continue.responses": "Antworten sperren",
  "reportRound.rehearsal.continue.diagnosis": "Antwort verraten",
  "reportRound.rehearsal.continue.revealed": "Beginnen Sie mit der Intervention",
  "reportRound.rehearsal.continue.intervention": "Beenden Sie den Eingriff",
  "reportRound.rehearsal.continue.verify": "Öffnen Sie die erneute Überprüfung",
  "reportRound.rehearsal.continue.recheck": "Antworten sperren",
  "reportRound.rehearsal.continue.debrief": "Vollständig",
  "reportRound.rehearsal.exit": "Praxis verlassen",
  "reportRound.rehearsal.progress": "Probenfortschritt",
  "reportRound.rehearsal.responses": "{count}-Antworten",
  "reportRound.rehearsal.strongSignal": "Starkes Signal",
  "reportRound.rehearsal.useJudgment": "Nutzen Sie Ihr Urteilsvermögen",
  "reportRound.rehearsal.participation": "Teilnahme",
  "reportRound.rehearsal.verySureWrong": "Ganz sicher falsch",
  "reportRound.rehearsal.splitRule":
    "Dies ist ein 5/5-Split-Muster. Die Produktionsregel empfiehlt zuerst ein Beispiel, da 50 % korrekt unter dem Schwellenwert für niedrige 60 %-Korrektheit liegen.",
  "reportRound.rehearsal.facilitatorPrompt": "Aufforderung des Moderators",
  "reportRound.rehearsal.promptQuote":
    "„Welcher Hinweis würde uns helfen, die verlockende Reaktion auszuschließen?“",
  "reportRound.rehearsal.promptGuidance":
    "Halten Sie den Lernenden anonym. Gehen Sie auf das Argumentationsmuster ein und sammeln Sie dann neue Beweise.",
  "reportRound.rehearsal.anotherPattern": "Üben Sie ein anderes Muster",
  "reportRound.rehearsal.productionGuidance":
    "Die Produktionsberatung ist eine Aufforderung zum Urteil des Moderators und kein automatisches Urteil.",
  "reportRound.rehearsal.syntheticLearners": "Synthetische Lernende",
  "reportRound.rehearsal.roundEvidence": "Runde Beweise",
  "reportRound.rehearsal.savedData": "Gespeicherte Daten",
  "reportRound.rehearsal.noLearnerRecords": "Keine Lernaufzeichnungen",
  "reportRound.rehearsal.stepProgress": "Schritt {current} von {total}: {title}",
  "reportRound.rehearsal.startError": "Die Probe konnte nicht beginnen.",
  "reportRound.rehearsal.betaEyebrow": "Wiederherstellungsprobe · Private Beta",
  "reportRound.rehearsal.heroTitle": "Üben Sie den Moment, nachdem die Antworten eingegangen sind.",
  "reportRound.rehearsal.heroDescription":
    "Führen Sie eine geführte, deterministische Wiederherstellungsschleife mit zehn synthetischen Lernenden durch. Sehen Sie die gleichen Einblicke, Interventionen und erneuten Prüfzustände wie in einer Live-Runde – ohne eine Sitzung zu erstellen oder eine Antwort zu speichern.",
  "reportRound.rehearsal.safeTitle": "Vom Design her sicher",
  "reportRound.rehearsal.safeDescription":
    "Schreibgeschützter Round-Inhalt. In-Memory-Engine. Keine Sitzungs-, Teilnehmer- oder Antwortdatensätze.",
  "reportRound.rehearsal.chooseSource": "Wählen Sie die Beweisquelle",
  "reportRound.rehearsal.chooseSourceDescription":
    "Veröffentlichte Runden verwenden standardmäßig ihre veröffentlichte Version; Entwürfe verwenden die neuesten Editorinhalte.",
  "reportRound.rehearsal.version": "Probeversion",
  "reportRound.rehearsal.currentDraft": "Aktueller Entwurf",
  "reportRound.rehearsal.notPublished": "Noch nicht veröffentlicht",
  "reportRound.rehearsal.usesLinkedRecheck": "Verwendet die verknüpfte erneute Prüfung: {prompt}",
  "reportRound.rehearsal.usesRevote":
    "Keine zulässige verknüpfte erneute Überprüfung – in der Praxis wird eine deutlich gekennzeichnete erneute Überprüfung verwendet.",
  "reportRound.rehearsal.noEligibleQuestion": "Noch keine geeignete Frage",
  "reportRound.rehearsal.ineligible.low_participation":
    "Bei geringer Beteiligung ist eine vollständig bewertete Auswahlfrage mit mindestens einer falschen Auswahl erforderlich.",
  "reportRound.rehearsal.ineligible.split_room":
    "Für den geteilten Raum ist eine vollständig bewertete Auswahlfrage mit einer nicht getaggten falschen Auswahl erforderlich.",
  "reportRound.rehearsal.ineligible.confident_misconception":
    "Zuversichtliche Missverständnisse erfordern eine vollständig bewertete Auswahlfrage mit aktiviertem Vertrauen und einer markierten falschen Auswahl.",
  "reportRound.rehearsal.requirement.question":
    "Verwenden Sie eine Haupt-Einzelauswahl- oder Richtig/Falsch-Frage zu Diagnose- oder Übungszwecken.",
  "reportRound.rehearsal.requirement.answers":
    "Geben Sie genau eine richtige Antwort ein und vervollständigen Sie jedes Antwortetikett.",
  "reportRound.rehearsal.requirement.low_participation":
    "Geben Sie mindestens eine falsche Auswahl an.",
  "reportRound.rehearsal.requirement.split_room":
    "Geben Sie mindestens eine nicht markierte falsche Auswahl für das geteilte Antwortmuster an.",
  "reportRound.rehearsal.requirement.confident_misconception":
    "Schaffen Sie Vertrauen und kennzeichnen Sie mindestens eine falsche Wahl mit einem Missverständnisschlüssel.",
  "reportRound.rehearsal.openControls": "Öffnen Sie die entsprechenden Fragensteuerelemente",
  "reportRound.rehearsal.askEditor":
    "Bitten Sie einen Eigentümer oder Redakteur, die erforderlichen Diagnosedetails hinzuzufügen.",
  "reportRound.rehearsal.returnToPreview": "Return to read-only preview",
  "reportRound.rehearsal.pickPattern": "Wählen Sie ein druckgeprüftes Muster",
  "reportRound.rehearsal.pickPatternDescription":
    "Jeder Lauf ist exakt und wiederholbar, sodass Teams die Moderationsoptionen vergleichen können.",
  "reportRound.rehearsal.practiceScenario": "Übungsszenario",
  "reportRound.rehearsal.eligibleQuestions": "{count} geeignete Frage(n)",
  "reportRound.rehearsal.start": "Beginnen Sie mit der privaten Probe",
  "reportRound.rehearsal.loopTitle": "Die Wiederherstellungsschleife",
  "reportRound.rehearsal.loop.notice": "Beachten",
  "reportRound.rehearsal.loop.noticeDescription":
    "Lesen Sie gemeinsam Beteiligung, Korrektheit und Selbstvertrauen.",
  "reportRound.rehearsal.loop.intervene": "Intervene",
  "reportRound.rehearsal.loop.interveneDescription":
    "Gehen Sie auf das Argumentationsmuster ein, ohne jemanden herauszugreifen.",
  "reportRound.rehearsal.loop.recheck": "Überprüfen Sie es noch einmal",
  "reportRound.rehearsal.loop.recheckDescription":
    "Bevorzugen Sie eine verknüpfte Frage. Verwenden Sie ein Revote, wenn keines verfügbar ist.",
  "reportRound.rehearsal.loop.debrief": "Nachbesprechung",
  "reportRound.rehearsal.loop.debriefDescription":
    "Separate stronger transfer evidence from same-prompt improvement.",
  "reportRound.rehearsal.everyRole": "Designed for every workspace role",
  "reportRound.rehearsal.everyRoleDescription":
    "Besitzer, Redakteure und Betrachter können proben, da dieser Flow keine Teilnehmerdatensätze veröffentlichen, hosten, bearbeiten oder erstellen kann.",
  "reportRound.rehearsal.telemetry":
    "Polling Pops zeichnet nur das ausgewählte Szenario, Start/Abschluss und einen groben Dauerzeitraum für das Produktlernen auf – niemals Round-Text, Antworten oder Lernenden-IDs.",
  "reportRound.editor.reuseLimit":
    "Wählen Sie weniger Fragen aus, damit diese Runde die Grenze von 200 Fragen einhält.",
  "reportRound.editor.history.questionAdded": "Frage hinzugefügt.",
  "reportRound.editor.history.questionsReused.one": "{count} Frage wiederverwendet.",
  "reportRound.editor.history.questionsReused.other": "{count} Fragen wiederverwendet.",
  "reportRound.editor.history.questionDeleted": "Frage gelöscht.",
  "reportRound.editor.history.questionDuplicated": "Frage dupliziert.",
  "reportRound.editor.history.recheckAdded": "Überprüfungsfrage hinzugefügt.",
  "reportRound.editor.history.questionMoved": "Frage verschoben.",
  "reportRound.editor.recoveredCopy": "{title} — wiederhergestellte Kopie",
  "reportRound.editor.describeImage": "Beschreiben Sie das Lehrbild, bevor Sie es hochladen.",
  "reportRound.clarity.noConceptEvidence": "Keine Aufarbeitungsdaten auf Konzeptebene erfasst.",
  "reportRound.clarity.trackedConcepts": "Konzepte mit erfassten Aufarbeitungsdaten: {count}.",
  "reportRound.clarity.unresolvedEvidence": "{concept}: {count} ungelöste Antwort(en).",
  "reportRound.clarity.initialSmallSample":
    "Weniger als fünf bewertete Antworten. Die Anzahl vorsichtig interpretieren.",
  "reportRound.clarity.nextPractice": "Gezielte Übungen für ungelöste Konzepte erstellen.",
  "reportRound.clarity.nextReview": "Sitzungsdaten prüfen und später eine erneute Prüfung planen.",
  "reportRound.clarity.nextRecheck":
    "Nächstes Mal eine verknüpfte Nachprüfung zur Erfassung von Aufarbeitung hinzufügen.",
  "reportRound.clarity.targetPractice": "Gezielt üben",
  "reportRound.clarity.reviewEvidence": "Daten prüfen",
  "reportRound.clarity.linkedRecheck": "verknüpfte Nachprüfung",
  "reportRound.clarity.revote": "erneute Abstimmung",
  "reportRound.clarity.noRecheckEvidence": "Keine Nachprüfungsdaten",
  "reportRound.clarity.sessionReport": "Sitzungsbericht",
  "reportRound.clarity.backToResults": "Zurück zu Ergebnissen",
  "reportRound.clarity.noPairedResponses": "Keine gepaarten Nachprüfungsantworten",
  "reportRound.clarity.unresolvedConcepts": "ungelöste Konzepte",
  "reportRound.clarity.participation": "Teilnahme",
} satisfies ReportRoundMessages;

export default messages;
