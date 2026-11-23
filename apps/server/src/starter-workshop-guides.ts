import type { StarterGuide, StarterId, SupportedLocale } from "@openround/contracts";

const workshopExpectationsGuides: Record<SupportedLocale, Omit<StarterGuide, "minutes">> = {
  "en-CA": {
    audience: "Workshop participants at the start of a session with room to adjust the agenda.",
    preparation:
      "Name the topic, decide which agenda items need to stay, and prepare one example or activity you can swap in.",
    facilitation:
      "Ask what people most want from the workshop, then have them rate their familiarity with the topic. Give everyone time to answer before discussing the group results.",
    interpretation:
      "Use the priorities and self-rated familiarity to pick a starting point. Look for a way to include less common priorities in the workshop or the recap.",
    followUp:
      "Tell the group what you’ll adjust, such as adding a worked example before practice. Note any other requests for the recap.",
  },
  "fr-FR": {
    audience: "Les personnes qui commencent un atelier dont le programme peut encore être adapté.",
    preparation:
      "Présentez le sujet, déterminez les points du programme à conserver et préparez un exemple ou une activité de remplacement.",
    facilitation:
      "Demandez aux personnes présentes ce qu’elles attendent surtout de l’atelier, puis invitez-les à indiquer dans quelle mesure elles connaissent le sujet. Laissez à tout le monde le temps de répondre avant d’aborder les résultats du groupe.",
    interpretation:
      "Choisissez un point de départ en tenant compte des priorités et de la connaissance que chacun déclare avoir du sujet. Cherchez comment prendre en compte les attentes moins fréquentes dans l’atelier ou le récapitulatif.",
    followUp:
      "Dites au groupe ce que vous allez adapter, par exemple en ajoutant un exemple détaillé avant la pratique. Notez les autres demandes pour le récapitulatif.",
  },
  "de-DE": {
    audience: "Teilnehmende zu Beginn eines Workshops, dessen Ablauf noch angepasst werden kann.",
    preparation:
      "Nennt das Thema, legt die festen Programmpunkte fest und bereitet ein Beispiel oder eine Übung vor, die ihr bei Bedarf einbauen könnt.",
    facilitation:
      "Fragt, was den Teilnehmenden am Workshop am wichtigsten ist. Lasst sie dann einschätzen, wie vertraut sie mit dem Thema sind. Wartet, bis alle Zeit zum Antworten hatten, bevor ihr die Gruppenergebnisse besprecht.",
    interpretation:
      "Wählt anhand der Prioritäten und der Selbsteinschätzung zum Thema einen Einstieg. Überlegt, wie ihr seltener genannte Wünsche im Workshop oder in der Zusammenfassung berücksichtigen könnt.",
    followUp:
      "Sagt der Gruppe, was ihr anpasst, etwa ein Schritt für Schritt erläutertes Beispiel vor der Übung. Haltet weitere Wünsche für die Zusammenfassung fest.",
  },
  "es-ES": {
    audience: "Participantes al comienzo de un taller cuyo programa aún se puede ajustar.",
    preparation:
      "Presentad el tema, decidid qué puntos del programa deben mantenerse y preparad un ejemplo o una actividad que podáis incorporar si hace falta.",
    facilitation:
      "Preguntad qué esperan conseguir ante todo del taller y pedidles que indiquen lo familiarizados que están con el tema. Dejad tiempo para que todo el mundo responda antes de comentar los resultados del grupo.",
    interpretation:
      "Elegid un punto de partida teniendo en cuenta las prioridades y la familiaridad que declara cada persona. Buscad cómo dar cabida a las prioridades menos citadas en el taller o en el resumen.",
    followUp:
      "Contad al grupo qué vais a ajustar, como añadir un ejemplo resuelto antes de la práctica. Apuntad las demás peticiones para el resumen.",
  },
  "it-IT": {
    audience: "Partecipanti all’inizio di un workshop il cui programma può ancora essere adattato.",
    preparation:
      "Presentate l’argomento, stabilite quali parti del programma vanno mantenute e preparate un esempio o un’attività da inserire all’occorrenza.",
    facilitation:
      "Chiedete ai partecipanti che cosa si aspettano soprattutto dal workshop, poi invitateli a indicare quanto conoscono l’argomento. Lasciate a tutti il tempo di rispondere prima di discutere i risultati del gruppo.",
    interpretation:
      "Scegliete da dove partire tenendo conto delle priorità e del grado di familiarità dichiarato. Cercate un modo per dare spazio alle priorità meno citate nel workshop o nel riepilogo.",
    followUp:
      "Dite al gruppo che cosa cambierete, per esempio aggiungendo un esempio svolto prima dell’esercitazione. Annotate le altre richieste per il riepilogo.",
  },
  "pt-PT": {
    audience: "Participantes no início de um workshop cujo programa ainda pode ser ajustado.",
    preparation:
      "Apresentem o tema, decidam que pontos do programa têm de manter e preparem um exemplo ou uma atividade que possam introduzir se necessário.",
    facilitation:
      "Perguntem o que mais esperam do workshop e peçam que indiquem até que ponto conhecem o tema. Deem tempo a todos para responderem antes de comentarem os resultados do grupo.",
    interpretation:
      "Escolham o ponto de partida tendo em conta as prioridades e a familiaridade indicada pelos participantes. Procurem incluir as prioridades menos referidas no workshop ou no resumo.",
    followUp:
      "Digam ao grupo o que vão ajustar, por exemplo acrescentar um exemplo resolvido antes da prática. Registem os restantes pedidos para o resumo.",
  },
  "ja-JP": {
    audience: "進行内容をこれから調整できるワークショップに参加する方。開始時に使います。",
    preparation:
      "テーマを伝え、予定どおり進める項目を決めます。必要に応じて差し替えられる例や活動も一つ用意します。",
    facilitation:
      "ワークショップで最も得たいことを聞いた後、テーマにどの程度なじみがあるかを答えてもらいます。全員が回答する時間を取ってから、グループの結果について話し合います。",
    interpretation:
      "参加者が重視することとテーマへのなじみの自己評価を手がかりに、どこから始めるかを決めます。少数の要望も、活動や振り返りに取り入れられるか考えます。",
    followUp:
      "練習の前に手順が分かる例を加えるなど、何を調整するかをグループに伝えます。ほかの要望も振り返りに向けて記録します。",
  },
  "ko-KR": {
    audience: "일정을 조정할 여지가 있는 워크숍에 막 참여한 사람들.",
    preparation:
      "주제를 소개하고 그대로 진행할 항목을 정하세요. 필요할 때 대신 넣을 예시나 활동을 하나 준비하세요.",
    facilitation:
      "워크숍에서 가장 얻고 싶은 것이 무엇인지 묻고, 이어서 주제가 얼마나 익숙한지 직접 평가해 달라고 하세요. 모두가 답할 시간을 준 뒤 그룹 결과를 함께 살펴보세요.",
    interpretation:
      "참여자가 꼽은 우선순위와 주제에 대한 자기 평가를 바탕으로 어디서 시작할지 정하세요. 적게 나온 의견도 활동이나 요약에 반영할 방법을 찾아보세요.",
    followUp:
      "실습 전에 풀이 예시를 추가하는 등 일정을 어떻게 조정할지 그룹에 알려 주세요. 다른 요청은 요약에 담을 수 있도록 기록하세요.",
  },
  "zh-CN": {
    audience: "刚开始参加工作坊，且议程仍可调整的参与者。",
    preparation: "介绍主题，确定必须保留的议程内容，再准备一个可替换的示例或活动。",
    facilitation:
      "先问大家最希望从工作坊获得什么，再请他们评价自己对主题的熟悉程度。留出时间让每个人作答，然后一起讨论小组结果。",
    interpretation:
      "参考大家的优先事项和自评的熟悉程度，选定从哪里开始。想一想如何在工作坊或总结中照顾到较少被提及的需求。",
    followUp:
      "告诉大家你会怎样调整议程，例如在练习前加一个完整示例。记下其他请求，留到总结时回应。",
  },
  "zh-TW": {
    audience: "剛開始參加工作坊，且議程仍可調整的參與者。",
    preparation: "介紹主題、決定哪些議程項目必須保留，並準備一個可替換的範例或活動。",
    facilitation:
      "先詢問大家最想從工作坊獲得什麼，再請他們評估自己對主題的熟悉程度。留時間讓每個人回答，再一起討論小組結果。",
    interpretation:
      "參考大家的優先事項和自評的熟悉程度，決定從哪裡開始。想想如何在工作坊或總結中兼顧較少被提到的需求。",
    followUp:
      "告訴大家你會如何調整議程，例如在練習前示範一個完整的做法。記下其他需求，留到總結時回應。",
  },
};

const exitTicketGuides: Record<SupportedLocale, Omit<StarterGuide, "minutes">> = {
  "en-CA": {
    audience:
      "Participants finishing a workshop or lesson on listening and checking understanding.",
    preparation:
      "Save time for both questions and a short debrief. Prepare a fictional example of paraphrasing someone’s point and asking whether you understood it. Confidence is off by default. Turn on “Ask for confidence (optional)” in Round setup if you want to collect it.",
    facilitation:
      "Ask for an answer to each question and invite an optional confidence rating when available. Close responses to the first question and reveal the answer. Use the host controls to start an explanation of why checking a paraphrase with the speaker helps. Finish the intervention before opening the linked recheck. After the recheck, discuss how the same skill applies when you disagree.",
    interpretation:
      "Use correctness and any confidence ratings collected to find a step to practise together. Limit conclusions to how the group answered the two scenarios and keep individual scores out of evaluation decisions.",
    followUp:
      "Have pairs practise with a fictional concern. Ask one person to restate it and the other to confirm or correct the paraphrase, then have them swap roles.",
  },
  "fr-FR": {
    audience:
      "Les personnes qui terminent un atelier ou une séance où l’on apprend à écouter et à vérifier qu’on a bien compris l’autre.",
    preparation:
      "Réservez du temps pour les deux questions et un bref échange. Préparez une situation fictive où une personne reformule les propos d’une autre et lui demande si elle a bien compris. Le recueil du niveau de confiance est désactivé par défaut. Pour le recueillir, activez « Demander le niveau de confiance (facultatif) » dans les réglages du Round.",
    facilitation:
      "Demandez à chacun de répondre à chaque question et, si l’option est disponible, invitez les participants à indiquer leur niveau de confiance s’ils le souhaitent. Clôturez les réponses à la première question et révélez la bonne réponse. Utilisez les commandes d’animation pour lancer une explication sur l’intérêt de vérifier sa reformulation auprès de l’autre personne. Terminez l’intervention avant de lancer la question de vérification associée. Après cette vérification, discutez de la même démarche en cas de désaccord.",
    interpretation:
      "Appuyez-vous sur les taux de bonnes réponses et, s’ils ont été recueillis, sur les niveaux de confiance pour choisir une étape à travailler ensemble. Limitez vos conclusions aux réponses du groupe à ces deux situations et écartez les scores individuels des décisions d’évaluation.",
    followUp:
      "Faites pratiquer en binômes à partir d’une préoccupation fictive. Une personne la reformule et l’autre confirme ou corrige la reformulation, puis elles échangent les rôles.",
  },
  "de-DE": {
    audience:
      "Teilnehmende am Ende eines Workshops oder einer Unterrichtseinheit über Zuhören und Nachfragen.",
    preparation:
      "Plant Zeit für beide Fragen und eine kurze Nachbesprechung ein. Bereitet ein fiktives Beispiel vor, in dem jemand eine Aussage in eigenen Worten wiedergibt und nachfragt, ob sie richtig verstanden wurde. Die Sicherheitsabfrage ist standardmäßig ausgeschaltet. Wenn ihr sie nutzen wollt, aktiviert in der Rundeneinrichtung „Sicherheit abfragen (optional)“.",
    facilitation:
      "Bittet alle, jede Frage zu beantworten und, wenn die Option verfügbar ist, freiwillig anzugeben, wie sicher sie sich sind. Schließt die erste Frage und deckt die richtige Antwort auf. Startet über die Moderationssteuerung eine Erklärung dazu, warum es hilft, bei der sprechenden Person nachzufragen, ob die Zusammenfassung stimmt. Beendet die Intervention, bevor ihr die verknüpfte Kontrollfrage öffnet. Besprecht nach der Kontrollfrage, wie das auch bei Meinungsverschiedenheiten geht.",
    interpretation:
      "Wählt anhand der richtigen Antworten und, falls es Angaben zur Sicherheit gibt, auch anhand dieser Angaben einen Schritt zum gemeinsamen Üben. Beschränkt eure Schlüsse auf die Antworten der Gruppe zu den beiden Situationen und lasst individuelle Punktzahlen bei Bewertungen außer Acht.",
    followUp:
      "Lasst die Teilnehmenden zu zweit mit einem fiktiven Einwand üben. Eine Person fasst ihn zusammen, die andere bestätigt oder korrigiert die Wiedergabe. Danach wechseln sie die Rollen.",
  },
  "es-ES": {
    audience:
      "Participantes al final de un taller o una clase sobre escuchar y confirmar lo entendido.",
    preparation:
      "Reservad tiempo para las dos preguntas y una breve puesta en común. Preparad un ejemplo ficticio en el que alguien reformula el punto de vista de otra persona y comprueba con ella que lo ha entendido. La opción para recoger el nivel de confianza está desactivada de forma predeterminada. Si queréis usarla, activad «Preguntar el nivel de confianza (opcional)» al configurar la ronda.",
    facilitation:
      "Pedid que respondan a cada pregunta. Si aparece la opción, invitadles a indicar su nivel de confianza de forma voluntaria. Cerrad las respuestas a la primera pregunta y mostrad la respuesta correcta. Usad los controles de moderación para iniciar una explicación sobre por qué ayuda comprobar la reformulación con quien habló. Terminad la intervención antes de abrir la pregunta de comprobación vinculada. Tras la comprobación, comentad cómo aplicar lo mismo cuando hay desacuerdo.",
    interpretation:
      "Usad los aciertos y, si los habéis recogido, los niveles de confianza para elegir un paso que practicar en grupo. Limitad las conclusiones a las respuestas ante las dos situaciones y excluid las puntuaciones individuales de las decisiones de evaluación.",
    followUp:
      "Proponed una práctica por parejas con una preocupación ficticia. Una persona la resume y la otra confirma o corrige su interpretación. Después intercambian los papeles.",
  },
  "it-IT": {
    audience:
      "Partecipanti alla fine di un workshop o di una lezione su come ascoltare e verificare di aver capito.",
    preparation:
      "Riservate tempo per entrambe le domande e per un breve confronto. Preparate un esempio fittizio in cui una persona riformula il punto di vista di un’altra e le chiede se ha capito bene. La raccolta del livello di sicurezza è disattivata per impostazione predefinita. Se volete raccoglierlo, attivate «Chiedi il livello di sicurezza (facoltativo)» nelle impostazioni del Round.",
    facilitation:
      "Chiedete di rispondere a ogni domanda e invitate chi lo desidera a indicare quanto si sente sicuro, se l’opzione è disponibile. Chiudete le risposte alla prima domanda e mostrate la risposta corretta. Usate i comandi dell’host per avviare una spiegazione del perché è utile verificare la riformulazione con chi ha parlato. Concludete l’intervento prima di aprire la domanda di verifica collegata. Al termine della verifica, discutete come usare la stessa tecnica in caso di disaccordo.",
    interpretation:
      "Usate le risposte corrette e, se li avete raccolti, i livelli di sicurezza per scegliere un passaggio su cui esercitarvi insieme. Limitate le conclusioni alle risposte del gruppo ai due scenari e tenete i punteggi individuali fuori dalle valutazioni.",
    followUp:
      "Fate esercitare i partecipanti in coppia a partire da una preoccupazione fittizia. Una persona la riassume e l’altra conferma o corregge la riformulazione. Poi si scambiano i ruoli.",
  },
  "pt-PT": {
    audience:
      "Participantes no final de um workshop ou de uma aula sobre escutar e confirmar o que se compreendeu.",
    preparation:
      "Reservem tempo para as duas perguntas e uma breve conversa. Preparem um exemplo fictício em que alguém reformula o ponto de vista de outra pessoa e lhe pergunta se percebeu bem. A recolha do nível de confiança está desativada por predefinição. Se quiserem recolhê-lo, ativem «Pedir o nível de confiança (opcional)» na configuração da ronda.",
    facilitation:
      "Peçam uma resposta a cada pergunta e, se a opção estiver disponível, convidem os participantes a indicar o nível de confiança se quiserem. Fechem as respostas à primeira pergunta e revelem a resposta certa. Usem os controlos de moderação para iniciar uma explicação sobre a utilidade de confirmar a reformulação com quem falou. Terminem a intervenção antes de abrir a pergunta de verificação associada. Depois da verificação, discutam como aplicar a mesma técnica em caso de discordância.",
    interpretation:
      "Usem as respostas certas e os níveis de confiança que tiverem recolhido para escolher um passo a praticar em grupo. Limitem as conclusões às respostas do grupo às duas situações e excluam as pontuações individuais das decisões de avaliação.",
    followUp:
      "Proponham uma prática a pares com uma preocupação fictícia. Uma pessoa resume-a e a outra confirma ou corrige a reformulação. Depois trocam de papéis.",
  },
  "ja-JP": {
    audience:
      "相手の話を聞き、正しく理解できたかを確かめる練習をした講座やワークショップの参加者。",
    preparation:
      "2問と短い振り返りの時間を確保します。相手の意見を自分の言葉で言い換え、理解が合っているかを尋ねる架空の例を用意します。確信度は初期設定では収集しません。収集する場合は、ラウンドの設定で「確信度を尋ねる（任意）」をオンにします。",
    facilitation:
      "各質問に答えてもらいます。確信度の項目が表示される場合は、任意で回答できると伝えます。最初の質問の受付を締め切り、正解を表示します。ホストの操作画面で説明を開始し、言い換えが合っているかを話し手に確かめる理由を伝えます。介入を終了してから、連動する再確認問題を開きます。再確認の後、意見が違うときにも同じ方法をどう使うかを話し合います。",
    interpretation:
      "正答状況と、回答があれば確信度も手がかりにして、全員で練習する手順を選びます。この2場面でのグループの回答に即して考え、個人の得点は評価の判断材料から外します。",
    followUp:
      "架空の懸念を題材に2人組で練習します。一方が内容を言い換え、もう一方が理解のずれがないか確かめ、必要なら訂正します。その後、役割を交替します。",
  },
  "ko-KR": {
    audience:
      "상대의 말을 듣고 제대로 이해했는지 확인하는 방법을 다룬 워크숍이나 수업을 마치는 참여자.",
    preparation:
      "두 문항과 짧은 마무리 토의 시간을 확보하세요. 상대의 의견을 자기 말로 정리하고 제대로 이해했는지 묻는 가상의 사례를 준비하세요. 확신 정도는 기본 설정에서 수집하지 않습니다. 수집하려면 라운드 설정에서 ‘확신 정도 묻기 (선택 사항)’를 켜세요.",
    facilitation:
      "각 문항에 답해 달라고 하세요. 확신 정도를 표시하는 항목이 보이면 원하는 사람만 답하도록 안내하세요. 첫 문항의 응답을 마감하고 정답을 공개하세요. 진행자 화면에서 설명을 시작하고, 왜 말한 사람에게 요약이 맞는지 확인하면 도움이 되는지 이야기하세요. 개입을 마친 후 연결된 재확인 문항을 여세요. 재확인이 끝나면 의견이 다를 때 같은 방법을 어떻게 쓸지 이야기하세요.",
    interpretation:
      "정답 여부를 바탕으로 함께 연습할 단계를 고르세요. 확신 정도를 표시한 응답이 있다면 함께 참고하세요. 해석은 두 상황에 대한 그룹의 답변으로 한정하고, 개인 점수는 평가에 사용하지 마세요.",
    followUp:
      "가상의 우려를 소재로 짝을 지어 연습하게 하세요. 한 사람이 우려를 다시 말해 보고 다른 사람이 그 요약을 확인하거나 고쳐 준 뒤 역할을 바꿉니다.",
  },
  "zh-CN": {
    audience: "即将结束工作坊或课程，且练习过如何倾听并确认自己理解是否正确的参与者。",
    preparation:
      "为两道题和简短回顾留出时间。准备一个虚构案例，展示如何用自己的话转述别人的观点，再请对方确认自己是否理解正确。默认不收集信心程度。如需收集，请在回合设置中开启“询问信心程度（可选）”。",
    facilitation:
      "请大家回答每道题。如果显示信心程度一项，请告诉大家可自行决定是否填写。结束第一题的作答并公布正确答案。通过主持人控件启动讲解，说明请发言者确认转述有什么帮助。完成干预后再打开关联的复查题。复查结束后，讨论意见不同时如何运用同样的方法。",
    interpretation:
      "根据作答是否正确，选出一个共同练习的步骤。如果收集到了信心程度，也可以一并参考。解读限于小组对这两个情境的回答，个人得分不用于评价。",
    followUp:
      "让大家两人一组，用虚构情境中的一项担忧来练习。一人转述担忧，另一人确认或纠正转述，然后交换角色。",
  },
  "zh-TW": {
    audience: "即將結束工作坊或課程，而且練習過如何傾聽並確認自己的理解是否正確的參與者。",
    preparation:
      "為兩道題目和簡短討論預留時間。準備虛構範例，示範如何用自己的話轉述別人的觀點，並請對方確認自己的理解是否正確。信心程度預設為關閉。如要蒐集，請在回合設定中開啟「詢問信心程度（選填）」。",
    facilitation:
      "請大家回答每題。若顯示信心程度欄位，請告知大家可以自行決定是否填寫。關閉第一題的作答並公布正確答案。使用主持人控制項開始解說，說明向發言者確認轉述有什麼幫助。完成干預後，再開啟連結的複查題。複查結束後，討論意見不同時如何使用相同做法。",
    interpretation:
      "依據答題正確性選一個步驟一起練習。如果有蒐集到信心程度，也可以一併參考。解讀以小組對這兩個情境的回答為限，個人分數不作為評量依據。",
    followUp:
      "讓大家兩人一組，用虛構情境中的一項疑慮來練習。一人轉述疑慮，另一人確認或更正轉述，然後交換角色。",
  },
};

const learningNeedsGuides: Record<SupportedLocale, Omit<StarterGuide, "minutes">> = {
  "en-CA": {
    audience:
      "Learners preparing for a workshop or lesson where the starting activity, pace, or practice can still change.",
    preparation:
      "Send the Survey early. Set a deadline that gives learners time to submit and leaves time to close the run and review any available distributions before finalizing the agenda.",
    facilitation:
      "Name the upcoming topic and give learners about 5 minutes to answer independently. Point out that they can skip the familiarity and comfort ratings in questions 1 and 5. Remind them to submit when finished.",
    interpretation:
      "A question’s distribution appears only after the Survey run closes and that question has at least 5 finalized answers. Treat skipped answers as missing. Withhold details that could identify someone in a small group. Use familiarity and comfort ratings as self-reports.",
    followUp:
      "Choose a starting activity from the available results, such as a worked example, and tell learners what you’ve planned. Prepare a short check of the chosen learning goal for the end of the session.",
  },
  "fr-FR": {
    audience:
      "Les personnes qui vont participer à un atelier ou à une séance dont l’activité de départ, le rythme ou les exercices peuvent encore être adaptés.",
    preparation:
      "Envoyez l’enquête à l’avance. Fixez une échéance qui laisse aux participants le temps d’envoyer leurs réponses et vous permet de clore la collecte et d’examiner les répartitions disponibles avant d’arrêter le programme.",
    facilitation:
      "Indiquez le prochain sujet et laissez environ 5 minutes pour répondre individuellement. Précisez que les évaluations de la connaissance du sujet et de l’aisance, aux questions 1 et 5, sont facultatives. Rappelez d’envoyer le questionnaire une fois terminé.",
    interpretation:
      "La répartition des réponses à une question s’affiche uniquement après la clôture de l’enquête et si au moins 5 questionnaires soumis contiennent une réponse à cette question. Traitez les réponses sautées comme des données manquantes. Ne partagez aucun détail qui permettrait d’identifier quelqu’un dans un petit groupe. La connaissance du sujet et l’aisance sont déclarées par les participants.",
    followUp:
      "Choisissez une activité de départ selon les résultats disponibles, par exemple un exercice corrigé, et annoncez votre choix aux participants. Prévoyez une courte vérification de l’objectif retenu en fin de séance.",
  },
  "de-DE": {
    audience:
      "Lernende vor einem Workshop oder einer Unterrichtseinheit, bei denen Einstieg, Tempo oder Übungen noch angepasst werden können.",
    preparation:
      "Verschickt die Umfrage frühzeitig. Setzt eine Frist, die den Lernenden Zeit zum Absenden lässt und euch Zeit gibt, die Umfrage zu schließen und verfügbare Antwortverteilungen einzusehen, bevor ihr den Ablauf festlegt.",
    facilitation:
      "Nennt das kommende Thema und gebt den Lernenden etwa 5 Minuten, um die Fragen selbstständig zu beantworten. Weist darauf hin, dass sie die Fragen 1 und 5 zur Vertrautheit mit dem Thema und zur Sicherheit bei einer ersten Aufgabe überspringen können. Erinnert sie daran, den Fragebogen abzuschicken.",
    interpretation:
      "Eine Antwortverteilung wird erst nach dem Schließen der Umfrage angezeigt, wenn für die jeweilige Frage mindestens 5 Antworten aus abgeschickten Fragebögen vorliegen. Behandelt übersprungene Fragen als fehlende Angaben. Teilt keine Details, die in kleinen Gruppen Rückschlüsse auf Einzelne zulassen. Vertrautheit und Sicherheit sind Selbsteinschätzungen.",
    followUp:
      "Wählt anhand der verfügbaren Ergebnisse einen Einstieg, etwa ein Beispiel mit Lösungsweg, und sagt den Lernenden, was ihr vorhabt. Bereitet für das Ende der Einheit eine kurze Überprüfung des gewählten Lernziels vor.",
  },
  "es-ES": {
    audience:
      "Personas que van a participar en un taller o una clase cuya actividad inicial, ritmo o práctica se pueden ajustar.",
    preparation:
      "Enviad la encuesta con antelación. Fijad un plazo que dé tiempo para enviar las respuestas, cerrar la encuesta y revisar las distribuciones disponibles antes de cerrar el programa.",
    facilitation:
      "Indicad cuál será el próximo tema y dad unos 5 minutos para responder de forma individual. Recordad que se pueden omitir las preguntas 1 y 5 sobre familiaridad con el tema y comodidad al intentar una primera tarea. Pedid que envíen la encuesta al terminar.",
    interpretation:
      "La distribución de respuestas a una pregunta solo se muestra cuando la encuesta se ha cerrado y al menos 5 cuestionarios enviados contienen una respuesta a esa pregunta. Tratad las respuestas omitidas como datos ausentes. Evitad compartir detalles que permitan identificar a alguien en un grupo pequeño. La familiaridad con el tema y lo cómodos que se sienten ante la primera tarea son valoraciones personales.",
    followUp:
      "Elegid una actividad inicial a partir de los resultados disponibles, como un ejemplo resuelto, y contad lo que habéis previsto. Preparad una breve comprobación del objetivo de aprendizaje elegido para el final de la sesión.",
  },
  "it-IT": {
    audience:
      "Persone in procinto di partecipare a un workshop o a una lezione di cui si possono ancora adattare l’attività iniziale, il ritmo o le esercitazioni.",
    preparation:
      "Inviate il sondaggio in anticipo. Fissate una scadenza che lasci il tempo di inviare le risposte, chiudere il sondaggio e rivedere le distribuzioni disponibili prima di definire il programma.",
    facilitation:
      "Indicate il prossimo argomento e lasciate circa 5 minuti per rispondere individualmente. Ricordate che si possono saltare le domande 1 e 5 sulla familiarità e su quanto ci si sente a proprio agio nel provare una prima attività. Chiedete di inviare il questionario al termine.",
    interpretation:
      "La distribuzione delle risposte a una domanda compare solo dopo la chiusura del sondaggio e se almeno 5 questionari inviati contengono una risposta a quella domanda. Trattate le risposte saltate come dati mancanti. Omettete i dettagli che potrebbero rendere identificabile una persona in un gruppo piccolo. La familiarità e il sentirsi a proprio agio sono valutazioni personali.",
    followUp:
      "Scegliete un’attività di avvio in base ai risultati disponibili, per esempio un esercizio svolto, e comunicatela ai partecipanti. Preparate una breve verifica dell’obiettivo scelto per la fine dell’incontro.",
  },
  "pt-PT": {
    audience:
      "Participantes antes de um workshop ou de uma aula em que ainda se pode ajustar a atividade inicial, o ritmo ou a prática.",
    preparation:
      "Enviem o inquérito com antecedência. Fixem um prazo que dê tempo aos participantes para responder e que permita encerrar a recolha e consultar as distribuições disponíveis antes de fechar o programa.",
    facilitation:
      "Indiquem o próximo tema e deem cerca de 5 minutos para responder individualmente. Expliquem que é possível saltar as perguntas 1 e 5 sobre a familiaridade com o tema e à-vontade para tentar uma primeira tarefa. Lembrem os participantes de submeter o inquérito no fim.",
    interpretation:
      "A distribuição das respostas a uma pergunta só é apresentada após o encerramento do inquérito e quando pelo menos 5 questionários submetidos incluem uma resposta a essa pergunta. Tratem as respostas omitidas como dados em falta. Evitem partilhar pormenores que permitam identificar alguém num grupo pequeno. A familiaridade e o à-vontade são avaliações feitas pelos próprios participantes.",
    followUp:
      "Escolham uma atividade inicial a partir dos resultados disponíveis, como um exemplo resolvido, e digam aos participantes o que têm planeado. Preparem uma breve verificação do objetivo de aprendizagem escolhido para o fim da sessão.",
  },
  "ja-JP": {
    audience: "導入の活動、進める速さ、練習内容を調整できる講座やワークショップを控えた学習者。",
    preparation:
      "アンケートは早めに送ります。学習者が回答を送信できる期間を設け、進行内容を確定する前に受付を終了して、表示された回答分布を確認する時間も確保します。",
    facilitation:
      "次回のテーマを伝え、各自で回答する時間を5分ほど取ります。テーマへのなじみを聞く質問1と、最初の課題への取り組みやすさを聞く質問5は任意だと伝えます。回答後は送信するよう案内します。",
    interpretation:
      "アンケートの受付が終了し、送信済みの回答のうちその質問に答えたものが5件以上ある場合に限り、その質問の回答分布が表示されます。飛ばされた質問は未回答として扱います。少人数のグループで個人を特定できる情報は共有を控えます。なじみや取り組みやすさの回答は自己評価として扱います。",
    followUp:
      "得られた結果から、解き方を添えた例を示すなどの導入の活動を選び、学習者に伝えます。講座の終わりに、選んだ学習目標を短時間で確認できる課題を用意します。",
  },
  "ko-KR": {
    audience:
      "시작 활동, 진행 속도 또는 연습 방식을 아직 조정할 수 있는 워크숍이나 수업을 앞둔 학습자.",
    preparation:
      "설문을 미리 보내세요. 학습자에게 제출할 시간을 충분히 주고, 일정을 확정하기 전에 설문 회차를 마감하고 확인 가능한 응답 분포를 검토할 시간도 확보하세요.",
    facilitation:
      "다룰 주제를 알려 주고 각자 답할 시간으로 약 5분을 주세요. 주제에 대한 익숙함을 묻는 1번과 첫 과제에 얼마나 부담 없이 도전할 수 있는지 묻는 5번은 건너뛸 수 있다고 안내하세요. 응답을 마치면 제출해 달라고 하세요.",
    interpretation:
      "설문 회차가 종료되고 해당 문항에 대한 최종 제출 응답이 5개 이상일 때만 응답 분포가 표시됩니다. 건너뛴 문항은 미응답으로 처리하세요. 소규모 그룹에서 개인을 식별할 수 있는 세부 결과는 공유하지 마세요. 주제에 얼마나 익숙한지, 첫 과제에 얼마나 편하게 도전할 수 있는지는 학습자의 자기 평가입니다.",
    followUp:
      "확인 가능한 결과를 바탕으로 풀이 예시처럼 시작할 활동을 고르고 학습자에게 알려 주세요. 수업을 마칠 때 선택한 학습 목표를 짧게 확인할 활동을 준비하세요.",
  },
  "zh-CN": {
    audience: "即将参加工作坊或课程，且开场活动、节奏或练习方式仍可调整的学员。",
    preparation:
      "提前发出问卷。设定截止时间，让学员有时间提交，并留出时间在敲定议程前结束收集、查看可用的回答分布。",
    facilitation:
      "介绍即将学习的主题，给学员约 5 分钟独立填写。提醒他们，第 1 题询问对主题的熟悉程度，第 5 题询问尝试第一项任务时有多自在，这两题都可跳过。填写完毕后请他们提交。",
    interpretation:
      "问卷收集结束后，只有至少 5 份已提交的问卷回答了某道题，才会显示该题的回答分布。将跳过的题目视为未答。小组人数较少时，避免分享可能暴露个人身份的明细。对主题有多熟悉、尝试任务时有多自在，都是学员的自评。",
    followUp:
      "根据可用结果选择开场活动，例如展示一个完整示例，并告诉学员你的安排。在课程结束时安排一个简短活动，检查选定的学习目标。",
  },
  "zh-TW": {
    audience: "即將參加工作坊或課程，且開場活動、步調或練習方式仍可調整的學員。",
    preparation:
      "提早發出問卷。設定截止日期，讓學員有時間送出問卷，也預留時間在定案前結束收集並檢視可用的回覆分布。",
    facilitation:
      "介紹即將學習的主題，留約 5 分鐘讓學員個別作答。提醒學員，第 1 題詢問對主題的熟悉程度，第 5 題詢問嘗試第一項任務時有多自在，兩題都可以跳過。填完後請他們送出問卷。",
    interpretation:
      "問卷收集結束後，只有至少 5 份已送出的問卷回答了某道題，才會顯示該題的回覆分布。把跳過的題目視為未答。小組人數較少時，避免分享可能識別個人的細項。對主題有多熟悉、嘗試任務時有多自在，都是學員的自評。",
    followUp:
      "根據可用的結果選擇開場活動，例如示範一個完整範例，並告知學員你的安排。課程結束時，安排簡短活動以確認選定的學習目標。",
  },
};

export function workshopStarterGuide(
  id: StarterId,
  locale: SupportedLocale,
  survey: boolean,
): StarterGuide | undefined {
  if (id === "workshop-expectations" && !survey)
    return { ...workshopExpectationsGuides[locale], minutes: 5 };
  if (id === "exit-ticket" && !survey) return { ...exitTicketGuides[locale], minutes: 8 };
  if (id === "learning-needs" && survey) return { ...learningNeedsGuides[locale], minutes: 5 };
  return undefined;
}
