# No Word Limit

## Overview
Text Intelligence Studio is a web application designed for advanced text analysis using multiple Large Language Model (LLM) providers. It processes text documents to produce structured outputs such as extracted quotes, annotated quotes, compressed summaries, and database representations. The application supports various analysis functions, including intelligence metering, comparison, major view identification, and a quote finder, alongside a corpus management system. Its core purpose is to provide users with comprehensive tools for extracting, organizing, and analyzing information from extensive textual data.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **Routing**: Wouter.
- **State Management**: Zustand (global, localStorage persistence for API keys) and React Query (server state).
- **UI**: shadcn/ui (Radix UI, Tailwind CSS with "new-york" style), custom fonts (Inter, Crimson Pro, JetBrains Mono), responsive design.
- **Form Handling**: React Hook Form with Zod validation.

### Backend
- **Server**: Express.js with TypeScript on Node.js.
- **Environment**: Vite's middleware for development (HMR); serves static assets in production.
- **API**: REST API, primarily `POST /api/analyze` for text analysis.
- **LLM Integration**: Abstracted service layer (`server/llm.ts`) supporting multiple providers (OpenAI, Anthropic, Grok, Perplexity, DeepSeek) with enforced structured JSON output.
- **Error Handling**: Centralized with descriptive messages.

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM.
- **Schema**: Type-safe schema in `shared/schema.ts` for users and corpus data.
- **Migrations**: Drizzle Kit.
- **Fallback**: In-memory MemStorage for development.
- **Connection**: Neon serverless driver (changed to neon-http for Replit stability).

### Architecture Decisions
- **Monorepo**: Single repository for client, server, and shared code, ensuring type safety and code reuse via TypeScript path aliases.
- **Type Safety**: End-to-end TypeScript with strict mode and shared Drizzle-Zod schemas.
- **Build**: Vite (frontend) and esbuild (backend) for fast, modern builds.
- **Session Management**: Connect-pg-simple for PostgreSQL-backed session storage.

### Core Features & Design Principles
- **Analysis Functions**: Clean Quotation List, Annotated Quotes, Paragraph Compression, 15-Section Database, Text Analyzer, Stylometrics, Intelligence Meter, Compare Intelligence, Identify Major Views, Quote Finder, Position Extractor, Full Document Rewrite, Tractatus Rewrite, Arguments Finder.
- **Position Extractor**: Outline-based holistic extraction with SSE streaming. User specifies author name before extraction. Extracts 5-15 positions per section, sorted by section order then importance. "Show All (even minor)" toggle with preserved numbering. Uses `server/services/positionExtractor.ts` and `server/services/outlineService.ts`.
- **Tractatus Rewrite**: Converts texts into series of one-line bullet-point statements (Wittgenstein's Tractatus style). Supports outline mode for large texts, optional bullet markers. Uses `server/services/tractatusRewrite.ts` with SSE streaming.
- **Tractatus Tree**: Multi-level abstraction view with hierarchical numbered statements. User can enter custom document title before generation. Download options: Text (.txt) and Word (.docx) with clean formatting - Heading 1 for title, Heading 2 for level sections (Level 1, Level 2, etc.), proper indentation based on statement depth. Uses `server/services/tractatusTree.ts`.
- **Arguments Finder**: Extracts formal arguments with premises, conclusions, and counterarguments. Configurable extraction depth (1-10), outline mode for holistic analysis. Uses `server/services/argumentExtractor.ts`.
- **Full Document Rewrite**: Outline-guided section-by-section rewriting with SSE streaming, customizable instructions, "Show Outline First" toggle.
- **Structured Summary**: Generates summaries at adjustable resolution levels (lowest = 1-2 paragraphs for entire work, highest = per-subsection). Toggle between formal section recognition (only explicit headings) and content-based recognition (identifies thematic divisions). Uses `server/services/summaryService.ts` with SSE streaming.
- **Multi-Chunk Processing ("All Day Mode")**: Automated splitting and processing of large texts (40,000+ words) with delayed chunk processing and incremental saving.
- **Coherent Processing System (NEW)**: For documents ≥2000 words, uses `server/services/coherent/` infrastructure with state-tracked generation. Pattern A (Full Rewrite, Tractatus) maintains coherence state across chunks; Pattern B (Positions, Quotes, Arguments) uses skeleton-first extraction. 8 coherence modes: logical-consistency, logical-cohesiveness, scientific-explanatory, thematic-psychological, instructional, motivational, mathematical, philosophical. Database tables: `coherence_documents`, `coherence_chunks`, `document_skeletons`. Router (`router.ts`) automatically routes based on word count threshold.
- **Corpus Manager**: Admin UI for building an internal author corpus database (`corpus_authors`, `corpus_works`, `work_sections`) with full-text search.
- **Stability**: Defensive null checks, `COPY NOW`/`DOWNLOAD NOW` during processing, history auto-loading, and safe report generation.
- **Determinism**: All LLM providers use `temperature=0` for consistent output.
- **Authentication**: Username-only.
- **Verbatim Quotes**: LLM prompts require word-for-word extraction.

## External Dependencies

### Third-Party Services
- **LLM Providers**: OpenAI (GPT-4o), Anthropic, Grok (grok-3-latest), Perplexity, DeepSeek. API keys managed via client-side localStorage and passed to the server.

### Database
- **PostgreSQL**: Accessed via `@neondatabase/serverless` (specifically `neon-http`) using a `DATABASE_URL` environment variable.

### External Libraries
- **UI Components**: Radix UI, Lucide React, Embla Carousel, cmdk, clsx, tailwind-merge, class-variance-authority.
- **Utilities**: date-fns, nanoid.
- **Document Generation**: docx (Word document generation), file-saver (file downloads).
- **Development Tools**: Replit-specific Vite plugins (runtime error modal, cartographer, dev banner), custom meta images plugin.

## Recent Changes (February 2026)
- **App Renamed**: Changed from "Text Intelligence Studio" to "No Word Limit".
- **Long Answer Mode**: New feature generating massive coherent answers (up to 100K words) using 2-phase skeleton+fill architecture with rolling memory summarization. Service: `server/services/longAnswerService.ts`. Endpoint: `POST /api/longanswer/stream` (SSE). UI: Long Answer dialog in Home.tsx with provider selector, mode toggle, word count target.
- **Pure Mode**: Primary-source-only evaluation mode. Extracts entities from prompt, retrieves corpus chunks from existing DB tables (`corpus_authors`, `corpus_works`, `work_sections`), builds source packet, and constrains LLM to quote only from uploaded material. Refuses if no texts exist. Service: `server/services/pureAnswerService.ts`. Integrated with Long Answer mode via mode toggle.
- **Corpus Upload Endpoints**: `POST /api/corpus/upload` (permanent) and `POST /api/corpus/upload-adhoc` (session-only) for uploading primary source texts for Pure mode.
- **Tractatus Tree Word Download**: Added Word (.docx) export with clean formatting - custom title as H1, levels as H2, numbered statements with proper indentation.
- **Custom Title Input**: Users can enter document title before generating Tractatus Tree.
- **Level Naming**: Changed from "Top Level/Full Detail" to consistent "Level 1, Level 2, Level 3..." naming.
- **Full Rewrite Expansion Fix**: Improved expansion logic with retry mechanism (up to 4 attempts) when target word count not met.
- **Paywall Implementation**: 750-word limit paywall on all analysis outputs for non-paying users; bypassed in Replit development environment.
- **Resizable Dialog Fix**: Fixed dragging functionality for resizable dialogs.