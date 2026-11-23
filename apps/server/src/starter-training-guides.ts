import type { StarterGuide, StarterId, SupportedLocale } from "@openround/contracts";

const newHireGuides: Record<SupportedLocale, Omit<StarterGuide, "minutes">> = {
  "en-CA": {
    audience: "New hires and their onboarding facilitators in the first week.",
    preparation:
      "Confirm the approved support channel and access request process. Prepare a fictional example without names, account details, or credentials.",
    facilitation:
      "Give everyone time to answer both questions. Explain where to report access issues and how to request access or delegation without sharing credentials.",
    interpretation:
      "Use responses to the two questions to see which steps the group should practise. Keep individual scores out of performance decisions.",
    followUp:
      "Practise submitting a request with the fictional example. Share a short access checklist and the approved support link in the onboarding materials.",
  },
  "fr-FR": {
    audience: "Les nouvelles recrues et les personnes qui les accompagnent la première semaine.",
    preparation:
      "Vérifiez le canal d’assistance officiel et la procédure de demande d’accès. Préparez un exemple fictif sans nom, détail de compte ni identifiant de connexion.",
    facilitation:
      "Laissez à chacun le temps de répondre aux deux questions. Expliquez où signaler un problème d’accès et comment demander un accès ou une délégation sans partager d’identifiants.",
    interpretation:
      "Appuyez-vous sur les réponses aux deux questions pour repérer les étapes à revoir en groupe. Écartez les scores individuels des décisions d’évaluation.",
    followUp:
      "Entraînez-vous à envoyer une demande à partir de l’exemple fictif. Ajoutez une courte liste de vérification des accès et le lien d’assistance officiel aux documents d’intégration.",
  },
  "de-DE": {
    audience:
      "Neue Mitarbeitende und ihre Ansprechpersonen für die Einarbeitung in der ersten Woche.",
    preparation:
      "Prüft den vorgesehenen Supportkanal und das Verfahren für Zugriffsanfragen. Bereitet ein fiktives Beispiel ohne Namen, Kontoinformationen oder Zugangsdaten vor.",
    facilitation:
      "Gebt allen Zeit, beide Fragen zu beantworten. Erklärt, wo man Zugriffsprobleme meldet und wie man Zugriff oder eine Vertretungsberechtigung beantragt, ohne Zugangsdaten weiterzugeben.",
    interpretation:
      "Leitet aus den Antworten auf beide Fragen ab, welche Schritte die Gruppe noch üben sollte. Lasst individuelle Ergebnisse bei der Leistungsbeurteilung außen vor.",
    followUp:
      "Übt am fiktiven Beispiel, eine Anfrage einzureichen. Ergänzt die Einarbeitungsunterlagen um eine kurze Checkliste für den Zugriff und den Link zum vorgesehenen Support.",
  },
  "es-ES": {
    audience: "Nuevas incorporaciones y quienes las acompañan durante la primera semana.",
    preparation:
      "Confirmad el canal de soporte autorizado y el procedimiento para pedir acceso. Preparad un ejemplo ficticio sin nombres, datos de cuentas ni credenciales.",
    facilitation:
      "Dejad tiempo para que todo el mundo responda a las dos preguntas. Explicad dónde comunicar problemas de acceso y cómo solicitar acceso o delegación de permisos sin compartir credenciales.",
    interpretation:
      "Usad las respuestas a las dos preguntas para detectar qué pasos debe practicar el grupo. Excluid las puntuaciones individuales de las decisiones sobre el rendimiento.",
    followUp:
      "Practicad el envío de una solicitud con el ejemplo ficticio. Añadid al material de incorporación una breve lista para comprobar los accesos y el enlace al soporte autorizado.",
  },
  "it-IT": {
    audience: "Nuovi assunti e persone che li affiancano durante la prima settimana.",
    preparation:
      "Verificate il canale di assistenza autorizzato e la procedura per richiedere l’accesso. Preparate un esempio fittizio senza nomi, dati degli account o credenziali.",
    facilitation:
      "Date a tutti il tempo di rispondere a entrambe le domande. Spiegate dove segnalare i problemi e come chiedere un accesso o una delega senza condividere le credenziali.",
    interpretation:
      "Usate le risposte alle due domande per capire quali passaggi il gruppo deve ripassare. Escludete i punteggi individuali dalle decisioni sulla valutazione delle prestazioni.",
    followUp:
      "Esercitatevi a inviare una richiesta con l’esempio fittizio. Aggiungete ai materiali di inserimento una breve lista di controllo degli accessi e il link al canale di assistenza autorizzato.",
  },
  "pt-PT": {
    audience: "Pessoas recém-contratadas e quem as acompanha na primeira semana de integração.",
    preparation:
      "Confirmem o canal de apoio autorizado e o processo de pedido de acesso. Preparem um exemplo fictício sem nomes, dados de contas ou credenciais.",
    facilitation:
      "Deem a todos tempo para responder às duas perguntas. Expliquem onde comunicar problemas de acesso e como pedir acesso ou delegar permissões sem partilhar credenciais.",
    interpretation:
      "Usem as respostas às duas perguntas para perceber que passos o grupo precisa de praticar. Excluam as pontuações individuais de decisões sobre o desempenho.",
    followUp:
      "Pratiquem o envio de um pedido com o exemplo fictício. Incluam uma breve lista de verificação de acessos e a ligação ao canal de apoio autorizado nos materiais de integração.",
  },
  "ja-JP": {
    audience: "入社1週目の新入社員と、その受け入れを担当する方。",
    preparation:
      "所定のサポート窓口とアクセス申請の手順を確認します。氏名、アカウント情報、認証情報を含まない架空の事例を用意します。",
    facilitation:
      "全員が2問に答えられる時間を取ります。アクセスで困ったときの連絡先と、認証情報を共有せずにアクセス権や権限委任を申請する方法を説明します。",
    interpretation:
      "2問の回答を見て、グループで練習すべき手順を把握します。個人の得点は人事評価の判断材料から外します。",
    followUp:
      "架空の事例で申請の出し方を練習します。受け入れ資料に、アクセスの確認項目をまとめた短いチェックリストと所定のサポート窓口へのリンクを載せます。",
  },
  "ko-KR": {
    audience: "입사 첫 주의 신입 직원과 온보딩을 돕는 담당자.",
    preparation:
      "승인된 지원 창구와 접근 권한 신청 절차를 확인하세요. 이름, 계정 정보, 로그인 정보가 없는 가상의 사례를 준비하세요.",
    facilitation:
      "모두가 두 문항에 답할 시간을 주세요. 접근 문제를 어디에 알리는지, 로그인 정보를 공유하지 않고 접근 권한이나 권한 위임을 어떻게 신청하는지 설명하세요.",
    interpretation:
      "두 문항의 답변으로 그룹에서 연습할 절차를 파악하세요. 개인 점수는 성과 관련 판단에서 제외하세요.",
    followUp:
      "가상의 사례를 바탕으로 신청서 제출을 연습하세요. 온보딩 자료에 간단한 접근 권한 체크리스트와 승인된 지원 창구 링크를 넣어 공유하세요.",
  },
  "zh-CN": {
    audience: "入职第一周的新员工及负责引导他们的同事。",
    preparation:
      "确认获准使用的支持渠道和访问权限申请流程。准备一个不含姓名、账号信息或凭据的虚构案例。",
    facilitation:
      "留出时间让大家回答两道题。说明应向哪里报告访问问题，以及如何在不共享凭据的情况下申请访问或委托权限。",
    interpretation: "根据两道题的回答找出小组需要练习的步骤。将个人得分排除在绩效决策之外。",
    followUp:
      "用虚构案例练习提交申请。在入职材料中加入简明的访问权限检查清单和获准使用的支持渠道链接。",
  },
  "zh-TW": {
    audience: "到職第一週的新進同仁與負責引導的同仁。",
    preparation:
      "確認核准的支援管道和存取權限申請流程。準備一個不含姓名、帳號資訊或憑證的虛構案例。",
    facilitation:
      "留出時間讓大家回答兩道題目。說明遇到存取問題時應向何處反映，以及如何在不共用憑證的情況下申請存取或委派權限。",
    interpretation: "根據兩題的回答找出小組需要練習的步驟。個人分數應排除在績效決策之外。",
    followUp:
      "用虛構案例練習送出申請。在到職資料中加入簡短的存取權限檢查清單與核准的支援管道連結。",
  },
};

const onboardingSurveyGuides: Record<SupportedLocale, Omit<StarterGuide, "minutes">> = {
  "en-CA": {
    audience: "New hires who have had a chance to try their usual work tools in their first month.",
    preparation:
      "Check that the questions fit the tools and tasks new hires have tried. Agree who will review responses and when the group will hear back.",
    facilitation:
      "Give respondents about 5 minutes to answer independently. Point out that questions 1, 3, and 6 are optional. Direct individual access issues to the approved support channel.",
    interpretation:
      "A question’s distribution appears only after the Survey run closes and that question has at least 5 finalized answers. Review group patterns using each question’s response count. Treat skipped answers as missing and withhold any breakdown that could identify someone in a small group. Use the results to improve onboarding.",
    followUp:
      "Choose one improvement, such as adding a tool access checklist. Give it an owner and a review date, then tell new hires what changed and when you will check again.",
  },
  "fr-FR": {
    audience:
      "Les nouvelles recrues qui ont pu essayer leurs outils de travail habituels au cours du premier mois.",
    preparation:
      "Vérifiez que les questions correspondent aux outils et aux tâches que les nouvelles recrues ont déjà essayés. Convenez de qui examinera les réponses et de la date du retour au groupe.",
    facilitation:
      "Laissez environ 5 minutes pour répondre individuellement. Signalez que les questions 1, 3 et 6 sont facultatives. Orientez les problèmes d’accès individuels vers le canal d’assistance officiel.",
    interpretation:
      "La répartition des réponses à une question s’affiche uniquement après la clôture de l’enquête et si au moins 5 questionnaires soumis contiennent une réponse à cette question. Examinez les tendances du groupe en tenant compte du nombre de réponses à chaque question. Considérez les réponses sautées comme des données manquantes et écartez tout détail qui permettrait d’identifier quelqu’un dans un petit groupe. Utilisez les résultats pour améliorer l’intégration.",
    followUp:
      "Choisissez une amélioration, par exemple une liste de vérification des accès aux outils. Désignez un responsable et fixez une date de bilan, puis indiquez aux nouvelles recrues ce qui a changé et quand vous ferez le point.",
  },
  "de-DE": {
    audience:
      "Neue Mitarbeitende, die im ersten Monat Gelegenheit hatten, ihre üblichen Arbeitswerkzeuge auszuprobieren.",
    preparation:
      "Prüft, ob die Fragen zu den bisher erprobten Werkzeugen und Aufgaben passen. Vereinbart, wer die Antworten auswertet und wann die Gruppe eine Rückmeldung erhält.",
    facilitation:
      "Plant etwa 5 Minuten für die eigenständige Bearbeitung ein. Weist darauf hin, dass die Fragen 1, 3 und 6 freiwillig sind. Verweist bei individuellen Zugriffsproblemen auf den vorgesehenen Support.",
    interpretation:
      "Eine Antwortverteilung wird erst nach dem Schließen der Umfrage angezeigt, wenn für die jeweilige Frage mindestens 5 Antworten aus abgeschickten Fragebögen vorliegen. Achtet bei der Auswertung der Gruppenergebnisse auf die Zahl der Antworten pro Frage. Wertet übersprungene Fragen als fehlende Angaben und teilt keine Aufschlüsselungen, die in kleinen Gruppen Rückschlüsse auf Einzelne zulassen. Nutzt die Ergebnisse, um die Einarbeitung zu verbessern.",
    followUp:
      "Wählt eine Verbesserung, etwa eine Checkliste für den Zugriff auf Arbeitswerkzeuge. Benennt eine verantwortliche Person und legt einen Prüftermin fest. Sagt den neuen Mitarbeitenden, was sich geändert hat und wann ihr nachfragt.",
  },
  "es-ES": {
    audience:
      "Personas recién incorporadas que han podido probar sus herramientas habituales de trabajo durante el primer mes.",
    preparation:
      "Comprobad que las preguntas encajen con las herramientas y tareas que ya han probado. Acordad quién revisará las respuestas y cuándo se informará al grupo.",
    facilitation:
      "Dad unos 5 minutos para responder de forma individual. Indicad que las preguntas 1, 3 y 6 son opcionales. Derivad los problemas individuales de acceso al canal de soporte autorizado.",
    interpretation:
      "La distribución de una pregunta solo se muestra cuando la encuesta se ha cerrado y al menos 5 cuestionarios enviados contienen una respuesta a esa pregunta. Revisad las tendencias del grupo teniendo en cuenta el número de respuestas por pregunta. Tratad las respuestas omitidas como datos ausentes y evitad compartir desgloses que permitan identificar a alguien en un grupo pequeño. Usad los resultados para mejorar la incorporación.",
    followUp:
      "Elegid una mejora, como añadir una lista para comprobar el acceso a las herramientas. Asignadle un responsable y una fecha de revisión. Contad a las nuevas incorporaciones qué ha cambiado y cuándo lo revisaréis.",
  },
  "it-IT": {
    audience:
      "Nuovi assunti che nel primo mese hanno avuto modo di provare gli strumenti che usano di solito al lavoro.",
    preparation:
      "Verificate che le domande rispecchino gli strumenti e le attività già sperimentati. Decidete chi esaminerà le risposte e quando il gruppo riceverà un aggiornamento.",
    facilitation:
      "Lasciate circa 5 minuti per rispondere individualmente. Ricordate che le domande 1, 3 e 6 sono facoltative. Indirizzate i problemi individuali di accesso al canale di assistenza autorizzato.",
    interpretation:
      "La distribuzione delle risposte a una domanda compare solo dopo la chiusura del sondaggio e se almeno 5 questionari inviati contengono una risposta a quella domanda. Esaminate le tendenze del gruppo tenendo conto del numero di risposte per ciascuna domanda. Trattate le risposte saltate come dati mancanti e omettete i dettagli che potrebbero rendere identificabile una persona in un gruppo piccolo. Usate i risultati per migliorare l’inserimento.",
    followUp:
      "Scegliete un miglioramento, per esempio una lista di controllo degli accessi agli strumenti. Assegnate un responsabile e una data di verifica. Comunicate ai nuovi assunti che cosa è cambiato e quando farete il punto.",
  },
  "pt-PT": {
    audience:
      "Pessoas recém-contratadas que tiveram oportunidade de experimentar as ferramentas de trabalho habituais no primeiro mês.",
    preparation:
      "Confirmem que as perguntas se adequam às ferramentas e tarefas já experimentadas. Combinem quem irá analisar as respostas e quando comunicarão os resultados ao grupo.",
    facilitation:
      "Deem cerca de 5 minutos para responder individualmente. Indiquem que as perguntas 1, 3 e 6 são opcionais. Encaminhem problemas de acesso individuais para o canal de apoio autorizado.",
    interpretation:
      "A distribuição das respostas a uma pergunta só é apresentada após o encerramento do inquérito e quando pelo menos 5 questionários submetidos incluem uma resposta a essa pergunta. Analisem as tendências do grupo tendo em conta o número de respostas a cada pergunta. Tratem as respostas omitidas como dados em falta e não partilhem pormenores que permitam identificar alguém num grupo pequeno. Usem os resultados para melhorar a integração.",
    followUp:
      "Escolham uma melhoria, como acrescentar uma lista de verificação dos acessos às ferramentas. Definam quem fica responsável e a data de revisão. Digam às pessoas recém-contratadas o que mudou e quando voltam a avaliar a mudança.",
  },
  "ja-JP": {
    audience: "入社後の最初の1か月に、普段の業務ツールを試す機会があった新入社員。",
    preparation:
      "質問が、すでに試したツールや業務に合っているか確認します。回答を確認する担当者と、グループに結果を伝える時期を決めます。",
    facilitation:
      "各自で回答する時間を5分ほど取ります。質問1、3、6は任意だと伝えます。個別のアクセスの問題は所定のサポート窓口に案内します。",
    interpretation:
      "アンケートの受付が終了し、送信済みの回答のうちその質問に答えたものが5件以上ある場合に限り、その質問の回答分布が表示されます。質問ごとの回答数を確認しながら、グループ全体の傾向を見ます。飛ばされた質問は未回答として扱い、少人数のグループで個人が特定される可能性がある内訳は共有を控えます。結果は受け入れの改善に活用します。",
    followUp:
      "ツールへのアクセス確認リストの追加など、改善策を一つ選びます。担当者と確認日を決め、何が変わったか、いつ再確認するかを新入社員に知らせます。",
  },
  "ko-KR": {
    audience: "입사 첫 달에 평소 업무에 쓰는 도구를 사용해 본 신입 직원.",
    preparation:
      "신입 직원이 사용해 본 도구와 수행해 본 업무에 질문이 맞는지 확인하세요. 응답을 검토할 담당자와 그룹에 결과를 알릴 시점을 정하세요.",
    facilitation:
      "각자 응답할 시간으로 약 5분을 주세요. 1번, 3번, 6번 문항은 선택 사항이라고 안내하세요. 개인의 접근 문제는 승인된 지원 창구로 안내하세요.",
    interpretation:
      "설문 회차가 종료되고 해당 문항에 대한 최종 제출 응답이 5개 이상일 때만 응답 분포가 표시됩니다. 문항별 응답 수를 고려해 그룹의 전체적인 경향을 살펴보세요. 건너뛴 문항은 미응답으로 처리하고, 소규모 그룹에서 개인을 식별할 수 있는 세부 결과는 공유를 삼가세요. 결과는 온보딩 개선에 활용하세요.",
    followUp:
      "도구 접근 체크리스트 추가처럼 개선할 항목 하나를 고르세요. 담당자와 검토 날짜를 정한 뒤, 무엇이 바뀌었고 언제 다시 점검할지 신입 직원에게 알려 주세요.",
  },
  "zh-CN": {
    audience: "入职首月已经有机会试用日常工作工具的新员工。",
    preparation:
      "确认问题适用于新员工已经尝试过的工具和任务。约定由谁审阅答复，以及何时向这批新员工反馈。",
    facilitation:
      "留出约 5 分钟供新员工独立填写。提醒大家第 1、3、6 题为选答题。遇到个人访问问题时，引导他们使用获准的支持渠道。",
    interpretation:
      "问卷收集结束后，只有至少 5 份已提交的问卷回答了某道题，才会显示该题的回答分布。结合每道题的实际答复数查看小组的整体趋势。将跳过的题目视为未答，小组人数较少时避免分享可能暴露个人身份的明细。将结果用于改进入职流程。",
    followUp:
      "选定一项改进，例如增加工具访问权限检查清单。指定负责人和复查日期，并告诉新员工改了什么、何时再次确认效果。",
  },
  "zh-TW": {
    audience: "到職首月已有機會試用日常工作工具的新進同仁。",
    preparation:
      "確認題目適用於新進同仁已試過的工具與任務。約定由誰檢視回覆，以及何時向這批同仁說明結果。",
    facilitation:
      "預留約 5 分鐘讓同仁個別填答。提醒大家第 1、3、6 題可選答。遇到個別存取問題時，引導同仁使用核准的支援管道。",
    interpretation:
      "問卷收集結束後，只有至少 5 份已送出的問卷回答了某道題，才會顯示該題的回答分布。依各題的實際回覆數查看群組的整體趨勢。將跳過的題目視為未答，人數較少時避免分享可能識別個人的細項。將結果用於改善到職流程。",
    followUp:
      "挑選一項改善措施，例如新增工具存取權限檢查清單。指定負責人與檢視日期，並告知新進同仁有哪些變更、何時會再確認成效。",
  },
};

export function trainingStarterGuide(
  id: StarterId,
  locale: SupportedLocale,
  survey: boolean,
): StarterGuide | undefined {
  if (id === "new-hire-knowledge-check" && !survey) return { ...newHireGuides[locale], minutes: 5 };
  if (id === "onboarding-experience" && survey)
    return { ...onboardingSurveyGuides[locale], minutes: 5 };
  return undefined;
}
