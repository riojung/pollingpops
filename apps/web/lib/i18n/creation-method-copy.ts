import type { SupportedLocale } from "@openround/contracts";

export const creationMethodKeys = [
  "roundBlank",
  "roundTemplate",
  "roundSource",
  "roundImport",
  "presentationBlank",
  "presentationTemplate",
  "presentationDesign",
  "presentationSource",
  "presentationOutline",
  "surveyBlank",
  "surveyTemplate",
] as const;
export type CreationMethodKey = (typeof creationMethodKeys)[number];
export type CreationMethod = CreationMethodKey;

export interface CreationMethodExplanation {
  input: string;
  assistance: string;
  nextStep: string;
  note?: string;
}

export interface CreationMethodCopy {
  allMethods: string;
  invalidSelection: string;
  incompatiblePoll: string;
  switchToRound: string;
  labels: { input: string; assistance: string; nextStep: string };
  survey: {
    title: string;
    eyebrow: string;
    description: string;
    privacy: string;
    blankTitle: string;
    blankDescription: string;
    createBlank: string;
    creating: string;
    templateTitle: string;
    templateDescription: string;
    unavailable: string;
    viewExisting: string;
    allTypes: string;
  };
  methods: Record<CreationMethodKey, CreationMethodExplanation>;
}

interface TranslationRow {
  navigation: readonly [string, string, string, string];
  labels: readonly [string, string, string];
  survey: readonly [
    string,
    string,
    string,
    string,
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
  assistance: readonly [none: string, source: string, outline: string];
  methods: Record<CreationMethodKey, readonly [input: string, nextStep: string]>;
  visualImport: string;
}

// Display-only explanations. These strings never replace existing authored content,
// change feature availability, or imply native-language review acceptance.
const rows = {
  "en-CA": {
    navigation: [
      "All creation methods",
      "That creation method is unavailable. Choose one below.",
      "Source assistance and structured import create Rounds with their original question types. Choose a Round to use this method.",
      "Continue with a Round",
    ],
    labels: ["Input", "Assistance", "Next step"],
    survey: [
      "Create a Survey",
      "Asynchronous feedback",
      "Collect opinions with choice polls and rating questions. Surveys support these two question types.",
      "Organizers cannot see who submitted which answers or link answers across questions. Results appear only after closing and with at least 5 responses per question. One-response limits apply per access credential, not per verified person.",
      "Blank Survey",
      "Write your own choice polls and rating questions.",
      "Create blank Survey",
      "Creating Survey…",
      "Survey templates",
      "Review a template, then choose Use to create your own editable copy.",
      "Surveys are unavailable in this workspace.",
      "View existing Surveys",
      "All types",
    ],
    assistance: [
      "No AI is used.",
      "AI proposes content after source scanning, using the allowance shown. Check source references and accuracy.",
      "Creating the draft uses no AI. In the editor, optional AI proposes 3–8 editable text slides using the allowance shown.",
    ],
    methods: {
      roundBlank: [
        "A title; add your own questions in the editor.",
        "Create opens a private editable Round draft.",
      ],
      roundTemplate: [
        "An existing Round template.",
        "Review it, then choose Use to create an independent editable draft.",
      ],
      roundSource: [
        "Pasted text, or a PDF, DOCX or PPTX file up to 6 MB.",
        "Review the proposals, then explicitly create a private Round draft.",
      ],
      roundImport: [
        "Polling Pops JSON, CSV or bulk text up to 2 MB; QTI 3 ZIP up to 6 MB. Requires Pro.",
        "Validate and create checks the data and creates a private Round draft in the same action. Review import warnings and the draft.",
      ],
      presentationBlank: [
        "Start empty; add a title and your own slides in the editor.",
        "Create opens a private editable Presentation draft.",
      ],
      presentationTemplate: [
        "An existing Presentation template.",
        "Review it, then choose Use to create an independent editable draft.",
      ],
      presentationDesign: [
        "A visual design with sample content.",
        "Choose Use to create an independent editable draft; replace the sample content.",
      ],
      presentationSource: [
        "Pasted text, or a PDF, DOCX or PPTX file up to 6 MB. Original slide layouts are not preserved.",
        "Review and select proposals, then explicitly create a private Presentation draft.",
      ],
      presentationOutline: [
        "A title now; your outline in the editor after the draft opens.",
        "Create and open a saved private draft first. Then generate, review, select and insert proposed slides in the editor.",
      ],
      surveyBlank: [
        "Start empty; add a title, choice polls and rating questions in the editor.",
        "Create opens a private editable Survey draft.",
      ],
      surveyTemplate: [
        "An existing Survey template with choice polls and ratings.",
        "Review it, then choose Use to create an independent editable Survey draft.",
      ],
    },
    visualImport:
      "To import visuals, first open a saved Presentation in the editor. Its PDF / images tool accepts PDF up to 6 MB or PNG/JPEG/WebP up to 10 MiB each, 20 MB per set, and 40 pages/images. It creates flattened slide visuals with an editable reading version. Review reading order and losses such as animation, links and individual object editing before insertion.",
  },
  "fr-FR": {
    navigation: [
      "Toutes les méthodes de création",
      "Cette méthode est indisponible. Choisissez-en une ci-dessous.",
      "L’assistance à partir de sources et l’import structuré créent des Rounds avec leurs types de questions d’origine. Choisissez un Round pour utiliser cette méthode.",
      "Continuer avec un Round",
    ],
    labels: ["Données initiales", "Assistance", "Étape suivante"],
    survey: [
      "Créer une Enquête",
      "Avis en différé",
      "Recueillez des avis avec des questions à choix et des échelles d’évaluation. Les Enquêtes prennent en charge ces deux types de questions.",
      "Les organisateurs ne peuvent pas voir qui a donné quelles réponses ni relier les réponses entre questions. Les résultats s’affichent uniquement après la clôture, avec au moins 5 réponses par question. La limite d’une réponse s’applique par identifiant d’accès, pas par personne vérifiée.",
      "Enquête vierge",
      "Rédigez vos questions à choix et vos échelles d’évaluation.",
      "Créer une Enquête vierge",
      "Création de l’Enquête…",
      "Modèles d’Enquête",
      "Examinez un modèle, puis choisissez Utiliser pour créer votre copie modifiable.",
      "Les Enquêtes sont indisponibles dans cet espace.",
      "Voir les Enquêtes existantes",
      "Tous les types",
    ],
    assistance: [
      "Aucune IA n’est utilisée.",
      "L’IA propose du contenu après l’analyse de sécurité de la source, selon le quota affiché. Vérifiez les références et l’exactitude.",
      "Créer le brouillon n’utilise pas d’IA. Dans l’éditeur, l’IA facultative propose 3 à 8 diapositives de texte modifiables selon le quota affiché.",
    ],
    methods: {
      roundBlank: [
        "Un titre ; ajoutez vos questions dans l’éditeur.",
        "Créer ouvre un brouillon de Round privé et modifiable.",
      ],
      roundTemplate: [
        "Un modèle de Round existant.",
        "Examinez-le, puis choisissez Utiliser pour créer un brouillon indépendant et modifiable.",
      ],
      roundSource: [
        "Texte collé ou fichier PDF, DOCX ou PPTX de 6 MB maximum.",
        "Examinez les propositions, puis créez explicitement un brouillon de Round privé.",
      ],
      roundImport: [
        "JSON Polling Pops, CSV ou texte en bloc de 2 MB maximum ; ZIP QTI 3 de 6 MB maximum. Offre Pro requise.",
        "Valider et créer vérifie les données et crée un brouillon de Round privé en une seule action. Vérifiez les avertissements d’import et le brouillon.",
      ],
      presentationBlank: [
        "Commencez à vide ; ajoutez un titre et vos diapositives dans l’éditeur.",
        "Créer ouvre un brouillon de Présentation privé et modifiable.",
      ],
      presentationTemplate: [
        "Un modèle de Présentation existant.",
        "Examinez-le, puis choisissez Utiliser pour créer un brouillon indépendant et modifiable.",
      ],
      presentationDesign: [
        "Une conception visuelle avec du contenu d’exemple.",
        "Choisissez Utiliser pour créer un brouillon indépendant et modifiable ; remplacez le contenu d’exemple.",
      ],
      presentationSource: [
        "Texte collé ou fichier PDF, DOCX ou PPTX de 6 MB maximum. La mise en page d’origine n’est pas conservée.",
        "Examinez et sélectionnez les propositions, puis créez explicitement un brouillon de Présentation privé.",
      ],
      presentationOutline: [
        "Un titre maintenant ; votre plan dans l’éditeur une fois le brouillon ouvert.",
        "Créez et ouvrez d’abord un brouillon privé enregistré. Générez, vérifiez, sélectionnez et insérez ensuite les diapositives proposées dans l’éditeur.",
      ],
      surveyBlank: [
        "Commencez à vide ; ajoutez un titre, des questions à choix et des évaluations dans l’éditeur.",
        "Créer ouvre un brouillon d’Enquête privé et modifiable.",
      ],
      surveyTemplate: [
        "Un modèle d’Enquête avec questions à choix et évaluations.",
        "Examinez-le, puis choisissez Utiliser pour créer un brouillon d’Enquête indépendant et modifiable.",
      ],
    },
    visualImport:
      "Pour importer des visuels, ouvrez d’abord une Présentation enregistrée dans l’éditeur. L’outil PDF / images accepte les PDF de 6 MB maximum ou les PNG/JPEG/WebP de 10 MiB chacun, 20 MB par lot et 40 pages/images. Il crée des visuels aplatis avec une version de lecture modifiable. Avant insertion, vérifiez l’ordre de lecture et les pertes, notamment animations, liens et modification des objets séparés.",
  },
  "de-DE": {
    navigation: [
      "Alle Erstellungsmethoden",
      "Diese Methode ist nicht verfügbar. Wählen Sie unten eine andere.",
      "Quellenunterstützung und strukturierter Import erstellen Rounds mit den ursprünglichen Fragetypen. Wählen Sie dafür eine Round.",
      "Mit einer Round fortfahren",
    ],
    labels: ["Eingabe", "Unterstützung", "Nächster Schritt"],
    survey: [
      "Umfrage erstellen",
      "Zeitversetztes Feedback",
      "Sammeln Sie Meinungen mit Auswahl- und Bewertungsfragen. Umfragen unterstützen diese beiden Fragetypen.",
      "Organisatoren können weder sehen, wer welche Antworten abgegeben hat, noch Antworten über Fragen hinweg verknüpfen. Ergebnisse erscheinen erst nach dem Schließen und ab 5 Antworten pro Frage. Die Beschränkung auf eine Antwort gilt je Zugangsnachweis, nicht je verifizierter Person.",
      "Leere Umfrage",
      "Schreiben Sie eigene Auswahl- und Bewertungsfragen.",
      "Leere Umfrage erstellen",
      "Umfrage wird erstellt…",
      "Umfragevorlagen",
      "Prüfen Sie eine Vorlage und wählen Sie Verwenden, um eine eigene bearbeitbare Kopie zu erstellen.",
      "Umfragen sind in diesem Arbeitsbereich nicht verfügbar.",
      "Vorhandene Umfragen ansehen",
      "Alle Typen",
    ],
    assistance: [
      "Es wird keine KI verwendet.",
      "Nach der Sicherheitsprüfung der Quelle schlägt KI Inhalte vor und nutzt das angezeigte Kontingent. Prüfen Sie Quellenverweise und Richtigkeit.",
      "Die Entwurfserstellung verwendet keine KI. Im Editor schlägt optionale KI 3–8 bearbeitbare Textfolien vor und nutzt das angezeigte Kontingent.",
    ],
    methods: {
      roundBlank: [
        "Ein Titel; eigene Fragen ergänzen Sie im Editor.",
        "Erstellen öffnet einen privaten, bearbeitbaren Round-Entwurf.",
      ],
      roundTemplate: [
        "Eine vorhandene Round-Vorlage.",
        "Prüfen Sie sie und wählen Sie Verwenden, um einen unabhängigen, bearbeitbaren Entwurf zu erstellen.",
      ],
      roundSource: [
        "Eingefügter Text oder eine PDF-, DOCX- oder PPTX-Datei bis 6 MB.",
        "Prüfen Sie die Vorschläge und erstellen Sie anschließend ausdrücklich einen privaten Round-Entwurf.",
      ],
      roundImport: [
        "Polling Pops JSON, CSV oder Sammeltext bis 2 MB; QTI-3-ZIP bis 6 MB. Erfordert Pro.",
        "Prüfen und erstellen prüft die Daten und erstellt im selben Schritt einen privaten Round-Entwurf. Prüfen Sie Importwarnungen und den Entwurf.",
      ],
      presentationBlank: [
        "Beginnen Sie leer; Titel und eigene Folien ergänzen Sie im Editor.",
        "Erstellen öffnet einen privaten, bearbeitbaren Präsentationsentwurf.",
      ],
      presentationTemplate: [
        "Eine vorhandene Präsentationsvorlage.",
        "Prüfen Sie sie und wählen Sie Verwenden, um einen unabhängigen, bearbeitbaren Entwurf zu erstellen.",
      ],
      presentationDesign: [
        "Eine visuelle Gestaltung mit Beispielinhalten.",
        "Wählen Sie Verwenden, um einen unabhängigen, bearbeitbaren Entwurf zu erstellen; ersetzen Sie die Beispielinhalte.",
      ],
      presentationSource: [
        "Eingefügter Text oder PDF, DOCX oder PPTX bis 6 MB. Ursprüngliche Folienlayouts bleiben nicht erhalten.",
        "Prüfen und wählen Sie Vorschläge aus und erstellen Sie dann ausdrücklich einen privaten Präsentationsentwurf.",
      ],
      presentationOutline: [
        "Jetzt ein Titel; die Gliederung folgt nach dem Öffnen im Editor.",
        "Erstellen und öffnen Sie zuerst einen gespeicherten privaten Entwurf. Generieren, prüfen, wählen und übernehmen Sie danach Folienvorschläge im Editor.",
      ],
      surveyBlank: [
        "Beginnen Sie leer; Titel, Auswahl- und Bewertungsfragen ergänzen Sie im Editor.",
        "Erstellen öffnet einen privaten, bearbeitbaren Umfrageentwurf.",
      ],
      surveyTemplate: [
        "Eine vorhandene Umfragevorlage mit Auswahl- und Bewertungsfragen.",
        "Prüfen Sie sie und wählen Sie Verwenden, um einen unabhängigen, bearbeitbaren Umfrageentwurf zu erstellen.",
      ],
    },
    visualImport:
      "Öffnen Sie für visuelle Importe zuerst eine gespeicherte Präsentation im Editor. PDF / Bilder akzeptiert PDF bis 6 MB oder PNG/JPEG/WebP bis jeweils 10 MiB, insgesamt 20 MB und 40 Seiten/Bilder. Es entstehen flache Folienbilder mit bearbeitbarer Leseversion. Prüfen Sie vor dem Einfügen Lesereihenfolge und Verluste, etwa Animationen, Links und die Bearbeitung einzelner Objekte.",
  },
  "es-ES": {
    navigation: [
      "Todos los métodos de creación",
      "Este método no está disponible. Elige uno abajo.",
      "La asistencia con fuentes y la importación estructurada crean Rounds con sus tipos de pregunta originales. Elige un Round para usar este método.",
      "Continuar con un Round",
    ],
    labels: ["Entrada", "Asistencia", "Siguiente paso"],
    survey: [
      "Crear Encuesta",
      "Opiniones en diferido",
      "Recoge opiniones con preguntas de elección y valoración. Las Encuestas admiten estos dos tipos de pregunta.",
      "Los organizadores no pueden ver quién envió cada respuesta ni vincular respuestas entre preguntas. Los resultados aparecen solo tras cerrar y con al menos 5 respuestas por pregunta. El límite de una respuesta se aplica por credencial de acceso, no por persona verificada.",
      "Encuesta en blanco",
      "Escribe tus propias preguntas de elección y valoración.",
      "Crear Encuesta en blanco",
      "Creando Encuesta…",
      "Plantillas de Encuesta",
      "Revisa una plantilla y elige Usar para crear tu propia copia editable.",
      "Las Encuestas no están disponibles en este espacio.",
      "Ver Encuestas existentes",
      "Todos los tipos",
    ],
    assistance: [
      "No se usa IA.",
      "La IA propone contenido tras analizar la seguridad de la fuente y usa la cuota indicada. Comprueba las referencias y la exactitud.",
      "Crear el borrador no usa IA. En el editor, la IA opcional propone entre 3 y 8 diapositivas de texto editables con la cuota indicada.",
    ],
    methods: {
      roundBlank: [
        "Un título; añade tus preguntas en el editor.",
        "Crear abre un borrador de Round privado y editable.",
      ],
      roundTemplate: [
        "Una plantilla de Round existente.",
        "Revísala y elige Usar para crear un borrador independiente y editable.",
      ],
      roundSource: [
        "Texto pegado o un archivo PDF, DOCX o PPTX de hasta 6 MB.",
        "Revisa las propuestas y después crea explícitamente un borrador de Round privado.",
      ],
      roundImport: [
        "JSON de Polling Pops, CSV o texto en bloque de hasta 2 MB; ZIP QTI 3 de hasta 6 MB. Requiere Pro.",
        "Validar y crear comprueba los datos y crea un borrador de Round privado en la misma acción. Revisa los avisos de importación y el borrador.",
      ],
      presentationBlank: [
        "Empieza en blanco; añade un título y tus diapositivas en el editor.",
        "Crear abre un borrador de Presentación privado y editable.",
      ],
      presentationTemplate: [
        "Una plantilla de Presentación existente.",
        "Revísala y elige Usar para crear un borrador independiente y editable.",
      ],
      presentationDesign: [
        "Un diseño visual con contenido de ejemplo.",
        "Elige Usar para crear un borrador independiente y editable; sustituye el contenido de ejemplo.",
      ],
      presentationSource: [
        "Texto pegado o PDF, DOCX o PPTX de hasta 6 MB. No se conservan los diseños originales de las diapositivas.",
        "Revisa y selecciona propuestas y después crea explícitamente un borrador de Presentación privado.",
      ],
      presentationOutline: [
        "Un título ahora; tu esquema en el editor al abrirse el borrador.",
        "Primero crea y abre un borrador privado guardado. Después genera, revisa, selecciona e inserta las diapositivas propuestas en el editor.",
      ],
      surveyBlank: [
        "Empieza en blanco; añade un título y preguntas de elección y valoración en el editor.",
        "Crear abre un borrador de Encuesta privado y editable.",
      ],
      surveyTemplate: [
        "Una plantilla de Encuesta con preguntas de elección y valoración.",
        "Revísala y elige Usar para crear un borrador de Encuesta independiente y editable.",
      ],
    },
    visualImport:
      "Para importar elementos visuales, abre primero una Presentación guardada en el editor. PDF / imágenes admite PDF de hasta 6 MB o PNG/JPEG/WebP de hasta 10 MiB cada uno, 20 MB por conjunto y 40 páginas/imágenes. Crea imágenes de diapositiva aplanadas con una versión de lectura editable. Antes de insertar, revisa el orden de lectura y las pérdidas, como animaciones, enlaces y edición de objetos individuales.",
  },
  "it-IT": {
    navigation: [
      "Tutti i metodi di creazione",
      "Questo metodo non è disponibile. Scegline uno qui sotto.",
      "L’assistenza da fonti e l’importazione strutturata creano Round con i tipi di domanda originali. Scegli un Round per usare questo metodo.",
      "Continua con un Round",
    ],
    labels: ["Dati iniziali", "Assistenza", "Passo successivo"],
    survey: [
      "Crea un Sondaggio",
      "Opinioni in differita",
      "Raccogli opinioni con domande a scelta e di valutazione. I Sondaggi supportano questi due tipi di domanda.",
      "Gli organizzatori non possono vedere chi ha inviato le singole risposte né collegare risposte tra domande diverse. I risultati appaiono solo dopo la chiusura e con almeno 5 risposte per domanda. Il limite di una risposta si applica per credenziale di accesso, non per persona verificata.",
      "Sondaggio vuoto",
      "Scrivi le tue domande a scelta e di valutazione.",
      "Crea Sondaggio vuoto",
      "Creazione del Sondaggio…",
      "Modelli di Sondaggio",
      "Esamina un modello, poi scegli Usa per creare una tua copia modificabile.",
      "I Sondaggi non sono disponibili in questo spazio.",
      "Visualizza Sondaggi esistenti",
      "Tutti i tipi",
    ],
    assistance: [
      "Non viene usata l’IA.",
      "L’IA propone contenuti dopo l’analisi di sicurezza della fonte, usando la quota indicata. Verifica riferimenti e accuratezza.",
      "Creare la bozza non usa l’IA. Nell’editor, l’IA facoltativa propone 3–8 diapositive di testo modificabili usando la quota indicata.",
    ],
    methods: {
      roundBlank: [
        "Un titolo; aggiungi le tue domande nell’editor.",
        "Crea apre una bozza di Round privata e modificabile.",
      ],
      roundTemplate: [
        "Un modello di Round esistente.",
        "Esaminalo, poi scegli Usa per creare una bozza indipendente e modificabile.",
      ],
      roundSource: [
        "Testo incollato o un file PDF, DOCX o PPTX fino a 6 MB.",
        "Esamina le proposte, poi crea esplicitamente una bozza di Round privata.",
      ],
      roundImport: [
        "JSON Polling Pops, CSV o testo in blocco fino a 2 MB; ZIP QTI 3 fino a 6 MB. Richiede Pro.",
        "Convalida e crea controlla i dati e crea una bozza di Round privata con la stessa azione. Esamina gli avvisi di importazione e la bozza.",
      ],
      presentationBlank: [
        "Inizia da vuoto; aggiungi un titolo e le tue diapositive nell’editor.",
        "Crea apre una bozza di Presentazione privata e modificabile.",
      ],
      presentationTemplate: [
        "Un modello di Presentazione esistente.",
        "Esaminalo, poi scegli Usa per creare una bozza indipendente e modificabile.",
      ],
      presentationDesign: [
        "Un design visivo con contenuti di esempio.",
        "Scegli Usa per creare una bozza indipendente e modificabile; sostituisci i contenuti di esempio.",
      ],
      presentationSource: [
        "Testo incollato o PDF, DOCX o PPTX fino a 6 MB. I layout originali delle diapositive non vengono conservati.",
        "Esamina e seleziona le proposte, poi crea esplicitamente una bozza di Presentazione privata.",
      ],
      presentationOutline: [
        "Un titolo ora; la tua scaletta nell’editor dopo l’apertura della bozza.",
        "Prima crea e apri una bozza privata salvata. Poi genera, esamina, seleziona e inserisci le diapositive proposte nell’editor.",
      ],
      surveyBlank: [
        "Inizia da vuoto; aggiungi un titolo e domande a scelta e di valutazione nell’editor.",
        "Crea apre una bozza di Sondaggio privata e modificabile.",
      ],
      surveyTemplate: [
        "Un modello di Sondaggio con domande a scelta e valutazioni.",
        "Esaminalo, poi scegli Usa per creare una bozza di Sondaggio indipendente e modificabile.",
      ],
    },
    visualImport:
      "Per importare elementi visivi, apri prima una Presentazione salvata nell’editor. PDF / immagini accetta PDF fino a 6 MB oppure PNG/JPEG/WebP fino a 10 MiB ciascuno, 20 MB per gruppo e 40 pagine/immagini. Crea immagini di diapositive appiattite con una versione di lettura modificabile. Prima di inserire, verifica l’ordine di lettura e le perdite, come animazioni, link e modifica dei singoli oggetti.",
  },
  "pt-PT": {
    navigation: [
      "Todos os métodos de criação",
      "Este método não está disponível. Escolha um abaixo.",
      "A assistência com fontes e a importação estruturada criam Rounds com os tipos de pergunta originais. Escolha um Round para utilizar este método.",
      "Continuar com um Round",
    ],
    labels: ["Dados iniciais", "Assistência", "Passo seguinte"],
    survey: [
      "Criar Inquérito",
      "Opiniões em diferido",
      "Recolha opiniões com perguntas de escolha e de avaliação. Os Inquéritos suportam estes dois tipos de pergunta.",
      "Os organizadores não podem ver quem enviou cada resposta nem ligar respostas entre perguntas. Os resultados só aparecem após o fecho e com pelo menos 5 respostas por pergunta. O limite de uma resposta aplica-se por credencial de acesso, não por pessoa verificada.",
      "Inquérito em branco",
      "Escreva as suas perguntas de escolha e de avaliação.",
      "Criar Inquérito em branco",
      "A criar Inquérito…",
      "Modelos de Inquérito",
      "Reveja um modelo e escolha Utilizar para criar a sua cópia editável.",
      "Os Inquéritos não estão disponíveis neste espaço.",
      "Ver Inquéritos existentes",
      "Todos os tipos",
    ],
    assistance: [
      "Não é utilizada IA.",
      "A IA propõe conteúdo após a análise de segurança da fonte, usando a quota apresentada. Verifique as referências e a exatidão.",
      "Criar o rascunho não utiliza IA. No editor, a IA opcional propõe 3–8 diapositivos de texto editáveis usando a quota apresentada.",
    ],
    methods: {
      roundBlank: [
        "Um título; adicione as suas perguntas no editor.",
        "Criar abre um rascunho de Round privado e editável.",
      ],
      roundTemplate: [
        "Um modelo de Round existente.",
        "Reveja-o e escolha Utilizar para criar um rascunho independente e editável.",
      ],
      roundSource: [
        "Texto colado ou um ficheiro PDF, DOCX ou PPTX até 6 MB.",
        "Reveja as propostas e crie explicitamente um rascunho de Round privado.",
      ],
      roundImport: [
        "JSON Polling Pops, CSV ou texto em bloco até 2 MB; ZIP QTI 3 até 6 MB. Requer Pro.",
        "Validar e criar verifica os dados e cria um rascunho de Round privado na mesma ação. Reveja os avisos de importação e o rascunho.",
      ],
      presentationBlank: [
        "Comece em branco; adicione um título e os seus diapositivos no editor.",
        "Criar abre um rascunho de Apresentação privado e editável.",
      ],
      presentationTemplate: [
        "Um modelo de Apresentação existente.",
        "Reveja-o e escolha Utilizar para criar um rascunho independente e editável.",
      ],
      presentationDesign: [
        "Um design visual com conteúdo de exemplo.",
        "Escolha Utilizar para criar um rascunho independente e editável; substitua o conteúdo de exemplo.",
      ],
      presentationSource: [
        "Texto colado ou PDF, DOCX ou PPTX até 6 MB. Os esquemas originais dos diapositivos não são preservados.",
        "Reveja e selecione propostas e crie explicitamente um rascunho de Apresentação privado.",
      ],
      presentationOutline: [
        "Um título agora; o seu esquema no editor após abrir o rascunho.",
        "Primeiro crie e abra um rascunho privado guardado. Depois gere, reveja, selecione e insira os diapositivos propostos no editor.",
      ],
      surveyBlank: [
        "Comece em branco; adicione um título e perguntas de escolha e de avaliação no editor.",
        "Criar abre um rascunho de Inquérito privado e editável.",
      ],
      surveyTemplate: [
        "Um modelo de Inquérito com perguntas de escolha e avaliações.",
        "Reveja-o e escolha Utilizar para criar um rascunho de Inquérito independente e editável.",
      ],
    },
    visualImport:
      "Para importar elementos visuais, abra primeiro uma Apresentação guardada no editor. PDF / imagens aceita PDF até 6 MB ou PNG/JPEG/WebP até 10 MiB cada, 20 MB por conjunto e 40 páginas/imagens. Cria imagens de diapositivos achatadas com uma versão de leitura editável. Antes de inserir, reveja a ordem de leitura e as perdas, como animações, ligações e edição de objetos individuais.",
  },
  "ja-JP": {
    navigation: [
      "すべての作成方法",
      "この作成方法は利用できません。以下から選んでください。",
      "資料からの支援と構造化データのインポートでは、元の質問形式を持つRoundを作成します。この方法を使うにはRoundを選んでください。",
      "Roundで続ける",
    ],
    labels: ["入力", "支援", "次のステップ"],
    survey: [
      "アンケートを作成",
      "好きな時間にフィードバック",
      "選択式の意見投票と評価の質問で意見を集めます。アンケートはこの2種類の質問に対応しています。",
      "主催者は誰がどの回答を送信したかを確認できず、質問をまたいで回答を結び付けることもできません。結果は締め切り後、各質問に5件以上の回答がある場合にのみ表示されます。回答を1回に制限する仕組みはアクセス認証情報単位であり、本人確認済みの個人単位ではありません。",
      "空白のアンケート",
      "選択式の意見投票と評価の質問を自分で作成します。",
      "空白のアンケートを作成",
      "アンケートを作成中…",
      "アンケートのテンプレート",
      "テンプレートを確認し、「使用」を選ぶと自分用の編集可能なコピーを作成します。",
      "このワークスペースではアンケートを利用できません。",
      "既存のアンケートを表示",
      "すべての種類",
    ],
    assistance: [
      "AIは使用しません。",
      "資料の安全性スキャン後、表示された利用枠を使ってAIが内容を提案します。出典と正確さを確認してください。",
      "下書きの作成ではAIを使用しません。エディターでは、任意のAI支援により表示された利用枠で3～8枚の編集可能なテキストスライドを提案します。",
    ],
    methods: {
      roundBlank: [
        "タイトルを入力し、エディターで質問を追加します。",
        "作成すると、非公開で編集可能なRoundの下書きが開きます。",
      ],
      roundTemplate: [
        "既存のRoundテンプレート。",
        "内容を確認して「使用」を選ぶと、独立した編集可能な下書きを作成します。",
      ],
      roundSource: [
        "貼り付けたテキスト、または6 MB以下のPDF・DOCX・PPTXファイル。",
        "提案を確認してから、非公開のRoundの下書きの作成を明示的に選びます。",
      ],
      roundImport: [
        "2 MB以下のPolling Pops JSON・CSV・一括テキスト、または6 MB以下のQTI 3 ZIP。Proが必要です。",
        "「検証して作成」はデータを検証し、同じ操作で非公開のRoundの下書きを作成します。インポートの警告と下書きを確認してください。",
      ],
      presentationBlank: [
        "空白から始めて、エディターでタイトルとスライドを追加します。",
        "作成すると、非公開で編集可能なプレゼンテーションの下書きが開きます。",
      ],
      presentationTemplate: [
        "既存のプレゼンテーションテンプレート。",
        "内容を確認して「使用」を選ぶと、独立した編集可能な下書きを作成します。",
      ],
      presentationDesign: [
        "サンプル内容を含むビジュアルデザイン。",
        "「使用」を選ぶと独立した編集可能な下書きを作成します。サンプル内容を置き換えてください。",
      ],
      presentationSource: [
        "貼り付けたテキスト、または6 MB以下のPDF・DOCX・PPTX。元のスライドレイアウトは保持しません。",
        "提案を確認して選択し、非公開のプレゼンテーションの下書きの作成を明示的に選びます。",
      ],
      presentationOutline: [
        "まずタイトルを入力します。下書きが開いたらエディターでアウトラインを入力します。",
        "先に非公開の下書きを保存して開きます。その後、エディターでスライドを生成し、提案を確認・選択して挿入します。",
      ],
      surveyBlank: [
        "空白から始めて、エディターでタイトル、選択式の意見投票と評価の質問を追加します。",
        "作成すると、非公開で編集可能なアンケートの下書きが開きます。",
      ],
      surveyTemplate: [
        "選択式の意見投票と評価を含む既存のアンケートテンプレート。",
        "内容を確認して「使用」を選ぶと、独立した編集可能なアンケートの下書きを作成します。",
      ],
    },
    visualImport:
      "ビジュアルを取り込むには、保存済みのプレゼンテーションをエディターで開きます。「PDF・画像」は6 MB以下のPDF、または各10 MiB以下のPNG/JPEG/WebPに対応し、合計20 MB、40ページ／画像までです。統合されたスライド画像と編集可能な読み取り用テキストを作成します。挿入前に読み上げ順序と、アニメーション、リンク、個別オブジェクトの編集など失われる要素を確認してください。",
  },
  "ko-KR": {
    navigation: [
      "모든 생성 방법",
      "이 생성 방법은 사용할 수 없습니다. 아래에서 선택하세요.",
      "자료 기반 지원과 구조화된 가져오기는 원래 질문 유형을 사용하는 Round를 만듭니다. 이 방법을 사용하려면 Round를 선택하세요.",
      "Round로 계속",
    ],
    labels: ["입력", "지원", "다음 단계"],
    survey: [
      "설문 만들기",
      "각자의 시간에 의견 수집",
      "선택형 의견 투표와 평점 질문으로 의견을 모으세요. 설문은 이 두 가지 질문 유형을 지원합니다.",
      "주최자는 누가 어떤 답변을 제출했는지 확인하거나 질문 간 답변을 연결할 수 없습니다. 결과는 설문을 마감한 뒤 질문당 응답이 5개 이상일 때만 표시됩니다. 1회 응답 제한은 접근 자격 증명 단위이며, 신원이 확인된 사람 단위가 아닙니다.",
      "빈 설문",
      "선택형 의견 투표와 평점 질문을 직접 작성하세요.",
      "빈 설문 만들기",
      "설문 만드는 중…",
      "설문 템플릿",
      "템플릿을 검토한 뒤 사용을 선택하여 편집 가능한 나만의 사본을 만드세요.",
      "이 워크스페이스에서는 설문을 사용할 수 없습니다.",
      "기존 설문 보기",
      "모든 유형",
    ],
    assistance: [
      "AI를 사용하지 않습니다.",
      "자료 보안 검사 후 표시된 사용량 한도로 AI가 내용을 제안합니다. 출처와 정확성을 확인하세요.",
      "초안 생성에는 AI를 사용하지 않습니다. 편집기에서 선택적 AI가 표시된 사용량 한도로 편집 가능한 텍스트 슬라이드 3~8개를 제안합니다.",
    ],
    methods: {
      roundBlank: [
        "제목을 입력하고 편집기에서 직접 질문을 추가하세요.",
        "만들기를 선택하면 편집 가능한 비공개 Round 초안이 열립니다.",
      ],
      roundTemplate: [
        "기존 Round 템플릿.",
        "검토 후 사용을 선택하면 독립적으로 편집할 수 있는 초안이 생성됩니다.",
      ],
      roundSource: [
        "붙여 넣은 텍스트 또는 최대 6 MB의 PDF, DOCX, PPTX 파일.",
        "제안을 검토한 뒤 비공개 Round 초안 만들기를 명시적으로 선택하세요.",
      ],
      roundImport: [
        "최대 2 MB의 Polling Pops JSON, CSV, 일괄 텍스트 또는 최대 6 MB의 QTI 3 ZIP. Pro가 필요합니다.",
        "검증하고 만들기는 데이터를 검증하고 같은 작업에서 비공개 Round 초안을 만듭니다. 가져오기 경고와 초안을 검토하세요.",
      ],
      presentationBlank: [
        "빈 상태로 시작한 뒤 편집기에서 제목과 슬라이드를 추가하세요.",
        "만들기를 선택하면 편집 가능한 비공개 프레젠테이션 초안이 열립니다.",
      ],
      presentationTemplate: [
        "기존 프레젠테이션 템플릿.",
        "검토 후 사용을 선택하면 독립적으로 편집할 수 있는 초안이 생성됩니다.",
      ],
      presentationDesign: [
        "예시 콘텐츠가 포함된 시각 디자인.",
        "사용을 선택하여 독립적으로 편집할 수 있는 초안을 만든 뒤 예시 콘텐츠를 바꾸세요.",
      ],
      presentationSource: [
        "붙여 넣은 텍스트 또는 최대 6 MB의 PDF, DOCX, PPTX. 원본 슬라이드 레이아웃은 유지되지 않습니다.",
        "제안을 검토하고 선택한 뒤 비공개 프레젠테이션 초안 만들기를 명시적으로 선택하세요.",
      ],
      presentationOutline: [
        "지금은 제목을 입력하고, 초안이 열리면 편집기에서 개요를 입력하세요.",
        "먼저 비공개 초안을 저장하고 엽니다. 그다음 편집기에서 슬라이드를 생성하고 제안을 검토·선택하여 삽입하세요.",
      ],
      surveyBlank: [
        "빈 상태로 시작한 뒤 편집기에서 제목, 선택형 의견 투표와 평점 질문을 추가하세요.",
        "만들기를 선택하면 편집 가능한 비공개 설문 초안이 열립니다.",
      ],
      surveyTemplate: [
        "선택형 의견 투표와 평점이 포함된 기존 설문 템플릿.",
        "검토 후 사용을 선택하면 독립적으로 편집할 수 있는 설문 초안이 생성됩니다.",
      ],
    },
    visualImport:
      "시각 자료를 가져오려면 먼저 저장된 프레젠테이션을 편집기에서 여세요. PDF / 이미지 도구는 최대 6 MB의 PDF 또는 개당 최대 10 MiB의 PNG/JPEG/WebP를 지원하며, 한 묶음당 최대 20 MB, 40페이지/이미지까지 가능합니다. 평면화된 슬라이드 이미지와 편집 가능한 읽기용 버전을 만듭니다. 삽입 전에 읽기 순서와 애니메이션, 링크, 개별 개체 편집 등 손실되는 요소를 검토하세요.",
  },
  "zh-CN": {
    navigation: [
      "所有创建方式",
      "此创建方式不可用。请在下方选择。",
      "资料辅助和结构化导入会按原始题型创建 Round。请选择 Round 来使用此方式。",
      "使用 Round 继续",
    ],
    labels: ["输入", "辅助", "下一步"],
    survey: [
      "创建调查",
      "异步收集意见",
      "通过选择式意见投票和评分题收集意见。调查支持这两种题型。",
      "组织者无法查看谁提交了哪些回答，也无法关联不同问题的回答。结果仅在关闭调查后、每题至少有 5 份回答时显示。单次回答限制按访问凭据执行，不代表已核实的个人身份。",
      "空白调查",
      "自行编写选择式意见投票和评分题。",
      "创建空白调查",
      "正在创建调查…",
      "调查模板",
      "查看模板后，选择“使用”创建自己的可编辑副本。",
      "此工作区无法使用调查。",
      "查看现有调查",
      "所有类型",
    ],
    assistance: [
      "不使用 AI。",
      "资料通过安全扫描后，AI 使用所示额度提出内容建议。请核查来源引用和准确性。",
      "创建草稿不使用 AI。在编辑器中，可选 AI 使用所示额度提出 3–8 张可编辑的文本幻灯片建议。",
    ],
    methods: {
      roundBlank: [
        "输入标题，然后在编辑器中自行添加问题。",
        "选择创建后，将打开可编辑的私密 Round 草稿。",
      ],
      roundTemplate: ["现有的 Round 模板。", "查看后选择“使用”，创建独立的可编辑草稿。"],
      roundSource: [
        "粘贴的文本，或不超过 6 MB 的 PDF、DOCX、PPTX 文件。",
        "审核建议后，再明确选择创建私密 Round 草稿。",
      ],
      roundImport: [
        "不超过 2 MB 的 Polling Pops JSON、CSV 或批量文本；不超过 6 MB 的 QTI 3 ZIP。需要 Pro。",
        "“验证并创建”会检查数据，并在同一操作中创建私密 Round 草稿。请查看导入警告并审核草稿。",
      ],
      presentationBlank: [
        "从空白开始，然后在编辑器中添加标题和幻灯片。",
        "选择创建后，将打开可编辑的私密演示文稿草稿。",
      ],
      presentationTemplate: ["现有的演示文稿模板。", "查看后选择“使用”，创建独立的可编辑草稿。"],
      presentationDesign: [
        "包含示例内容的视觉设计。",
        "选择“使用”创建独立的可编辑草稿，然后替换示例内容。",
      ],
      presentationSource: [
        "粘贴的文本，或不超过 6 MB 的 PDF、DOCX、PPTX。不会保留原始幻灯片布局。",
        "审核并选择建议后，再明确选择创建私密演示文稿草稿。",
      ],
      presentationOutline: [
        "现在输入标题；草稿打开后在编辑器中输入大纲。",
        "先创建并打开已保存的私密草稿，再在编辑器中生成、审核、选择并插入建议的幻灯片。",
      ],
      surveyBlank: [
        "从空白开始，然后在编辑器中添加标题、选择式意见投票和评分题。",
        "选择创建后，将打开可编辑的私密调查草稿。",
      ],
      surveyTemplate: [
        "包含选择式意见投票和评分题的现有调查模板。",
        "查看后选择“使用”，创建独立的可编辑调查草稿。",
      ],
    },
    visualImport:
      "如需导入视觉内容，请先在编辑器中打开已保存的演示文稿。“PDF / 图片”工具支持不超过 6 MB 的 PDF，或每张不超过 10 MiB 的 PNG/JPEG/WebP，每组不超过 20 MB，最多 40 页/张。它会创建扁平化的幻灯片图像和可编辑的阅读版本。插入前请审核阅读顺序，以及动画、链接和单独编辑对象等功能的丢失情况。",
  },
  "zh-TW": {
    navigation: [
      "所有建立方式",
      "此建立方式無法使用。請在下方選擇。",
      "資料輔助和結構化匯入會依原始題型建立 Round。請選擇 Round 來使用此方式。",
      "使用 Round 繼續",
    ],
    labels: ["輸入", "輔助", "下一步"],
    survey: [
      "建立問卷",
      "非同步收集意見",
      "透過選擇式意見投票和評分題收集意見。問卷支援這兩種題型。",
      "主辦者無法查看誰提交了哪些回答，也無法連結不同問題的回答。結果僅在關閉問卷後、每題至少有 5 份回答時顯示。單次回答限制依存取憑證執行，不代表已驗證的個人身分。",
      "空白問卷",
      "自行編寫選擇式意見投票和評分題。",
      "建立空白問卷",
      "正在建立問卷…",
      "問卷範本",
      "檢視範本後，選擇「使用」建立自己的可編輯副本。",
      "此工作區無法使用問卷。",
      "檢視現有問卷",
      "所有類型",
    ],
    assistance: [
      "不使用 AI。",
      "資料通過安全掃描後，AI 使用所示額度提出內容建議。請查核來源引用與正確性。",
      "建立草稿不使用 AI。在編輯器中，選用 AI 使用所示額度提出 3–8 張可編輯的文字投影片建議。",
    ],
    methods: {
      roundBlank: [
        "輸入標題，然後在編輯器中自行新增問題。",
        "選擇建立後，將開啟可編輯的私人 Round 草稿。",
      ],
      roundTemplate: ["現有的 Round 範本。", "檢視後選擇「使用」，建立獨立的可編輯草稿。"],
      roundSource: [
        "貼上的文字，或不超過 6 MB 的 PDF、DOCX、PPTX 檔案。",
        "審閱建議後，再明確選擇建立私人 Round 草稿。",
      ],
      roundImport: [
        "不超過 2 MB 的 Polling Pops JSON、CSV 或批次文字；不超過 6 MB 的 QTI 3 ZIP。需要 Pro。",
        "「驗證並建立」會檢查資料，並在同一操作中建立私人 Round 草稿。請檢視匯入警告並審閱草稿。",
      ],
      presentationBlank: [
        "從空白開始，然後在編輯器中新增標題和投影片。",
        "選擇建立後，將開啟可編輯的私人簡報草稿。",
      ],
      presentationTemplate: ["現有的簡報範本。", "檢視後選擇「使用」，建立獨立的可編輯草稿。"],
      presentationDesign: [
        "包含範例內容的視覺設計。",
        "選擇「使用」建立獨立的可編輯草稿，然後替換範例內容。",
      ],
      presentationSource: [
        "貼上的文字，或不超過 6 MB 的 PDF、DOCX、PPTX。不會保留原始投影片配置。",
        "審閱並選取建議後，再明確選擇建立私人簡報草稿。",
      ],
      presentationOutline: [
        "現在輸入標題；草稿開啟後在編輯器中輸入大綱。",
        "先建立並開啟已儲存的私人草稿，再於編輯器中產生、審閱、選取並插入建議的投影片。",
      ],
      surveyBlank: [
        "從空白開始，然後在編輯器中新增標題、選擇式意見投票和評分題。",
        "選擇建立後，將開啟可編輯的私人問卷草稿。",
      ],
      surveyTemplate: [
        "包含選擇式意見投票和評分題的現有問卷範本。",
        "檢視後選擇「使用」，建立獨立的可編輯問卷草稿。",
      ],
    },
    visualImport:
      "如需匯入視覺內容，請先在編輯器中開啟已儲存的簡報。「PDF / 圖片」工具支援不超過 6 MB 的 PDF，或每張不超過 10 MiB 的 PNG/JPEG/WebP，每組不超過 20 MB，最多 40 頁/張。它會建立平面化的投影片影像和可編輯的閱讀版本。插入前請審閱閱讀順序，以及動畫、連結和單獨編輯物件等功能的遺失情況。",
  },
} as const satisfies Record<SupportedLocale, TranslationRow>;

export function creationMethodCopy(locale: SupportedLocale = "en-CA"): CreationMethodCopy {
  const row = Object.hasOwn(rows, locale) ? rows[locale] : rows["en-CA"];
  const [allMethods, invalidSelection, incompatiblePoll, switchToRound] = row.navigation;
  const [input, assistance, nextStep] = row.labels;
  const [
    title,
    eyebrow,
    description,
    privacy,
    blankTitle,
    blankDescription,
    createBlank,
    creating,
    templateTitle,
    templateDescription,
    unavailable,
    viewExisting,
    allTypes,
  ] = row.survey;
  return {
    allMethods,
    invalidSelection,
    incompatiblePoll,
    switchToRound,
    labels: { input, assistance, nextStep },
    survey: {
      title,
      eyebrow,
      description,
      privacy,
      blankTitle,
      blankDescription,
      createBlank,
      creating,
      templateTitle,
      templateDescription,
      unavailable,
      viewExisting,
      allTypes,
    },
    methods: Object.fromEntries(
      creationMethodKeys.map((key) => [
        key,
        {
          input: row.methods[key][0],
          assistance:
            row.assistance[
              key === "roundSource" || key === "presentationSource"
                ? 1
                : key === "presentationOutline"
                  ? 2
                  : 0
            ],
          nextStep: row.methods[key][1],
          ...(key === "presentationBlank" ? { note: row.visualImport } : {}),
        },
      ]),
    ) as Record<CreationMethodKey, CreationMethodExplanation>,
  };
}

/** Exact display strings and field paths used by editorial packets and parity tests. */
export function creationMethodCopyEntries(
  locale: SupportedLocale = "en-CA",
): Record<string, string> {
  const entries: [string, string][] = [];
  const visit = (value: object, prefix = "") => {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof child === "string") entries.push([path, child]);
      else visit(child, path);
    }
  };
  visit(creationMethodCopy(locale));
  return Object.fromEntries(entries);
}
