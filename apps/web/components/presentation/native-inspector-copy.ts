import type { SupportedLocale } from "@openround/contracts";

const locales = [
  "fr-FR",
  "de-DE",
  "es-ES",
  "it-IT",
  "pt-PT",
  "ja-JP",
  "ko-KR",
  "zh-CN",
  "zh-TW",
] as const;
const labels = {
  "Font family": [
    "Famille de police",
    "Schriftfamilie",
    "Familia de fuentes",
    "Famiglia di caratteri",
    "Família de tipos de letra",
    "フォントファミリー",
    "글꼴 종류",
    "字体系列",
    "字型系列",
  ],
  "Font size (px)": [
    "Taille de police (px)",
    "Schriftgröße (px)",
    "Tamaño de fuente (px)",
    "Dimensione carattere (px)",
    "Tamanho da letra (px)",
    "フォントサイズ（px）",
    "글꼴 크기 (px)",
    "字号（像素）",
    "字型大小（像素）",
  ],
  "Inherit slide font": [
    "Utiliser la police de la diapositive",
    "Folienschrift übernehmen",
    "Heredar fuente de diapositiva",
    "Eredita carattere diapositiva",
    "Herdar tipo de letra do diapositivo",
    "スライドのフォントを継承",
    "슬라이드 글꼴 상속",
    "继承幻灯片字体",
    "繼承投影片字型",
  ],
  Automatic: [
    "Automatique",
    "Automatisch",
    "Automático",
    "Automatico",
    "Automático",
    "自動",
    "자동",
    "自动",
    "自動",
  ],
} as const;

export function nativeInspectorCopy(locale: SupportedLocale) {
  return (key: keyof typeof labels) => {
    const index = locales.indexOf(locale as (typeof locales)[number]);
    return index < 0 ? key : labels[key][index];
  };
}
