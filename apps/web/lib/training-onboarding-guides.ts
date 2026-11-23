import type { StarterGuide, SupportedLocale } from "@openround/contracts";

type TrainingOnboardingPresentationId = "training" | "onboarding";

/** Planning estimates and authored Preview guidance for the existing Presentation templates. */
export const trainingOnboardingPresentationGuides: Readonly<
  Record<
    SupportedLocale,
    Readonly<Record<TrainingOnboardingPresentationId, Readonly<StarterGuide>>>
  >
> = {
  "en-CA": {
    training: {
      audience: "Learners in a short training session who can practise recalling one useful idea.",
      minutes: 15,
      preparation:
        "Choose one idea learners have seen and a familiar example for practice. If you adapt the diagnostic or its linked recheck, verify the correct choice and explanation for both questions.",
      facilitation:
        "Ask the opening question before explaining the answer. Demonstrate recall with notes closed and give learners a brief practice turn. Open the linked recheck for a new situation, then ask learners how ready they feel to try the technique.",
      interpretation:
        "The scored answers show how learners responded to two specific situations. The readiness rating captures how confident they feel. To check independent use, ask learners to demonstrate the technique on another task.",
      followUp:
        "Ask each learner to pick a topic, recall it without notes tomorrow and check what they missed against the source. At the next session, revisit a common gap and try another example.",
    },
    onboarding: {
      audience: "New teammates in their first week and the person guiding their first steps.",
      minutes: 20,
      preparation:
        "Add the team’s purpose and name a contact for questions. Choose one low-risk task suited to the role, bring an example and confirm access to the tools needed.",
      facilitation:
        "Use the support poll to choose what to explain first. Walk through the example and agree on a first task with support. Ask how clear it is where to get help and offer a way to ask questions privately.",
      interpretation:
        "The poll captures what support people want and the rating captures how clear the help route feels. Check access and task progress directly with each new teammate.",
      followUp:
        "Share the first task, example and support contact in writing. Set a check-in for later in the first week to review the attempt, clear blockers and agree on the next step.",
    },
  },
  "fr-FR": {
    training: {
      audience:
        "Personnes en formation qui peuvent s’entraîner à restituer une idée utile de mémoire.",
      minutes: 15,
      preparation:
        "Choisissez une idée déjà abordée et un exemple familier pour l’exercice. Si vous adaptez la question de départ ou la question de vérification associée, vérifiez la bonne réponse et l’explication des deux questions.",
      facilitation:
        "Posez la première question avant d’expliquer la réponse. Montrez comment restituer une idée sans consulter ses notes, puis laissez le groupe essayer. Ouvrez la question de vérification associée, qui présente une nouvelle situation, puis demandez aux participants s’ils se sentent prêts à utiliser la méthode.",
      interpretation:
        "Les réponses notées donnent une indication sur deux situations précises. L’échelle indique dans quelle mesure les participants se sentent prêts. Pour vérifier qu’ils peuvent appliquer la méthode seuls, demandez-leur de l’utiliser dans une autre tâche.",
      followUp:
        "Demandez à chacun de choisir un sujet, de le restituer de mémoire le lendemain et de vérifier ses oublis à l’aide du support d’origine. À la séance suivante, revenez sur une difficulté commune et proposez un autre exemple.",
    },
    onboarding: {
      audience:
        "Nouveaux membres de l’équipe pendant leur première semaine et personne qui les accompagne.",
      minutes: 20,
      preparation:
        "Précisez la mission de l’équipe et nommez une personne à qui poser des questions. Choisissez une tâche à faible risque adaptée au poste, apportez un exemple et vérifiez l’accès aux outils nécessaires.",
      facilitation:
        "Utilisez le sondage sur les besoins d’aide pour choisir ce qu’il faut expliquer en premier. Parcourez l’exemple et convenez d’une première tâche à réaliser avec de l’aide. Demandez si chacun sait où trouver de l’aide et proposez un moyen de poser des questions en privé.",
      interpretation:
        "Le sondage indique l’aide souhaitée et l’échelle indique dans quelle mesure chacun sait vers qui se tourner. Vérifiez directement avec chaque personne ses accès et l’avancement de sa tâche.",
      followUp:
        "Communiquez par écrit la première tâche, l’exemple et le contact. Fixez un point plus tard dans la première semaine pour revenir sur l’essai, lever les obstacles et convenir de la prochaine étape.",
    },
  },
  "de-DE": {
    training: {
      audience:
        "Lernende in einer kurzen Schulung, die üben, sich an eine nützliche Idee zu erinnern.",
      minutes: 15,
      preparation:
        "Wählen Sie eine bereits behandelte Idee und ein vertrautes Übungsbeispiel. Wenn Sie die Einstiegsfrage oder die verknüpfte Kontrollfrage anpassen, prüfen Sie bei beiden Fragen die richtige Antwort und die Erklärung.",
      facilitation:
        "Stellen Sie die Einstiegsfrage, bevor Sie die Antwort erklären. Zeigen Sie, wie man sich ohne Notizen an eine Idee erinnert, und lassen Sie die Gruppe kurz üben. Öffnen Sie dann die verknüpfte Kontrollfrage mit einer neuen Situation und fragen Sie, wie sicher sich die Lernenden bei der Anwendung der Methode fühlen.",
      interpretation:
        "Die bewerteten Antworten zeigen, wie die Lernenden auf zwei konkrete Situationen reagiert haben. Die Bewertung der eigenen Bereitschaft zeigt, wie sicher sie sich fühlen. Lassen Sie die Methode an einer weiteren Aufgabe vorführen, um die selbstständige Anwendung zu prüfen.",
      followUp:
        "Bitten Sie alle, ein Thema zu wählen, es am nächsten Tag ohne Notizen wiederzugeben und mögliche Lücken mit dem ursprünglichen Lernmaterial abzugleichen. Besprechen Sie beim nächsten Termin eine häufige Lücke und probieren Sie ein weiteres Beispiel aus.",
    },
    onboarding: {
      audience: "Neue Teammitglieder in ihrer ersten Woche und die Person, die sie einarbeitet.",
      minutes: 20,
      preparation:
        "Ergänzen Sie den Auftrag des Teams und benennen Sie eine Ansprechperson für Fragen. Wählen Sie eine risikoarme Aufgabe, die zur Rolle passt, bringen Sie ein Beispiel mit und prüfen Sie den Zugang zu den nötigen Werkzeugen.",
      facilitation:
        "Nutzen Sie die Umfrage zum Unterstützungsbedarf, um zu entscheiden, was Sie zuerst erklären. Gehen Sie das Beispiel durch und vereinbaren Sie eine erste Aufgabe mit Unterstützung. Fragen Sie, wie klar der Weg zur Hilfe ist, und bieten Sie an, Fragen vertraulich zu stellen.",
      interpretation:
        "Die Umfrage zeigt, welche Unterstützung gewünscht wird. Die Skala zeigt, wie klar der Weg zur Hilfe ist. Prüfen Sie Zugang und Aufgabenfortschritt direkt mit jedem neuen Teammitglied.",
      followUp:
        "Teilen Sie die erste Aufgabe, das Beispiel und die Ansprechperson schriftlich mit. Vereinbaren Sie noch für die erste Woche einen Termin, um den Versuch zu besprechen, Hindernisse zu beseitigen und den nächsten Schritt festzulegen.",
    },
  },
  "es-ES": {
    training: {
      audience:
        "Personas en una sesión breve de formación que pueden practicar cómo recordar una idea útil.",
      minutes: 15,
      preparation:
        "Elige una idea que ya hayan visto y un ejemplo conocido para practicar. Si adaptas la pregunta inicial o la comprobación vinculada, verifica la respuesta correcta y la explicación de ambas preguntas.",
      facilitation:
        "Plantea la pregunta inicial antes de explicar la respuesta. Muestra cómo recordar una idea con los apuntes cerrados y da tiempo para un intento breve. Abre la comprobación vinculada con una situación nueva y pregunta en qué medida se sienten capaces de probar la técnica.",
      interpretation:
        "Las respuestas puntuadas muestran cómo ha respondido el grupo a dos situaciones concretas. La escala recoge la confianza que declara cada persona. Para comprobar el uso autónomo, pide que demuestren la técnica en otra tarea.",
      followUp:
        "Pide que cada persona elija un tema, lo recuerde sin apuntes al día siguiente y consulte el material original para detectar lo que ha olvidado. En la siguiente sesión, repasa una dificultad común y prueba con otro ejemplo.",
    },
    onboarding: {
      audience: "Personas recién incorporadas al equipo en su primera semana y quien las acompaña.",
      minutes: 20,
      preparation:
        "Añade el propósito del equipo y el nombre de una persona de contacto para las dudas. Elige una tarea de bajo riesgo acorde con el puesto, trae un ejemplo y confirma que tienen acceso a las herramientas necesarias.",
      facilitation:
        "Usa la encuesta sobre necesidades de apoyo para elegir qué explicar primero. Revisa el ejemplo y acordad una primera tarea con ayuda. Pregunta si queda claro dónde pedir apoyo y ofrece una vía para plantear dudas en privado.",
      interpretation:
        "La encuesta recoge qué apoyo se desea y la escala refleja si queda claro dónde pedirlo. Comprueba directamente con cada integrante el acceso a las herramientas y el progreso en la tarea.",
      followUp:
        "Comparte por escrito la primera tarea, el ejemplo y la persona de contacto. Fija una reunión breve más adelante en la primera semana para repasar el intento, resolver obstáculos y acordar el siguiente paso.",
    },
  },
  "it-IT": {
    training: {
      audience:
        "Persone in una breve sessione di formazione che possono esercitarsi a richiamare un’idea utile alla memoria.",
      minutes: 15,
      preparation:
        "Scegli un’idea già affrontata e un esempio familiare per l’esercizio. Se adatti la domanda iniziale o la verifica collegata, controlla la risposta corretta e la spiegazione di entrambe le domande.",
      facilitation:
        "Fai la domanda iniziale prima di spiegare la risposta. Mostra come richiamare un’idea senza consultare gli appunti e lascia al gruppo il tempo per un breve tentativo. Apri la verifica collegata con una situazione nuova, poi chiedi quanto si sentono pronti a provare la tecnica.",
      interpretation:
        "Le risposte con punteggio mostrano come le persone hanno risposto in due situazioni specifiche. La valutazione indica quanto si sentono sicure. Per verificare l’uso in autonomia, chiedi di dimostrare la tecnica in un’altra attività.",
      followUp:
        "Chiedi a ogni persona di scegliere un argomento, ripeterlo il giorno successivo senza appunti e verificare le lacune sul materiale originale. Nella prossima sessione riprendi una difficoltà comune e prova un altro esempio.",
    },
    onboarding: {
      audience: "Persone al loro ingresso nel team durante la prima settimana e chi le accompagna.",
      minutes: 20,
      preparation:
        "Aggiungi lo scopo del team e indica una persona a cui rivolgere le domande. Scegli un’attività a basso rischio adatta al ruolo, porta un esempio e verifica l’accesso agli strumenti necessari.",
      facilitation:
        "Usa il sondaggio sui bisogni di supporto per decidere da dove cominciare. Esaminate l’esempio e concordate una prima attività da svolgere con il supporto di un collega. Chiedi se è chiaro a chi rivolgersi e offri un modo per fare domande in privato.",
      interpretation:
        "Il sondaggio rileva quale supporto è richiesto. La scala indica quanto è chiaro dove chiederlo. Verifica direttamente con ogni nuova persona l’accesso agli strumenti e lo stato dell’attività.",
      followUp:
        "Condividi per iscritto la prima attività, l’esempio e il contatto di riferimento. Fissa un breve incontro entro la fine della prima settimana per rivedere il tentativo, risolvere gli ostacoli e concordare il prossimo passo.",
    },
  },
  "pt-PT": {
    training: {
      audience:
        "Pessoas numa sessão breve de formação que podem praticar a recuperação de uma ideia útil de memória.",
      minutes: 15,
      preparation:
        "Escolha uma ideia já abordada e um exemplo conhecido para a prática. Se adaptar a pergunta inicial ou a verificação associada, confirme a resposta correta e a explicação de ambas as perguntas.",
      facilitation:
        "Faça a pergunta inicial antes de explicar a resposta. Mostre como recuperar uma ideia sem consultar os apontamentos e dê tempo para uma tentativa breve. Abra a verificação associada com uma situação nova e pergunte em que medida se sentem preparados para experimentar a técnica.",
      interpretation:
        "As respostas com pontuação mostram como o grupo respondeu em duas situações concretas. A escala regista a confiança declarada. Para verificar a aplicação autónoma, peça que demonstrem a técnica noutra tarefa.",
      followUp:
        "Peça a cada pessoa que escolha um tema, o recorde sem apontamentos no dia seguinte e consulte o material original para identificar o que esqueceu. Na sessão seguinte, retome uma dificuldade comum e experimente outro exemplo.",
    },
    onboarding: {
      audience:
        "Novos membros da equipa na primeira semana e a pessoa que os orienta nos primeiros passos.",
      minutes: 20,
      preparation:
        "Indique a missão da equipa e identifique um contacto para dúvidas. Escolha uma tarefa de baixo risco adequada à função, leve um exemplo e confirme o acesso às ferramentas necessárias.",
      facilitation:
        "Use a sondagem sobre necessidades de apoio para escolher o que explicar primeiro. Percorra o exemplo e combine uma primeira tarefa com apoio. Pergunte se é claro onde pedir ajuda e disponibilize uma forma de fazer perguntas em privado.",
      interpretation:
        "A sondagem indica que apoio é desejado e a escala indica em que medida é claro onde o pedir. Verifique o acesso e o progresso na tarefa diretamente com cada novo membro da equipa.",
      followUp:
        "Partilhe por escrito a primeira tarefa, o exemplo e o contacto de apoio. Marque uma conversa ainda na primeira semana para rever a tentativa, resolver obstáculos e combinar o passo seguinte.",
    },
  },
  "ja-JP": {
    training: {
      audience: "短時間の研修で、役立つ考え方を1つ思い出す練習をする参加者。",
      minutes: 15,
      preparation:
        "参加者がすでに学んだ考え方を1つ選び、身近な例を用意します。最初の理解度チェックや、それにひもづく再チェックの設問を変更する場合は、両方の正解と解説を確認します。",
      facilitation:
        "答えを説明する前に最初の質問を出します。ノートを閉じて思い出す方法を実演し、参加者が短く試す時間を取ります。新しい場面を使った再チェックを開き、この方法をどの程度試せそうかを尋ねます。",
      interpretation:
        "採点される回答は、2つの具体的な場面で参加者がどう答えたかを示します。準備度の評価は、本人がどの程度自信を持っているかを示します。自力で使えるかを確認するには、別の課題で実演してもらいます。",
      followUp:
        "参加者に題材を1つ選んでもらい、翌日にノートを見ずに思い出し、元の資料で抜けた点を確かめてもらいます。次回はつまずきが多かった点を取り上げ、別の例を試します。",
    },
    onboarding: {
      audience: "参加から1週間以内の新しいチームメンバーと、その案内役。",
      minutes: 20,
      preparation:
        "チームの目的と、質問できる担当者を記入します。役割に合ったリスクの低い最初の作業を選び、見本を用意し、必要なツールを使えることを確認します。",
      facilitation:
        "必要な支援についての投票を使い、最初に説明する内容を決めます。見本を一緒に確認し、支援を受けながら取り組む作業を決めます。困ったときの相談先が明確かを尋ね、個別に質問できる方法も案内します。",
      interpretation:
        "投票は希望する支援を、評価は相談先がどの程度明確かを示します。ツールへのアクセスと作業の進み具合は、新しいメンバーそれぞれと直接確認します。",
      followUp:
        "最初の作業、見本、相談先を文面で共有します。初週のうちに確認の時間を設け、試した結果を振り返り、困りごとを解消し、次の行動を決めます。",
    },
  },
  "ko-KR": {
    training: {
      audience: "짧은 교육 세션에서 유용한 개념 하나를 기억해 내는 연습을 할 학습자.",
      minutes: 15,
      preparation:
        "학습자가 이미 접한 개념 하나와 익숙한 연습 예시를 고르세요. 첫 진단 문항이나 연결된 재확인 문항을 바꾼다면 두 문항의 정답과 해설을 모두 확인하세요.",
      facilitation:
        "답을 설명하기 전에 첫 문항을 제시하세요. 노트를 덮고 기억해 내는 방법을 보여 준 뒤 잠시 연습할 시간을 주세요. 새로운 상황을 다루는 연결된 재확인 문항을 열고 이 방법을 시도할 준비가 얼마나 되었는지 물어보세요.",
      interpretation:
        "채점된 응답은 학습자가 두 가지 상황에 어떻게 답했는지 보여 줍니다. 준비도 평가는 학습자 스스로 느끼는 자신감을 보여 줍니다. 혼자서도 사용할 수 있는지 확인하려면 다른 과제에서 이 방법을 보여 달라고 하세요.",
      followUp:
        "각자 주제 하나를 골라 다음 날 노트 없이 기억해 낸 뒤, 원래 자료와 비교해 빠뜨린 내용을 확인하도록 하세요. 다음 세션에서 여러 사람이 어려워한 부분을 짚고 다른 예시를 연습하세요.",
    },
    onboarding: {
      audience: "합류 첫 주의 새 팀원과 첫 업무를 안내하는 담당자.",
      minutes: 20,
      preparation:
        "팀의 목적과 질문할 수 있는 담당자를 적으세요. 역할에 맞고 부담이 적은 첫 과제를 고르고, 예시를 준비한 뒤 필요한 도구에 접근할 수 있는지 확인하세요.",
      facilitation:
        "지원이 필요한 부분을 묻는 투표로 먼저 설명할 내용을 정하세요. 예시를 함께 살펴보고 도움을 받아 진행할 첫 과제를 정하세요. 어디에 도움을 요청할 수 있는지 분명한지 물어보고, 개인적으로 질문할 방법도 안내하세요.",
      interpretation:
        "투표는 어떤 지원을 원하는지 보여 주고, 평가는 도움을 받을 곳이 얼마나 분명한지 보여 줍니다. 도구에 접근할 수 있는지와 과제 진행 상황은 새 팀원 각자와 직접 확인하세요.",
      followUp:
        "첫 과제, 예시, 도움을 받을 담당자를 글로 공유하세요. 첫 주 안에 짧게 만날 시간을 잡아 시도한 내용을 돌아보고, 막힌 점을 해결하고, 다음 단계를 정하세요.",
    },
  },
  "zh-CN": {
    training: {
      audience: "参加短时培训、练习凭记忆复述一个实用概念的学员。",
      minutes: 15,
      preparation:
        "选一个学员已经接触过的概念，再准备一个熟悉的练习示例。如果调整诊断题或关联的复测题，请核对两题的正确选项和解析。",
      facilitation:
        "先提出诊断题，再解释答案。演示如何合上笔记回忆，并留一点时间让学员练习。打开关联的复测题，用新情境检查应用情况，然后询问学员觉得自己有多大把握尝试这个方法。",
      interpretation:
        "计分答案反映学员在两个具体情境中如何作答。准备度评分反映学员自报的信心。要了解学员能否独立使用该方法，请他们在另一项任务中演示。",
      followUp:
        "请每位学员选一个主题，次日不看笔记进行回忆，再对照原始材料检查遗漏。下次培训时回顾一个常见遗漏，并用另一个示例练习。",
    },
    onboarding: {
      audience: "加入团队第一周的新成员及带领他们熟悉工作的人员。",
      minutes: 20,
      preparation:
        "写明团队的目标和有问题时可以联系的人员。选择一项适合该岗位、风险低的首项任务，准备一个示例，并确认新成员可以使用所需工具。",
      facilitation:
        "通过投票了解大家需要哪些支持，再决定先讲什么。一起看示例，并商定一项能在他人协助下完成的任务。询问大家是否清楚去哪里求助，并提供一个私下提问的渠道。",
      interpretation:
        "投票反映大家希望获得的支持，评分反映大家认为求助渠道有多清楚。请与每位新成员直接确认工具访问权限和任务进度。",
      followUp:
        "用文字共享首项任务、示例和支持联系人。在第一周内安排一次简短沟通，回顾尝试情况、解决卡点并商定下一步。",
    },
  },
  "zh-TW": {
    training: {
      audience: "參加短時間培訓、練習憑記憶說出一個實用概念的學員。",
      minutes: 15,
      preparation:
        "選擇一個學員接觸過的概念，並準備熟悉的練習範例。若調整診斷題或連結的複測題，請確認兩題的正確選項和解析。",
      facilitation:
        "先出診斷題，再說明答案。示範如何闔上筆記回想，留一點時間讓學員練習。開啟連結的複測題，看看學員如何應用到新情境，接著詢問他們是否有信心嘗試這個方法。",
      interpretation:
        "計分答案反映學員如何回答兩個特定情境的題目。準備程度的評分反映學員自評的信心。若要確認學員能否獨立運用，請他們在另一項任務中示範。",
      followUp:
        "請每位學員選一個主題，隔天不看筆記回想，再對照原始教材檢查遺漏。下次培訓時回顧一個常見的遺漏，並用另一個範例練習。",
    },
    onboarding: {
      audience: "加入團隊第一週的新成員，以及帶領他們熟悉工作的夥伴。",
      minutes: 20,
      preparation:
        "寫下團隊的目標和可以提問的聯絡人。挑選一項符合職務、風險低的第一項任務，準備範例，並確認新成員可使用所需工具。",
      facilitation:
        "透過投票了解大家需要哪些支援，以決定先說明什麼。一起查看範例，並商定一項有人協助的首項任務。詢問大家是否清楚該到哪裡求助，也提供能私下提問的管道。",
      interpretation:
        "投票反映大家想要的支援，評分反映大家覺得求助管道有多清楚。請直接與每位新成員確認工具存取權限和任務進度。",
      followUp:
        "以書面分享首項任務、範例及支援聯絡人。在第一週安排一次簡短的會談，回顧嘗試情形、排除障礙並商定下一步。",
    },
  },
};
