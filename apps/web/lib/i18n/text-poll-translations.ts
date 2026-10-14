import type { SupportedLocale } from "@openround/contracts";
import type {
  textPollAuthoringEnglishMessages,
  textPollLiveEnglishMessages,
} from "./text-poll-copy";

export type TextPollTranslationLocale = Exclude<SupportedLocale, "en-CA">;
export type TextPollAuthoringTranslation = Record<
  keyof typeof textPollAuthoringEnglishMessages,
  string
>;
export type TextPollLiveTranslation = Record<keyof typeof textPollLiveEnglishMessages, string>;

/** Complete localized workflow copy; the English catalog remains the fallback. */
export const textPollTranslations = {
  "de-DE": {
    authoring: {
      "delivery.builder.type.open_text": "Freitext",
      "delivery.builder.type.word_cloud": "Wortwolke",
      "delivery.builder.textResponseHelp":
        "Teilnehmende senden unformatierten Text mit bis zu {limit} Zeichen. Antworten warten auf die Freigabe durch die Moderation. Diese Meinungsfrage wird nicht bewertet.",
      "delivery.builder.textQuestionLimit":
        "Verwende bis zu {limit} Freitext- oder Wortwolkenfragen in einer Runde. Erstelle für weitere Fragen eine andere Runde.",
      "delivery.builder.textLiveOnly":
        "Moderierte Freitext- und Wortwolkenumfragen sind derzeit nur in Live-Runden verfügbar.",
    },
    live: {
      "live.text.responseLabel": "Deine Antwort",
      "live.text.phraseLabel": "Ein Wort oder eine kurze Formulierung",
      "live.text.characterLimit": "{count} von {limit} Zeichen",
      "live.text.reviewPrivacy":
        "Deine Antwort wird von der Moderation geprüft. Nur freigegebene Antworten können nach der Ergebnisfreigabe öffentlich erscheinen. Gib keine privaten Informationen an.",
      "live.text.receiptPending":
        "Antwort gespeichert. Sie wartet auf die Prüfung durch die Moderation.",
      "live.text.receiptApproved": "Antwort gespeichert und freigegeben.",
      "live.text.receiptRemoved":
        "Antwort gespeichert. Die Moderation hat sie aus den öffentlichen Ergebnissen entfernt.",
      "live.text.error.empty": "Gib vor dem Absenden eine Antwort ein.",
      "live.text.error.length": "Verwende höchstens {limit} Zeichen.",
      "live.text.error.characters": "Entferne nicht unterstützte Steuerzeichen aus deiner Antwort.",
      "live.text.approvedResults": "Freigegebene Antworten",
      "live.text.approvedRespondents": "{count} Teilnehmende mit freigegebener Antwort",
      "live.text.publicThreshold":
        "Freigegebene Antworten erscheinen nach der Ergebnisfreigabe, sobald die Antworten von mindestens fünf Teilnehmenden freigegeben wurden.",
      "live.text.wordCounts": "Häufigkeiten in der Wortwolke",
      "live.text.term": "Wort oder Formulierung",
      "live.text.count": "Anzahl",
      "live.text.loading": "Antworten werden geladen…",
      "live.text.refresh": "Antworten aktualisieren",
      "live.text.previousPage": "Vorherige Seite",
      "live.text.nextPage": "Nächste Seite",
      "live.text.connectionRequired": "Verbinde dich erneut, um die Antworten zu aktualisieren.",
      "live.text.scope": "Fragen für die Moderation",
      "live.text.currentQuestion": "Aktuelle Frage",
      "live.text.allQuestions": "Alle Fragen",
      "live.text.earlierQuestion": "Frühere Frage",
      "live.text.moderation": "Moderation der Textantworten",
      "live.text.moderationHelp":
        "Prüfe Textantworten, bevor du sie für die öffentlichen Ergebnisse freigibst. Das Entfernen ist für diese Sitzung endgültig.",
      "live.text.moderationClosed":
        "Diese Sitzung ist beendet. Textantworten können nicht mehr moderiert werden.",
      "live.text.filter": "Filter für die Antwortmoderation",
      "live.text.status.pending": "Ausstehend",
      "live.text.status.approved": "Freigegeben",
      "live.text.status.removed": "Entfernt",
      "live.text.emptyQueue": "Keine Antworten in dieser Ansicht.",
      "live.text.removedBody": "Entfernte Antwort",
      "live.text.approve": "Antwort freigeben",
      "live.text.remove": "Antwort entfernen",
      "live.text.participant": "Teilnehmende Person",
      "live.text.roomCapacity":
        "Runden mit Freitext- oder Wortwolkenumfragen unterstützen bis zu {limit} Teilnehmende.",
    },
  },
  "es-ES": {
    authoring: {
      "delivery.builder.type.open_text": "Texto libre",
      "delivery.builder.type.word_cloud": "Nube de palabras",
      "delivery.builder.textResponseHelp":
        "Los participantes envían texto sin formato de hasta {limit} caracteres. Las respuestas esperan la aprobación de la persona facilitadora. Esta pregunta de opinión no se puntúa.",
      "delivery.builder.textQuestionLimit":
        "Usa hasta {limit} preguntas de texto libre o nube de palabras en un Round. Reparte las preguntas adicionales en otro Round.",
      "delivery.builder.textLiveOnly":
        "Las encuestas moderadas de texto libre y nube de palabras solo están disponibles en Rounds en directo por ahora.",
    },
    live: {
      "live.text.responseLabel": "Tu respuesta",
      "live.text.phraseLabel": "Una palabra o frase breve",
      "live.text.characterLimit": "{count} de {limit} caracteres",
      "live.text.reviewPrivacy":
        "Tu respuesta se envía a la persona facilitadora para su revisión. Solo las respuestas aprobadas pueden aparecer públicamente después de mostrar los resultados. No incluyas información privada.",
      "live.text.receiptPending":
        "Respuesta guardada y pendiente de revisión por la persona facilitadora.",
      "live.text.receiptApproved": "Respuesta guardada y aprobada.",
      "live.text.receiptRemoved":
        "Respuesta guardada. La persona facilitadora la ha eliminado de los resultados públicos.",
      "live.text.error.empty": "Escribe una respuesta antes de enviarla.",
      "live.text.error.length": "Usa hasta {limit} caracteres.",
      "live.text.error.characters":
        "Elimina los caracteres de control no compatibles de tu respuesta.",
      "live.text.approvedResults": "Respuestas aprobadas",
      "live.text.approvedRespondents": "{count} participantes con respuestas aprobadas",
      "live.text.publicThreshold":
        "Las respuestas aprobadas aparecen después de mostrar los resultados, cuando al menos cinco participantes tienen una respuesta aprobada.",
      "live.text.wordCounts": "Frecuencias de la nube de palabras",
      "live.text.term": "Palabra o frase",
      "live.text.count": "Cantidad",
      "live.text.loading": "Cargando respuestas…",
      "live.text.refresh": "Actualizar respuestas",
      "live.text.previousPage": "Página anterior",
      "live.text.nextPage": "Página siguiente",
      "live.text.connectionRequired": "Vuelve a conectarte para actualizar las respuestas.",
      "live.text.scope": "Preguntas que se van a moderar",
      "live.text.currentQuestion": "Pregunta actual",
      "live.text.allQuestions": "Todas las preguntas",
      "live.text.earlierQuestion": "Pregunta anterior",
      "live.text.moderation": "Moderación de respuestas de texto",
      "live.text.moderationHelp":
        "Revisa las respuestas de texto sin formato antes de aprobarlas para los resultados públicos. La eliminación es permanente para esta sesión.",
      "live.text.moderationClosed":
        "Esta sesión ha terminado. Ya no se pueden moderar las respuestas de texto.",
      "live.text.filter": "Filtro de moderación de respuestas",
      "live.text.status.pending": "Pendiente",
      "live.text.status.approved": "Aprobada",
      "live.text.status.removed": "Eliminada",
      "live.text.emptyQueue": "No hay respuestas en esta vista.",
      "live.text.removedBody": "Respuesta eliminada",
      "live.text.approve": "Aprobar respuesta",
      "live.text.remove": "Eliminar respuesta",
      "live.text.participant": "Participante",
      "live.text.roomCapacity":
        "Los Rounds con encuestas de texto libre o nube de palabras admiten hasta {limit} participantes.",
    },
  },
  "fr-FR": {
    authoring: {
      "delivery.builder.type.open_text": "Texte libre",
      "delivery.builder.type.word_cloud": "Nuage de mots",
      "delivery.builder.textResponseHelp":
        "Les participants envoient du texte brut de {limit} caractères maximum. Les réponses attendent l’approbation de la personne qui anime la séance. Cette question d’opinion n’est pas notée.",
      "delivery.builder.textQuestionLimit":
        "Utilisez jusqu’à {limit} questions de texte libre ou de nuage de mots dans un Round. Placez les questions supplémentaires dans un autre Round.",
      "delivery.builder.textLiveOnly":
        "Les sondages modérés de texte libre et de nuage de mots sont actuellement disponibles uniquement dans les Rounds en direct.",
    },
    live: {
      "live.text.responseLabel": "Votre réponse",
      "live.text.phraseLabel": "Un mot ou une courte expression",
      "live.text.characterLimit": "{count} caractères sur {limit}",
      "live.text.reviewPrivacy":
        "Votre réponse est transmise à la personne qui anime la séance pour examen. Seules les réponses approuvées peuvent apparaître publiquement après la révélation des résultats. N’incluez pas d’informations privées.",
      "live.text.receiptPending":
        "Réponse enregistrée, en attente d’examen par la personne qui anime la séance.",
      "live.text.receiptApproved": "Réponse enregistrée et approuvée.",
      "live.text.receiptRemoved":
        "Réponse enregistrée. La personne qui anime la séance l’a retirée des résultats publics.",
      "live.text.error.empty": "Saisissez une réponse avant de l’envoyer.",
      "live.text.error.length": "Utilisez {limit} caractères maximum.",
      "live.text.error.characters":
        "Retirez les caractères de contrôle non pris en charge de votre réponse.",
      "live.text.approvedResults": "Réponses approuvées",
      "live.text.approvedRespondents": "{count} participants dont la réponse est approuvée",
      "live.text.publicThreshold":
        "Les réponses approuvées s’affichent après la révélation des résultats, à partir de cinq participants dont la réponse est approuvée.",
      "live.text.wordCounts": "Fréquences du nuage de mots",
      "live.text.term": "Mot ou expression",
      "live.text.count": "Nombre",
      "live.text.loading": "Chargement des réponses…",
      "live.text.refresh": "Actualiser les réponses",
      "live.text.previousPage": "Page précédente",
      "live.text.nextPage": "Page suivante",
      "live.text.connectionRequired": "Reconnectez-vous pour actualiser les réponses.",
      "live.text.scope": "Questions à modérer",
      "live.text.currentQuestion": "Question actuelle",
      "live.text.allQuestions": "Toutes les questions",
      "live.text.earlierQuestion": "Question précédente",
      "live.text.moderation": "Modération des réponses textuelles",
      "live.text.moderationHelp":
        "Examinez les réponses textuelles avant de les approuver pour les résultats publics. Tout retrait est définitif pour cette séance.",
      "live.text.moderationClosed":
        "Cette séance est terminée. Les réponses textuelles ne peuvent plus être modérées.",
      "live.text.filter": "Filtre de modération des réponses",
      "live.text.status.pending": "En attente",
      "live.text.status.approved": "Approuvée",
      "live.text.status.removed": "Retirée",
      "live.text.emptyQueue": "Aucune réponse dans cette vue.",
      "live.text.removedBody": "Réponse retirée",
      "live.text.approve": "Approuver la réponse",
      "live.text.remove": "Retirer la réponse",
      "live.text.participant": "Participant",
      "live.text.roomCapacity":
        "Les Rounds contenant des sondages de texte libre ou de nuage de mots accueillent jusqu’à {limit} participants.",
    },
  },
  "it-IT": {
    authoring: {
      "delivery.builder.type.open_text": "Testo libero",
      "delivery.builder.type.word_cloud": "Nuvola di parole",
      "delivery.builder.textResponseHelp":
        "I partecipanti inviano testo senza formattazione fino a {limit} caratteri. Le risposte attendono l’approvazione di chi conduce la sessione. Questa domanda di opinione non assegna punti.",
      "delivery.builder.textQuestionLimit":
        "Usa fino a {limit} domande di testo libero o nuvola di parole in un Round. Inserisci le domande aggiuntive in un altro Round.",
      "delivery.builder.textLiveOnly":
        "I sondaggi moderati di testo libero e nuvola di parole sono attualmente disponibili solo nei Round dal vivo.",
    },
    live: {
      "live.text.responseLabel": "La tua risposta",
      "live.text.phraseLabel": "Una parola o una breve espressione",
      "live.text.characterLimit": "{count} caratteri su {limit}",
      "live.text.reviewPrivacy":
        "La tua risposta viene inviata a chi conduce la sessione per la revisione. Solo le risposte approvate possono apparire pubblicamente dopo la visualizzazione dei risultati. Non includere informazioni private.",
      "live.text.receiptPending":
        "Risposta salvata, in attesa della revisione di chi conduce la sessione.",
      "live.text.receiptApproved": "Risposta salvata e approvata.",
      "live.text.receiptRemoved":
        "Risposta salvata. Chi conduce la sessione l’ha rimossa dai risultati pubblici.",
      "live.text.error.empty": "Inserisci una risposta prima di inviarla.",
      "live.text.error.length": "Usa fino a {limit} caratteri.",
      "live.text.error.characters":
        "Rimuovi dalla risposta i caratteri di controllo non supportati.",
      "live.text.approvedResults": "Risposte approvate",
      "live.text.approvedRespondents": "{count} partecipanti con risposte approvate",
      "live.text.publicThreshold":
        "Le risposte approvate compaiono dopo la visualizzazione dei risultati, quando almeno cinque partecipanti hanno una risposta approvata.",
      "live.text.wordCounts": "Frequenze della nuvola di parole",
      "live.text.term": "Parola o espressione",
      "live.text.count": "Numero",
      "live.text.loading": "Caricamento delle risposte…",
      "live.text.refresh": "Aggiorna risposte",
      "live.text.previousPage": "Pagina precedente",
      "live.text.nextPage": "Pagina successiva",
      "live.text.connectionRequired": "Riconnettiti per aggiornare le risposte.",
      "live.text.scope": "Domande da moderare",
      "live.text.currentQuestion": "Domanda attuale",
      "live.text.allQuestions": "Tutte le domande",
      "live.text.earlierQuestion": "Domanda precedente",
      "live.text.moderation": "Moderazione delle risposte di testo",
      "live.text.moderationHelp":
        "Esamina le risposte di testo prima di approvarle per i risultati pubblici. La rimozione è definitiva per questa sessione.",
      "live.text.moderationClosed":
        "Questa sessione è terminata. Non è più possibile moderare le risposte di testo.",
      "live.text.filter": "Filtro per la moderazione delle risposte",
      "live.text.status.pending": "In attesa",
      "live.text.status.approved": "Approvata",
      "live.text.status.removed": "Rimossa",
      "live.text.emptyQueue": "Nessuna risposta in questa vista.",
      "live.text.removedBody": "Risposta rimossa",
      "live.text.approve": "Approva risposta",
      "live.text.remove": "Rimuovi risposta",
      "live.text.participant": "Partecipante",
      "live.text.roomCapacity":
        "I Round con sondaggi di testo libero o nuvola di parole supportano fino a {limit} partecipanti.",
    },
  },
  "ja-JP": {
    authoring: {
      "delivery.builder.type.open_text": "自由記述",
      "delivery.builder.type.word_cloud": "ワードクラウド",
      "delivery.builder.textResponseHelp":
        "参加者は最大 {limit} 文字のテキストを送信します。回答は進行役の承認を待ちます。意見を集める質問のため、採点は行いません。",
      "delivery.builder.textQuestionLimit":
        "1つの Round に自由記述またはワードクラウドの質問を最大 {limit} 問まで追加できます。それ以上の質問は別の Round に分けてください。",
      "delivery.builder.textLiveOnly":
        "進行役が確認する自由記述とワードクラウドの投票は、現在ライブ Round のみで利用できます。",
    },
    live: {
      "live.text.responseLabel": "あなたの回答",
      "live.text.phraseLabel": "単語または短い表現",
      "live.text.characterLimit": "{limit} 文字中 {count} 文字",
      "live.text.reviewPrivacy":
        "回答は進行役に送られ、確認されます。承認された回答のみ、結果の公開後に全員に表示されることがあります。個人情報や非公開の情報は含めないでください。",
      "live.text.receiptPending": "回答を保存しました。進行役の確認を待っています。",
      "live.text.receiptApproved": "回答が保存され、承認されました。",
      "live.text.receiptRemoved": "回答を保存しました。進行役が公開結果から削除しました。",
      "live.text.error.empty": "送信する前に回答を入力してください。",
      "live.text.error.length": "{limit} 文字以内で入力してください。",
      "live.text.error.characters": "回答から未対応の制御文字を削除してください。",
      "live.text.approvedResults": "承認済みの回答",
      "live.text.approvedRespondents": "{count} 人の回答を承認済み",
      "live.text.publicThreshold":
        "結果の公開後、5人以上の回答が承認されると、承認済みの回答が表示されます。",
      "live.text.wordCounts": "ワードクラウドの出現回数",
      "live.text.term": "単語または表現",
      "live.text.count": "回数",
      "live.text.loading": "回答を読み込み中…",
      "live.text.refresh": "回答を更新",
      "live.text.previousPage": "前のページ",
      "live.text.nextPage": "次のページ",
      "live.text.connectionRequired": "回答を更新するには再接続してください。",
      "live.text.scope": "回答を確認する質問の範囲",
      "live.text.currentQuestion": "現在の質問",
      "live.text.allQuestions": "すべての質問",
      "live.text.earlierQuestion": "前の質問",
      "live.text.moderation": "テキスト回答の確認",
      "live.text.moderationHelp":
        "公開結果への掲載を承認する前に、テキスト回答を確認してください。このセッションでの削除は取り消せません。",
      "live.text.moderationClosed":
        "このセッションは終了しました。テキスト回答の確認や承認、削除はできません。",
      "live.text.filter": "回答の確認状況で絞り込み",
      "live.text.status.pending": "確認待ち",
      "live.text.status.approved": "承認済み",
      "live.text.status.removed": "削除済み",
      "live.text.emptyQueue": "この表示に該当する回答はありません。",
      "live.text.removedBody": "削除された回答",
      "live.text.approve": "回答を承認",
      "live.text.remove": "回答を削除",
      "live.text.participant": "参加者",
      "live.text.roomCapacity":
        "自由記述またはワードクラウドの投票を含む Round には、最大 {limit} 人が参加できます。",
    },
  },
  "ko-KR": {
    authoring: {
      "delivery.builder.type.open_text": "자유 서술",
      "delivery.builder.type.word_cloud": "워드 클라우드",
      "delivery.builder.textResponseHelp":
        "참여자는 최대 {limit}자의 일반 텍스트를 제출합니다. 응답은 진행자의 승인을 기다립니다. 이 의견 질문에는 점수가 부여되지 않습니다.",
      "delivery.builder.textQuestionLimit":
        "하나의 Round에 자유 서술 또는 워드 클라우드 질문을 최대 {limit}개까지 추가할 수 있습니다. 추가 질문은 다른 Round로 나누세요.",
      "delivery.builder.textLiveOnly":
        "검토가 필요한 자유 서술 및 워드 클라우드 투표는 현재 라이브 Round에서만 지원합니다.",
    },
    live: {
      "live.text.responseLabel": "내 응답",
      "live.text.phraseLabel": "단어 또는 짧은 문구",
      "live.text.characterLimit": "{limit}자 중 {count}자",
      "live.text.reviewPrivacy":
        "응답은 진행자에게 전달되어 검토됩니다. 승인된 응답만 결과 공개 후 공개적으로 표시될 수 있습니다. 개인 정보나 비공개 정보는 포함하지 마세요.",
      "live.text.receiptPending": "응답이 저장되었으며 진행자의 검토를 기다리고 있습니다.",
      "live.text.receiptApproved": "응답이 저장되고 승인되었습니다.",
      "live.text.receiptRemoved":
        "응답이 저장되었습니다. 진행자가 공개 결과에서 이 응답을 삭제했습니다.",
      "live.text.error.empty": "제출하기 전에 응답을 입력하세요.",
      "live.text.error.length": "최대 {limit}자까지 입력할 수 있습니다.",
      "live.text.error.characters": "응답에서 지원하지 않는 제어 문자를 제거하세요.",
      "live.text.approvedResults": "승인된 응답",
      "live.text.approvedRespondents": "응답이 승인된 참여자 {count}명",
      "live.text.publicThreshold":
        "결과 공개 후, 응답이 승인된 참여자가 5명 이상이면 승인된 응답이 표시됩니다.",
      "live.text.wordCounts": "워드 클라우드 빈도",
      "live.text.term": "단어 또는 문구",
      "live.text.count": "횟수",
      "live.text.loading": "응답을 불러오는 중…",
      "live.text.refresh": "응답 새로고침",
      "live.text.previousPage": "이전 페이지",
      "live.text.nextPage": "다음 페이지",
      "live.text.connectionRequired": "응답을 새로고침하려면 다시 연결하세요.",
      "live.text.scope": "응답을 검토할 질문 범위",
      "live.text.currentQuestion": "현재 질문",
      "live.text.allQuestions": "모든 질문",
      "live.text.earlierQuestion": "이전 질문",
      "live.text.moderation": "텍스트 응답 검토",
      "live.text.moderationHelp":
        "텍스트 응답을 검토한 후 공개 결과에 표시하도록 승인하세요. 삭제한 응답은 이 세션에서 복구할 수 없습니다.",
      "live.text.moderationClosed":
        "이 세션은 종료되었습니다. 더 이상 텍스트 응답을 검토하거나 승인·삭제할 수 없습니다.",
      "live.text.filter": "응답 검토 상태 필터",
      "live.text.status.pending": "검토 대기",
      "live.text.status.approved": "승인됨",
      "live.text.status.removed": "삭제됨",
      "live.text.emptyQueue": "이 보기에 해당하는 응답이 없습니다.",
      "live.text.removedBody": "삭제된 응답",
      "live.text.approve": "응답 승인",
      "live.text.remove": "응답 삭제",
      "live.text.participant": "참여자",
      "live.text.roomCapacity":
        "자유 서술 또는 워드 클라우드 투표가 포함된 Round에는 최대 {limit}명이 참여할 수 있습니다.",
    },
  },
  "pt-PT": {
    authoring: {
      "delivery.builder.type.open_text": "Texto livre",
      "delivery.builder.type.word_cloud": "Nuvem de palavras",
      "delivery.builder.textResponseHelp":
        "Os participantes enviam texto sem formatação com até {limit} caracteres. As respostas aguardam a aprovação da pessoa que conduz a sessão. Esta pergunta de opinião não atribui pontos.",
      "delivery.builder.textQuestionLimit":
        "Utilize até {limit} perguntas de texto livre ou nuvem de palavras num Round. Coloque as perguntas adicionais noutro Round.",
      "delivery.builder.textLiveOnly":
        "As sondagens moderadas de texto livre e nuvem de palavras estão atualmente disponíveis apenas em Rounds em direto.",
    },
    live: {
      "live.text.responseLabel": "A sua resposta",
      "live.text.phraseLabel": "Uma palavra ou expressão curta",
      "live.text.characterLimit": "{count} de {limit} caracteres",
      "live.text.reviewPrivacy":
        "A sua resposta é enviada à pessoa que conduz a sessão para revisão. Só as respostas aprovadas podem aparecer publicamente depois de revelar os resultados. Não inclua informações privadas.",
      "live.text.receiptPending":
        "Resposta guardada, a aguardar revisão pela pessoa que conduz a sessão.",
      "live.text.receiptApproved": "Resposta guardada e aprovada.",
      "live.text.receiptRemoved":
        "Resposta guardada. A pessoa que conduz a sessão removeu-a dos resultados públicos.",
      "live.text.error.empty": "Introduza uma resposta antes de a enviar.",
      "live.text.error.length": "Utilize até {limit} caracteres.",
      "live.text.error.characters":
        "Remova da sua resposta os caracteres de controlo não suportados.",
      "live.text.approvedResults": "Respostas aprovadas",
      "live.text.approvedRespondents": "{count} participantes com respostas aprovadas",
      "live.text.publicThreshold":
        "As respostas aprovadas aparecem depois de revelar os resultados, quando pelo menos cinco participantes têm uma resposta aprovada.",
      "live.text.wordCounts": "Frequências da nuvem de palavras",
      "live.text.term": "Palavra ou expressão",
      "live.text.count": "Contagem",
      "live.text.loading": "A carregar respostas…",
      "live.text.refresh": "Atualizar respostas",
      "live.text.previousPage": "Página anterior",
      "live.text.nextPage": "Página seguinte",
      "live.text.connectionRequired": "Volte a ligar-se para atualizar as respostas.",
      "live.text.scope": "Perguntas a moderar",
      "live.text.currentQuestion": "Pergunta atual",
      "live.text.allQuestions": "Todas as perguntas",
      "live.text.earlierQuestion": "Pergunta anterior",
      "live.text.moderation": "Moderação de respostas de texto",
      "live.text.moderationHelp":
        "Reveja as respostas de texto antes de as aprovar para os resultados públicos. A remoção é definitiva para esta sessão.",
      "live.text.moderationClosed":
        "Esta sessão terminou. Já não é possível moderar as respostas de texto.",
      "live.text.filter": "Filtro de moderação de respostas",
      "live.text.status.pending": "Pendente",
      "live.text.status.approved": "Aprovada",
      "live.text.status.removed": "Removida",
      "live.text.emptyQueue": "Não há respostas nesta vista.",
      "live.text.removedBody": "Resposta removida",
      "live.text.approve": "Aprovar resposta",
      "live.text.remove": "Remover resposta",
      "live.text.participant": "Participante",
      "live.text.roomCapacity":
        "Os Rounds com sondagens de texto livre ou nuvem de palavras permitem até {limit} participantes.",
    },
  },
  "zh-CN": {
    authoring: {
      "delivery.builder.type.open_text": "自由文本",
      "delivery.builder.type.word_cloud": "词云",
      "delivery.builder.textResponseHelp":
        "参与者可提交最多 {limit} 个字符的纯文本。回答需等待主持人批准。这道意见题不计分。",
      "delivery.builder.textQuestionLimit":
        "每个 Round 最多可包含 {limit} 道自由文本或词云题。请将更多题目分配到另一个 Round。",
      "delivery.builder.textLiveOnly": "需审核的自由文本和词云投票目前仅支持实时 Round。",
    },
    live: {
      "live.text.responseLabel": "你的回答",
      "live.text.phraseLabel": "一个词或简短短语",
      "live.text.characterLimit": "{count} / {limit} 个字符",
      "live.text.reviewPrivacy":
        "你的回答将发送给主持人审核。只有获得批准的回答，才可能在公布结果后公开显示。请勿包含个人信息或其他私人信息。",
      "live.text.receiptPending": "回答已保存，正在等待主持人审核。",
      "live.text.receiptApproved": "回答已保存并获批准。",
      "live.text.receiptRemoved": "回答已保存。主持人已将其从公开结果中移除。",
      "live.text.error.empty": "请先输入回答，再提交。",
      "live.text.error.length": "请使用最多 {limit} 个字符。",
      "live.text.error.characters": "请移除回答中不支持的控制字符。",
      "live.text.approvedResults": "已批准的回答",
      "live.text.approvedRespondents": "{count} 名参与者的回答已获批准",
      "live.text.publicThreshold":
        "公布结果后，至少有五名参与者的回答获批准时，已批准的回答才会显示。",
      "live.text.wordCounts": "词云出现次数",
      "live.text.term": "词或短语",
      "live.text.count": "次数",
      "live.text.loading": "正在加载回答…",
      "live.text.refresh": "刷新回答",
      "live.text.previousPage": "上一页",
      "live.text.nextPage": "下一页",
      "live.text.connectionRequired": "请重新连接以刷新回答。",
      "live.text.scope": "回答审核范围",
      "live.text.currentQuestion": "当前题目",
      "live.text.allQuestions": "所有题目",
      "live.text.earlierQuestion": "之前的题目",
      "live.text.moderation": "文本回答审核",
      "live.text.moderationHelp":
        "请先审核文本回答，再批准其出现在公开结果中。在本场活动中，移除后无法恢复。",
      "live.text.moderationClosed": "本场活动已结束，无法再审核文本回答。",
      "live.text.filter": "按回答审核状态筛选",
      "live.text.status.pending": "待审核",
      "live.text.status.approved": "已批准",
      "live.text.status.removed": "已移除",
      "live.text.emptyQueue": "此视图中没有回答。",
      "live.text.removedBody": "已移除的回答",
      "live.text.approve": "批准回答",
      "live.text.remove": "移除回答",
      "live.text.participant": "参与者",
      "live.text.roomCapacity": "包含自由文本或词云投票的 Round 最多支持 {limit} 名参与者。",
    },
  },
  "zh-TW": {
    authoring: {
      "delivery.builder.type.open_text": "自由文字",
      "delivery.builder.type.word_cloud": "文字雲",
      "delivery.builder.textResponseHelp":
        "參與者可提交最多 {limit} 個字元的純文字。回答需等待主持人核准。這道意見題不計分。",
      "delivery.builder.textQuestionLimit":
        "每個 Round 最多可包含 {limit} 道自由文字或文字雲題。請將更多題目安排到另一個 Round。",
      "delivery.builder.textLiveOnly": "需要審核的自由文字和文字雲投票，目前僅支援即時 Round。",
    },
    live: {
      "live.text.responseLabel": "你的回答",
      "live.text.phraseLabel": "一個詞或簡短片語",
      "live.text.characterLimit": "{count} / {limit} 個字元",
      "live.text.reviewPrivacy":
        "你的回答會傳送給主持人審核。只有核准的回答，才可能在公布結果後公開顯示。請勿包含個人資料或其他私人資訊。",
      "live.text.receiptPending": "回答已儲存，正在等待主持人審核。",
      "live.text.receiptApproved": "回答已儲存並核准。",
      "live.text.receiptRemoved": "回答已儲存。主持人已將其從公開結果中移除。",
      "live.text.error.empty": "請先輸入回答，再提交。",
      "live.text.error.length": "請使用最多 {limit} 個字元。",
      "live.text.error.characters": "請移除回答中不支援的控制字元。",
      "live.text.approvedResults": "已核准的回答",
      "live.text.approvedRespondents": "{count} 名參與者的回答已核准",
      "live.text.publicThreshold":
        "公布結果後，至少有五名參與者的回答獲得核准時，才會顯示已核准的回答。",
      "live.text.wordCounts": "文字雲出現次數",
      "live.text.term": "詞或片語",
      "live.text.count": "次數",
      "live.text.loading": "正在載入回答…",
      "live.text.refresh": "重新整理回答",
      "live.text.previousPage": "上一頁",
      "live.text.nextPage": "下一頁",
      "live.text.connectionRequired": "請重新連線以更新回答。",
      "live.text.scope": "回答審核範圍",
      "live.text.currentQuestion": "目前的題目",
      "live.text.allQuestions": "所有題目",
      "live.text.earlierQuestion": "先前的題目",
      "live.text.moderation": "文字回答審核",
      "live.text.moderationHelp":
        "請先審核文字回答，再核准其顯示於公開結果中。在這個場次中，移除後無法恢復。",
      "live.text.moderationClosed": "這個場次已結束，無法再審核文字回答。",
      "live.text.filter": "依回答審核狀態篩選",
      "live.text.status.pending": "待審核",
      "live.text.status.approved": "已核准",
      "live.text.status.removed": "已移除",
      "live.text.emptyQueue": "此檢視中沒有回答。",
      "live.text.removedBody": "已移除的回答",
      "live.text.approve": "核准回答",
      "live.text.remove": "移除回答",
      "live.text.participant": "參與者",
      "live.text.roomCapacity": "包含自由文字或文字雲投票的 Round 最多支援 {limit} 名參與者。",
    },
  },
} satisfies Record<
  TextPollTranslationLocale,
  {
    authoring: TextPollAuthoringTranslation;
    live: TextPollLiveTranslation;
  }
>;
