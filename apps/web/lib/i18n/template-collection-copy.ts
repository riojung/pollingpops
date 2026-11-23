import type { SupportedLocale } from "@openround/contracts";

const english = {
  label: "Collections",
  title: "Team meetings",
  description:
    "Choose a quick Round, a guided Presentation or a follow-up Survey to suit your meeting. Use each on its own when it fits.",
  allTemplates: "All templates",
  chooseCollection: "Collection",
  trainingOnboardingTitle: "Training and onboarding",
  trainingOnboardingDescription:
    "Choose a template to practise a skill, guide new teammates through their first steps or collect feedback on onboarding. Use each on its own when it fits.",
  workshopsTitle: "Workshops",
  workshopsDescription:
    "Choose a template to set workshop expectations, practise a technique or plan follow-up. Use each on its own when it fits.",
  eventFeedbackTitle: "Event feedback",
  eventFeedbackDescription:
    "Choose a template to collect feedback during or after an event, guide a talk or demo, or plan follow-up. Use each template on its own when it fits.",
} as const;

export type TemplateCollectionCopy = Record<keyof typeof english, string>;

/** Raw authored strings, including every locale, for localization review packets. */
export const templateCollectionCopyCatalog: Readonly<
  Record<SupportedLocale, Readonly<TemplateCollectionCopy>>
> = {
  "en-CA": english,
  "fr-FR": {
    label: "Collections",
    title: "Réunions d’équipe",
    description:
      "Choisissez un Round rapide, une Présentation guidée ou une Enquête de suivi selon votre réunion. Chacun peut être utilisé séparément, selon vos besoins.",
    allTemplates: "Tous les modèles",
    chooseCollection: "Collection",
    trainingOnboardingTitle: "Formation et intégration",
    trainingOnboardingDescription:
      "Choisissez un modèle pour travailler une compétence, accompagner les nouveaux membres de l’équipe dans leurs premiers pas ou recueillir leurs retours sur l’intégration. Chaque modèle peut être utilisé séparément selon vos besoins.",
    workshopsTitle: "Ateliers",
    workshopsDescription:
      "Choisissez un modèle pour clarifier les attentes de l’atelier, vous entraîner à une technique ou préparer le suivi. Chaque modèle peut être utilisé séparément selon vos besoins.",
    eventFeedbackTitle: "Retours sur les événements",
    eventFeedbackDescription:
      "Choisissez un modèle pour recueillir des retours pendant ou après un événement, structurer une intervention ou une démonstration, ou préparer le suivi. Chaque modèle peut être utilisé séparément selon vos besoins.",
  },
  "de-DE": {
    label: "Sammlungen",
    title: "Teambesprechungen",
    description:
      "Wählen Sie passend zu Ihrer Besprechung eine kurze Runde, eine geführte Präsentation oder eine anschließende Umfrage. Sie können jede Vorlage einzeln nutzen.",
    allTemplates: "Alle Vorlagen",
    chooseCollection: "Sammlung",
    trainingOnboardingTitle: "Schulung und Einarbeitung",
    trainingOnboardingDescription:
      "Wählen Sie eine Vorlage, um eine Fertigkeit zu üben, neue Teammitglieder bei ihren ersten Schritten zu begleiten oder Feedback zur Einarbeitung einzuholen. Jede Vorlage lässt sich bei Bedarf einzeln nutzen.",
    workshopsTitle: "Workshops",
    workshopsDescription:
      "Wählen Sie eine Vorlage, um Erwartungen an den Workshop zu klären, eine Methode zu üben oder die nächsten Schritte zu planen. Jede Vorlage lässt sich bei Bedarf einzeln nutzen.",
    eventFeedbackTitle: "Feedback zu Veranstaltungen",
    eventFeedbackDescription:
      "Wählen Sie eine Vorlage, um während oder nach einer Veranstaltung Feedback einzuholen, einen Vortrag oder eine Demo zu gestalten oder die nächsten Schritte zu planen. Jede Vorlage lässt sich bei Bedarf einzeln nutzen.",
  },
  "es-ES": {
    label: "Colecciones",
    title: "Reuniones de equipo",
    description:
      "Elige una Ronda rápida, una Presentación guiada o una Encuesta de seguimiento según tu reunión. Puedes usar cada opción por separado cuando te convenga.",
    allTemplates: "Todas las plantillas",
    chooseCollection: "Colección",
    trainingOnboardingTitle: "Formación y acogida",
    trainingOnboardingDescription:
      "Elige una plantilla para practicar una habilidad, orientar a quienes se incorporan al equipo en sus primeros pasos o recoger sus impresiones sobre la acogida. Puedes usar cada plantilla por separado cuando te convenga.",
    workshopsTitle: "Talleres",
    workshopsDescription:
      "Elige una plantilla para aclarar las expectativas del taller, practicar una técnica o preparar el seguimiento. Puedes usar cada plantilla por separado cuando te convenga.",
    eventFeedbackTitle: "Opiniones sobre eventos",
    eventFeedbackDescription:
      "Elige una plantilla para recoger opiniones durante o después de un evento, estructurar una charla o una demostración, o preparar el seguimiento. Puedes usar cada plantilla por separado cuando te convenga.",
  },
  "it-IT": {
    label: "Raccolte",
    title: "Riunioni di team",
    description:
      "Scegli un Round rapido, una Presentazione guidata o un Sondaggio di follow-up adatto alla riunione. Puoi usare ogni opzione singolarmente quando serve.",
    allTemplates: "Tutti i modelli",
    chooseCollection: "Raccolta",
    trainingOnboardingTitle: "Formazione e inserimento",
    trainingOnboardingDescription:
      "Scegli un modello per esercitare una competenza, accompagnare chi entra nel team nei primi passi o raccogliere feedback sull’inserimento. Puoi usare ogni modello singolarmente secondo le tue esigenze.",
    workshopsTitle: "Laboratori",
    workshopsDescription:
      "Scegli un modello per chiarire le aspettative sul laboratorio, esercitarti con una tecnica o pianificare i prossimi passi. Puoi usare ogni modello singolarmente secondo le tue esigenze.",
    eventFeedbackTitle: "Feedback sugli eventi",
    eventFeedbackDescription:
      "Scegli un modello per raccogliere feedback durante o dopo un evento, strutturare un intervento o una demo, oppure pianificare i prossimi passi. Puoi usare ogni modello singolarmente secondo le tue esigenze.",
  },
  "pt-PT": {
    label: "Coleções",
    title: "Reuniões de equipa",
    description:
      "Escolha uma Ronda rápida, uma Apresentação guiada ou um Inquérito de acompanhamento adequado à reunião. Pode utilizar cada opção por si só, conforme necessário.",
    allTemplates: "Todos os modelos",
    chooseCollection: "Coleção",
    trainingOnboardingTitle: "Formação e integração",
    trainingOnboardingDescription:
      "Escolha um modelo para praticar uma competência, orientar novos membros da equipa nos primeiros passos ou recolher opiniões sobre a integração. Pode utilizar cada modelo por si só, conforme necessário.",
    workshopsTitle: "Workshops",
    workshopsDescription:
      "Escolha um modelo para clarificar as expectativas para o workshop, praticar uma técnica ou planear o acompanhamento. Pode utilizar cada modelo por si só, conforme necessário.",
    eventFeedbackTitle: "Opiniões sobre eventos",
    eventFeedbackDescription:
      "Escolha um modelo para recolher opiniões durante ou após um evento, estruturar uma palestra ou demonstração, ou planear o acompanhamento. Pode utilizar cada modelo por si só, conforme necessário.",
  },
  "ja-JP": {
    label: "コレクション",
    title: "チームミーティング",
    description:
      "会議に合わせて、短いラウンド、ガイド付きプレゼンテーション、フォローアップ用アンケートから選べます。必要に応じて、それぞれ単独で使えます。",
    allTemplates: "すべてのテンプレート",
    chooseCollection: "コレクション",
    trainingOnboardingTitle: "研修とオンボーディング",
    trainingOnboardingDescription:
      "スキルの練習、新しいチームメンバーの最初のステップの案内、オンボーディングに関する意見の収集に使えるテンプレートです。目的に合わせて、それぞれ単独で使えます。",
    workshopsTitle: "ワークショップ",
    workshopsDescription:
      "ワークショップへの期待を確認したり、手法を練習したり、終了後のフォローアップを計画したりするためのテンプレートです。目的に合わせて、それぞれ単独で使えます。",
    eventFeedbackTitle: "イベントのフィードバック",
    eventFeedbackDescription:
      "イベント中や終了後の意見収集、講演やデモの進行、フォローアップの計画に使えるテンプレートです。目的に合わせて、それぞれ単独で使えます。",
  },
  "ko-KR": {
    label: "컬렉션",
    title: "팀 회의",
    description:
      "회의에 맞게 짧은 라운드, 가이드가 있는 프레젠테이션 또는 후속 설문을 선택하세요. 필요에 따라 각각 따로 사용할 수 있습니다.",
    allTemplates: "모든 템플릿",
    chooseCollection: "컬렉션",
    trainingOnboardingTitle: "교육 및 온보딩",
    trainingOnboardingDescription:
      "기술을 연습하거나, 새 팀원의 첫 업무를 안내하거나, 온보딩에 대한 의견을 모을 때 알맞은 템플릿을 선택하세요. 필요에 따라 각 템플릿을 따로 사용할 수 있습니다.",
    workshopsTitle: "워크숍",
    workshopsDescription:
      "워크숍에서 기대하는 바를 확인하거나, 기법을 연습하거나, 후속 활동을 계획할 때 알맞은 템플릿을 선택하세요. 필요에 따라 각 템플릿을 따로 사용할 수 있습니다.",
    eventFeedbackTitle: "행사 피드백",
    eventFeedbackDescription:
      "행사 중이나 행사가 끝난 뒤 의견을 모으거나, 발표나 시연을 진행하거나, 후속 활동을 계획할 때 알맞은 템플릿을 선택하세요. 필요에 따라 각 템플릿을 따로 사용할 수 있습니다.",
  },
  "zh-CN": {
    label: "模板集",
    title: "团队会议",
    description:
      "根据会议需要，选择简短互动轮次、带引导的演示文稿或后续调查。每种模板都可以按需单独使用。",
    allTemplates: "所有模板",
    chooseCollection: "模板集",
    trainingOnboardingTitle: "培训与入职引导",
    trainingOnboardingDescription:
      "选择合适的模板来练习技能、指导新成员迈出第一步，或收集他们对入职流程的反馈。每种模板都可以按需单独使用。",
    workshopsTitle: "工作坊",
    workshopsDescription:
      "选择合适的模板来明确对工作坊的期待、练习一种方法，或安排后续行动。每种模板都可以按需单独使用。",
    eventFeedbackTitle: "活动反馈",
    eventFeedbackDescription:
      "选择合适的模板，在活动期间或结束后收集反馈、组织演讲或演示，或安排后续行动。每种模板都可以按需单独使用。",
  },
  "zh-TW": {
    label: "範本集",
    title: "團隊會議",
    description:
      "依照會議需要，選擇簡短互動回合、附引導的簡報或後續問卷。每種範本都可以視需要單獨使用。",
    allTemplates: "所有範本",
    chooseCollection: "範本集",
    trainingOnboardingTitle: "培訓與入職引導",
    trainingOnboardingDescription:
      "選擇合適的範本來練習技能、引導新成員熟悉初期工作，或蒐集他們對入職流程的回饋。每種範本都可以視需要單獨使用。",
    workshopsTitle: "工作坊",
    workshopsDescription:
      "選擇合適的範本來釐清對工作坊的期待、練習一項方法，或規劃後續行動。每種範本都可以視需要單獨使用。",
    eventFeedbackTitle: "活動回饋",
    eventFeedbackDescription:
      "選擇合適的範本，在活動中或結束後蒐集回饋、安排演講或示範的流程，或規劃後續行動。每種範本都可以視需要單獨使用。",
  },
};

export const templateCollectionCopyKeys = Object.keys(english) as (keyof TemplateCollectionCopy)[];

export function templateCollectionCopy(locale: SupportedLocale = "en-CA"): TemplateCollectionCopy {
  const copy = Object.hasOwn(templateCollectionCopyCatalog, locale)
    ? templateCollectionCopyCatalog[locale]
    : english;
  return { ...copy };
}
