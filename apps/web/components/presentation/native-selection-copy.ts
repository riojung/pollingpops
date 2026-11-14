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

// Selection chrome only. Authored object labels retain their own text and language.
const messages = {
  "Object shortcuts": [
    "Raccourcis des objets",
    "Objekt-Kurzbefehle",
    "Atajos de objetos",
    "Scorciatoie oggetti",
    "Atalhos dos objetos",
    "オブジェクトの操作方法",
    "개체 조작 도움말",
    "对象操作帮助",
    "物件操作說明",
  ],
  "Group {number} · {count}": [
    "Groupe {number} · {count}",
    "Gruppe {number} · {count}",
    "Grupo {number} · {count}",
    "Gruppo {number} · {count}",
    "Grupo {number} · {count}",
    "グループ{number} · {count}",
    "그룹 {number} · {count}",
    "组{number} · {count}",
    "群組{number} · {count}",
  ],
  "Group {number}, {count} objects": [
    "Groupe {number}, {count} objets",
    "Gruppe {number}, {count} Objekte",
    "Grupo {number}, {count} objetos",
    "Gruppo {number}, {count} oggetti",
    "Grupo {number}, {count} objetos",
    "グループ{number}、{count}個のオブジェクト",
    "그룹 {number}, 개체 {count}개",
    "组{number}，{count}个对象",
    "群組{number}，{count}個物件",
  ],
  "Slide canvas": [
    "Canevas de la diapositive",
    "Folienfläche",
    "Lienzo de la diapositiva",
    "Area della diapositiva",
    "Área do diapositivo",
    "スライドのキャンバス",
    "슬라이드 캔버스",
    "幻灯片画布",
    "投影片畫布",
  ],
  "Slide canvas. Use arrow keys to move selected objects; hold Shift for larger steps.": [
    "Canevas de la diapositive. Utilisez les flèches pour déplacer les objets sélectionnés ; maintenez Maj pour de plus grands déplacements.",
    "Folienfläche. Ausgewählte Objekte mit den Pfeiltasten bewegen; für größere Schritte die Umschalttaste gedrückt halten.",
    "Lienzo de la diapositiva. Usa las flechas para mover los objetos seleccionados; mantén Mayús para pasos mayores.",
    "Area della diapositiva. Usa le frecce per spostare gli oggetti selezionati; tieni premuto Maiusc per spostamenti maggiori.",
    "Área do diapositivo. Utilize as setas para mover os objetos selecionados; mantenha Shift premido para passos maiores.",
    "スライドのキャンバス。矢印キーで選択したオブジェクトを移動します。Shiftキーを押すと移動幅が大きくなります。",
    "슬라이드 캔버스. 화살표 키로 선택한 개체를 이동하세요. Shift 키를 누르면 더 크게 이동합니다.",
    "幻灯片画布。使用方向键移动所选对象；按住Shift键可增大移动幅度。",
    "投影片畫布。使用方向鍵移動所選物件；按住Shift鍵可增大移動幅度。",
  ],
  "On wide slides, drag objects to move them or corner handles to resize. Focus the canvas and use arrow keys; hold Shift for larger steps. Use Arrange for exact position and size.":
    [
      "Sur les diapositives larges, faites glisser les objets pour les déplacer ou les poignées d’angle pour les redimensionner. Placez le focus sur le canevas et utilisez les flèches ; maintenez Maj pour de plus grands déplacements. Utilisez Disposition pour régler précisément la position et la taille.",
      "Auf breiten Folien Objekte zum Bewegen oder Eckgriffe zum Vergrößern ziehen. Die Folienfläche fokussieren und die Pfeiltasten verwenden; mit Umschalt sind die Schritte größer. Für genaue Position und Größe die Anordnung öffnen.",
      "En diapositivas anchas, arrastra los objetos para moverlos o los tiradores de esquina para cambiar su tamaño. Enfoca el lienzo y usa las flechas; mantén Mayús para pasos mayores. Usa Organizar para precisar la posición y el tamaño.",
      "Nelle diapositive larghe, trascina gli oggetti per spostarli o le maniglie agli angoli per ridimensionarli. Porta il focus sull’area e usa le frecce; tieni premuto Maiusc per spostamenti maggiori. Usa Disponi per posizione e dimensioni precise.",
      "Em diapositivos largos, arraste os objetos para os mover ou as alças dos cantos para redimensionar. Foque a área e utilize as setas; mantenha Shift premido para passos maiores. Utilize Dispor para definir a posição e o tamanho exatos.",
      "幅の広いスライドでは、オブジェクトをドラッグして移動し、角のハンドルをドラッグしてサイズを変更できます。キャンバスにフォーカスして矢印キーを使います。Shiftキーで移動幅が大きくなります。正確な位置とサイズは配置で指定します。",
      "넓은 슬라이드에서 개체를 드래그해 이동하거나 모서리 핸들로 크기를 조절하세요. 캔버스에 초점을 맞추고 화살표 키를 사용하세요. Shift 키를 누르면 더 크게 이동합니다. 정확한 위치와 크기는 개체 배치에서 설정하세요.",
      "在宽幅幻灯片中，拖动对象可移动位置，拖动角部控点可调整大小。将焦点移到画布后使用方向键；按住Shift键可增大移动幅度。使用排列功能设置精确的位置和大小。",
      "在寬幅投影片中，拖曳物件可移動位置，拖曳角落控點可調整大小。將焦點移到畫布後使用方向鍵；按住Shift鍵可增大移動幅度。使用排列功能設定精確的位置和大小。",
    ],
} as const;

export type NativeSelectionCopyKey = keyof typeof messages;
export const nativeSelectionCopyKeys = Object.keys(messages) as NativeSelectionCopyKey[];
export function nativeSelectionCopy(locale: SupportedLocale = "en-CA") {
  const column = locales.indexOf(locale as (typeof locales)[number]);
  return (key: NativeSelectionCopyKey, values: Record<string, string | number> = {}) => {
    const message = column < 0 ? key : (messages[key][column] ?? key);
    return message.replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
  };
}
