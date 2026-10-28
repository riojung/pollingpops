import type { SupportedLocale } from "@openround/contracts";

interface SubmissionCopy {
  unsaved: string;
  submitToSave: string;
  chooseResponse: string;
  closed: string;
  autoChooseAnswer: string;
  saved: string;
}

export const participantSubmissionCopy: Record<SupportedLocale, SubmissionCopy> = {
  "en-CA": {
    autoChooseAnswer: "Choose your answer to save it automatically.",
    saved: "Answer received and saved.",
    unsaved: "Selection not submitted yet",
    submitToSave: "Select Submit response to save your answer.",
    chooseResponse: "Choose your response, then submit it to save it.",
    closed: "No response was saved before this question closed.",
  },
  "fr-FR": {
    autoChooseAnswer: "Choisissez votre réponse pour l’enregistrer automatiquement.",
    saved: "Réponse reçue et enregistrée.",
    unsaved: "Sélection pas encore envoyée",
    submitToSave: "Sélectionnez Envoyer la réponse pour enregistrer votre réponse.",
    chooseResponse: "Choisissez votre réponse, puis envoyez-la pour l’enregistrer.",
    closed: "Aucune réponse n’a été enregistrée avant la fermeture de cette question.",
  },
  "de-DE": {
    autoChooseAnswer: "Wählen Sie Ihre Antwort, um sie automatisch zu speichern.",
    saved: "Antwort erhalten und gespeichert.",
    unsaved: "Auswahl noch nicht gesendet",
    submitToSave: "Wählen Sie Antwort senden, um Ihre Antwort zu speichern.",
    chooseResponse: "Wählen Sie Ihre Antwort und senden Sie sie zum Speichern ab.",
    closed: "Vor dem Schließen dieser Frage wurde keine Antwort gespeichert.",
  },
  "es-ES": {
    autoChooseAnswer: "Elige tu respuesta para guardarla automáticamente.",
    saved: "Respuesta recibida y guardada.",
    unsaved: "Selección aún no enviada",
    submitToSave: "Selecciona Enviar respuesta para guardar tu respuesta.",
    chooseResponse: "Elige tu respuesta y envíala para guardarla.",
    closed: "No se guardó ninguna respuesta antes de que se cerrara esta pregunta.",
  },
  "it-IT": {
    autoChooseAnswer: "Scegli la risposta per salvarla automaticamente.",
    saved: "Risposta ricevuta e salvata.",
    unsaved: "Selezione non ancora inviata",
    submitToSave: "Seleziona Invia risposta per salvare la tua risposta.",
    chooseResponse: "Scegli la tua risposta, poi inviala per salvarla.",
    closed: "Nessuna risposta è stata salvata prima della chiusura di questa domanda.",
  },
  "pt-PT": {
    autoChooseAnswer: "Escolha a resposta para a guardar automaticamente.",
    saved: "Resposta recebida e guardada.",
    unsaved: "Seleção ainda não enviada",
    submitToSave: "Selecione Enviar resposta para guardar a sua resposta.",
    chooseResponse: "Escolha a sua resposta e envie-a para a guardar.",
    closed: "Não foi guardada nenhuma resposta antes de esta pergunta fechar.",
  },
  "ko-KR": {
    autoChooseAnswer: "답변을 선택하면 자동으로 저장됩니다.",
    saved: "답변이 접수되어 저장되었습니다.",
    unsaved: "아직 제출하지 않은 선택입니다",
    submitToSave: "답변 제출을 눌러 답변을 저장하세요.",
    chooseResponse: "답변을 선택한 다음 제출하여 저장하세요.",
    closed: "이 질문이 마감되기 전에 저장된 답변이 없습니다.",
  },
  "ja-JP": {
    autoChooseAnswer: "回答を選択すると自動保存されます。",
    saved: "回答を受信して保存しました。",
    unsaved: "選択した回答はまだ送信されていません",
    submitToSave: "回答を送信を選択して回答を保存してください。",
    chooseResponse: "回答を選択し、送信して保存してください。",
    closed: "この質問が締め切られる前に保存された回答はありません。",
  },
  "zh-CN": {
    autoChooseAnswer: "选择答案后自动保存。",
    saved: "回答已收到并保存。",
    unsaved: "所选答案尚未提交",
    submitToSave: "选择“提交回答”以保存答案。",
    chooseResponse: "选择答案后提交，才能保存。",
    closed: "此问题截止前没有保存的回答。",
  },
  "zh-TW": {
    autoChooseAnswer: "選擇答案後自動儲存。",
    saved: "回答已收到並儲存。",
    unsaved: "所選答案尚未提交",
    submitToSave: "選擇「提交回答」以儲存答案。",
    chooseResponse: "選擇答案後提交，才能儲存。",
    closed: "此問題截止前沒有儲存的回答。",
  },
};
