import type { SupportedLocale } from "@openround/contracts";

const english = {
  readOnly:
    "Review all pages and their visibility rules. Editing, copying and sharing conditional Surveys are not available yet.",
  condition: "Shown when this answer is selected",
  always: "Always shown",
};
// Editorial drafts; native-language acceptance remains a separate release gate.
const entries: Record<SupportedLocale, typeof english> = {
  "en-CA": english,
  "fr-FR": {
    readOnly:
      "Consultez toutes les pages et leurs règles de visibilité. La modification, la copie et le partage des Enquêtes conditionnelles ne sont pas encore disponibles.",
    condition: "Affichée lorsque cette réponse est sélectionnée",
    always: "Toujours affichée",
  },
  "de-DE": {
    readOnly:
      "Prüfen Sie alle Seiten und ihre Sichtbarkeitsregeln. Bedingte Umfragen können noch nicht bearbeitet, kopiert oder geteilt werden.",
    condition: "Wird angezeigt, wenn diese Antwort ausgewählt ist",
    always: "Wird immer angezeigt",
  },
  "es-ES": {
    readOnly:
      "Revisa todas las páginas y sus reglas de visibilidad. Aún no se pueden editar, copiar ni compartir Encuestas condicionales.",
    condition: "Se muestra al seleccionar esta respuesta",
    always: "Se muestra siempre",
  },
  "it-IT": {
    readOnly:
      "Esamina tutte le pagine e le relative regole di visibilità. La modifica, la copia e la condivisione dei Sondaggi condizionali non sono ancora disponibili.",
    condition: "Mostrata quando viene selezionata questa risposta",
    always: "Sempre mostrata",
  },
  "pt-PT": {
    readOnly:
      "Reveja todas as páginas e as respetivas regras de visibilidade. Ainda não é possível editar, copiar ou partilhar Inquéritos condicionais.",
    condition: "Apresentada quando esta resposta é selecionada",
    always: "Sempre apresentada",
  },
  "ja-JP": {
    readOnly:
      "すべてのページと表示条件を確認できます。条件付きアンケートの編集、コピー、共有はまだ利用できません。",
    condition: "この回答が選択された場合に表示",
    always: "常に表示",
  },
  "ko-KR": {
    readOnly:
      "모든 페이지와 표시 조건을 확인하세요. 조건부 설문조사의 편집, 복사 및 공유는 아직 사용할 수 없습니다.",
    condition: "이 답변을 선택하면 표시",
    always: "항상 표시",
  },
  "zh-CN": {
    readOnly: "查看所有页面及其显示条件。条件问卷暂不支持编辑、复制或分享。",
    condition: "选择此答案时显示",
    always: "始终显示",
  },
  "zh-TW": {
    readOnly: "檢視所有頁面及其顯示條件。條件問卷暫不支援編輯、複製或分享。",
    condition: "選擇此答案時顯示",
    always: "一律顯示",
  },
};

export function surveyBranchingCopy(locale: SupportedLocale = "en-CA") {
  return { ...(Object.hasOwn(entries, locale) ? entries[locale] : english) };
}
