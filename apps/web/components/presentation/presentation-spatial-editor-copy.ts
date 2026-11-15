import type { SupportedLocale } from "@openround/contracts";

const messages = {
  "en-CA": ["Layout settings", "Arrangement help", "Playback order"],
  "fr-FR": ["Paramètres de disposition", "Aide à la disposition", "Ordre de lecture"],
  "de-DE": ["Layout-Einstellungen", "Hilfe zur Anordnung", "Wiedergabereihenfolge"],
  "es-ES": ["Ajustes de disposición", "Ayuda para organizar", "Orden de reproducción"],
  "it-IT": ["Impostazioni di disposizione", "Guida alla disposizione", "Ordine di riproduzione"],
  "pt-PT": ["Definições de disposição", "Ajuda de organização", "Ordem de reprodução"],
  "ja-JP": ["レイアウト設定", "配置のヘルプ", "再生順序"],
  "ko-KR": ["배치 설정", "배치 도움말", "재생 순서"],
  "zh-CN": ["布局设置", "排列帮助", "播放顺序"],
  "zh-TW": ["版面配置設定", "排列說明", "播放順序"],
} satisfies Record<SupportedLocale, readonly [string, string, string]>;

export function presentationSpatialEditorCopy(locale: SupportedLocale) {
  const [settings, help, playbackOrder] = messages[locale];
  return { settings, help, playbackOrder };
}
