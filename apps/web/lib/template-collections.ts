import type { StarterGuide, SupportedLocale } from "@openround/contracts";
import { trainingOnboardingPresentationGuides } from "./training-onboarding-guides";
import { workshopPresentationGuides } from "./workshop-collection-guides";

export const templateCollectionIds = ["team-meetings", "training-onboarding", "workshops"] as const;
export type TemplateCollectionId = (typeof templateCollectionIds)[number];
const templateCollectionKinds = ["round", "presentation", "survey"] as const;
export type TemplateCollectionKind = (typeof templateCollectionKinds)[number];

export const teamMeetingTemplateIds = Object.freeze({
  round: Object.freeze(["meeting-priorities", "team-retrospective"] as const),
  presentation: Object.freeze(["meeting", "retrospective"] as const),
  survey: Object.freeze(["team-collaboration"] as const),
});

export const trainingOnboardingTemplateIds = Object.freeze({
  round: Object.freeze(["new-hire-knowledge-check", "feedback-skills"] as const),
  presentation: Object.freeze(["training", "onboarding"] as const),
  survey: Object.freeze(["onboarding-experience"] as const),
});

export const workshopTemplateIds = Object.freeze({
  round: Object.freeze(["workshop-expectations", "exit-ticket"] as const),
  presentation: Object.freeze(["workshop", "native-practical-workshop"] as const),
  survey: Object.freeze(["learning-needs"] as const),
});

const templateIdsByCollection = {
  "team-meetings": teamMeetingTemplateIds,
  "training-onboarding": trainingOnboardingTemplateIds,
  workshops: workshopTemplateIds,
} satisfies Record<TemplateCollectionId, Record<TemplateCollectionKind, readonly string[]>>;

export const templateCollectionMemberships = Object.freeze(
  templateCollectionIds.flatMap((collectionId) =>
    templateCollectionKinds.flatMap((kind) =>
      templateIdsByCollection[collectionId][kind].map((templateId) =>
        Object.freeze({ collectionId, kind, templateId }),
      ),
    ),
  ),
);

/** Collection query values are exact IDs; missing and unknown values mean no collection. */
export function parseTemplateCollection(
  value: string | null | undefined,
): TemplateCollectionId | null {
  return templateCollectionIds.find((id) => id === value) ?? null;
}

export function collectionTemplateIds(
  kind: TemplateCollectionKind,
  collection: TemplateCollectionId | null | undefined,
): readonly string[] | undefined {
  return collection ? templateIdsByCollection[collection]?.[kind] : undefined;
}

type CollectionPresentationId = (typeof teamMeetingTemplateIds.presentation)[number];

export const templateCollectionGuideKeys = [
  "audience",
  "minutes",
  "preparation",
  "facilitation",
  "interpretation",
  "followUp",
] as const satisfies readonly (keyof StarterGuide)[];

/**
 * Authored guidance based on the existing meeting and retrospective prompts and notes.
 * Durations are planning estimates. Translations are editorial Preview content;
 * this catalog does not record human or native-language review acceptance.
 * Export the raw strings so review packets can include complete bilingual guides.
 */
export const templateCollectionPresentationGuides: Readonly<
  Record<SupportedLocale, Readonly<Record<CollectionPresentationId, Readonly<StarterGuide>>>>
> = {
  "en-CA": {
    meeting: {
      audience: "3–12 colleagues with a real decision to make.",
      minutes: 20,
      preparation:
        "Name one decision the group can make. Add the available time, practical options and constraints, and choose a place to record decisions and updates.",
      facilitation:
        "Use the agenda poll to choose where to spend discussion time. Make options and trade-offs visible and invite perspectives that have not been heard. Ask how clear the next step is, then read back the decision, owner, deadline and update location.",
      interpretation:
        "Use agenda responses to focus discussion. A clarity rating is a prompt to ask what is missing; it does not confirm agreement or that the decision will work.",
      followUp:
        "Send the decision and action record within one working day, including the owner, deadline and update location. Ask owners to correct anything unclear.",
    },
    retrospective: {
      audience: "3–12 colleagues reflecting on a completed work cycle.",
      minutes: 25,
      preparation:
        "Choose the completed cycle and bring specific observations about the work and its conditions. Prepare a place to record one small experiment and make space for differing experiences.",
      facilitation:
        "Ask for facts and observations without assigning blame. Use the pace rating and friction poll to open discussion. Separate what was observed from possible explanations, then choose one experiment the team can try next cycle.",
      interpretation:
        "Treat responses as perspectives on this cycle, not proof of a cause or an improvement. Choose an observable signal to check whether the experiment helped, such as less waiting or fewer repeated questions.",
      followUp:
        "Record the experiment, owner, observable signal and review date. Share the record and begin the next retrospective by reviewing what happened before deciding whether to continue or change the experiment.",
    },
  },
  "fr-FR": {
    meeting: {
      audience: "3 à 12 collègues ayant une véritable décision à prendre.",
      minutes: 20,
      preparation:
        "Nommez une décision que le groupe peut prendre. Précisez le temps disponible, les options réalistes et les contraintes, puis choisissez où consigner les décisions et les mises à jour.",
      facilitation:
        "Utilisez le vote sur l’ordre du jour pour répartir le temps de discussion. Rendez visibles les options et les compromis, et invitez les points de vue encore absents. Demandez si la prochaine étape est claire, puis relisez la décision, le responsable, l’échéance et le lieu de suivi.",
      interpretation:
        "Utilisez les réponses sur l’ordre du jour pour orienter la discussion. Une note de clarté invite à demander ce qui manque ; elle ne confirme ni l’accord du groupe ni l’efficacité de la décision.",
      followUp:
        "Envoyez le relevé des décisions et actions sous un jour ouvré, avec le responsable, l’échéance et le lieu de suivi. Demandez aux responsables de corriger les points peu clairs.",
    },
    retrospective: {
      audience: "3 à 12 collègues faisant le bilan d’un cycle de travail terminé.",
      minutes: 25,
      preparation:
        "Choisissez le cycle terminé et apportez des observations précises sur le travail et ses conditions. Prévoyez où consigner une petite expérimentation et laissez place aux expériences différentes.",
      facilitation:
        "Demandez des faits et des observations sans attribuer de faute. Ouvrez la discussion avec l’évaluation du rythme et le vote sur les difficultés. Distinguez observations et explications possibles, puis choisissez une expérimentation pour le prochain cycle.",
      interpretation:
        "Considérez les réponses comme des points de vue sur ce cycle, pas comme la preuve d’une cause ou d’une amélioration. Choisissez un indicateur observable pour examiner l’effet de l’expérimentation, par exemple moins d’attente ou de questions répétées.",
      followUp:
        "Consignez l’expérimentation, son responsable, l’indicateur observable et la date de bilan. Partagez ce relevé et commencez la prochaine rétrospective par les observations recueillies avant de décider de poursuivre ou d’ajuster l’expérimentation.",
    },
  },
  "de-DE": {
    meeting: {
      audience: "3–12 Kolleginnen und Kollegen mit einer konkreten anstehenden Entscheidung.",
      minutes: 20,
      preparation:
        "Benennen Sie eine Entscheidung, die die Gruppe treffen kann. Ergänzen Sie die verfügbare Zeit, umsetzbare Optionen und Rahmenbedingungen. Legen Sie fest, wo Entscheidungen und Aktualisierungen festgehalten werden.",
      facilitation:
        "Nutzen Sie die Agenda-Abstimmung, um die Gesprächszeit einzuteilen. Machen Sie Optionen und Abwägungen sichtbar und laden Sie bisher ungehörte Sichtweisen ein. Fragen Sie, wie klar der nächste Schritt ist. Lesen Sie Entscheidung, Verantwortliche, Frist und Ablageort für Aktualisierungen vor.",
      interpretation:
        "Richten Sie die Diskussion an den Agenda-Antworten aus. Die Bewertung der Klarheit hilft, fehlende Informationen zu erfragen. Sie belegt weder Zustimmung noch, dass die Entscheidung funktionieren wird.",
      followUp:
        "Versenden Sie das Entscheidungs- und Maßnahmenprotokoll innerhalb eines Arbeitstags mit Verantwortlichen, Frist und Ablageort für Aktualisierungen. Bitten Sie die Verantwortlichen, Unklarheiten zu korrigieren.",
    },
    retrospective: {
      audience:
        "3–12 Kolleginnen und Kollegen, die auf einen abgeschlossenen Arbeitszyklus zurückblicken.",
      minutes: 25,
      preparation:
        "Wählen Sie den abgeschlossenen Zyklus aus und sammeln Sie konkrete Beobachtungen zur Arbeit und ihren Bedingungen. Bereiten Sie einen Ort für die Dokumentation eines kleinen Experiments vor und geben Sie unterschiedlichen Erfahrungen Raum.",
      facilitation:
        "Bitten Sie um Fakten und Beobachtungen ohne Schuldzuweisungen. Beginnen Sie mit der Bewertung des Arbeitstempos und der Abstimmung über Reibungspunkte. Trennen Sie Beobachtungen von möglichen Erklärungen und wählen Sie ein Experiment für den nächsten Zyklus.",
      interpretation:
        "Verstehen Sie die Antworten als Sichtweisen auf diesen Zyklus, nicht als Beleg für eine Ursache oder Verbesserung. Wählen Sie ein beobachtbares Signal, um die Wirkung des Experiments zu prüfen, etwa weniger Wartezeit oder wiederholte Fragen.",
      followUp:
        "Halten Sie Experiment, verantwortliche Person, beobachtbares Signal und Überprüfungstermin fest. Teilen Sie das Protokoll und beginnen Sie den nächsten Rückblick mit den Beobachtungen, bevor Sie über Fortsetzung oder Anpassung entscheiden.",
    },
  },
  "es-ES": {
    meeting: {
      audience: "De 3 a 12 colegas con una decisión real que tomar.",
      minutes: 20,
      preparation:
        "Define una decisión que el grupo pueda tomar. Añade el tiempo disponible, las opciones viables y las restricciones, y elige dónde registrar las decisiones y las actualizaciones.",
      facilitation:
        "Usa la votación sobre la agenda para repartir el tiempo de debate. Muestra las opciones y sus ventajas e inconvenientes e invita a participar a quienes aún no han hablado. Pregunta si el siguiente paso está claro y repasa la decisión, la persona responsable, el plazo y el lugar de seguimiento.",
      interpretation:
        "Usa las respuestas sobre la agenda para centrar el debate. La valoración de claridad sirve para preguntar qué falta; no confirma el acuerdo ni que la decisión vaya a funcionar.",
      followUp:
        "Envía el registro de decisiones y acciones en el plazo de un día laborable, con la persona responsable, el plazo y el lugar de seguimiento. Pide a las personas responsables que corrijan los puntos poco claros.",
    },
    retrospective: {
      audience: "De 3 a 12 colegas que revisan un ciclo de trabajo terminado.",
      minutes: 25,
      preparation:
        "Elige el ciclo terminado y reúne observaciones concretas sobre el trabajo y sus condiciones. Prepara dónde registrar un pequeño experimento y deja espacio para experiencias distintas.",
      facilitation:
        "Pide hechos y observaciones sin buscar culpables. Abre el debate con la valoración del ritmo y la votación sobre las dificultades. Separa lo observado de sus posibles explicaciones y elige un experimento para el siguiente ciclo.",
      interpretation:
        "Trata las respuestas como perspectivas sobre este ciclo, no como prueba de una causa o una mejora. Elige una señal observable para comprobar si el experimento ayudó, como menos esperas o menos preguntas repetidas.",
      followUp:
        "Registra el experimento, la persona responsable, la señal observable y la fecha de revisión. Comparte el registro y empieza la siguiente retrospectiva revisando lo ocurrido antes de decidir si continuar o modificar el experimento.",
    },
  },
  "it-IT": {
    meeting: {
      audience: "Da 3 a 12 colleghi con una decisione concreta da prendere.",
      minutes: 20,
      preparation:
        "Indica una decisione che il gruppo può prendere. Aggiungi il tempo disponibile, le opzioni praticabili e i vincoli, poi scegli dove registrare decisioni e aggiornamenti.",
      facilitation:
        "Usa il voto sull’ordine del giorno per distribuire il tempo di discussione. Rendi visibili opzioni e compromessi e invita i punti di vista ancora non espressi. Chiedi quanto è chiaro il prossimo passo, poi rileggi decisione, responsabile, scadenza e luogo degli aggiornamenti.",
      interpretation:
        "Usa le risposte sull’ordine del giorno per orientare la discussione. Il voto sulla chiarezza aiuta a chiedere cosa manca; non conferma l’accordo né che la decisione funzionerà.",
      followUp:
        "Invia il verbale con decisioni e azioni entro un giorno lavorativo, indicando responsabile, scadenza e luogo degli aggiornamenti. Chiedi ai responsabili di correggere i punti poco chiari.",
    },
    retrospective: {
      audience: "Da 3 a 12 colleghi che riflettono su un ciclo di lavoro concluso.",
      minutes: 25,
      preparation:
        "Scegli il ciclo concluso e raccogli osservazioni concrete sul lavoro e sulle sue condizioni. Prepara uno spazio per registrare un piccolo esperimento e accogli esperienze diverse.",
      facilitation:
        "Chiedi fatti e osservazioni senza attribuire colpe. Apri la discussione con la valutazione del ritmo e il voto sugli ostacoli. Separa quanto osservato dalle possibili spiegazioni, poi scegli un esperimento per il prossimo ciclo.",
      interpretation:
        "Considera le risposte come punti di vista su questo ciclo, non come prova di una causa o di un miglioramento. Scegli un segnale osservabile per verificare se l’esperimento ha aiutato, come meno attese o meno domande ripetute.",
      followUp:
        "Registra esperimento, responsabile, segnale osservabile e data di verifica. Condividi il verbale e apri la prossima retrospettiva esaminando quanto accaduto prima di decidere se proseguire o modificare l’esperimento.",
    },
  },
  "pt-PT": {
    meeting: {
      audience: "3 a 12 colegas com uma decisão concreta a tomar.",
      minutes: 20,
      preparation:
        "Identifique uma decisão que o grupo possa tomar. Acrescente o tempo disponível, as opções viáveis e as limitações, e escolha onde registar decisões e atualizações.",
      facilitation:
        "Use a votação sobre a agenda para distribuir o tempo de discussão. Torne visíveis as opções e os compromissos e convide perspetivas ainda não ouvidas. Pergunte se o próximo passo é claro e releia a decisão, o responsável, o prazo e o local das atualizações.",
      interpretation:
        "Use as respostas sobre a agenda para orientar a discussão. A avaliação de clareza ajuda a perguntar o que falta; não confirma o acordo nem que a decisão vá funcionar.",
      followUp:
        "Envie o registo de decisões e ações no prazo de um dia útil, incluindo o responsável, o prazo e o local das atualizações. Peça aos responsáveis que corrijam os pontos pouco claros.",
    },
    retrospective: {
      audience: "3 a 12 colegas a refletir sobre um ciclo de trabalho concluído.",
      minutes: 25,
      preparation:
        "Escolha o ciclo concluído e reúna observações concretas sobre o trabalho e as suas condições. Prepare um local para registar uma pequena experiência e dê espaço a vivências diferentes.",
      facilitation:
        "Peça factos e observações sem atribuir culpas. Abra a discussão com a avaliação do ritmo e a votação sobre dificuldades. Separe o que foi observado das possíveis explicações e escolha uma experiência para o próximo ciclo.",
      interpretation:
        "Trate as respostas como perspetivas sobre este ciclo, não como prova de uma causa ou melhoria. Escolha um sinal observável para verificar se a experiência ajudou, como menos espera ou menos perguntas repetidas.",
      followUp:
        "Registe a experiência, o responsável, o sinal observável e a data de revisão. Partilhe o registo e comece a próxima retrospetiva por analisar o que aconteceu antes de decidir continuar ou alterar a experiência.",
    },
  },
  "ja-JP": {
    meeting: {
      audience: "実際に決めるべきことがある3～12人の同僚。",
      minutes: 20,
      preparation:
        "グループで決められる事項を1つ挙げます。使える時間、実行可能な選択肢、制約を追記し、決定事項と進捗を記録する場所を決めます。",
      facilitation:
        "議題の投票を使って、話し合いに時間をかける項目を選びます。選択肢とトレードオフを見える形にし、まだ出ていない意見を求めます。次の行動がどの程度明確かを尋ね、決定事項、担当者、期限、進捗の共有場所を読み上げます。",
      interpretation:
        "議題への回答を話し合いの焦点を絞るために使います。明確さの評価は、不足している点を尋ねる手がかりです。合意や決定の有効性を確認するものではありません。",
      followUp:
        "1営業日以内に、担当者、期限、進捗の共有場所を含む決定事項と行動の記録を送ります。不明確な点は担当者に修正してもらいます。",
    },
    retrospective: {
      audience: "完了した業務サイクルを振り返る3～12人の同僚。",
      minutes: 25,
      preparation:
        "振り返る完了済みのサイクルを選び、仕事とその条件について具体的な観察を持ち寄ります。小さな実験を1つ記録する場所を用意し、異なる経験を共有できるようにします。",
      facilitation:
        "誰かを責めずに、事実と観察を求めます。ペースの評価と支障に関する投票をきっかけに話し合います。観察したことと考えられる説明を分け、次のサイクルで試せる実験を1つ選びます。",
      interpretation:
        "回答はこのサイクルに対する見方として扱い、原因や改善の証明とはしません。待ち時間や繰り返しの質問の減少など、実験が役立ったかを確かめるための観察可能な指標を選びます。",
      followUp:
        "実験、担当者、観察可能な指標、確認日を記録して共有します。次の振り返りでは最初に起きたことを確認し、それから実験を続けるか変更するかを決めます。",
    },
  },
  "ko-KR": {
    meeting: {
      audience: "실제로 내려야 할 결정이 있는 동료 3~12명.",
      minutes: 20,
      preparation:
        "그룹이 내릴 수 있는 결정 하나를 정하세요. 사용할 수 있는 시간, 실행 가능한 선택지와 제약 조건을 적고 결정과 진행 상황을 기록할 곳을 정하세요.",
      facilitation:
        "안건 투표로 토론 시간을 어디에 쓸지 정하세요. 선택지와 장단점을 함께 볼 수 있게 정리하고 아직 나오지 않은 의견을 들어보세요. 다음 행동이 얼마나 명확한지 물은 뒤 결정, 담당자, 기한, 진행 상황을 공유할 곳을 다시 읽어 확인하세요.",
      interpretation:
        "안건 응답은 토론의 초점을 정하는 데 사용하세요. 명확성 평가는 무엇이 부족한지 묻는 단서이며, 합의가 이루어졌거나 결정이 효과가 있을 것임을 확인해 주지는 않습니다.",
      followUp:
        "영업일 기준 하루 이내에 담당자, 기한, 진행 상황을 공유할 곳을 포함한 결정 및 실행 기록을 보내세요. 불명확한 내용은 담당자가 수정하도록 요청하세요.",
    },
    retrospective: {
      audience: "완료된 업무 주기를 돌아보는 동료 3~12명.",
      minutes: 25,
      preparation:
        "돌아볼 완료된 주기를 정하고 업무와 업무 조건에 대한 구체적인 관찰 내용을 준비하세요. 작은 실험 하나를 기록할 곳을 마련하고 서로 다른 경험을 나눌 수 있게 하세요.",
      facilitation:
        "누군가를 탓하지 않고 사실과 관찰 내용을 요청하세요. 업무 속도 평가와 마찰 요인 투표로 토론을 시작하세요. 관찰한 내용과 가능한 설명을 구분한 뒤 다음 주기에 시도할 실험 하나를 고르세요.",
      interpretation:
        "응답은 이번 주기에 대한 관점으로 다루고 원인이나 개선의 증거로 여기지 마세요. 대기 시간이나 반복 질문의 감소처럼 실험이 도움이 되었는지 확인할 수 있는 관찰 가능한 신호를 정하세요.",
      followUp:
        "실험, 담당자, 관찰 가능한 신호, 검토 날짜를 기록해 공유하세요. 다음 회고는 실제로 어떤 일이 있었는지 검토하는 것으로 시작한 뒤 실험을 계속할지 바꿀지 정하세요.",
    },
  },
  "zh-CN": {
    meeting: {
      audience: "需要作出实际决策的3至12位同事。",
      minutes: 20,
      preparation:
        "明确一项小组能够作出的决策。补充可用时间、可行选项和限制条件，并选定记录决策和进展的位置。",
      facilitation:
        "通过议程投票安排讨论时间。展示各选项及其取舍，并邀请尚未表达的观点。询问下一步是否清楚，再读出决策、负责人、截止日期和进展分享位置进行确认。",
      interpretation:
        "用议程回答聚焦讨论。清晰度评分可用于询问还缺少什么，但不能确认已经达成共识，也不能证明决策会有效。",
      followUp:
        "在一个工作日内发送决策与行动记录，包含负责人、截止日期和进展分享位置。请负责人更正不清楚的内容。",
    },
    retrospective: {
      audience: "回顾一个已完成工作周期的3至12位同事。",
      minutes: 25,
      preparation:
        "选定已完成的周期，准备关于工作及其条件的具体观察。准备记录一项小实验的位置，并为不同经历留出交流空间。",
      facilitation:
        "请大家陈述事实和观察，避免指责个人。以工作节奏评分和阻碍因素投票展开讨论。区分观察到的情况与可能的解释，再选择一项下个周期可以尝试的实验。",
      interpretation:
        "将回答视为对本周期的看法，而非原因或改善的证据。选择一个可观察的信号来检查实验是否有帮助，例如等待减少或重复提问减少。",
      followUp:
        "记录实验、负责人、可观察的信号和复查日期，并分享记录。下次回顾先检查实际发生了什么，再决定继续还是调整实验。",
    },
  },
  "zh-TW": {
    meeting: {
      audience: "需要做出實際決策的3至12位同事。",
      minutes: 20,
      preparation:
        "明確指出一項團隊能做出的決策。補充可用時間、可行選項和限制條件，並選定記錄決策與進度的位置。",
      facilitation:
        "透過議程投票分配討論時間。呈現各選項及其取捨，並邀請尚未表達的觀點。詢問下一步是否清楚，再讀出決策、負責人、截止日期和進度分享位置加以確認。",
      interpretation:
        "用議程回答聚焦討論。清晰度評分可用來詢問還缺少什麼，但無法確認已達成共識，也無法證明決策會有效。",
      followUp:
        "在一個工作日內寄出決策與行動紀錄，包含負責人、截止日期和進度分享位置。請負責人修正不清楚的內容。",
    },
    retrospective: {
      audience: "回顧一個已完成工作週期的3至12位同事。",
      minutes: 25,
      preparation:
        "選定已完成的週期，準備關於工作及其條件的具體觀察。準備記錄一項小實驗的位置，並留出分享不同經驗的空間。",
      facilitation:
        "請大家陳述事實與觀察，避免責怪個人。以工作步調評分和阻礙因素投票展開討論。區分觀察到的情況與可能的解釋，再選擇一項下個週期可嘗試的實驗。",
      interpretation:
        "將回答視為對本週期的看法，而非原因或改善的證據。選擇一個可觀察的訊號來檢查實驗是否有幫助，例如等待減少或重複提問減少。",
      followUp:
        "記錄實驗、負責人、可觀察的訊號和檢視日期，並分享紀錄。下次回顧先檢查實際發生了什麼，再決定繼續或調整實驗。",
    },
  },
};

export function templateCollectionGuide(
  kind: TemplateCollectionKind,
  id: string,
  locale: SupportedLocale = "en-CA",
): StarterGuide | undefined {
  if (kind !== "presentation") return undefined;
  const language = Object.hasOwn(templateCollectionPresentationGuides, locale) ? locale : "en-CA";
  if (id === "meeting" || id === "retrospective") {
    return { ...templateCollectionPresentationGuides[language][id] };
  }
  if (id === "training" || id === "onboarding") {
    return { ...trainingOnboardingPresentationGuides[language][id] };
  }
  if (id === "workshop" || id === "native-practical-workshop") {
    return { ...workshopPresentationGuides[language][id] };
  }
  return undefined;
}
