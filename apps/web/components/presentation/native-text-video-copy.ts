import type { SupportedLocale } from "@openround/contracts";
import { nativeEditorCopy, type NativeEditorCopyKey } from "./native-editor-copy";

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
type TranslationRow = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

// System UI only. Authored text, links and stored rich-text values never pass through this catalog.
const sharedKeys = [
  "Native slide title",
  "Node text",
] as const satisfies readonly NativeEditorCopyKey[];
const messages = {
  "Text formatting": [
    "Mise en forme du texte",
    "Textformatierung",
    "Formato de texto",
    "Formattazione del testo",
    "Formatação do texto",
    "テキストの書式",
    "텍스트 서식",
    "文本格式",
    "文字格式",
  ],
  Bold: ["Gras", "Fett", "Negrita", "Grassetto", "Negrito", "太字", "굵게", "粗体", "粗體"],
  Italic: [
    "Italique",
    "Kursiv",
    "Cursiva",
    "Corsivo",
    "Itálico",
    "斜体",
    "기울임꼴",
    "斜体",
    "斜體",
  ],
  "Paragraph style": [
    "Style de paragraphe",
    "Absatzstil",
    "Estilo de párrafo",
    "Stile del paragrafo",
    "Estilo de parágrafo",
    "段落スタイル",
    "문단 스타일",
    "段落样式",
    "段落樣式",
  ],
  "Choose for selected paragraphs": [
    "Choisir pour les paragraphes sélectionnés",
    "Für ausgewählte Absätze wählen",
    "Elegir para los párrafos seleccionados",
    "Scegli per i paragrafi selezionati",
    "Escolher para os parágrafos selecionados",
    "選択した段落に適用",
    "선택한 문단에 적용",
    "为所选段落选择",
    "為所選段落選擇",
  ],
  Paragraph: [
    "Paragraphe",
    "Absatz",
    "Párrafo",
    "Paragrafo",
    "Parágrafo",
    "段落",
    "문단",
    "段落",
    "段落",
  ],
  "Bulleted list": [
    "Liste à puces",
    "Aufzählung",
    "Lista con viñetas",
    "Elenco puntato",
    "Lista com marcas",
    "箇条書き",
    "글머리 기호 목록",
    "项目符号列表",
    "項目符號清單",
  ],
  "Numbered list": [
    "Liste numérotée",
    "Nummerierte Liste",
    "Lista numerada",
    "Elenco numerato",
    "Lista numerada",
    "番号付きリスト",
    "번호 매기기 목록",
    "编号列表",
    "編號清單",
  ],
  "Link address": [
    "Adresse du lien",
    "Linkadresse",
    "Dirección del enlace",
    "Indirizzo del collegamento",
    "Endereço da ligação",
    "リンク先アドレス",
    "링크 주소",
    "链接地址",
    "連結位址",
  ],
  "Apply link": [
    "Appliquer le lien",
    "Link anwenden",
    "Aplicar enlace",
    "Applica collegamento",
    "Aplicar ligação",
    "リンクを適用",
    "링크 적용",
    "应用链接",
    "套用連結",
  ],
  "Remove link": [
    "Supprimer le lien",
    "Link entfernen",
    "Quitar enlace",
    "Rimuovi collegamento",
    "Remover ligação",
    "リンクを削除",
    "링크 제거",
    "移除链接",
    "移除連結",
  ],
  "Remove formatting": [
    "Supprimer la mise en forme",
    "Formatierung entfernen",
    "Quitar formato",
    "Rimuovi formattazione",
    "Remover formatação",
    "書式を削除",
    "서식 제거",
    "清除格式",
    "清除格式",
  ],
  "Select text before applying emphasis or a link. Paragraph style applies to the current or selected paragraphs. Pasting adds plain text; existing text keeps its formatting. Links open in a new tab when presenting or previewing.":
    [
      "Sélectionnez le texte avant d’appliquer une mise en valeur ou un lien. Le style s’applique au paragraphe actuel ou aux paragraphes sélectionnés. Le collage ajoute du texte brut ; le texte existant conserve sa mise en forme. Les liens s’ouvrent dans un nouvel onglet pendant la présentation ou la prévisualisation.",
      "Wählen Sie Text aus, bevor Sie Hervorhebungen oder einen Link anwenden. Der Absatzstil gilt für den aktuellen oder die ausgewählten Absätze. Einfügen ergänzt reinen Text; vorhandener Text behält seine Formatierung. Links öffnen sich bei Präsentation oder Vorschau in einem neuen Tab.",
      "Selecciona texto antes de aplicar énfasis o un enlace. El estilo se aplica al párrafo actual o a los seleccionados. Al pegar se añade texto sin formato; el texto existente conserva su formato. Los enlaces se abren en una pestaña nueva al presentar o previsualizar.",
      "Seleziona il testo prima di applicare enfasi o un collegamento. Lo stile si applica al paragrafo corrente o a quelli selezionati. Incollare aggiunge testo semplice; il testo esistente mantiene la formattazione. I collegamenti si aprono in una nuova scheda durante la presentazione o l’anteprima.",
      "Selecione texto antes de aplicar destaque ou uma ligação. O estilo aplica-se ao parágrafo atual ou aos selecionados. Colar adiciona texto simples; o texto existente mantém a formatação. As ligações abrem num novo separador durante a apresentação ou pré-visualização.",
      "強調やリンクを適用する前にテキストを選択してください。段落スタイルは現在の段落または選択した段落に適用されます。貼り付けではプレーンテキストが追加され、既存のテキストの書式は保持されます。発表時やプレビュー時、リンクは新しいタブで開きます。",
      "강조나 링크를 적용하기 전에 텍스트를 선택하세요. 문단 스타일은 현재 문단이나 선택한 문단에 적용됩니다. 붙여넣기는 일반 텍스트를 추가하며 기존 텍스트의 서식은 유지됩니다. 발표나 미리보기에서 링크는 새 탭으로 열립니다.",
      "应用强调或链接前请先选择文本。段落样式适用于当前段落或所选段落。粘贴会添加纯文本；现有文本保留其格式。演示或预览时，链接会在新标签页中打开。",
      "套用強調或連結前請先選取文字。段落樣式適用於目前段落或所選段落。貼上會加入純文字；現有文字保留其格式。簡報或預覽時，連結會在新分頁中開啟。",
    ],
  "Undo and Redo are unavailable in this view.": [
    "Annuler et rétablir ne sont pas disponibles dans cette vue.",
    "Rückgängig und Wiederholen sind in dieser Ansicht nicht verfügbar.",
    "Deshacer y rehacer no están disponibles en esta vista.",
    "Annulla e ripristina non sono disponibili in questa vista.",
    "Anular e refazer não estão disponíveis nesta vista.",
    "この画面では元に戻す操作とやり直しは使用できません。",
    "이 보기에서는 실행 취소와 다시 실행을 사용할 수 없습니다.",
    "此视图中无法撤销和重做。",
    "此檢視無法復原及重做。",
  ],
  "This text change exceeds the formatting limits or contains unsupported characters. Shorten it or remove some formatting and try again.":
    [
      "Cette modification dépasse les limites de mise en forme ou contient des caractères non pris en charge. Raccourcissez le texte ou supprimez de la mise en forme, puis réessayez.",
      "Diese Textänderung überschreitet die Formatierungsgrenzen oder enthält nicht unterstützte Zeichen. Kürzen Sie den Text oder entfernen Sie Formatierungen und versuchen Sie es erneut.",
      "Este cambio supera los límites de formato o contiene caracteres no admitidos. Acorta el texto o quita parte del formato y vuelve a intentarlo.",
      "Questa modifica supera i limiti di formattazione o contiene caratteri non supportati. Accorcia il testo o rimuovi parte della formattazione e riprova.",
      "Esta alteração excede os limites de formatação ou contém caracteres não suportados. Encurte o texto ou remova alguma formatação e tente novamente.",
      "この変更は書式の上限を超えているか、未対応の文字を含んでいます。テキストを短くするか、一部の書式を削除して再試行してください。",
      "이 텍스트 변경은 서식 제한을 초과하거나 지원하지 않는 문자를 포함합니다. 텍스트를 줄이거나 일부 서식을 제거한 후 다시 시도하세요.",
      "此文本更改超出格式限制或包含不支持的字符。请缩短文本或移除部分格式后重试。",
      "此文字變更超出格式限制或包含不支援的字元。請縮短文字或移除部分格式後重試。",
    ],
  "Enter a complete http:// or https:// link without a username or password.": [
    "Saisissez un lien http:// ou https:// complet sans nom d’utilisateur ni mot de passe.",
    "Geben Sie einen vollständigen http://- oder https://-Link ohne Benutzername oder Passwort ein.",
    "Introduce un enlace http:// o https:// completo sin nombre de usuario ni contraseña.",
    "Inserisci un collegamento http:// o https:// completo senza nome utente o password.",
    "Introduza uma ligação http:// ou https:// completa sem nome de utilizador nem palavra-passe.",
    "ユーザー名やパスワードを含まない完全な http:// または https:// リンクを入力してください。",
    "사용자 이름이나 비밀번호가 없는 완전한 http:// 또는 https:// 링크를 입력하세요.",
    "请输入不含用户名或密码的完整 http:// 或 https:// 链接。",
    "請輸入不含使用者名稱或密碼的完整 http:// 或 https:// 連結。",
  ],
  "This text change could not be matched to its selection. Try the edit again.": [
    "Cette modification ne correspond pas à la sélection. Réessayez la modification.",
    "Diese Textänderung konnte der Auswahl nicht zugeordnet werden. Versuchen Sie die Bearbeitung erneut.",
    "No se pudo asociar este cambio de texto a la selección. Vuelve a editarlo.",
    "Questa modifica non corrisponde alla selezione. Riprova la modifica.",
    "Não foi possível associar esta alteração à seleção. Tente editar novamente.",
    "このテキスト変更を選択範囲に対応付けられませんでした。もう一度編集してください。",
    "이 텍스트 변경을 선택 영역과 일치시킬 수 없습니다. 다시 편집하세요.",
    "无法将此文本更改与所选内容匹配。请重新编辑。",
    "無法將此文字變更與所選內容配對。請重新編輯。",
  ],
  "External video": [
    "Vidéo externe",
    "Externes Video",
    "Vídeo externo",
    "Video esterno",
    "Vídeo externo",
    "外部動画",
    "외부 동영상",
    "外部视频",
    "外部影片",
  ],
  "Video title": [
    "Titre de la vidéo",
    "Videotitel",
    "Título del vídeo",
    "Titolo del video",
    "Título do vídeo",
    "動画のタイトル",
    "동영상 제목",
    "视频标题",
    "影片標題",
  ],
  "Video HTTPS link": [
    "Lien HTTPS de la vidéo",
    "HTTPS-Link zum Video",
    "Enlace HTTPS del vídeo",
    "Collegamento HTTPS al video",
    "Ligação HTTPS do vídeo",
    "動画の HTTPS リンク",
    "동영상 HTTPS 링크",
    "视频 HTTPS 链接",
    "影片 HTTPS 連結",
  ],
  "Captions or transcript HTTPS link": [
    "Lien HTTPS des sous-titres ou de la transcription",
    "HTTPS-Link zu Untertiteln oder Transkript",
    "Enlace HTTPS de subtítulos o transcripción",
    "Collegamento HTTPS a sottotitoli o trascrizione",
    "Ligação HTTPS das legendas ou transcrição",
    "字幕または文字起こしの HTTPS リンク",
    "자막 또는 대본 HTTPS 링크",
    "字幕或文字稿 HTTPS 链接",
    "字幕或逐字稿 HTTPS 連結",
  ],
  "Add external video link": [
    "Ajouter un lien vidéo externe",
    "Externen Videolink hinzufügen",
    "Añadir enlace de vídeo externo",
    "Aggiungi collegamento a video esterno",
    "Adicionar ligação de vídeo externo",
    "外部動画リンクを追加",
    "외부 동영상 링크 추가",
    "添加外部视频链接",
    "新增外部影片連結",
  ],
  "Add a video destination and a captions or transcript fallback. The slide shows both links. Playback opens on the external site when the audience chooses the link; availability is not checked here.":
    [
      "Ajoutez un lien vidéo et un lien de secours vers des sous-titres ou une transcription. La diapositive affiche les deux liens. La lecture s’ouvre sur le site externe lorsque le public sélectionne le lien ; la disponibilité n’est pas vérifiée ici.",
      "Fügen Sie ein Videoziel und einen Ersatzlink zu Untertiteln oder einem Transkript hinzu. Die Folie zeigt beide Links. Die Wiedergabe öffnet sich auf der externen Website, wenn das Publikum den Link auswählt; die Verfügbarkeit wird hier nicht geprüft.",
      "Añade un destino de vídeo y una alternativa con subtítulos o transcripción. La diapositiva muestra ambos enlaces. La reproducción se abre en el sitio externo cuando el público elige el enlace; aquí no se comprueba la disponibilidad.",
      "Aggiungi un video e un collegamento alternativo a sottotitoli o trascrizione. La diapositiva mostra entrambi i collegamenti. La riproduzione si apre sul sito esterno quando il pubblico sceglie il collegamento; la disponibilità non viene verificata qui.",
      "Adicione um destino de vídeo e uma alternativa com legendas ou transcrição. O diapositivo mostra ambas as ligações. A reprodução abre no site externo quando o público escolhe a ligação; a disponibilidade não é verificada aqui.",
      "動画のリンクと、代替となる字幕または文字起こしのリンクを追加します。スライドには両方のリンクが表示されます。視聴者がリンクを選択すると外部サイトで再生画面が開きます。利用可否はここでは確認されません。",
      "동영상 링크와 대체 수단인 자막 또는 대본 링크를 추가하세요. 슬라이드에 두 링크가 모두 표시됩니다. 청중이 링크를 선택하면 외부 사이트에서 재생 화면이 열립니다. 여기서는 이용 가능 여부를 확인하지 않습니다.",
      "添加视频地址及作为备用的字幕或文字稿链接。幻灯片会显示两个链接。观众选择链接后，会在外部网站打开播放页面；此处不会检查可用性。",
      "新增影片位址及作為備用的字幕或逐字稿連結。投影片會顯示兩個連結。觀眾選擇連結後，會在外部網站開啟播放頁面；此處不會檢查可用性。",
    ],
  "This link exceeds the slide’s limits. Shorten the links or remove some content, then try again.":
    [
      "Ce lien dépasse les limites de la diapositive. Raccourcissez les liens ou supprimez du contenu, puis réessayez.",
      "Dieser Link überschreitet die Foliengrenzen. Kürzen Sie die Links oder entfernen Sie Inhalte und versuchen Sie es erneut.",
      "Este enlace supera los límites de la diapositiva. Acorta los enlaces o elimina parte del contenido y vuelve a intentarlo.",
      "Questo collegamento supera i limiti della diapositiva. Accorcia i collegamenti o rimuovi parte del contenuto e riprova.",
      "Esta ligação excede os limites do diapositivo. Encurte as ligações ou remova algum conteúdo e tente novamente.",
      "このリンクはスライドの上限を超えています。リンクを短くするか、内容を減らして再試行してください。",
      "이 링크는 슬라이드 제한을 초과합니다. 링크를 줄이거나 일부 콘텐츠를 제거한 후 다시 시도하세요.",
      "此链接超出幻灯片限制。请缩短链接或移除部分内容后重试。",
      "此連結超出投影片限制。請縮短連結或移除部分內容後重試。",
    ],
  "The Presentation could not accept this link. Your entries are retained; reduce content and try again.":
    [
      "La présentation n’a pas pu accepter ce lien. Vos saisies sont conservées ; réduisez le contenu et réessayez.",
      "Die Präsentation konnte diesen Link nicht übernehmen. Ihre Eingaben bleiben erhalten; reduzieren Sie Inhalte und versuchen Sie es erneut.",
      "La presentación no pudo aceptar este enlace. Tus datos se conservan; reduce el contenido y vuelve a intentarlo.",
      "La presentazione non ha potuto accettare questo collegamento. I dati inseriti vengono conservati; riduci il contenuto e riprova.",
      "A apresentação não conseguiu aceitar esta ligação. Os dados introduzidos são mantidos; reduza o conteúdo e tente novamente.",
      "プレゼンテーションにこのリンクを追加できませんでした。入力内容は保持されます。内容を減らして再試行してください。",
      "프레젠테이션에 이 링크를 추가할 수 없습니다. 입력한 내용은 유지됩니다. 콘텐츠를 줄이고 다시 시도하세요.",
      "演示文稿无法接受此链接。输入内容已保留；请减少内容后重试。",
      "簡報無法接受此連結。輸入內容已保留；請減少內容後重試。",
    ],
  "Check the video and transcript links.": [
    "Vérifiez les liens de la vidéo et de la transcription.",
    "Prüfen Sie die Video- und Transkriptlinks.",
    "Comprueba los enlaces del vídeo y la transcripción.",
    "Controlla i collegamenti al video e alla trascrizione.",
    "Verifique as ligações do vídeo e da transcrição.",
    "動画と文字起こしのリンクを確認してください。",
    "동영상과 대본 링크를 확인하세요.",
    "请检查视频和文字稿链接。",
    "請檢查影片及逐字稿連結。",
  ],
  "Keep each HTTPS link within 2048 characters.": [
    "Limitez chaque lien HTTPS à 2048 caractères.",
    "Begrenzen Sie jeden HTTPS-Link auf 2048 Zeichen.",
    "Limita cada enlace HTTPS a 2048 caracteres.",
    "Limita ogni collegamento HTTPS a 2048 caratteri.",
    "Limite cada ligação HTTPS a 2048 caracteres.",
    "各 HTTPS リンクは2048文字以内にしてください。",
    "각 HTTPS 링크는 2048자 이내로 입력하세요.",
    "每个 HTTPS 链接请勿超过 2048 个字符。",
    "每個 HTTPS 連結請勿超過 2048 個字元。",
  ],
  "Use an HTTPS link without embedded credentials.": [
    "Utilisez un lien HTTPS sans identifiants intégrés.",
    "Verwenden Sie einen HTTPS-Link ohne eingebettete Anmeldedaten.",
    "Usa un enlace HTTPS sin credenciales incorporadas.",
    "Usa un collegamento HTTPS senza credenziali incorporate.",
    "Utilize uma ligação HTTPS sem credenciais incorporadas.",
    "認証情報を含まない HTTPS リンクを使用してください。",
    "인증 정보가 포함되지 않은 HTTPS 링크를 사용하세요.",
    "请使用不含内嵌凭据的 HTTPS 链接。",
    "請使用不含內嵌認證資訊的 HTTPS 連結。",
  ],
  "Give the video a title of at most 160 characters.": [
    "Donnez à la vidéo un titre de 160 caractères maximum.",
    "Geben Sie dem Video einen Titel mit höchstens 160 Zeichen.",
    "Asigna al vídeo un título de hasta 160 caracteres.",
    "Assegna al video un titolo di massimo 160 caratteri.",
    "Dê ao vídeo um título com até 160 caracteres.",
    "動画のタイトルを160文字以内で入力してください。",
    "동영상 제목은 160자 이내로 입력하세요.",
    "请为视频输入不超过 160 个字符的标题。",
    "請為影片輸入不超過 160 個字元的標題。",
  ],
  "Enter a complete HTTPS link.": [
    "Saisissez un lien HTTPS complet.",
    "Geben Sie einen vollständigen HTTPS-Link ein.",
    "Introduce un enlace HTTPS completo.",
    "Inserisci un collegamento HTTPS completo.",
    "Introduza uma ligação HTTPS completa.",
    "完全な HTTPS リンクを入力してください。",
    "완전한 HTTPS 링크를 입력하세요.",
    "请输入完整的 HTTPS 链接。",
    "請輸入完整的 HTTPS 連結。",
  ],
} as const satisfies Record<string, TranslationRow>;

type LocalKey = keyof typeof messages;
export type NativeTextVideoCopyKey = LocalKey | (typeof sharedKeys)[number];
export const nativeTextVideoCopyKeys: readonly NativeTextVideoCopyKey[] = [
  ...sharedKeys,
  ...(Object.keys(messages) as LocalKey[]),
];

function isLocalKey(key: NativeTextVideoCopyKey): key is LocalKey {
  return Object.hasOwn(messages, key);
}

export function nativeTextVideoCopy(locale: SupportedLocale = "en-CA") {
  const column = locales.indexOf(locale as (typeof locales)[number]);
  const sharedCopy = nativeEditorCopy(locale);
  return (key: NativeTextVideoCopyKey, values: Record<string, string | number> = {}): string => {
    if (!isLocalKey(key)) return sharedCopy(key, values);
    const message = column < 0 ? key : messages[key][column]!;
    return message.replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
  };
}

export type NativeTextVideoFeedback =
  { key: NativeTextVideoCopyKey; diagnostic?: never } | { key?: never; diagnostic: string };

/** Only known library validation messages become UI keys; unfamiliar diagnostics stay verbatim. */
export function nativeTextVideoValidationFeedback(
  caught: unknown,
  fallback: NativeTextVideoCopyKey,
): NativeTextVideoFeedback {
  if (!(caught instanceof Error) || "issues" in caught) return { key: fallback };
  switch (caught.message) {
    case "Enter a complete http:// or https:// link without a username or password.":
    case "This text change could not be matched to its selection. Try the edit again.":
    case "Keep each HTTPS link within 2048 characters.":
    case "Use an HTTPS link without embedded credentials.":
    case "Give the video a title of at most 160 characters.":
      return { key: caught.message };
    case "Invalid URL":
    case "Failed to construct 'URL': Invalid URL":
      return caught instanceof TypeError
        ? { key: "Enter a complete HTTPS link." }
        : { diagnostic: caught.message };
    default:
      return { diagnostic: caught.message };
  }
}
