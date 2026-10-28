import type { SupportedLocale } from "@openround/contracts";

interface ConfidenceControlCopy {
  label: string;
  shortLabel: string;
  off: string;
  on: string;
  help: string;
  inherited: string;
  participantLegend: string;
  participantHelp: string;
  autoOptional: string;
}

export const confidenceControlCopy: Record<SupportedLocale, ConfidenceControlCopy> = {
  "en-CA": {
    shortLabel: "Confidence",
    off: "Off",
    on: "On (optional)",
    label: "Ask for confidence (optional)",
    help: "Participants can skip it. Confidence does not affect scores.",
    inherited:
      "This round currently uses each question’s setting. Choose on or off to apply it to the round.",
    participantLegend: "How sure are you? (Optional)",
    participantHelp: "You can answer without choosing a confidence level.",
    autoOptional:
      "Confidence is optional. Choose it first if you want to include it, then choose your answer to save automatically.",
  },
  "fr-FR": {
    shortLabel: "Confiance",
    off: "Désactivé",
    on: "Activé (facultatif)",
    label: "Demander le niveau de confiance (facultatif)",
    help: "Les participants peuvent passer cette étape. La confiance n’a aucun effet sur les scores.",
    inherited:
      "Ce Round utilise actuellement le réglage de chaque question. Activez ou désactivez cette option pour tout le Round.",
    participantLegend: "Êtes-vous sûr de votre réponse ? (Facultatif)",
    participantHelp: "Vous pouvez répondre sans choisir de niveau de confiance.",
    autoOptional:
      "La confiance est facultative. Choisissez-la d’abord si vous souhaitez l’inclure, puis choisissez votre réponse pour l’enregistrer automatiquement.",
  },
  "de-DE": {
    shortLabel: "Sicherheit",
    off: "Aus",
    on: "Ein (optional)",
    label: "Sicherheit abfragen (optional)",
    help: "Teilnehmende können dies überspringen. Die Sicherheit beeinflusst die Punktzahl nicht.",
    inherited:
      "Diese Runde verwendet derzeit die Einstellung jeder Frage. Schalten Sie diese Option für die gesamte Runde ein oder aus.",
    participantLegend: "Wie sicher sind Sie? (Optional)",
    participantHelp: "Sie können antworten, ohne eine Sicherheit auszuwählen.",
    autoOptional:
      "Die Sicherheit ist optional. Wählen Sie sie zuerst, wenn Sie sie angeben möchten, und dann Ihre Antwort, um automatisch zu speichern.",
  },
  "es-ES": {
    shortLabel: "Confianza",
    off: "Desactivado",
    on: "Activado (opcional)",
    label: "Preguntar el nivel de confianza (opcional)",
    help: "Los participantes pueden omitirlo. La confianza no afecta a la puntuación.",
    inherited:
      "Esta ronda utiliza la configuración de cada pregunta. Activa o desactiva esta opción para toda la ronda.",
    participantLegend: "¿Qué seguridad tienes? (Opcional)",
    participantHelp: "Puedes responder sin elegir un nivel de confianza.",
    autoOptional:
      "La confianza es opcional. Elígela primero si quieres incluirla y después elige tu respuesta para guardarla automáticamente.",
  },
  "it-IT": {
    shortLabel: "Sicurezza",
    off: "Disattivato",
    on: "Attivato (facoltativo)",
    label: "Chiedi il livello di sicurezza (facoltativo)",
    help: "I partecipanti possono saltarlo. La sicurezza non influisce sul punteggio.",
    inherited:
      "Questo Round usa l’impostazione di ogni domanda. Attiva o disattiva questa opzione per l’intero Round.",
    participantLegend: "Quanto sei sicuro? (Facoltativo)",
    participantHelp: "Puoi rispondere senza scegliere un livello di sicurezza.",
    autoOptional:
      "La sicurezza è facoltativa. Sceglila prima se vuoi includerla, poi scegli la risposta per salvarla automaticamente.",
  },
  "pt-PT": {
    shortLabel: "Confiança",
    off: "Desativado",
    on: "Ativado (opcional)",
    label: "Pedir o nível de confiança (opcional)",
    help: "Os participantes podem ignorá-lo. A confiança não afeta a pontuação.",
    inherited:
      "Esta ronda usa a definição de cada pergunta. Ative ou desative esta opção para toda a ronda.",
    participantLegend: "Qual é o seu grau de certeza? (Opcional)",
    participantHelp: "Pode responder sem escolher um nível de confiança.",
    autoOptional:
      "A confiança é opcional. Escolha-a primeiro se a quiser incluir e depois escolha a resposta para a guardar automaticamente.",
  },
  "ko-KR": {
    shortLabel: "확신 정도",
    off: "끄기",
    on: "켜기 (선택 사항)",
    label: "확신 정도 묻기 (선택 사항)",
    help: "참가자는 건너뛸 수 있습니다. 확신 정도는 점수에 영향을 주지 않습니다.",
    inherited: "현재 각 질문의 설정을 사용합니다. 라운드 전체에 적용하려면 켜거나 끄세요.",
    participantLegend: "얼마나 확신하나요? (선택 사항)",
    participantHelp: "확신 정도를 선택하지 않아도 답변할 수 있습니다.",
    autoOptional:
      "확신 정도는 선택 사항입니다. 함께 제출하려면 먼저 확신 정도를 선택한 다음 답변을 선택하세요. 답변은 자동으로 저장됩니다.",
  },
  "ja-JP": {
    shortLabel: "確信度",
    off: "オフ",
    on: "オン（任意）",
    label: "確信度を尋ねる（任意）",
    help: "参加者はスキップできます。確信度はスコアに影響しません。",
    inherited:
      "現在は各質問の設定を使用しています。ラウンド全体に適用するにはオンまたはオフを選んでください。",
    participantLegend: "どのくらい確信がありますか？（任意）",
    participantHelp: "確信度を選ばずに回答できます。",
    autoOptional:
      "確信度は任意です。含めたい場合は先に確信度を選び、次に回答を選ぶと自動保存されます。",
  },
  "zh-CN": {
    shortLabel: "信心程度",
    off: "关闭",
    on: "开启（可选）",
    label: "询问信心程度（可选）",
    help: "参与者可以跳过。信心程度不影响分数。",
    inherited: "本轮目前使用各个问题的设置。选择开启或关闭以应用于整个回合。",
    participantLegend: "您有多大把握？（可选）",
    participantHelp: "您可以不选择信心程度，直接回答。",
    autoOptional: "信心程度是可选的。如需提交，请先选择信心程度，再选择答案以自动保存。",
  },
  "zh-TW": {
    shortLabel: "信心程度",
    off: "關閉",
    on: "開啟（選填）",
    label: "詢問信心程度（選填）",
    help: "參與者可以跳過。信心程度不影響分數。",
    inherited: "本輪目前使用各個問題的設定。選擇開啟或關閉以套用至整個回合。",
    participantLegend: "您有多大把握？（選填）",
    participantHelp: "您可以不選擇信心程度，直接回答。",
    autoOptional: "信心程度是選填的。如需提交，請先選擇信心程度，再選擇答案以自動儲存。",
  },
};
