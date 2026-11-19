import type { SupportedLocale } from "@openround/contracts";

const english = {
  pageProgress: "Page {page} of {count}",
  untitledPage: "Page {page}",
  back: "Back",
  next: "Next",
  saving: "Saving progress…",
  saveProgress: "Save progress",
  submit: "Submit Survey",
  requiredError: "Answer the required questions on this page before continuing.",
  invalidError: "Check the responses on this page before continuing.",
  saveError: "Progress could not be confirmed. Retry the same save before continuing.",
  retrySave: "Retry same save",
  saved: "Progress saved.",
  submitted: "Your responses were submitted.",
  resumeHint:
    "Saved answers are restored. This opens the first page with an unanswered question; it may include optional questions.",
  readOnlyTitle: "Survey pages preview",
  readOnlyNotice:
    "This Survey uses ordered pages. Page authoring is not available in this editor yet. You can review the saved content.",
  updateRequired: "This Survey needs an updated reader. Reload this page to continue.",
  closed: "This Survey is closed. You can review saved answers, but cannot change or submit them.",
  questionRequired: "A response is required.",
  questionInvalid: "Select a valid response.",
  unsaved: "Unsaved responses — save progress before leaving.",
  savedAll: "Progress is saved.",
  reviewOnly: "Preview only. Responses are not sent or saved.",
} as const;

export type SurveyPagesCopy = { -readonly [Key in keyof typeof english]: string };

// Editorial preparation only; existing Preview and human/native-review gates remain in place.
const translations: Record<Exclude<SupportedLocale, "en-CA">, SurveyPagesCopy> = {
  "fr-FR": {
    pageProgress: "Page {page} sur {count}",
    untitledPage: "Page {page}",
    back: "Retour",
    next: "Suivant",
    saving: "Enregistrement de la progression…",
    saveProgress: "Enregistrer la progression",
    submit: "Envoyer l’Enquête",
    requiredError: "Répondez aux questions obligatoires de cette page avant de continuer.",
    invalidError: "Vérifiez les réponses de cette page avant de continuer.",
    saveError:
      "L’enregistrement de la progression n’a pas été confirmé. Réessayez le même enregistrement avant de continuer.",
    retrySave: "Réessayer le même enregistrement",
    saved: "Progression enregistrée.",
    submitted: "Vos réponses ont été envoyées.",
    resumeHint:
      "Les réponses enregistrées sont restaurées. La première page contenant une question sans réponse s’ouvre ; elle peut inclure des questions facultatives.",
    readOnlyTitle: "Aperçu des pages de l’Enquête",
    readOnlyNotice:
      "Cette Enquête utilise des pages ordonnées. Cet éditeur ne permet pas encore de créer des pages. Vous pouvez consulter le contenu enregistré.",
    updateRequired:
      "Cette Enquête nécessite une version plus récente du lecteur. Rechargez cette page pour continuer.",
    closed:
      "Cette Enquête est close. Vous pouvez consulter les réponses enregistrées, mais pas les modifier ni les envoyer.",
    questionRequired: "Une réponse est obligatoire.",
    questionInvalid: "Choisissez une réponse valide.",
    unsaved: "Réponses non enregistrées — enregistrez la progression avant de partir.",
    savedAll: "La progression est enregistrée.",
    reviewOnly: "Aperçu uniquement. Les réponses ne sont ni envoyées ni enregistrées.",
  },
  "de-DE": {
    pageProgress: "Seite {page} von {count}",
    untitledPage: "Seite {page}",
    back: "Zurück",
    next: "Weiter",
    saving: "Fortschritt wird gespeichert…",
    saveProgress: "Fortschritt speichern",
    submit: "Umfrage absenden",
    requiredError: "Beantworten Sie die Pflichtfragen auf dieser Seite, bevor Sie fortfahren.",
    invalidError: "Prüfen Sie die Antworten auf dieser Seite, bevor Sie fortfahren.",
    saveError:
      "Das Speichern des Fortschritts wurde nicht bestätigt. Wiederholen Sie denselben Speichervorgang, bevor Sie fortfahren.",
    retrySave: "Denselben Speichervorgang wiederholen",
    saved: "Fortschritt gespeichert.",
    submitted: "Ihre Antworten wurden abgesendet.",
    resumeHint:
      "Gespeicherte Antworten wurden wiederhergestellt. Die erste Seite mit einer unbeantworteten Frage wird geöffnet; sie kann optionale Fragen enthalten.",
    readOnlyTitle: "Vorschau der Umfrageseiten",
    readOnlyNotice:
      "Diese Umfrage verwendet geordnete Seiten. Seiten können in diesem Editor noch nicht erstellt werden. Sie können die gespeicherten Inhalte ansehen.",
    updateRequired:
      "Diese Umfrage benötigt eine aktualisierte Ansicht. Laden Sie diese Seite neu, um fortzufahren.",
    closed:
      "Diese Umfrage ist geschlossen. Sie können gespeicherte Antworten ansehen, aber weder ändern noch absenden.",
    questionRequired: "Eine Antwort ist erforderlich.",
    questionInvalid: "Wählen Sie eine gültige Antwort.",
    unsaved:
      "Ungespeicherte Antworten — speichern Sie den Fortschritt, bevor Sie die Seite verlassen.",
    savedAll: "Der Fortschritt ist gespeichert.",
    reviewOnly: "Nur Vorschau. Antworten werden weder gesendet noch gespeichert.",
  },
  "es-ES": {
    pageProgress: "Página {page} de {count}",
    untitledPage: "Página {page}",
    back: "Atrás",
    next: "Siguiente",
    saving: "Guardando progreso…",
    saveProgress: "Guardar progreso",
    submit: "Enviar Encuesta",
    requiredError: "Responde a las preguntas obligatorias de esta página antes de continuar.",
    invalidError: "Revisa las respuestas de esta página antes de continuar.",
    saveError:
      "No se ha confirmado que se haya guardado el progreso. Reintenta el mismo guardado antes de continuar.",
    retrySave: "Reintentar el mismo guardado",
    saved: "Progreso guardado.",
    submitted: "Tus respuestas se han enviado.",
    resumeHint:
      "Se han restaurado las respuestas guardadas. Se abre la primera página con una pregunta sin responder; puede incluir preguntas opcionales.",
    readOnlyTitle: "Vista previa de las páginas de la Encuesta",
    readOnlyNotice:
      "Esta Encuesta usa páginas ordenadas. Este editor aún no permite crear páginas. Puedes revisar el contenido guardado.",
    updateRequired:
      "Esta Encuesta necesita un lector actualizado. Recarga esta página para continuar.",
    closed:
      "Esta Encuesta está cerrada. Puedes revisar las respuestas guardadas, pero no cambiarlas ni enviarlas.",
    questionRequired: "La respuesta es obligatoria.",
    questionInvalid: "Selecciona una respuesta válida.",
    unsaved: "Respuestas sin guardar — guarda el progreso antes de salir.",
    savedAll: "El progreso está guardado.",
    reviewOnly: "Solo vista previa. Las respuestas no se envían ni se guardan.",
  },
  "it-IT": {
    pageProgress: "Pagina {page} di {count}",
    untitledPage: "Pagina {page}",
    back: "Indietro",
    next: "Avanti",
    saving: "Salvataggio dei progressi…",
    saveProgress: "Salva i progressi",
    submit: "Invia Sondaggio",
    requiredError: "Rispondi alle domande obbligatorie di questa pagina prima di continuare.",
    invalidError: "Controlla le risposte di questa pagina prima di continuare.",
    saveError:
      "Il salvataggio dei progressi non è stato confermato. Riprova lo stesso salvataggio prima di continuare.",
    retrySave: "Riprova lo stesso salvataggio",
    saved: "Progressi salvati.",
    submitted: "Le tue risposte sono state inviate.",
    resumeHint:
      "Le risposte salvate sono state ripristinate. Si apre la prima pagina con una domanda senza risposta; potrebbe includere domande facoltative.",
    readOnlyTitle: "Anteprima delle pagine del Sondaggio",
    readOnlyNotice:
      "Questo Sondaggio usa pagine ordinate. Questo editor non consente ancora di creare pagine. Puoi esaminare i contenuti salvati.",
    updateRequired:
      "Questo Sondaggio richiede un lettore aggiornato. Ricarica questa pagina per continuare.",
    closed:
      "Questo Sondaggio è chiuso. Puoi esaminare le risposte salvate, ma non modificarle o inviarle.",
    questionRequired: "È necessaria una risposta.",
    questionInvalid: "Seleziona una risposta valida.",
    unsaved: "Risposte non salvate — salva i progressi prima di uscire.",
    savedAll: "I progressi sono salvati.",
    reviewOnly: "Solo anteprima. Le risposte non vengono inviate né salvate.",
  },
  "pt-PT": {
    pageProgress: "Página {page} de {count}",
    untitledPage: "Página {page}",
    back: "Voltar",
    next: "Seguinte",
    saving: "A guardar o progresso…",
    saveProgress: "Guardar progresso",
    submit: "Submeter Inquérito",
    requiredError: "Responda às perguntas obrigatórias desta página antes de continuar.",
    invalidError: "Verifique as respostas desta página antes de continuar.",
    saveError:
      "Não foi possível confirmar que o progresso foi guardado. Repita a mesma gravação antes de continuar.",
    retrySave: "Repetir a mesma gravação",
    saved: "Progresso guardado.",
    submitted: "As suas respostas foram submetidas.",
    resumeHint:
      "As respostas guardadas foram restauradas. Abre-se a primeira página com uma pergunta sem resposta; pode incluir perguntas opcionais.",
    readOnlyTitle: "Pré-visualização das páginas do Inquérito",
    readOnlyNotice:
      "Este Inquérito utiliza páginas ordenadas. Este editor ainda não permite criar páginas. Pode rever o conteúdo guardado.",
    updateRequired:
      "Este Inquérito necessita de um leitor atualizado. Recarregue esta página para continuar.",
    closed:
      "Este Inquérito está fechado. Pode rever as respostas guardadas, mas não as pode alterar ou submeter.",
    questionRequired: "É obrigatória uma resposta.",
    questionInvalid: "Selecione uma resposta válida.",
    unsaved: "Respostas não guardadas — guarde o progresso antes de sair.",
    savedAll: "O progresso está guardado.",
    reviewOnly: "Apenas pré-visualização. As respostas não são enviadas nem guardadas.",
  },
  "ja-JP": {
    pageProgress: "{count}ページ中{page}ページ",
    untitledPage: "ページ{page}",
    back: "戻る",
    next: "次へ",
    saving: "進行状況を保存中…",
    saveProgress: "進行状況を保存",
    submit: "アンケートを送信",
    requiredError: "続行する前に、このページの必須の質問に回答してください。",
    invalidError: "続行する前に、このページの回答を確認してください。",
    saveError: "進行状況の保存を確認できませんでした。続行する前に同じ保存を再試行してください。",
    retrySave: "同じ保存を再試行",
    saved: "進行状況を保存しました。",
    submitted: "回答を送信しました。",
    resumeHint:
      "保存した回答を復元しました。未回答の質問がある最初のページが開きます。任意の質問が含まれる場合もあります。",
    readOnlyTitle: "アンケートのページプレビュー",
    readOnlyNotice:
      "このアンケートは順序付きのページを使用しています。このエディターではまだページを作成できません。保存済みの内容を確認できます。",
    updateRequired:
      "このアンケートを表示するには更新が必要です。続行するにはページを再読み込みしてください。",
    closed:
      "このアンケートは終了しています。保存した回答を確認できますが、変更や送信はできません。",
    questionRequired: "回答が必要です。",
    questionInvalid: "有効な回答を選択してください。",
    unsaved: "未保存の回答があります — ページを離れる前に進行状況を保存してください。",
    savedAll: "進行状況は保存されています。",
    reviewOnly: "プレビューのみです。回答は送信も保存もされません。",
  },
  "ko-KR": {
    pageProgress: "전체 {count}페이지 중 {page}페이지",
    untitledPage: "페이지 {page}",
    back: "뒤로",
    next: "다음",
    saving: "진행 상황을 저장하는 중…",
    saveProgress: "진행 상황 저장",
    submit: "설문조사 제출",
    requiredError: "계속하려면 이 페이지의 필수 질문에 답해 주세요.",
    invalidError: "계속하기 전에 이 페이지의 응답을 확인해 주세요.",
    saveError:
      "진행 상황 저장을 확인하지 못했습니다. 계속하기 전에 같은 저장을 다시 시도해 주세요.",
    retrySave: "같은 저장 다시 시도",
    saved: "진행 상황이 저장되었습니다.",
    submitted: "응답이 제출되었습니다.",
    resumeHint:
      "저장된 응답을 복원했습니다. 답하지 않은 질문이 있는 첫 페이지가 열립니다. 선택 질문이 포함될 수도 있습니다.",
    readOnlyTitle: "설문조사 페이지 미리 보기",
    readOnlyNotice:
      "이 설문조사는 순서가 정해진 페이지를 사용합니다. 이 편집기에서는 아직 페이지를 작성할 수 없습니다. 저장된 내용을 검토할 수 있습니다.",
    updateRequired:
      "이 설문조사를 보려면 최신 버전이 필요합니다. 계속하려면 페이지를 새로 고침해 주세요.",
    closed:
      "이 설문조사는 마감되었습니다. 저장된 응답을 검토할 수 있지만 변경하거나 제출할 수는 없습니다.",
    questionRequired: "응답이 필요합니다.",
    questionInvalid: "유효한 응답을 선택해 주세요.",
    unsaved: "저장하지 않은 응답이 있습니다 — 나가기 전에 진행 상황을 저장해 주세요.",
    savedAll: "진행 상황이 저장되어 있습니다.",
    reviewOnly: "미리 보기입니다. 응답은 전송되거나 저장되지 않습니다.",
  },
  "zh-CN": {
    pageProgress: "第 {page} 页，共 {count} 页",
    untitledPage: "第 {page} 页",
    back: "返回",
    next: "下一页",
    saving: "正在保存进度…",
    saveProgress: "保存进度",
    submit: "提交问卷",
    requiredError: "请回答本页的必答题后再继续。",
    invalidError: "请检查本页的回答后再继续。",
    saveError: "未能确认进度是否已保存。请重试同一次保存后再继续。",
    retrySave: "重试同一次保存",
    saved: "进度已保存。",
    submitted: "你的回答已提交。",
    resumeHint: "已恢复保存的回答。将打开首个有未答题目的页面，其中可能包含选答题。",
    readOnlyTitle: "问卷分页预览",
    readOnlyNotice: "此问卷采用有序分页。此编辑器暂不支持页面编排。你可以查看已保存的内容。",
    updateRequired: "此问卷需要更新后的阅读器。请重新加载此页面以继续。",
    closed: "此问卷已关闭。你可以查看已保存的回答，但无法更改或提交。",
    questionRequired: "此题必答。",
    questionInvalid: "请选择有效回答。",
    unsaved: "有未保存的回答 — 离开前请保存进度。",
    savedAll: "进度已保存完毕。",
    reviewOnly: "仅供预览。回答不会发送或保存。",
  },
  "zh-TW": {
    pageProgress: "第 {page} 頁，共 {count} 頁",
    untitledPage: "第 {page} 頁",
    back: "返回",
    next: "下一頁",
    saving: "正在儲存進度…",
    saveProgress: "儲存進度",
    submit: "提交問卷",
    requiredError: "請回答本頁的必答題後再繼續。",
    invalidError: "請檢查本頁的回答後再繼續。",
    saveError: "未能確認進度是否已儲存。請重試同一次儲存後再繼續。",
    retrySave: "重試同一次儲存",
    saved: "進度已儲存。",
    submitted: "你的回答已提交。",
    resumeHint: "已還原儲存的回答。將開啟首個有未答題目的頁面，其中可能包含選答題。",
    readOnlyTitle: "問卷分頁預覽",
    readOnlyNotice: "此問卷採用有序分頁。此編輯器暫不支援頁面編排。你可以檢視已儲存的內容。",
    updateRequired: "此問卷需要更新後的閱讀器。請重新載入此頁面以繼續。",
    closed: "此問卷已關閉。你可以檢視已儲存的回答，但無法變更或提交。",
    questionRequired: "此題必答。",
    questionInvalid: "請選擇有效回答。",
    unsaved: "有未儲存的回答 — 離開前請儲存進度。",
    savedAll: "進度已儲存完畢。",
    reviewOnly: "僅供預覽。回答不會傳送或儲存。",
  },
};

export function surveyPagesCopy(locale: SupportedLocale = "en-CA"): SurveyPagesCopy {
  const copy =
    locale !== "en-CA" && Object.hasOwn(translations, locale) ? translations[locale] : english;
  return { ...copy };
}

/** Exact visible string templates for source-bound native-review packets. */
export function surveyPagesCopyEntries(locale: SupportedLocale = "en-CA"): Record<string, string> {
  return { ...surveyPagesCopy(locale) };
}
