import type { SupportedLocale } from "@openround/contracts";

const english = {
  overview: "Overview",
  responseCoverage: "Response coverage",
  responseCoverageDetail:
    "{respondents} of {participants} participants answered at least one question.",
  questionCoverage: "Questions with responses",
  questionCoverageDetail: "{answered} of {total} questions received responses.",
  questionSnapshot: "Question overview",
  allQuestions: "View all questions",
  nextStep: "Suggested next step",
  noResponsesTitle: "No responses were recorded",
  noResponsesBody:
    "This session has no retained answers to analyze. Review the questions, then run another session to collect responses.",
  openRounds: "Open your Rounds",
  opinionNext: "Review the response distributions to understand the views shared in this session.",
  reviewNext:
    "Start with the questions marked for review, then use the evidence to plan focused practice.",
  recheckNext:
    "Review the responses. A linked recheck in a future session can collect paired recovery evidence.",
  evidenceIntro: "Inspect the retained evidence and its limits before drawing conclusions.",
  recoveryNarrative: "Recovery story and interpretation",
  evidenceNotes: "Evidence notes and limits",
  noConfidence: "No confidence responses were recorded for this session.",
  questionIntro:
    "Responses and results for each question. Opinion questions are not scored; unanswered assessments have no measured accuracy.",
  participantIntro:
    "These are session nicknames and recorded results. They do not verify identity or establish long-term learning.",
  noParticipantsTitle: "No participant rows are available",
  noParticipantsBody:
    "Use the overview and question results for the retained session totals. Individual participant results are not available here.",
  noQuestionsTitle: "No question results are available",
  noQuestionsBody:
    "This report contains no retained question rows. Review the session totals or return to your Rounds.",
  retainedUntil: "Retained until {date}",
} as const;

export type RoundReportWorkspaceCopyKey = keyof typeof english;
type Copy = Record<RoundReportWorkspaceCopyKey, string>;
export const roundReportWorkspaceCopyKeys = Object.keys(english) as RoundReportWorkspaceCopyKey[];

const translations: Record<SupportedLocale, Copy> = {
  "en-CA": english,
  "fr-FR": {
    overview: "Vue d’ensemble",
    responseCoverage: "Couverture des réponses",
    responseCoverageDetail:
      "{respondents} participants sur {participants} ont répondu à au moins une question.",
    questionCoverage: "Questions avec réponses",
    questionCoverageDetail: "{answered} questions sur {total} ont reçu des réponses.",
    questionSnapshot: "Aperçu des questions",
    allQuestions: "Voir toutes les questions",
    nextStep: "Prochaine étape suggérée",
    noResponsesTitle: "Aucune réponse enregistrée",
    noResponsesBody:
      "Cette session n’a aucune réponse conservée à analyser. Vérifiez les questions, puis lancez une autre session pour recueillir des réponses.",
    openRounds: "Ouvrir vos Rounds",
    opinionNext:
      "Examinez la répartition des réponses pour comprendre les avis partagés pendant cette session.",
    reviewNext:
      "Commencez par les questions à revoir, puis utilisez les données pour planifier un entraînement ciblé.",
    recheckNext:
      "Examinez les réponses. Une vérification liée lors d’une future session permettra de recueillir des données appariées sur la progression.",
    evidenceIntro:
      "Examinez les données conservées et leurs limites avant de tirer des conclusions.",
    recoveryNarrative: "Récit et interprétation de la progression",
    evidenceNotes: "Notes et limites des données",
    noConfidence: "Aucune réponse de confiance n’a été enregistrée pour cette session.",
    questionIntro:
      "Réponses et résultats par question. Les questions d’opinion ne sont pas notées ; la précision des évaluations sans réponse n’est pas mesurée.",
    participantIntro:
      "Il s’agit de pseudonymes de session et de résultats enregistrés. Ils ne vérifient pas l’identité et ne démontrent pas un apprentissage à long terme.",
    noParticipantsTitle: "Aucun résultat individuel disponible",
    noParticipantsBody:
      "Consultez la vue d’ensemble et les questions pour les totaux conservés. Les résultats individuels ne sont pas disponibles ici.",
    noQuestionsTitle: "Aucun résultat de question disponible",
    noQuestionsBody:
      "Ce rapport ne contient aucune ligne de question conservée. Consultez les totaux de la session ou retournez à vos Rounds.",
    retainedUntil: "Conservé jusqu’au {date}",
  },
  "de-DE": {
    overview: "Übersicht",
    responseCoverage: "Antwortabdeckung",
    responseCoverageDetail:
      "{respondents} von {participants} Teilnehmenden haben mindestens eine Frage beantwortet.",
    questionCoverage: "Fragen mit Antworten",
    questionCoverageDetail: "{answered} von {total} Fragen haben Antworten erhalten.",
    questionSnapshot: "Fragenübersicht",
    allQuestions: "Alle Fragen ansehen",
    nextStep: "Empfohlener nächster Schritt",
    noResponsesTitle: "Keine Antworten aufgezeichnet",
    noResponsesBody:
      "Für diese Sitzung sind keine Antworten zur Analyse gespeichert. Prüfen Sie die Fragen und starten Sie eine weitere Sitzung, um Antworten zu erfassen.",
    openRounds: "Ihre Rounds öffnen",
    opinionNext:
      "Prüfen Sie die Antwortverteilungen, um die in dieser Sitzung geteilten Ansichten zu verstehen.",
    reviewNext:
      "Beginnen Sie mit den zur Überprüfung markierten Fragen und planen Sie anhand der Daten gezielte Übungen.",
    recheckNext:
      "Prüfen Sie die Antworten. Eine verknüpfte Nachprüfung in einer späteren Sitzung kann gepaarte Verbesserungsdaten erfassen.",
    evidenceIntro:
      "Prüfen Sie die gespeicherten Daten und ihre Grenzen, bevor Sie Schlussfolgerungen ziehen.",
    recoveryNarrative: "Verlauf und Einordnung der Verbesserung",
    evidenceNotes: "Hinweise und Grenzen der Daten",
    noConfidence: "Für diese Sitzung wurden keine Angaben zur Sicherheit aufgezeichnet.",
    questionIntro:
      "Antworten und Ergebnisse je Frage. Meinungsfragen werden nicht bewertet; unbeantwortete Prüfungsfragen haben keine gemessene Genauigkeit.",
    participantIntro:
      "Dies sind Sitzungs-Spitznamen und aufgezeichnete Ergebnisse. Sie bestätigen weder Identitäten noch langfristiges Lernen.",
    noParticipantsTitle: "Keine einzelnen Teilnehmerergebnisse verfügbar",
    noParticipantsBody:
      "Gespeicherte Sitzungssummen finden Sie in der Übersicht und bei den Fragen. Einzelne Teilnehmerergebnisse sind hier nicht verfügbar.",
    noQuestionsTitle: "Keine Fragenergebnisse verfügbar",
    noQuestionsBody:
      "Dieser Bericht enthält keine gespeicherten Fragezeilen. Prüfen Sie die Sitzungssummen oder kehren Sie zu Ihren Rounds zurück.",
    retainedUntil: "Gespeichert bis {date}",
  },
  "es-ES": {
    overview: "Resumen",
    responseCoverage: "Cobertura de respuestas",
    responseCoverageDetail:
      "{respondents} de {participants} participantes respondieron al menos una pregunta.",
    questionCoverage: "Preguntas con respuestas",
    questionCoverageDetail: "{answered} de {total} preguntas recibieron respuestas.",
    questionSnapshot: "Resumen de preguntas",
    allQuestions: "Ver todas las preguntas",
    nextStep: "Siguiente paso sugerido",
    noResponsesTitle: "No se registraron respuestas",
    noResponsesBody:
      "Esta sesión no tiene respuestas conservadas que analizar. Revisa las preguntas y realiza otra sesión para recoger respuestas.",
    openRounds: "Abrir tus Rounds",
    opinionNext:
      "Revisa las distribuciones de respuestas para comprender las opiniones compartidas en esta sesión.",
    reviewNext:
      "Empieza por las preguntas marcadas para revisar y utiliza los datos para planificar una práctica específica.",
    recheckNext:
      "Revisa las respuestas. Una comprobación vinculada en una futura sesión puede recoger datos emparejados de recuperación.",
    evidenceIntro: "Examina los datos conservados y sus límites antes de sacar conclusiones.",
    recoveryNarrative: "Historia e interpretación de la recuperación",
    evidenceNotes: "Notas y límites de los datos",
    noConfidence: "No se registraron respuestas de confianza en esta sesión.",
    questionIntro:
      "Respuestas y resultados por pregunta. Las preguntas de opinión no se puntúan; las evaluaciones sin respuesta no tienen una precisión medida.",
    participantIntro:
      "Estos son apodos de sesión y resultados registrados. No verifican la identidad ni demuestran aprendizaje a largo plazo.",
    noParticipantsTitle: "No hay resultados individuales disponibles",
    noParticipantsBody:
      "Consulta el resumen y los resultados por pregunta para ver los totales conservados. Aquí no hay resultados individuales disponibles.",
    noQuestionsTitle: "No hay resultados de preguntas disponibles",
    noQuestionsBody:
      "Este informe no contiene filas de preguntas conservadas. Revisa los totales de la sesión o vuelve a tus Rounds.",
    retainedUntil: "Conservado hasta el {date}",
  },
  "it-IT": {
    overview: "Panoramica",
    responseCoverage: "Copertura delle risposte",
    responseCoverageDetail:
      "{respondents} partecipanti su {participants} hanno risposto ad almeno una domanda.",
    questionCoverage: "Domande con risposte",
    questionCoverageDetail: "{answered} domande su {total} hanno ricevuto risposte.",
    questionSnapshot: "Panoramica delle domande",
    allQuestions: "Vedi tutte le domande",
    nextStep: "Prossimo passo suggerito",
    noResponsesTitle: "Nessuna risposta registrata",
    noResponsesBody:
      "Questa sessione non ha risposte conservate da analizzare. Rivedi le domande, poi avvia un’altra sessione per raccogliere risposte.",
    openRounds: "Apri i tuoi Rounds",
    opinionNext:
      "Esamina le distribuzioni delle risposte per comprendere le opinioni condivise in questa sessione.",
    reviewNext: "Inizia dalle domande da rivedere, poi usa i dati per pianificare esercizi mirati.",
    recheckNext:
      "Esamina le risposte. Una verifica collegata in una sessione futura può raccogliere dati abbinati sul recupero.",
    evidenceIntro: "Esamina i dati conservati e i loro limiti prima di trarre conclusioni.",
    recoveryNarrative: "Storia e interpretazione del recupero",
    evidenceNotes: "Note e limiti dei dati",
    noConfidence: "Non sono state registrate risposte sulla sicurezza per questa sessione.",
    questionIntro:
      "Risposte e risultati per ogni domanda. Le domande di opinione non hanno punteggio; le valutazioni senza risposta non hanno un’accuratezza misurata.",
    participantIntro:
      "Questi sono soprannomi di sessione e risultati registrati. Non verificano l’identità e non dimostrano apprendimento a lungo termine.",
    noParticipantsTitle: "Nessun risultato individuale disponibile",
    noParticipantsBody:
      "Consulta la panoramica e i risultati delle domande per i totali conservati. I risultati individuali non sono disponibili qui.",
    noQuestionsTitle: "Nessun risultato delle domande disponibile",
    noQuestionsBody:
      "Questo rapporto non contiene righe di domande conservate. Consulta i totali della sessione o torna ai tuoi Rounds.",
    retainedUntil: "Conservato fino al {date}",
  },
  "pt-PT": {
    overview: "Visão geral",
    responseCoverage: "Cobertura das respostas",
    responseCoverageDetail:
      "{respondents} de {participants} participantes responderam a pelo menos uma pergunta.",
    questionCoverage: "Perguntas com respostas",
    questionCoverageDetail: "{answered} de {total} perguntas receberam respostas.",
    questionSnapshot: "Visão geral das perguntas",
    allQuestions: "Ver todas as perguntas",
    nextStep: "Próximo passo sugerido",
    noResponsesTitle: "Não foram registadas respostas",
    noResponsesBody:
      "Esta sessão não tem respostas conservadas para analisar. Reveja as perguntas e realize outra sessão para recolher respostas.",
    openRounds: "Abrir os seus Rounds",
    opinionNext:
      "Reveja as distribuições de respostas para compreender as opiniões partilhadas nesta sessão.",
    reviewNext:
      "Comece pelas perguntas assinaladas para revisão e use os dados para planear prática direcionada.",
    recheckNext:
      "Reveja as respostas. Uma verificação associada numa sessão futura pode recolher dados emparelhados de recuperação.",
    evidenceIntro: "Examine os dados conservados e os seus limites antes de tirar conclusões.",
    recoveryNarrative: "História e interpretação da recuperação",
    evidenceNotes: "Notas e limites dos dados",
    noConfidence: "Não foram registadas respostas de confiança nesta sessão.",
    questionIntro:
      "Respostas e resultados por pergunta. As perguntas de opinião não são pontuadas; as avaliações sem resposta não têm precisão medida.",
    participantIntro:
      "Estes são nomes de sessão e resultados registados. Não verificam a identidade nem demonstram aprendizagem a longo prazo.",
    noParticipantsTitle: "Sem resultados individuais disponíveis",
    noParticipantsBody:
      "Consulte a visão geral e os resultados das perguntas para os totais conservados. Os resultados individuais não estão disponíveis aqui.",
    noQuestionsTitle: "Sem resultados de perguntas disponíveis",
    noQuestionsBody:
      "Este relatório não contém linhas de perguntas conservadas. Reveja os totais da sessão ou volte aos seus Rounds.",
    retainedUntil: "Conservado até {date}",
  },
  "ja-JP": {
    overview: "概要",
    responseCoverage: "回答カバレッジ",
    responseCoverageDetail:
      "参加者{participants}人中{respondents}人が少なくとも1問に回答しました。",
    questionCoverage: "回答のあった質問",
    questionCoverageDetail: "{total}問中{answered}問に回答がありました。",
    questionSnapshot: "質問の概要",
    allQuestions: "すべての質問を見る",
    nextStep: "推奨される次のステップ",
    noResponsesTitle: "回答は記録されていません",
    noResponsesBody:
      "このセッションには分析できる保存済み回答がありません。質問を確認し、別のセッションを実施して回答を集めてください。",
    openRounds: "自分のRoundsを開く",
    opinionNext: "回答分布を確認し、このセッションで共有された意見を把握してください。",
    reviewNext:
      "復習対象の質問から確認し、記録されたデータをもとに重点的な練習を計画してください。",
    recheckNext:
      "回答を確認してください。今後のセッションで関連する再確認を行うと、対応する回復データを収集できます。",
    evidenceIntro: "結論を出す前に、保存された根拠とその限界を確認してください。",
    recoveryNarrative: "回復の経緯と解釈",
    evidenceNotes: "根拠に関する注記と限界",
    noConfidence: "このセッションでは確信度の回答は記録されていません。",
    questionIntro:
      "質問ごとの回答と結果です。意見の質問は採点されず、未回答の評価には測定された正答率がありません。",
    participantIntro:
      "セッション内のニックネームと記録された結果です。本人確認や長期的な学習成果の証明にはなりません。",
    noParticipantsTitle: "参加者別の結果はありません",
    noParticipantsBody:
      "保存されたセッションの集計は、概要と質問の結果で確認できます。ここでは参加者別の結果は利用できません。",
    noQuestionsTitle: "質問の結果はありません",
    noQuestionsBody:
      "このレポートには保存された質問行がありません。セッションの集計を確認するか、自分のRoundsに戻ってください。",
    retainedUntil: "保存期限：{date}",
  },
  "ko-KR": {
    overview: "개요",
    responseCoverage: "응답 참여율",
    responseCoverageDetail:
      "참가자 {participants}명 중 {respondents}명이 한 개 이상의 질문에 응답했습니다.",
    questionCoverage: "응답이 있는 질문",
    questionCoverageDetail: "질문 {total}개 중 {answered}개에 응답이 기록되었습니다.",
    questionSnapshot: "질문 개요",
    allQuestions: "모든 질문 보기",
    nextStep: "추천 다음 단계",
    noResponsesTitle: "기록된 응답이 없습니다",
    noResponsesBody:
      "이 세션에는 분석할 보관 응답이 없습니다. 질문을 검토한 뒤 새 세션을 진행하여 응답을 수집하세요.",
    openRounds: "내 Rounds 열기",
    opinionNext: "응답 분포를 검토하여 이 세션에서 공유된 의견을 살펴보세요.",
    reviewNext: "검토가 필요한 질문부터 확인하고 기록된 근거를 바탕으로 집중 연습을 계획하세요.",
    recheckNext:
      "응답을 검토하세요. 다음 세션에서 연결된 재확인을 진행하면 짝지어진 회복 근거를 수집할 수 있습니다.",
    evidenceIntro: "결론을 내리기 전에 보관된 근거와 그 한계를 살펴보세요.",
    recoveryNarrative: "회복 과정과 해석",
    evidenceNotes: "근거 참고 사항과 한계",
    noConfidence: "이 세션에는 기록된 확신도 응답이 없습니다.",
    questionIntro:
      "질문별 응답과 결과입니다. 의견 질문은 채점하지 않으며, 미응답 평가에는 측정된 정답률이 없습니다.",
    participantIntro:
      "세션 닉네임과 기록된 결과입니다. 신원을 확인하거나 장기 학습 성과를 입증하지 않습니다.",
    noParticipantsTitle: "참가자별 결과가 없습니다",
    noParticipantsBody:
      "보관된 세션 합계는 개요와 질문 결과에서 확인하세요. 이곳에서는 참가자별 결과를 제공하지 않습니다.",
    noQuestionsTitle: "질문 결과가 없습니다",
    noQuestionsBody:
      "이 보고서에는 보관된 질문 행이 없습니다. 세션 합계를 확인하거나 내 Rounds로 돌아가세요.",
    retainedUntil: "보관 기한: {date}",
  },
  "zh-CN": {
    overview: "概览",
    responseCoverage: "回答覆盖率",
    responseCoverageDetail: "{participants}位参与者中有{respondents}位至少回答了一个问题。",
    questionCoverage: "收到回答的问题",
    questionCoverageDetail: "{total}个问题中有{answered}个收到了回答。",
    questionSnapshot: "问题概览",
    allQuestions: "查看全部问题",
    nextStep: "建议的下一步",
    noResponsesTitle: "未记录任何回答",
    noResponsesBody: "本场次没有可供分析的已保留回答。请检查问题，然后开展新场次以收集回答。",
    openRounds: "打开我的Rounds",
    opinionNext: "查看回答分布，了解本场次分享的观点。",
    reviewNext: "从标记为需要复习的问题开始，再根据证据规划针对性练习。",
    recheckNext: "查看回答。今后场次中的关联复查可以收集配对的改善证据。",
    evidenceIntro: "得出结论前，请检查保留的证据及其局限。",
    recoveryNarrative: "改善过程与解读",
    evidenceNotes: "证据说明与局限",
    noConfidence: "本场次未记录信心程度回答。",
    questionIntro: "各问题的回答与结果。观点问题不计分；未作答的测评没有实测正确率。",
    participantIntro: "以下是场次昵称和记录的结果，不能验证身份或证明长期学习成果。",
    noParticipantsTitle: "没有可用的参与者明细",
    noParticipantsBody: "请在概览和问题结果中查看保留的场次总数。此处不提供个人结果。",
    noQuestionsTitle: "没有可用的问题结果",
    noQuestionsBody: "本报告没有保留的问题行。请查看场次总数或返回我的Rounds。",
    retainedUntil: "保留至{date}",
  },
  "zh-TW": {
    overview: "總覽",
    responseCoverage: "回答涵蓋率",
    responseCoverageDetail: "{participants}位參與者中有{respondents}位至少回答了一個問題。",
    questionCoverage: "收到回答的問題",
    questionCoverageDetail: "{total}個問題中有{answered}個收到了回答。",
    questionSnapshot: "問題總覽",
    allQuestions: "查看全部問題",
    nextStep: "建議的下一步",
    noResponsesTitle: "未記錄任何回答",
    noResponsesBody: "本場次沒有可供分析的已保留回答。請檢查問題，然後開展新場次以收集回答。",
    openRounds: "開啟我的Rounds",
    opinionNext: "查看回答分布，了解本場次分享的觀點。",
    reviewNext: "從標記為需要複習的問題開始，再根據證據規劃針對性練習。",
    recheckNext: "查看回答。未來場次中的關聯複查可以收集配對的改善證據。",
    evidenceIntro: "得出結論前，請檢查保留的證據及其限制。",
    recoveryNarrative: "改善過程與解讀",
    evidenceNotes: "證據說明與限制",
    noConfidence: "本場次未記錄信心程度回答。",
    questionIntro: "各問題的回答與結果。觀點問題不計分；未作答的測評沒有實測正確率。",
    participantIntro: "以下是場次暱稱和記錄的結果，不能驗證身分或證明長期學習成果。",
    noParticipantsTitle: "沒有可用的參與者明細",
    noParticipantsBody: "請在總覽和問題結果中查看保留的場次總數。此處不提供個人結果。",
    noQuestionsTitle: "沒有可用的問題結果",
    noQuestionsBody: "本報告沒有保留的問題列。請查看場次總數或返回我的Rounds。",
    retainedUntil: "保留至{date}",
  },
};

export function roundReportWorkspaceCopy(locale: SupportedLocale = "en-CA") {
  const messages = Object.hasOwn(translations, locale) ? translations[locale] : english;
  return (key: RoundReportWorkspaceCopyKey, values: Record<string, string | number> = {}) =>
    messages[key].replace(/\{(\w+)\}/g, (token, name: string) =>
      Object.hasOwn(values, name) ? String(values[name]) : token,
    );
}
