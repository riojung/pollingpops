import type { SupportedLocale } from "@openround/contracts";

export const canvasCreationEnglishMessages = {
  subtitle: "Choose how you want to work, then make it yours.",
  teamDescription: "Think, sketch and plan together.",
  workshopDescription: "Collect ideas and guide the conversation.",
  titlePlaceholder: "e.g. Product launch brainstorm",
} as const;

export type CanvasCreationMessages = Record<keyof typeof canvasCreationEnglishMessages, string>;

const translations: Record<SupportedLocale, CanvasCreationMessages> = {
  "en-CA": canvasCreationEnglishMessages,
  "fr-FR": {
    subtitle: "Choisissez votre façon de travailler, puis personnalisez votre espace.",
    teamDescription: "Réfléchissez, dessinez et planifiez ensemble.",
    workshopDescription: "Recueillez des idées et guidez la discussion.",
    titlePlaceholder: "Ex. : remue-méninges pour un lancement de produit",
  },
  "de-DE": {
    subtitle: "Wählen Sie Ihre Arbeitsweise und gestalten Sie Ihr eigenes Board.",
    teamDescription: "Gemeinsam denken, skizzieren und planen.",
    workshopDescription: "Ideen sammeln und das Gespräch leiten.",
    titlePlaceholder: "z. B. Brainstorming zum Produktstart",
  },
  "es-ES": {
    subtitle: "Elige cómo quieres trabajar y dale tu toque personal.",
    teamDescription: "Piensa, dibuja y planifica en equipo.",
    workshopDescription: "Reúne ideas y guía la conversación.",
    titlePlaceholder: "p. ej., lluvia de ideas para un lanzamiento",
  },
  "it-IT": {
    subtitle: "Scegli come vuoi lavorare, poi personalizza il tuo spazio.",
    teamDescription: "Pensa, disegna e pianifica insieme al gruppo.",
    workshopDescription: "Raccogli idee e guida la conversazione.",
    titlePlaceholder: "Ad es. idee per il lancio di un prodotto",
  },
  "pt-PT": {
    subtitle: "Escolha como quer trabalhar e personalize o seu espaço.",
    teamDescription: "Pense, desenhe e planeie em conjunto.",
    workshopDescription: "Recolha ideias e oriente a conversa.",
    titlePlaceholder: "Ex.: ideias para o lançamento de um produto",
  },
  "ja-JP": {
    subtitle: "進め方を選んで、自分らしいボードにしましょう。",
    teamDescription: "一緒に考え、スケッチし、計画しましょう。",
    workshopDescription: "アイデアを集め、話し合いを進めましょう。",
    titlePlaceholder: "例：新商品の発売に向けたアイデア出し",
  },
  "ko-KR": {
    subtitle: "작업 방식을 고르고 원하는 대로 꾸며 보세요.",
    teamDescription: "함께 생각하고, 스케치하고, 계획하세요.",
    workshopDescription: "아이디어를 모으고 대화를 이끌어 보세요.",
    titlePlaceholder: "예: 신제품 출시 아이디어 회의",
  },
  "zh-CN": {
    subtitle: "选择工作方式，打造属于自己的空间。",
    teamDescription: "一起思考、绘图和规划。",
    workshopDescription: "收集创意，引导讨论。",
    titlePlaceholder: "例如：产品发布头脑风暴",
  },
  "zh-TW": {
    subtitle: "選擇工作方式，再打造專屬空間。",
    teamDescription: "一起思考、繪圖與規劃。",
    workshopDescription: "蒐集點子，引導討論。",
    titlePlaceholder: "例如：產品上市腦力激盪",
  },
};

export function canvasCreationMessages(locale: SupportedLocale): CanvasCreationMessages {
  return translations[locale] ?? canvasCreationEnglishMessages;
}
