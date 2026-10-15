import type { SessionSummaryMessages } from "./en-CA";

const messages: SessionSummaryMessages = {
  "summary.open": "Partager le résumé",
  "summary.title": "Résumé de la session",
  "summary.close": "Fermer",
  "summary.description":
    "Prévisualisez le résumé agrégé, téléchargez-le ou créez un lien de partage temporaire.",
  "summary.loading": "Chargement du résumé…",
  "summary.failed": "Impossible de mettre à jour le résumé. Actualisez et réessayez.",
  "summary.unavailable": "Ce résumé est indisponible. Demandez un lien valide à l’organisateur.",
  "summary.downloads": "Télécharger le résumé",
  "summary.download.pdf": "Télécharger le PDF",
  "summary.download.png": "Télécharger l’image",
  "summary.download.xlsx": "Télécharger le tableur",
  "summary.downloadsUnavailable": "Les téléchargements sont indisponibles pour ce résumé.",
  "summary.downloadFailed":
    "Le téléchargement a échoué. Réessayez ou demandez un lien valide à l’organisateur.",
  "summary.downloaded": "Résumé téléchargé.",
  "summary.imageContent": "Contenu de l’image",
  "summary.wholeSummary": "Résumé complet",
  "summary.create": "Créer un lien de partage",
  "summary.expiryDays": "Durée du lien en jours (1–30)",
  "summary.allowDownloads": "Autoriser les destinataires à télécharger le résumé",
  "summary.bearerNotice":
    "Toute personne disposant du lien peut lire le résumé agrégé jusqu’à son expiration ou sa révocation. Les copies téléchargées ne peuvent pas être révoquées.",
  "summary.nextSteps": "Prochaines étapes",
  "summary.nextStepsHint":
    "Notes facultatives de l’organisateur (2 000 caractères). Elles seront partagées ; omettez les noms et les informations personnelles.",
  "summary.expires": "Expire le {date}",
  "summary.retention":
    "Les liens ne peuvent pas dépasser la date limite de conservation de la session : {date}.",
  "summary.working": "En cours…",
  "summary.created": "Lien de partage créé.",
  "summary.replayed":
    "Ce partage a déjà été accepté. Son lien original ne peut plus être affiché. Consultez les liens existants avant d’en créer un autre.",
  "summary.uncertain":
    "La demande n’a pas pu être confirmée. La liste des liens a été actualisée ; réessayer avec les mêmes détails utilise la même demande.",
  "summary.saveLink":
    "Enregistrez ce lien maintenant. Son secret n’est pas conservé et ce lien exact ne sera plus affiché.",
  "summary.link": "Lien de partage",
  "summary.copy": "Copier le lien",
  "summary.copied": "Lien copié.",
  "summary.copyFailed": "La copie a été bloquée. Sélectionnez et copiez le lien manuellement.",
  "summary.links": "Liens de partage existants",
  "summary.noLinks": "Aucun lien de partage n’a été créé.",
  "summary.refresh": "Actualiser les liens",
  "summary.linkCreated": "Créé le {date}",
  "summary.linkActive": "Actif",
  "summary.linkExpired": "Expiré",
  "summary.linkRevoked": "Révoqué",
  "summary.revoke": "Révoquer le lien",
  "summary.revoked": "Lien de partage révoqué.",
  "summary.reason.feature_disabled":
    "La création de liens est suspendue. Vous pouvez toujours gérer les liens existants.",
  "summary.reason.role":
    "Votre rôle permet de consulter les résumés, mais pas de créer ou révoquer des liens.",
  "summary.reason.exports_entitlement":
    "Les exports et le partage de résumés n’étaient pas inclus pour cette session.",
  "summary.participants": "Participants",
  "summary.responses": "Réponses",
  "summary.questions": "Points de contrôle",
  "summary.results": "Résultats par question",
  "summary.questionRegion": "Résultats de la question {number} : {prompt}",
  "summary.response": "Réponse",
  "summary.value": "Valeur",
  "summary.sample": "{count} répondants",
  "summary.notAssessed": "Diapositive de contenu · Non évaluée",
  "summary.notScored": "Avis · Sans notation",
  "summary.multiSelect":
    "Plusieurs choix autorisés. Les nombres indiquent les répondants ayant choisi chaque option ; leur total peut dépasser le nombre de répondants.",
  "summary.accuracyValue": "Exactitude : {percent}% ({correct} sur {responses} réponses évaluées)",
  "summary.initialAccuracy":
    "Exactitude initiale : {percent}% ({correct} sur {responses} réponses évaluées)",
  "summary.recovery": "Éléments de récupération",
  "summary.recovery.linked": "Vérification liée",
  "summary.recovery.revote": "Nouveau vote",
  "summary.recoveryValue":
    "{recovered} sur {eligible} paires admissibles ont progressé ({percent}%)",
  "summary.measure.respondents": "Nombre de répondants",
  "summary.measure.selections": "Nombre de sélections",
  "summary.measure.weighted_points": "Points de classement pondérés",
  "summary.suppression.insufficient_sample":
    "Les résultats sont masqués en dessous de cinq répondants.",
  "summary.suppression.participant_text":
    "Les textes rédigés par les participants sont exclus des résumés partagés.",
  "summary.suppression.unavailable": "Ces résultats sont indisponibles.",
  "summary.note.aggregate_only":
    "Résultats agrégés uniquement. Les noms, résultats individuels et contributions brutes sont exclus.",
  "summary.note.insufficient_sample": "Les résultats d’échantillons de moins de cinq sont masqués.",
  "summary.note.participant_text_excluded":
    "Les textes des participants et les termes des nuages de mots sont exclus.",
  "summary.note.paired_evidence":
    "La récupération compte les résultats appariés des vérifications, pas les personnes uniques ni un effet causal démontré.",
  "summary.note.no_scored_evidence":
    "Aucun résultat d’apprentissage noté n’est disponible ; les avis ne mesurent pas l’exactitude.",
};

export default messages;
