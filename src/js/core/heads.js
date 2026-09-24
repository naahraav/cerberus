/* Cerberus AI · core/heads
   The single source of truth for the three reviewers and the shared keyword
   sets. The reviewer rail, the live prompts, and the judging seam all read
   from here so the identity and the vocabulary cannot
   drift apart between the conversation and the score. */

(function () {
  "use strict";

  // The three reviewers. `numeral` is the signage mark; `color` is the identity
  // accent; `scoresOn` is the plain-language criterion line used in the rail.
  // `color` references the theme tokens (--ember/--flame/--moss) so each head's
  // hue follows light/dark like the rest of the page, instead of pinning one
  // hex that cannot adapt. See DESIGN.md for the palette.
  var HEADS = [
    {
      key: "scrath",
      name: "Joko",
      epithet: "Buildability",
      motto: "A good idea is an idea that can be built.",
      color: "var(--ember)",
      numeral: "I",
      scoresOn: "Buildability",
      railNote: "Can this become a working product? Joko looks for a first version someone can build and try.",
      rubric: { clarity: 0.15, feasibility: 0.65, originality: 0, risk: 0.2, market: 0 }
    },
    {
      key: "fervent",
      name: "Kowi",
      epithet: "Originality",
      motto: "Give people a reason to choose something different.",
      color: "var(--flame)",
      numeral: "II",
      scoresOn: "Originality",
      railNote: "What makes this idea its own? Kowi looks for a distinct approach with a reason behind it.",
      rubric: { clarity: 0.15, feasibility: 0, originality: 0.65, risk: 0, market: 0.2 }
    },
    {
      key: "warden",
      name: "Dodo",
      epithet: "Clarity",
      motto: "Make the idea easy for anyone to understand.",
      color: "var(--moss)",
      numeral: "III",
      scoresOn: "Clarity",
      railNote: "Can someone understand the problem and solution? Dodo asks for plain words and a clear first use.",
      rubric: { clarity: 0.7, feasibility: 0.15, originality: 0, risk: 0.15, market: 0 }
    }
  ];

  // Shared vocabulary. The pack (conversation) and the judges (scoring) read the
  // same lists so a word the chat reacts to is also a word the score reacts to.
  var KEYWORDS = {
    hype: [
      "revolution", "revolutionize", "change the world", "game changer", "game-changing",
      "metaverse", "ai for everyone", "for everyone", "the future", "disrupt", "next big thing",
      "huge market", "unlimited", "a billion", "every corner", "general ai", "world-altering"
    ],
    sensitive: [
      "doctor", "medical", "health", "diagnos", "law", "legal", "contract between people",
      "credit", "loan", "investment advice", "retirement", "tax", "immigration", "id card",
      "identity document", "passport", "therapy"
    ],
    pain: ["frustrat", "lose", "waste", "hate", "stuck", "forgot", "forget", "lost", "miss", "confus"],
    niche: [
      "farm", "studio", "landlord", "teammate", "roommate", "club", "guilde", "guild", "band",
      "museum", "market stall", "food truck", "workshop", "referee", "coach", "tailor", "bakery",
      "repair", "bike", "camera", "scout", "arbitration"
    ]
  };

  // Which plain criterion each reviewer judges, keyed for the score dials.
  var ANALYSIS_LABELS = {
    clarity: "Clarity",
    feasibility: "Buildability",
    originality: "Originality",
    risk: "Risk",
    market: "Market pull"
  };

  function byKey(key) {
    for (var i = 0; i < HEADS.length; i++) {
      if (HEADS[i].key === key) {
        return HEADS[i];
      }
    }
    return null;
  }

  // A frozen, display-only projection. Callers that only need identity use this
  // so they cannot accidentally mutate the canonical rubrics.
  var DISPLAY_HEADS = HEADS.map(function (head) {
    return Object.freeze({
      key: head.key,
      name: head.name,
      epithet: head.epithet,
      motto: head.motto,
      color: head.color,
      numeral: head.numeral,
      scoresOn: head.scoresOn,
      railNote: head.railNote
    });
  });

  window.CerberusHeads = Object.freeze({
    all: DISPLAY_HEADS,
    byKey: byKey,
    keywords: KEYWORDS,
    analysisLabels: ANALYSIS_LABELS
  });
})();
