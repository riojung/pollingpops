/** Public editorial copy. Illustrations use original sample content, never customer data. */
export const PUBLIC_PRODUCT_CTA_HREF = "/signin?mode=signup&returnTo=%2Fcreate";

export type PublicProductDemoKind =
  | "poll"
  | "quiz"
  | "word-cloud"
  | "qa"
  | "presentation"
  | "survey"
  | "board"
  | "practice"
  | "report"
  | "collaboration";

export interface PublicContentItem {
  title: string;
  description: string;
}

export interface PublicFaq {
  question: string;
  answer: string;
}

export interface PublicProductPage {
  slug: string;
  title: string;
  shortDescription: string;
  group: string;
  outcome: string;
  description: string;
  benefits: readonly string[];
  workflowTitle: string;
  steps: readonly PublicContentItem[];
  detailTitle: string;
  details: readonly PublicContentItem[];
  useCases: readonly PublicContentItem[];
  faqs: readonly PublicFaq[];
  availability: string;
  demoKind: PublicProductDemoKind;
  examplesHref: string;
  relatedSlugs: readonly string[];
}

export const publicProductPages = [
  {
    slug: "live-polls",
    title: "Live polls",
    shortDescription: "Ask the room. Give the conversation a direction.",
    group: "Live participation",
    outcome: "Know what the room thinks before you move on.",
    description:
      "A quick vote can change the next ten minutes. Add opinion questions to a Round, invite people with a code or QR code, and bring the response pattern into your conversation while it still matters.",
    benefits: [
      "Opinions without right answers",
      "Host-controlled reveal",
      "A place in your session report",
    ],
    workflowTitle: "From a useful question to a better discussion",
    steps: [
      {
        title: "Choose the decision",
        description:
          "Start with a blank Round or an original template. Ask one clear question and write options that leave room for a different view.",
      },
      {
        title: "Invite a response",
        description:
          "Launch the Round and share its join code or QR code. Open the question when the room is ready, then give people time to think.",
      },
      {
        title: "Make the pattern useful",
        description:
          "Reveal the distribution, ask what explains it, and decide what to discuss next. Return to the finished session report after the meeting.",
      },
    ],
    detailTitle: "The question format should fit the conversation.",
    details: [
      {
        title: "Keep opinions unscored",
        description:
          "Use a single-choice opinion poll when every answer is a valid perspective. Opinion responses do not become quiz winners or inflate a knowledge score.",
      },
      {
        title: "Go beyond one choice",
        description:
          "Where extended responses are enabled, use multiple selection with authored limits, ranking with full-list or top-N ordering, open text, and word clouds.",
      },
      {
        title: "Run it in your own rhythm",
        description:
          "Prepare several questions in the Round editor, choose the available live theme, and control question progression and reveal from the host view.",
      },
      {
        title: "Read the result in context",
        description:
          "See opinion distributions separately from scored questions. A response count tells you who answered that question, not whether the whole audience agrees.",
      },
    ],
    useCases: [
      {
        title: "Set a meeting agenda",
        description: "Ask which topic deserves the most time before opening the discussion.",
      },
      {
        title: "Check a starting point",
        description:
          "Ask how familiar the audience is with a topic so you can pitch the explanation.",
      },
      {
        title: "Choose the next experiment",
        description: "Rank a shortlist, then discuss the tradeoffs behind the order.",
      },
    ],
    faqs: [
      {
        question: "How is a poll different from a quiz?",
        answer:
          "An opinion poll has no correct answer and does not award knowledge points. A quiz uses authored correct answers. You can choose the appropriate question type while building a Round.",
      },
      {
        question: "Can I ask more than single-choice questions?",
        answer:
          "Multiple-selection opinion polls, ranking, open text, and word clouds are supported by the extended live-response capability. Your workspace must have that capability enabled; each format has its own response and display rules.",
      },
      {
        question: "Do people have to create a creator account to respond?",
        answer:
          "Live participants use the session join flow rather than the creator workspace. The host's access settings and the session's participant identity choices still apply. Accountless participation does not mean every response is anonymous to the facilitator.",
      },
    ],
    availability:
      "Question formats, live themes, and launch options depend on your workspace's enabled capabilities and plan.",
    demoKind: "poll",
    examplesHref: "/examples?type=round",
    relatedSlugs: ["word-clouds", "quizzes", "reports"],
  },
  {
    slug: "quizzes",
    title: "Live quizzes",
    shortDescription: "Give knowledge checks a little momentum.",
    group: "Live participation",
    outcome: "Make the next explanation as engaging as the question.",
    description:
      "Build a live Round with scored questions, reveal the answer together, and give the room a reason to stay involved. Use the evidence to explain a misconception before the next question starts.",
    benefits: [
      "Authored correct answers",
      "Race and podium views",
      "Recovery after a difficult question",
    ],
    workflowTitle: "Prepare, play, and bring the learning back",
    steps: [
      {
        title: "Build the Round",
        description:
          "Write your questions in the Round editor or make an independent copy of a template. Review answers, timing, explanations, and the experience before publishing.",
      },
      {
        title: "Host the moment",
        description:
          "Share the join code and lead the session. Reveal main-question results together and choose a race or standings view for competitive Rounds.",
      },
      {
        title: "Use what you learned",
        description:
          "Pause to explain an answer, use the available recovery workflow, and review the completed report for your next teaching or training decision.",
      },
    ],
    detailTitle: "Competition with a purpose beyond the podium.",
    details: [
      {
        title: "An editor for the whole Round",
        description:
          "Move between questions in the navigator, preview your content, and choose supported visual themes before you host. Published content keeps the version used by the session.",
      },
      {
        title: "A reveal worth watching",
        description:
          "Competitive Round standings update when a scored main question is revealed. Race, table, and final podium treatments make the released results easy to follow.",
      },
      {
        title: "Celebrate movement as well as place",
        description:
          "The competition dashboard can recognize the biggest climb and show released gain or streak information where available. The final celebration can be replayed, and motion preferences take priority.",
      },
      {
        title: "Connect the answer to an intervention",
        description:
          "The Recovery Loop brings a question, an explanation or intervention, and a supported recheck into one teaching workflow. Reports keep the original and paired recovery evidence distinct.",
      },
    ],
    useCases: [
      {
        title: "Retrieve before you reteach",
        description:
          "Start a lesson with a short knowledge check and spend the explanation on the difficult ideas.",
      },
      {
        title: "Rehearse a real decision",
        description: "Ask which action fits a workplace scenario, then unpack the reasons.",
      },
      {
        title: "Close a workshop",
        description: "Use a short recap Round to find the points that need one more example.",
      },
    ],
    faqs: [
      {
        question: "Does every Round need a winner?",
        answer:
          "No. Opinion-only Rounds do not declare winners, and private result settings are supported. Choose a competitive experience when scoring serves the session.",
      },
      {
        question: "When does the race move?",
        answer:
          "For competitive Rounds using the released-score ledger, public standings update at scored main-question reveal. Accepting an answer does not immediately publish its score, and ending early does not reveal the active question.",
      },
      {
        question: "Can I follow up after the live quiz?",
        answer:
          "Eligible workspaces can create self-paced practice assignments from a published Round. Assignment and follow-up access are required. Practice attempts are evidence of submitted work, not a verified measure of unique people or mastery.",
      },
    ],
    availability:
      "Competition treatments depend on the Round's experience and result settings. Recovery and assignments require their corresponding workspace capabilities.",
    demoKind: "quiz",
    examplesHref: "/examples?type=round",
    relatedSlugs: ["assignments", "reports", "live-polls"],
  },
  {
    slug: "word-clouds",
    title: "Word clouds",
    shortDescription: "Let a roomful of short phrases become a shared picture.",
    group: "Live participation",
    outcome: "See the words your audience brings to the room.",
    description:
      "Ask for a word or short phrase and watch a shared cloud take shape. Matching phrases combine and grow, making a useful starting point for a discussion about expectations, reactions, or what to try next.",
    benefits: [
      "Whole short phrases",
      "Live or reviewed display",
      "Exact counts alongside the cloud",
    ],
    workflowTitle: "One prompt. Many perspectives. A place to begin.",
    steps: [
      {
        title: "Ask something focused",
        description:
          "Add a word-cloud question to a Round. A prompt such as “What would make our handoffs easier?” invites concise, practical responses.",
      },
      {
        title: "Choose how words appear",
        description:
          "At launch, choose live display for an immediate cloud or review-first display when you want to approve responses before reveal.",
      },
      {
        title: "Explore the language",
        description:
          "Look at repeated phrases, inspect exact counts, and invite people to explain what the words mean to them. A large word is a conversation cue, not a complete conclusion.",
      },
    ],
    detailTitle: "Keep the meaning in the phrase.",
    details: [
      {
        title: "Short phrases stay together",
        description:
          "“Clear priorities” stays a phrase instead of splitting into separate words. Matching normalizes case, spacing, and surrounding sentence punctuation so small typing differences do not fragment the same response.",
      },
      {
        title: "A cloud that grows with the room",
        description:
          "In live mode, the first saved response can appear immediately. Repeated phrases grow and the layout adjusts as the response pattern changes.",
      },
      {
        title: "A deliberate moderation choice",
        description:
          "Live mode shows responses automatically and lets the facilitator remove them. Review-first mode holds text for approval and applies reveal and minimum-response rules before public display.",
      },
      {
        title: "A count behind the visual",
        description:
          "Use the exact-count view to read the frequencies, including terms that do not fit in the visible cloud. The display respects reduced-motion preferences.",
      },
    ],
    useCases: [
      {
        title: "Open a workshop",
        description: "Collect expectations before introducing the plan.",
      },
      {
        title: "Name a team theme",
        description:
          "Ask what helped this week and use recurring phrases to start a retrospective.",
      },
      {
        title: "Check the takeaway",
        description: "Close with one idea people want to remember, then discuss what is missing.",
      },
    ],
    faqs: [
      {
        question: "Can people submit a short phrase?",
        answer:
          "Yes. Word clouds accept bounded plain text and preserve short phrases. Matching phrases combine after case, spacing, and surrounding sentence punctuation normalization.",
      },
      {
        question: "Do responses appear immediately?",
        answer:
          "In live display mode, saved phrases appear automatically, starting with the first response, and the facilitator can remove them. In review-first mode, responses wait for approval and reveal; public results require five approved respondents. Historical report privacy rules remain separate.",
      },
      {
        question: "Is a word cloud the same as a survey result?",
        answer:
          "No. A word cloud shows the language and frequency of submitted phrases. People can use different words for the same idea, so discuss the context before treating a prominent phrase as a decision or consensus.",
      },
    ],
    availability:
      "Word clouds require the extended live-response capability. Live and review-first display apply different public visibility rules; avoid asking for private information.",
    demoKind: "word-cloud",
    examplesHref: "/examples?type=round",
    relatedSlugs: ["live-polls", "idea-boards", "reports"],
  },
  {
    slug: "live-qa",
    title: "Live Q&A",
    shortDescription: "Make space for the questions people are carrying.",
    group: "Live participation",
    outcome: "Bring the audience's questions into the conversation.",
    description:
      "Collect questions alongside a live session, let participants vote for what matters to them, and use facilitator controls to keep the discussion focused. The next useful question does not have to come from the loudest person in the room.",
    benefits: [
      "Participant questions and votes",
      "Facilitator moderation",
      "Round and enabled Presentation sessions",
    ],
    workflowTitle: "Open the floor without losing the thread",
    steps: [
      {
        title: "Set the expectations",
        description:
          "Choose your Q&A settings and explain the question, visibility, and alias choices to the audience before submissions begin.",
      },
      {
        title: "Collect and prioritize",
        description:
          "Participants submit questions from their session view and vote on questions already raised. The facilitator reviews submissions with the available moderation controls.",
      },
      {
        title: "Work through the queue",
        description:
          "Bring relevant questions into the discussion and update their status as you address them. Use a clear wrap-up to explain what needs a later answer.",
      },
    ],
    detailTitle: "A shared queue, with clear facilitator controls.",
    details: [
      {
        title: "Questions that have a place to go",
        description:
          "Give participants a dedicated Q&A surface during a Round or an enabled live Presentation. Voting helps reveal shared interest in a question without treating votes as a formal decision.",
      },
      {
        title: "Moderation before a public moment",
        description:
          "Use the session's initial-status and visibility settings to control how submitted questions enter the public queue. Pending and removed questions follow role-specific visibility rules.",
      },
      {
        title: "Privacy choices you can explain",
        description:
          "A question shown as Anonymous to other participants can still have a facilitator-visible alias. Make that distinction explicit when inviting sensitive questions.",
      },
      {
        title: "Use the controls for the session type",
        description:
          "Round Q&A includes facilitator reply support. Presentation Q&A uses its own supported moderation and participant views; Round reply and chat behavior should not be assumed there.",
      },
    ],
    useCases: [
      {
        title: "Make a town hall more focused",
        description:
          "Collect questions while the update is in progress, then work through common interests.",
      },
      {
        title: "Give a lecture room time to think",
        description:
          "Let learners submit a question when it occurs instead of waiting for a raised-hand break.",
      },
      {
        title: "Keep a workshop moving",
        description:
          "Capture questions that deserve attention without interrupting every exercise.",
      },
    ],
    faqs: [
      {
        question: "Can participants vote for an existing question?",
        answer:
          "Yes. Participant Q&A supports submitting questions and voting on questions in the available queue. Hosts control the session's supported visibility and moderation settings.",
      },
      {
        question: "Are anonymous questions hidden from the facilitator?",
        answer:
          "Not necessarily. Anonymous public display can hide a name from other participants while the facilitator can still see the participant alias. The session's identity and alias policies apply.",
      },
      {
        question: "Is Q&A identical in Rounds and Presentations?",
        answer:
          "No. Both have supported Q&A surfaces where enabled, but their controls differ. For example, facilitator replies are supported in Round Q&A and are not part of the current Presentation Q&A interface.",
      },
    ],
    availability:
      "Q&A depends on the supported session type, workspace capabilities, and host settings. Presentation Q&A requires its enabled live-session capabilities.",
    demoKind: "qa",
    examplesHref: "/examples?type=presentation",
    relatedSlugs: ["presentations", "live-polls", "idea-boards"],
  },
  {
    slug: "presentations",
    title: "Interactive presentations",
    shortDescription: "Build the story and the audience moment in one place.",
    group: "Create & collect",
    outcome: "Give your slides a conversation to lead.",
    description:
      "Create an editable presentation, start with an original design, or bring in visual pages from a PDF or image set. Add supported audience activities and lead an enabled live session without treating participation as an afterthought.",
    benefits: [
      "30 original design collections",
      "240 coordinated editable layouts",
      "Content and activities together",
    ],
    workflowTitle: "From a first page to a shared moment",
    steps: [
      {
        title: "Choose your starting point",
        description:
          "Open a blank presentation, copy an original content template, select a design collection, or preview and select pages from a supported visual import.",
      },
      {
        title: "Shape the story",
        description:
          "Edit native text and objects, arrange your slides, and add the supported activities. Preview a design change before applying it to your existing content.",
      },
      {
        title: "Present and follow through",
        description:
          "Publish and launch a live session where enabled. Use host and audience views during delivery, then inspect the retained session's available insights or create a static export.",
      },
    ],
    detailTitle: "A presentation workspace with more than a colour switch.",
    details: [
      {
        title: "Designs with actual compositions",
        description:
          "Explore 30 original collections with 240 editable layouts across business, research, education, creative work, and more. Full design moves suitable native content into the selected composition; Colors and fonts keeps the existing layout.",
      },
      {
        title: "Bring in the pages you need",
        description:
          "Preview a PDF or image-set conversion, select pages in order, and use those visual pages as a starting point. Imported page artwork is not a promise that its text and objects become independently editable.",
      },
      {
        title: "Keep participation in the story",
        description:
          "Use the supported question and activity blocks, then host with the live and participant companion capabilities enabled for your workspace. Q&A and activity controls follow the session's own permissions.",
      },
      {
        title: "Make review part of authoring",
        description:
          "Source intake and supported import previews help you inspect material before applying it. Optional AI tools require an operator-configured provider and present proposals for review; ordinary editing and design collections do not require an AI request.",
      },
      {
        title: "Take a static version with you",
        description:
          "Published presentations support whole-deck PDF, one-page PNG, and readable HTML exports. These preserve a static recipient-safe version; live controls and editable PowerPoint export are different capabilities.",
      },
    ],
    useCases: [
      {
        title: "Explain a proposal",
        description:
          "Use a coordinated visual story and pause for an opinion question before the decision.",
      },
      {
        title: "Lead an active lesson",
        description:
          "Alternate explanation with supported knowledge checks and time for audience questions.",
      },
      {
        title: "Facilitate a team workshop",
        description:
          "Set the context on a slide, invite a response, and keep the next discussion prompt ready.",
      },
    ],
    faqs: [
      {
        question: "Can I apply a design to an existing presentation?",
        answer:
          "Yes. Full design applies a collection's actual composition to suitable content. Colors and fonts changes its style while retaining the geometry. Content that cannot be safely recomposed retains its layout and shows a notice; preview and undo help you review the result.",
      },
      {
        question: "Does importing a PDF create editable slide objects?",
        answer:
          "Supported PDF and image-set imports create visual pages. Their artwork retains the source appearance, but text inside the page image is not automatically an editable native text object. You can build and edit native content separately.",
      },
      {
        question: "Do I need AI to create a presentation?",
        answer:
          "No. Blank creation, original templates, design collections, and manual editing work without an AI request. Optional AI assistance depends on operator configuration and enabled access, and its proposals require review before use.",
      },
      {
        question: "Can I export to PowerPoint?",
        answer:
          "The current static export workflow offers PDF, PNG, and readable HTML. Editable PPTX export is not part of that workflow.",
      },
    ],
    availability:
      "Presentation creation, live hosting, companion views, and optional assistance have separate workspace capabilities. Some imported or complex content keeps its original geometry during design application.",
    demoKind: "presentation",
    examplesHref: "/examples?type=presentation",
    relatedSlugs: ["live-qa", "live-polls", "reports"],
  },
  {
    slug: "surveys",
    title: "Surveys",
    shortDescription: "Give feedback a useful place after the session.",
    group: "Create & collect",
    outcome: "Keep listening when everyone leaves the room.",
    description:
      "Build a self-paced Survey, publish a version you have reviewed, and share a run link for people to respond in their own time. Use the resulting feedback to plan a practical next step.",
    benefits: [
      "Self-paced responses",
      "Reviewed published versions",
      "Aggregate results with privacy rules",
    ],
    workflowTitle: "Ask clearly, collect deliberately, act on the result",
    steps: [
      {
        title: "Write a focused Survey",
        description:
          "Start with a blank Survey or an original template. Choose supported question types and review the wording, response choices, and optional context items.",
      },
      {
        title: "Publish and share",
        description:
          "Publish the version you want to collect against, launch a Survey run, and share its link using your own communication channel.",
      },
      {
        title: "Close the feedback loop",
        description:
          "Review available results and their denominators. After the run closes, use eligible aggregate summaries to explain what you heard and what happens next.",
      },
    ],
    detailTitle: "Enough structure to make feedback actionable.",
    details: [
      {
        title: "A separate self-paced format",
        description:
          "Surveys have their own authoring, publication, run, and results workflow. They give respondents time outside a live Round to consider the questions.",
      },
      {
        title: "Publish what you have reviewed",
        description:
          "A published version separates the questions used for collection from later draft editing. Start from an original Survey template when a familiar structure helps.",
      },
      {
        title: "Ordered pages, where explicitly enabled",
        description:
          "The opt-in Survey pages capability supports arranging a Survey into ordered pages. It remains disabled unless explicitly granted to the workspace; existing published links keep their established behavior.",
      },
      {
        title: "Report with the right expectations",
        description:
          "Read aggregate response counts and supported distributions in context. Summary sharing and downloads require their own access, and small-sample protections can limit what is shown.",
      },
    ],
    useCases: [
      {
        title: "Gather workshop reflections",
        description: "Ask what was useful, what remains unclear, and what people want to try next.",
      },
      {
        title: "Prepare a team discussion",
        description: "Collect a few focused perspectives before choosing the meeting agenda.",
      },
      {
        title: "Follow up after training",
        description:
          "Ask what participants have tried since the session and what support would help.",
      },
    ],
    faqs: [
      {
        question: "How is a Survey different from a live poll?",
        answer:
          "A Survey is self-paced and uses a published run link. A live poll is a question within a host-led Round. Choose based on when you need the response and whether the audience is together.",
      },
      {
        question: "Can I split a Survey into pages?",
        answer:
          "Ordered-page authoring is available only when the Survey pages capability is explicitly enabled. It is disabled by default. A workspace without that grant keeps the existing Survey creation and published-link behavior.",
      },
      {
        question: "Can I create conditional page branches?",
        answer:
          "Conditional page branching is currently unavailable. Use a linear Survey, with ordered pages where your workspace has that option enabled.",
      },
      {
        question: "Does Polling Pops email the Survey to respondents?",
        answer:
          "This workflow provides a Survey run link that you can share through your own communication channel. It does not promise a built-in email distribution service.",
      },
    ],
    availability:
      "Surveys require enabled Survey access. Ordered pages need a separate explicit grant; conditional page authoring and launch are unavailable.",
    demoKind: "survey",
    examplesHref: "/examples?type=survey",
    relatedSlugs: ["live-polls", "reports", "collaboration"],
  },
  {
    slug: "idea-boards",
    title: "Idea boards",
    shortDescription: "Collect ideas, make sense of them, choose what to explore.",
    group: "Create & collect",
    outcome: "Turn a roomful of suggestions into a next step.",
    description:
      "Give ideas a shared space beyond a fast-moving conversation. Collect moderated contributions, group them manually, and invite private priority voting before deciding what deserves a closer look.",
    benefits: ["Moderated contributions", "Manual grouping", "Private priority voting"],
    workflowTitle: "Make room for ideas before you narrow the field",
    steps: [
      {
        title: "Frame the invitation",
        description:
          "Create a board with a focused prompt, explain what a useful contribution looks like, and share the supported participant access.",
      },
      {
        title: "Collect and organize",
        description:
          "Review incoming ideas and group related contributions manually. Where enabled, enrich an idea with a sketch, links, or supported image attachments.",
      },
      {
        title: "Find a practical priority",
        description:
          "Move to private priority voting, review the result, and talk through which idea to investigate. Voting freezes the contributed content for that stage.",
      },
    ],
    detailTitle: "Keep the original idea close to the decision.",
    details: [
      {
        title: "Moderation at the contribution boundary",
        description:
          "Approved, pending, and removed ideas have different visibility. Participants can work with their own contributions while facilitators manage what reaches the shared board.",
      },
      {
        title: "More than a text card",
        description:
          "Rich ideas support an editable sketch and website or social-post link cards. Scanned image attachments are available when the deployment's storage and scanning pipeline is configured.",
      },
      {
        title: "Group with human judgment",
        description:
          "Arrange related ideas manually so the facilitator can explain the groupings. A shared word does not automatically mean two contributions describe the same problem.",
      },
      {
        title: "A spatial view when your team needs it",
        description:
          "Eligible boards can use a canvas view. Separate canvas sharing and live collaboration capabilities support authorized team members, object updates, and conflict review.",
      },
    ],
    useCases: [
      {
        title: "Run a retrospective",
        description: "Collect what helped, what slowed the team down, and one improvement to try.",
      },
      {
        title: "Explore a workshop problem",
        description: "Invite possible approaches before debating or prioritizing them.",
      },
      {
        title: "Shape a community session",
        description: "Gather topic suggestions and use priority voting to guide the next agenda.",
      },
    ],
    faqs: [
      {
        question: "Can participants add more than text?",
        answer:
          "Rich ideas support sketches and link cards. Image attachments additionally require configured storage and malware scanning. Those deployment requirements do not apply to plain text, sketches, and links.",
      },
      {
        question: "Are votes public?",
        answer:
          "Idea boards use private priority voting. The result helps a facilitator discuss priorities; it should not be presented as proof that an idea is best or represents everyone.",
      },
      {
        question: "Does a board support simultaneous document editing?",
        answer:
          "Enabled canvas collaboration synchronizes authorized object-level changes and provides conflict review. It is not simultaneous character-level text editing or a promise of offline collaboration. Canvas sharing also has its own organization and license rules.",
      },
    ],
    availability:
      "Idea boards, canvas views, canvas sharing, and live canvas collaboration are separately enabled capabilities. Image uploads need configured storage and scanning.",
    demoKind: "board",
    examplesHref: "/examples",
    relatedSlugs: ["word-clouds", "live-polls", "collaboration"],
  },
  {
    slug: "assignments",
    title: "Practice assignments",
    shortDescription: "Give a published Round a useful second life.",
    group: "Follow through",
    outcome: "Keep the practice going after the live moment.",
    description:
      "Create self-paced practice from a published Round, set its availability, and share a link for learners to use in their own time. Return to the attempts to decide where another explanation or example could help.",
    benefits: ["Published Round questions", "Scheduled availability", "Attempt-based review"],
    workflowTitle: "A manageable next step after the session",
    steps: [
      {
        title: "Choose the published Round",
        description:
          "Start an assignment from a published Round whose main questions are suitable for independent practice. Review the source and assignment setup.",
      },
      {
        title: "Set the window and links",
        description:
          "Choose supported opening and closing times, review the access settings, and create the available shared or personal links.",
      },
      {
        title: "Review the practice evidence",
        description:
          "Share links through your own channel. Inspect submitted attempts and use the evidence to plan follow-up without treating an attempt count as a verified person count.",
      },
    ],
    detailTitle: "Practice connected to what you already taught.",
    details: [
      {
        title: "Reuse a stable source",
        description:
          "An assignment starts from a published Round rather than whatever happens to be in an unfinished draft. Round main questions form the practice content; a live recheck is not automatically a separate assigned question.",
      },
      {
        title: "A clear availability window",
        description:
          "Set the supported opening and closing times within the access allowed by your plan. Review the displayed timezone before you distribute the link.",
      },
      {
        title: "Choose the appropriate link",
        description:
          "Use the available shared link or, where eligible, personal practice links. Treat a personal link as access to protect, and explain how you plan to use the resulting attempt evidence.",
      },
      {
        title: "Use attempts to choose a next action",
        description:
          "Look for questions that deserve another explanation or a different example. Completed work and improved answers can inform teaching without claiming verified mastery or causation.",
      },
    ],
    useCases: [
      {
        title: "Revisit a difficult lesson",
        description:
          "Offer another opportunity to work through the published main questions after class.",
      },
      {
        title: "Extend a training session",
        description: "Give participants a focused practice window after the live workshop.",
      },
      {
        title: "Prepare a follow-up conversation",
        description: "Use submitted attempts to choose which scenario to discuss next.",
      },
    ],
    faqs: [
      {
        question: "Which content can I assign?",
        answer:
          "This assignment workflow creates practice from a published Round's main questions. It does not mean that every Presentation activity, Survey, or live recheck can be assigned in the same way.",
      },
      {
        question: "Does an attempt identify a unique learner?",
        answer:
          "No. Attempts are submitted practice records. A shared or personal link is not by itself a verified identity system, and attempt totals should not be described as unique learners or proof of mastery.",
      },
      {
        question: "Will the product email practice links for me?",
        answer:
          "The assignment workflow creates links for you to distribute using your own communication channel. It does not promise built-in email delivery or an LMS roster and gradebook integration.",
      },
    ],
    availability:
      "Creating practice assignments requires enabled practice-assignment and follow-up access. Time windows and personal-link limits follow the workspace's plan and policy.",
    demoKind: "practice",
    examplesHref: "/examples?type=round",
    relatedSlugs: ["quizzes", "reports", "collaboration"],
  },
  {
    slug: "reports",
    title: "Reports & the Recovery Loop",
    shortDescription: "Make a response useful beyond the reveal.",
    group: "Follow through",
    outcome: "Turn the session's evidence into your next teaching move.",
    description:
      "Review what people answered, where an explanation was needed, and what happened on a supported recheck. Keep opinion results, scored questions, and paired recovery evidence distinct so the next step rests on what the session actually shows.",
    benefits: [
      "Question-level evidence",
      "Distinct paired recovery results",
      "Eligible aggregate summaries",
    ],
    workflowTitle: "Ask, respond, and decide what to try next",
    steps: [
      {
        title: "Check the starting point",
        description:
          "Use a scored question or supported activity to see the initial response pattern. Decide whether the group needs an explanation, example, or discussion.",
      },
      {
        title: "Intervene and recheck",
        description:
          "Use the available Recovery Loop to connect an intervention with a supported recheck. Read paired evidence with its actual response coverage.",
      },
      {
        title: "Review and follow through",
        description:
          "Open the completed report, choose a practical follow-up, and create an eligible aggregate summary or practice assignment when that access is enabled.",
      },
    ],
    detailTitle: "Useful evidence needs its boundaries visible.",
    details: [
      {
        title: "Question evidence with context",
        description:
          "Round reports distinguish scored responses, unscored opinions, and supported recovery evidence. Inspect the relevant counts and denominators rather than turning every activity into one score.",
      },
      {
        title: "Paired recovery, not a causal claim",
        description:
          "Compare available initial and recheck answers for the supported paired sample. A change within a session can guide a teaching decision; it does not prove long-term retention or that the intervention caused the change.",
      },
      {
        title: "Insights for each supported format",
        description:
          "Finished retained Presentation sessions can expose delivery and response coverage, opinion distributions, paired recovery, and current public Q&A counts. Surveys use their own results workflow.",
      },
      {
        title: "Share an aggregate next step",
        description:
          "Where enabled and permitted, create a reviewed session summary with your own next steps, supported downloads, and expiring revocable links. Aggregate summaries exclude participant identities and submitted free text, including word-cloud terms.",
      },
      {
        title: "Privacy changes what can be shown",
        description:
          "Small-sample protections, source retention, permissions, and export access apply. An unavailable or suppressed value should not be read as zero or as evidence that everyone answered.",
      },
    ],
    useCases: [
      {
        title: "Plan tomorrow's lesson",
        description:
          "Find the question that needs a different explanation and prepare one targeted example.",
      },
      {
        title: "Explain a training follow-up",
        description:
          "Share an eligible aggregate summary and the practice you want people to try next.",
      },
      {
        title: "Review a facilitated session",
        description:
          "Look at response coverage and opinion patterns before deciding how to adapt the next meeting.",
      },
    ],
    faqs: [
      {
        question: "Does a better recheck result prove learning?",
        answer:
          "It is useful session evidence, with limits. Paired recovery results describe the supported participants and questions in that session. They do not by themselves prove durable mastery, causal impact, or improvement for people who did not respond.",
      },
      {
        question: "Can I share the complete participant report publicly?",
        answer:
          "The summary-sharing workflow uses an aggregate projection, not the private participant report. It excludes participant identities, submitted text, word-cloud terms, transcripts, and private feedback. Small-sample and access rules still apply.",
      },
      {
        question: "Are downloads and public summary links always included?",
        answer:
          "No. Summary creation, link sharing, and report downloads depend on enabled capabilities and report-export access. Links can expire or be revoked, and source retention and publisher permissions continue to apply.",
      },
    ],
    availability:
      "Reporting surfaces vary by source and retained session data. Recovery features, report exports, and shareable summaries have separate capabilities and access requirements.",
    demoKind: "report",
    examplesHref: "/examples?type=round",
    relatedSlugs: ["quizzes", "assignments", "surveys"],
  },
  {
    slug: "collaboration",
    title: "Team collaboration",
    shortDescription: "Give useful content a life beyond one creator.",
    group: "Follow through",
    outcome: "Build on good work without losing track of who can use it.",
    description:
      "Find Rounds, Presentations, and Surveys in the Library, organize audiences with Groups, and share eligible published content through your organization. Let colleagues discover or independently reuse a reviewed version with clear permissions.",
    benefits: [
      "An All content Library",
      "Published-version sharing",
      "Independent copies with Can use",
    ],
    workflowTitle: "Create once, review once, make reuse deliberate",
    steps: [
      {
        title: "Find and organize",
        description:
          "Use the All content Library to search and filter the content you are authorized to see. Keep format-specific management and group workflows close at hand.",
      },
      {
        title: "Publish and choose permission",
        description:
          "Share an eligible published version with the supported organization audience. Choose whether people may view it or use it to create an independent copy.",
      },
      {
        title: "Reuse in a new context",
        description:
          "An authorized colleague with Can use can make their own copy, adapt it, and manage its later work independently. Review sharing when the content or audience changes.",
      },
    ],
    detailTitle: "Reuse with a clear permission boundary.",
    details: [
      {
        title: "One discovery surface for three formats",
        description:
          "All content brings authorized Rounds, Presentations, and Surveys together with search, filtering, sorting, and exact result totals. Workspace, organization, and direct-sharing scopes retain their own authorization.",
      },
      {
        title: "Share a reviewed published version",
        description:
          "Organization Library sharing points to a frozen published version. It does not silently follow later draft edits or give the recipient permission to change the original.",
      },
      {
        title: "View and use mean different things",
        description:
          "Can view enables the supported read experience. Can use permits an independent copy. Neither permission is a grant to private session results, the source workspace, or a paid creator seat.",
      },
      {
        title: "Keep audiences organized",
        description:
          "Groups support organizing reusable audiences in enabled workspaces. Group membership does not replace source-level sharing, workspace membership, or the product's license requirements.",
      },
      {
        title: "Collaborate on supported canvases",
        description:
          "With separate capabilities enabled, verified members of the same organization can receive access to a particular canvas. Editing requires an eligible creator license, and live updates operate at the object level with conflict review.",
      },
    ],
    useCases: [
      {
        title: "Reuse a teaching starter",
        description:
          "Share a reviewed Round that colleagues can copy and adapt for their own group.",
      },
      {
        title: "Keep a workshop kit together",
        description:
          "Find the presentation, live Round, and follow-up Survey from the same Library surface.",
      },
      {
        title: "Give a team a useful pattern",
        description:
          "Publish an original meeting template and let colleagues use it without editing your source.",
      },
    ],
    faqs: [
      {
        question: "Does sharing let someone edit my original content?",
        answer:
          "Organization Library Can view and Can use permissions do not grant editing of the original. Can use creates an independent copy with its own later editing and lifecycle.",
      },
      {
        question: "Does a Library share include session results?",
        answer:
          "No. Sharing a published content version does not grant private session results, source-workspace access, or a paid seat. Each of those has its own access boundary.",
      },
      {
        question: "Can anyone with a link edit a team canvas?",
        answer:
          "No. Supported canvas invitations require verified same-organization membership and the relevant sharing permissions. Editing additionally requires an eligible creator license. Live object collaboration is a separate capability.",
      },
    ],
    availability:
      "Organization, Groups, Library sharing, and canvas collaboration depend on enabled capabilities, current membership, source permissions, and applicable creator licensing.",
    demoKind: "collaboration",
    examplesHref: "/examples",
    relatedSlugs: ["presentations", "idea-boards", "surveys"],
  },
] as const satisfies readonly PublicProductPage[];

export type PublicProductSlug = (typeof publicProductPages)[number]["slug"];

export const publicProductNavigation = publicProductPages.map((page) => ({
  slug: page.slug,
  title: page.title,
  shortDescription: page.shortDescription,
  group: page.group,
  href: `/product/${page.slug}`,
}));

export function getPublicProductPage(slug: string): PublicProductPage | undefined {
  return publicProductPages.find((page) => page.slug === slug);
}

export interface PublicSolutionPage {
  slug: string;
  title: string;
  shortDescription: string;
  outcome: string;
  description: string;
  workflowTitle: string;
  steps: readonly PublicContentItem[];
  useCases: readonly PublicContentItem[];
  faqs: readonly PublicFaq[];
  featureSlugs: readonly PublicProductSlug[];
  demoKind: PublicProductDemoKind;
  examplesHref: string;
  takeaway: string;
}

export const publicSolutionPages = [
  {
    slug: "meetings",
    title: "Team meetings",
    shortDescription: "Hear the room, focus the discussion, leave with a next step.",
    outcome: "Make the meeting a place people contribute.",
    description:
      "Start with a question everyone can answer, make space for perspectives during the discussion, and collect a useful reflection afterwards. Polling Pops gives each moment a format that fits.",
    workflowTitle: "A useful rhythm for your next team meeting",
    steps: [
      {
        title: "Begin with the room",
        description:
          "Open with an unscored poll about the priority for the meeting, or ask for a short phrase to describe the week.",
      },
      {
        title: "Give the discussion a shape",
        description:
          "Present the context, collect questions, or use an idea board to gather suggestions before you narrow the options.",
      },
      {
        title: "Close with a next step",
        description:
          "Discuss the result and name one action. A self-paced Survey can collect later reflections without extending the meeting.",
      },
    ],
    useCases: [
      {
        title: "Weekly check-in",
        description: "Use an opinion poll to surface where the team needs time or support.",
      },
      {
        title: "Retrospective",
        description:
          "Collect ideas, group them manually, and use private priority voting to choose an improvement to investigate.",
      },
      {
        title: "Planning conversation",
        description:
          "Rank a shortlist where enabled, then discuss constraints that the ranking alone cannot explain.",
      },
    ],
    faqs: [
      {
        question: "Where should a team start?",
        answer:
          "Start with one focused opinion poll. The original Team meetings template collection also includes Rounds, Presentations, and a follow-up Survey that can be copied and adapted independently.",
      },
      {
        question: "Can quieter participants contribute?",
        answer:
          "Live polls, word clouds, Q&A, and idea boards provide additional ways to contribute beyond speaking aloud. Explain the session's identity and visibility settings; accountless or publicly anonymous participation does not mean organizer-blind responses.",
      },
      {
        question: "Can we reuse the meeting content?",
        answer:
          "Authorized creators can manage reusable content in the Library. Eligible organization shares can permit an independent copy of a published version; they do not grant access to the original's private results.",
      },
    ],
    featureSlugs: ["live-polls", "word-clouds", "idea-boards", "surveys"],
    demoKind: "poll",
    examplesHref: "/examples?useCase=meetings",
    takeaway: "A response pattern starts the conversation. The team still makes the decision.",
  },
  {
    slug: "education",
    title: "Teaching & learning",
    shortDescription: "Find the difficult idea while there is time to explain it.",
    outcome: "Let the answers guide your next explanation.",
    description:
      "Use a live knowledge check to find a starting point, explain the idea that needs attention, and give learners another opportunity to practice. Keep the evidence close to the teaching decision.",
    workflowTitle: "A lesson that responds to the room",
    steps: [
      {
        title: "Check before you explain",
        description:
          "Open with a short scored Round or a supported question in a Presentation. Use the initial response pattern to choose where to spend time.",
      },
      {
        title: "Respond to the difficult idea",
        description:
          "Explain a misconception, work an example, and use a supported Recovery Loop recheck to inspect the paired response evidence.",
      },
      {
        title: "Choose the next practice",
        description:
          "Review the session report and, where enabled, create practice from a published Round's main questions for a later window.",
      },
    ],
    useCases: [
      {
        title: "Retrieval at the start",
        description: "Ask a few focused questions before introducing the day's explanation.",
      },
      {
        title: "An active lecture break",
        description:
          "Pause the presentation for a supported activity and collect audience questions.",
      },
      {
        title: "Practice after class",
        description:
          "Share an eligible assignment link and inspect attempts before planning another explanation.",
      },
    ],
    faqs: [
      {
        question: "Does the Recovery Loop prove learning gains?",
        answer:
          "It provides initial and supported recheck evidence for the paired sample in a session. That can guide teaching, but does not by itself establish long-term retention, mastery, or a causal learning gain.",
      },
      {
        question: "Is this a replacement for a learning management system?",
        answer:
          "The workflows described here cover authoring, live participation, reports, and eligible practice links. They do not promise native LMS roster synchronization, gradebook return, or institution-wide single sign-on.",
      },
      {
        question: "Must every activity be competitive?",
        answer:
          "No. Unscored opinion questions, word clouds, and Q&A serve different purposes from scored quizzes. Competitive Rounds can use race and podium treatments, while opinion-only Rounds do not declare winners.",
      },
    ],
    featureSlugs: ["quizzes", "presentations", "assignments", "reports"],
    demoKind: "quiz",
    examplesHref: "/examples?type=round",
    takeaway:
      "Use the result to decide what to explain next. Keep claims within what the submitted responses show.",
  },
  {
    slug: "training",
    title: "Training & workshops",
    shortDescription: "Move from the explanation to a chance to use it.",
    outcome: "Give people a way to try the idea, not just hear it.",
    description:
      "Build a visual workshop, ask participants to make a decision, and discuss the thinking behind their answers. Bring the session forward with focused practice and a clear next step.",
    workflowTitle: "Connect the workshop to the next attempt",
    steps: [
      {
        title: "Build around a real scenario",
        description:
          "Choose an original Presentation design or a reusable Round, then adapt the examples and questions to your training goal.",
      },
      {
        title: "Let people make a choice",
        description:
          "Use a supported activity or scored Round to ask what they would do. Explain the reasoning and collect questions before moving on.",
      },
      {
        title: "Make the follow-up specific",
        description:
          "Choose a practice assignment or self-paced Survey where enabled. Review the submitted evidence and share an eligible aggregate summary with your next steps.",
      },
    ],
    useCases: [
      {
        title: "Onboarding workshop",
        description:
          "Put a common workplace decision into a question and explain the available options.",
      },
      {
        title: "Skills refresher",
        description: "Use a short Round to identify which examples deserve more time.",
      },
      {
        title: "Facilitated practice",
        description:
          "Collect ideas before the exercise and use Q&A to capture questions during it.",
      },
    ],
    faqs: [
      {
        question: "Can I start from an existing slide deck?",
        answer:
          "Supported PDF and image-set imports provide selected visual pages. Those pages do not automatically become individually editable text and objects. Native presentation layouts remain editable and can be built alongside them.",
      },
      {
        question: "How can I follow up?",
        answer:
          "Eligible workspaces can create practice from published Round main questions, collect self-paced Survey feedback, and create supported aggregate session summaries. Each workflow has its own capability and permission requirements.",
      },
      {
        question: "Does a report certify that someone is competent?",
        answer:
          "No. Reports describe submitted responses and supported session evidence. They are not professional certification, verified mastery, or proof of workplace performance.",
      },
    ],
    featureSlugs: ["presentations", "quizzes", "assignments", "reports"],
    demoKind: "presentation",
    examplesHref: "/examples?type=presentation",
    takeaway:
      "A useful follow-up names the action people can try and the support available when they do.",
  },
  {
    slug: "events",
    title: "Events & town halls",
    shortDescription: "Give the audience a role in the session.",
    outcome: "Make room for the audience in your next event.",
    description:
      "Open with a poll, invite questions as the talk unfolds, and close with a phrase people will carry away. Prepare a few deliberate audience moments around the story you want to tell.",
    workflowTitle: "Three moments that bring the room into the story",
    steps: [
      {
        title: "Open a shared question",
        description:
          "Use an opinion poll or word cloud to hear expectations. Explain how the host will use the responses and what will appear publicly.",
      },
      {
        title: "Keep questions close",
        description:
          "Enable the supported Q&A for the session, review submissions, and let participant votes help identify shared interests.",
      },
      {
        title: "Close with something useful",
        description:
          "Ask for a takeaway and explain the next step. A self-paced Survey can collect more considered feedback after the event.",
      },
    ],
    useCases: [
      {
        title: "Town hall",
        description:
          "Collect questions during an update and use a moderated queue for the discussion.",
      },
      {
        title: "Conference session",
        description: "Use one focused poll to connect the talk to the audience's experience.",
      },
      {
        title: "Community event",
        description:
          "Collect topic ideas for the next gathering and invite practical reflections afterwards.",
      },
    ],
    faqs: [
      {
        question: "Can I prepare polls and questions before the event?",
        answer:
          "Yes. Prepare and publish the supported content, review your host settings, and rehearse the participant join flow before the session. The audience still joins the particular live run you launch.",
      },
      {
        question: "Can I moderate words and questions before they appear?",
        answer:
          "Q&A has supported moderation settings. Word clouds offer live display or review-first display; review-first requires approval, reveal, and five approved respondents before public display. Choose the appropriate mode and explain it to participants.",
      },
      {
        question: "How many people can join?",
        answer:
          "Participant limits follow the workspace's plan, enabled capabilities, and deployment capacity. Check your current allowance and rehearse your intended event setup rather than assuming an unlimited audience.",
      },
    ],
    featureSlugs: ["live-polls", "live-qa", "word-clouds", "surveys"],
    demoKind: "qa",
    examplesHref: "/examples?type=presentation",
    takeaway:
      "Choose a few purposeful interactions and leave time to respond to what the audience shares.",
  },
] as const satisfies readonly PublicSolutionPage[];

export const publicSolutionNavigation = publicSolutionPages.map((page) => ({
  slug: page.slug,
  title: page.title,
  shortDescription: page.shortDescription,
  group: "By use case",
  href: `/solutions/${page.slug}`,
}));

export function getPublicSolutionPage(slug: string): PublicSolutionPage | undefined {
  return publicSolutionPages.find((page) => page.slug === slug);
}
