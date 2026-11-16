import type { SupportedLocale } from "@openround/contracts";

// Only these scaffolds are localized; the quoted title and every choice remain
// exact authored excerpts. Capture this locale when the creator opens a review.
const content: Record<SupportedLocale, readonly [string, string, string, string, string]> = {
  "en-CA": [
    "What questions or comments do you have about “{title}”?",
    "How clear is “{title}” to you?",
    "Which point from “{title}” should we discuss next?",
    "Not clear yet",
    "Very clear",
  ],
  "fr-FR": [
    "Quelles questions ou remarques avez-vous sur “{title}” ?",
    "Dans quelle mesure “{title}” vous paraît-il clair ?",
    "Quel point de “{title}” devrions-nous aborder ensuite ?",
    "Pas encore clair",
    "Très clair",
  ],
  "de-DE": [
    "Welche Fragen oder Anmerkungen haben Sie zu “{title}”?",
    "Wie klar ist “{title}” für Sie?",
    "Welchen Punkt aus “{title}” sollten wir als Nächstes besprechen?",
    "Noch unklar",
    "Sehr klar",
  ],
  "es-ES": [
    "¿Qué preguntas o comentarios tienes sobre “{title}”?",
    "¿Hasta qué punto te resulta claro “{title}”?",
    "¿Qué punto de “{title}” deberíamos comentar a continuación?",
    "Aún no está claro",
    "Muy claro",
  ],
  "it-IT": [
    "Quali domande o commenti hai su “{title}”?",
    "Quanto ti è chiaro “{title}”?",
    "Quale punto di “{title}” dovremmo discutere ora?",
    "Non ancora chiaro",
    "Molto chiaro",
  ],
  "pt-PT": [
    "Que perguntas ou comentários tem sobre “{title}”?",
    "Quão claro é “{title}” para si?",
    "Que ponto de “{title}” devemos discutir a seguir?",
    "Ainda não está claro",
    "Muito claro",
  ],
  "ja-JP": [
    "“{title}”について、質問や意見はありますか？",
    "“{title}”はどのくらいわかりやすいですか？",
    "“{title}”のどの点を次に話し合いますか？",
    "まだわかりにくい",
    "とてもわかりやすい",
  ],
  "ko-KR": [
    "“{title}”에 대해 어떤 질문이나 의견이 있나요?",
    "“{title}”을 얼마나 명확하게 이해했나요?",
    "“{title}”의 어떤 내용을 다음에 논의할까요?",
    "아직 명확하지 않음",
    "매우 명확함",
  ],
  "zh-CN": [
    "您对“{title}”有什么问题或意见？",
    "您觉得“{title}”有多清晰？",
    "我们接下来应该讨论“{title}”中的哪一点？",
    "还不清晰",
    "非常清晰",
  ],
  "zh-TW": [
    "您對“{title}”有什麼問題或意見？",
    "您覺得“{title}”有多清晰？",
    "我們接下來應該討論“{title}”中的哪一點？",
    "還不清晰",
    "非常清晰",
  ],
};

export function questionStarterContent(locale: SupportedLocale, title: string) {
  const [discussion, clarity, priority, minLabel, maxLabel] = content[locale];
  // A callback prevents authored dollar sequences from becoming replacements.
  const prompt = (value: string) => value.replace("{title}", () => title);
  return {
    discussion: prompt(discussion),
    clarity: prompt(clarity),
    priority: prompt(priority),
    minLabel,
    maxLabel,
  };
}
