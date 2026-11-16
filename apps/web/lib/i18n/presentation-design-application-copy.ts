import type { SupportedLocale } from "@openround/contracts";

interface DesignApplicationCopy {
  applicationLabel: string;
  fullDesign: string;
  colorsAndFonts: string;
  applyDesign: string;
  applyStyle: string;
  applyStyleToNativeSlides: string;
  fullDesignDescription: string;
  styleDescription: string;
  retainedLayoutNotice: string;
  baseColorTheme: string;
  fromPresentationDesign: string;
  baseThemeNotice: string;
}

const copy = {
  "en-CA": {
    applicationLabel: "Application",
    fullDesign: "Full design",
    colorsAndFonts: "Colors and fonts",
    applyDesign: "Apply design",
    applyStyle: "Apply style",
    applyStyleToNativeSlides: "Apply style to native slides",
    fullDesignDescription: "Repositions content and adds the design’s artwork and typography.",
    styleDescription: "Changes colors, fonts and spacing while keeping object positions.",
    retainedLayoutNotice:
      "Layouts retained: {count}. Complex content keeps its position while colors and fonts are updated.",
    baseColorTheme: "Base color theme",
    fromPresentationDesign: "From presentation design",
    baseThemeNotice:
      "Base themes change colors only. Choose a full presentation design to change the layout and artwork.",
  },
  "fr-FR": {
    applicationLabel: "Application",
    fullDesign: "Design complet",
    colorsAndFonts: "Couleurs et polices",
    applyDesign: "Appliquer le design",
    applyStyle: "Appliquer le style",
    applyStyleToNativeSlides: "Appliquer le style aux diapositives natives",
    fullDesignDescription:
      "Repositionne le contenu et ajoute les éléments graphiques et la typographie du design.",
    styleDescription:
      "Modifie les couleurs, les polices et l’espacement en conservant la position des objets.",
    retainedLayoutNotice:
      "Mises en page conservées : {count}. Le contenu complexe garde sa position tandis que les couleurs et les polices sont mises à jour.",
    baseColorTheme: "Thème de couleurs de base",
    fromPresentationDesign: "Selon le design de présentation",
    baseThemeNotice:
      "Les thèmes de base modifient uniquement les couleurs. Choisissez un design de présentation complet pour modifier la mise en page et les éléments graphiques.",
  },
  "de-DE": {
    applicationLabel: "Anwendung",
    fullDesign: "Vollständiges Design",
    colorsAndFonts: "Farben und Schriften",
    applyDesign: "Design anwenden",
    applyStyle: "Stil anwenden",
    applyStyleToNativeSlides: "Stil auf native Folien anwenden",
    fullDesignDescription: "Ordnet Inhalte neu an und ergänzt Grafiken und Typografie des Designs.",
    styleDescription: "Ändert Farben, Schriften und Abstände und behält die Objektpositionen bei.",
    retainedLayoutNotice:
      "Beibehaltene Layouts: {count}. Komplexe Inhalte behalten ihre Position, während Farben und Schriften aktualisiert werden.",
    baseColorTheme: "Grundfarbthema",
    fromPresentationDesign: "Aus dem Präsentationsdesign",
    baseThemeNotice:
      "Grundthemen ändern nur die Farben. Wählen Sie ein vollständiges Präsentationsdesign, um Layout und Grafiken zu ändern.",
  },
  "es-ES": {
    applicationLabel: "Aplicación",
    fullDesign: "Diseño completo",
    colorsAndFonts: "Colores y fuentes",
    applyDesign: "Aplicar diseño",
    applyStyle: "Aplicar estilo",
    applyStyleToNativeSlides: "Aplicar estilo a las diapositivas nativas",
    fullDesignDescription:
      "Recoloca el contenido y añade los elementos gráficos y la tipografía del diseño.",
    styleDescription:
      "Cambia los colores, las fuentes y el espaciado, conservando la posición de los objetos.",
    retainedLayoutNotice:
      "Distribuciones conservadas: {count}. El contenido complejo mantiene su posición mientras se actualizan los colores y las fuentes.",
    baseColorTheme: "Tema de color base",
    fromPresentationDesign: "Del diseño de presentación",
    baseThemeNotice:
      "Los temas base solo cambian los colores. Elige un diseño de presentación completo para cambiar la distribución y los elementos gráficos.",
  },
  "it-IT": {
    applicationLabel: "Applicazione",
    fullDesign: "Design completo",
    colorsAndFonts: "Colori e caratteri",
    applyDesign: "Applica design",
    applyStyle: "Applica stile",
    applyStyleToNativeSlides: "Applica lo stile alle diapositive native",
    fullDesignDescription:
      "Riposiziona i contenuti e aggiunge la grafica e la tipografia del design.",
    styleDescription:
      "Modifica colori, caratteri e spaziatura mantenendo le posizioni degli oggetti.",
    retainedLayoutNotice:
      "Layout mantenuti: {count}. I contenuti complessi mantengono la posizione mentre i colori e i caratteri vengono aggiornati.",
    baseColorTheme: "Tema colori di base",
    fromPresentationDesign: "Dal design della presentazione",
    baseThemeNotice:
      "I temi di base modificano solo i colori. Scegli un design di presentazione completo per cambiare la disposizione e la grafica.",
  },
  "pt-PT": {
    applicationLabel: "Aplicação",
    fullDesign: "Design completo",
    colorsAndFonts: "Cores e tipos de letra",
    applyDesign: "Aplicar design",
    applyStyle: "Aplicar estilo",
    applyStyleToNativeSlides: "Aplicar estilo aos diapositivos nativos",
    fullDesignDescription:
      "Reposiciona o conteúdo e adiciona os elementos gráficos e a tipografia do design.",
    styleDescription:
      "Altera as cores, os tipos de letra e o espaçamento, mantendo as posições dos objetos.",
    retainedLayoutNotice:
      "Disposições mantidas: {count}. O conteúdo complexo mantém a posição enquanto as cores e os tipos de letra são atualizados.",
    baseColorTheme: "Tema de cores de base",
    fromPresentationDesign: "Do design da apresentação",
    baseThemeNotice:
      "Os temas de base alteram apenas as cores. Escolha um design de apresentação completo para alterar a disposição e os elementos gráficos.",
  },
  "ja-JP": {
    applicationLabel: "適用内容",
    fullDesign: "デザイン全体",
    colorsAndFonts: "色とフォント",
    applyDesign: "デザインを適用",
    applyStyle: "スタイルを適用",
    applyStyleToNativeSlides: "ネイティブスライドにスタイルを適用",
    fullDesignDescription: "コンテンツを再配置し、デザインの装飾と書体設定を追加します。",
    styleDescription: "オブジェクトの位置を保ち、色、フォント、間隔を変更します。",
    retainedLayoutNotice:
      "複雑なコンテンツを保護するため、{count}枚のスライドはレイアウトを維持し、色とフォントを更新します。",
    baseColorTheme: "基本のカラーテーマ",
    fromPresentationDesign: "プレゼンテーションデザインの色",
    baseThemeNotice:
      "基本テーマは色のみを変更します。レイアウトと装飾を変更するには、プレゼンテーションデザイン全体を選択してください。",
  },
  "ko-KR": {
    applicationLabel: "적용 범위",
    fullDesign: "전체 디자인",
    colorsAndFonts: "색상과 글꼴",
    applyDesign: "디자인 적용",
    applyStyle: "스타일 적용",
    applyStyleToNativeSlides: "네이티브 슬라이드에 스타일 적용",
    fullDesignDescription: "콘텐츠를 재배치하고 디자인의 장식과 서체 설정을 추가합니다.",
    styleDescription: "개체 위치를 유지하면서 색상, 글꼴과 간격을 변경합니다.",
    retainedLayoutNotice:
      "복잡한 콘텐츠를 보호하기 위해 슬라이드 {count}개는 레이아웃을 유지하고 색상과 글꼴을 업데이트합니다.",
    baseColorTheme: "기본 색상 테마",
    fromPresentationDesign: "프레젠테이션 디자인에서 지정",
    baseThemeNotice:
      "기본 테마는 색상만 변경합니다. 레이아웃과 장식을 바꾸려면 전체 프레젠테이션 디자인을 선택하세요.",
  },
  "zh-CN": {
    applicationLabel: "应用内容",
    fullDesign: "完整设计",
    colorsAndFonts: "颜色和字体",
    applyDesign: "应用设计",
    applyStyle: "应用样式",
    applyStyleToNativeSlides: "为原生幻灯片应用样式",
    fullDesignDescription: "重新排列内容，并添加设计中的装饰和字体设置。",
    styleDescription: "保留对象位置，仅更改颜色、字体和间距。",
    retainedLayoutNotice: "为保护复杂内容，{count}张幻灯片将保留布局，并更新颜色和字体。",
    baseColorTheme: "基础颜色主题",
    fromPresentationDesign: "来自演示文稿设计",
    baseThemeNotice: "基础主题只更改颜色。要更改布局和装饰，请选择完整的演示文稿设计。",
  },
  "zh-TW": {
    applicationLabel: "套用內容",
    fullDesign: "完整設計",
    colorsAndFonts: "色彩與字型",
    applyDesign: "套用設計",
    applyStyle: "套用樣式",
    applyStyleToNativeSlides: "將樣式套用至原生投影片",
    fullDesignDescription: "重新排列內容，並加入設計中的裝飾和字型設定。",
    styleDescription: "保留物件位置，僅變更色彩、字型與間距。",
    retainedLayoutNotice: "為保護複雜內容，{count}張投影片將保留版面配置，並更新色彩與字型。",
    baseColorTheme: "基本色彩佈景主題",
    fromPresentationDesign: "來自簡報設計",
    baseThemeNotice: "基本佈景主題只變更色彩。若要變更版面與裝飾，請選擇完整的簡報設計。",
  },
} satisfies Record<SupportedLocale, DesignApplicationCopy>;

export function presentationDesignApplicationCopy(locale: SupportedLocale = "en-CA") {
  return copy[locale];
}
