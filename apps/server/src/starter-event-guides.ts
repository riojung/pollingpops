import type { StarterGuide, StarterId, SupportedLocale } from "@openround/contracts";

const trainingFeedbackGuides: Record<SupportedLocale, Omit<StarterGuide, "minutes">> = {
  "en-CA": {
    audience:
      "People finishing a short training session who can suggest a change for the next one.",
    preparation:
      "Save three minutes before people leave. Decide which parts of the next session you can adjust, such as examples, practice time, discussion, or pace.",
    facilitation:
      "Open the improvement poll first, then the rating on usefulness for people’s work. Let people answer each question before closing it and revealing the results for discussion.",
    interpretation:
      "Use the poll to find a change worth trying. If work usefulness varies, invite one or two volunteers to say what would make the material easier to apply.",
    followUp:
      "Pick one feasible change, such as adding an example from a task people do at work. Say when you can confirm the change and use the same usefulness question in the next session to check how it landed.",
  },
  "fr-FR": {
    audience:
      "Les personnes qui terminent une courte formation et peuvent proposer une amélioration pour la prochaine session.",
    preparation:
      "Gardez trois minutes avant le départ des participants. Repérez ce que vous pourrez ajuster à la prochaine session, comme les exemples, le temps d’exercice, les échanges ou le rythme.",
    facilitation:
      "Commencez par le vote sur l’amélioration à privilégier, puis demandez d’évaluer l’utilité de la formation pour le travail. À chaque question, laissez le temps de répondre, fermez les réponses et affichez les résultats avant d’en discuter.",
    interpretation:
      "Servez-vous du vote pour choisir un changement à essayer. Si les avis sur l’utilité divergent, invitez une ou deux personnes volontaires à expliquer ce qui les aiderait à appliquer le contenu.",
    followUp:
      "Choisissez un changement réalisable, comme ajouter un exemple tiré d’une tâche courante. Dites quand vous pourrez confirmer ce changement et posez à nouveau la question sur l’utilité lors de la prochaine session.",
  },
  "de-DE": {
    audience:
      "Teilnehmende am Ende einer kurzen Schulung, die eine Verbesserung für den nächsten Termin vorschlagen können.",
    preparation:
      "Haltet vor dem Ende drei Minuten frei. Klärt, was sich beim nächsten Mal ändern lässt, etwa die Beispiele, die Übungszeit, der Austausch oder das Tempo.",
    facilitation:
      "Beginnt mit der Abstimmung über die wichtigste Verbesserung. Lasst danach die Nützlichkeit für die Arbeit einschätzen. Gebt den Teilnehmenden bei jeder Frage Zeit zum Antworten, schließt die Frage und zeigt das Ergebnis, bevor ihr es besprecht.",
    interpretation:
      "Wählt anhand der Abstimmung eine Änderung aus, die ihr ausprobieren könnt. Wenn die Nützlichkeit unterschiedlich eingeschätzt wird, bittet ein oder zwei Freiwillige um ein Beispiel dafür, was die Anwendung erleichtern würde.",
    followUp:
      "Entscheidet euch für eine machbare Änderung, etwa ein Beispiel aus dem Arbeitsalltag. Sagt, wann ihr die Änderung bestätigen könnt, und stellt beim nächsten Termin dieselbe Frage zur Nützlichkeit.",
  },
  "es-ES": {
    audience:
      "Personas que acaban de participar en una formación breve y pueden sugerir una mejora para la próxima sesión.",
    preparation:
      "Reservad tres minutos antes de que se vaya el grupo. Pensad qué aspectos podréis ajustar en la próxima sesión, como los ejemplos, el tiempo de práctica, el debate o el ritmo.",
    facilitation:
      "Empezad con la votación sobre qué mejorar y pedid después que valoren la utilidad de la sesión para su trabajo. En cada pregunta, dad tiempo para responder, cerrad la votación y mostrad los resultados antes de comentarlos.",
    interpretation:
      "Aprovechad la votación para elegir un cambio que merezca la pena probar. Si las valoraciones de utilidad son dispares, invitad a una o dos personas a contar voluntariamente qué les facilitaría aplicar lo aprendido.",
    followUp:
      "Elegid un cambio viable, como añadir un ejemplo de una tarea habitual. Indicad cuándo podréis confirmarlo y repetid la pregunta sobre utilidad en la próxima sesión para ver cómo se ha recibido.",
  },
  "it-IT": {
    audience:
      "Persone al termine di una breve formazione che possono indicare un miglioramento per il prossimo incontro.",
    preparation:
      "Tenete da parte tre minuti prima dei saluti. Individuate cosa potete modificare al prossimo incontro, per esempio gli esempi, il tempo per esercitarsi, il confronto o il ritmo.",
    facilitation:
      "Aprite prima il sondaggio sui miglioramenti, poi chiedete quanto la formazione sia stata utile per il lavoro. Per ogni domanda, lasciate il tempo di rispondere, chiudete la raccolta e mostrate i risultati prima di discuterli.",
    interpretation:
      "Usate il sondaggio per scegliere una modifica da provare. Se i giudizi sull’utilità variano, chiedete a una o due persone di raccontare, se lo desiderano, cosa le aiuterebbe ad applicare i contenuti.",
    followUp:
      "Scegliete una modifica fattibile, come aggiungere un esempio tratto da un’attività di lavoro abituale. Dite quando potrete confermarla e riproponete la domanda sull’utilità al prossimo incontro.",
  },
  "pt-PT": {
    audience:
      "Pessoas que estão a terminar uma formação breve e podem sugerir uma melhoria para a próxima sessão.",
    preparation:
      "Reservem três minutos antes de o grupo sair. Identifiquem o que podem ajustar na próxima sessão, como os exemplos, o tempo de prática, a discussão ou o ritmo.",
    facilitation:
      "Comecem pela votação sobre o que melhorar e peçam depois uma avaliação da utilidade da sessão para o trabalho. Em cada pergunta, deem tempo para responder, fechem as respostas e mostrem os resultados antes de os comentar.",
    interpretation:
      "Usem a votação para escolher uma alteração que valha a pena experimentar. Se as avaliações da utilidade variarem, convidem uma ou duas pessoas a explicar, se quiserem, o que lhes facilitaria aplicar os conteúdos.",
    followUp:
      "Escolham uma alteração viável, como acrescentar um exemplo de uma tarefa do dia a dia. Digam quando a podem confirmar e repitam a pergunta sobre a utilidade na próxima sessão para perceber como correu.",
  },
  "ja-JP": {
    audience: "短時間の研修を終え、次回に向けて改善案を出せる参加者。",
    preparation:
      "研修の最後に3分ほど確保します。例の選び方、練習時間、話し合い、進める速さなど、次回に調整できることを確認します。",
    facilitation:
      "まず改善してほしいことに投票してもらい、次に今回の研修が仕事にどの程度役立ったかを聞きます。質問ごとに回答時間を取り、受付を締め切って結果を表示してから話し合います。",
    interpretation:
      "投票結果を手がかりに、試せる変更を一つ考えます。仕事への役立ち方の評価が分かれたら、話したい人に、何があれば研修内容を仕事で使いやすくなるかを聞きます。",
    followUp:
      "普段の業務に即した例を加えるなど、実行できる変更を一つ選びます。いつ確定できるかを伝え、次回も仕事への役立ち方を同じ質問で聞きます。",
  },
  "ko-KR": {
    audience: "짧은 교육을 마치고 다음 교육에서 개선할 점을 제안할 수 있는 참가자.",
    preparation:
      "참가자가 떠나기 전에 3분을 남겨 두세요. 예시, 연습 시간, 토론, 진행 속도 중 다음 교육에서 조정할 수 있는 부분을 정해 두세요.",
    facilitation:
      "먼저 무엇을 개선하면 좋을지 투표하고, 이어서 이번 교육이 업무에 얼마나 도움이 됐는지 평가해 달라고 하세요. 문항마다 답할 시간을 주고 응답을 마감한 뒤 결과를 공개하고 이야기를 나누세요.",
    interpretation:
      "투표 결과를 보고 시도해 볼 만한 변화를 고르세요. 업무에 얼마나 도움이 됐는지 평가가 엇갈리면, 이야기하고 싶은 사람에게 어떤 지원이 있어야 업무에 적용하기 쉬울지 물어보세요.",
    followUp:
      "자주 하는 업무를 예시로 추가하는 등 실행할 수 있는 변화를 하나 고르세요. 언제 확정할 수 있는지 알리고, 다음 교육에서도 업무에 얼마나 도움이 됐는지 같은 질문으로 확인하세요.",
  },
  "zh-CN": {
    audience: "刚结束短时培训、可以为下一次培训提出改进建议的学员。",
    preparation:
      "在大家离开前留出 3 分钟。提前想好下次能调整哪些内容，例如示例、练习时间、讨论安排或节奏。",
    facilitation:
      "先让大家投票选出希望改进的方面，再请他们评价本次培训对工作的帮助。每道题都留出作答时间，截止后显示结果，再展开讨论。",
    interpretation:
      "参考投票结果，选一个值得尝试的调整。如果大家对培训实用性的评价分歧较大，可以请一两位愿意发言的学员说说怎样才能更容易把所学用到工作中。",
    followUp:
      "选一项可行的调整，例如加入一个日常工作场景的示例。告诉大家何时能确定这项调整，并在下一次培训中用同一道题了解它的实际效果。",
  },
  "zh-TW": {
    audience: "剛完成短時間培訓、可以為下次培訓提出改進建議的學員。",
    preparation:
      "在大家離開前留出 3 分鐘。先想好下次能調整哪些內容，例如範例、練習時間、討論安排或步調。",
    facilitation:
      "先請大家投票選出最想改進的部分，再評估這次培訓對工作的幫助。每道題都留時間讓大家作答，截止後顯示結果，再一起討論。",
    interpretation:
      "參考投票結果，選一項值得試試的調整。如果大家對培訓是否實用的看法不一，可以請一兩位願意分享的學員說說，怎樣會更容易把所學用在工作上。",
    followUp:
      "選一項可行的調整，例如加入日常工作情境的範例。告訴大家何時能確認這項調整，並在下次培訓再用同一道題詢問對工作的幫助。",
  },
};

const liveEventFeedbackGuides: Record<SupportedLocale, Omit<StarterGuide, "minutes">> = {
  "en-CA": {
    audience: "Attendees still together at the end of a live event, with time for a short debrief.",
    preparation:
      "Set aside ten minutes. Name one event design decision the organizers can revisit, such as the time allowed for practice or how attendees can join in.",
    facilitation:
      "Let attendees rate usefulness, clarity, and ease of taking part and vote on what gave them value, pace, improvements, next steps, and follow-up. For each question, close responses and reveal the results before inviting discussion. Focus the discussion on the improvement people would make first.",
    interpretation:
      "Read usefulness alongside what people valued. If views differ on ease of taking part or pace, ask what made the difference. Treat likely next steps as intentions and keep quieter attendees’ needs in mind.",
    followUp:
      "Record one design change to consider and one follow-up you can realistically offer, such as a short summary. Give the organizers an owner and review date, and tell attendees when to expect an update.",
  },
  "fr-FR": {
    audience:
      "Les personnes encore réunies à la fin d’un événement, avec un peu de temps pour faire le bilan ensemble.",
    preparation:
      "Réservez dix minutes. Indiquez un choix d’organisation qui pourra être revu, par exemple le temps d’exercice ou les façons de participer.",
    facilitation:
      "Faites évaluer l’utilité, la clarté et la facilité à participer, puis recueillez les avis sur les moments les plus utiles, le rythme, les améliorations, les actions envisagées et le suivi souhaité. Pour chaque question, fermez les réponses et affichez les résultats avant de lancer les échanges. Centrez la discussion sur l’amélioration à traiter en priorité.",
    interpretation:
      "Rapprochez l’évaluation de l’utilité des moments jugés les plus utiles. Si les avis sur la facilité à participer ou le rythme divergent, demandez ce qui a fait la différence. Les actions envisagées sont des intentions. Tenez compte des besoins des personnes moins à l’aise pour prendre la parole.",
    followUp:
      "Notez un changement à examiner et un suivi réalisable, par exemple un court récapitulatif. Désignez une personne responsable et fixez une date pour faire le point. Dites aux participants quand vous donnerez des nouvelles.",
  },
  "de-DE": {
    audience:
      "Teilnehmende, die am Ende einer Veranstaltung noch für eine kurze gemeinsame Auswertung zusammen sind.",
    preparation:
      "Plant zehn Minuten ein. Nennt eine Entscheidung zum Ablauf, die das Organisationsteam überprüfen kann, etwa die Zeit zum Üben oder die Möglichkeiten zur Beteiligung.",
    facilitation:
      "Lasst die Teilnehmenden Nützlichkeit, Verständlichkeit und die Möglichkeiten zur Beteiligung einschätzen und über den wertvollsten Teil, das Tempo, Verbesserungen, nächste Schritte und die Nachbereitung abstimmen. Schließt jede Frage ab und zeigt die Ergebnisse, bevor ihr sie besprecht. Konzentriert euch auf die Verbesserung mit der höchsten Priorität.",
    interpretation:
      "Betrachtet die Nützlichkeit zusammen mit den Teilen, die am meisten gebracht haben. Fragt bei unterschiedlichen Einschätzungen zur Beteiligung oder zum Tempo nach dem Grund. Versteht geplante Schritte als Absichten und achtet auch auf die Bedürfnisse zurückhaltender Teilnehmender.",
    followUp:
      "Haltet eine mögliche Änderung und eine machbare Nachbereitung fest, etwa eine kurze Zusammenfassung. Bestimmt im Organisationsteam eine verantwortliche Person und einen Termin zur Prüfung. Sagt den Teilnehmenden, wann sie ein Update erwarten können.",
  },
  "es-ES": {
    audience:
      "Asistentes que siguen reunidos al final de un evento y tienen tiempo para comentarlo brevemente.",
    preparation:
      "Reservad diez minutos. Indicad una decisión sobre el formato que el equipo organizador pueda revisar, como el tiempo de práctica o las formas de participar.",
    facilitation:
      "Pedid a los asistentes que valoren la utilidad, la claridad y la facilidad para participar, y que voten sobre lo más valioso, el ritmo, las mejoras, los próximos pasos y el seguimiento. En cada pregunta, cerrad las respuestas y mostrad el resultado antes de abrir el debate. Centradlo en qué mejora abordar primero.",
    interpretation:
      "Relacionad la valoración de utilidad con lo que más se valoró del evento. Si hay opiniones distintas sobre la facilidad para participar o el ritmo, preguntad a qué se deben. Tomad los próximos pasos como intenciones y considerad las necesidades de quienes intervienen menos.",
    followUp:
      "Anotad un cambio que merezca estudiarse y una acción de seguimiento viable, como un resumen breve. Asignad una persona responsable y una fecha de revisión, y decid a los asistentes cuándo recibirán noticias.",
  },
  "it-IT": {
    audience:
      "Partecipanti ancora riuniti al termine di un evento, con tempo per un breve confronto.",
    preparation:
      "Dedicate dieci minuti al confronto. Indicate una scelta organizzativa da rivedere, per esempio il tempo dedicato alla pratica o le modalità di partecipazione.",
    facilitation:
      "Fate valutare utilità, chiarezza e facilità di partecipazione e raccogliete le preferenze su cosa è stato più utile, sul ritmo, sui miglioramenti, sui prossimi passi e sulle attività successive. Chiudete ogni domanda e mostratene i risultati prima di discuterli. Concentrate il confronto sul miglioramento da affrontare per primo.",
    interpretation:
      "Leggete il giudizio sull’utilità insieme a ciò che il pubblico ha apprezzato di più. Se le opinioni sulla partecipazione o sul ritmo divergono, chiedete cosa ha fatto la differenza. Considerate i prossimi passi come intenzioni e tenete conto di chi interviene meno.",
    followUp:
      "Annotate una modifica da valutare e un’attività successiva fattibile, come un breve riepilogo. Indicate chi se ne occuperà e quando farete il punto. Dite ai partecipanti quando riceveranno un aggiornamento.",
  },
  "pt-PT": {
    audience:
      "Pessoas ainda reunidas no fim de um evento, com tempo para uma breve conversa de balanço.",
    preparation:
      "Reservem dez minutos. Indiquem uma decisão sobre o formato que a organização possa rever, como o tempo de prática ou as formas de participar.",
    facilitation:
      "Peçam aos participantes que avaliem a utilidade, a clareza e a facilidade de participação e votem sobre o que teve mais valor, o ritmo, as melhorias, os próximos passos e o acompanhamento. Em cada pergunta, fechem as respostas e mostrem os resultados antes de abrir a discussão. Centrem a conversa na melhoria a que devem dar prioridade.",
    interpretation:
      "Vejam a avaliação da utilidade em conjunto com o que as pessoas mais valorizaram. Se houver opiniões diferentes sobre a facilidade de participar ou o ritmo, perguntem o que fez a diferença. Tratem os próximos passos como intenções e tenham em conta as necessidades de quem intervém menos.",
    followUp:
      "Registem uma alteração a avaliar e uma ação de acompanhamento viável, como um resumo breve. Definam na equipa quem fica responsável e uma data de revisão. Digam aos participantes quando podem esperar novidades.",
  },
  "ja-JP": {
    audience: "イベントの終了時に、参加者が集まったまま短い振り返りができる場面。",
    preparation:
      "振り返りに10分ほど確保します。練習時間や参加方法など、運営側が見直せる点を一つ伝えます。",
    facilitation:
      "役立ち方、説明の分かりやすさ、参加のしやすさを評価してもらい、最も価値があった部分、進む速さ、改善点、次の行動や支援を聞きます。質問ごとに回答を締め切り、結果を表示してから意見を聞きます。話し合いでは、最優先の改善点に焦点を当てます。",
    interpretation:
      "役立ち方の評価と、どの部分に価値があったかを合わせて見ます。参加のしやすさや進む速さの受け止め方が分かれたら、理由を聞きます。次に何をするかは現時点の意向と捉え、発言の少ない人のことも考えます。",
    followUp:
      "検討する変更を一つ、短いまとめの共有など実行できるフォローを一つ記録します。運営側で担当者と見直し日を決め、いつ次の連絡をするか参加者に知らせます。",
  },
  "ko-KR": {
    audience: "행사가 끝날 때까지 함께 자리하고 짧게 돌아볼 시간이 있는 참가자.",
    preparation:
      "10분을 확보하세요. 연습 시간이나 참여 방법처럼 운영팀이 다시 검토할 수 있는 행사 구성 요소를 하나 알려 주세요.",
    facilitation:
      "유용성, 설명의 명확성, 참여하기 쉬웠는지를 평가하고, 가장 유익했던 부분, 진행 속도, 개선점, 다음 행동과 바라는 후속 지원에 대한 의견을 모으세요. 문항마다 응답을 마감하고 결과를 공개한 뒤 이야기를 나누세요. 무엇을 먼저 개선할지에 초점을 맞추세요.",
    interpretation:
      "유용성 평가와 가장 가치 있었다고 답한 부분을 함께 살펴보세요. 참여하기 쉬웠는지나 진행 속도에 대한 의견이 갈리면 무엇 때문에 차이가 났는지 물어보세요. 다음 행동은 현재의 의향으로 받아들이고, 발언이 적은 참가자의 필요도 고려하세요.",
    followUp:
      "검토할 변화 한 가지와 짧은 요약 공유처럼 실행할 수 있는 후속 조치 한 가지를 기록하세요. 운영팀에서 담당자와 검토 날짜를 정하고 언제 소식을 전할지 참가자에게 알리세요.",
  },
  "zh-CN": {
    audience: "活动结束时仍聚在一起，并有时间做简短回顾的参与者。",
    preparation: "留出 10 分钟。说清楚主办方可以重新考虑的一个安排，例如练习时间或参与方式。",
    facilitation:
      "请大家评价活动的实用性、讲解的清晰程度和参与的难易，再收集大家对最有价值的环节、节奏、改进项、下一步行动和后续支持的选择。每道题都要先停止收集、显示结果，再邀请大家讨论。讨论集中在最该优先改进的事项上。",
    interpretation:
      "结合大家最看重的环节来看活动的实用性。如果对参与难易或活动节奏的看法有分歧，可以问问原因。把下一步计划视为当前意向，也照顾较少发言者的需求。",
    followUp:
      "记下一项值得考虑的改动，以及一项做得到的后续安排，例如发一份简短总结。请主办方确定负责人和复盘日期，并告诉参与者何时会收到消息。",
  },
  "zh-TW": {
    audience: "活動結束時仍聚在一起、有時間做簡短回顧的參與者。",
    preparation: "留出 10 分鐘。說明主辦方可以重新檢視的一項安排，例如練習時間或參與方式。",
    facilitation:
      "請大家評估活動的實用性、講解是否清楚，以及參與是否容易，再收集大家對最有價值的環節、步調、改進事項、下一步行動與後續支援的選擇。每道題都先停止收集、顯示結果，再邀請大家討論。把討論重點放在最需要優先改進的事項。",
    interpretation:
      "把實用性評價和大家最看重的環節一起看。如果對參與難易或活動步調的看法不同，可以詢問原因。把下一步計畫視為目前的意向，也留意較少發言者的需求。",
    followUp:
      "記下一項值得考慮的調整，以及一項做得到的後續安排，例如分享簡短摘要。請主辦方訂出負責人和檢視日期，並告訴參與者何時會收到消息。",
  },
};

const surveyEventFeedbackGuides: Record<SupportedLocale, Omit<StarterGuide, "minutes">> = {
  "en-CA": {
    audience: "Event attendees who will give feedback on their own time after the event.",
    preparation:
      "Send the Survey link while the event is fresh. State the submission deadline and leave time after closing the run to review results before planning the next event.",
    facilitation:
      "Invite attendees to take about five minutes and submit when finished. They can skip question 4 about ease of taking part and question 8 about helpful follow-up. Ask them to answer with their own event experience in mind.",
    interpretation:
      "A question’s distribution appears only after the Survey run closes and that question has at least 5 finalized answers. Treat skipped items as missing and use each question’s own answer count. Withhold details that could identify anyone in a small group. Read likely next steps as intentions.",
    followUp:
      "Use available results to choose one improvement to consider and one useful follow-up you can deliver, such as a short recap. Tell attendees what you’ll review and when. If too few people answer, use your planning notes to decide what to investigate next.",
  },
  "fr-FR": {
    audience: "Les personnes qui donneront leur avis à leur rythme après l’événement.",
    preparation:
      "Envoyez le lien du questionnaire pendant que l’événement est encore frais dans les esprits. Indiquez la date limite de réponse et prévoyez du temps après la clôture pour consulter les résultats avant de préparer le prochain événement.",
    facilitation:
      "Invitez les participants à prévoir environ cinq minutes et à envoyer leurs réponses une fois le questionnaire rempli. Ils peuvent passer la question 4 sur la facilité à participer et la question 8 sur le suivi qui leur serait utile. Demandez-leur de répondre en pensant à leur propre expérience de l’événement.",
    interpretation:
      "La répartition des réponses à une question s’affiche uniquement après la clôture du questionnaire et si cette question a reçu au moins 5 réponses validées. Comptez les questions passées comme des non-réponses et utilisez le nombre de réponses propre à chaque question. Dans un petit groupe, évitez de communiquer des détails qui pourraient permettre d’identifier quelqu’un. Les actions envisagées sont des intentions.",
    followUp:
      "À partir des résultats disponibles, choisissez une amélioration à étudier et un suivi réalisable, comme un court récapitulatif. Dites aux participants ce que vous allez examiner et quand. Si les réponses sont trop peu nombreuses, appuyez-vous sur les notes d’organisation pour choisir le prochain point à examiner.",
  },
  "de-DE": {
    audience:
      "Teilnehmende, die nach der Veranstaltung zu einem Zeitpunkt ihrer Wahl Rückmeldung geben.",
    preparation:
      "Versendet den Umfragelink, solange die Veranstaltung noch frisch in Erinnerung ist. Nennt die Abgabefrist und plant nach dem Schließen der Umfrage Zeit für die Auswertung ein, bevor ihr die nächste Veranstaltung plant.",
    facilitation:
      "Bittet die Teilnehmenden, sich etwa fünf Minuten Zeit zu nehmen und ihre Antworten am Ende abzusenden. Frage 4 zur Teilnahme und Frage 8 zur gewünschten Nachbereitung können sie überspringen. Sie sollen von ihrer eigenen Erfahrung bei der Veranstaltung ausgehen.",
    interpretation:
      "Die Verteilung für eine Frage wird erst angezeigt, wenn die Umfrage geschlossen ist und mindestens 5 endgültig eingereichte Antworten auf diese Frage vorliegen. Wertet übersprungene Fragen als unbeantwortet und beachtet die Antwortzahl der jeweiligen Frage. Gebt bei kleinen Gruppen keine Details weiter, die Rückschlüsse auf einzelne Personen zulassen. Versteht geplante Schritte als Absichten.",
    followUp:
      "Wählt mit den verfügbaren Ergebnissen eine Verbesserung zur Prüfung und eine nützliche Nachbereitung, die ihr leisten könnt, etwa eine kurze Zusammenfassung. Sagt den Teilnehmenden, was ihr wann prüft. Bei zu wenigen Antworten könnt ihr anhand eurer Planungsnotizen Fragen für die weitere Prüfung auswählen.",
  },
  "es-ES": {
    audience: "Asistentes que responderán por su cuenta después del evento, cuando les venga bien.",
    preparation:
      "Enviad el enlace del cuestionario mientras el evento esté reciente. Indicad el plazo de envío y dejad tiempo después de cerrar el cuestionario para revisar los resultados antes de planificar el próximo evento.",
    facilitation:
      "Invitad a los asistentes a dedicar unos cinco minutos al cuestionario y a enviarlo al terminar. Pueden saltarse la pregunta 4, sobre la facilidad para participar, y la 8, sobre qué seguimiento les resultaría útil. Pedidles que respondan a partir de su propia experiencia en el evento.",
    interpretation:
      "La distribución de una pregunta solo aparece cuando se cierra el cuestionario y esa pregunta tiene al menos 5 respuestas enviadas definitivamente. Tratad las preguntas omitidas como no respondidas y usad el recuento propio de cada pregunta. En grupos pequeños, evitad compartir detalles que puedan identificar a alguien. Tomad los próximos pasos como intenciones.",
    followUp:
      "Con los resultados disponibles, elegid una mejora que estudiar y una acción útil de seguimiento que podáis llevar a cabo, como enviar un resumen breve. Decid a los asistentes qué vais a revisar y cuándo. Si hay pocas respuestas, recurrid a vuestras notas de planificación para elegir qué aspecto examinar.",
  },
  "it-IT": {
    audience: "Partecipanti che daranno il loro riscontro dopo l’evento, quando hanno tempo.",
    preparation:
      "Inviate il link al questionario quando il ricordo dell’evento è ancora fresco. Indicate il termine per l’invio e prevedete del tempo dopo la chiusura per esaminare i risultati prima di pianificare il prossimo evento.",
    facilitation:
      "Invitate i partecipanti a dedicare circa cinque minuti al questionario e a inviarlo al termine. Possono saltare la domanda 4 sulla facilità di partecipazione e la domanda 8 sul seguito che sarebbe loro utile. Chiedete di rispondere in base alla propria esperienza dell’evento.",
    interpretation:
      "La distribuzione delle risposte a una domanda compare solo dopo la chiusura del questionario e con almeno 5 risposte definitive a quella domanda. Contate le domande saltate come senza risposta e usate il totale specifico di ciascuna domanda. Nei gruppi piccoli, evitate di condividere dettagli che potrebbero identificare qualcuno. Considerate i prossimi passi come intenzioni.",
    followUp:
      "Usate i risultati disponibili per scegliere un miglioramento da valutare e un seguito utile che potete offrire, per esempio un breve riepilogo. Dite ai partecipanti che cosa esaminerete e quando. Se le risposte sono poche, usate gli appunti organizzativi per decidere che cosa approfondire.",
  },
  "pt-PT": {
    audience:
      "Participantes que vão dar a sua opinião depois do evento, quando tiverem disponibilidade.",
    preparation:
      "Enviem a ligação para o questionário enquanto o evento está fresco na memória. Indiquem o prazo de envio e reservem tempo após o fecho do questionário para rever os resultados antes de planear o próximo evento.",
    facilitation:
      "Convidem os participantes a dedicar cerca de cinco minutos ao questionário e a enviá-lo quando terminarem. Podem saltar a pergunta 4, sobre a facilidade de participar, e a pergunta 8, sobre o acompanhamento que lhes seria útil. Peçam-lhes que respondam com base na sua própria experiência do evento.",
    interpretation:
      "A distribuição de uma pergunta só aparece depois de o questionário fechar e quando essa pergunta tiver pelo menos 5 respostas definitivas. Considerem as perguntas saltadas como não respondidas e usem a contagem de cada pergunta. Em grupos pequenos, evitem partilhar detalhes que possam identificar alguém. Tratem os próximos passos como intenções.",
    followUp:
      "Usem os resultados disponíveis para escolher uma melhoria a avaliar e um acompanhamento útil que possam oferecer, como um resumo breve. Digam aos participantes o que vão rever e quando. Se houver poucas respostas, recorram às notas de planeamento para decidir o que vão analisar a seguir.",
  },
  "ja-JP": {
    audience: "イベント終了後に、自分の都合に合わせて感想を伝える参加者。",
    preparation:
      "イベントの記憶が新しいうちにアンケートのリンクを送ります。提出期限を伝え、回答受付の終了後、次回の企画を始める前に結果を確認する時間を取ります。",
    facilitation:
      "所要時間は約5分で、回答したら送信するよう案内します。参加しやすさを聞く質問4と、役立つフォローを聞く質問8は任意です。当日の自分の体験を振り返って回答してもらいます。",
    interpretation:
      "アンケートの受付が終了し、送信済みの回答のうちその質問に答えたものが5件以上ある場合に限り、その質問の回答分布が表示されます。飛ばされた質問は未回答として扱い、質問ごとの回答数を確認します。少人数では個人を特定できる情報の共有を控えます。次の行動についての回答は意向として受け止めます。",
    followUp:
      "確認できる結果を手がかりに、検討する改善点を一つ、短いまとめの共有など実施できるフォローを一つ選びます。何をいつ検討するかを伝えます。回答が少なければ、企画時のメモから次に確かめたいことを決めます。",
  },
  "ko-KR": {
    audience: "행사가 끝난 뒤 각자 편한 시간에 의견을 남길 참가자.",
    preparation:
      "행사 기억이 생생할 때 설문 링크를 보내세요. 제출 마감일을 알리고, 다음 행사 계획을 세우기 전에 설문 회차를 마감하고 결과를 검토할 시간을 확보하세요.",
    facilitation:
      "설문에 약 5분이 걸리며 다 답한 뒤 제출해 달라고 알려 주세요. 참여하기 쉬웠는지 묻는 4번과 어떤 후속 지원이 도움이 되는지 묻는 8번은 건너뛸 수 있습니다. 각자 행사에서 경험한 일을 떠올리며 답해 달라고 하세요.",
    interpretation:
      "설문 회차가 종료되고 해당 문항에 대한 최종 제출 응답이 5개 이상일 때만 응답 분포가 표시됩니다. 건너뛴 문항은 미응답으로 처리하고, 문항별 응답 수를 기준으로 살펴보세요. 소규모 그룹에서 개인을 식별할 수 있는 세부 내용은 공유하지 마세요. 다음 행동에 대한 응답은 현재의 의향으로 해석하세요.",
    followUp:
      "확인 가능한 결과를 바탕으로 검토할 개선점 한 가지와 짧은 요약 공유처럼 실제로 제공할 수 있는 후속 지원 한 가지를 고르세요. 무엇을 언제 검토할지 참가자에게 알리세요. 응답이 너무 적으면 행사 기획 메모를 보고 더 알아볼 점을 정하세요.",
  },
  "zh-CN": {
    audience: "将在活动结束后自行安排时间反馈的参与者。",
    preparation:
      "趁活动记忆还清晰时发出问卷链接。注明提交截止时间，并在结束收集后、筹划下一场活动前留出时间查看结果。",
    facilitation:
      "告诉参与者，填写约需 5 分钟，完成后记得提交。第 4 题询问参与是否容易，第 8 题询问何种后续支持有帮助，这两题都可跳过。请大家根据自己在活动中的经历作答。",
    interpretation:
      "问卷收集结束后，只有至少 5 份已提交的问卷回答了某道题，才会显示该题的回答分布。将跳过的题目视为未答，并以各题各自的作答人数为准。小组人数较少时，避免分享可能暴露个人身份的细节。把对下一步行动的回答视为当前意向。",
    followUp:
      "根据可用结果选出一项要考虑的改进，以及一项能提供的后续支持，例如发一份简短总结。告诉参与者会在什么时候查看哪些问题。如果回答太少，就参考筹划活动时的记录，决定接下来要了解什么。",
  },
  "zh-TW": {
    audience: "活動結束後會自行安排時間提供意見的參與者。",
    preparation:
      "趁大家對活動還有印象時發出問卷連結。註明送出期限，並在結束收集後、規劃下一場活動前留出時間檢視結果。",
    facilitation:
      "告訴參與者，填寫約需 5 分鐘，完成後記得送出。第 4 題詢問參與是否容易，第 8 題詢問何種後續支援有幫助，兩題都可以跳過。請大家根據自己在活動中的經驗作答。",
    interpretation:
      "問卷收集結束後，只有至少 5 份已送出的問卷回答了某道題，才會顯示該題的回覆分布。把跳過的題目視為未答，並以各題各自的作答人數為準。小組人數較少時，避免分享可能識別個人的細節。把對下一步行動的回覆視為目前的意向。",
    followUp:
      "根據可用結果選出一項要考慮的改進，以及一項能提供的後續支援，例如分享簡短摘要。告訴參與者會在何時檢視哪些問題。如果回覆太少，就參考活動規劃筆記，決定接下來要了解什麼。",
  },
};

export function eventStarterGuide(
  id: StarterId,
  locale: SupportedLocale,
  survey: boolean,
): StarterGuide | undefined {
  if (id === "training-feedback" && !survey)
    return { ...trainingFeedbackGuides[locale], minutes: 3 };
  if (id !== "event-feedback") return undefined;
  return survey
    ? { ...surveyEventFeedbackGuides[locale], minutes: 5 }
    : { ...liveEventFeedbackGuides[locale], minutes: 10 };
}
