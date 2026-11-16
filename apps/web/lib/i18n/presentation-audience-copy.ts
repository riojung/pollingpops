import type { SupportedLocale } from "@openround/contracts";

const messages = {
  "en-CA": ["Close questions and answers", "Current presentation"],
  "fr-FR": ["Fermer les questions et réponses", "Présentation en cours"],
  "de-DE": ["Fragen und Antworten schließen", "Aktuelle Präsentation"],
  "es-ES": ["Cerrar preguntas y respuestas", "Presentación actual"],
  "it-IT": ["Chiudi domande e risposte", "Presentazione attuale"],
  "pt-PT": ["Fechar perguntas e respostas", "Apresentação atual"],
  "ja-JP": ["質問と回答を閉じる", "現在のプレゼンテーション"],
  "ko-KR": ["질문과 답변 닫기", "현재 프레젠테이션"],
  "zh-CN": ["关闭问答", "当前演示"],
  "zh-TW": ["關閉問答", "目前的簡報"],
} satisfies Record<SupportedLocale, readonly [string, string]>;

export function presentationAudienceCopy(locale: SupportedLocale) {
  const [closeQuestions, currentPresentation] = messages[locale];
  return { closeQuestions, currentPresentation };
}
