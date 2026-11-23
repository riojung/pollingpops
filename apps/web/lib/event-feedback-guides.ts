import type { StarterGuide, SupportedLocale } from "@openround/contracts";

type EventFeedbackPresentationId = "demo" | "native-event-talk";

/** Planning estimates and authored Preview guidance for the existing Presentation templates. */
export const eventFeedbackPresentationGuides: Readonly<
  Record<SupportedLocale, Readonly<Record<EventFeedbackPresentationId, Readonly<StarterGuide>>>>
> = {
  "en-CA": {
    demo: {
      audience: "Presenters and event attendees who want to see how a product handles a real task.",
      minutes: 20,
      preparation:
        "Choose one realistic task and prepare an example you can safely show. Rehearse the full workflow, confirm what success looks like and identify any limitations to explain.",
      facilitation:
        "Introduce the task and use the first poll to find what matters most to attendees. Demonstrate the task from start to finish and show the result. Ask attendees how clearly they can see the workflow fitting their work, then use the second poll to choose a follow-up.",
      interpretation:
        "The polls reflect respondents’ priorities and the support they want. The rating captures their own sense of how clearly the workflow fits their work. To check whether people can do the task themselves, observe a hands-on trial.",
      followUp:
        "Record the main unanswered question and share a practical next step, such as a relevant example or a short trial. Agree who will follow up and when.",
    },
    "native-event-talk": {
      audience:
        "Event speakers and attendees interested in how teams document and revisit everyday decisions.",
      minutes: 20,
      preparation:
        "Review the fictional community-library equipment-lending example and its four-week pilot. If you use a real example, choose one you have permission to share and carry it through all eight slides.",
      facilitation:
        "Deliver the full talk using the eight slides alone. Introduce the library’s fictional choice, compare the options and show the decision record and review date. Close by inviting listeners to reflect privately on an upcoming decision.",
      interpretation:
        "The fictional case illustrates how to document a decision and decide when to revisit it. Treat any audience comments as reactions. Assess the results of a real pilot using observations of the lending process.",
      followUp:
        "Invite listeners to record the reason, owner and review date for one decision of their own. If you want event feedback, create and share a separate, optional Round or Survey.",
    },
  },
  "fr-FR": {
    demo: {
      audience:
        "Personnes qui présentent un produit et public qui souhaite voir comment l’utiliser pour une tâche réelle.",
      minutes: 20,
      preparation:
        "Choisissez une tâche réaliste et préparez un exemple que vous pouvez montrer. Répétez l’ensemble du déroulement, vérifiez le résultat attendu et repérez les limites à expliquer.",
      facilitation:
        "Présentez la tâche et lancez le premier sondage pour savoir ce qui compte le plus pour le public. Montrez comment réaliser la tâche de bout en bout et affichez le résultat. Demandez si les participants voient clairement comment intégrer cette démarche à leur travail, puis utilisez le second sondage pour choisir la suite à donner.",
      interpretation:
        "Les sondages reflètent les priorités des répondants et l’aide qu’ils souhaitent. L’échelle indique dans quelle mesure ils voient comment intégrer la démarche à leur travail. Pour vérifier s’ils peuvent effectuer la tâche par eux-mêmes, observez-les pendant un essai pratique.",
      followUp:
        "Notez la principale question en suspens et proposez une suite concrète, par exemple un cas pertinent ou un essai court. Convenez de la personne responsable du suivi et du délai.",
    },
    "native-event-talk": {
      audience:
        "Intervenants et public d’un événement qui souhaitent savoir comment une équipe consigne et réexamine ses décisions courantes.",
      minutes: 20,
      preparation:
        "Relisez le cas fictif du prêt de matériel dans une bibliothèque de quartier et de son essai pilote de quatre semaines. Si vous utilisez un cas réel, choisissez un exemple que vous êtes autorisé à partager et gardez-le tout au long des huit diapositives.",
      facilitation:
        "Les huit diapositives suffisent pour présenter l’intégralité de l’intervention. Introduisez le choix auquel est confrontée la bibliothèque fictive, comparez les options et montrez la fiche de décision ainsi que la date de réexamen. En conclusion, invitez le public à réfléchir individuellement à une décision à venir.",
      interpretation:
        "Le cas fictif illustre comment consigner une décision et prévoir son réexamen. Les remarques du public reflètent ses réactions. Pour évaluer les résultats d’un vrai essai pilote, appuyez-vous sur des observations du processus de prêt.",
      followUp:
        "Invitez le public à noter la raison, la personne responsable et la date de réexamen d’une décision qui le concerne. Pour recueillir des retours sur l’événement, créez et partagez un Round ou une Enquête à part, avec participation facultative.",
    },
  },
  "de-DE": {
    demo: {
      audience:
        "Personen, die ein Produkt vorstellen oder sehen möchten, wie sich damit eine reale Aufgabe erledigen lässt.",
      minutes: 20,
      preparation:
        "Wählen Sie eine realistische Aufgabe und bereiten Sie ein Beispiel vor, das Sie bedenkenlos zeigen können. Proben Sie den gesamten Ablauf, prüfen Sie das erwartete Ergebnis und halten Sie fest, welche Einschränkungen Sie erläutern möchten.",
      facilitation:
        "Stellen Sie die Aufgabe vor und fragen Sie in der ersten Abstimmung, was dem Publikum am wichtigsten ist. Führen Sie die Aufgabe von Anfang bis Ende vor und zeigen Sie das Ergebnis. Fragen Sie, wie klar der Einsatz im eigenen Arbeitsalltag ist, und stimmen Sie anschließend über die nächsten Schritte ab.",
      interpretation:
        "Die Abstimmungen zeigen die Prioritäten der Antwortenden und welche Unterstützung sie wünschen. Die Bewertung zeigt, wie klar ihnen der mögliche Einsatz im eigenen Arbeitsalltag erscheint. Beobachten Sie einen praktischen Test, um zu prüfen, ob die Teilnehmenden die Aufgabe selbst erledigen können.",
      followUp:
        "Halten Sie die wichtigste offene Frage fest und schlagen Sie einen konkreten nächsten Schritt vor, etwa ein passendes Beispiel oder einen kurzen Test. Vereinbaren Sie, wer sich wann darum kümmert.",
    },
    "native-event-talk": {
      audience:
        "Vortragende und Veranstaltungsgäste, die wissen möchten, wie Teams Entscheidungen im Alltag dokumentieren und später überprüfen können.",
      minutes: 20,
      preparation:
        "Sehen Sie sich das fiktive Beispiel zum Geräteverleih in einer Stadtteilbibliothek mit seinem vierwöchigen Pilotversuch an. Wenn Sie ein reales Beispiel verwenden, wählen Sie eines, das Sie zeigen dürfen, und verwenden Sie es auf allen acht Folien.",
      facilitation:
        "Die acht Folien genügen für den gesamten Vortrag. Stellen Sie die fiktive Entscheidung der Bibliothek vor, vergleichen Sie die Optionen und zeigen Sie, wie die Entscheidung mit einem Termin zur Überprüfung festgehalten wird. Bitten Sie das Publikum zum Abschluss, für sich über eine anstehende Entscheidung nachzudenken.",
      interpretation:
        "Das fiktive Beispiel zeigt, wie sich eine Entscheidung festhalten lässt und wann man sie überprüfen kann. Äußerungen aus dem Publikum spiegeln dessen Reaktionen wider. Bewerten Sie die Ergebnisse eines echten Pilotversuchs anhand von Beobachtungen des Leihvorgangs.",
      followUp:
        "Laden Sie das Publikum ein, für eine eigene Entscheidung den Grund, die zuständige Person und den Termin zur Überprüfung festzuhalten. Wenn Sie Feedback zur Veranstaltung sammeln möchten, erstellen und teilen Sie eine separate Runde oder Umfrage mit freiwilliger Teilnahme.",
    },
  },
  "es-ES": {
    demo: {
      audience:
        "Personas que presentan un producto y asistentes que quieren ver cómo se utiliza para una tarea real.",
      minutes: 20,
      preparation:
        "Elige una tarea realista y prepara un ejemplo que puedas mostrar. Ensaya el proceso completo, comprueba el resultado esperado e identifica las limitaciones que conviene explicar.",
      facilitation:
        "Presenta la tarea y utiliza el primer sondeo para saber qué le importa más al público. Muestra cómo hacer la tarea de principio a fin y enseña el resultado. Pregunta si ven con claridad cómo encajaría el proceso en su trabajo y utiliza el segundo sondeo para elegir el siguiente paso.",
      interpretation:
        "Los sondeos recogen las prioridades de quienes responden y el apoyo que desean. La escala indica hasta qué punto ven claro cómo encajaría el proceso en su trabajo. Para comprobar si pueden realizar la tarea por su cuenta, obsérvalos en una prueba práctica.",
      followUp:
        "Anota la principal pregunta pendiente y propone un paso concreto, como compartir un ejemplo pertinente u ofrecer una prueba breve. Acordad quién hará el seguimiento y cuándo.",
    },
    "native-event-talk": {
      audience:
        "Ponentes y asistentes interesados en cómo los equipos documentan y revisan sus decisiones cotidianas.",
      minutes: 20,
      preparation:
        "Revisa el caso ficticio del préstamo de equipamiento en una biblioteca de barrio y de su prueba piloto de cuatro semanas. Si utilizas un caso real, elige uno que tengas permiso para compartir y mantenlo a lo largo de las ocho diapositivas.",
      facilitation:
        "Las ocho diapositivas bastan para dar la charla completa. Explica qué debe decidir la biblioteca ficticia, compara las opciones y muestra el registro de la decisión y su fecha de revisión. Al final, invita al público a reflexionar en privado sobre una decisión próxima.",
      interpretation:
        "El caso ficticio ilustra cómo documentar una decisión y fijar cuándo revisarla. Los comentarios del público son reacciones. Para valorar cómo ha funcionado un piloto real, observa el proceso de préstamo.",
      followUp:
        "Invita a cada asistente a anotar el motivo, la persona responsable y la fecha de revisión de una decisión propia. Si quieres recoger opiniones sobre el evento, crea y comparte una Ronda o una Encuesta por separado, con participación voluntaria.",
    },
  },
  "it-IT": {
    demo: {
      audience:
        "Chi presenta un prodotto e le persone interessate a vedere come usarlo per un’attività reale.",
      minutes: 20,
      preparation:
        "Scegli un’attività realistica e prepara un esempio che puoi mostrare. Prova l’intero flusso, verifica il risultato atteso e individua i limiti da spiegare.",
      facilitation:
        "Presenta l’attività e usa la prima votazione per capire cosa interessa di più al pubblico. Mostra l’attività dall’inizio alla fine e fai vedere il risultato. Chiedi quanto è chiaro come il flusso potrebbe inserirsi nel loro lavoro e usa la seconda votazione per scegliere il passo successivo.",
      interpretation:
        "Le votazioni riflettono le priorità e il supporto desiderato da chi ha risposto. La scala rileva quanto è chiaro, secondo i partecipanti, come usare il flusso nel proprio lavoro. Per verificare se riescono a svolgere l’attività in autonomia, osservali durante una prova pratica.",
      followUp:
        "Annota la domanda principale rimasta aperta e proponi un passo concreto, come condividere un esempio pertinente o offrire una breve prova. Concorda chi se ne occuperà e quando.",
    },
    "native-event-talk": {
      audience:
        "Relatori e partecipanti interessati a come i gruppi di lavoro documentano e riesaminano le decisioni quotidiane.",
      minutes: 20,
      preparation:
        "Rivedi il caso fittizio del prestito di attrezzature in una biblioteca di quartiere e del progetto pilota di quattro settimane. Se usi un caso reale, scegline uno che hai il permesso di condividere e mantienilo in tutte e otto le diapositive.",
      facilitation:
        "Le otto diapositive bastano per svolgere l’intero intervento. Introduci la scelta della biblioteca fittizia, confronta le opzioni e mostra la decisione registrata e la data di riesame. Invita il pubblico a riflettere individualmente su una decisione imminente.",
      interpretation:
        "Il caso fittizio mostra come documentare una decisione e scegliere quando riesaminarla. I commenti del pubblico riflettono le sue reazioni. Per valutare i risultati di un progetto pilota reale, osserva il processo di prestito.",
      followUp:
        "Invita chi ascolta ad annotare il motivo, il responsabile e la data di riesame di una propria decisione. Se vuoi raccogliere feedback sull’evento, crea e condividi a parte un Round o un Questionario a partecipazione facoltativa.",
    },
  },
  "pt-PT": {
    demo: {
      audience:
        "Pessoas que apresentam um produto e participantes que querem ver como o utilizar para uma tarefa real.",
      minutes: 20,
      preparation:
        "Escolha uma tarefa realista e prepare um exemplo que possa mostrar. Ensaie todo o processo, confirme o resultado esperado e identifique as limitações que deve explicar.",
      facilitation:
        "Apresente a tarefa e use a primeira sondagem para saber o que mais interessa a quem assiste. Demonstre a tarefa do início ao fim e mostre o resultado. Pergunte até que ponto é claro como o processo se encaixaria no trabalho dos participantes e use a segunda sondagem para escolher o passo seguinte.",
      interpretation:
        "As sondagens refletem as prioridades e o apoio pretendido por quem respondeu. A escala indica até que ponto essas pessoas veem como integrar o processo no seu trabalho. Para verificar se conseguem executar a tarefa por si, observe-as durante um teste prático.",
      followUp:
        "Registe a principal pergunta que ficou por responder e proponha um passo concreto, como partilhar um exemplo relevante ou oferecer um teste breve. Combine quem fará o acompanhamento e quando.",
    },
    "native-event-talk": {
      audience:
        "Oradores e participantes interessados em como as equipas registam e reavaliam decisões do dia a dia.",
      minutes: 20,
      preparation:
        "Reveja o caso fictício do empréstimo de equipamento numa biblioteca de bairro e do seu teste-piloto de quatro semanas. Se usar um exemplo real, escolha um que tem autorização para partilhar e mantenha-o ao longo dos oito diapositivos.",
      facilitation:
        "Os oito diapositivos bastam para apresentar a palestra completa. Explique o que a biblioteca fictícia tem de decidir, compare as opções e mostre o registo da decisão e a data de revisão. No fim, convide quem assiste a refletir individualmente sobre uma decisão próxima.",
      interpretation:
        "O caso fictício ilustra como registar uma decisão e definir quando a rever. Os comentários dos participantes refletem as suas reações. Para avaliar os resultados de um teste-piloto real, observe o processo de empréstimo.",
      followUp:
        "Convide os participantes a registar o motivo, a pessoa responsável e a data de revisão de uma decisão sua. Se quiser recolher opiniões sobre o evento, crie e partilhe uma Ronda ou um Inquérito em separado, com participação facultativa.",
    },
  },
  "ja-JP": {
    demo: {
      audience: "製品の使い方を実際の作業に沿って説明する発表者と、その使い方を知りたい参加者。",
      minutes: 20,
      preparation:
        "現実的な作業を1つ選び、公開して差し支えない例を用意します。一連の手順を通して練習し、期待する結果と説明すべき制約を確認します。",
      facilitation:
        "作業の目的を伝え、最初の投票で参加者が最も重視する点を聞きます。最初から最後まで実演し、結果を見せます。自分の仕事での使い方をどの程度イメージできたかを尋ね、2回目の投票で次にどんな情報や機会が役立つかを確認します。",
      interpretation:
        "投票は回答者が重視する点や希望する支援を示します。評価は、自分の仕事での使い方をどの程度イメージできたかという自己申告です。参加者が自力で作業できるかを確かめるには、実際に試す様子を観察します。",
      followUp:
        "最も重要な未解決の質問を記録し、関連する事例の共有や短時間の試用など、具体的な次の行動を提案します。誰がいつ対応するかを決めます。",
    },
    "native-event-talk": {
      audience: "チームの日常的な意思決定を記録し、後から見直す方法に関心のある登壇者と参加者。",
      minutes: 20,
      preparation:
        "架空の地域図書館で備品の貸し出し方法を4週間試行する事例を確認します。実際の事例に差し替える場合は、共有の許可を得たものを選び、8枚すべてで同じ事例を使います。",
      facilitation:
        "8枚のスライドだけで講演を進められます。架空の図書館が直面する選択を紹介し、選択肢を比較して、意思決定の記録と見直し日を示します。最後に、近いうちに自分が下す決定を各自で考えるよう促します。",
      interpretation:
        "架空の事例は、意思決定を記録し、見直す時期を決める方法を示します。参加者のコメントは講演への感想として扱います。実際の試行の結果を評価するには、貸し出しの状況を観察します。",
      followUp:
        "自分の決定を1つ選び、その理由、担当者、見直し日を記録するよう促します。イベントの感想を集める場合は、参加が任意のラウンドまたはアンケートを別に作成し、共有します。",
    },
  },
  "ko-KR": {
    demo: {
      audience: "제품을 시연하는 발표자와 제품으로 실제 과제를 수행하는 방법이 궁금한 행사 참가자.",
      minutes: 20,
      preparation:
        "실제 사용 상황을 반영한 과제 하나를 고르고 공개해도 되는 예시를 준비하세요. 전체 과정을 미리 시연해 보고, 기대하는 결과와 설명해야 할 제약을 확인하세요.",
      facilitation:
        "과제를 소개하고 첫 번째 투표로 참가자가 가장 중요하게 생각하는 부분을 확인하세요. 처음부터 끝까지 시연하고 결과를 보여 주세요. 각자의 업무에 이 절차를 어떻게 적용할 수 있을지 분명히 이해했는지 물은 뒤, 두 번째 투표로 어떤 후속 지원이 도움이 될지 확인하세요.",
      interpretation:
        "투표는 응답자가 중요하게 생각하는 부분과 원하는 지원을 보여 줍니다. 평가는 응답자 스스로 업무에 이 절차를 적용하는 방법을 얼마나 잘 이해했다고 보는지 나타냅니다. 스스로 과제를 수행할 수 있는지 확인하려면 직접 시도하는 모습을 살펴보세요.",
      followUp:
        "답하지 못한 질문 중 가장 중요한 것을 기록하고 관련 예시나 짧은 체험 등 구체적인 다음 단계를 알려 주세요. 누가 언제 후속 조치를 할지 정하세요.",
    },
    "native-event-talk": {
      audience:
        "팀이 일상적인 결정을 기록하고 다시 검토하는 방법에 관심 있는 행사 발표자와 참가자.",
      minutes: 20,
      preparation:
        "가상의 지역 도서관에서 장비 대여 방식을 4주간 시범 운영하는 사례를 검토하세요. 실제 사례를 사용한다면 공유가 허용된 사례를 골라 슬라이드 8장에 일관되게 사용하세요.",
      facilitation:
        "슬라이드 8장만으로 발표를 진행할 수 있습니다. 가상의 도서관이 내려야 할 결정을 소개하고, 선택지를 비교한 뒤, 결정 기록과 검토 날짜를 보여 주세요. 마무리할 때 참가자들에게 곧 내릴 결정을 각자 떠올려 보도록 권하세요.",
      interpretation:
        "가상의 사례는 결정을 기록하고 다시 검토할 시점을 정하는 방법을 보여 줍니다. 참가자 의견은 발표에 대한 반응으로 참고하세요. 실제 시범 운영의 결과는 장비 대여 과정을 관찰해 평가하세요.",
      followUp:
        "참가자에게 자신의 결정 하나를 골라 그 이유, 담당자, 검토 날짜를 기록해 보도록 권하세요. 행사 피드백을 받고 싶다면 자발적으로 참여할 수 있는 라운드나 설문을 별도로 만들어 공유하세요.",
    },
  },
  "zh-CN": {
    demo: {
      audience: "产品演示者，以及希望了解如何用该产品完成一项实际任务的活动参与者。",
      minutes: 20,
      preparation:
        "选择一项贴近实际的任务，准备一个适合公开展示的示例。预演整个流程，明确预期结果和需要说明的限制。",
      facilitation:
        "介绍任务，用第一次投票了解参与者最关心什么。完整演示操作过程并展示结果。询问参与者是否清楚这个流程可以怎样用在自己的工作中，再用第二次投票确定接下来的安排。",
      interpretation:
        "投票反映作答者关注的问题和希望获得的支持。评分反映他们自认为有多清楚这个流程可以怎样用在工作中。要了解参与者能否独立完成任务，请观察他们实际操作。",
      followUp:
        "记下最重要的未解答问题，并给出具体的下一步，例如分享相关示例或安排简短试用。商定跟进人员和时间。",
    },
    "native-event-talk": {
      audience: "想了解团队如何记录和复盘日常决策的活动演讲者及参与者。",
      minutes: 20,
      preparation:
        "熟悉虚构的社区图书馆及其为期四周的设备借用试点。如果换成真实案例，请确认可以公开分享，并在八张幻灯片中沿用同一个案例。",
      facilitation:
        "仅凭这八张幻灯片即可完成整场演讲。介绍虚构图书馆需要做出的选择，比较不同方案，展示决策记录和复盘日期。结束时请听众各自想一想近期要做的一项决定。",
      interpretation:
        "虚构案例演示如何记录决策并确定何时复盘。听众的评论反映他们对演讲的看法。要评估实际试点的结果，请观察设备借用的实际过程。",
      followUp:
        "请听众选一项自己的决定，记下理由、负责人和复盘日期。如需收集活动反馈，请另行创建并分享一个可自愿参与的互动轮次或调查。",
    },
  },
  "zh-TW": {
    demo: {
      audience: "示範產品的講者，以及想知道如何用產品完成一項實際任務的活動參與者。",
      minutes: 20,
      preparation:
        "選一項貼近實際情況的任務，準備一個適合公開展示的範例。預演整個流程，確認預期成果和需要說明的限制。",
      facilitation:
        "介紹任務，用第一次投票了解聽眾最重視哪個環節。從頭到尾示範任務並展示成果。詢問聽眾是否清楚這個流程可以如何用在自己的工作上，再用第二次投票決定接下來的安排。",
      interpretation:
        "投票反映作答者重視的部分和想得到的支援。評分反映他們自認有多清楚這個流程可以如何用在工作上。若要確認參與者是否能獨立完成任務，請觀察他們實際操作。",
      followUp:
        "記下最重要的未解答問題，提出具體的下一步，例如分享相關範例或安排短時間試用。商定由誰在何時跟進。",
    },
    "native-event-talk": {
      audience: "想了解團隊如何記錄和重新檢視日常決策的活動講者及聽眾。",
      minutes: 20,
      preparation:
        "先了解虛構的社區圖書館及其為期四週的設備借用試辦計畫。如果改用真實案例，請確認可以公開分享，並在八張投影片中沿用同一個案例。",
      facilitation:
        "只用這八張投影片，就能完成整場演講。介紹虛構圖書館要做的選擇，比較各方案並展示決策紀錄和檢視日期。最後請聽眾各自想一想近期要做的一項決定。",
      interpretation:
        "虛構案例示範如何記錄決策並決定何時重新檢視。聽眾的意見反映他們對演講的感受。若要評估實際試辦的成果，請觀察設備借用的實際過程。",
      followUp:
        "請聽眾挑一項自己的決定，記下理由、負責人和檢視日期。若想蒐集活動回饋，可另外建立並分享可自願參與的互動回合或問卷。",
    },
  },
};
