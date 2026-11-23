import type { StarterGuide, SupportedLocale } from "@openround/contracts";

type WorkshopPresentationId = "workshop" | "native-practical-workshop";

/** Planning estimates and authored Preview guidance for the existing Presentation templates. */
export const workshopPresentationGuides: Readonly<
  Record<SupportedLocale, Readonly<Record<WorkshopPresentationId, Readonly<StarterGuide>>>>
> = {
  "en-CA": {
    workshop: {
      audience: "A facilitator and a group practising one technique together, including beginners.",
      minutes: 30,
      preparation:
        "Choose one technique, prepare a worked example and a small task, and describe what a useful first attempt looks like. Check that participants have the materials and offer a starting point for beginners.",
      facilitation:
        "Use the first poll to learn what would make the session useful. Show an example and set a time limit for a first attempt. Use the second poll to decide which support to offer, then ask how ready people feel to apply the technique.",
      interpretation:
        "The polls reflect the priorities and support needs of the people who responded. The rating records how ready they feel. Review a later attempt against the task criteria to see how they apply the technique independently.",
      followUp:
        "Ask each participant to note where and when they’ll try the technique and what they’ll look for. Offer another example or feedback based on the needs they raised.",
    },
    "native-practical-workshop": {
      audience:
        "Facilitators and teams learning to turn a service handoff problem into a small experiment.",
      minutes: 25,
      preparation:
        "Review the fictional room-booking example and its service map. To adapt it, choose one real handoff you have permission to discuss and check what the service can promise.",
      facilitation:
        "Walk through the complete worked example in eight slides, from the booking handoff to a plan to test a clearer acknowledgement. Offer an optional discussion outside the app about what requesters need to know.",
      interpretation:
        "The fictional case shows how to frame a hypothesis and choose what to observe. Check whether requesters understand the message and track clarification requests in a real pilot before drawing conclusions about the change.",
      followUp:
        "If you run a pilot, agree on an owner, a start date, a review date and a signal that would prompt you to change or stop it.",
    },
  },
  "fr-FR": {
    workshop: {
      audience:
        "Personne qui anime l’atelier et groupe qui s’exerce à une technique, y compris des débutants.",
      minutes: 30,
      preparation:
        "Choisissez une technique, préparez un exemple détaillé et une tâche courte, puis décrivez ce qu’on attend d’un premier essai. Vérifiez que tout le monde a le matériel nécessaire et proposez un point de départ aux débutants.",
      facilitation:
        "Utilisez le premier sondage pour savoir ce que le groupe attend de l’atelier. Montrez un exemple et donnez un temps limité pour le premier essai. Appuyez-vous sur le second sondage pour choisir l’aide à apporter, puis demandez à chacun dans quelle mesure il se sent prêt à appliquer la technique.",
      interpretation:
        "Les sondages reflètent les priorités et les besoins d’aide des personnes qui ont répondu. L’échelle indique dans quelle mesure elles se sentent prêtes. Examinez un essai ultérieur à l’aide des critères de la tâche pour voir comment elles appliquent la technique en autonomie.",
      followUp:
        "Demandez à chacun de noter où et quand il essaiera la technique et ce qu’il observera. Proposez un autre exemple ou des retours en fonction des besoins exprimés.",
    },
    "native-practical-workshop": {
      audience:
        "Équipes qui apprennent à tester une petite amélioration dans le parcours d’un service et personnes qui animent l’atelier.",
      minutes: 25,
      preparation:
        "Relisez l’exemple fictif de réservation de salle et le schéma du service. Pour l’adapter, choisissez une étape réelle du parcours dont vous êtes autorisé à parler et vérifiez les engagements que le service peut tenir.",
      facilitation:
        "Présentez les huit diapositives, du traitement d’une demande de réservation au projet de tester un accusé de réception plus clair. Proposez, à titre facultatif et en dehors de l’application, un échange sur ce que les demandeurs ont besoin de savoir.",
      interpretation:
        "Le cas fictif montre comment formuler une hypothèse et décider quoi observer. Avant de tirer des conclusions sur le changement, vérifiez lors d’un test pilote réel si les demandeurs comprennent le message et relevez les demandes de clarification.",
      followUp:
        "Si vous lancez un test pilote, convenez d’une personne responsable, d’une date de début, d’une date de bilan et d’un signal qui justifierait de modifier ou d’arrêter le test.",
    },
  },
  "de-DE": {
    workshop: {
      audience:
        "Moderierende und Gruppen, die gemeinsam eine Methode üben möchten. Der Workshop eignet sich auch für Personen ohne Vorkenntnisse.",
      minutes: 30,
      preparation:
        "Wählen Sie eine Methode, bereiten Sie ein ausgearbeitetes Beispiel und eine kleine Aufgabe vor und beschreiben Sie, woran man einen brauchbaren ersten Versuch erkennt. Prüfen Sie, ob alle das nötige Material haben, und bieten Sie einen einfachen Einstieg an.",
      facilitation:
        "Erfragen Sie in der ersten Umfrage, was den Workshop für die Gruppe nützlich machen würde. Zeigen Sie ein Beispiel und geben Sie für den ersten Versuch ein Zeitlimit vor. Wählen Sie anhand der zweiten Umfrage passende Unterstützung aus und fragen Sie anschließend, wie gut sich die Gruppe auf die Anwendung vorbereitet fühlt.",
      interpretation:
        "Die Umfragen spiegeln die Prioritäten und den Unterstützungsbedarf der Personen wider, die geantwortet haben. Die Bewertung erfasst ihre Selbsteinschätzung. Prüfen Sie einen späteren Versuch anhand der Aufgabenkriterien, um zu sehen, wie sie die Methode selbstständig anwenden.",
      followUp:
        "Bitten Sie alle festzuhalten, wo und wann sie die Methode ausprobieren möchten und worauf sie dabei achten werden. Bieten Sie je nach geäußertem Bedarf ein weiteres Beispiel oder Rückmeldung an.",
    },
    "native-practical-workshop": {
      audience:
        "Moderierende und Teams, die lernen, ein Problem bei einer Übergabe im Serviceablauf mit einer kleinen Änderung zu untersuchen.",
      minutes: 25,
      preparation:
        "Sehen Sie sich das fiktive Beispiel zur Raumbuchung und den dargestellten Serviceablauf an. Für eine eigene Fassung wählen Sie eine reale Übergabe, die Sie besprechen dürfen, und prüfen Sie, welche Zusagen der Service einhalten kann.",
      facilitation:
        "Gehen Sie die acht Folien durch, von der Übergabe bei einer Raumbuchung bis zum geplanten Test einer verständlicheren Eingangsbestätigung. Bieten Sie bei Bedarf außerhalb der App ein freiwilliges Gespräch darüber an, was die anfragenden Personen wissen müssen.",
      interpretation:
        "Das fiktive Beispiel zeigt, wie man eine Hypothese formuliert und festlegt, was beobachtet werden soll. Prüfen Sie in einem echten Pilotversuch, ob die anfragenden Personen die Nachricht verstehen, und erfassen Sie Rückfragen, bevor Sie die Wirkung der Änderung beurteilen.",
      followUp:
        "Wenn Sie einen Pilotversuch starten, vereinbaren Sie eine verantwortliche Person, einen Starttermin, einen Auswertungstermin und ein Signal, das zu einer Änderung oder zum Abbruch führen würde.",
    },
  },
  "es-ES": {
    workshop: {
      audience:
        "Una persona que facilita el taller y un grupo que practica una técnica, incluidas personas que la prueban por primera vez.",
      minutes: 30,
      preparation:
        "Elige una técnica, prepara un ejemplo resuelto y una tarea breve, y explica qué se espera de un primer intento. Comprueba que el grupo tiene el material necesario y ofrece un punto de partida a quienes se inician.",
      facilitation:
        "Usa la primera encuesta para averiguar qué haría útil el taller. Muestra un ejemplo y fija un tiempo para el primer intento. Usa la segunda encuesta para decidir qué apoyo ofrecer y pregunta en qué medida se sienten capaces de aplicar la técnica.",
      interpretation:
        "Las encuestas reflejan las prioridades y el apoyo que necesitan quienes han respondido. La escala recoge en qué medida se sienten preparados. Revisa un intento posterior según los criterios de la tarea para ver cómo aplican la técnica por su cuenta.",
      followUp:
        "Pide a cada persona que anote dónde y cuándo probará la técnica y en qué se fijará. Ofrece otro ejemplo o comentarios según las necesidades que hayan expresado.",
    },
    "native-practical-workshop": {
      audience:
        "Personas que facilitan talleres y equipos que quieren aprender a probar un pequeño cambio en el traspaso de información de un servicio.",
      minutes: 25,
      preparation:
        "Revisa el ejemplo ficticio de la reserva de una sala y el mapa del servicio. Para adaptarlo, elige un traspaso real que tengas permiso para comentar y comprueba qué compromisos puede cumplir el servicio.",
      facilitation:
        "Recorre las ocho diapositivas, desde el traspaso durante la reserva hasta el plan para probar un acuse de recibo más claro. Ofrece una conversación opcional fuera de la aplicación sobre lo que necesitan saber quienes solicitan la reserva.",
      interpretation:
        "El caso ficticio muestra cómo formular una hipótesis y decidir qué observar. Antes de sacar conclusiones sobre el cambio, comprueba en un piloto real si se entiende el mensaje y registra las peticiones de aclaración.",
      followUp:
        "Si ponéis en marcha un piloto, acordad quién se hará cargo, cuándo empezará, cuándo lo revisaréis y qué señal os llevaría a modificarlo o detenerlo.",
    },
  },
  "it-IT": {
    workshop: {
      audience:
        "Chi conduce il laboratorio e un gruppo che si esercita con una tecnica, anche per la prima volta.",
      minutes: 30,
      preparation:
        "Scegli una tecnica, prepara un esempio svolto e un’attività breve e spiega che cosa ci si aspetta da un primo tentativo. Verifica che tutti abbiano il materiale necessario e offri un punto di partenza a chi è alle prime armi.",
      facilitation:
        "Usa il primo sondaggio per capire che cosa renderebbe utile l’incontro. Mostra un esempio e dai un tempo definito per il primo tentativo. Usa il secondo sondaggio per scegliere quale supporto offrire e chiedi alle persone quanto si sentono pronte ad applicare la tecnica.",
      interpretation:
        "I sondaggi riflettono le priorità e le esigenze di supporto di chi ha risposto. La scala indica quanto le persone si sentono pronte. Esamina un tentativo successivo in base ai criteri dell’attività per vedere come applicano la tecnica in autonomia.",
      followUp:
        "Chiedi a ogni persona di annotare dove e quando proverà la tecnica e che cosa osserverà. Proponi un altro esempio o dai un riscontro in base alle esigenze emerse.",
    },
    "native-practical-workshop": {
      audience:
        "Facilitatori e gruppi che vogliono imparare a testare un piccolo cambiamento in un passaggio di un servizio.",
      minutes: 25,
      preparation:
        "Esamina l’esempio immaginario della prenotazione di una sala e lo schema del servizio. Per adattarlo, scegli un passaggio reale di cui puoi parlare e verifica quali impegni il servizio può rispettare.",
      facilitation:
        "Percorri le otto diapositive, dal passaggio di informazioni durante la prenotazione al piano per testare un messaggio più chiaro che attesti la ricezione della richiesta. Proponi, come attività facoltativa fuori dall’app, un confronto su che cosa deve sapere chi fa richiesta.",
      interpretation:
        "Il caso immaginario mostra come formulare un’ipotesi e scegliere che cosa osservare. Prima di trarre conclusioni sul cambiamento, verifica in una prova pilota reale se chi fa richiesta capisce il messaggio e registra le richieste di chiarimento.",
      followUp:
        "Se avviate una prova pilota, concordate chi ne è responsabile, la data di inizio, la data di verifica e un segnale che vi porterebbe a modificarla o interromperla.",
    },
  },
  "pt-PT": {
    workshop: {
      audience:
        "Quem orienta o workshop e um grupo que vai praticar uma técnica, incluindo pessoas que a experimentam pela primeira vez.",
      minutes: 30,
      preparation:
        "Escolha uma técnica, prepare um exemplo resolvido e uma tarefa breve, e descreva o que se espera de uma primeira tentativa. Confirme que todos têm os materiais necessários e dê um ponto de partida a quem está a começar.",
      facilitation:
        "Use a primeira sondagem para perceber o que tornaria a sessão útil. Mostre um exemplo e defina um tempo para a primeira tentativa. Use a segunda sondagem para escolher o apoio a dar e pergunte até que ponto as pessoas se sentem preparadas para aplicar a técnica.",
      interpretation:
        "As sondagens refletem as prioridades e necessidades de apoio de quem respondeu. A escala regista até que ponto se sentem preparados. Reveja uma tentativa posterior segundo os critérios da tarefa para perceber como aplicam a técnica de forma autónoma.",
      followUp:
        "Peça a cada pessoa que anote onde e quando vai experimentar a técnica e o que vai observar. Partilhe outro exemplo ou dê feedback em função das necessidades identificadas.",
    },
    "native-practical-workshop": {
      audience:
        "Quem orienta workshops e equipas que querem aprender a testar uma pequena alteração na passagem de informação num serviço.",
      minutes: 25,
      preparation:
        "Reveja o exemplo fictício de reserva de sala e o esquema do serviço. Para o adaptar, escolha uma passagem de informação real que tenha autorização para discutir e verifique os compromissos que o serviço pode cumprir.",
      facilitation:
        "Percorra os oito diapositivos, desde a passagem de informação no processo de reserva até ao plano para testar uma mensagem de receção mais clara. Proponha uma conversa opcional fora da aplicação sobre o que precisa de saber quem pede a reserva.",
      interpretation:
        "O caso fictício mostra como formular uma hipótese e escolher o que observar. Antes de tirar conclusões sobre a alteração, verifique num teste-piloto real se quem faz o pedido compreende a mensagem e registe os pedidos de esclarecimento.",
      followUp:
        "Se avançar com um teste-piloto, combine quem fica responsável, as datas de início e de revisão e um sinal que levaria a alterar ou parar o teste.",
    },
  },
  "ja-JP": {
    workshop: {
      audience: "1つの手法を一緒に練習するグループと進行役。初めて試す参加者も対象です。",
      minutes: 30,
      preparation:
        "扱う手法を1つ選び、手順が分かる見本と短い課題を用意します。最初の試行で何ができればよいかを示し、必要な資料や道具がそろっているか確認します。初めての人には取りかかり方も案内します。",
      facilitation:
        "最初の投票で、どんな内容なら役立つかを聞きます。見本を示し、時間を区切って試してもらいます。2回目の投票を参考にどんな支援をするか決め、その手法を自分の場面でどの程度使えそうかを尋ねます。",
      interpretation:
        "投票には回答者が重視する点と必要な支援が表れます。準備度の評価は本人の感覚を示します。自力でどう使えるかは、後日取り組んだ課題を基準に照らして確認します。",
      followUp:
        "参加者に、どこでいつ手法を試すか、何を確認するかをメモしてもらいます。挙がった要望に応じて別の見本やフィードバックを提供します。",
    },
    "native-practical-workshop": {
      audience:
        "サービスの情報の受け渡しに関する課題に、小さな変更で対応する方法を学ぶチームと進行役。",
      minutes: 25,
      preparation:
        "架空の部屋予約サービスの事例と業務の流れを確認します。応用する場合は、取り上げる許可を得た実際の情報の受け渡しを1つ選び、サービスがどこまで確実に対応できるかを確認します。",
      facilitation:
        "予約に関する情報の受け渡しから、より分かりやすい受付通知を試す計画まで、8枚のスライドで説明します。希望に応じて、予約を申し込む人が何を知る必要があるかをアプリ外で話し合います。",
      interpretation:
        "架空の事例は、仮説の立て方と観察する項目の決め方を示しています。変更の効果を判断する前に、実際の試行で申し込みをした人が通知を理解できたかを確認し、問い合わせを記録します。",
      followUp: "試行する場合は、担当者、開始日、見直しの日、変更や中止を判断する目安を決めます。",
    },
  },
  "ko-KR": {
    workshop: {
      audience:
        "한 가지 기법을 함께 연습하는 참가자와 진행자. 처음 시도하는 사람도 참여할 수 있습니다.",
      minutes: 30,
      preparation:
        "기법 하나를 고르고, 과정을 보여 주는 예시와 짧은 과제를 준비한 뒤 첫 시도에서 기대하는 결과를 설명하세요. 참가자에게 필요한 자료가 있는지 확인하고, 처음 접하는 사람에게는 시작 방법을 안내하세요.",
      facilitation:
        "첫 투표로 참가자가 세션에서 무엇을 얻고 싶은지 알아보세요. 예시를 보여 주고 시간을 정해 첫 시도를 해 보게 하세요. 두 번째 투표를 참고해 어떤 도움을 줄지 정하고, 각자 이 기법을 적용할 준비가 얼마나 되었다고 느끼는지 물어보세요.",
      interpretation:
        "투표에는 응답자가 중요하게 여기는 점과 필요한 지원이 드러납니다. 준비도 평가는 참가자가 스스로 느끼는 준비 상태를 보여 줍니다. 혼자 어떻게 적용하는지 확인하려면 나중에 시도한 과제를 기준에 따라 살펴보세요.",
      followUp:
        "참가자 각자 어디서 언제 이 기법을 써 보고 무엇을 살펴볼지 적게 하세요. 참가자가 말한 필요에 맞춰 다른 예시나 피드백을 제공하세요.",
    },
    "native-practical-workshop": {
      audience:
        "서비스에서 정보가 전달되는 과정의 문제를 작은 실험으로 다루는 법을 배우는 팀과 진행자.",
      minutes: 25,
      preparation:
        "가상의 공간 예약 사례와 서비스 흐름도를 검토하세요. 실제 상황에 맞게 바꿀 때는 다룰 수 있도록 허락받은 정보 전달 과정 하나를 골라 서비스가 지킬 수 있는 약속을 확인하세요.",
      facilitation:
        "예약 정보가 전달되는 과정부터 더 명확한 접수 안내 메시지를 시험하는 계획까지, 슬라이드 여덟 장으로 설명하세요. 필요하면 원하는 참가자와 앱 밖에서 예약 신청자가 알아야 할 내용을 논의하세요.",
      interpretation:
        "가상 사례는 가설을 세우고 무엇을 관찰할지 정하는 방법을 보여 줍니다. 실제 시범 운영에서 신청자가 메시지를 이해하는지 확인하고 추가 문의를 기록한 뒤 변경의 효과를 판단하세요.",
      followUp:
        "시범 운영을 한다면 책임자와 시작일, 검토일, 그리고 운영을 변경하거나 중단할 판단 기준을 정하세요.",
    },
  },
  "zh-CN": {
    workshop: {
      audience: "一起练习一种方法的参与者及主持人，适合初学者参加。",
      minutes: 30,
      preparation:
        "选定一种方法，准备一个完整示例和一项简短任务，并说明初次尝试应达到什么要求。确认参与者有所需材料，并为初学者提供入门指引。",
      facilitation:
        "通过第一次投票了解参与者希望从活动中获得什么。展示示例，并限定第一次练习的时间。参考第二次投票决定提供哪些帮助，再请参与者评估自己有多大把握在实际场景中应用这种方法。",
      interpretation:
        "投票反映了回答者重视的内容和需要的帮助。准备度评分反映的是他们自己的感受。可在之后按任务标准查看另一次尝试，了解他们如何独立应用这种方法。",
      followUp:
        "请每位参与者记下打算在哪里、什么时候尝试这种方法，以及准备观察什么。根据他们提出的需求，再提供一个示例或给出反馈。",
    },
    "native-practical-workshop": {
      audience: "希望学习如何用小规模试验处理服务交接问题的团队和主持人。",
      minutes: 25,
      preparation:
        "查看虚构的场地预订案例和服务流程图。如需改编，请选择一个获准讨论的真实交接环节，并确认服务方能兑现哪些承诺。",
      facilitation:
        "用八张幻灯片讲解完整案例，从预订信息交接到制定试验计划，检验更清晰的回执。可在应用之外安排自愿讨论，交流预订申请人需要知道哪些信息。",
      interpretation:
        "虚构案例展示了如何提出假设并确定观察内容。要判断改动的效果，先在实际试点中确认申请人能否看懂通知，并记录他们提出的澄清问题。",
      followUp:
        "如果开展试点，请确定负责人、开始日期、复盘日期，以及什么情况会促使团队调整或停止试点。",
    },
  },
  "zh-TW": {
    workshop: {
      audience: "一起練習一項方法的參與者與帶領者，初學者也適合參加。",
      minutes: 30,
      preparation:
        "選定一項方法，準備完整範例和一個簡短任務，並說明初次嘗試要做到哪些事。確認參與者有所需材料，並提供初學者入門指引。",
      facilitation:
        "用第一個投票了解參與者希望從活動中獲得什麼。示範做法，並設定第一次練習的時間。參考第二個投票決定要提供哪些協助，再詢問參與者覺得自己有多大把握在實際情境中運用這項方法。",
      interpretation:
        "投票反映填答者重視的事和需要的協助。準備度評分反映他們自己的感受。之後可依任務標準檢視另一次嘗試，了解他們如何獨立運用這項方法。",
      followUp:
        "請每位參與者記下打算在何處、何時嘗試這項方法，以及準備觀察什麼。依他們提出的需求再提供一個範例或給予回饋。",
    },
    "native-practical-workshop": {
      audience: "想學習如何用小規模試驗處理服務交接問題的團隊與帶領者。",
      minutes: 25,
      preparation:
        "查看虛構的場地預約案例及服務流程圖。若要改編，請選擇一個獲准討論的實際交接環節，並確認服務方能履行哪些承諾。",
      facilitation:
        "用八張投影片說明完整案例，從預約資訊交接一路講到如何規劃試驗，檢驗更清楚的回執。可在應用程式外安排自願參加的討論，交流預約申請人需要知道哪些資訊。",
      interpretation:
        "虛構案例示範如何提出假設並決定觀察項目。要判斷改動的效果，先在實際試辦時確認申請人能否看懂通知，並記錄他們需要進一步確認的問題。",
      followUp:
        "如果要試辦，請確認負責人、開始日期、檢討日期，以及什麼情況會促使團隊調整或停止試辦。",
    },
  },
};
