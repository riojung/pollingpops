import type { SupportedLocale } from "@openround/contracts";

const keys = [
  "title",
  "description",
  "templates",
  "roundTemplates",
  "designTemplates",
  "continueWorking",
] as const;
const values = {
  "en-CA": [
    "Start creating",
    "Choose a goal, or make a template your own.",
    "Use a template",
    "Quizzes & polls",
    "Slide designs",
    "Continue working",
  ],
  "fr-FR": [
    "Commencez à créer",
    "Choisissez un objectif ou adaptez un modèle.",
    "Utiliser un modèle",
    "Quiz et sondages",
    "Mises en page",
    "Reprendre votre travail",
  ],
  "de-DE": [
    "Mit dem Erstellen beginnen",
    "Wählen Sie ein Ziel oder passen Sie eine Vorlage an.",
    "Vorlage verwenden",
    "Quiz und Umfragen",
    "Foliendesigns",
    "Weiterarbeiten",
  ],
  "es-ES": [
    "Empieza a crear",
    "Elige un objetivo o adapta una plantilla.",
    "Usar una plantilla",
    "Cuestionarios y sondeos",
    "Diseños de diapositivas",
    "Continúa trabajando",
  ],
  "it-IT": [
    "Inizia a creare",
    "Scegli un obiettivo o personalizza un modello.",
    "Usa un modello",
    "Quiz e sondaggi",
    "Design delle diapositive",
    "Riprendi il lavoro",
  ],
  "pt-PT": [
    "Comece a criar",
    "Escolha um objetivo ou adapte um modelo.",
    "Usar um modelo",
    "Questionários e sondagens",
    "Designs de diapositivos",
    "Continue o trabalho",
  ],
  "ja-JP": [
    "作成を始める",
    "目的を選ぶか、テンプレートを自分用にアレンジしましょう。",
    "テンプレートを使う",
    "クイズ・投票",
    "スライドデザイン",
    "作業を再開",
  ],
  "ko-KR": [
    "만들기 시작",
    "목표를 선택하거나 템플릿을 나에게 맞게 바꿔 보세요.",
    "템플릿 사용",
    "퀴즈 및 투표",
    "슬라이드 디자인",
    "이어서 작업",
  ],
  "zh-CN": [
    "开始创作",
    "选择一个目标，或按需调整模板。",
    "使用模板",
    "测验与投票",
    "幻灯片设计",
    "继续创作",
  ],
  "zh-TW": [
    "開始創作",
    "選擇目標，或依需求調整範本。",
    "使用範本",
    "測驗與投票",
    "投影片設計",
    "繼續創作",
  ],
} satisfies Record<SupportedLocale, readonly string[]>;

export function homeStartCopy(locale: SupportedLocale = "en-CA") {
  const row = Object.prototype.hasOwnProperty.call(values, locale)
    ? values[locale]
    : values["en-CA"];
  return Object.fromEntries(keys.map((key, index) => [key, row[index]])) as Record<
    (typeof keys)[number],
    string
  >;
}
