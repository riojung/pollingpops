export interface PublicResource {
  slug: string;
  title: string;
  summary: string;
  category: string;
  minutes: number;
  introduction: string;
  takeaway: string;
  sections: Array<{
    title: string;
    paragraphs: string[];
    steps?: string[];
  }>;
  links: Array<{ label: string; href: string }>;
}

/** Original English public guidance. These guides contain no workspace or participant data. */
export const publicResources: readonly PublicResource[] = [
  {
    slug: "getting-started",
    title: "Your first Round, from idea to room",
    summary:
      "Choose a format, prepare a small activity and invite your audience with a code, link or QR.",
    category: "Get started",
    minutes: 5,
    introduction:
      "Start with one question you want the group to consider. A short, clear activity gives you room to learn the controls and respond to what people say.",
    takeaway:
      "Create a draft, review it, publish a version and then host. Each step has a distinct purpose.",
    sections: [
      {
        title: "Choose the format for the moment",
        paragraphs: [
          "Use a live poll to gather opinions while you guide the pace. Choose a live quiz for knowledge checks with correct answers, explanations and optional competition. A custom Round can combine supported question formats.",
          "Choose a Presentation when slides and audience activities belong together. Choose a Survey when people should answer independently over time. Boards give a workshop a space for ideas and priorities. Available formats depend on your workspace.",
        ],
      },
      {
        title: "Make a small, useful draft",
        paragraphs: [
          "Sign in as a creator and choose Create. Start blank or preview an original template before making an independent copy. Adapt its wording, answer choices and guidance to your own group.",
          "For a knowledge check, write an explanation that teaches the reasoning. For an opinion, include realistic alternatives and room for uncertainty. Wait for Saved, preview the activity and resolve any required fixes before publishing.",
        ],
        steps: [
          "Write one clear prompt and complete response choices.",
          "Review timing, scoring and visibility where those controls apply.",
          "Preview the participant experience, then publish when ready.",
        ],
      },
      {
        title: "Publish, host and invite",
        paragraphs: [
          "Publishing creates the version used for delivery. Later draft edits do not change a running room; publish again when you want those edits available for a new session.",
          "Choose Host, review the session settings and share its code, direct link or QR. Participants join without creator accounts. Keep your host tab available and use the separate presenter display when you want a clean audience screen.",
          "During the activity, wait for responses, close or reveal the question with the available controls and make time to discuss the result. An opinion distribution starts a conversation; it does not make the decision for the group.",
        ],
      },
    ],
    links: [
      { label: "Browse original examples", href: "/examples" },
      { label: "Explore live polls", href: "/product/live-polls" },
      { label: "Start creating", href: "/signin?returnTo=%2Fcreate" },
    ],
  },
  {
    slug: "joining-a-round",
    title: "Join a live Round and stay in sync",
    summary:
      "Find the right room, submit an answer and understand what happens when the connection pauses.",
    category: "For participants",
    minutes: 3,
    introduction:
      "You do not need a creator account to join an audience activity. Your facilitator supplies the room code, direct link or QR and controls the live question flow.",
    takeaway:
      "A selected answer becomes a saved answer only when the screen confirms that it was received.",
    sections: [
      {
        title: "Use the invitation from your facilitator",
        paragraphs: [
          "Open Join and enter the room code, or follow the direct link or QR. If the session uses a password, enter the one supplied by your facilitator. Choose a nickname when offered, or use the generated option.",
          "A Survey does not ask for a nickname. Other activities can have different entry rules, so follow the instructions on the screen you receive. If a code is closed, expired or admission is locked, ask the facilitator to check the session.",
        ],
      },
      {
        title: "Answer and look for confirmation",
        paragraphs: [
          "Read the current prompt and choose or enter your response. Some formats require an explicit Submit response action. Wait for the saved confirmation before moving away from the page.",
          "Saving or reconnecting means confirmation is still pending. Keep the tab open while it recovers. A timer reaching zero, a highlighted option or a lost connection does not mean the answer was accepted.",
          "The facilitator decides when a live question closes and when results appear. Polls, rankings and word clouds are opinions with no correct answer or quiz points.",
        ],
      },
      {
        title: "Take part in the conversation",
        paragraphs: [
          "If Q&A is enabled, ask a relevant question and vote for one you also want answered. Moderated questions may wait for review before appearing to the room. Anonymous public display does not hide your session alias from the facilitator.",
          "On the same browser, an accepted live response can be restored after refresh while your session access remains valid. Clearing site data or switching devices can lose that resume access. For a Survey, use its Save progress or page navigation controls and return in the same browser.",
          "Use local reduced-motion, high-contrast or sound preferences when helpful. These choices affect your screen without changing another participant’s view.",
        ],
      },
    ],
    links: [
      { label: "Enter a room code", href: "/join" },
      { label: "Learn about audience Q&A", href: "/product/live-qa" },
      { label: "Read the privacy notice", href: "/privacy" },
    ],
  },
  {
    slug: "rechecks-and-follow-up",
    title: "Use a recheck to decide what comes next",
    summary:
      "Connect a knowledge check, a useful explanation and a second question without overstating the result.",
    category: "Facilitation",
    minutes: 4,
    introduction:
      "A wrong answer can show you where to spend the next few minutes. A linked recheck lets you ask a related question after discussion or an explanation and inspect what changed within that session.",
    takeaway:
      "Use the first check to choose an intervention, and the recheck to examine the next response. Keep the paired sample visible.",
    sections: [
      {
        title: "Prepare two questions with different jobs",
        paragraphs: [
          "The main question should expose a meaningful distinction or common misconception. Give each choice a clear purpose and add an explanation that helps someone reason through the problem.",
          "Link a recheck that asks learners to apply the same idea in another situation. Simply repeating the wording can test recognition of the answer rather than transfer to a new example. Review the answer key and explanation for both questions before publishing.",
        ],
      },
      {
        title: "Respond to the evidence in the room",
        paragraphs: [
          "Close the main question and inspect the available participation, correctness, misconception and optional confidence signals. Read the sample and thresholds beside an insight rather than treating a recommendation as an automatic judgment.",
          "Invite discussion, explain the distinction or demonstrate a worked example. Then run the linked recheck. When there is no linked question, a same-question revote is available in the supported flow; its result is labelled separately from linked recovery.",
        ],
        steps: [
          "Ask and close the main knowledge check.",
          "Choose an explanation, example or discussion that addresses what you saw.",
          "Run the linked recheck and review its paired evidence.",
        ],
      },
      {
        title: "Follow up without making a bigger claim",
        paragraphs: [
          "Linked recovery considers participants who were initially incorrect and also answered the linked recheck. Read its numerator, denominator and small-sample notice together. People who did not complete both checks are outside that paired measure.",
          "A correct recheck is evidence from this session. It does not establish long-term learning or prove that a particular explanation caused the change. Use unresolved concepts to plan the next lesson, discussion or eligible accountless follow-up.",
          "Standalone Round assignments use the published main questions. Linked rechecks remain conditional Recovery Loop material rather than being added automatically as ordinary practice questions.",
        ],
      },
    ],
    links: [
      { label: "Explore quizzes", href: "/product/quizzes" },
      { label: "Understand report measures", href: "/resources/understanding-reports" },
      { label: "Explore assignments", href: "/product/assignments" },
    ],
  },
  {
    slug: "understanding-reports",
    title: "Read results with the right denominator",
    summary:
      "Distinguish responses, opinions, attempts and paired recovery before drawing a conclusion.",
    category: "Results",
    minutes: 5,
    introduction:
      "A report is most useful when you know what was counted. Start with the session context and coverage, then inspect the question or paired result that matters to your next decision.",
    takeaway: "Missing evidence, a hidden small sample and a measured zero mean different things.",
    sections: [
      {
        title: "Start with coverage and scope",
        paragraphs: [
          "Check the activity, publication and session you are reviewing. Look at response coverage before interpreting accuracy. A question response count is not a unique-person attendance count, and totals across sessions do not identify unique learners.",
          "For Presentation insights, delivery tells you which blocks were presented, skipped or not recorded. Elapsed time is wall-clock time. Viewing a slide or acknowledging a reading page does not establish understanding.",
          "Results-page widgets summarize the records currently shown under the active filters. Loading more records can change that scope. Open an individual report when you need its denominators and question-level detail.",
        ],
      },
      {
        title: "Keep different measures distinct",
        paragraphs: [
          "Scored questions can support correctness and knowledge-check evidence. Opinion polls, rankings, ratings and word clouds remain unscored. A popular opinion is not an accuracy result or proof of agreement.",
          "Multiple-selection poll percentages use respondents as the denominator, so percentages can total more than 100%. Ranking weights summarize submitted priorities and are not participant quiz points.",
          "Linked recovery uses initially incorrect participants who answered both checks. A same-question revote is a different measure. Practice completion counts attempts and should not be relabelled as verified people or mastery.",
        ],
      },
      {
        title: "Respect missing and withheld evidence",
        paragraphs: [
          "When a report says Not recorded or No evidence, do not substitute a zero. Small-sample suppression protects results from being shown when the applicable minimum is not met. Different report sections can therefore have different available samples.",
          "Survey distributions appear only after collection closes and each question has at least five finalized answers. Optional unanswered items do not count toward that question’s minimum, and organizers cannot inspect linked respondent answer sets.",
          "Where permitted, exports and shared summaries provide deliberate copies of the available evidence. Aggregate shared summaries exclude participant names, submitted text, word-cloud terms and transcripts. Revoking a link cannot remove a file someone already downloaded.",
        ],
      },
    ],
    links: [
      { label: "Explore reports", href: "/product/reports" },
      { label: "Plan a linked recheck", href: "/resources/rechecks-and-follow-up" },
      { label: "Learn about Surveys", href: "/product/surveys" },
    ],
  },
  {
    slug: "feature-availability",
    title: "Find the right tools for your workspace",
    summary:
      "Understand how workspace access, enabled features and optional services shape what you can use.",
    category: "Workspace",
    minutes: 3,
    introduction:
      "Public product pages describe supported workflows. The actions available in your workspace also depend on your role, enabled features, plan access and the services configured for that deployment.",
    takeaway:
      "Use the controls and availability messages in your active workspace as the guide to what you can create or launch.",
    sections: [
      {
        title: "Check your active workspace and role",
        paragraphs: [
          "Owners and editors can create and manage eligible content. Viewers can review authorized content and results. Belonging to an organization or group does not automatically make you an editor in another workspace.",
          "An organization Library publication can be shared as Can view or Can use. Can use permits an independent copy only when you also have a suitable destination workspace, role and license. It does not give you access to the original’s responses or results.",
        ],
      },
      {
        title: "Expect formats to have their own scope",
        paragraphs: [
          "Enabled live Rounds can include rankings, open text and word clouds. Surveys currently collect polls and ratings; those live formats are not automatically Survey question types.",
          "Ordered Survey pages are available only when the separate Survey pages capability is granted. Conditional branching authoring and conditional results are not available. Presentation activities, live delivery and canvas collaboration also depend on their relevant workspace capabilities.",
          "A paused creation capability may still let you review or manage retained content. The availability message beside the action explains which step is affected; it is not permission to bypass the existing workflow.",
        ],
      },
      {
        title: "Treat AI and imports as optional starting points",
        paragraphs: [
          "Ordinary blank creation and original templates do not require AI. Structured Round import uses supported JSON, CSV, bulk text or QTI input and presents a review before creating a draft.",
          "AI assistance requires an operator-configured provider and available allowance. Review proposals and source excerpts before inserting or applying them. Generation does not publish content, and an unavailable AI service does not disable ordinary editing.",
          "Presentation visual import converts supported PDF pages or images into slide visuals with a reading version. It does not preserve individually editable source objects, animation or active media. Check the conversion report before inserting pages.",
        ],
      },
    ],
    links: [
      { label: "Explore collaboration", href: "/product/collaboration" },
      { label: "Preview original examples", href: "/examples" },
      { label: "View the current status page", href: "/status" },
    ],
  },
  {
    slug: "data-and-access-controls",
    title: "Keep access and shared data intentional",
    summary:
      "Know who can see an activity, what a shared link permits and where to find data controls.",
    category: "Workspace",
    minutes: 4,
    introduction:
      "Creator accounts, guest participation and shared publications use different access paths. Choose the one that matches the audience and share only the access needed for the activity.",
    takeaway:
      "A room code, a private practice link and an organization publication are different invitations with different permissions.",
    sections: [
      {
        title: "Explain visibility before asking",
        paragraphs: [
          "Participants join live activities without creator accounts, but accountless does not mean organizer-blind. Facilitators can see session aliases in moderated audience tools even when the room sees Anonymous.",
          "Live word clouds can show public aggregates from the first contribution when Build cloud live is selected. Use the review-first option when appropriate and ask people to avoid private information. Surveys use their separate question-level aggregate rules.",
          "Choose result visibility and moderation settings before the session. A separate presenter credential provides the audience display without sharing your host controls.",
        ],
      },
      {
        title: "Share the intended version and permission",
        paragraphs: [
          "Organization Library sharing publishes a deliberate snapshot, either organization-wide or to selected eligible members. Can view allows reading; Can use can also permit an independent draft copy. Later draft changes do not silently replace that shared version.",
          "A review-by date helps recipients follow up; it is not an access-expiration rule or an automatic reminder. Revoking a publication stops future access through that share, while copies already created remain independent.",
          "Treat personal practice links and other bearer links as access credentials. Save and distribute them carefully. Use the supported management controls to revoke a link or close an activity when access should end.",
        ],
      },
      {
        title: "Use the relevant management controls",
        paragraphs: [
          "Authorized owners can delete session and report history through the activity’s management controls. Account controls provide account data export and account deletion. Retention depends on the activity and deployment; inspect the deadline shown for the record you are managing.",
          "Exported files are deliberate copies. Expiring or revoking a shared link cannot recall a previously downloaded file. Review a summary’s contents and any next-step text before creating a link.",
          "Read the current privacy notice and terms, including any draft or pre-release labels displayed there. This guide describes product controls; it does not establish legal or institutional approval.",
        ],
      },
    ],
    links: [
      { label: "Read the privacy notice", href: "/privacy" },
      { label: "Read the terms", href: "/terms" },
      { label: "Open account controls", href: "/signin?returnTo=%2Faccount" },
    ],
  },
];

export function getPublicResource(slug: string) {
  return publicResources.find((resource) => resource.slug === slug);
}
