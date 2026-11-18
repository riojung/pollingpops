import type { SupportedLocale } from "@openround/contracts";

const english = {
  label: "Collections",
  title: "Team meetings",
  description:
    "Choose a quick Round, a guided Presentation or a follow-up Survey to suit your meeting. Use each on its own when it fits.",
  allTemplates: "All templates",
  chooseCollection: "Collection",
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
  },
  "de-DE": {
    label: "Sammlungen",
    title: "Teambesprechungen",
    description:
      "Wählen Sie passend zu Ihrer Besprechung eine kurze Runde, eine geführte Präsentation oder eine anschließende Umfrage. Sie können jede Vorlage einzeln nutzen.",
    allTemplates: "Alle Vorlagen",
    chooseCollection: "Sammlung",
  },
  "es-ES": {
    label: "Colecciones",
    title: "Reuniones de equipo",
    description:
      "Elige una Ronda rápida, una Presentación guiada o una Encuesta de seguimiento según tu reunión. Puedes usar cada opción por separado cuando te convenga.",
    allTemplates: "Todas las plantillas",
    chooseCollection: "Colección",
  },
  "it-IT": {
    label: "Raccolte",
    title: "Riunioni di team",
    description:
      "Scegli un Round rapido, una Presentazione guidata o un Sondaggio di follow-up adatto alla riunione. Puoi usare ogni opzione singolarmente quando serve.",
    allTemplates: "Tutti i modelli",
    chooseCollection: "Raccolta",
  },
  "pt-PT": {
    label: "Coleções",
    title: "Reuniões de equipa",
    description:
      "Escolha uma Ronda rápida, uma Apresentação guiada ou um Inquérito de acompanhamento adequado à reunião. Pode utilizar cada opção por si só, conforme necessário.",
    allTemplates: "Todos os modelos",
    chooseCollection: "Coleção",
  },
  "ja-JP": {
    label: "コレクション",
    title: "チームミーティング",
    description:
      "会議に合わせて、短いラウンド、ガイド付きプレゼンテーション、フォローアップ用アンケートから選べます。必要に応じて、それぞれ単独で使えます。",
    allTemplates: "すべてのテンプレート",
    chooseCollection: "コレクション",
  },
  "ko-KR": {
    label: "컬렉션",
    title: "팀 회의",
    description:
      "회의에 맞게 짧은 라운드, 가이드가 있는 프레젠테이션 또는 후속 설문을 선택하세요. 필요에 따라 각각 따로 사용할 수 있습니다.",
    allTemplates: "모든 템플릿",
    chooseCollection: "컬렉션",
  },
  "zh-CN": {
    label: "模板集",
    title: "团队会议",
    description:
      "根据会议需要，选择简短互动轮次、带引导的演示文稿或后续调查。每种模板都可以按需单独使用。",
    allTemplates: "所有模板",
    chooseCollection: "模板集",
  },
  "zh-TW": {
    label: "範本集",
    title: "團隊會議",
    description:
      "依照會議需要，選擇簡短互動回合、附引導的簡報或後續問卷。每種範本都可以視需要單獨使用。",
    allTemplates: "所有範本",
    chooseCollection: "範本集",
  },
};

export const templateCollectionCopyKeys = Object.keys(english) as (keyof TemplateCollectionCopy)[];

export function templateCollectionCopy(locale: SupportedLocale = "en-CA"): TemplateCollectionCopy {
  const copy = Object.hasOwn(templateCollectionCopyCatalog, locale)
    ? templateCollectionCopyCatalog[locale]
    : english;
  return { ...copy };
}
