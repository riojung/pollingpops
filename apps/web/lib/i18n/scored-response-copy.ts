import type { SupportedLocale } from "@openround/contracts";

interface ScoredResponseCopy {
  title: string;
  scope: string;
  saved: string;
  correct: string;
  unanswered: string;
  noneCorrect: string;
  zeroPoints: string;
}

export const scoredResponseCopy: Record<SupportedLocale, ScoredResponseCopy> = {
  "en-CA": {
    title: "Your saved answers",
    scope: "Revealed scored questions only.",
    saved: "Saved answers",
    correct: "Correct",
    unanswered: "No answer was saved for the revealed scored questions.",
    noneCorrect: "Your saved answers to the revealed scored questions were not correct.",
    zeroPoints: "No points earned from revealed scored questions.",
  },
  "fr-FR": {
    title: "Vos réponses enregistrées",
    scope: "Uniquement les questions notées dont les résultats ont été révélés.",
    saved: "Réponses enregistrées",
    correct: "Correctes",
    unanswered: "Aucune réponse n’a été enregistrée pour les questions notées révélées.",
    noneCorrect: "Vos réponses enregistrées aux questions notées révélées étaient incorrectes.",
    zeroPoints: "Aucun point gagné sur les questions notées révélées.",
  },
  "de-DE": {
    title: "Deine gespeicherten Antworten",
    scope: "Nur gewertete Fragen mit aufgedecktem Ergebnis.",
    saved: "Gespeicherte Antworten",
    correct: "Richtig",
    unanswered: "Für die aufgedeckten gewerteten Fragen wurde keine Antwort gespeichert.",
    noneCorrect:
      "Deine gespeicherten Antworten auf die aufgedeckten gewerteten Fragen waren falsch.",
    zeroPoints: "Keine Punkte aus aufgedeckten gewerteten Fragen.",
  },
  "es-ES": {
    title: "Tus respuestas guardadas",
    scope: "Solo preguntas puntuables con resultados revelados.",
    saved: "Respuestas guardadas",
    correct: "Correctas",
    unanswered: "No se guardó ninguna respuesta a las preguntas puntuables reveladas.",
    noneCorrect: "Tus respuestas guardadas a las preguntas puntuables reveladas no eran correctas.",
    zeroPoints: "No se han obtenido puntos en las preguntas puntuables reveladas.",
  },
  "it-IT": {
    title: "Le tue risposte salvate",
    scope: "Solo domande con punteggio e risultati rivelati.",
    saved: "Risposte salvate",
    correct: "Corrette",
    unanswered: "Non è stata salvata alcuna risposta alle domande con punteggio rivelate.",
    noneCorrect: "Le tue risposte salvate alle domande con punteggio rivelate non erano corrette.",
    zeroPoints: "Nessun punto ottenuto dalle domande con punteggio rivelate.",
  },
  "pt-PT": {
    title: "As suas respostas guardadas",
    scope: "Apenas perguntas pontuadas com resultados revelados.",
    saved: "Respostas guardadas",
    correct: "Corretas",
    unanswered: "Não foi guardada nenhuma resposta às perguntas pontuadas reveladas.",
    noneCorrect:
      "As suas respostas guardadas às perguntas pontuadas reveladas não estavam corretas.",
    zeroPoints: "Não foram obtidos pontos nas perguntas pontuadas reveladas.",
  },
  "ko-KR": {
    title: "저장된 내 답변",
    scope: "결과가 공개된 채점 문제만 포함합니다.",
    saved: "저장된 답변",
    correct: "정답",
    unanswered: "결과가 공개된 채점 문제에 저장된 답변이 없습니다.",
    noneCorrect: "결과가 공개된 채점 문제에 저장된 답변은 모두 오답입니다.",
    zeroPoints: "결과가 공개된 채점 문제에서 획득한 점수가 없습니다.",
  },
  "ja-JP": {
    title: "保存された自分の回答",
    scope: "結果が公開された採点対象の問題のみ。",
    saved: "保存された回答",
    correct: "正解",
    unanswered: "結果が公開された採点対象の問題に、保存された回答はありません。",
    noneCorrect: "結果が公開された採点対象の問題に保存された回答は、すべて不正解でした。",
    zeroPoints: "結果が公開された採点対象の問題で獲得した得点はありません。",
  },
  "zh-CN": {
    title: "你已保存的答案",
    scope: "仅包括已公布结果的计分题。",
    saved: "已保存答案",
    correct: "答对题数",
    unanswered: "已公布结果的计分题没有保存的答案。",
    noneCorrect: "你在已公布结果的计分题中保存的答案均不正确。",
    zeroPoints: "已公布结果的计分题尚无人得分。",
  },
  "zh-TW": {
    title: "你已儲存的答案",
    scope: "僅包括已公布結果的計分題。",
    saved: "已儲存答案",
    correct: "答對題數",
    unanswered: "已公布結果的計分題沒有儲存的答案。",
    noneCorrect: "你在已公布結果的計分題中儲存的答案均不正確。",
    zeroPoints: "已公布結果的計分題尚無人得分。",
  },
};
