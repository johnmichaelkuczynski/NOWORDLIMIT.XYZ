# Text Surgeon - Project Structure

```
text-surgeon/
│
├── client/                          # FRONTEND (React + Vite)
│   └── src/
│       ├── main.tsx                 # App entry point, renders React root
│       ├── App.tsx                  # Router setup (wouter), defines page routes
│       │
│       ├── pages/
│       │   ├── Home.tsx             # MAIN APP - All analysis features, text input,
│       │   │                        # Intelligence Meter, Position Extractor, Quote Finder,
│       │   │                        # Stylometrics, Arguments Finder, Tractatus Rewrite,
│       │   │                        # Full Document Rewrite, Custom Analysis
│       │   │                        # (~6500 lines - the heart of the UI)
│       │   │
│       │   ├── PaymentSuccess.tsx   # Stripe payment success redirect page
│       │   └── not-found.tsx        # 404 page
│       │
│       ├── lib/
│       │   ├── store.ts             # Zustand global state (API keys, credits, auth)
│       │   ├── llm.ts               # Client-side LLM provider configuration
│       │   ├── queryClient.ts       # React Query setup for server state
│       │   └── utils.ts             # Utility functions (cn, formatting)
│       │
│       ├── hooks/
│       │   ├── use-toast.ts         # Toast notification hook
│       │   └── use-mobile.tsx       # Mobile detection hook
│       │
│       └── components/ui/           # shadcn/ui components (Radix primitives)
│           ├── button.tsx           # Button component
│           ├── dialog.tsx           # Modal dialogs
│           ├── tabs.tsx             # Tab navigation
│           ├── scroll-area.tsx      # Scrollable containers
│           ├── select.tsx           # Dropdown selects
│           ├── textarea.tsx         # Text input areas
│           ├── badge.tsx            # Status badges
│           ├── card.tsx             # Card containers
│           ├── toast.tsx            # Toast notifications
│           └── ... (50+ UI primitives)
│
├── server/                          # BACKEND (Express + Node.js)
│   ├── index-dev.ts                 # Dev server entry (with Vite middleware)
│   ├── index-prod.ts                # Production server entry (static files)
│   ├── app.ts                       # Express app configuration, middleware
│   ├── auth.ts                      # Google OAuth authentication, session management
│   ├── routes.ts                    # API endpoints (~2400 lines)
│   │                                # - /api/analyze/stream (streaming LLM analysis)
│   │                                # - /api/positions/extract/stream
│   │                                # - /api/quotes/extract/stream  
│   │                                # - /api/arguments/extract/stream
│   │                                # - /api/intelligence/stream
│   │                                # - /api/stylometrics/* 
│   │                                # - /api/auth/* (Google OAuth)
│   │                                # - /api/credits, /api/checkout
│   │                                # - /api/webhook/stripe
│   │
│   ├── llm.ts                       # LLM PROVIDER ABSTRACTION
│   │                                # Unified interface for 5 providers:
│   │                                # - Grok (Zhi 1) - xAI
│   │                                # - OpenAI (Zhi 2) - GPT-4o
│   │                                # - Anthropic (Zhi 3) - Claude
│   │                                # - Perplexity (Zhi 4)
│   │                                # - DeepSeek (Zhi 5)
│   │
│   ├── storage.ts                   # Database interface (Drizzle ORM)
│   │                                # CRUD for users, analysis history, credits,
│   │                                # corpus data, stylometric profiles
│   │
│   ├── db.ts                        # PostgreSQL connection (Neon serverless)
│   │
│   ├── stylometrics.ts              # Legacy stylometrics computations
│   │
│   └── services/                    # ANALYSIS ENGINES (the brains)
│       │
│       ├── intelligenceAnalyzer.ts  # INTELLIGENCE METER
│       │                            # Signal-to-noise ratio analysis
│       │                            # Extracts genuine insights vs. filler
│       │                            # Scores 0-100 based on insight density
│       │
│       ├── positionExtractor.ts     # POSITION EXTRACTOR
│       │                            # Extracts author positions/claims
│       │                            # Outline-based holistic extraction
│       │                            # 5-15 positions per section
│       │
│       ├── quoteExtractor.ts        # QUOTE FINDER
│       │                            # Verbatim quote extraction
│       │                            # Configurable depth (1-10)
│       │
│       ├── argumentExtractor.ts     # ARGUMENTS FINDER
│       │                            # Formal argument extraction
│       │                            # Premises, conclusions, counterarguments
│       │
│       ├── outlineService.ts        # DOCUMENT OUTLINE GENERATOR
│       │                            # Structural analysis of large texts
│       │                            # Creates section map for holistic processing
│       │
│       ├── tractatusRewrite.ts      # TRACTATUS REWRITE
│       │                            # Converts text to Wittgenstein-style
│       │                            # numbered bullet propositions
│       │
│       ├── customAnalyzer.ts        # CUSTOM ANALYSIS
│       │                            # User-defined analysis instructions
│       │                            # Flexible LLM prompting
│       │
│       ├── stylometricsHolistic.ts  # STYLOMETRICS (Holistic Mode)
│       │                            # Author fingerprinting
│       │                            # Verticality scores, author clustering
│       │
│       ├── stripe.ts                # PAYMENT PROCESSING
│       │                            # Stripe checkout, webhooks
│       │                            # Credit purchase & deduction
│       │                            # Provider-specific pricing
│       │
│       └── fileParser.ts            # FILE UPLOAD HANDLING
│                                    # PDF & Word document parsing
│
├── shared/
│   └── schema.ts                    # DATABASE SCHEMA (Drizzle + Zod)
│                                    # - users (auth, credits, Google ID)
│                                    # - analysis_history
│                                    # - corpus_authors, corpus_works
│                                    # - stylometric_authors
│                                    # - sessions (PostgreSQL sessions)
│
├── drizzle.config.ts                # Drizzle ORM configuration
├── vite.config.ts                   # Vite bundler configuration  
├── tsconfig.json                    # TypeScript configuration
├── package.json                     # Dependencies & scripts
└── replit.md                        # Project documentation & architecture notes
```

## Data Flow

```
User Input (Text/PDF/Word)
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                     Home.tsx (Frontend)                      │
│  - Text input area                                          │
│  - Provider selection (Grok/OpenAI/Anthropic/etc.)          │
│  - Analysis function selection                              │
│  - Results display with copy/download                       │
└─────────────────────────────────────────────────────────────┘
         │
         │ SSE Stream / REST API
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    routes.ts (API Layer)                     │
│  - Request validation                                        │
│  - Authentication check                                      │
│  - Credit verification & deduction                           │
│  - History saving                                            │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│               Analysis Services (server/services/)           │
│  - intelligenceAnalyzer.ts  → Signal/noise measurement      │
│  - positionExtractor.ts     → Claim extraction              │
│  - quoteExtractor.ts        → Quote finding                 │
│  - argumentExtractor.ts     → Argument structure            │
│  - tractatusRewrite.ts      → Proposition formatting        │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                      llm.ts (LLM Layer)                      │
│  Unified interface to 5 providers:                          │
│  - Grok (xAI)         - grok-3-latest                       │
│  - OpenAI             - gpt-4o                              │
│  - Anthropic          - claude-3-5-sonnet                   │
│  - Perplexity         - llama-3.1-sonar                     │
│  - DeepSeek           - deepseek-chat                       │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                   storage.ts (Database)                      │
│  PostgreSQL via Drizzle ORM:                                │
│  - User accounts & credits                                  │
│  - Analysis history                                         │
│  - Stylometric profiles                                     │
│  - Corpus data                                              │
└─────────────────────────────────────────────────────────────┘
```

## Key Analysis Functions

| Function | Service File | Purpose |
|----------|-------------|---------|
| Intelligence Meter | `intelligenceAnalyzer.ts` | Measures insight density, filters jargon |
| Position Extractor | `positionExtractor.ts` | Finds author claims & positions |
| Quote Finder | `quoteExtractor.ts` | Extracts verbatim quotations |
| Arguments Finder | `argumentExtractor.ts` | Maps formal argument structure |
| Tractatus Rewrite | `tractatusRewrite.ts` | Converts to numbered propositions |
| Stylometrics | `stylometricsHolistic.ts` | Author fingerprinting & comparison |
| Custom Analysis | `customAnalyzer.ts` | User-defined analysis prompts |
| Document Outline | `outlineService.ts` | Structural text mapping |

## Authentication & Payments

- **Auth**: Google OAuth via `server/auth.ts`, PostgreSQL sessions
- **Credits**: Purchased via Stripe, stored in `users.credits` column
- **Pricing**: Provider-specific rates in `server/services/stripe.ts`
- **Webhook**: `/api/webhook/stripe` handles payment confirmations
