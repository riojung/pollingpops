import type { SupportedLocale } from "@openround/contracts";

export const experienceCatalogEnglishMessages = {
  "live.experience.category.science": "Science",
  "live.experience.category.health_wellbeing": "Health and wellbeing",
  "live.experience.category.arts_culture": "Arts and culture",
  "live.experience.category.leadership": "Leadership",
  "live.experience.category.sustainability": "Sustainability",
  "live.experience.category.community": "Community",
  "live.experience.preset.observatory.name": "Observatory",
  "live.experience.preset.breath.name": "Breath",
  "live.experience.preset.gallery.name": "Gallery",
  "live.experience.preset.summit.name": "Summit",
  "live.experience.preset.grove.name": "Grove",
  "live.experience.preset.commons.name": "Commons",
  "live.experience.preset.midnight.name": "Midnight",
  "live.experience.preset.observatory.description":
    "Deep indigo for discovery, evidence, and big questions.",
  "live.experience.preset.breath.description":
    "Soft sage and linen for reflective wellbeing conversations.",
  "live.experience.preset.gallery.description":
    "Warm paper and plum for creative practice, arts, and culture.",
  "live.experience.preset.summit.description":
    "Dark slate and ice for strategy, leadership, and clear decisions.",
  "live.experience.preset.grove.description":
    "Natural green and sand for sustainability and shared futures.",
  "live.experience.preset.commons.description":
    "Welcoming terracotta and cream for community conversations.",
  "live.experience.preset.midnight.description":
    "Quiet charcoal and lavender for evening sessions and focused discussion.",
  "live.experience.paletteLight": "Light",
  "live.experience.paletteDark": "Dark",
  "live.experience.selected": "Selected",
  "live.experience.recommended": "Recommended",
  "live.experience.previewQuestion": "What will we explore together?",
  "live.experience.previewChoiceA": "A new idea",
  "live.experience.previewChoiceB": "A different perspective",
  "live.experience.previewHelp": "Sample question and answers using the selected look.",
  "live.experience.usingPublished": "Using the published look: {name}.",
  "live.experience.launchOverride": "This room uses a different look. Published look: {name}.",
  "live.experience.resetPublished": "Use published look",
  "live.experience.galleryHelp":
    "Choose a look for any topic. Each card previews its actual palette.",
  "live.experience.categoryHelp":
    "Choose the topic. Changing the category updates its recommendation and keeps your selected look.",
} as const;

type ExperienceCatalogMessages = Record<keyof typeof experienceCatalogEnglishMessages, string>;

const translations: Record<SupportedLocale, ExperienceCatalogMessages> = {
  "en-CA": experienceCatalogEnglishMessages,
  "fr-FR": {
    "live.experience.category.science": "Sciences",
    "live.experience.category.health_wellbeing": "Santé et bien-être",
    "live.experience.category.arts_culture": "Arts et culture",
    "live.experience.category.leadership": "Leadership",
    "live.experience.category.sustainability": "Développement durable",
    "live.experience.category.community": "Communauté",
    "live.experience.preset.observatory.name": "Observatory",
    "live.experience.preset.breath.name": "Breath",
    "live.experience.preset.gallery.name": "Gallery",
    "live.experience.preset.summit.name": "Summit",
    "live.experience.preset.grove.name": "Grove",
    "live.experience.preset.commons.name": "Commons",
    "live.experience.preset.midnight.name": "Midnight",
    "live.experience.preset.observatory.description":
      "Indigo profond pour la découverte, les preuves et les grandes questions.",
    "live.experience.preset.breath.description": "Sauge et lin doux pour réfléchir au bien-être.",
    "live.experience.preset.gallery.description":
      "Papier chaud et prune pour la création, les arts et la culture.",
    "live.experience.preset.summit.description":
      "Ardoise sombre et glace pour la stratégie et le leadership.",
    "live.experience.preset.grove.description":
      "Vert naturel et sable pour un avenir durable et partagé.",
    "live.experience.preset.commons.description":
      "Terre cuite et crème pour les échanges communautaires.",
    "live.experience.preset.midnight.description":
      "Anthracite et lavande pour les séances du soir et la réflexion.",
    "live.experience.paletteLight": "Clair",
    "live.experience.paletteDark": "Sombre",
    "live.experience.selected": "Sélectionné",
    "live.experience.recommended": "Recommandé",
    "live.experience.previewQuestion": "Qu’allons-nous explorer ensemble ?",
    "live.experience.previewChoiceA": "Une nouvelle idée",
    "live.experience.previewChoiceB": "Une autre perspective",
    "live.experience.previewHelp": "Exemple de question et de réponses avec l’aspect choisi.",
    "live.experience.usingPublished": "Aspect publié utilisé : {name}.",
    "live.experience.launchOverride":
      "Cette salle utilise un autre aspect. Aspect publié : {name}.",
    "live.experience.resetPublished": "Utiliser l’aspect publié",
    "live.experience.galleryHelp":
      "Choisissez un aspect pour tout sujet. Chaque carte montre sa palette réelle.",
    "live.experience.categoryHelp":
      "Choisissez le sujet. Changer la catégorie actualise la recommandation et conserve l’aspect choisi.",
  },
  "de-DE": {
    "live.experience.category.science": "Wissenschaft",
    "live.experience.category.health_wellbeing": "Gesundheit und Wohlbefinden",
    "live.experience.category.arts_culture": "Kunst und Kultur",
    "live.experience.category.leadership": "Führung",
    "live.experience.category.sustainability": "Nachhaltigkeit",
    "live.experience.category.community": "Gemeinschaft",
    "live.experience.preset.observatory.name": "Observatory",
    "live.experience.preset.breath.name": "Breath",
    "live.experience.preset.gallery.name": "Gallery",
    "live.experience.preset.summit.name": "Summit",
    "live.experience.preset.grove.name": "Grove",
    "live.experience.preset.commons.name": "Commons",
    "live.experience.preset.midnight.name": "Midnight",
    "live.experience.preset.observatory.description":
      "Tiefes Indigo für Entdeckungen, Belege und große Fragen.",
    "live.experience.preset.breath.description":
      "Sanftes Salbei und Leinen für Gespräche über Wohlbefinden.",
    "live.experience.preset.gallery.description":
      "Warmes Papier und Pflaume für Kreativität, Kunst und Kultur.",
    "live.experience.preset.summit.description":
      "Dunkler Schiefer und Eis für Strategie, Führung und klare Entscheidungen.",
    "live.experience.preset.grove.description":
      "Natürliches Grün und Sand für Nachhaltigkeit und gemeinsame Zukunft.",
    "live.experience.preset.commons.description":
      "Einladendes Terrakotta und Creme für die Gemeinschaft.",
    "live.experience.preset.midnight.description":
      "Ruhiges Anthrazit und Lavendel für Abendrunden und konzentrierte Gespräche.",
    "live.experience.paletteLight": "Hell",
    "live.experience.paletteDark": "Dunkel",
    "live.experience.selected": "Ausgewählt",
    "live.experience.recommended": "Empfohlen",
    "live.experience.previewQuestion": "Was erkunden wir gemeinsam?",
    "live.experience.previewChoiceA": "Eine neue Idee",
    "live.experience.previewChoiceB": "Eine andere Perspektive",
    "live.experience.previewHelp": "Beispielfrage und Antworten im gewählten Design.",
    "live.experience.usingPublished": "Veröffentlichtes Design: {name}.",
    "live.experience.launchOverride":
      "Dieser Raum verwendet ein anderes Design. Veröffentlichtes Design: {name}.",
    "live.experience.resetPublished": "Veröffentlichtes Design verwenden",
    "live.experience.galleryHelp":
      "Wählen Sie ein Design für jedes Thema. Jede Karte zeigt ihre tatsächliche Palette.",
    "live.experience.categoryHelp":
      "Nur Themenangabe. Eine andere Kategorie aktualisiert die Empfehlung; das gewählte Design bleibt erhalten.",
  },
  "es-ES": {
    "live.experience.category.science": "Ciencia",
    "live.experience.category.health_wellbeing": "Salud y bienestar",
    "live.experience.category.arts_culture": "Arte y cultura",
    "live.experience.category.leadership": "Liderazgo",
    "live.experience.category.sustainability": "Sostenibilidad",
    "live.experience.category.community": "Comunidad",
    "live.experience.preset.observatory.name": "Observatory",
    "live.experience.preset.breath.name": "Breath",
    "live.experience.preset.gallery.name": "Gallery",
    "live.experience.preset.summit.name": "Summit",
    "live.experience.preset.grove.name": "Grove",
    "live.experience.preset.commons.name": "Commons",
    "live.experience.preset.midnight.name": "Midnight",
    "live.experience.preset.observatory.description":
      "Índigo profundo para descubrir, investigar y plantear grandes preguntas.",
    "live.experience.preset.breath.description":
      "Salvia y lino suaves para reflexionar sobre el bienestar.",
    "live.experience.preset.gallery.description":
      "Papel cálido y ciruela para la creatividad, el arte y la cultura.",
    "live.experience.preset.summit.description":
      "Pizarra oscura y hielo para la estrategia y el liderazgo.",
    "live.experience.preset.grove.description":
      "Verde natural y arena para la sostenibilidad y el futuro compartido.",
    "live.experience.preset.commons.description":
      "Terracota y crema para conversaciones en comunidad.",
    "live.experience.preset.midnight.description":
      "Carbón y lavanda para sesiones nocturnas y conversaciones tranquilas.",
    "live.experience.paletteLight": "Claro",
    "live.experience.paletteDark": "Oscuro",
    "live.experience.selected": "Seleccionado",
    "live.experience.recommended": "Recomendado",
    "live.experience.previewQuestion": "¿Qué exploraremos juntos?",
    "live.experience.previewChoiceA": "Una idea nueva",
    "live.experience.previewChoiceB": "Otra perspectiva",
    "live.experience.previewHelp": "Ejemplo de pregunta y respuestas con el aspecto elegido.",
    "live.experience.usingPublished": "Aspecto publicado: {name}.",
    "live.experience.launchOverride": "Esta sala usa otro aspecto. Aspecto publicado: {name}.",
    "live.experience.resetPublished": "Usar el aspecto publicado",
    "live.experience.galleryHelp":
      "Elige un aspecto para cualquier tema. Cada tarjeta muestra su paleta real.",
    "live.experience.categoryHelp":
      "Solo clasifica el tema. Cambiar la categoría actualiza la recomendación y conserva el aspecto elegido.",
  },
  "it-IT": {
    "live.experience.category.science": "Scienza",
    "live.experience.category.health_wellbeing": "Salute e benessere",
    "live.experience.category.arts_culture": "Arte e cultura",
    "live.experience.category.leadership": "Leadership",
    "live.experience.category.sustainability": "Sostenibilità",
    "live.experience.category.community": "Comunità",
    "live.experience.preset.observatory.name": "Observatory",
    "live.experience.preset.breath.name": "Breath",
    "live.experience.preset.gallery.name": "Gallery",
    "live.experience.preset.summit.name": "Summit",
    "live.experience.preset.grove.name": "Grove",
    "live.experience.preset.commons.name": "Commons",
    "live.experience.preset.midnight.name": "Midnight",
    "live.experience.preset.observatory.description":
      "Indaco profondo per scoperte, prove e grandi domande.",
    "live.experience.preset.breath.description":
      "Salvia e lino delicati per riflettere sul benessere.",
    "live.experience.preset.gallery.description":
      "Carta calda e prugna per creatività, arte e cultura.",
    "live.experience.preset.summit.description":
      "Ardesia scura e ghiaccio per strategia e leadership.",
    "live.experience.preset.grove.description":
      "Verde naturale e sabbia per sostenibilità e futuro condiviso.",
    "live.experience.preset.commons.description":
      "Terracotta e crema per le conversazioni della comunità.",
    "live.experience.preset.midnight.description":
      "Antracite e lavanda per sessioni serali e conversazioni concentrate.",
    "live.experience.paletteLight": "Chiaro",
    "live.experience.paletteDark": "Scuro",
    "live.experience.selected": "Selezionato",
    "live.experience.recommended": "Consigliato",
    "live.experience.previewQuestion": "Cosa esploreremo insieme?",
    "live.experience.previewChoiceA": "Una nuova idea",
    "live.experience.previewChoiceB": "Un’altra prospettiva",
    "live.experience.previewHelp": "Domanda e risposte di esempio con l’aspetto selezionato.",
    "live.experience.usingPublished": "Aspetto pubblicato: {name}.",
    "live.experience.launchOverride":
      "Questa stanza usa un altro aspetto. Aspetto pubblicato: {name}.",
    "live.experience.resetPublished": "Usa l’aspetto pubblicato",
    "live.experience.galleryHelp":
      "Scegli un aspetto per qualsiasi tema. Ogni scheda mostra la sua tavolozza reale.",
    "live.experience.categoryHelp":
      "Scegli il tema. Cambiare categoria aggiorna il consiglio e mantiene l’aspetto scelto.",
  },
  "pt-PT": {
    "live.experience.category.science": "Ciência",
    "live.experience.category.health_wellbeing": "Saúde e bem-estar",
    "live.experience.category.arts_culture": "Artes e cultura",
    "live.experience.category.leadership": "Liderança",
    "live.experience.category.sustainability": "Sustentabilidade",
    "live.experience.category.community": "Comunidade",
    "live.experience.preset.observatory.name": "Observatory",
    "live.experience.preset.breath.name": "Breath",
    "live.experience.preset.gallery.name": "Gallery",
    "live.experience.preset.summit.name": "Summit",
    "live.experience.preset.grove.name": "Grove",
    "live.experience.preset.commons.name": "Commons",
    "live.experience.preset.midnight.name": "Midnight",
    "live.experience.preset.observatory.description":
      "Índigo profundo para descobertas, provas e grandes questões.",
    "live.experience.preset.breath.description":
      "Salva e linho suaves para refletir sobre o bem-estar.",
    "live.experience.preset.gallery.description":
      "Papel quente e ameixa para criatividade, artes e cultura.",
    "live.experience.preset.summit.description":
      "Ardósia escura e gelo para estratégia e liderança.",
    "live.experience.preset.grove.description":
      "Verde natural e areia para sustentabilidade e futuro partilhado.",
    "live.experience.preset.commons.description": "Terracota e creme para conversas na comunidade.",
    "live.experience.preset.midnight.description":
      "Carvão e lavanda para sessões à noite e conversas focadas.",
    "live.experience.paletteLight": "Claro",
    "live.experience.paletteDark": "Escuro",
    "live.experience.selected": "Selecionado",
    "live.experience.recommended": "Recomendado",
    "live.experience.previewQuestion": "O que vamos explorar juntos?",
    "live.experience.previewChoiceA": "Uma nova ideia",
    "live.experience.previewChoiceB": "Outra perspetiva",
    "live.experience.previewHelp": "Exemplo de pergunta e respostas com o aspeto escolhido.",
    "live.experience.usingPublished": "Aspeto publicado: {name}.",
    "live.experience.launchOverride": "Esta sala usa outro aspeto. Aspeto publicado: {name}.",
    "live.experience.resetPublished": "Usar o aspeto publicado",
    "live.experience.galleryHelp":
      "Escolha um aspeto para qualquer tema. Cada cartão mostra a sua paleta real.",
    "live.experience.categoryHelp":
      "Apenas classifica o tema. Alterar a categoria atualiza a recomendação e mantém o aspeto escolhido.",
  },
  "ja-JP": {
    "live.experience.category.science": "科学",
    "live.experience.category.health_wellbeing": "健康とウェルビーイング",
    "live.experience.category.arts_culture": "芸術と文化",
    "live.experience.category.leadership": "リーダーシップ",
    "live.experience.category.sustainability": "サステナビリティ",
    "live.experience.category.community": "コミュニティ",
    "live.experience.preset.observatory.name": "Observatory",
    "live.experience.preset.breath.name": "Breath",
    "live.experience.preset.gallery.name": "Gallery",
    "live.experience.preset.summit.name": "Summit",
    "live.experience.preset.grove.name": "Grove",
    "live.experience.preset.commons.name": "Commons",
    "live.experience.preset.midnight.name": "Midnight",
    "live.experience.preset.observatory.description": "発見、根拠、大きな問いに向き合う深い藍色。",
    "live.experience.preset.breath.description": "健康や心を振り返る、柔らかなセージとリネン。",
    "live.experience.preset.gallery.description": "創作、芸術、文化に合う温かな紙色とプラム。",
    "live.experience.preset.summit.description": "戦略とリーダーシップを支える暗い石板色と氷色。",
    "live.experience.preset.grove.description": "持続可能な未来を考える自然な緑と砂色。",
    "live.experience.preset.commons.description": "地域や仲間との対話を包むテラコッタとクリーム。",
    "live.experience.preset.midnight.description":
      "夜のセッションや集中した対話に合う炭色とラベンダー。",
    "live.experience.paletteLight": "ライト",
    "live.experience.paletteDark": "ダーク",
    "live.experience.selected": "選択中",
    "live.experience.recommended": "おすすめ",
    "live.experience.previewQuestion": "一緒に何を探究しましょうか？",
    "live.experience.previewChoiceA": "新しいアイデア",
    "live.experience.previewChoiceB": "別の視点",
    "live.experience.previewHelp": "選択した見た目で表示した質問と回答の例です。",
    "live.experience.usingPublished": "公開済みの見た目を使用：{name}。",
    "live.experience.launchOverride": "このルームでは別の見た目を使用します。公開済み：{name}。",
    "live.experience.resetPublished": "公開済みの見た目を使う",
    "live.experience.galleryHelp":
      "どのトピックにも好きな見た目を選べます。各カードで実際の配色を確認できます。",
    "live.experience.categoryHelp":
      "トピックの分類です。カテゴリを変えるとおすすめが更新され、選択した見た目は維持されます。",
  },
  "ko-KR": {
    "live.experience.category.science": "과학",
    "live.experience.category.health_wellbeing": "건강과 웰빙",
    "live.experience.category.arts_culture": "예술과 문화",
    "live.experience.category.leadership": "리더십",
    "live.experience.category.sustainability": "지속가능성",
    "live.experience.category.community": "커뮤니티",
    "live.experience.preset.observatory.name": "Observatory",
    "live.experience.preset.breath.name": "Breath",
    "live.experience.preset.gallery.name": "Gallery",
    "live.experience.preset.summit.name": "Summit",
    "live.experience.preset.grove.name": "Grove",
    "live.experience.preset.commons.name": "Commons",
    "live.experience.preset.midnight.name": "Midnight",
    "live.experience.preset.observatory.description":
      "발견과 근거, 큰 질문을 위한 깊은 남색입니다.",
    "live.experience.preset.breath.description":
      "웰빙을 돌아보는 대화를 위한 부드러운 세이지와 리넨입니다.",
    "live.experience.preset.gallery.description":
      "창작과 예술, 문화를 위한 따뜻한 종이색과 자두색입니다.",
    "live.experience.preset.summit.description":
      "전략과 리더십, 명확한 결정을 위한 짙은 슬레이트와 얼음색입니다.",
    "live.experience.preset.grove.description":
      "지속가능성과 함께할 미래를 위한 자연스러운 녹색과 모래색입니다.",
    "live.experience.preset.commons.description": "커뮤니티 대화를 반기는 테라코타와 크림색입니다.",
    "live.experience.preset.midnight.description":
      "저녁 세션과 집중한 대화를 위한 차분한 차콜과 라벤더입니다.",
    "live.experience.paletteLight": "라이트",
    "live.experience.paletteDark": "다크",
    "live.experience.selected": "선택됨",
    "live.experience.recommended": "추천",
    "live.experience.previewQuestion": "함께 무엇을 탐구할까요?",
    "live.experience.previewChoiceA": "새로운 아이디어",
    "live.experience.previewChoiceB": "다른 관점",
    "live.experience.previewHelp": "선택한 디자인을 적용한 질문과 답변 예시입니다.",
    "live.experience.usingPublished": "게시된 디자인 사용: {name}.",
    "live.experience.launchOverride": "이 룸은 다른 디자인을 사용합니다. 게시된 디자인: {name}.",
    "live.experience.resetPublished": "게시된 디자인 사용",
    "live.experience.galleryHelp":
      "어떤 주제에도 원하는 디자인을 선택하세요. 카드에서 실제 색상을 미리 볼 수 있습니다.",
    "live.experience.categoryHelp":
      "주제를 분류하는 정보입니다. 카테고리를 바꾸면 추천이 갱신되며 선택한 디자인은 유지됩니다.",
  },
  "zh-CN": {
    "live.experience.category.science": "科学",
    "live.experience.category.health_wellbeing": "健康与身心福祉",
    "live.experience.category.arts_culture": "艺术与文化",
    "live.experience.category.leadership": "领导力",
    "live.experience.category.sustainability": "可持续发展",
    "live.experience.category.community": "社区",
    "live.experience.preset.observatory.name": "Observatory",
    "live.experience.preset.breath.name": "Breath",
    "live.experience.preset.gallery.name": "Gallery",
    "live.experience.preset.summit.name": "Summit",
    "live.experience.preset.grove.name": "Grove",
    "live.experience.preset.commons.name": "Commons",
    "live.experience.preset.midnight.name": "Midnight",
    "live.experience.preset.observatory.description": "深靛蓝色，适合探索发现、证据与重要问题。",
    "live.experience.preset.breath.description": "柔和鼠尾草绿与亚麻色，适合身心健康讨论。",
    "live.experience.preset.gallery.description": "温暖纸色与梅紫色，适合创作、艺术和文化。",
    "live.experience.preset.summit.description": "深石板色与冰蓝色，适合战略、领导力和明确决策。",
    "live.experience.preset.grove.description": "自然绿与沙色，适合可持续发展与共同未来。",
    "live.experience.preset.commons.description": "亲切的陶土色与奶油色，适合社区对话。",
    "live.experience.preset.midnight.description": "宁静炭灰与薰衣草紫，适合晚间活动与专注交流。",
    "live.experience.paletteLight": "浅色",
    "live.experience.paletteDark": "深色",
    "live.experience.selected": "已选择",
    "live.experience.recommended": "推荐",
    "live.experience.previewQuestion": "我们一起探索什么？",
    "live.experience.previewChoiceA": "一个新想法",
    "live.experience.previewChoiceB": "不同的视角",
    "live.experience.previewHelp": "使用所选设计的问题和答案示例。",
    "live.experience.usingPublished": "使用已发布的设计：{name}。",
    "live.experience.launchOverride": "此房间使用其他设计。已发布的设计：{name}。",
    "live.experience.resetPublished": "使用已发布的设计",
    "live.experience.galleryHelp": "任何主题都可选择喜欢的设计。每张卡片展示实际配色。",
    "live.experience.categoryHelp": "仅用于主题分类。更改类别会更新推荐，保留已选设计。",
  },
  "zh-TW": {
    "live.experience.category.science": "科學",
    "live.experience.category.health_wellbeing": "健康與身心福祉",
    "live.experience.category.arts_culture": "藝術與文化",
    "live.experience.category.leadership": "領導力",
    "live.experience.category.sustainability": "永續發展",
    "live.experience.category.community": "社群",
    "live.experience.preset.observatory.name": "Observatory",
    "live.experience.preset.breath.name": "Breath",
    "live.experience.preset.gallery.name": "Gallery",
    "live.experience.preset.summit.name": "Summit",
    "live.experience.preset.grove.name": "Grove",
    "live.experience.preset.commons.name": "Commons",
    "live.experience.preset.midnight.name": "Midnight",
    "live.experience.preset.observatory.description": "深靛藍色，適合探索發現、證據與重要問題。",
    "live.experience.preset.breath.description": "柔和鼠尾草綠與亞麻色，適合身心健康討論。",
    "live.experience.preset.gallery.description": "溫暖紙色與梅紫色，適合創作、藝術和文化。",
    "live.experience.preset.summit.description": "深石板色與冰藍色，適合策略、領導力和明確決策。",
    "live.experience.preset.grove.description": "自然綠與沙色，適合永續發展與共同未來。",
    "live.experience.preset.commons.description": "親切的陶土色與奶油色，適合社群對話。",
    "live.experience.preset.midnight.description": "寧靜炭灰與薰衣草紫，適合晚間活動與專注交流。",
    "live.experience.paletteLight": "淺色",
    "live.experience.paletteDark": "深色",
    "live.experience.selected": "已選取",
    "live.experience.recommended": "推薦",
    "live.experience.previewQuestion": "我們一起探索什麼？",
    "live.experience.previewChoiceA": "一個新想法",
    "live.experience.previewChoiceB": "不同的觀點",
    "live.experience.previewHelp": "使用所選設計的問題與答案範例。",
    "live.experience.usingPublished": "使用已發布的設計：{name}。",
    "live.experience.launchOverride": "此房間使用其他設計。已發布的設計：{name}。",
    "live.experience.resetPublished": "使用已發布的設計",
    "live.experience.galleryHelp": "任何主題都可選擇喜歡的設計。每張卡片展示實際配色。",
    "live.experience.categoryHelp": "僅用於主題分類。變更類別會更新推薦，保留已選設計。",
  },
};

export function experienceCatalogMessages(locale: SupportedLocale): ExperienceCatalogMessages {
  return translations[locale];
}
