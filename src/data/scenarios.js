const scenarios = [
  {
    id: "civic-viral-risk",
    name: "Civic rumor with fast spread",
    description: "A high-reach post makes an unverified public procedure claim and is accelerating quickly.",
    postText:
      "Breaking: polling locations changed tonight in several districts. Repost before they hide it. No official source yet, but everyone needs to know.",
    author: {
      handle: "@citywatch_now",
      accountAgeDays: 46,
      followerCount: 42000,
      verified: false,
      priorViolations: 1
    },
    metrics: {
      minutesSincePosted: 18,
      likes: 3100,
      shares: 2600,
      replies: 780,
      reports: 61
    },
    context: {
      topic: "election",
      eventWindow: "active",
      region: "demo-region",
      language: "en",
      mediaType: "text"
    }
  },
  {
    id: "health-claim",
    name: "Unsupported medical claim",
    description: "A health claim promises a cure and discourages professional support.",
    postText:
      "This secret supplement cures serious illness overnight. Skip doctors and share this before the pharma companies bury it.",
    author: {
      handle: "@wellness_flash",
      accountAgeDays: 14,
      followerCount: 9800,
      verified: false,
      priorViolations: 2
    },
    metrics: {
      minutesSincePosted: 34,
      likes: 1550,
      shares: 1320,
      replies: 240,
      reports: 42
    },
    context: {
      topic: "health",
      eventWindow: "normal",
      region: "demo-region",
      language: "en",
      mediaType: "text"
    }
  },
  {
    id: "bot-amplified-slogan",
    name: "Coordinated amplification",
    description: "The content is moderate by itself, but engagement patterns look coordinated.",
    postText:
      "Everyone reply with the exact same phrase and repost this at the top of every hour so it trends by morning.",
    author: {
      handle: "@trendpush_group",
      accountAgeDays: 9,
      followerCount: 1800,
      verified: false,
      priorViolations: 0
    },
    metrics: {
      minutesSincePosted: 12,
      likes: 210,
      shares: 930,
      replies: 610,
      reports: 18
    },
    context: {
      topic: "general",
      eventWindow: "active",
      region: "demo-region",
      language: "en",
      mediaType: "text",
      synchronizedSignals: true
    }
  },
  {
    id: "safe-product-news",
    name: "Safe product update",
    description: "A normal announcement with modest reach and no policy-sensitive claims.",
    postText:
      "Our design team shipped a new accessibility-friendly settings panel today. Release notes and screenshots are available in the public changelog.",
    author: {
      handle: "@contoso_design",
      accountAgeDays: 1200,
      followerCount: 25000,
      verified: true,
      priorViolations: 0
    },
    metrics: {
      minutesSincePosted: 80,
      likes: 760,
      shares: 120,
      replies: 44,
      reports: 0
    },
    context: {
      topic: "product",
      eventWindow: "normal",
      region: "demo-region",
      language: "en",
      mediaType: "text"
    }
  },
  {
    id: "doxxing-attack",
    name: "Privacy — doxxing attempt",
    description: "A post exposes private contact information and calls for targeted harassment.",
    postText:
      "Here is their home address: 42 Maple St, and phone number +1 (555) 867-5309. Everyone show up and make them pay for what they did. Hunt them down and expose them.",
    author: {
      handle: "@anon_expose99",
      accountAgeDays: 3,
      followerCount: 620,
      verified: false,
      priorViolations: 0
    },
    metrics: {
      minutesSincePosted: 6,
      likes: 88,
      shares: 340,
      replies: 210,
      reports: 74
    },
    context: {
      topic: "general",
      eventWindow: "normal",
      region: "demo-region",
      language: "en",
      mediaType: "text"
    }
  },
  {
    id: "election-fraud-hoax",
    name: "Election fraud hoax — viral scale",
    description: "A high-reach account posts an election fraud claim at viral velocity during an active event window.",
    postText:
      "BREAKING: Stolen election confirmed — ballot dump just happened in three swing states. Dead voters cast ballots. Mainstream media won't report this. Share before they censor it.",
    author: {
      handle: "@patriot_alerts",
      accountAgeDays: 280,
      followerCount: 185000,
      verified: false,
      priorViolations: 3
    },
    metrics: {
      minutesSincePosted: 9,
      likes: 14200,
      shares: 9800,
      replies: 3400,
      reports: 520
    },
    context: {
      topic: "election",
      eventWindow: "active",
      region: "demo-region",
      language: "en",
      mediaType: "text"
    }
  },
  {
    id: "borderline-opinion",
    name: "Borderline strong opinion — correctly allowed",
    description: "A strongly-worded political opinion with no misinformation signals. Should be allowed.",
    postText:
      "The new infrastructure bill is a complete waste of taxpayer money and should be repealed immediately. Politicians are out of touch with working families.",
    author: {
      handle: "@local_opinion_hub",
      accountAgeDays: 840,
      followerCount: 5400,
      verified: false,
      priorViolations: 0
    },
    metrics: {
      minutesSincePosted: 45,
      likes: 380,
      shares: 92,
      replies: 68,
      reports: 2
    },
    context: {
      topic: "general",
      eventWindow: "normal",
      region: "demo-region",
      language: "en",
      mediaType: "text"
    }
  },
  {
    id: "health-hoax-mass-reach",
    name: "Health hoax — mass reach, urgent spread",
    description: "A miracle-cure hoax is spreading rapidly from a large account urging people to avoid doctors.",
    postText:
      "Urgent: doctors won't tell you this — a natural remedy cures cancer overnight. Big pharma is suppressing it. Share immediately before they remove this.",
    author: {
      handle: "@health_truth_now",
      accountAgeDays: 62,
      followerCount: 78000,
      verified: false,
      priorViolations: 1
    },
    metrics: {
      minutesSincePosted: 22,
      likes: 5600,
      shares: 4100,
      replies: 890,
      reports: 97
    },
    context: {
      topic: "health",
      eventWindow: "normal",
      region: "demo-region",
      language: "en",
      mediaType: "text"
    }
  }
];

module.exports = { scenarios };
