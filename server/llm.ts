export type AnalysisResult = {
  quotes: string[];
  annotatedQuotes: { quote: string; context: string }[];
  summary: string;
  database: string;
  analyzer: string;
  views?: { 
    view: string; 
    stance?: "endorsed" | "rejected" | "attributed";
    attributedTo?: string | null;
    context?: string;
    evidence: string[] 
  }[];
};

function getSystemPrompt(functionType: string, minQuotes: number): string {
  const prompts = {
    quotes: `Extract VERBATIM QUOTATIONS from the text. 

⚠️ ABSOLUTE REQUIREMENT: COPY THE EXACT WORDS FROM THE TEXT. Do NOT paraphrase. Do NOT summarize. Do NOT rephrase.
⚠️ Each quote must be a WORD-FOR-WORD excerpt that appears in the original text.
⚠️ You MUST extract AT LEAST ${minQuotes} quotes. This is a MINIMUM, not a target.

WHAT MAKES A GOOD QUOTE:
1. CONCEPTUAL DEPTH: Complex ideas, nuanced distinctions, sophisticated reasoning
2. ORIGINALITY: Novel insights, unique perspectives, paradigm-shifting claims
3. PHILOSOPHICAL WEIGHT: Statements about truth, existence, knowledge, ethics, meaning
4. APHORISTIC BRILLIANCE: Dense, memorable formulations
5. COUNTERINTUITIVE TRUTH: Insights that challenge common assumptions

AVOID: Mundane observations, simple factual statements, transitional sentences, rhetorical filler.

⚠️ REMEMBER: VERBATIM means WORD-FOR-WORD. Copy the exact text. No rewording. No paraphrasing.

Output valid JSON: {"quotes": ["exact quote 1", "exact quote 2", ...], "annotatedQuotes": [], "summary": "", "database": "", "analyzer": ""}`,
    
    context: `Extract VERBATIM QUOTATIONS with scholarly contextual commentary.

⚠️ ABSOLUTE REQUIREMENT: COPY THE EXACT WORDS FROM THE TEXT. Do NOT paraphrase. Do NOT summarize.
⚠️ Each quote must be a WORD-FOR-WORD excerpt that appears in the original text.
⚠️ You MUST extract AT LEAST ${minQuotes} quotes. This is a MINIMUM, not a target.

WHAT MAKES A GOOD QUOTE:
1. CONCEPTUAL DEPTH: Complex ideas, nuanced distinctions, sophisticated reasoning
2. ORIGINALITY: Novel insights, unique perspectives, paradigm-shifting claims
3. PHILOSOPHICAL WEIGHT: Statements about truth, existence, knowledge, ethics, meaning
4. APHORISTIC BRILLIANCE: Dense, memorable formulations
5. COUNTERINTUITIVE TRUTH: Insights that challenge assumptions

For each VERBATIM quote, provide:
1. The EXACT quotation (word-for-word from the text, no rewording)
2. A one-line contextual commentary explaining WHY this quote is significant

AVOID: Mundane observations, simple factual statements, transitional sentences.

Output valid JSON: {"quotes": [], "annotatedQuotes": [{"quote": "EXACT words from text", "context": "..."}, ...], "summary": "", "database": "", "analyzer": ""}`,
    
    rewrite: `Compress each paragraph into maximum 2 sentences. Do NOT skip any paragraphs.
Output valid JSON: {"quotes": [], "annotatedQuotes": [], "summary": "Full compressed text...", "database": "", "analyzer": ""}`,
    
    database: `Generate an extremely detailed, fine-grained text-file database of the document. Include ALL of the following sections with comprehensive detail:

1. DOCUMENT METADATA: Title (inferred), word count, character count, paragraph count, sentence count, average sentence length, reading level estimate, dominant language/style

2. EXECUTIVE SUMMARY: Comprehensive 3-5 paragraph summary of the entire work, including:
   - Overview of the document's purpose and scope
   - Main thesis or central argument
   - Key points and supporting arguments (numbered list)
   - Primary conclusions and implications
   - Overall significance and contribution

3. REPRESENTATIVE QUOTATIONS (Minimum ${minQuotes} quotations):
   Extract the most significant quotations that capture:
   - The main thesis or central claims
   - Key supporting arguments
   - Important evidence or examples
   - Crucial definitions or distinctions
   - Memorable or powerful statements
   For each quote: provide the quotation and a brief note on its significance

4. KEY POINTS & ARGUMENTS ANALYSIS:
   - Main argument/thesis statement
   - Primary supporting arguments (numbered, with detailed explanations)
   - Secondary arguments and claims
   - Evidence and examples used
   - Logical structure and progression
   - Conclusions reached

5. NAMED ENTITIES: Extract and categorize all people, places, organizations, dates, times, numbers, and proper nouns with frequency counts

6. KEY CONCEPTS & THEMES: Identify major themes, topics, and concepts with detailed descriptions and occurrence frequencies

7. STRUCTURAL ANALYSIS: Paragraph-by-paragraph breakdown with type classification (introduction, argument, evidence, transition, conclusion), topic sentences, and structural relationships

8. SENTENCE INDEX: Complete sentence-by-sentence listing with classification (declarative, interrogative, imperative), complexity scores, and key information

9. ENTITY RELATIONSHIPS: Map relationships between identified entities (who relates to whom, what connects to what)

10. SEMANTIC ANALYSIS: Identify semantic fields, word families, recurring patterns, and linguistic features

11. STATISTICAL BREAKDOWN: Vocabulary richness, lexical density, type-token ratio, most frequent words (excluding common words)

12. CITATION & REFERENCE EXTRACTION: Any quotes, citations, references, or allusions to external sources

13. TEMPORAL & SPATIAL MARKERS: Timeline of events mentioned, geographical references, temporal sequences

14. RHETORICAL DEVICES: Metaphors, analogies, rhetorical questions, and persuasive techniques identified

15. ARGUMENTATIVE STRUCTURE: Claims, evidence, warrants, counterarguments if present

Format as a highly structured, detailed database in plain text with clear section headers and hierarchical organization.
Output valid JSON: {"quotes": [], "annotatedQuotes": [], "summary": "", "database": "Comprehensive database text...", "analyzer": ""}`,

    analyzer: `Perform an EXTREMELY COMPREHENSIVE scholarly analysis of this text. This analysis should be approximately THREE TIMES as detailed and in-depth as a standard academic analysis. Include ALL of the following sections with exhaustive detail:

═══════════════════════════════════════════════════════════════════

SECTION 1: DOMAIN & DISCIPLINARY CONTEXT
- Primary academic domain(s) and subdomain(s)
- Interdisciplinary connections and influences
- Historical positioning within the field
- Relationship to major schools of thought
- Target audience and scholarly community

SECTION 2: MAIN THESIS & CENTRAL ARGUMENTS
- Core thesis statement (multiple formulations if complex)
- Primary arguments supporting the thesis (numbered, with detailed explanations)
- Secondary arguments and subsidiary claims
- Implicit assumptions underlying the arguments
- Logical structure of the overall argument
- Argument progression and development throughout the text

SECTION 3: REPRESENTATIVE QUOTATIONS (Minimum ${minQuotes * 2} quotations)
- Extract the most philosophically/intellectually significant passages
- Include direct quotations that capture:
  * The author's main position
  * Key supporting arguments
  * Crucial definitions or conceptual distinctions
  * Positions being criticized or refuted
  * Methodological statements
  * Pivotal turns in the argument
- For EACH quotation, provide: the exact quote, its location/context in the text, and its significance

SECTION 4: ANALYTICAL MOVES DEPLOYED
Identify and explain IN DETAIL every major analytical technique used:
- Conceptual analysis and distinctions drawn
- Argumentation strategies (reductio ad absurdum, modus tollens, etc.)
- Category error detection
- Counterfactual reasoning
- Thought experiments
- Analogies and comparisons
- Appeals to intuition
- Inference to best explanation
- Transcendental arguments
- Dialectical moves
- Deconstructive strategies
- Hermeneutical approaches
- For each move: explain what it is, where it appears, how it functions in the argument

SECTION 5: THEORETICAL FRAMEWORK & METHODOLOGY
- Philosophical or theoretical commitments
- Methodological approach (analytical, continental, empirical, etc.)
- Epistemological assumptions
- Ontological commitments
- Use of formal logic or informal reasoning
- Relationship to empirical evidence

SECTION 6: INTELLECTUAL GENEALOGY
- Thinkers and theories explicitly referenced
- Implicit influences and philosophical heritage
- Positions being argued against (with named opponents if present)
- Historical debates the text engages with
- Canonical texts or ideas invoked

SECTION 7: CONCEPTUAL APPARATUS
- Key terms and their definitions
- Technical vocabulary introduced or employed
- Distinctions drawn between related concepts
- Theoretical innovations or neologisms
- Repurposing of existing concepts

SECTION 8: ARGUMENTATIVE STRUCTURE
- Overall organization of the argument
- Logical dependencies between claims
- Progression from premises to conclusions
- Use of examples, illustrations, or case studies
- Anticipation and response to objections
- Dialectical structure (if present)

SECTION 9: CRITICAL EVALUATION INDICATORS
- Strengths of the argument
- Potential weaknesses or gaps
- Unstated assumptions that could be challenged
- Alternative interpretations or objections not addressed
- Scope and limitations of the claims

SECTION 10: IMPLICATIONS & CONSEQUENCES
- Theoretical implications
- Practical consequences
- What follows if the thesis is correct
- What's at stake in accepting or rejecting the position
- Ramifications for related debates

SECTION 11: RHETORICAL & STYLISTIC FEATURES
- Tone and register (formal, polemical, pedagogical, etc.)
- Use of rhetoric and persuasive devices
- Structural choices and their effects
- Relationship to reader (adversarial, cooperative, pedagogical)

SECTION 12: INTERTEXTUAL CONNECTIONS
- Relationship to other works by the same author
- Dialogue with contemporary or historical texts
- Position within broader scholarly conversations

═══════════════════════════════════════════════════════════════════

FORMATTING REQUIREMENTS:
- Use clear section headers with visual separators
- Number all major points within sections
- Use hierarchical organization (main points, subpoints, details)
- Provide extensive detail - this should be a COMPREHENSIVE analysis approximately 3x the length of a standard analysis
- Be specific, cite exact passages where relevant, and provide deep interpretive insights

Output valid JSON: {"quotes": [], "annotatedQuotes": [], "summary": "", "database": "", "analyzer": "Complete comprehensive analysis text..."}`,

    views: `TASK: Extract the author's MAJOR PHILOSOPHICAL POSITIONS - the claims they genuinely endorse and argue for.

⚠️ CRITICAL DISTINCTIONS - You MUST discriminate:

1. AUTHOR'S OWN POSITIONS (include these):
   - Claims the author explicitly endorses and defends
   - Theses the author argues FOR with evidence/reasoning
   - Conclusions the author draws from their arguments
   - Normative claims (what SHOULD be, what is RIGHT/WRONG)
   - Theoretical innovations the author proposes

2. ATTRIBUTED/REJECTED POSITIONS (DO NOT include these):
   - Positions the author attributes to OTHER thinkers (e.g., "Kant argues that...")
   - Views the author presents only to CRITICIZE or REJECT
   - Positions mentioned as background/context but not endorsed
   - Historical views being surveyed or summarized
   - Opponent positions being set up for refutation

3. NON-POSITIONS (DO NOT include these):
   - Mere factual statements ("Plato was born in Athens")
   - Transitional sentences or rhetorical framing
   - Questions without answers
   - Summaries of others' work
   - Descriptive statements without argumentative weight

OUTPUT FORMAT:
{"views":[{"view":"position","stance":"endorsed|rejected|attributed","attributedTo":"author name or null","context":"brief explanation of argumentative significance","evidence":["exact quote"]}]}

SELECTION CRITERIA - Only include positions that:
- Have ARGUMENTATIVE WEIGHT (the author provides reasons/evidence)
- Make SUBSTANTIVE CLAIMS (not trivial or obvious)
- The author GENUINELY ENDORSES (not just mentions)
- Are PHILOSOPHICALLY SIGNIFICANT (not incidental)

For each position:
- "stance": "endorsed" = author's own view; "rejected" = author criticizes this; "attributed" = author reports someone else's view
- "attributedTo": Name of person if stance is "attributed" or "rejected", otherwise null
- "context": 1-2 sentences explaining WHY this is a major position (what argument does it serve?)
- "evidence": Exact quote showing the author stating/defending this position

Return 5-15 MAJOR positions. Quality over quantity. DO NOT include every assertion.

Example output:
{"views":[{"view":"Knowledge requires justified true belief plus a fourth condition","stance":"endorsed","attributedTo":null,"context":"This is the author's central thesis, defended against Gettier counterexamples throughout the paper","evidence":["I argue that the traditional tripartite analysis must be supplemented with..."]},{"view":"Foundationalism cannot solve the regress problem","stance":"rejected","attributedTo":"Classical foundationalists","context":"The author spends section 3 dismantling this traditional view before proposing their alternative","evidence":["Against the foundationalist, I contend that basic beliefs cannot bear the epistemic weight required..."]}]}`
  };
  
  return prompts[functionType as keyof typeof prompts] || prompts.quotes;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function calculateMinQuotes(text: string): number {
  const wordCount = countWords(text);
  return Math.max(3, Math.ceil((wordCount / 600) * 3));
}

function sanitizeJSON(str: string): string {
  // Replace smart/curly quotes with regular quotes
  return str
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')  // Various double quotes
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")  // Various single quotes
    .replace(/[\u2013\u2014]/g, "-")  // En-dash and em-dash to hyphen
    .replace(/[\u2026]/g, "...")  // Ellipsis
    .replace(/[\u00A0]/g, " ")  // Non-breaking space
    .replace(/[\x00-\x1F\x7F]/g, (char) => {
      // Keep newlines, tabs, carriage returns but escape other control chars
      if (char === '\n' || char === '\r' || char === '\t') return char;
      return '';
    });
}

function parseJSON(content: string): AnalysisResult {
  // First, try to extract JSON from markdown code blocks
  const jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n```/) || content.match(/```\s*\n([\s\S]*?)\n```/);
  let jsonString = jsonMatch ? jsonMatch[1] : content;
  
  // Remove any trailing/leading whitespace
  jsonString = jsonString.trim();
  
  // Sanitize the JSON string to handle special characters
  jsonString = sanitizeJSON(jsonString);
  
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    // If direct parsing fails, try to extract just the JSON object
    const objectMatch = jsonString.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      let cleanedJson = sanitizeJSON(objectMatch[0]);
      
      try {
        return JSON.parse(cleanedJson);
      } catch (e2) {
        // Try a more aggressive cleanup - remove unescaped quotes inside strings
        // This is a last resort attempt
        try {
          // Find and fix broken string arrays
          cleanedJson = cleanedJson.replace(/"\s*,\s*\n\s*"/g, '",\n"');
          return JSON.parse(cleanedJson);
        } catch (e3) {
          // Log the error for debugging
          console.error("JSON parse error:", e2);
          console.error("Content length:", cleanedJson.length);
          console.error("First 500 chars:", cleanedJson.substring(0, 500));
          
          // Try to extract views from broken JSON using regex
          const extractedViews: { view: string; evidence: string[] }[] = [];
          
          // Match patterns like {"view":"...", "evidence":["..."]}
          const viewPattern = /\{"view"\s*:\s*"([^"]+)"\s*,\s*"evidence"\s*:\s*\["([^"]+)"\]/g;
          let match;
          while ((match = viewPattern.exec(cleanedJson)) !== null) {
            extractedViews.push({
              view: match[1],
              evidence: [match[2]]
            });
          }
          
          // If we found any views, return them
          if (extractedViews.length > 0) {
            console.log(`Extracted ${extractedViews.length} views from broken JSON`);
            return {
              quotes: [],
              annotatedQuotes: [],
              summary: "",
              database: "",
              analyzer: "",
              views: extractedViews
            };
          }
          
          // Return the raw content as plain text since JSON parsing failed
          // Put it in the appropriate field based on what we can detect
          const rawContent = objectMatch[0];
          
          return {
            quotes: [],
            annotatedQuotes: [],
            summary: "",
            database: rawContent,  // Put raw content in database field
            analyzer: "",
            views: []
          };
        }
      }
    }
    
    // Last resort - return the raw content
    return {
      quotes: [],
      annotatedQuotes: [],
      summary: "",
      database: content,  // Put raw content in database field  
      analyzer: "",
      views: []
    };
  }
}

async function callOpenAI(text: string, apiKey: string, functionType: string): Promise<AnalysisResult> {
  const minQuotes = calculateMinQuotes(text);
  const prompt = getSystemPrompt(functionType, minQuotes);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: text }
      ],
      max_tokens: 16384,
      temperature: 0,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "OpenAI API Error");
  }

  const data = await response.json();
  return parseJSON(data.choices[0].message.content);
}

async function callOpenAIStreaming(text: string, apiKey: string, functionType: string, onChunk: (chunk: string) => void): Promise<void> {
  const minQuotes = calculateMinQuotes(text);
  const prompt = getSystemPrompt(functionType, minQuotes);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: text }
      ],
      max_tokens: 16384,
      temperature: 0,
      stream: true,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "OpenAI API Error");
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices[0]?.delta?.content;
          if (content) {
            onChunk(content);
          }
        } catch (e) {
          // Skip parse errors
        }
      }
    }
  }
}

async function callAnthropic(text: string, apiKey: string, functionType: string): Promise<AnalysisResult> {
  const minQuotes = calculateMinQuotes(text);
  const prompt = getSystemPrompt(functionType, minQuotes);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 16384,
      temperature: 0,
      system: prompt,
      messages: [
        { role: "user", content: text }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "Anthropic API Error");
  }

  const data = await response.json();
  const content = data.content[0].text;
  return parseJSON(content);
}

async function callGrok(text: string, apiKey: string, functionType: string): Promise<AnalysisResult> {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error("GROK_API_KEY is empty or not configured. Please add it in Replit Secrets.");
  }
  
  const minQuotes = calculateMinQuotes(text);
  const prompt = getSystemPrompt(functionType, minQuotes);

  console.log(`[Grok] Making API call with key starting: ${apiKey.substring(0, 8)}...`);
  
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-3-latest",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: text }
      ],
      max_tokens: 16384,
      temperature: 0,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (errorText.includes('<!DOCTYPE') || errorText.includes('<html')) {
      throw new Error(`Grok API returned HTML error page (status ${response.status}). The API key may be invalid or the service is down.`);
    }
    throw new Error(`Grok API Error: ${response.status} - ${errorText}`);
  }

  const responseText = await response.text();
  if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
    throw new Error(`Grok API returned HTML instead of JSON. The API key may be invalid.`);
  }
  
  const data = JSON.parse(responseText);
  const content = data.choices[0].message.content;
  return parseJSON(content);
}

async function callPerplexity(text: string, apiKey: string, functionType: string): Promise<AnalysisResult> {
  const minQuotes = calculateMinQuotes(text);
  const prompt = getSystemPrompt(functionType, minQuotes);

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-sonar-large-128k-online",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: text }
      ],
      max_tokens: 16384,
      temperature: 0
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  return parseJSON(content);
}

async function callDeepSeek(text: string, apiKey: string, functionType: string): Promise<AnalysisResult> {
  const minQuotes = calculateMinQuotes(text);
  const prompt = getSystemPrompt(functionType, minQuotes);

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: text }
      ],
      max_tokens: 16384,
      temperature: 0,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  return parseJSON(content);
}

export async function analyzeText(text: string, provider: string, functionType: string): Promise<AnalysisResult> {
  // Get API keys from environment variables (Replit Secrets)
  const apiKeys = {
    openai: process.env.OPENAI_API_KEY || "",
    anthropic: process.env.ANTHROPIC_API_KEY || "",
    grok: process.env.GROK_API_KEY || "",
    perplexity: process.env.PERPLEXITY_API_KEY || "",
    deepseek: process.env.DEEPSEEK_API_KEY || "",
  };

  switch (provider) {
    case "openai":
      if (!apiKeys.openai) throw new Error("OPENAI_API_KEY not configured. Add it as an environment variable.");
      return callOpenAI(text, apiKeys.openai, functionType);
    
    case "anthropic":
      if (!apiKeys.anthropic) throw new Error("ANTHROPIC_API_KEY not configured. Add it as an environment variable.");
      return callAnthropic(text, apiKeys.anthropic, functionType);
    
    case "grok":
      if (!apiKeys.grok) throw new Error("GROK_API_KEY not configured. Add it as an environment variable.");
      return callGrok(text, apiKeys.grok, functionType);
    
    case "perplexity":
      if (!apiKeys.perplexity) throw new Error("PERPLEXITY_API_KEY not configured. Add it as an environment variable.");
      return callPerplexity(text, apiKeys.perplexity, functionType);
    
    case "deepseek":
      if (!apiKeys.deepseek) throw new Error("DEEPSEEK_API_KEY not configured. Add it as an environment variable.");
      return callDeepSeek(text, apiKeys.deepseek, functionType);
    
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export async function analyzeTextStreaming(text: string, provider: string, functionType: string, onChunk: (chunk: string) => void): Promise<void> {
  // Get API keys from environment variables (Replit Secrets)
  const apiKeys = {
    openai: process.env.OPENAI_API_KEY || "",
    anthropic: process.env.ANTHROPIC_API_KEY || "",
    grok: process.env.GROK_API_KEY || "",
    perplexity: process.env.PERPLEXITY_API_KEY || "",
    deepseek: process.env.DEEPSEEK_API_KEY || "",
  };

  switch (provider) {
    case "openai":
      if (!apiKeys.openai) throw new Error("OPENAI_API_KEY not configured. Add it as an environment variable.");
      return callOpenAIStreaming(text, apiKeys.openai, functionType, onChunk);
    
    case "anthropic":
    case "grok":
    case "perplexity":
    case "deepseek":
      // Fallback to non-streaming for providers without streaming support yet
      const result = await analyzeText(text, provider, functionType);
      const fullText = JSON.stringify(result, null, 2);
      // Simulate streaming by chunking the response
      for (let i = 0; i < fullText.length; i += 50) {
        onChunk(fullText.slice(i, i + 50));
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      break;
    
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export async function callLLM(provider: string, prompt: string): Promise<string> {
  const apiKeys = {
    openai: process.env.OPENAI_API_KEY || "",
    anthropic: process.env.ANTHROPIC_API_KEY || "",
    grok: process.env.GROK_API_KEY || "",
    perplexity: process.env.PERPLEXITY_API_KEY || "",
    deepseek: process.env.DEEPSEEK_API_KEY || "",
  };

  const makeRequest = async (url: string, apiKey: string, model: string, maxTokens: number = 16384) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "user", content: prompt }
        ],
        max_tokens: maxTokens,
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  };

  switch (provider) {
    case "openai":
      if (!apiKeys.openai) throw new Error("OPENAI_API_KEY not configured");
      return makeRequest("https://api.openai.com/v1/chat/completions", apiKeys.openai, "gpt-4o");
    
    case "anthropic":
      if (!apiKeys.anthropic) throw new Error("ANTHROPIC_API_KEY not configured");
      const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKeys.anthropic,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16384,
          messages: [{ role: "user", content: prompt }]
        })
      });
      if (!anthropicResponse.ok) {
        const err = await anthropicResponse.text();
        throw new Error(`Anthropic API Error: ${err}`);
      }
      const anthropicData = await anthropicResponse.json();
      return anthropicData.content[0].text;
    
    case "grok":
      if (!apiKeys.grok) throw new Error("GROK_API_KEY not configured");
      return makeRequest("https://api.x.ai/v1/chat/completions", apiKeys.grok, "grok-3-latest");
    
    case "perplexity":
      if (!apiKeys.perplexity) throw new Error("PERPLEXITY_API_KEY not configured");
      return makeRequest("https://api.perplexity.ai/chat/completions", apiKeys.perplexity, "sonar-pro");
    
    case "deepseek":
      if (!apiKeys.deepseek) throw new Error("DEEPSEEK_API_KEY not configured");
      return makeRequest("https://api.deepseek.com/chat/completions", apiKeys.deepseek, "deepseek-chat", 8192);
    
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
