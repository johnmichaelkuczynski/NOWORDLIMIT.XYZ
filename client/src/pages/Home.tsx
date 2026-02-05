import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import { saveAs } from "file-saver";
import { 
  Upload, 
  FileText, 
  Maximize2, 
  Minimize2, 
  ChevronRight, 
  Sparkles,
  Stethoscope,
  Quote,
  AlignLeft,
  Database,
  Bot,
  Check,
  Download,
  Copy,
  Trash2,
  RotateCcw,
  Layers,
  CheckSquare,
  Square,
  Play,
  ChevronDown,
  ChevronUp,
  User,
  LogIn,
  LogOut,
  BarChart3,
  BookOpen,
  Save,
  X,
  GitCompare,
  History,
  Eye,
  Clock,
  Search,
  Mail,
  List,
  GitBranch,
  Lock,
  CreditCard
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ResizableDialog,
  ResizableDialogContent,
  ResizableDialogHeader,
  ResizableDialogTitle,
  ResizableDialogDescription,
} from "@/components/ui/resizable-dialog";
import { analyzeText, analyzeTextStreaming, AnalysisResult, measureIntelligence, compareIntelligence, IntelligenceResult, IntelligenceCompareResult } from "@/lib/llm";

type LLM = "grok" | "openai" | "anthropic" | "perplexity" | "deepseek";

interface Chunk {
  id: number;
  text: string;
  wordCount: number;
  startWord: number;
  endWord: number;
  selected: boolean;
  processed?: boolean;  // Track if this chunk has been successfully processed
}

interface StylometricAuthor {
  id: number;
  authorName: string;
  sourceTitle?: string;
  wordCount?: number;
  verticalityScore?: string;
  rawFeatures?: any;
  fullReport?: string;
}

const CHUNK_SIZE = 1000;

function splitIntoChunks(text: string): Chunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: Chunk[] = [];
  
  for (let i = 0; i < words.length; i += CHUNK_SIZE) {
    const chunkWords = words.slice(i, i + CHUNK_SIZE);
    chunks.push({
      id: chunks.length + 1,
      text: chunkWords.join(' '),
      wordCount: chunkWords.length,
      startWord: i + 1,
      endWord: Math.min(i + CHUNK_SIZE, words.length),
      selected: true
    });
  }
  
  return chunks;
}

function combineResults(results: AnalysisResult[]): AnalysisResult {
  // Only include chunks with actual content, filter out undefined/empty
  const summaryParts = results
    .map((r, i) => ({ index: i, content: r.summary }))
    .filter(item => item.content && item.content.trim() && item.content.trim() !== 'undefined')
    .map(item => `[Chunk ${item.index + 1}]\n${item.content}`);
  
  const databaseParts = results
    .map((r, i) => ({ index: i, content: r.database }))
    .filter(item => item.content && item.content.trim() && item.content.trim() !== 'undefined')
    .map(item => `═══ CHUNK ${item.index + 1} ═══\n${item.content}`);
  
  const analyzerParts = results
    .map((r, i) => ({ index: i, content: r.analyzer }))
    .filter(item => item.content && item.content.trim() && item.content.trim() !== 'undefined')
    .map(item => `═══════════════════════════════════════\n           CHUNK ${item.index + 1} ANALYSIS\n═══════════════════════════════════════\n\n${item.content}`);
  
  return {
    quotes: results.flatMap(r => (r.quotes || []).filter(q => q && q.trim())),
    annotatedQuotes: results.flatMap(r => (r.annotatedQuotes || []).filter(q => q && q.quote)),
    summary: summaryParts.join('\n\n'),
    database: databaseParts.join('\n\n'),
    analyzer: analyzerParts.join('\n\n'),
    views: results.flatMap(r => (r.views || []).filter(v => v && v.view))
  };
}

function buildAccumulatedDisplay(
  results: AnalysisResult[], 
  functionType: string, 
  currentChunk: number, 
  totalChunks: number, 
  chunkCompleted: boolean = false,
  errorMessage?: string
): string {
  let output = "";
  
  // Header with progress
  output += `╔══════════════════════════════════════════════════════════════╗\n`;
  output += `║  PROCESSING PROGRESS: ${results.length}/${totalChunks} chunks completed`;
  if (errorMessage) {
    output += ` (STOPPED)`;
  }
  output += `\n`;
  output += `╚══════════════════════════════════════════════════════════════╝\n\n`;
  
  // Show error if any
  if (errorMessage) {
    output += `⚠️ CHUNK ${currentChunk} FAILED: ${errorMessage}\n`;
    output += `✅ Results from ${results.length} completed chunks are saved below.\n\n`;
  } else if (!chunkCompleted) {
    output += `⏳ Processing chunk ${currentChunk}/${totalChunks}...\n\n`;
  }
  
  // Show accumulated results based on function type
  if (results.length > 0) {
    switch (functionType) {
      case 'quotes':
        const allQuotes = results.flatMap(r => (r.quotes || []).filter(q => q && q.trim()));
        if (allQuotes.length > 0) {
          output += `═══ ${allQuotes.length} QUOTES EXTRACTED ═══\n\n`;
          allQuotes.forEach((q, i) => {
            output += `${i + 1}. "${q}"\n\n`;
          });
        }
        break;
        
      case 'context':
        const allAnnotated = results.flatMap(r => (r.annotatedQuotes || []).filter(q => q && q.quote));
        if (allAnnotated.length > 0) {
          output += `═══ ${allAnnotated.length} ANNOTATED QUOTES ═══\n\n`;
          allAnnotated.forEach((q, i) => {
            output += `${i + 1}. "${q.quote}"\n   → ${q.context || ''}\n\n`;
          });
        }
        break;
        
      case 'rewrite':
        results.forEach((r, i) => {
          if (r.summary && r.summary.trim() && r.summary.trim() !== 'undefined') {
            output += `═══ CHUNK ${i + 1} COMPRESSION ═══\n${r.summary}\n\n`;
          }
        });
        break;
        
      case 'database':
        results.forEach((r, i) => {
          if (r.database && r.database.trim() && r.database.trim() !== 'undefined') {
            output += `═══════════════════════════════════════════════════════════════\n`;
            output += `                    CHUNK ${i + 1} DATABASE\n`;
            output += `═══════════════════════════════════════════════════════════════\n\n`;
            output += `${r.database}\n\n`;
          }
        });
        break;
        
      case 'analyzer':
        results.forEach((r, i) => {
          if (r.analyzer && r.analyzer.trim() && r.analyzer.trim() !== 'undefined') {
            output += `═══════════════════════════════════════════════════════════════\n`;
            output += `                    CHUNK ${i + 1} ANALYSIS\n`;
            output += `═══════════════════════════════════════════════════════════════\n\n`;
            output += `${r.analyzer}\n\n`;
          }
        });
        break;
        
      case 'views':
        const allViews = results.flatMap(r => (r.views || []).filter(v => v && v.view));
        if (allViews.length > 0) {
          output += `═══ ${allViews.length} MAJOR POSITIONS IDENTIFIED ═══\n\n`;
          allViews.forEach((v, i) => {
            const stanceLabel = v.stance ? `[${v.stance.toUpperCase()}]` : '';
            const attrLabel = v.attributedTo ? ` → ${v.attributedTo}` : '';
            output += `• POSITION ${i + 1} ${stanceLabel}${attrLabel}: ${v.view}\n`;
            if (v.context) {
              output += `  CONTEXT: ${v.context}\n`;
            }
            (v.evidence || []).filter(e => e).forEach(e => {
              output += `  EVIDENCE: "${e}"\n`;
            });
            output += `\n`;
          });
        }
        break;
    }
  }
  
  return output;
}

export default function Home() {
  const [text, setText] = useState("");
  const [selectedLLM, setSelectedLLM] = useState<LLM>("deepseek");
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasResult, setHasResult] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [streamingOutput, setStreamingOutput] = useState("");
  
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [showChunkSelector, setShowChunkSelector] = useState(false);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [totalChunksToProcess, setTotalChunksToProcess] = useState(0);
  const [chunkResults, setChunkResults] = useState<AnalysisResult[]>([]);
  const [lastFailedChunkIndex, setLastFailedChunkIndex] = useState<number | null>(null);
  const [lastFunctionType, setLastFunctionType] = useState<string | null>(null);
  const [processedChunkIds, setProcessedChunkIds] = useState<Set<number>>(new Set());
  
  const [username, setUsername] = useState<string | null>(null);
  const [loginInput, setLoginInput] = useState("");
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [userCredits, setUserCredits] = useState<number>(0);
  const [isBuyingCredits, setIsBuyingCredits] = useState(false);
  
  const [showStylometricsDialog, setShowStylometricsDialog] = useState(false);
  const [stylometricsTab, setStylometricsTab] = useState<"single" | "compare">("single");
  const [stylometricsAuthorName, setStylometricsAuthorName] = useState("");
  const [stylometricsSourceTitle, setStylometricsSourceTitle] = useState("");
  const [stylometricsText, setStylometricsText] = useState("");
  const [stylometricsTextB, setStylometricsTextB] = useState("");
  const [stylometricsAuthorNameB, setStylometricsAuthorNameB] = useState("");
  const [stylometricsReport, setStylometricsReport] = useState("");
  const [stylometricsData, setStylometricsData] = useState<any>(null);
  const [isAnalyzingStylometrics, setIsAnalyzingStylometrics] = useState(false);
  const [savedAuthors, setSavedAuthors] = useState<StylometricAuthor[]>([]);
  const [useStylometricsOutlineMode, setUseStylometricsOutlineMode] = useState(true);
  const [stylometricsProgress, setStylometricsProgress] = useState<{stage: string, message: string, current?: number, total?: number} | null>(null);
  const [holisticStylometricsResult, setHolisticStylometricsResult] = useState<any>(null);
  const [holisticStylometricsCompareResult, setHolisticStylometricsCompareResult] = useState<any>(null);
  
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<any>(null);
  const [historyTypeFilter, setHistoryTypeFilter] = useState<string>("all");
  
  const [showIntelligenceDialog, setShowIntelligenceDialog] = useState(false);
  const [intelligenceTab, setIntelligenceTab] = useState<"single" | "compare">("single");
  const [intelligenceTextA, setIntelligenceTextA] = useState("");
  const [intelligenceTextB, setIntelligenceTextB] = useState("");
  const [intelligenceResult, setIntelligenceResult] = useState<IntelligenceResult | null>(null);
  const [intelligenceCompareResult, setIntelligenceCompareResult] = useState<IntelligenceCompareResult | null>(null);
  const [isAnalyzingIntelligence, setIsAnalyzingIntelligence] = useState(false);
  const [isDraggingIntelA, setIsDraggingIntelA] = useState(false);
  const [isDraggingIntelB, setIsDraggingIntelB] = useState(false);
  const intelFileRefA = useRef<HTMLInputElement>(null);
  const intelFileRefB = useRef<HTMLInputElement>(null);
  const stylometricsFileRefB = useRef<HTMLInputElement>(null);
  const [useIntelOutlineMode, setUseIntelOutlineMode] = useState(true);
  const [intelligenceProgress, setIntelligenceProgress] = useState<{stage: string, message: string, current?: number, total?: number} | null>(null);
  const [holisticIntelResult, setHolisticIntelResult] = useState<{score: number, ratio: number, totalTextLength: number, totalSignalLength: number, quotes: {author: string, quote: string, source: string, charLength: number}[], analysis: string, mode: string} | null>(null);
  const [intelligenceAuthor, setIntelligenceAuthor] = useState("");
  
  const [allDayMode, setAllDayMode] = useState(false);
  const [allDayProgress, setAllDayProgress] = useState<{current: number, total: number, timeRemaining: string} | null>(null);
  
  // Quote Finder state
  const [showQuoteFinderDialog, setShowQuoteFinderDialog] = useState(false);
  const [quoteFinderAuthor, setQuoteFinderAuthor] = useState("");
  const [quoteFinderPositions, setQuoteFinderPositions] = useState("");
  const [quoteFinderCorpus, setQuoteFinderCorpus] = useState("");
  const [quoteFinderResults, setQuoteFinderResults] = useState<any[]>([]);
  const [isSearchingQuotes, setIsSearchingQuotes] = useState(false);
  const [quoteFinderError, setQuoteFinderError] = useState<string | null>(null);
  const [quoteFinderSource, setQuoteFinderSource] = useState<"llm" | "database">("llm");
  const positionsFileRef = useRef<HTMLInputElement>(null);
  const corpusFileRef = useRef<HTMLInputElement>(null);
  
  // Position Extractor state
  const [showPositionExtractor, setShowPositionExtractor] = useState(false);
  const [positionExtractorProgress, setPositionExtractorProgress] = useState<{stage: string, message: string, current?: number, total?: number} | null>(null);
  const [extractedPositions, setExtractedPositions] = useState<{author: string, quote: string, source: string, importance?: number, sectionIndex?: number}[]>([]);
  const [isExtractingPositions, setIsExtractingPositions] = useState(false);
  const [useOutlineMode, setUseOutlineMode] = useState(true);
  const [showAllPositions, setShowAllPositions] = useState(false);
  const [positionExtractionSummary, setPositionExtractionSummary] = useState("");
  const [positionExtractorAuthor, setPositionExtractorAuthor] = useState("");
  const [positionExtractionDepth, setPositionExtractionDepth] = useState(8);

  // Holistic Quote Extractor state
  const [showQuoteExtractor, setShowQuoteExtractor] = useState(false);
  const [quoteExtractorProgress, setQuoteExtractorProgress] = useState<{stage: string, message: string, current?: number, total?: number} | null>(null);
  const [extractedQuotes, setExtractedQuotes] = useState<{author: string, quote: string, topic: string}[]>([]);
  const [isExtractingQuotes, setIsExtractingQuotes] = useState(false);
  const [useQuoteOutlineMode, setUseQuoteOutlineMode] = useState(true);
  const [quoteExtractorAuthor, setQuoteExtractorAuthor] = useState("");
  const [quoteExtractionSummary, setQuoteExtractionSummary] = useState("");
  
  // Tractatus Rewrite state
  const [showTractatusRewrite, setShowTractatusRewrite] = useState(false);
  const [tractatusProgress, setTractatusProgress] = useState<{stage: string, message: string, current?: number, total?: number} | null>(null);
  const [tractatusOutput, setTractatusOutput] = useState("");
  const [tractatusRefineInstructions, setTractatusRefineInstructions] = useState("");
  const [isRewritingTractatus, setIsRewritingTractatus] = useState(false);
  const [useTractatusOutlineMode, setUseTractatusOutlineMode] = useState(true);
  const [includeBulletMarkers, setIncludeBulletMarkers] = useState(true);

  // Tractatus Tree state
  const [showTractatusTree, setShowTractatusTree] = useState(false);
  const [tractatusTreeProgress, setTractatusTreeProgress] = useState<{current: number, total: number, message: string} | null>(null);
  const [tractatusTreeColumns, setTractatusTreeColumns] = useState<{number: string, text: string, depth: number}[][]>([]);
  const [tractatusTreeMaxDepth, setTractatusTreeMaxDepth] = useState(0);
  const [isGeneratingTree, setIsGeneratingTree] = useState(false);
  const [tractatusTreeTitle, setTractatusTreeTitle] = useState("TRACTATUS TREE");

  // Summary state
  const [showSummary, setShowSummary] = useState(false);
  const [summaryProgress, setSummaryProgress] = useState<{current: number, total: number, message: string} | null>(null);
  const [summaryResult, setSummaryResult] = useState<{sections: {title: string, level: number, summary: string}[], resolution: number, totalSections: number, recognitionMode: string} | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryResolution, setSummaryResolution] = useState(0);
  const [summaryRecognizeContent, setSummaryRecognizeContent] = useState(false);

  // Arguments Finder state
  const [showArgumentsFinder, setShowArgumentsFinder] = useState(false);
  const [argumentsFinderProgress, setArgumentsFinderProgress] = useState<{stage: string, message: string, current?: number, total?: number} | null>(null);
  const [extractedArguments, setExtractedArguments] = useState<{author: string, premises: string[], conclusion: string, source: string, counterarguments?: string[], importance?: number, sectionIndex?: number, argumentType?: string}[]>([]);
  const [isExtractingArguments, setIsExtractingArguments] = useState(false);
  const [useArgumentsOutlineMode, setUseArgumentsOutlineMode] = useState(true);
  const [argumentsFinderAuthor, setArgumentsFinderAuthor] = useState("");
  const [argumentsMarkdown, setArgumentsMarkdown] = useState("");
  const [argumentsExtractionDepth, setArgumentsExtractionDepth] = useState(7);
  
  // Custom Analyzer state
  const [showCustomAnalyzer, setShowCustomAnalyzer] = useState(false);
  const [customAnalyzerProgress, setCustomAnalyzerProgress] = useState<{stage: string, message: string, current?: number, total?: number} | null>(null);
  const [customAnalyzerOutput, setCustomAnalyzerOutput] = useState("");
  const [customRefineInstructions, setCustomRefineInstructions] = useState("");
  const [isRunningCustomAnalysis, setIsRunningCustomAnalysis] = useState(false);
  const [useCustomOutlineMode, setUseCustomOutlineMode] = useState(true);
  const [customOutputWordCount, setCustomOutputWordCount] = useState<string>("");
  const [customInstructions, setCustomInstructions] = useState("");
  
  // Outline state
  interface OutlineSection {
    id: string;
    title: string;
    description: string;
    keyThemes: string[];
    wordCount: number;
  }
  interface Outline {
    taskSummary: string;
    totalSections: number;
    sections: OutlineSection[];
  }
  const [outline, setOutline] = useState<Outline | null>(null);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [showOutlinePanel, setShowOutlinePanel] = useState(false);
  
  // Full Document Rewrite state
  const [isRewriting, setIsRewriting] = useState(false);
  const [rewriteProgress, setRewriteProgress] = useState<{current: number, total: number, message: string} | null>(null);
  const [rewriteInstructions, setRewriteInstructions] = useState(
    "Precisely restructure and summarize the provided text into a concise, faithful prose document of approximately 8000 words. Preserve all key arguments, definitions, examples, critiques, and logical flow exactly as in the original. Do not add, expand, speculate, or omit any substantive content. Maintain rigorous academic tone and pure prose format."
  );
  const [showRewriteOutlineFirst, setShowRewriteOutlineFirst] = useState(true);
  const [rewrittenDocument, setRewrittenDocument] = useState("");
  const [rewriteRefineInstructions, setRewriteRefineInstructions] = useState("");
  const [showRewriteDialog, setShowRewriteDialog] = useState(false);
  
  // Write From Scratch state
  const [showWriteFromScratchDialog, setShowWriteFromScratchDialog] = useState(false);
  const [writeFromScratchPrompt, setWriteFromScratchPrompt] = useState("");
  const [writeFromScratchTargetWords, setWriteFromScratchTargetWords] = useState("10000");
  const [isWritingFromScratch, setIsWritingFromScratch] = useState(false);
  const [writeFromScratchProgress, setWriteFromScratchProgress] = useState<{current: number, total: number, message: string, phase?: string} | null>(null);
  const [generatedDocument, setGeneratedDocument] = useState("");
  const [writeNewRefineInstructions, setWriteNewRefineInstructions] = useState("");
  
  // Corpus Manager state
  const [showCorpusManager, setShowCorpusManager] = useState(false);
  const [corpusAuthors, setCorpusAuthors] = useState<any[]>([]);
  const [selectedCorpusAuthor, setSelectedCorpusAuthor] = useState<any>(null);
  const [corpusWorks, setCorpusWorks] = useState<any[]>([]);
  const [newAuthorName, setNewAuthorName] = useState("");
  const [newAuthorAliases, setNewAuthorAliases] = useState("");
  const [newWorkTitle, setNewWorkTitle] = useState("");
  const [newWorkContent, setNewWorkContent] = useState("");
  const [isUploadingWork, setIsUploadingWork] = useState(false);
  const [corpusStats, setCorpusStats] = useState<any>(null);
  const workContentFileRef = useRef<HTMLInputElement>(null);
  
  const { toast } = useToast();
  
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const needsChunking = wordCount > CHUNK_SIZE;
  
  useEffect(() => {
    // Check for Google auth first
    fetch('/api/auth/user', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.authenticated && data.user) {
          setUsername(data.user.displayName || data.user.username);
          localStorage.setItem('tis_username', data.user.displayName || data.user.username);
          loadSavedAuthors(data.user.displayName || data.user.username);
          // Fetch credits for authenticated users
          fetch('/api/credits', { credentials: 'include' })
            .then(res => res.json())
            .then(creditsData => setUserCredits(creditsData.credits || 0))
            .catch(() => {});
        } else {
          // Fall back to localStorage username
          const savedUsername = localStorage.getItem('tis_username');
          if (savedUsername) {
            setUsername(savedUsername);
            loadSavedAuthors(savedUsername);
          }
        }
      })
      .catch(() => {
        // Fall back to localStorage username
        const savedUsername = localStorage.getItem('tis_username');
        if (savedUsername) {
          setUsername(savedUsername);
          loadSavedAuthors(savedUsername);
        }
      });
  }, []);
  
  useEffect(() => {
    if (username) {
      loadHistory(historyTypeFilter);
    }
  }, [username]);
  
  // Update chunks when text changes, preserving processed state
  useEffect(() => {
    if (needsChunking) {
      const newChunks = splitIntoChunks(text);
      setChunks(prevChunks => {
        // Build a lookup of previous processed state
        const prevProcessed = new Set(prevChunks.filter(c => c.processed).map(c => c.id));
        return newChunks.map(c => ({
          ...c,
          processed: processedChunkIds.has(c.id) || prevProcessed.has(c.id)
        }));
      });
      setShowChunkSelector(true);
    } else {
      setChunks([]);
      setShowChunkSelector(false);
    }
  }, [text, needsChunking]);
  
  // Separate effect to clear processed state when text changes significantly
  useEffect(() => {
    // Only clear when text becomes small enough to not need chunking
    if (!needsChunking && processedChunkIds.size > 0) {
      setProcessedChunkIds(new Set());
      setLastFailedChunkIndex(null);
    }
  }, [needsChunking]);

  const loadSavedAuthors = async (user: string) => {
    try {
      const response = await fetch(`/api/stylometrics/authors?username=${encodeURIComponent(user)}`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setSavedAuthors(data.authors || []);
      }
    } catch (error) {
      console.error("Failed to load authors:", error);
    }
  };

  const handleLogin = async () => {
    if (!loginInput.trim() || loginInput.trim().length < 2) {
      toast({
        title: "Invalid username",
        description: "Username must be at least 2 characters",
        variant: "destructive",
      });
      return;
    }
    
    setIsLoggingIn(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: loginInput.trim() })
      });
      
      if (response.ok) {
        const data = await response.json();
        setUsername(data.user.username);
        localStorage.setItem('tis_username', data.user.username);
        setShowLoginDialog(false);
        setLoginInput("");
        loadSavedAuthors(data.user.username);
        toast({
          title: "Welcome!",
          description: `Logged in as ${data.user.username}`,
        });
      } else {
        throw new Error("Login failed");
      }
    } catch (error: any) {
      toast({
        title: "Login failed",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    // Also logout from Google OAuth session
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      // Ignore errors
    }
    setUsername(null);
    setUserCredits(0);
    localStorage.removeItem('tis_username');
    setSavedAuthors([]);
    setHistoryItems([]);
    toast({ description: "Logged out successfully" });
  };

  const fetchCredits = async () => {
    try {
      const response = await fetch('/api/credits', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setUserCredits(data.credits || 0);
      }
    } catch (error) {
      console.error("Failed to fetch credits:", error);
    }
  };

  const handleBuyCredits = async () => {
    // If not logged in, redirect to Google login first with redirect to checkout
    if (!username) {
      // Store intent to buy credits, then redirect to login
      sessionStorage.setItem('postLoginAction', 'checkout');
      window.location.href = '/auth/google';
      return;
    }
    
    setIsBuyingCredits(true);
    try {
      const response = await fetch('/api/checkout', { method: 'POST', credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        if (data.url) {
          window.location.href = data.url;
        }
      } else {
        const error = await response.json();
        toast({
          variant: "destructive",
          title: "Error",
          description: error.error || "Failed to start checkout"
        });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to start checkout"
      });
    } finally {
      setIsBuyingCredits(false);
    }
  };

  // Check for post-login action (e.g., checkout after login)
  useEffect(() => {
    const postLoginAction = sessionStorage.getItem('postLoginAction');
    if (postLoginAction === 'checkout' && username) {
      sessionStorage.removeItem('postLoginAction');
      handleBuyCredits();
    }
  }, [username]);

  // Helper to truncate text at word boundary
  const truncateAtWordLimit = (text: string, wordLimit: number): { truncated: string, isTruncated: boolean, totalWords: number } => {
    const words = text.split(/\s+/).filter(Boolean);
    const totalWords = words.length;
    if (totalWords <= wordLimit) {
      return { truncated: text, isTruncated: false, totalWords };
    }
    const truncated = words.slice(0, wordLimit).join(' ');
    return { truncated, isTruncated: true, totalWords };
  };

  const PAYWALL_WORD_LIMIT = 750;

  // Paywall overlay component
  const PaywallOverlay = ({ 
    content, 
    onBuyCredits 
  }: { 
    content: string, 
    onBuyCredits: () => void 
  }) => {
    const { truncated, isTruncated, totalWords } = truncateAtWordLimit(content, PAYWALL_WORD_LIMIT);
    
    if (!isTruncated) {
      return <pre className="text-sm whitespace-pre-wrap font-mono">{content}</pre>;
    }
    
    return (
      <div className="relative">
        <pre className="text-sm whitespace-pre-wrap font-mono">{truncated}...</pre>
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white to-transparent pt-20 pb-4">
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl p-6 mx-4 shadow-lg">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="bg-amber-100 p-3 rounded-full">
                <Lock className="w-8 h-8 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Full Output Paywalled</h3>
                <p className="text-sm text-gray-600 mt-1">
                  You're viewing {PAYWALL_WORD_LIMIT} of {totalWords.toLocaleString()} words. 
                  Purchase credits to unlock the complete output.
                </p>
              </div>
              <Button
                onClick={onBuyCredits}
                className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold px-8 py-3 text-lg shadow-md"
                data-testid="button-paywall-buy-credits"
              >
                <CreditCard className="w-5 h-5 mr-2" />
                Buy Credits to Unlock
              </Button>
              <p className="text-xs text-gray-500">
                {username ? "Click to proceed to payment" : "You'll be asked to sign in first"}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Check if user has sufficient credits (for paid users, show full content)
  // In development (Replit environment), bypass paywall
  const isDevelopment = window.location.hostname.includes('replit') || window.location.hostname === 'localhost';
  const hasCredits = isDevelopment || userCredits > 0;
  
  const loadHistory = async (typeFilter?: string) => {
    if (!username) return;
    
    setIsLoadingHistory(true);
    try {
      const url = typeFilter && typeFilter !== "all" 
        ? `/api/history?username=${encodeURIComponent(username)}&type=${typeFilter}`
        : `/api/history?username=${encodeURIComponent(username)}`;
      
      const response = await fetch(url, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setHistoryItems(data.history || []);
      }
    } catch (error) {
      console.error("Failed to load history:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  };
  
  const handleViewHistory = () => {
    if (!username) {
      toast({
        title: "Login required",
        description: "Please log in to view your history",
        variant: "destructive",
      });
      return;
    }
    setShowHistoryDialog(true);
    loadHistory(historyTypeFilter);
  };
  
  const handleDeleteHistoryItem = async (itemId: number) => {
    if (!username) return;
    
    try {
      const response = await fetch(`/api/history/${itemId}?username=${encodeURIComponent(username)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      
      if (response.ok) {
        setHistoryItems(prev => prev.filter(item => item.id !== itemId));
        setSelectedHistoryItem(null);
        toast({ description: "History item deleted" });
      }
    } catch (error) {
      console.error("Failed to delete history item:", error);
    }
  };
  
  const formatAnalysisType = (type: string): string => {
    const typeLabels: Record<string, string> = {
      quotes: "Quotes",
      views: "Major Views"
    };
    return typeLabels[type] || type;
  };

  const toggleChunk = (chunkId: number) => {
    setChunks(prev => prev.map(c => 
      c.id === chunkId ? { ...c, selected: !c.selected } : c
    ));
  };
  
  const selectAllChunks = () => {
    setChunks(prev => prev.map(c => ({ ...c, selected: true })));
  };
  
  const deselectAllChunks = () => {
    setChunks(prev => prev.map(c => ({ ...c, selected: false })));
  };
  
  const selectedChunks = chunks.filter(c => c.selected);

  // Manual chunk range input state
  const [chunkRangeInput, setChunkRangeInput] = useState("");
  
  // Density slider state (1-10, affects extraction intensity)
  const [extractionDensity, setExtractionDensity] = useState(5);
  
  // Parse and apply manual chunk ranges like "1-5, 8, 10-12"
  const applyChunkRange = (rangeStr: string) => {
    if (!rangeStr.trim()) return;
    
    const selectedIds = new Set<number>();
    const parts = rangeStr.split(',').map(s => s.trim());
    
    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(n => parseInt(n.trim()));
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
            selectedIds.add(i);
          }
        }
      } else {
        const num = parseInt(part);
        if (!isNaN(num)) {
          selectedIds.add(num);
        }
      }
    }
    
    setChunks(prev => prev.map(c => ({
      ...c,
      selected: selectedIds.has(c.id)
    })));
  };
  
  // Preset selection functions
  const selectPreset = (preset: string) => {
    const total = chunks.length;
    if (total === 0) return;
    
    let selectedIds: number[] = [];
    
    switch (preset) {
      case 'first-half':
        selectedIds = chunks.slice(0, Math.ceil(total / 2)).map(c => c.id);
        break;
      case 'second-half':
        selectedIds = chunks.slice(Math.floor(total / 2)).map(c => c.id);
        break;
      case 'first-third':
        selectedIds = chunks.slice(0, Math.ceil(total / 3)).map(c => c.id);
        break;
      case 'second-third':
        selectedIds = chunks.slice(Math.floor(total / 3), Math.ceil(2 * total / 3)).map(c => c.id);
        break;
      case 'third-third':
        selectedIds = chunks.slice(Math.floor(2 * total / 3)).map(c => c.id);
        break;
      case 'first-quarter':
        selectedIds = chunks.slice(0, Math.ceil(total / 4)).map(c => c.id);
        break;
      case 'second-quarter':
        selectedIds = chunks.slice(Math.floor(total / 4), Math.ceil(total / 2)).map(c => c.id);
        break;
      case 'third-quarter':
        selectedIds = chunks.slice(Math.floor(total / 2), Math.ceil(3 * total / 4)).map(c => c.id);
        break;
      case 'fourth-quarter':
        selectedIds = chunks.slice(Math.floor(3 * total / 4)).map(c => c.id);
        break;
    }
    
    const selectedSet = new Set(selectedIds);
    setChunks(prev => prev.map(c => ({
      ...c,
      selected: selectedSet.has(c.id)
    })));
    
    // Update the range input to reflect the selection
    if (selectedIds.length > 0) {
      const min = Math.min(...selectedIds);
      const max = Math.max(...selectedIds);
      setChunkRangeInput(`${min}-${max}`);
    }
  };
  
  // Sync extraction density with existing depth settings
  useEffect(() => {
    // Map density 1-10 to depth values
    // Positions use 1-10 depth
    setPositionExtractionDepth(extractionDensity);
    // Arguments use 1-10 depth  
    setArgumentsExtractionDepth(extractionDensity);
  }, [extractionDensity]);

  const processChunk = async (chunkText: string, functionType: 'quotes' | 'context' | 'rewrite' | 'database' | 'analyzer' | 'views'): Promise<AnalysisResult> => {
    return new Promise((resolve, reject) => {
      let accumulatedOutput = "";
      
      analyzeTextStreaming(
        chunkText,
        selectedLLM,
        functionType,
        (chunk: string) => {
          accumulatedOutput += chunk;
          setStreamingOutput(accumulatedOutput);
        },
        () => {
          try {
            // Try direct JSON parse first
            const parsed = JSON.parse(accumulatedOutput);
            resolve(parsed);
          } catch (e) {
            // Try to extract JSON from markdown code blocks
            const jsonMatch = accumulatedOutput.match(/```json\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
              try {
                const parsed = JSON.parse(jsonMatch[1]);
                resolve(parsed);
                return;
              } catch {}
            }
            // Try to find JSON object pattern
            const objectMatch = accumulatedOutput.match(/\{[\s\S]*"quotes"[\s\S]*\}/);
            if (objectMatch) {
              try {
                const parsed = JSON.parse(objectMatch[0]);
                resolve(parsed);
                return;
              } catch {}
            }
            // Last resort: return raw output
            console.error("Failed to parse chunk output as JSON:", e);
            resolve({
              quotes: [],
              annotatedQuotes: [],
              summary: accumulatedOutput.substring(0, 1000),
              database: accumulatedOutput,
              analyzer: accumulatedOutput,
              views: []
            });
          }
        },
        username || undefined
      ).catch(reject);
    });
  };

  const handleProcess = async (functionType: 'quotes' | 'context' | 'rewrite' | 'database' | 'analyzer' | 'views') => {
    if (!text.trim()) {
      toast({
        title: "Input required",
        description: "Please enter some text or upload a file to analyze.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setHasResult(true);
    setStreamingOutput("");
    // KEEP existing chunkResults - don't reset! This allows accumulating across multiple runs
    setLastFailedChunkIndex(null);
    setLastFunctionType(functionType);
    
    try {
      if (needsChunking && selectedChunks.length > 0) {
        const chunksToProcess = selectedChunks;
        setTotalChunksToProcess(chunksToProcess.length);
        // Start with existing results to accumulate across runs
        const results: AnalysisResult[] = [...chunkResults];
        let failedChunkIndex = -1;
        let failureError = "";
        const completedChunkIds: number[] = [];
        
        for (let i = 0; i < chunksToProcess.length; i++) {
          setCurrentChunkIndex(i + 1);
          
          // Show accumulated results plus current processing status
          const accumulatedDisplay = buildAccumulatedDisplay(results, functionType, i + 1, chunksToProcess.length);
          setStreamingOutput(accumulatedDisplay);
          
          toast({
            title: `Processing Chunk ${i + 1}/${chunksToProcess.length}`,
            description: `Words ${chunksToProcess[i].startWord}-${chunksToProcess[i].endWord}`,
          });
          
          try {
            const chunkResult = await processChunk(chunksToProcess[i].text, functionType);
            results.push(chunkResult);
            completedChunkIds.push(chunksToProcess[i].id);
            setChunkResults([...results]);
            
            // Mark this chunk as processed AND deselect it (so remaining chunks can be easily selected)
            setChunks(prev => prev.map(c => 
              c.id === chunksToProcess[i].id ? { ...c, processed: true, selected: false } : c
            ));
            setProcessedChunkIds(prev => {
              const newSet = new Set(Array.from(prev));
              newSet.add(chunksToProcess[i].id);
              return newSet;
            });
            
            // Update display with new result immediately
            const updatedDisplay = buildAccumulatedDisplay(results, functionType, i + 1, chunksToProcess.length, true);
            setStreamingOutput(updatedDisplay);
            
            // Combine and set result after each chunk so it's always available
            const combinedSoFar = combineResults(results);
            setResult(combinedSoFar);
            
            // SAVE IMMEDIATELY after each chunk completes (not just at the end)
            if (username) {
              try {
                const inputPreview = text.substring(0, 200) + (text.length > 200 ? "..." : "");
                await fetch('/api/history/save-partial', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({
                    username,
                    analysisType: functionType,
                    provider: selectedLLM,
                    inputPreview,
                    outputData: combinedSoFar,
                    chunksCompleted: results.length,
                    totalChunks: chunksToProcess.length
                  })
                });
              } catch (saveError) {
                console.error("Failed to save chunk result:", saveError);
              }
            }
            
            // Wait between chunks to prevent API rate limiting (except after last chunk)
            // All Day Mode: 60 seconds | Normal: 20 seconds
            if (i < chunksToProcess.length - 1) {
              const DELAY_SECONDS = allDayMode ? 60 : 20;
              const remainingChunks = chunksToProcess.length - (i + 1);
              const estimatedMinutes = Math.ceil((remainingChunks * (DELAY_SECONDS + 30)) / 60); // ~30s per chunk processing + delay
              
              for (let countdown = DELAY_SECONDS; countdown > 0; countdown--) {
                const modeLabel = allDayMode ? "🌙 ALL DAY MODE" : "";
                const waitDisplay = updatedDisplay + `\n\n---\n${modeLabel}\n⏳ **Waiting ${countdown} seconds before next chunk...**\n📊 Progress: ${i + 1}/${chunksToProcess.length} chunks complete\n⏱️ Estimated time remaining: ~${estimatedMinutes} minutes`;
                setStreamingOutput(waitDisplay);
                setAllDayProgress({
                  current: i + 1,
                  total: chunksToProcess.length,
                  timeRemaining: `~${estimatedMinutes} min`
                });
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          } catch (chunkError: any) {
            failedChunkIndex = i + 1;
            failureError = chunkError.message || "Unknown error";
            console.error(`Chunk ${i + 1} failed:`, chunkError);
            setLastFailedChunkIndex(chunksToProcess[i].id);
            break; // Stop processing but keep what we have
          }
        }
        
        // Show completion message
        if (results.length > 0) {
          if (failedChunkIndex > 0) {
            toast({
              title: `Partial Results Saved`,
              description: `Completed ${results.length}/${chunksToProcess.length} chunks. Chunk ${failedChunkIndex} failed: ${failureError}`,
              variant: "destructive",
            });
            
            // Show final accumulated results with error info
            const finalDisplay = buildAccumulatedDisplay(results, functionType, failedChunkIndex, chunksToProcess.length, true, failureError);
            setStreamingOutput(finalDisplay);
          } else {
            // All chunks processed successfully
            toast({
              title: "Analysis Complete",
              description: `Processed ${chunksToProcess.length} chunks using ${selectedLLM.toUpperCase()}.`,
            });
          }
          
          // Auto-select remaining unprocessed chunks so user can continue immediately
          const remainingUnprocessed = chunks.filter(c => !c.processed && !completedChunkIds.includes(c.id)).length;
          if (remainingUnprocessed > 0) {
            setChunks(prev => prev.map(c => ({
              ...c,
              selected: !c.processed && !completedChunkIds.includes(c.id)
            })));
            toast({
              title: `${remainingUnprocessed} chunks remaining`,
              description: "Click a function button to continue processing.",
            });
          }
        } else if (failedChunkIndex > 0) {
          toast({
            title: "Processing Failed",
            description: `First chunk failed: ${failureError}`,
            variant: "destructive",
          });
        }
      } else {
        let accumulatedOutput = "";
        
        await analyzeTextStreaming(
          text, 
          selectedLLM, 
          functionType,
          (chunk: string) => {
            accumulatedOutput += chunk;
            setStreamingOutput(accumulatedOutput);
          },
          () => {
            let parsed: AnalysisResult | null = null;
            try {
              // Try direct JSON parse first
              parsed = JSON.parse(accumulatedOutput);
            } catch (e) {
              // Try to extract JSON from markdown code blocks
              const jsonMatch = accumulatedOutput.match(/```json\s*([\s\S]*?)\s*```/);
              if (jsonMatch) {
                try {
                  parsed = JSON.parse(jsonMatch[1]);
                } catch {}
              }
              if (!parsed) {
                // Try to find JSON object pattern
                const objectMatch = accumulatedOutput.match(/\{[\s\S]*"quotes"[\s\S]*\}/);
                if (objectMatch) {
                  try {
                    parsed = JSON.parse(objectMatch[0]);
                  } catch {}
                }
              }
              if (!parsed) {
                console.error("Failed to parse streaming output:", e);
                // Create fallback result based on function type
                parsed = {
                  quotes: [],
                  annotatedQuotes: [],
                  summary: functionType === 'rewrite' ? accumulatedOutput : '',
                  database: functionType === 'database' ? accumulatedOutput : '',
                  analyzer: functionType === 'analyzer' ? accumulatedOutput : '',
                  views: []
                };
              }
            }
            if (parsed) {
              console.log("Parsed result:", parsed);
              setResult(parsed);
              toast({
                title: "Analysis Complete",
                description: `Generated ${functionType} using ${selectedLLM.toUpperCase()}.`,
              });
            }
          },
          username || undefined
        );
      }
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Analysis Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
      setHasResult(false);
    } finally {
      setIsProcessing(false);
      setCurrentChunkIndex(0);
      setTotalChunksToProcess(0);
      setAllDayProgress(null);
      fetchCredits();
    }
  };

  const handleStylometricsAnalyze = async () => {
    const textToAnalyze = stylometricsTab === "single" ? (stylometricsText || text) : stylometricsText;
    const authorName = (stylometricsTab === "single" ? stylometricsAuthorName : stylometricsAuthorName).trim() || "Author X";
    
    if (!textToAnalyze.trim()) {
      toast({
        title: "Text required",
        description: "Please enter text to analyze",
        variant: "destructive",
      });
      return;
    }
    
    const wordCount = textToAnalyze.split(/\s+/).filter(Boolean).length;
    if (wordCount < 400) {
      toast({
        title: "Text too short",
        description: `Need at least 400 words. Current: ${wordCount} words.`,
        variant: "destructive",
      });
      return;
    }
    
    setIsAnalyzingStylometrics(true);
    setStylometricsReport("");
    setStylometricsData(null);
    setHolisticStylometricsResult(null);
    setHolisticStylometricsCompareResult(null);
    setStylometricsProgress(null);
    
    try {
      if (useStylometricsOutlineMode) {
        const isCompare = stylometricsTab === "compare";
        
        if (isCompare) {
          if (!stylometricsTextB.trim()) {
            toast({
              title: "Missing Text B",
              description: "Please provide both texts for comparison",
              variant: "destructive",
            });
            setIsAnalyzingStylometrics(false);
            return;
          }
          
          const wordCountB = stylometricsTextB.split(/\s+/).filter(Boolean).length;
          if (wordCountB < 400) {
            toast({
              title: "Text B too short",
              description: `Need at least 400 words. Current: ${wordCountB} words.`,
              variant: "destructive",
            });
            setIsAnalyzingStylometrics(false);
            return;
          }
        }
        
        const response = await fetch('/api/stylometrics/holistic/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            username,
            authorName,
            authorNameB: stylometricsAuthorNameB.trim() || "Author Y",
            text: textToAnalyze,
            textB: isCompare ? stylometricsTextB : undefined,
            provider: selectedLLM,
            mode: isCompare ? 'compare' : 'single'
          })
        });

        if (!response.ok) {
          throw new Error('Failed to start holistic analysis');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

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
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.type === 'progress') {
                  setStylometricsProgress(parsed.progress);
                } else if (parsed.type === 'result') {
                  if (parsed.mode === 'compare') {
                    setHolisticStylometricsCompareResult(parsed.result);
                    toast({
                      title: "Comparison Complete",
                      description: `Verticality difference: ${parsed.result.comparison?.verticalityDifference?.toFixed(2) || 'N/A'}`,
                    });
                  } else {
                    setHolisticStylometricsResult(parsed.result);
                    toast({
                      title: "Analysis Complete",
                      description: `Verticality: ${parsed.result.aggregatedVerticalityScore?.toFixed(2) || 'N/A'} | Signal: ${parsed.result.signalScore}%`,
                    });
                  }
                  setStylometricsProgress({ stage: "complete", message: "Analysis complete" });
                } else if (parsed.type === 'error') {
                  throw new Error(parsed.error);
                }
              } catch (parseError) {
                console.error('Failed to parse SSE data:', parseError);
              }
            }
          }
        }
      } else {
        if (stylometricsTab === "single") {
          const response = await fetch('/api/stylometrics/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              username,
              authorName,
              sourceTitle: stylometricsSourceTitle,
              text: textToAnalyze,
              provider: selectedLLM
            })
          });
          
          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || "Analysis failed");
          }
          
          const data = await response.json();
          setStylometricsReport(data.report);
          setStylometricsData(data.data);
          
          toast({
            title: "Analysis Complete",
            description: `Verticality Score: ${data.data.verticalityScore?.toFixed(2) || 'N/A'}`,
          });
        } else {
          if (!stylometricsTextB.trim()) {
            toast({
              title: "Missing Text B",
              description: "Please provide both texts for comparison",
              variant: "destructive",
            });
            return;
          }
          
          const wordCountB = stylometricsTextB.split(/\s+/).filter(Boolean).length;
          if (wordCountB < 400) {
            toast({
              title: "Text B too short",
              description: `Need at least 400 words. Current: ${wordCountB} words.`,
              variant: "destructive",
            });
            return;
          }
          
          const authorNameB = stylometricsAuthorNameB.trim() || "Author Y";
          
          const response = await fetch('/api/stylometrics/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              username,
              textA: { text: stylometricsText, authorName },
              textB: { text: stylometricsTextB, authorName: authorNameB },
              provider: selectedLLM
            })
          });
          
          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || "Comparison failed");
          }
          
          const data = await response.json();
          setStylometricsReport(data.report);
          setStylometricsData(data.data);
          
          toast({
            title: "Comparison Complete",
            description: `Verticality difference: ${data.data.comparison?.verticalityDifference?.toFixed(2) || 'N/A'}`,
          });
        }
      }
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Analysis Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
      setStylometricsProgress({ stage: "error", message: error.message || "Analysis failed" });
    } finally {
      setIsAnalyzingStylometrics(false);
      fetchCredits();
    }
  };

  const handleMeasureIntelligence = async () => {
    const textToAnalyze = intelligenceTab === "single" ? (intelligenceTextA || text) : intelligenceTextA;
    
    if (!textToAnalyze.trim()) {
      toast({
        title: "Text required",
        description: "Please enter or paste text to analyze",
        variant: "destructive",
      });
      return;
    }
    
    setIsAnalyzingIntelligence(true);
    setIntelligenceResult(null);
    setIntelligenceCompareResult(null);
    setHolisticIntelResult(null);
    setIntelligenceProgress(null);
    
    try {
      if (intelligenceTab === "single") {
        if (useIntelOutlineMode) {
          const response = await fetch('/api/intelligence/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              text: textToAnalyze,
              provider: selectedLLM,
              username: username || undefined,
              author: intelligenceAuthor || undefined,
              useOutlineMode: true
            })
          });

          if (!response.ok) {
            throw new Error('Failed to start intelligence analysis');
          }

          const reader = response.body?.getReader();
          if (!reader) throw new Error('No response body');

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
                try {
                  const parsed = JSON.parse(line.slice(6));
                  if (parsed.type === 'progress') {
                    setIntelligenceProgress(parsed.progress);
                  } else if (parsed.type === 'result') {
                    setHolisticIntelResult(parsed.result);
                    setIntelligenceProgress({ stage: "complete", message: `Score: ${parsed.result.score}/100` });
                    toast({
                      title: "Intelligence Measured",
                      description: `Score: ${parsed.result.score}/100 (${parsed.result.quotes?.length || 0} signal quotes found)`,
                    });
                  } else if (parsed.type === 'error') {
                    throw new Error(parsed.error);
                  }
                } catch (parseError) {
                  console.error('Failed to parse SSE data:', parseError);
                }
              }
            }
          }
        } else {
          const result = await measureIntelligence(textToAnalyze, selectedLLM, username || undefined);
          setIntelligenceResult(result);
          
          toast({
            title: "Intelligence Measured",
            description: `Score: ${result.score}/100 (${result.quoteCount} sharp quotes found)`,
          });
        }
      } else {
        if (!intelligenceTextB.trim()) {
          toast({
            title: "Text B required",
            description: "Please provide both texts for comparison",
            variant: "destructive",
          });
          return;
        }
        
        const result = await compareIntelligence(textToAnalyze, intelligenceTextB, selectedLLM, username || undefined);
        setIntelligenceCompareResult(result);
        
        toast({
          title: "Comparison Complete",
          description: result.winner,
        });
      }
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Analysis Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
      setIntelligenceProgress({ stage: "error", message: error.message || "Analysis failed" });
    } finally {
      setIsAnalyzingIntelligence(false);
      fetchCredits();
    }
  };

  const handlePositionsFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setQuoteFinderPositions(content);
      toast({
        title: "Positions Loaded",
        description: `${file.name} - ${content.split('\n').filter(l => l.trim()).length} positions`,
      });
    };
    reader.onerror = () => {
      toast({ title: "Error reading file", variant: "destructive" });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleCorpusFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setQuoteFinderCorpus(content);
      const wordCount = content.split(/\s+/).filter(Boolean).length;
      toast({
        title: "Corpus Loaded",
        description: `${file.name} - ${wordCount} words`,
      });
    };
    reader.onerror = () => {
      toast({ title: "Error reading file", variant: "destructive" });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Corpus Manager handlers
  const loadCorpusAuthors = async () => {
    try {
      const response = await fetch("/api/corpus/authors");
      if (response.ok) {
        const authors = await response.json();
        setCorpusAuthors(authors);
      }
    } catch (error) {
      console.error("Failed to load corpus authors:", error);
    }
  };

  const loadCorpusStats = async () => {
    try {
      const response = await fetch("/api/corpus/stats");
      if (response.ok) {
        const stats = await response.json();
        setCorpusStats(stats);
      }
    } catch (error) {
      console.error("Failed to load corpus stats:", error);
    }
  };

  const loadAuthorWorks = async (authorId: number) => {
    try {
      const response = await fetch(`/api/corpus/authors/${authorId}/works`, { credentials: 'include' });
      if (response.ok) {
        const works = await response.json();
        setCorpusWorks(works);
      }
    } catch (error) {
      console.error("Failed to load author works:", error);
    }
  };

  const handleAddCorpusAuthor = async () => {
    if (!newAuthorName.trim()) {
      toast({ title: "Author name required", variant: "destructive" });
      return;
    }
    
    try {
      const response = await fetch("/api/corpus/authors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'include',
        body: JSON.stringify({
          name: newAuthorName.trim(),
          aliases: newAuthorAliases.trim() || null,
        }),
      });
      
      if (response.ok) {
        const author = await response.json();
        setCorpusAuthors([...corpusAuthors, author]);
        setNewAuthorName("");
        setNewAuthorAliases("");
        toast({ title: "Author Added", description: `${author.name} added to corpus` });
        loadCorpusStats();
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error, variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDeleteCorpusAuthor = async (authorId: number) => {
    try {
      const response = await fetch(`/api/corpus/authors/${authorId}`, { method: "DELETE", credentials: 'include' });
      if (response.ok) {
        setCorpusAuthors(corpusAuthors.filter(a => a.id !== authorId));
        if (selectedCorpusAuthor?.id === authorId) {
          setSelectedCorpusAuthor(null);
          setCorpusWorks([]);
        }
        toast({ title: "Author Deleted" });
        loadCorpusStats();
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleWorkContentFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setNewWorkContent(content);
      const wc = content.split(/\s+/).filter(Boolean).length;
      toast({ title: "File Loaded", description: `${file.name} - ${wc} words` });
    };
    reader.onerror = () => {
      toast({ title: "Error reading file", variant: "destructive" });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleUploadWork = async () => {
    if (!selectedCorpusAuthor) {
      toast({ title: "Select an author first", variant: "destructive" });
      return;
    }
    if (!newWorkTitle.trim()) {
      toast({ title: "Work title required", variant: "destructive" });
      return;
    }
    if (!newWorkContent.trim()) {
      toast({ title: "Work content required", variant: "destructive" });
      return;
    }
    
    setIsUploadingWork(true);
    try {
      const response = await fetch("/api/corpus/works", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'include',
        body: JSON.stringify({
          authorId: selectedCorpusAuthor.id,
          title: newWorkTitle.trim(),
          content: newWorkContent,
        }),
      });
      
      if (response.ok) {
        const result = await response.json();
        toast({ title: "Work Uploaded", description: result.message });
        setNewWorkTitle("");
        setNewWorkContent("");
        loadAuthorWorks(selectedCorpusAuthor.id);
        loadCorpusStats();
      } else {
        const error = await response.json();
        toast({ title: "Error", description: error.error, variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsUploadingWork(false);
    }
  };

  const handleDeleteWork = async (workId: number) => {
    try {
      const response = await fetch(`/api/corpus/works/${workId}`, { method: "DELETE", credentials: 'include' });
      if (response.ok) {
        setCorpusWorks(corpusWorks.filter(w => w.id !== workId));
        toast({ title: "Work Deleted" });
        loadCorpusStats();
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleExtractPositions = async () => {
    if (!text.trim()) {
      toast({
        title: "Text required",
        description: "Please enter or upload text to extract positions from.",
        variant: "destructive",
      });
      return;
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    
    // For small texts without outline mode, use basic analysis
    if (!useOutlineMode && wordCount <= 2000) {
      handleProcess('views');
      setShowPositionExtractor(false);
      return;
    }

    setIsExtractingPositions(true);
    setExtractedPositions([]);
    setPositionExtractionSummary("");
    setPositionExtractorProgress({ 
      stage: useOutlineMode ? "outlining" : "starting", 
      message: useOutlineMode ? "Generating structured outline of full text..." : "Initializing extraction..." 
    });

    try {
      const response = await fetch('/api/positions/extract/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text,
          provider: selectedLLM,
          username: username || undefined,
          useOutlineMode,
          author: positionExtractorAuthor.trim() || undefined,
          depth: positionExtractionDepth
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start position extraction');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      console.log('[PositionExtractor] Starting to read SSE stream...');
      let eventCount = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[PositionExtractor] Stream done, received', eventCount, 'events');
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        console.log('[PositionExtractor] Received chunk, buffer length:', buffer.length);
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              eventCount++;
              console.log('[PositionExtractor] Event #' + eventCount + ':', parsed.type, parsed.stage || '', parsed.message?.substring(0, 50) || '');
              
              if (parsed.type === 'progress') {
                setPositionExtractorProgress({
                  stage: parsed.stage,
                  message: parsed.message,
                  current: parsed.current,
                  total: parsed.total
                });
              } else if (parsed.type === 'complete') {
                console.log('[PositionExtractor] COMPLETE! Positions:', parsed.result.positions?.length);
                setExtractedPositions(parsed.result.positions || []);
                setPositionExtractionSummary(parsed.result.summary || "");
                setPositionExtractorProgress({ stage: "complete", message: `Found ${parsed.result.positions?.length || 0} unique positions` });
                toast({
                  title: "Extraction Complete",
                  description: `Extracted ${parsed.result.positions?.length || 0} positions from ${parsed.result.sections?.length || 0} sections`,
                });
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError, 'Raw:', data.substring(0, 100));
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Position extraction error:', error);
      toast({
        title: "Extraction Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
      setPositionExtractorProgress({ stage: "error", message: error.message || "Extraction failed" });
    } finally {
      setIsExtractingPositions(false);
      fetchCredits();
    }
  };

  const copyPositionsToClipboard = () => {
    const formatted = extractedPositions
      .map(p => `${p.author} | ${p.quote} | ${p.source}`)
      .join('\n');
    navigator.clipboard.writeText(formatted);
    toast({ title: "Copied", description: "Positions copied to clipboard" });
  };

  const downloadPositions = () => {
    const formatted = extractedPositions
      .map(p => `${p.author} | ${p.quote} | ${p.source}`)
      .join('\n');
    const blob = new Blob([formatted], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'extracted_positions.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleTractatusRewrite = async () => {
    if (!text.trim()) {
      toast({
        title: "Text required",
        description: "Please enter or upload text to rewrite.",
        variant: "destructive",
      });
      return;
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 100) {
      toast({
        title: "Text too short",
        description: `Need at least 100 words. Current: ${wordCount} words.`,
        variant: "destructive",
      });
      return;
    }

    setIsRewritingTractatus(true);
    setTractatusOutput("");
    setTractatusProgress({ stage: "rewriting", message: "Starting Tractatus rewrite..." });

    try {
      const response = await fetch('/api/rewrite/tractatus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text,
          provider: selectedLLM,
          username: username || undefined,
          useOutlineMode: useTractatusOutlineMode,
          includeBulletMarkers
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start Tractatus rewrite');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

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
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'progress') {
                setTractatusProgress({
                  stage: parsed.stage,
                  message: parsed.message,
                  current: parsed.current,
                  total: parsed.total
                });
              } else if (parsed.type === 'complete') {
                setTractatusOutput(parsed.result.rewrittenText || "");
                setTractatusProgress({ stage: "complete", message: `Rewrite complete: ${parsed.result.statementsCount} statements` });
                toast({
                  title: "Rewrite Complete",
                  description: `Generated ${parsed.result.statementsCount} statements`,
                });
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Tractatus rewrite error:', error);
      toast({
        title: "Rewrite Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
      setTractatusProgress({ stage: "error", message: error.message || "Rewrite failed" });
    } finally {
      setIsRewritingTractatus(false);
      fetchCredits();
    }
  };

  const copyTractatusOutput = () => {
    navigator.clipboard.writeText(tractatusOutput);
    toast({ title: "Copied", description: "Tractatus rewrite copied to clipboard" });
  };

  const downloadTractatusOutput = (format: 'md' | 'txt' = 'txt') => {
    const mimeType = format === 'md' ? 'text/markdown' : 'text/plain';
    const blob = new Blob([tractatusOutput], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tractatus_rewrite.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerateTractatusTree = async () => {
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 100) {
      toast({
        title: "Text too short",
        description: `Need at least 100 words. Current: ${wordCount} words.`,
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingTree(true);
    setTractatusTreeColumns([]);
    setTractatusTreeProgress({ current: 0, total: 3, message: "Starting Tractatus Tree generation..." });

    try {
      const response = await fetch('/api/tractatus-tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text,
          provider: selectedLLM,
          username: username || undefined
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start Tractatus Tree generation');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

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
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'progress') {
                setTractatusTreeProgress({
                  current: parsed.current,
                  total: parsed.total,
                  message: parsed.message
                });
              } else if (parsed.type === 'complete') {
                setTractatusTreeColumns(parsed.result.columns || []);
                setTractatusTreeMaxDepth(parsed.result.maxDepth || 0);
                setTractatusTreeProgress({ current: 3, total: 3, message: `Complete: ${parsed.result.totalStatements} statements across ${parsed.result.columns?.length || 0} abstraction levels` });
                toast({
                  title: "Tractatus Tree Complete",
                  description: `Generated ${parsed.result.totalStatements} statements with ${parsed.result.maxDepth + 1} levels of depth`,
                });
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Tractatus Tree error:', error);
      toast({
        title: "Generation Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
      setTractatusTreeProgress({ current: 0, total: 3, message: error.message || "Generation failed" });
    } finally {
      setIsGeneratingTree(false);
      fetchCredits();
    }
  };

  const handleGenerateSummary = async () => {
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 50) {
      toast({
        title: "Text too short",
        description: `Need at least 50 words. Current: ${wordCount} words.`,
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingSummary(true);
    setSummaryResult(null);
    setSummaryProgress({ current: 0, total: 5, message: "Starting summary generation..." });

    try {
      const response = await fetch('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text,
          resolution: summaryResolution,
          recognizeContentSections: summaryRecognizeContent,
          provider: selectedLLM
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start summary generation');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

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
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'progress') {
                setSummaryProgress({
                  current: parsed.current,
                  total: parsed.total,
                  message: parsed.message
                });
              } else if (parsed.type === 'complete') {
                setSummaryResult(parsed.result);
                setSummaryProgress({ current: parsed.result.totalSections, total: parsed.result.totalSections, message: `Complete: ${parsed.result.totalSections} section(s) summarized` });
                toast({
                  title: "Summary Complete",
                  description: `Generated ${parsed.result.totalSections} section summary`,
                });
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Summary error:', error);
      toast({
        title: "Generation Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
      setSummaryProgress({ current: 0, total: 5, message: error.message || "Generation failed" });
    } finally {
      setIsGeneratingSummary(false);
      fetchCredits();
    }
  };

  const getResolutionLabel = (res: number): string => {
    switch (res) {
      case 0: return "Lowest (1-2 paragraphs for entire work)";
      case 1: return "Low (per major part/division)";
      case 2: return "Medium (per chapter)";
      case 3: return "High (per section)";
      case 4: return "Highest (per subsection)";
      default: return `Level ${res}`;
    }
  };

  const copyTractatusTreeColumn = (columnIndex: number) => {
    const column = tractatusTreeColumns[columnIndex];
    if (!column) return;
    const text = column.map(s => `${s.number} ${s.text}`).join('\n');
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: `Column ${columnIndex + 1} copied to clipboard` });
  };

  const downloadTractatusTree = () => {
    const docTitle = tractatusTreeTitle.trim() || "TRACTATUS TREE";
    let content = `${docTitle}\n`;
    content += "=".repeat(docTitle.length) + "\n\n";
    
    tractatusTreeColumns.forEach((column, idx) => {
      // Level 1, Level 2, Level 3, etc.
      const levelName = `Level ${idx + 1}`;
      content += `--- ${levelName} (${column.length} statements) ---\n\n`;
      column.forEach(s => {
        content += `${s.number} ${s.text}\n`;
      });
      content += "\n\n";
    });
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tractatus_tree.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadTractatusTreeWord = async () => {
    const paragraphs: Paragraph[] = [];
    
    // Title - Heading 1 (use custom title or default)
    const docTitle = tractatusTreeTitle.trim() || "TRACTATUS TREE";
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: docTitle, bold: true, size: 32 })],
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
      })
    );
    
    
    tractatusTreeColumns.forEach((column, idx) => {
      // Level 1, Level 2, Level 3, etc. (idx 0 = Level 1, idx 1 = Level 2, etc.)
      const levelName = `Level ${idx + 1}`;
      
      // Section header - Heading 2
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: `${levelName} (${column.length} statements)`, bold: true, size: 28 })],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 },
        })
      );
      
      // Each statement - clean, no bullets or hyphens
      column.forEach(s => {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({ text: s.number, bold: true, size: 22 }),
              new TextRun({ text: `  ${s.text}`, size: 22 }),
            ],
            spacing: { after: 120 },
            indent: { left: 200 * s.depth },
          })
        );
      });
      
      // Add space between sections
      paragraphs.push(new Paragraph({ spacing: { after: 300 } }));
    });
    
    const doc = new Document({
      sections: [{ properties: {}, children: paragraphs }],
    });
    
    const blob = await Packer.toBlob(doc);
    saveAs(blob, "tractatus_tree.docx");
    toast({ title: "Downloaded", description: "Tractatus Tree saved as Word document" });
  };

  const handleExtractArguments = async () => {
    if (!text.trim()) {
      toast({
        title: "Text required",
        description: "Please enter or upload text to extract arguments from.",
        variant: "destructive",
      });
      return;
    }

    if (!argumentsFinderAuthor.trim()) {
      toast({
        title: "Author required",
        description: "Please enter the author's name.",
        variant: "destructive",
      });
      return;
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 400) {
      toast({
        title: "Text too short",
        description: `Need at least 400 words. Current: ${wordCount} words.`,
        variant: "destructive",
      });
      return;
    }

    setIsExtractingArguments(true);
    setExtractedArguments([]);
    setArgumentsMarkdown("");
    setArgumentsFinderProgress({ 
      stage: useArgumentsOutlineMode ? "outlining" : "extracting", 
      message: useArgumentsOutlineMode ? "Generating structured outline of full text..." : "Initializing extraction..." 
    });

    try {
      const response = await fetch('/api/arguments/extract/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text,
          provider: selectedLLM,
          username: username || undefined,
          useOutlineMode: useArgumentsOutlineMode,
          author: argumentsFinderAuthor.trim(),
          depth: argumentsExtractionDepth
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start argument extraction');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

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
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'progress') {
                setArgumentsFinderProgress({
                  stage: parsed.stage,
                  message: parsed.message,
                  current: parsed.current,
                  total: parsed.total
                });
              } else if (parsed.type === 'complete') {
                setExtractedArguments(parsed.result.arguments || []);
                setArgumentsMarkdown(parsed.result.markdown || "");
                const argCount = parsed.result.arguments?.length || 0;
                const failedSections = parsed.result.failedSections || 0;
                const hasErrors = parsed.result.errors && parsed.result.errors.length > 0;
                
                if (argCount === 0 && hasErrors) {
                  const firstError = parsed.result.errors[0] || "Unknown error";
                  setArgumentsFinderProgress({ stage: "error", message: firstError });
                  toast({
                    title: "Extraction Failed",
                    description: firstError.substring(0, 100),
                    variant: "destructive",
                  });
                } else {
                  setArgumentsFinderProgress({ 
                    stage: "complete", 
                    message: `Found ${argCount} unique arguments${failedSections > 0 ? ` (${failedSections} sections failed)` : ''}` 
                  });
                  toast({
                    title: "Extraction Complete",
                    description: `Extracted ${argCount} arguments${failedSections > 0 ? ` (${failedSections} sections failed)` : ''}`,
                    variant: failedSections > 0 ? "default" : "default",
                  });
                }
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Argument extraction error:', error);
      toast({
        title: "Extraction Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
      setArgumentsFinderProgress({ stage: "error", message: error.message || "Extraction failed" });
    } finally {
      setIsExtractingArguments(false);
      fetchCredits();
    }
  };

  const copyArgumentsToClipboard = () => {
    navigator.clipboard.writeText(argumentsMarkdown);
    toast({ title: "Copied", description: "Arguments copied to clipboard" });
  };

  const downloadArguments = (format: 'md' | 'txt' = 'md') => {
    const content = argumentsMarkdown;
    const mimeType = format === 'md' ? 'text/markdown' : 'text/plain';
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extracted_arguments.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadStylometricsReport = (format: 'md' | 'txt' = 'txt') => {
    let content = '';
    if (holisticStylometricsResult) {
      content = `Stylometric Analysis Report
========================
Author: ${holisticStylometricsResult.authorName || 'Unknown'}
Verticality Score: ${holisticStylometricsResult.aggregatedVerticalityScore?.toFixed(2) || 'N/A'}
Signal Score: ${holisticStylometricsResult.signalScore || 'N/A'}%
Classification: ${holisticStylometricsResult.classification || 'N/A'}
Abstraction Level: ${holisticStylometricsResult.abstractionLevel || 'N/A'}
Closest Author Match: ${holisticStylometricsResult.closestAuthorMatch || 'N/A'}

Description:
${holisticStylometricsResult.abstractionDescription || ''}

${holisticStylometricsResult.signaturePhrases?.length > 0 ? `Signature Phrases:\n${holisticStylometricsResult.signaturePhrases.join('\n')}` : ''}

${holisticStylometricsResult.narrativeSummary ? `Narrative Summary:\n${holisticStylometricsResult.narrativeSummary}` : ''}
`;
    } else if (holisticStylometricsCompareResult) {
      content = `Stylometric Comparison Report
============================
Verdict: ${holisticStylometricsCompareResult.verdict || ''}

Text A (${holisticStylometricsCompareResult.textA?.authorName}):
- Verticality: ${holisticStylometricsCompareResult.textA?.aggregatedVerticalityScore?.toFixed(2)}
- Classification: ${holisticStylometricsCompareResult.textA?.classification}
- Closest Match: ${holisticStylometricsCompareResult.textA?.closestAuthorMatch}

Text B (${holisticStylometricsCompareResult.textB?.authorName}):
- Verticality: ${holisticStylometricsCompareResult.textB?.aggregatedVerticalityScore?.toFixed(2)}
- Classification: ${holisticStylometricsCompareResult.textB?.classification}
- Closest Match: ${holisticStylometricsCompareResult.textB?.closestAuthorMatch}

Verticality Difference: ${holisticStylometricsCompareResult.comparison?.verticalityDifference?.toFixed(2)}

${holisticStylometricsCompareResult.comparison?.keyDivergences?.map((d: any) => `${d.feature}: ${d.analysis}`).join('\n') || ''}

${holisticStylometricsCompareResult.comparison?.sameRoomScenario ? `If They Met:\n${holisticStylometricsCompareResult.comparison.sameRoomScenario}` : ''}
`;
    } else if (stylometricsReport) {
      content = stylometricsReport;
    }
    
    const mimeType = format === 'md' ? 'text/markdown' : 'text/plain';
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stylometric_report.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleStylometricsFileUploadB = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setStylometricsTextB(text);
    };
    reader.readAsText(file);
  };

  const handleRunCustomAnalysis = async () => {
    if (!text.trim()) {
      toast({
        title: "Text required",
        description: "Please enter or upload text to analyze.",
        variant: "destructive",
      });
      return;
    }

    if (!customInstructions.trim() || customInstructions.trim().length < 5) {
      toast({
        title: "Instructions required",
        description: "Please enter your custom instructions (at least 5 characters).",
        variant: "destructive",
      });
      return;
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 400) {
      toast({
        title: "Text too short",
        description: `Need at least 400 words for holistic analysis. Current: ${wordCount} words.`,
        variant: "destructive",
      });
      return;
    }

    setIsRunningCustomAnalysis(true);
    setCustomAnalyzerOutput("");
    setCustomAnalyzerProgress({ 
      stage: useCustomOutlineMode ? "outlining" : "processing", 
      message: useCustomOutlineMode ? "Generating structured outline for holistic comprehension..." : "Processing text..." 
    });

    try {
      const response = await fetch('/api/custom/analyze/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text,
          provider: selectedLLM,
          username: username || undefined,
          useOutlineMode: useCustomOutlineMode,
          instructions: customInstructions.trim(),
          desiredWordCount: customOutputWordCount ? parseInt(customOutputWordCount) : undefined
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start custom analysis');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

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
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'progress') {
                setCustomAnalyzerProgress({
                  stage: parsed.stage,
                  message: parsed.message,
                  current: parsed.current,
                  total: parsed.total
                });
              } else if (parsed.type === 'complete') {
                setCustomAnalyzerOutput(parsed.result.result || parsed.result.output || "");
                const chunks = parsed.result.chunkCount || parsed.result.sectionsProcessed || 0;
                setCustomAnalyzerProgress({ stage: "complete", message: `Analysis complete: processed ${chunks} sections` });
                toast({
                  title: "Analysis Complete",
                  description: `Processed ${chunks} sections`,
                });
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Custom analysis error:', error);
      toast({
        title: "Analysis Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
      setCustomAnalyzerProgress({ stage: "error", message: error.message || "Analysis failed" });
    } finally {
      setIsRunningCustomAnalysis(false);
      fetchCredits();
    }
  };

  const copyCustomOutput = () => {
    navigator.clipboard.writeText(customAnalyzerOutput);
    toast({ title: "Copied", description: "Output copied to clipboard" });
  };

  const downloadCustomOutput = () => {
    const blob = new Blob([customAnalyzerOutput], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'custom_analysis.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExtractQuotes = async () => {
    if (!text.trim()) {
      toast({
        title: "Text required",
        description: "Please enter or upload text to extract quotes from.",
        variant: "destructive",
      });
      return;
    }

    if (!quoteExtractorAuthor.trim()) {
      toast({
        title: "Author required",
        description: "Please enter the author's name.",
        variant: "destructive",
      });
      return;
    }

    setIsExtractingQuotes(true);
    setExtractedQuotes([]);
    setQuoteExtractionSummary("");
    setQuoteExtractorProgress({ 
      stage: useQuoteOutlineMode ? "outlining" : "starting", 
      message: useQuoteOutlineMode ? "Generating structured outline of full text..." : "Initializing extraction..." 
    });

    try {
      const response = await fetch('/api/quotes/extract/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text,
          provider: selectedLLM,
          username: username || undefined,
          useOutlineMode: useQuoteOutlineMode,
          author: quoteExtractorAuthor.trim(),
          depth: extractionDensity
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start quote extraction');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

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
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'progress') {
                setQuoteExtractorProgress({
                  stage: parsed.stage,
                  message: parsed.message,
                  current: parsed.current,
                  total: parsed.total
                });
              } else if (parsed.type === 'complete') {
                setExtractedQuotes(parsed.result.quotes || []);
                setQuoteExtractionSummary(parsed.result.summary || "");
                setQuoteExtractorProgress({ stage: "complete", message: `Found ${parsed.result.quotes?.length || 0} unique quotes` });
                toast({
                  title: "Extraction Complete",
                  description: `Extracted ${parsed.result.quotes?.length || 0} quotes`,
                });
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Quote extraction error:', error);
      toast({
        title: "Extraction Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
      setQuoteExtractorProgress({ stage: "error", message: error.message || "Extraction failed" });
    } finally {
      setIsExtractingQuotes(false);
      fetchCredits();
    }
  };

  const copyQuotesToClipboard = () => {
    const formatted = extractedQuotes
      .map((q) => `${q.author} | ${q.quote} | ${q.topic}`)
      .join('\n');
    navigator.clipboard.writeText(formatted);
    toast({ title: "Copied", description: "Quotes copied to clipboard" });
  };

  const downloadQuotes = () => {
    const formatted = extractedQuotes
      .map((q) => `${q.author} | ${q.quote} | ${q.topic}`)
      .join('\n');
    const blob = new Blob([formatted], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'extracted_quotes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerateOutline = async () => {
    if (!text.trim()) {
      toast({
        title: "Text required",
        description: "Please enter or upload text to generate an outline.",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingOutline(true);
    setOutline(null);

    try {
      const response = await fetch('/api/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text, username })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }

      const result = await response.json();
      setOutline(result);
      setShowOutlinePanel(true);
      toast({
        title: "Outline Generated",
        description: `Identified ${result.totalSections} sections`,
      });
    } catch (error: any) {
      console.error('Outline generation error:', error);
      toast({
        title: "Generation Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingOutline(false);
      fetchCredits();
    }
  };

  const copyOutlineJSON = () => {
    if (outline) {
      navigator.clipboard.writeText(JSON.stringify(outline, null, 2));
      toast({ title: "Copied", description: "Outline JSON copied to clipboard" });
    }
  };

  const copyOutlineTXT = () => {
    if (!outline) return;
    
    let content = `DOCUMENT OUTLINE\n${'='.repeat(50)}\n\n`;
    content += `SUMMARY: ${outline.taskSummary}\n\n`;
    if ((outline as any).documentType) {
      content += `DOCUMENT TYPE: ${(outline as any).documentType}\n`;
    }
    if ((outline as any).mainThesis) {
      content += `MAIN THESIS: ${(outline as any).mainThesis}\n`;
    }
    content += `TOTAL SECTIONS: ${outline.totalSections}\n\n`;
    content += `${'='.repeat(50)}\n\n`;
    
    outline.sections.forEach((section, i) => {
      content += `${i + 1}. ${section.title.toUpperCase()}\n`;
      content += `${'-'.repeat(40)}\n`;
      content += `${section.description}\n\n`;
      
      if ((section as any).mainPoints && (section as any).mainPoints.length > 0) {
        content += `Main Points:\n`;
        (section as any).mainPoints.forEach((point: string, j: number) => {
          content += `  ${j + 1}. ${point}\n`;
        });
        content += `\n`;
      }
      
      if ((section as any).keyTerms && (section as any).keyTerms.length > 0) {
        content += `Key Terms: ${(section as any).keyTerms.join(', ')}\n`;
      }
      
      if (section.keyThemes.length > 0) {
        content += `Key Themes: ${section.keyThemes.join(', ')}\n`;
      }
      
      content += `Word Count: ~${section.wordCount} words\n\n`;
    });
    
    navigator.clipboard.writeText(content);
    toast({ title: "Copied", description: "Outline copied as plain text" });
  };

  const downloadOutline = (format: 'json' | 'md' | 'txt' = 'md') => {
    if (!outline) return;
    
    let content = '';
    let mimeType = 'text/plain';
    
    if (format === 'json') {
      content = JSON.stringify(outline, null, 2);
      mimeType = 'application/json';
    } else if (format === 'md') {
      content = `# Document Outline\n\n`;
      content += `**Summary:** ${outline.taskSummary}\n\n`;
      if ((outline as any).documentType) {
        content += `**Document Type:** ${(outline as any).documentType}\n\n`;
      }
      if ((outline as any).mainThesis) {
        content += `**Main Thesis:** ${(outline as any).mainThesis}\n\n`;
      }
      content += `**Total Sections:** ${outline.totalSections}\n\n`;
      content += `---\n\n`;
      outline.sections.forEach((section, i) => {
        content += `## ${i + 1}. ${section.title}\n\n`;
        content += `${section.description}\n\n`;
        if ((section as any).mainPoints && (section as any).mainPoints.length > 0) {
          content += `### Main Points\n`;
          (section as any).mainPoints.forEach((point: string, j: number) => {
            content += `${j + 1}. ${point}\n`;
          });
          content += `\n`;
        }
        if ((section as any).keyTerms && (section as any).keyTerms.length > 0) {
          content += `**Key Terms:** ${(section as any).keyTerms.join(', ')}\n\n`;
        }
        if (section.keyThemes.length > 0) {
          content += `**Key Themes:** ${section.keyThemes.join(', ')}\n\n`;
        }
        content += `**Word Count:** ~${section.wordCount} words\n\n`;
        content += `---\n\n`;
      });
      mimeType = 'text/markdown';
    } else {
      content = `DOCUMENT OUTLINE\n`;
      content += `${'='.repeat(50)}\n\n`;
      content += `Summary: ${outline.taskSummary}\n\n`;
      if ((outline as any).documentType) {
        content += `Document Type: ${(outline as any).documentType}\n`;
      }
      if ((outline as any).mainThesis) {
        content += `Main Thesis: ${(outline as any).mainThesis}\n`;
      }
      content += `Total Sections: ${outline.totalSections}\n\n`;
      content += `${'='.repeat(50)}\n\n`;
      outline.sections.forEach((section, i) => {
        content += `${i + 1}. ${section.title.toUpperCase()}\n`;
        content += `${'-'.repeat(40)}\n`;
        content += `${section.description}\n\n`;
        if ((section as any).mainPoints && (section as any).mainPoints.length > 0) {
          content += `Main Points:\n`;
          (section as any).mainPoints.forEach((point: string, j: number) => {
            content += `  ${j + 1}. ${point}\n`;
          });
          content += `\n`;
        }
        if ((section as any).keyTerms && (section as any).keyTerms.length > 0) {
          content += `Key Terms: ${(section as any).keyTerms.join(', ')}\n`;
        }
        if (section.keyThemes.length > 0) {
          content += `Key Themes: ${section.keyThemes.join(', ')}\n`;
        }
        content += `Word Count: ~${section.wordCount}\n\n`;
      });
    }
    
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `document_outline.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFullDocumentRewrite = async () => {
    if (!text.trim()) {
      toast({
        title: "Text required",
        description: "Please enter or upload text to rewrite.",
        variant: "destructive",
      });
      return;
    }

    setIsRewriting(true);
    setRewrittenDocument("");
    setRewriteProgress({ current: 0, total: 1, message: "Generating outline..." });

    try {
      // Step 1: Generate outline first
      const outlineResponse = await fetch('/api/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text, username })
      });

      if (!outlineResponse.ok) {
        throw new Error("Failed to generate outline");
      }

      const outlineResult = await outlineResponse.json();
      setOutline(outlineResult);
      
      if (showRewriteOutlineFirst) {
        setShowOutlinePanel(true);
      }

      // Guard against empty or missing sections
      if (!outlineResult.sections || outlineResult.sections.length === 0) {
        throw new Error("Outline generation returned no sections. Please try again.");
      }

      const totalSections = outlineResult.totalSections || outlineResult.sections?.length || 1;
      setRewriteProgress({ current: 0, total: totalSections, message: "Starting rewrite..." });

      // Step 2: Rewrite the document using the outline
      const rewriteResponse = await fetch('/api/rewrite/full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text,
          outline: outlineResult,
          instructions: rewriteInstructions,
          username
        })
      });

      if (!rewriteResponse.ok) {
        throw new Error("Rewrite request failed");
      }

      // Handle SSE streaming
      const reader = rewriteResponse.body?.getReader();
      const decoder = new TextDecoder();
      let fullRewrite = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.type === 'progress') {
                setRewriteProgress({
                  current: parsed.current || 0,
                  total: parsed.total || totalSections,
                  message: parsed.message || "Rewriting..."
                });
              } else if (parsed.type === 'content') {
                fullRewrite += parsed.content;
                setRewrittenDocument(fullRewrite);
              } else if (parsed.type === 'complete') {
                setRewrittenDocument(parsed.result || fullRewrite);
                toast({
                  title: "Rewrite Complete",
                  description: `Document rewritten with ${outlineResult.totalSections} sections`,
                });
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Rewrite error:', error);
      toast({
        title: "Rewrite Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsRewriting(false);
      setRewriteProgress(null);
      fetchCredits();
    }
  };

  const copyRewrittenDocument = () => {
    navigator.clipboard.writeText(rewrittenDocument);
    toast({ title: "Copied", description: "Rewritten document copied to clipboard" });
  };

  const downloadRewrittenDocument = () => {
    const blob = new Blob([rewrittenDocument], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rewritten_document.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Write From Scratch handler
  const handleWriteFromScratch = async () => {
    if (!writeFromScratchPrompt.trim()) {
      toast({ title: "Missing Prompt", description: "Please enter a writing prompt", variant: "destructive" });
      return;
    }

    setIsWritingFromScratch(true);
    setWriteFromScratchProgress({ current: 0, total: 1, message: "Starting..." });
    setGeneratedDocument("");

    try {
      const response = await fetch('/api/write-from-scratch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          prompt: writeFromScratchPrompt,
          targetWords: parseInt(writeFromScratchTargetWords) || 10000,
          provider: selectedLLM,
          username
        })
      });

      if (!response.ok) {
        throw new Error("Write from scratch request failed");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let generated = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.type === 'progress') {
                setWriteFromScratchProgress({
                  current: parsed.current || 0,
                  total: parsed.total || 1,
                  message: parsed.message || "Writing...",
                  phase: parsed.phase
                });
              } else if (parsed.type === 'content') {
                generated += parsed.content;
                setGeneratedDocument(generated);
              } else if (parsed.type === 'complete') {
                setGeneratedDocument(parsed.result || generated);
                toast({
                  title: "Document Generated",
                  description: `Created ${parsed.wordCount?.toLocaleString() || 'a new'} word document`,
                });
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Write from scratch error:', error);
      toast({
        title: "Generation Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsWritingFromScratch(false);
      setWriteFromScratchProgress(null);
      fetchCredits();
    }
  };

  const copyGeneratedDocument = () => {
    navigator.clipboard.writeText(generatedDocument);
    toast({ title: "Copied", description: "Generated document copied to clipboard" });
  };

  const downloadGeneratedDocument = () => {
    const blob = new Blob([generatedDocument], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'generated_document.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Generic refine function for all outputs
  const handleRefineOutput = async (
    currentOutput: string,
    refineInstructions: string,
    setOutput: (val: string) => void,
    setProgress: (val: any) => void,
    setIsProcessing: (val: boolean) => void,
    outputType: string
  ) => {
    if (!refineInstructions.trim()) {
      toast({ title: "Missing Instructions", description: "Please enter refinement instructions", variant: "destructive" });
      return;
    }

    setIsProcessing(true);
    setProgress({ stage: "refining", message: "Refining output with your instructions..." });

    try {
      const response = await fetch('/api/refine-output', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentOutput,
          refineInstructions: refineInstructions.trim(),
          outputType,
          provider: selectedLLM,
          username
        })
      });

      if (!response.ok) {
        throw new Error("Refinement request failed");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let refined = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.type === 'progress') {
                setProgress({ stage: parsed.stage || "refining", message: parsed.message || "Refining..." });
              } else if (parsed.type === 'content') {
                refined += parsed.content;
                setOutput(refined);
              } else if (parsed.type === 'complete') {
                setOutput(parsed.result || refined);
                toast({ title: "Refinement Complete", description: "Output has been refined with your instructions" });
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error);
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Refine error:', error);
      toast({ title: "Refinement Failed", description: error.message || "Unknown error", variant: "destructive" });
    } finally {
      setIsProcessing(false);
      setProgress(null);
      fetchCredits();
    }
  };

  const handleFindQuotes = async () => {
    if (!quoteFinderAuthor.trim()) {
      toast({
        title: "Author required",
        description: "Please enter the author name",
        variant: "destructive",
      });
      return;
    }
    
    if (!quoteFinderPositions.trim()) {
      toast({
        title: "Positions required",
        description: "Please enter at least one position (one per line)",
        variant: "destructive",
      });
      return;
    }
    
    setIsSearchingQuotes(true);
    setQuoteFinderResults([]);
    setQuoteFinderError(null);
    
    try {
      const positionsArray = quoteFinderPositions
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);
      
      if (quoteFinderSource === "database") {
        // Search internal corpus database
        const results: any[] = [];
        
        for (const position of positionsArray) {
          // Extract key terms from the position for searching
          const searchTerms = position.split(/\s+/).filter(word => word.length > 4).slice(0, 3);
          
          for (const term of searchTerms) {
            const response = await fetch("/api/corpus/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: 'include',
              body: JSON.stringify({
                authorName: quoteFinderAuthor.trim(),
                searchTerm: term,
              }),
            });
            
            if (response.ok) {
              const data = await response.json();
              if (data.results && data.results.length > 0) {
                // Get the first matching section's content as a quote
                const match = data.results[0];
                results.push({
                  position,
                  quote: match.section.content.substring(0, 500) + (match.section.content.length > 500 ? "..." : ""),
                  source: `${match.workTitle} (Section ${match.section.sectionNumber})`
                });
                break; // Found a match for this position
              }
            }
          }
        }
        
        if (results.length === 0) {
          setQuoteFinderError(`No matching quotes found in internal database for ${quoteFinderAuthor}. Try using LLM Knowledge instead, or upload the author's works to the corpus.`);
          toast({
            title: "No Results",
            description: "No matching quotes found in internal database",
            variant: "destructive",
          });
        } else {
          setQuoteFinderResults(results);
          toast({
            title: "Quotes Found",
            description: `Found ${results.length} quote(s) from internal database`,
          });
        }
      } else {
        // Use LLM knowledge (original behavior)
        const corpusToUse = quoteFinderCorpus.trim() || text.trim() || "";
        
        const response = await fetch("/api/find-quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: 'include',
          body: JSON.stringify({
            author: quoteFinderAuthor.trim(),
            positions: positionsArray,
            corpus: corpusToUse,
            provider: selectedLLM,
          }),
        });
        
        if (response.status === 422) {
          const error = await response.json();
          setQuoteFinderError(error.error || "Corpus text required for this author");
          toast({
            title: "Corpus Required",
            description: error.error,
            variant: "destructive",
          });
          return;
        }
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to find quotes");
        }
        
        const data = await response.json();
        setQuoteFinderResults(data.results || []);
        
        toast({
          title: "Quotes Found",
          description: `Found ${data.results?.length || 0} quote(s) for ${positionsArray.length} position(s)`,
        });
      }
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Search Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsSearchingQuotes(false);
      fetchCredits();
    }
  };

  const handleSaveStylometricProfile = async () => {
    if (!username) {
      toast({
        title: "Login required",
        description: "Please log in to save profiles",
        variant: "destructive",
      });
      return;
    }
    
    if (!stylometricsData) {
      toast({
        title: "No data to save",
        description: "Run an analysis first",
        variant: "destructive",
      });
      return;
    }
    
    const authorNameToSave = stylometricsAuthorName.trim() || "Author X";
    
    try {
      const response = await fetch('/api/stylometrics/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username,
          authorName: authorNameToSave,
          sourceTitle: stylometricsSourceTitle,
          data: stylometricsData,
          fullReport: stylometricsReport
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Save failed");
      }
      
      const data = await response.json();
      toast({
        title: data.message,
        description: `Saved profile for ${authorNameToSave}`,
      });
      
      loadSavedAuthors(username);
    } catch (error: any) {
      toast({
        title: "Save Failed",
        description: error.message || "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleClearInput = () => {
    setText("");
    toast({ description: "Input cleared" });
  };

  const handleClearOutput = () => {
    setHasResult(false);
    setResult(null);
    toast({ description: "Results cleared" });
  };

  const generateReportContent = () => {
    if (!result) return "";
    const safeQuotes = (result.quotes || []).filter(q => q);
    const safeAnnotated = (result.annotatedQuotes || []).filter(q => q && q.quote);
    const safeViews = (result.views || []).filter(v => v && v.view);
    
    // Only include sections that have actual content
    const sections: string[] = [];
    
    sections.push(`TEXT INTELLIGENCE REPORT
Generated: ${new Date().toLocaleString()}
Source Length: ${text.split(/\s+/).filter(Boolean).length} words
LLM Used: ${selectedLLM}`);
    
    if (safeQuotes.length > 0) {
      sections.push(`--- KEY QUOTATIONS ---
${safeQuotes.map((q, i) => `${i+1}. ${q}`).join('\n')}`);
    }
    
    if (safeAnnotated.length > 0) {
      sections.push(`--- ANNOTATED CITATIONS ---
${safeAnnotated.map((q, i) => `"${q.quote}"\n   > Context: ${q.context || ''}`).join('\n\n')}`);
    }
    
    // Only include summary if it has real content (not just chunk headers)
    if (result.summary && result.summary.trim() && !result.summary.match(/^\[Chunk \d+\]\s*$/m)) {
      const cleanSummary = result.summary.split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed && trimmed !== 'undefined' && !trimmed.match(/^\[Chunk \d+\]$/);
      }).join('\n');
      if (cleanSummary.trim()) {
        sections.push(`--- COMPRESSED REWRITE ---
${cleanSummary}`);
      }
    }
    
    // Only include database if it has real content (NOT JSON)
    if (result.database && result.database.trim()) {
      // Skip if it's raw JSON
      const isJson = result.database.includes('```json') || 
                     result.database.trim().startsWith('{') || 
                     result.database.includes('"quotes"');
      if (!isJson) {
        const cleanDb = result.database.split('\n').filter(line => {
          const trimmed = line.trim();
          return trimmed && trimmed !== 'undefined' && !trimmed.match(/^═+$/) && !trimmed.match(/^═══ CHUNK \d+ ═══$/);
        }).join('\n');
        if (cleanDb.trim()) {
          sections.push(`--- DATABASE ---
${cleanDb}`);
        }
      }
    }
    
    // Only include analyzer if it has real content (NOT JSON)
    if (result.analyzer && result.analyzer.trim()) {
      // Skip if it's raw JSON
      const isJson = result.analyzer.includes('```json') || 
                     result.analyzer.trim().startsWith('{') || 
                     result.analyzer.includes('"quotes"');
      if (!isJson) {
        const cleanAnalyzer = result.analyzer.split('\n').filter(line => {
          const trimmed = line.trim();
          return trimmed && trimmed !== 'undefined' && !trimmed.match(/^═+$/) && !trimmed.match(/CHUNK \d+ ANALYSIS/);
        }).join('\n');
        if (cleanAnalyzer.trim()) {
          sections.push(`--- TEXT ANALYZER ---
${cleanAnalyzer}`);
        }
      }
    }
    
    if (safeViews.length > 0) {
      sections.push(`--- MAJOR POSITIONS ---
${safeViews.map((v, i) => {
  const stanceLabel = v.stance ? `[${v.stance.toUpperCase()}]` : '';
  const attrLabel = v.attributedTo ? ` → ${v.attributedTo}` : '';
  let entry = `${i + 1}. ${stanceLabel}${attrLabel} ${v.view}`;
  if (v.context) {
    entry += `\n   CONTEXT: ${v.context}`;
  }
  entry += `\n${(v.evidence || []).filter(e => e).map(e => `   EVIDENCE: "${e}"`).join('\n')}`;
  return entry;
}).join('\n\n')}`);
    }
    
    return sections.join('\n\n');
  };

  const handleDownload = () => {
    const content = generateReportContent();
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analysis-report-${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ 
      title: "Download Started", 
      description: "Your analysis report has been saved." 
    });
  };

  const handleCopy = () => {
    const content = generateReportContent();
    navigator.clipboard.writeText(content).then(() => {
      toast({ 
        title: "Copied to Clipboard", 
        description: "Full report copied successfully." 
      });
    });
  };

  const formatLiveOutput = (): string => {
    if (!streamingOutput) return "";
    
    // Try to parse as JSON and format nicely
    try {
      const parsed = JSON.parse(streamingOutput);
      const sections: string[] = [];
      
      sections.push(`TEXT INTELLIGENCE REPORT
Generated: ${new Date().toLocaleString()}
Source Length: ${text.split(/\s+/).filter(Boolean).length} words
LLM Used: ${selectedLLM}`);
      
      // Format quotes
      if (parsed.quotes && Array.isArray(parsed.quotes) && parsed.quotes.length > 0) {
        const cleanQuotes = parsed.quotes.filter((q: any) => q && typeof q === 'string');
        if (cleanQuotes.length > 0) {
          sections.push(`--- KEY QUOTATIONS ---
${cleanQuotes.map((q: string, i: number) => `${i+1}. ${q}`).join('\n')}`);
        }
      }
      
      // Format annotated quotes
      if (parsed.annotatedQuotes && Array.isArray(parsed.annotatedQuotes) && parsed.annotatedQuotes.length > 0) {
        const cleanAnnotated = parsed.annotatedQuotes.filter((q: any) => q && q.quote);
        if (cleanAnnotated.length > 0) {
          sections.push(`--- ANNOTATED CITATIONS ---
${cleanAnnotated.map((q: any, i: number) => `"${q.quote}"\n   > Context: ${q.context || ''}`).join('\n\n')}`);
        }
      }
      
      // Format views
      if (parsed.views && Array.isArray(parsed.views) && parsed.views.length > 0) {
        const cleanViews = parsed.views.filter((v: any) => v && v.view);
        if (cleanViews.length > 0) {
          sections.push(`--- MAJOR POSITIONS ---
${cleanViews.map((v: any, i: number) => {
  const stanceLabel = v.stance ? `[${v.stance.toUpperCase()}]` : '';
  const attrLabel = v.attributedTo ? ` → ${v.attributedTo}` : '';
  let entry = `${i + 1}. ${stanceLabel}${attrLabel} ${v.view}`;
  if (v.context) entry += `\n   CONTEXT: ${v.context}`;
  if (v.evidence && Array.isArray(v.evidence)) {
    entry += `\n${v.evidence.filter((e: any) => e).map((e: string) => `   EVIDENCE: "${e}"`).join('\n')}`;
  }
  return entry;
}).join('\n\n')}`);
        }
      }
      
      // Format summary
      if (parsed.summary && typeof parsed.summary === 'string' && parsed.summary.trim()) {
        sections.push(`--- COMPRESSED REWRITE ---
${parsed.summary}`);
      }
      
      // Format database - SKIP if it contains JSON
      if (parsed.database && typeof parsed.database === 'string' && parsed.database.trim()) {
        const isJson = parsed.database.includes('```json') || 
                       parsed.database.trim().startsWith('{') || 
                       parsed.database.includes('"quotes"');
        if (!isJson) {
          sections.push(`--- DATABASE ---
${parsed.database}`);
        }
      }
      
      // Format analyzer - SKIP if it contains JSON
      if (parsed.analyzer && typeof parsed.analyzer === 'string' && parsed.analyzer.trim()) {
        const isJson = parsed.analyzer.includes('```json') || 
                       parsed.analyzer.trim().startsWith('{') || 
                       parsed.analyzer.includes('"quotes"');
        if (!isJson) {
          sections.push(`--- TEXT ANALYZER ---
${parsed.analyzer}`);
        }
      }
      
      return sections.join('\n\n');
    } catch {
      // If not valid JSON, return as-is but clean up JSON artifacts
      return streamingOutput
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .replace(/"quotes"\s*:\s*\[/g, 'QUOTES:\n')
        .replace(/"annotatedQuotes"\s*:\s*\[/g, '\nANNOTATED QUOTES:\n')
        .replace(/[{}\[\]]/g, '')
        .replace(/",\s*"/g, '\n')
        .replace(/^"/gm, '')
        .replace(/"$/gm, '');
    }
  };

  const handleCopyLive = () => {
    if (!streamingOutput || streamingOutput === "Initializing connection...") {
      toast({ 
        title: "Nothing to copy yet", 
        description: "Wait for output to appear.",
        variant: "destructive"
      });
      return;
    }
    const formattedContent = formatLiveOutput();
    navigator.clipboard.writeText(formattedContent).then(() => {
      toast({ 
        title: "Copied!", 
        description: `Formatted report copied to clipboard.` 
      });
    });
  };

  const handleDownloadLive = () => {
    if (!streamingOutput || streamingOutput === "Initializing connection...") {
      toast({ 
        title: "Nothing to download yet", 
        description: "Wait for output to appear.",
        variant: "destructive"
      });
      return;
    }
    const formattedContent = formatLiveOutput();
    const blob = new Blob([formattedContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `live-output-${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ 
      title: "Downloaded!", 
      description: `Saved formatted report.`
    });
  };

  const handleFileUpload = async (file: File) => {
    if (!file) return;
    
    const extension = file.name.toLowerCase().split('.').pop() || '';
    const isPdfOrWord = ['pdf', 'doc', 'docx'].includes(extension);
    
    if (isPdfOrWord) {
      toast({
        title: "Processing...",
        description: `Parsing ${file.name}...`,
      });
      
      try {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('/api/parse-file', {
          method: 'POST',
          credentials: 'include',
          body: formData
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to parse file');
        }
        
        const result = await response.json();
        setText(result.text);
        toast({
          title: "File Uploaded",
          description: `${file.name} loaded (${result.wordCount} words, ${result.fileType.toUpperCase()})`,
        });
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message || "Could not parse file",
          variant: "destructive",
        });
      }
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setText(content);
        toast({
          title: "File Uploaded",
          description: `${file.name} loaded (${content.split(/\s+/).filter(Boolean).length} words)`,
        });
      };
      reader.onerror = () => {
        toast({
          title: "Error",
          description: "Could not read file",
          variant: "destructive",
        });
      };
      reader.readAsText(file);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set isDragging to false if we're leaving the actual container, not a child
    const rect = e.currentTarget.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (
      clientX <= rect.left ||
      clientX >= rect.right ||
      clientY <= rect.top ||
      clientY >= rect.bottom
    ) {
      setIsDragging(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const openStylometricsWithText = () => {
    if (text.trim()) {
      setStylometricsText(text);
    }
    setShowStylometricsDialog(true);
  };

  const openIntelligenceWithText = () => {
    if (text.trim()) {
      setIntelligenceTextA(text);
    }
    setShowIntelligenceDialog(true);
  };

  const openQuoteFinderWithText = () => {
    if (text.trim()) {
      setQuoteFinderCorpus(text);
    }
    setShowQuoteFinderDialog(true);
  };

  const handleIntelFileUpload = (file: File, target: 'A' | 'B') => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (target === 'A') {
        setIntelligenceTextA(content);
      } else {
        setIntelligenceTextB(content);
      }
      toast({
        title: "File Uploaded",
        description: `${file.name} loaded to Text ${target} (${content.split(/\s+/).filter(Boolean).length} words)`,
      });
    };
    reader.onerror = () => {
      toast({
        title: "Error",
        description: "Could not read file",
        variant: "destructive",
      });
    };
    reader.readAsText(file);
  };

  const handleIntelDrop = (e: React.DragEvent, target: 'A' | 'B') => {
    e.preventDefault();
    if (target === 'A') setIsDraggingIntelA(false);
    else setIsDraggingIntelB(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleIntelFileUpload(file, target);
    }
  };

  const handleIntelDragOver = (e: React.DragEvent, target: 'A' | 'B') => {
    e.preventDefault();
    if (target === 'A') setIsDraggingIntelA(true);
    else setIsDraggingIntelB(true);
  };

  const handleIntelDragLeave = (e: React.DragEvent, target: 'A' | 'B') => {
    e.preventDefault();
    if (target === 'A') setIsDraggingIntelA(false);
    else setIsDraggingIntelB(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary selection:text-white">
      <header className="border-b-4 border-primary sticky top-0 z-50 bg-white shadow-lg">
        <div className="w-full px-10 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary to-secondary text-white rounded-lg flex items-center justify-center shadow-lg">
              <Stethoscope className="w-6 h-6" />
            </div>
            <h1 className="font-bold text-2xl tracking-tight text-foreground">TEXT SURGEON</h1>
            <a 
              href="mailto:contact@zhisystems.ai" 
              className="ml-4 text-sm text-primary hover:text-primary/80 hover:underline flex items-center gap-1"
              data-testid="link-contact"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                window.location.href = "mailto:contact@zhisystems.ai";
              }}
            >
              <Mail className="w-4 h-4" />
              contact@zhisystems.ai
            </a>
            <a 
              href="/positions" 
              className="ml-4 text-sm text-purple-600 hover:text-purple-800 hover:underline flex items-center gap-1 bg-purple-50 px-3 py-1 rounded-md border border-purple-200"
              data-testid="link-positions"
            >
              <BookOpen className="w-4 h-4" />
              RAG Positions
            </a>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 text-base text-foreground bg-gray-100 border-2 border-gray-300 px-5 py-2.5 rounded-lg shadow-md">
              <Bot className="w-5 h-5 text-primary" />
              <span className="font-semibold text-foreground">LLM:</span>
              <Select value={selectedLLM} onValueChange={(v) => setSelectedLLM(v as LLM)}>
                <SelectTrigger className="h-8 w-[140px] border-none bg-transparent focus:ring-0 p-0 text-foreground font-bold uppercase" data-testid="select-llm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="grok">Zhi 1</SelectItem>
                  <SelectItem value="openai">Zhi 2</SelectItem>
                  <SelectItem value="anthropic">Zhi 3</SelectItem>
                  <SelectItem value="perplexity">Zhi 4</SelectItem>
                  <SelectItem value="deepseek">Zhi 5</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {username ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-sm px-3 py-1.5 bg-green-100 text-green-800 border border-green-300">
                  <User className="w-4 h-4 mr-1" />
                  {username}
                </Badge>
                <Badge variant="outline" className="text-sm px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-300">
                  {userCredits.toLocaleString()} credits
                </Badge>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleBuyCredits}
                  disabled={isBuyingCredits}
                  className="h-8 gap-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
                  data-testid="button-buy-credits"
                >
                  {isBuyingCredits ? "..." : "Buy Credits"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleViewHistory}
                  className="h-8 gap-1 text-primary border-primary hover:bg-primary hover:text-white"
                  data-testid="button-history"
                >
                  <History className="w-4 h-4" />
                  History
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLogout}
                  className="h-8 text-muted-foreground hover:text-destructive"
                  data-testid="button-logout"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleBuyCredits}
                  disabled={isBuyingCredits}
                  className="h-10 gap-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
                  data-testid="button-buy-credits-guest"
                >
                  <CreditCard className="w-4 h-4" />
                  {isBuyingCredits ? "..." : "Buy Credits"}
                </Button>
                <Dialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 text-sm gap-2 border-2 border-primary text-primary hover:bg-primary hover:text-white"
                      data-testid="button-login"
                    >
                      <LogIn className="w-4 h-4" />
                      Login
                    </Button>
                  </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <User className="w-5 h-5 text-primary" />
                      Login to No Word Limit
                    </DialogTitle>
                    <DialogDescription>
                      Enter a username to save your stylometric profiles and analysis history.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <a href="/auth/google" className="block">
                      <Button
                        type="button"
                        className="w-full bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 shadow-sm"
                        data-testid="button-google-login"
                      >
                        <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        Continue with Google
                      </Button>
                    </a>
                    
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-background px-2 text-muted-foreground">Or</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="username">Username (simple login)</Label>
                      <Input
                        id="username"
                        placeholder="Enter your username"
                        value={loginInput}
                        onChange={(e) => setLoginInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                        data-testid="input-username"
                      />
                    </div>
                    <Button
                      onClick={handleLogin}
                      disabled={isLoggingIn}
                      className="w-full"
                      variant="outline"
                      data-testid="button-submit-login"
                    >
                      {isLoggingIn ? "Logging in..." : "Continue with Username"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="w-full px-10 py-6">
        <ResizablePanelGroup direction="horizontal" className="gap-8" style={{minHeight: 'calc(100vh - 6rem)'}}>
          <ResizablePanel defaultSize={50} minSize={30}>
          <section className="flex flex-col gap-4 h-full">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-primary flex items-center gap-2.5 uppercase tracking-wide">
                <FileText className="w-6 h-6" />
                Input Document
              </h2>
              <div className="flex gap-2">
                {text && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-10 text-sm gap-2 text-muted-foreground hover:text-destructive transition-all"
                    onClick={handleClearInput}
                    title="Clear Input"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Clear</span>
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-10 text-sm gap-2 border-2 border-gray-300 hover:bg-gray-100 transition-all"
                  onClick={() => document.getElementById('file-upload')?.click()}
                >
                  <Upload className="w-4 h-4" />
                  Upload
                </Button>
                <input 
                  id="file-upload" 
                  type="file" 
                  className="hidden" 
                  accept=".txt,.doc,.docx,.pdf,*"
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                />
              </div>
            </div>

            <Card 
              className={`flex-1 p-6 flex flex-col gap-4 border-4 bg-white relative group overflow-hidden transition-all duration-300 shadow-xl ${isDragging ? 'border-primary ring-4 ring-primary/20' : 'border-gray-300'}`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              style={{minHeight: 'calc(100vh - 20rem)'}}
            >
              <Textarea 
                placeholder="Enter text, paste content, or drag files here to begin analysis..." 
                className={`flex-1 resize-none border-none focus-visible:ring-0 p-6 text-xl leading-relaxed font-serif bg-transparent placeholder:text-gray-400 ${isDragging ? 'pointer-events-none' : ''}`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                data-testid="input-text"
              />
              
              {isDragging && (
                <div 
                  className="absolute inset-0 bg-primary/10 backdrop-blur-sm flex items-center justify-center z-20 border-4 border-dashed border-primary rounded-lg"
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                >
                  <div className="flex flex-col items-center gap-4 text-primary pointer-events-none">
                    <motion.div animate={{ scale: 1.1, y: -10 }}>
                      <Upload className="w-16 h-16" />
                    </motion.div>
                    <p className="text-lg font-medium">{text ? 'Drop file to replace content' : 'Drop file to upload'}</p>
                    <p className="text-sm opacity-70">Supports PDF, Word, and text files</p>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-4 pt-4 border-t-4 border-gray-300">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-mono font-bold text-primary uppercase tracking-widest bg-blue-100 px-4 py-2 rounded-lg border-2 border-primary">
                      {wordCount} WORDS
                    </span>
                  </div>
                  {needsChunking && (
                    <Badge variant="secondary" className="text-sm px-3 py-1 bg-orange-100 text-orange-800 border border-orange-300">
                      <Layers className="w-4 h-4 mr-1" />
                      {chunks.length} Chunks
                    </Badge>
                  )}
                </div>

                {outline && (
                  <div className="bg-gradient-to-br from-slate-50 to-gray-100 rounded-lg border-2 border-slate-300 shadow-md overflow-hidden">
                    <div 
                      className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-100 transition-colors"
                      onClick={() => setShowOutlinePanel(!showOutlinePanel)}
                    >
                      <div className="flex items-center gap-2">
                        <Layers className="w-5 h-5 text-slate-700" />
                        <span className="font-bold text-slate-800">Document Outline</span>
                        <Badge variant="secondary" className="text-xs bg-slate-200 text-slate-700">
                          {outline.totalSections} sections
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); copyOutlineTXT(); }}
                          className="h-7 text-xs text-slate-600 hover:text-slate-900"
                          data-testid="button-copy-outline-txt"
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          Copy TXT
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-slate-600 hover:text-slate-900"
                              data-testid="button-download-outline"
                            >
                              <Download className="w-3 h-3 mr-1" />
                              Download
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => downloadOutline('md')} data-testid="menu-item-download-outline-md">
                              Download as .md
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => downloadOutline('txt')} data-testid="menu-item-download-outline-txt">
                              Download as .txt
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => downloadOutline('json')} data-testid="menu-item-download-outline-json">
                              Download as .json
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {showOutlinePanel ? (
                          <ChevronUp className="w-5 h-5 text-slate-600" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-slate-600" />
                        )}
                      </div>
                    </div>
                    
                    {showOutlinePanel && (
                      <div className="border-t border-slate-300 p-4 space-y-4">
                        <div className="bg-white rounded-lg p-3 border border-slate-200">
                          <p className="text-sm font-medium text-slate-700">Summary:</p>
                          <p className="text-slate-600 mt-1">{outline.taskSummary}</p>
                        </div>
                        
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {outline.sections.map((section) => (
                            <div key={section.id} className="bg-white rounded-lg p-3 border border-slate-200">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <h5 className="font-semibold text-slate-800">{section.title}</h5>
                                  <p className="text-sm text-slate-600 mt-1">{section.description}</p>
                                </div>
                                <Badge variant="outline" className="text-xs ml-2">
                                  ~{section.wordCount} words
                                </Badge>
                              </div>
                              {section.keyThemes.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {section.keyThemes.map((theme, i) => (
                                    <Badge key={i} className="text-xs bg-slate-100 text-slate-700">
                                      {theme}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                {needsChunking && showChunkSelector && (
                  <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-lg p-4 border-2 border-orange-200 shadow-md">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-bold text-orange-800 flex items-center gap-2">
                        <Layers className="w-5 h-5" />
                        Document Chunks
                      </h4>
                      <div className="flex gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={selectAllChunks}
                          className="h-7 text-xs text-orange-700 hover:text-orange-900 hover:bg-orange-100"
                        >
                          <CheckSquare className="w-3 h-3 mr-1" />
                          All
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={deselectAllChunks}
                          className="h-7 text-xs text-orange-700 hover:text-orange-900 hover:bg-orange-100"
                        >
                          <Square className="w-3 h-3 mr-1" />
                          None
                        </Button>
                        {chunks.some(c => c.processed) && (
                          <>
                            <Button 
                              variant="default" 
                              size="sm" 
                              onClick={() => {
                                // Select all unprocessed chunks (including failed one)
                                setChunks(prev => prev.map(c => ({ 
                                  ...c, 
                                  selected: !c.processed  // Select if NOT processed
                                })));
                              }}
                              className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                              title="Select only unprocessed chunks to continue"
                            >
                              <Play className="w-3 h-3 mr-1" />
                              Resume ({chunks.filter(c => !c.processed).length} left)
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => {
                                // Reset all chunks: clear processed state and select all
                                setChunks(prev => prev.map(c => ({ 
                                  ...c, 
                                  processed: false,
                                  selected: true
                                })));
                                setProcessedChunkIds(new Set());
                                setLastFailedChunkIndex(null);
                              }}
                              className="h-7 text-xs border-orange-400 text-orange-700 hover:bg-orange-100"
                              title="Clear processed state and select all chunks"
                            >
                              <RotateCcw className="w-3 h-3 mr-1" />
                              Reset
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    
                    <div className="mt-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          placeholder="Enter range: 1-5, 8, 10-12"
                          value={chunkRangeInput}
                          onChange={(e) => setChunkRangeInput(e.target.value)}
                          className="flex-1 h-8 text-sm"
                          data-testid="input-chunk-range"
                        />
                        <Button 
                          variant="default" 
                          size="sm"
                          onClick={() => applyChunkRange(chunkRangeInput)}
                          className="h-8 text-xs bg-orange-600 hover:bg-orange-700"
                          data-testid="button-apply-range"
                        >
                          Apply
                        </Button>
                      </div>
                      
                      <div className="flex flex-wrap gap-1">
                        <span className="text-xs text-orange-700 font-semibold mr-1 self-center">Presets:</span>
                        <Button variant="outline" size="sm" onClick={() => selectPreset('first-half')} className="h-6 text-xs px-2" data-testid="preset-first-half">1st Half</Button>
                        <Button variant="outline" size="sm" onClick={() => selectPreset('second-half')} className="h-6 text-xs px-2" data-testid="preset-second-half">2nd Half</Button>
                        <span className="text-gray-300">|</span>
                        <Button variant="outline" size="sm" onClick={() => selectPreset('first-third')} className="h-6 text-xs px-2" data-testid="preset-first-third">1st Third</Button>
                        <Button variant="outline" size="sm" onClick={() => selectPreset('second-third')} className="h-6 text-xs px-2" data-testid="preset-second-third">2nd Third</Button>
                        <Button variant="outline" size="sm" onClick={() => selectPreset('third-third')} className="h-6 text-xs px-2" data-testid="preset-third-third">3rd Third</Button>
                        <span className="text-gray-300">|</span>
                        <Button variant="outline" size="sm" onClick={() => selectPreset('first-quarter')} className="h-6 text-xs px-2" data-testid="preset-first-quarter">Q1</Button>
                        <Button variant="outline" size="sm" onClick={() => selectPreset('second-quarter')} className="h-6 text-xs px-2" data-testid="preset-second-quarter">Q2</Button>
                        <Button variant="outline" size="sm" onClick={() => selectPreset('third-quarter')} className="h-6 text-xs px-2" data-testid="preset-third-quarter">Q3</Button>
                        <Button variant="outline" size="sm" onClick={() => selectPreset('fourth-quarter')} className="h-6 text-xs px-2" data-testid="preset-fourth-quarter">Q4</Button>
                      </div>
                      
                      <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-sm font-semibold text-orange-800">
                            Extraction Density
                          </Label>
                          <span className="text-sm font-bold text-orange-600">
                            {extractionDensity === 1 ? 'Minimal' : 
                             extractionDensity <= 3 ? 'Light' : 
                             extractionDensity <= 5 ? 'Standard' : 
                             extractionDensity <= 7 ? 'Thorough' : 
                             extractionDensity <= 9 ? 'Dense' : 'Maximum'}
                          </span>
                        </div>
                        <Slider
                          value={[extractionDensity]}
                          onValueChange={(v: number[]) => setExtractionDensity(v[0])}
                          min={1}
                          max={10}
                          step={1}
                          className="w-full"
                          data-testid="slider-extraction-density"
                        />
                        <div className="flex justify-between text-xs text-orange-600 mt-1">
                          <span>Fewer results</span>
                          <span>More results</span>
                        </div>
                        <p className="text-xs text-orange-700 mt-2">
                          Controls how many quotes, positions, and arguments are extracted per chunk.
                        </p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto mt-3">
                      {chunks.map((chunk) => (
                        <div 
                          key={chunk.id}
                          onClick={() => toggleChunk(chunk.id)}
                          className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-all ${
                            chunk.processed
                              ? 'bg-green-100 border-2 border-green-400'
                              : lastFailedChunkIndex === chunk.id
                                ? 'bg-red-100 border-2 border-red-400'
                                : chunk.selected 
                                  ? 'bg-orange-200 border-2 border-orange-400' 
                                  : 'bg-white border-2 border-gray-200 hover:border-orange-300'
                          }`}
                        >
                          {chunk.processed ? (
                            <Check className="w-4 h-4 text-green-600" />
                          ) : lastFailedChunkIndex === chunk.id ? (
                            <X className="w-4 h-4 text-red-600" />
                          ) : (
                            <Checkbox 
                              checked={chunk.selected} 
                              onCheckedChange={() => toggleChunk(chunk.id)}
                              className="pointer-events-none"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${
                              chunk.processed ? 'text-green-700' : 
                              lastFailedChunkIndex === chunk.id ? 'text-red-700' : 'text-gray-800'
                            }`}>
                              Chunk {chunk.id}
                              {chunk.processed && <span className="ml-1 text-xs font-normal">(done)</span>}
                              {lastFailedChunkIndex === chunk.id && <span className="ml-1 text-xs font-normal">(failed)</span>}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                              Words {chunk.startWord}-{chunk.endWord} ({chunk.wordCount})
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    <div className="mt-3 pt-3 border-t border-orange-200 flex items-center justify-between text-sm">
                      <span className="text-orange-700">
                        {selectedChunks.length} of {chunks.length} chunks selected
                        {chunks.some(c => c.processed) && (
                          <span className="ml-2 text-green-600">
                            ({chunks.filter(c => c.processed).length} completed)
                          </span>
                        )}
                      </span>
                      {selectedChunks.length === 0 && (
                        <span className="text-red-600 text-xs">Select at least one chunk</span>
                      )}
                    </div>
                    
                    <div className="mt-3 pt-3 border-t border-orange-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Switch
                            id="all-day-mode"
                            checked={allDayMode}
                            onCheckedChange={setAllDayMode}
                            data-testid="switch-all-day-mode"
                          />
                          <Label htmlFor="all-day-mode" className="font-bold text-orange-800 cursor-pointer">
                            🌙 ALL DAY MODE
                          </Label>
                        </div>
                        <span className="text-xs text-orange-600">
                          {allDayMode ? "60s delay (stable)" : "20s delay (faster)"}
                        </span>
                      </div>
                      {allDayMode && (
                        <p className="text-xs text-orange-700 mt-2 bg-orange-100 p-2 rounded">
                          All Day Mode: 60-second breaks between chunks to prevent crashes. 
                          Perfect for processing entire books overnight.
                          {selectedChunks.length > 0 && (
                            <span className="block mt-1 font-semibold">
                              Estimated time: ~{Math.ceil(selectedChunks.length * 1.5)} minutes for {selectedChunks.length} chunks
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                
                {isProcessing && totalChunksToProcess > 0 && (
                  <div className={`rounded-lg p-4 border-2 ${allDayMode ? 'bg-purple-50 border-purple-300' : 'bg-blue-50 border-blue-200'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`font-semibold ${allDayMode ? 'text-purple-800' : 'text-blue-800'}`}>
                        {allDayMode && '🌙 ALL DAY MODE - '}
                        Processing Chunk {currentChunkIndex} of {totalChunksToProcess}
                      </span>
                      <span className={`text-sm ${allDayMode ? 'text-purple-600' : 'text-blue-600'}`}>
                        {Math.round((currentChunkIndex / totalChunksToProcess) * 100)}%
                      </span>
                    </div>
                    <Progress value={(currentChunkIndex / totalChunksToProcess) * 100} className="h-2" />
                    {allDayMode && allDayProgress && (
                      <p className="text-xs text-purple-600 mt-2">
                        ⏱️ Time remaining: {allDayProgress.timeRemaining} • Leave running - will complete automatically
                      </p>
                    )}
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-3">
                  <Button 
                    onClick={() => setShowQuoteExtractor(true)}
                    disabled={isProcessing || !text}
                    className="h-12 text-sm font-semibold px-5 bg-gradient-to-r from-primary to-secondary text-white hover:shadow-lg transition-all hover:scale-105"
                    data-testid="button-quotes"
                  >
                    <Quote className="w-5 h-5 mr-2" />
                    QUOTES
                  </Button>
                  <Button 
                    onClick={openStylometricsWithText}
                    disabled={isProcessing}
                    className="h-12 text-sm font-semibold px-5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:shadow-lg transition-all hover:scale-105"
                    data-testid="button-stylometrics"
                  >
                    <BarChart3 className="w-5 h-5 mr-2" />
                    STYLOMETRICS
                  </Button>
                  <Button 
                    onClick={openIntelligenceWithText}
                    disabled={isProcessing}
                    className="h-12 text-sm font-semibold px-5 bg-gradient-to-r from-amber-600 to-orange-600 text-white hover:shadow-lg transition-all hover:scale-105"
                    data-testid="button-intelligence"
                  >
                    <Sparkles className="w-5 h-5 mr-2" />
                    INTELLIGENCE
                  </Button>
                  <Button 
                    onClick={() => setShowPositionExtractor(true)}
                    disabled={isProcessing || !text}
                    className="h-12 text-sm font-semibold px-5 bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:shadow-lg transition-all hover:scale-105"
                    data-testid="button-position-extractor"
                  >
                    <FileText className="w-5 h-5 mr-2" />
                    POSITIONS
                  </Button>
                  <Button 
                    onClick={() => setShowArgumentsFinder(true)}
                    disabled={isProcessing || !text}
                    className="h-12 text-sm font-semibold px-5 bg-gradient-to-r from-teal-600 to-cyan-600 text-white hover:shadow-lg transition-all hover:scale-105"
                    data-testid="button-arguments-finder"
                  >
                    <Layers className="w-5 h-5 mr-2" />
                    ARGUMENTS
                  </Button>
                  <Button 
                    onClick={() => setShowTractatusRewrite(true)}
                    disabled={isProcessing || !text}
                    className="h-12 text-sm font-semibold px-5 bg-gradient-to-r from-amber-600 to-orange-600 text-white hover:shadow-lg transition-all hover:scale-105"
                    data-testid="button-tractatus-rewrite"
                  >
                    <List className="w-5 h-5 mr-2" />
                    TRACTATUS
                  </Button>
                  <Button 
                    onClick={() => {
                      setShowTractatusTree(true);
                      setTimeout(() => handleGenerateTractatusTree(), 100);
                    }}
                    disabled={isProcessing || isGeneratingTree || !text}
                    className="h-12 text-sm font-semibold px-5 bg-gradient-to-r from-yellow-600 to-amber-600 text-white hover:shadow-lg transition-all hover:scale-105"
                    data-testid="button-tractatus-tree"
                  >
                    <GitBranch className="w-5 h-5 mr-2" />
                    TRACTATUS TREE
                  </Button>
                  <Button 
                    onClick={() => setShowSummary(true)}
                    disabled={isProcessing || isGeneratingSummary || !text}
                    className="h-12 text-sm font-semibold px-5 bg-gradient-to-r from-teal-600 to-cyan-600 text-white hover:shadow-lg transition-all hover:scale-105"
                    data-testid="button-summary"
                  >
                    <FileText className="w-5 h-5 mr-2" />
                    SUMMARY
                  </Button>
                  <Button 
                    onClick={handleGenerateOutline}
                    disabled={isGeneratingOutline || !text}
                    className="h-12 text-sm font-semibold px-5 bg-gradient-to-r from-slate-600 to-zinc-700 text-white hover:shadow-lg transition-all hover:scale-105"
                    data-testid="button-outline"
                  >
                    {isGeneratingOutline ? (
                      <>
                        <div className="w-5 h-5 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        GENERATING...
                      </>
                    ) : (
                      <>
                        <Layers className="w-5 h-5 mr-2" />
                        OUTLINE
                      </>
                    )}
                  </Button>
                  <Button 
                    onClick={() => setShowRewriteDialog(true)}
                    disabled={isRewriting || !text}
                    className="h-12 text-sm font-semibold px-5 bg-gradient-to-r from-blue-600 to-indigo-700 text-white hover:shadow-lg transition-all hover:scale-105"
                    data-testid="button-full-rewrite"
                  >
                    {isRewriting ? (
                      <>
                        <div className="w-5 h-5 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        REWRITING...
                      </>
                    ) : (
                      <>
                        <FileText className="w-5 h-5 mr-2" />
                        FULL REWRITE
                      </>
                    )}
                  </Button>
                  <Button 
                    onClick={() => setShowWriteFromScratchDialog(true)}
                    disabled={isWritingFromScratch}
                    className="h-12 text-sm font-semibold px-5 bg-gradient-to-r from-emerald-600 to-teal-700 text-white hover:shadow-lg transition-all hover:scale-105"
                    data-testid="button-write-from-scratch"
                  >
                    {isWritingFromScratch ? (
                      <>
                        <div className="w-5 h-5 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        GENERATING...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5 mr-2" />
                        WRITE NEW
                      </>
                    )}
                  </Button>
                  <Button 
                    onClick={() => setShowCustomAnalyzer(true)}
                    disabled={isRunningCustomAnalysis || !text}
                    className="h-12 text-sm font-semibold px-5 bg-gradient-to-r from-rose-600 to-orange-500 text-white hover:shadow-lg transition-all hover:scale-105"
                    data-testid="button-custom-analyzer"
                  >
                    {isRunningCustomAnalysis ? (
                      <>
                        <div className="w-5 h-5 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        RUNNING...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5 mr-2" />
                        CUSTOM
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          </section>
          </ResizablePanel>
          
          <ResizableHandle withHandle className="mx-4" />
          
          <ResizablePanel defaultSize={50} minSize={30}>
          <section className="flex flex-col gap-4 h-full">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-secondary flex items-center gap-2.5 uppercase tracking-wide">
                <Sparkles className="w-6 h-6" />
                Analysis Results
              </h2>
              {hasResult && (
                <div className="flex gap-2">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-10 w-10 text-muted-foreground hover:text-destructive transition-all" 
                    title="Clear Results"
                    onClick={handleClearOutput}
                  >
                    <RotateCcw className="w-5 h-5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-10 w-10 hover:bg-gray-100 transition-all" title="Copy All" onClick={handleCopy}>
                    <Copy className="w-5 h-5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-10 w-10 hover:bg-gray-100 transition-all" title="Download Report" onClick={handleDownload}>
                    <Download className="w-5 h-5" />
                  </Button>
                </div>
              )}
            </div>

            <div className="flex-1">
              <AnimatePresence mode="wait">
                {isProcessing ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="border-4 border-primary rounded-lg flex flex-col bg-white p-8 shadow-xl"
                    style={{minHeight: 'calc(100vh - 20rem)'}}
                  >
                    <div className="flex items-center gap-4 mb-6 pb-6 border-b-2 border-gray-200">
                      <div className="relative">
                        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Sparkles className="w-5 h-5 text-primary animate-pulse" />
                        </div>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-2xl font-bold text-primary uppercase tracking-wide">Processing Analysis</h3>
                        <p className="text-base text-muted-foreground mt-1">Using {selectedLLM.toUpperCase()} • Streaming output in real-time</p>
                      </div>
                    </div>
                    
                    <div className="flex-1 bg-gray-50 rounded-lg border-2 border-gray-200 p-6 overflow-auto">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" style={{animationDelay: '0.2s'}}></div>
                            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" style={{animationDelay: '0.4s'}}></div>
                          </div>
                          <span className="text-sm font-semibold text-primary">Live Output</span>
                          {streamingOutput && streamingOutput !== "Initializing connection..." && (
                            <span className="text-xs text-muted-foreground">({streamingOutput.length.toLocaleString()} chars)</span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={handleCopyLive}
                            className="h-8 px-3 bg-white hover:bg-green-50 border-green-300 text-green-700 font-semibold"
                            data-testid="button-copy-live"
                          >
                            <Copy className="w-4 h-4 mr-1" />
                            COPY NOW
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={handleDownloadLive}
                            className="h-8 px-3 bg-white hover:bg-blue-50 border-blue-300 text-blue-700 font-semibold"
                            data-testid="button-download-live"
                          >
                            <Download className="w-4 h-4 mr-1" />
                            DOWNLOAD NOW
                          </Button>
                        </div>
                      </div>
                      <pre className="font-mono text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                        {streamingOutput || "Initializing connection..."}
                      </pre>
                    </div>
                  </motion.div>
                ) : !hasResult || !result ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="border-4 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-muted-foreground bg-gray-50 p-8 text-center shadow-xl"
                    style={{minHeight: 'calc(100vh - 20rem)'}}
                  >
                    <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center mb-5 shadow-lg">
                      <Bot className="w-10 h-10 text-primary" />
                    </div>
                    <h3 className="text-xl font-bold mb-2 text-foreground uppercase tracking-wide">Ready to Analyze</h3>
                    <p className="max-w-md text-base text-muted-foreground">
                      Select your LLM and click a function button to generate quotes, context, rewrites, or database metadata.
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="h-full"
                  >
                    <Card className="border-4 border-gray-300 bg-white shadow-xl overflow-hidden flex flex-col" style={{minHeight: 'calc(100vh - 20rem)'}}>
                      <Tabs defaultValue="quotes-list" className="w-full h-full flex flex-col">
                        <div className="border-b-4 border-gray-200 px-6 bg-gray-50 overflow-x-auto">
                          <TabsList className="h-14 bg-transparent p-0 gap-4 flex-nowrap min-w-max">
                            <TabTrigger value="quotes-list" icon={<Quote className="w-4 h-4" />} label="Quotes" />
                          </TabsList>
                        </div>

                        <div className="flex-1 bg-card">
                          <ScrollArea className="h-full">
                            <div className="p-6">
                              <TabsContent value="quotes-list" className="mt-0 space-y-4 outline-none">
                                {(() => {
                                  const quotes = (result.quotes || []).filter(q => q);
                                  const totalWords = quotes.join(' ').split(/\s+/).filter(Boolean).length;
                                  const shouldPaywall = !hasCredits && totalWords > PAYWALL_WORD_LIMIT;
                                  
                                  if (shouldPaywall && quotes.length > 0) {
                                    const previewQuotes = quotes.slice(0, 3);
                                    return (
                                      <div className="space-y-4">
                                        <ul className="space-y-4 opacity-75">
                                          {previewQuotes.map((quote, i) => (
                                            <li key={i} className="flex gap-4 p-4 rounded-lg border-2 border-gray-200">
                                              <span className="flex-none w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary text-white flex items-center justify-center text-base font-bold shadow-md">
                                                {i + 1}
                                              </span>
                                              <p className="font-serif text-lg leading-relaxed text-foreground truncate">
                                                "{quote.substring(0, 100)}..."
                                              </p>
                                            </li>
                                          ))}
                                        </ul>
                                        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl p-6 shadow-lg">
                                          <div className="flex flex-col items-center text-center space-y-4">
                                            <div className="bg-amber-100 p-3 rounded-full">
                                              <Lock className="w-8 h-8 text-amber-600" />
                                            </div>
                                            <div>
                                              <h3 className="text-lg font-bold text-gray-900">Full Quotes Paywalled</h3>
                                              <p className="text-sm text-gray-600 mt-1">
                                                {quotes.length} quotes with {totalWords.toLocaleString()} total words. Purchase credits to unlock.
                                              </p>
                                            </div>
                                            <Button
                                              onClick={handleBuyCredits}
                                              className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold px-8 py-3 text-lg shadow-md"
                                              data-testid="button-quotes-paywall-buy-credits"
                                            >
                                              <CreditCard className="w-5 h-5 mr-2" />
                                              Buy Credits to Unlock
                                            </Button>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  }
                                  
                                  return (
                                    <ul className="space-y-4">
                                      {quotes.map((quote, i) => (
                                        <li key={i} className="flex gap-4 group p-4 rounded-lg hover:bg-blue-50 transition-all border-2 border-gray-200 hover:border-primary hover:shadow-md">
                                          <span className="flex-none w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary text-white flex items-center justify-center text-base font-bold shadow-md">
                                            {i + 1}
                                          </span>
                                          <p className="font-serif text-lg leading-relaxed text-foreground">
                                            "{quote}"
                                          </p>
                                        </li>
                                      ))}
                                      {quotes.length === 0 && (
                                        <p className="text-muted-foreground italic">No quotes extracted yet.</p>
                                      )}
                                    </ul>
                                  );
                                })()}
                              </TabsContent>
                            </div>
                          </ScrollArea>
                        </div>
                      </Tabs>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>

      <ResizableDialog open={showStylometricsDialog} onOpenChange={setShowStylometricsDialog}>
        <ResizableDialogContent defaultWidth={900} defaultHeight={700} minWidth={500} minHeight={400}>
          <ResizableDialogHeader>
            <ResizableDialogTitle className="flex items-center gap-2 text-xl">
              <BarChart3 className="w-6 h-6 text-indigo-600" />
              Stylometric Analysis
            </ResizableDialogTitle>
            <ResizableDialogDescription>
              Analyze writing style, verticality, and psychological profile of text samples.
            </ResizableDialogDescription>
          </ResizableDialogHeader>
          
          <Tabs value={stylometricsTab} onValueChange={(v) => setStylometricsTab(v as "single" | "compare")} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="single" className="gap-2">
                <BookOpen className="w-4 h-4" />
                Single Text
              </TabsTrigger>
              <TabsTrigger value="compare" className="gap-2">
                <GitCompare className="w-4 h-4" />
                Compare Texts
              </TabsTrigger>
            </TabsList>
            
            <div className="flex-1 overflow-y-auto mt-4">
              <TabsContent value="single" className="mt-0 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="author-name">Author Name / Label (optional)</Label>
                    <Input
                      id="author-name"
                      placeholder="e.g., John Smith"
                      value={stylometricsAuthorName}
                      onChange={(e) => setStylometricsAuthorName(e.target.value)}
                      data-testid="input-author-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="source-title">Source Title (optional)</Label>
                    <Input
                      id="source-title"
                      placeholder="e.g., Essay on Knowledge"
                      value={stylometricsSourceTitle}
                      onChange={(e) => setStylometricsSourceTitle(e.target.value)}
                      data-testid="input-source-title"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Switch
                    id="use-stylometrics-outline"
                    checked={useStylometricsOutlineMode}
                    onCheckedChange={setUseStylometricsOutlineMode}
                    data-testid="switch-stylometrics-outline"
                  />
                  <Label htmlFor="use-stylometrics-outline" className="text-sm">
                    Use Outline Mode (for large texts) - provides section-by-section analysis
                  </Label>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="stylometrics-text">Text Sample (min. 400 words) *</Label>
                    <span className="text-sm text-muted-foreground">
                      {stylometricsText.split(/\s+/).filter(Boolean).length} words
                    </span>
                  </div>
                  <Textarea
                    id="stylometrics-text"
                    placeholder="Paste text here for stylometric analysis..."
                    value={stylometricsText}
                    onChange={(e) => setStylometricsText(e.target.value)}
                    className="min-h-[200px] font-serif"
                    data-testid="textarea-stylometrics"
                  />
                </div>

                {stylometricsProgress && isAnalyzingStylometrics && (
                  <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-indigo-600 border-t-transparent" />
                      <div>
                        <p className="font-medium text-indigo-800">{stylometricsProgress.message}</p>
                        {stylometricsProgress.current && stylometricsProgress.total && (
                          <p className="text-sm text-indigo-600">
                            Section {stylometricsProgress.current} of {stylometricsProgress.total}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {holisticStylometricsResult && (() => {
                  const totalWords = (holisticStylometricsResult.abstractionDescription?.split(/\s+/).filter(Boolean).length || 0) +
                    (holisticStylometricsResult.narrativeSummary?.split(/\s+/).filter(Boolean).length || 0) +
                    (holisticStylometricsResult.signaturePhrases?.join(' ').split(/\s+/).filter(Boolean).length || 0);
                  const shouldPaywall = !hasCredits && totalWords > PAYWALL_WORD_LIMIT;
                  
                  if (shouldPaywall) {
                    return (
                      <div className="space-y-4 p-4 bg-gradient-to-br from-indigo-50 to-violet-50 rounded-lg border border-indigo-200">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-lg text-indigo-800">{holisticStylometricsResult.authorName}</h4>
                          <div className="text-3xl font-bold text-indigo-600">{holisticStylometricsResult.aggregatedVerticalityScore?.toFixed(2)}</div>
                        </div>
                        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl p-6 shadow-lg">
                          <div className="flex flex-col items-center text-center space-y-4">
                            <div className="bg-amber-100 p-3 rounded-full">
                              <Lock className="w-8 h-8 text-amber-600" />
                            </div>
                            <div>
                              <h3 className="text-lg font-bold text-gray-900">Full Stylometrics Report Paywalled</h3>
                              <p className="text-sm text-gray-600 mt-1">
                                Complete analysis with {totalWords.toLocaleString()} words. Purchase credits to unlock.
                              </p>
                            </div>
                            <Button
                              onClick={handleBuyCredits}
                              className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold px-8 py-3 text-lg shadow-md"
                              data-testid="button-stylometrics-paywall-buy-credits"
                            >
                              <CreditCard className="w-5 h-5 mr-2" />
                              Buy Credits to Unlock
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  
                  return (
                  <div className="space-y-4 p-4 bg-gradient-to-br from-indigo-50 to-violet-50 rounded-lg border border-indigo-200">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-lg text-indigo-800">{holisticStylometricsResult.authorName}</h4>
                      <div className="flex items-center gap-4">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" data-testid="button-download-stylometrics-single">
                              <Download className="w-4 h-4 mr-1" />
                              Download
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => downloadStylometricsReport('txt')}>
                              Download as .txt
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => downloadStylometricsReport('md')}>
                              Download as .md
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <div className="text-center">
                          <div className="text-3xl font-bold text-indigo-600">{holisticStylometricsResult.aggregatedVerticalityScore?.toFixed(2)}</div>
                          <div className="text-xs text-muted-foreground">Verticality</div>
                        </div>
                        <div className="text-center">
                          <div className="text-3xl font-bold text-violet-600">{holisticStylometricsResult.signalScore}%</div>
                          <div className="text-xs text-muted-foreground">Signal</div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-white/60 rounded-lg">
                        <div className="font-semibold text-indigo-800">{holisticStylometricsResult.classification}</div>
                        <div className="text-sm text-muted-foreground">{holisticStylometricsResult.abstractionLevel}</div>
                      </div>
                      <div className="p-3 bg-white/60 rounded-lg">
                        <div className="font-semibold text-indigo-800">{holisticStylometricsResult.closestAuthorMatch}</div>
                        <div className="text-xs text-muted-foreground">Closest Match</div>
                      </div>
                    </div>

                    <div className="text-sm text-indigo-700 bg-white/40 p-3 rounded-lg">
                      {holisticStylometricsResult.abstractionDescription}
                    </div>

                    {holisticStylometricsResult.signaturePhrases?.length > 0 && (
                      <div className="space-y-1">
                        <Label className="text-indigo-800">Signature Phrases:</Label>
                        <div className="flex flex-wrap gap-2">
                          {holisticStylometricsResult.signaturePhrases.map((phrase: string, i: number) => (
                            <span key={i} className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded text-xs">{phrase}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {holisticStylometricsResult.narrativeSummary && (
                      <div className="p-3 bg-white/60 rounded-lg italic text-sm text-gray-700">
                        {holisticStylometricsResult.narrativeSummary}
                      </div>
                    )}

                    {holisticStylometricsResult.sectionAnalyses?.length > 0 && (
                      <Collapsible>
                        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-indigo-700 hover:text-indigo-900">
                          <ChevronDown className="w-4 h-4" />
                          Section Details ({holisticStylometricsResult.sectionAnalyses.length} sections)
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="mt-2 space-y-2 max-h-[200px] overflow-y-auto">
                            {holisticStylometricsResult.sectionAnalyses.map((section: any, i: number) => (
                              <div key={i} className="p-2 bg-white/60 rounded border text-sm">
                                <div className="font-medium">{section.sectionTitle}</div>
                                <div className="text-xs text-muted-foreground">
                                  Verticality: {section.verticalityScore?.toFixed(2)} | Words: {section.rawFeatures?.wordCount}
                                </div>
                              </div>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                  );
                })()}
                
                {stylometricsReport && !holisticStylometricsResult && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Analysis Results</Label>
                      <div className="flex gap-2">
                        {username && stylometricsData && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleSaveStylometricProfile}
                            className="gap-1"
                            data-testid="button-save-profile"
                          >
                            <Save className="w-4 h-4" />
                            Save to Database
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            navigator.clipboard.writeText(stylometricsReport);
                            toast({ description: "Report copied to clipboard" });
                          }}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <ScrollArea className="h-[300px] border rounded-lg p-4 bg-gradient-to-br from-indigo-50 to-violet-50">
                      <pre className="font-sans text-sm whitespace-pre-wrap">{stylometricsReport}</pre>
                    </ScrollArea>
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="compare" className="mt-0 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <Switch
                    id="use-stylometrics-outline-compare"
                    checked={useStylometricsOutlineMode}
                    onCheckedChange={setUseStylometricsOutlineMode}
                    data-testid="switch-stylometrics-outline-compare"
                  />
                  <Label htmlFor="use-stylometrics-outline-compare" className="text-sm">
                    Use Outline Mode (for large texts)
                  </Label>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <h4 className="font-semibold text-blue-800">Text A</h4>
                    <div className="space-y-2">
                      <Label>Author Name (optional)</Label>
                      <Input
                        placeholder="Author A"
                        value={stylometricsAuthorName}
                        onChange={(e) => setStylometricsAuthorName(e.target.value)}
                        data-testid="input-author-a"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Text *</Label>
                        <span className="text-xs text-muted-foreground">
                          {stylometricsText.split(/\s+/).filter(Boolean).length} words
                        </span>
                      </div>
                      <Textarea
                        placeholder="Paste Text A..."
                        value={stylometricsText}
                        onChange={(e) => setStylometricsText(e.target.value)}
                        className="min-h-[150px] font-serif text-sm"
                        data-testid="textarea-text-a"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-purple-800">Text B</h4>
                      <div>
                        <input
                          type="file"
                          ref={stylometricsFileRefB}
                          accept=".txt,.md,.text"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleStylometricsFileUploadB(e.target.files[0])}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => stylometricsFileRefB.current?.click()}
                          className="h-7 text-xs gap-1"
                          data-testid="button-upload-text-b"
                        >
                          <Upload className="w-3 h-3" />
                          Upload
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Author Name (optional)</Label>
                      <Input
                        placeholder="Author B"
                        value={stylometricsAuthorNameB}
                        onChange={(e) => setStylometricsAuthorNameB(e.target.value)}
                        data-testid="input-author-b"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Text *</Label>
                        <span className="text-xs text-muted-foreground">
                          {stylometricsTextB.split(/\s+/).filter(Boolean).length} words
                        </span>
                      </div>
                      <Textarea
                        placeholder="Paste Text B or drop file here..."
                        value={stylometricsTextB}
                        onChange={(e) => setStylometricsTextB(e.target.value)}
                        className="min-h-[150px] font-serif text-sm"
                        data-testid="textarea-text-b"
                      />
                    </div>
                  </div>
                </div>

                {stylometricsProgress && isAnalyzingStylometrics && (
                  <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-indigo-600 border-t-transparent" />
                      <div>
                        <p className="font-medium text-indigo-800">{stylometricsProgress.message}</p>
                        {stylometricsProgress.current && stylometricsProgress.total && (
                          <p className="text-sm text-indigo-600">
                            Section {stylometricsProgress.current} of {stylometricsProgress.total}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {holisticStylometricsCompareResult && (
                  <div className="space-y-4 p-4 bg-gradient-to-br from-indigo-50 to-violet-50 rounded-lg border border-indigo-200">
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-center flex-1">
                        <h4 className="font-bold text-lg text-indigo-800">Comparison Results</h4>
                        <p className="text-sm text-muted-foreground">{holisticStylometricsCompareResult.verdict}</p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="outline" data-testid="button-download-stylometrics-compare">
                            <Download className="w-4 h-4 mr-1" />
                            Download
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => downloadStylometricsReport('txt')}>
                            Download as .txt
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => downloadStylometricsReport('md')}>
                            Download as .md
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-blue-100/60 rounded-lg">
                        <div className="font-semibold text-blue-800">{holisticStylometricsCompareResult.textA?.authorName}</div>
                        <div className="text-2xl font-bold text-blue-600">{holisticStylometricsCompareResult.textA?.aggregatedVerticalityScore?.toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground">{holisticStylometricsCompareResult.textA?.classification}</div>
                        <div className="text-xs text-muted-foreground mt-1">Match: {holisticStylometricsCompareResult.textA?.closestAuthorMatch}</div>
                      </div>
                      <div className="p-3 bg-purple-100/60 rounded-lg">
                        <div className="font-semibold text-purple-800">{holisticStylometricsCompareResult.textB?.authorName}</div>
                        <div className="text-2xl font-bold text-purple-600">{holisticStylometricsCompareResult.textB?.aggregatedVerticalityScore?.toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground">{holisticStylometricsCompareResult.textB?.classification}</div>
                        <div className="text-xs text-muted-foreground mt-1">Match: {holisticStylometricsCompareResult.textB?.closestAuthorMatch}</div>
                      </div>
                    </div>

                    <div className="text-center p-3 bg-white/60 rounded-lg">
                      <div className="text-3xl font-bold text-indigo-600">{holisticStylometricsCompareResult.comparison?.verticalityDifference?.toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">Verticality Difference</div>
                    </div>

                    {holisticStylometricsCompareResult.comparison?.keyDivergences?.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-indigo-800">Key Differences:</Label>
                        <div className="space-y-1">
                          {holisticStylometricsCompareResult.comparison.keyDivergences.map((div: any, i: number) => (
                            <div key={i} className="p-2 bg-white/60 rounded text-sm">
                              <span className="font-medium">{div.feature}:</span> {div.analysis}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {holisticStylometricsCompareResult.comparison?.sameRoomScenario && (
                      <div className="p-3 bg-white/60 rounded-lg italic text-sm text-gray-700">
                        <Label className="text-indigo-800 not-italic">If They Met:</Label>
                        <p className="mt-1">{holisticStylometricsCompareResult.comparison.sameRoomScenario}</p>
                      </div>
                    )}
                  </div>
                )}
                
                {stylometricsReport && !holisticStylometricsCompareResult && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Comparison Results</Label>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard.writeText(stylometricsReport);
                          toast({ description: "Report copied to clipboard" });
                        }}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                    <ScrollArea className="h-[250px] border rounded-lg p-4 bg-gradient-to-br from-indigo-50 to-violet-50">
                      <pre className="font-sans text-sm whitespace-pre-wrap">{stylometricsReport}</pre>
                    </ScrollArea>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
          
          <div className="flex justify-between items-center pt-4 border-t mt-4">
            <div className="text-sm text-muted-foreground">
              Using: <span className="font-semibold uppercase">{selectedLLM}</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStylometricsReport("");
                  setStylometricsData(null);
                  setStylometricsText("");
                  setStylometricsTextB("");
                  setStylometricsAuthorName("");
                  setStylometricsAuthorNameB("");
                  setStylometricsSourceTitle("");
                  setHolisticStylometricsResult(null);
                  setHolisticStylometricsCompareResult(null);
                  setStylometricsProgress(null);
                }}
              >
                Clear
              </Button>
              <Button
                onClick={handleStylometricsAnalyze}
                disabled={isAnalyzingStylometrics}
                className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white"
                data-testid="button-analyze-stylometrics"
              >
                {isAnalyzingStylometrics ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                    Analyzing...
                  </>
                ) : (
                  <>
                    <BarChart3 className="w-4 h-4 mr-2" />
                    {stylometricsTab === "single" ? "Analyze" : "Compare"}
                  </>
                )}
              </Button>
            </div>
          </div>
        </ResizableDialogContent>
      </ResizableDialog>
      
      {/* Intelligence Meter Dialog */}
      <ResizableDialog open={showIntelligenceDialog} onOpenChange={setShowIntelligenceDialog}>
        <ResizableDialogContent defaultWidth={900} defaultHeight={700} minWidth={500} minHeight={400}>
          <ResizableDialogHeader>
            <ResizableDialogTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="w-6 h-6 text-amber-600" />
              Intelligence Meter
            </ResizableDialogTitle>
            <ResizableDialogDescription>
              Extract truly sharp, knife-like insights and measure intellectual density.
            </ResizableDialogDescription>
          </ResizableDialogHeader>
          
          <Tabs value={intelligenceTab} onValueChange={(v) => setIntelligenceTab(v as "single" | "compare")} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="single" className="gap-2">
                <BookOpen className="w-4 h-4" />
                Measure Intelligence
              </TabsTrigger>
              <TabsTrigger value="compare" className="gap-2">
                <GitCompare className="w-4 h-4" />
                Compare Intelligence
              </TabsTrigger>
            </TabsList>
            
            <div className="flex-1 overflow-y-auto mt-4">
              <TabsContent value="single" className="mt-0 space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="intelligence-text">Text to Analyze</Label>
                    <div className="flex items-center gap-3">
                      <input
                        type="file"
                        ref={intelFileRefA}
                        accept=".txt,.md,.text"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleIntelFileUpload(e.target.files[0], 'A')}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => intelFileRefA.current?.click()}
                        className="h-7 text-xs gap-1"
                      >
                        <Upload className="w-3 h-3" />
                        Upload
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        {(intelligenceTextA || text).split(/\s+/).filter(Boolean).length} words
                      </span>
                    </div>
                  </div>
                  <div
                    className={`relative rounded-lg transition-all ${isDraggingIntelA ? 'ring-2 ring-amber-500 bg-amber-50' : ''}`}
                    onDrop={(e) => handleIntelDrop(e, 'A')}
                    onDragOver={(e) => handleIntelDragOver(e, 'A')}
                    onDragLeave={(e) => handleIntelDragLeave(e, 'A')}
                  >
                    <Textarea
                      id="intelligence-text"
                      placeholder="Paste text here, drag & drop a file, or click Upload..."
                      value={intelligenceTextA}
                      onChange={(e) => setIntelligenceTextA(e.target.value)}
                      className="min-h-[200px] font-serif"
                      data-testid="textarea-intelligence"
                    />
                    {isDraggingIntelA && (
                      <div className="absolute inset-0 bg-amber-100/80 rounded-lg flex items-center justify-center pointer-events-none">
                        <div className="text-amber-700 font-medium flex items-center gap-2">
                          <Upload className="w-5 h-5" />
                          Drop file here
                        </div>
                      </div>
                    )}
                  </div>
                  {!intelligenceTextA && text && (
                    <p className="text-xs text-muted-foreground">Will use main input text ({text.split(/\s+/).filter(Boolean).length} words)</p>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="intel-author">Author (optional)</Label>
                    <Input
                      id="intel-author"
                      placeholder="Inferred from text if not provided"
                      value={intelligenceAuthor}
                      onChange={(e) => setIntelligenceAuthor(e.target.value)}
                      data-testid="input-intel-author"
                    />
                  </div>
                  <div className="flex items-center gap-3 pt-6">
                    <Switch
                      id="use-intel-outline"
                      checked={useIntelOutlineMode}
                      onCheckedChange={setUseIntelOutlineMode}
                      data-testid="switch-intel-outline"
                    />
                    <Label htmlFor="use-intel-outline" className="text-sm">
                      Use Outline Mode (for large texts)
                    </Label>
                  </div>
                </div>

                {intelligenceProgress && isAnalyzingIntelligence && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-amber-600 border-t-transparent" />
                      <div>
                        <p className="font-medium text-amber-800">{intelligenceProgress.message}</p>
                        {intelligenceProgress.current && intelligenceProgress.total && (
                          <p className="text-sm text-amber-600">
                            Section {intelligenceProgress.current} of {intelligenceProgress.total}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {holisticIntelResult && (() => {
                  const totalWords = holisticIntelResult.analysis.split(/\s+/).filter(Boolean).length + 
                    holisticIntelResult.quotes.reduce((sum, q) => sum + q.quote.split(/\s+/).filter(Boolean).length, 0);
                  const shouldPaywall = !hasCredits && totalWords > PAYWALL_WORD_LIMIT;
                  
                  if (shouldPaywall) {
                    return (
                      <div className="space-y-4 p-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg border border-amber-200">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-lg text-amber-800">Intelligence Score</h4>
                          <div className="text-5xl font-bold text-amber-600">{holisticIntelResult.score}</div>
                        </div>
                        <div className="text-sm text-amber-700 truncate bg-white/40 p-3 rounded-lg">
                          {holisticIntelResult.analysis.substring(0, 200)}...
                        </div>
                        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl p-6 shadow-lg">
                          <div className="flex flex-col items-center text-center space-y-4">
                            <div className="bg-amber-100 p-3 rounded-full">
                              <Lock className="w-8 h-8 text-amber-600" />
                            </div>
                            <div>
                              <h3 className="text-lg font-bold text-gray-900">Full Intelligence Report Paywalled</h3>
                              <p className="text-sm text-gray-600 mt-1">
                                {holisticIntelResult.quotes.length} signal quotes with {totalWords.toLocaleString()} total words. Purchase credits to unlock.
                              </p>
                            </div>
                            <Button
                              onClick={handleBuyCredits}
                              className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold px-8 py-3 text-lg shadow-md"
                              data-testid="button-intel-paywall-buy-credits"
                            >
                              <CreditCard className="w-5 h-5 mr-2" />
                              Buy Credits to Unlock
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  
                  return (
                  <div className="space-y-4 p-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg border border-amber-200">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-lg text-amber-800">Intelligence Score</h4>
                      <div className="text-5xl font-bold text-amber-600">
                        {holisticIntelResult.score}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div className="p-3 bg-white/60 rounded-lg">
                        <div className="text-2xl font-bold text-amber-700">{(holisticIntelResult.ratio * 100).toFixed(1)}%</div>
                        <div className="text-xs text-muted-foreground">Signal Ratio</div>
                      </div>
                      <div className="p-3 bg-white/60 rounded-lg">
                        <div className="text-2xl font-bold text-amber-700">{holisticIntelResult.totalSignalLength.toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">Signal Chars</div>
                      </div>
                      <div className="p-3 bg-white/60 rounded-lg">
                        <div className="text-2xl font-bold text-amber-700">{holisticIntelResult.quotes.length}</div>
                        <div className="text-xs text-muted-foreground">Unique Quotes</div>
                      </div>
                    </div>

                    <div className="text-sm text-amber-700 whitespace-pre-wrap bg-white/40 p-3 rounded-lg">
                      {holisticIntelResult.analysis}
                    </div>

                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="default"
                        className="bg-amber-600 hover:bg-amber-700"
                        onClick={() => {
                          const fullReport = `INTELLIGENCE METER REPORT
========================================

${holisticIntelResult.analysis}

========================================
EXTRACTED SIGNAL QUOTES (${holisticIntelResult.quotes.length} total)
========================================

${holisticIntelResult.quotes.map((q, i) => `${i + 1}. [${q.source}]
"${q.quote}"
— ${q.author}
`).join('\n')}`;
                          const blob = new Blob([fullReport], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = 'intelligence_report.txt';
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        data-testid="button-download-intel-report"
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Download Full Report
                      </Button>
                    </div>
                    
                    {holisticIntelResult.quotes.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Signal Quotes ({holisticIntelResult.quotes.length}):</Label>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const formatted = holisticIntelResult.quotes
                                  .map((q) => `${q.quote} | ${q.source}`)
                                  .join('\n');
                                navigator.clipboard.writeText(formatted);
                                toast({ title: "Copied", description: "Quotes copied to clipboard" });
                              }}
                              data-testid="button-copy-intel-quotes"
                            >
                              <Copy className="w-4 h-4 mr-1" />
                              Copy
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const formatted = holisticIntelResult.quotes
                                  .map((q) => `${q.quote} | ${q.source}`)
                                  .join('\n');
                                const blob = new Blob([formatted], { type: 'text/plain' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = 'intelligence_quotes.txt';
                                a.click();
                                URL.revokeObjectURL(url);
                              }}
                              data-testid="button-download-intel-quotes"
                            >
                              <Download className="w-4 h-4 mr-1" />
                              Download
                            </Button>
                          </div>
                        </div>
                        <ScrollArea className="h-[200px] border rounded-lg p-3 bg-white/60">
                          <div className="space-y-2">
                            {holisticIntelResult.quotes.map((q, i) => (
                              <div key={i} className="text-sm font-serif text-gray-700 p-2 border-b last:border-b-0">
                                {q.quote} <span className="text-xs text-muted-foreground">| {q.source}</span>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                  );
                })()}

                {intelligenceResult && !holisticIntelResult && (
                  <div className="space-y-4 p-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg border border-amber-200">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-lg text-amber-800">Intelligence Score</h4>
                      <div className="text-4xl font-bold text-amber-600">
                        {intelligenceResult.score}/100
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div className="p-3 bg-white/60 rounded-lg">
                        <div className="text-2xl font-bold text-amber-700">{intelligenceResult.wordCount}</div>
                        <div className="text-xs text-muted-foreground">Total Words</div>
                      </div>
                      <div className="p-3 bg-white/60 rounded-lg">
                        <div className="text-2xl font-bold text-amber-700">{intelligenceResult.quoteCount}</div>
                        <div className="text-xs text-muted-foreground">Sharp Quotes</div>
                      </div>
                      <div className="p-3 bg-white/60 rounded-lg">
                        <div className="text-2xl font-bold text-amber-700">{intelligenceResult.density}</div>
                        <div className="text-xs text-muted-foreground">Per 1000 Words</div>
                      </div>
                    </div>
                    
                    {(intelligenceResult.sharpQuotes || []).filter(q => q).length > 0 ? (
                      <div className="space-y-2">
                        <Label>Sharp Quotes Found:</Label>
                        <ScrollArea className="h-[200px] border rounded-lg p-3 bg-white/60">
                          <ol className="list-decimal list-inside space-y-2">
                            {(intelligenceResult.sharpQuotes || []).filter(q => q).map((quote, i) => (
                              <li key={i} className="text-sm font-serif italic text-gray-700">
                                "{quote}"
                              </li>
                            ))}
                          </ol>
                        </ScrollArea>
                      </div>
                    ) : (
                      <div className="text-center py-4 text-muted-foreground">
                        No unmistakably sharp quotes detected in this text.
                      </div>
                    )}
                    
                    {intelligenceResult.analysis && (
                      <p className="text-sm text-muted-foreground italic">{intelligenceResult.analysis}</p>
                    )}
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="compare" className="mt-0 space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-blue-800">Text A</h4>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => intelFileRefA.current?.click()}
                        className="h-6 text-xs gap-1 bg-white"
                      >
                        <Upload className="w-3 h-3" />
                        Upload
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Text *</Label>
                        <span className="text-xs text-muted-foreground">
                          {intelligenceTextA.split(/\s+/).filter(Boolean).length} words
                        </span>
                      </div>
                      <div
                        className={`relative rounded-lg transition-all ${isDraggingIntelA ? 'ring-2 ring-blue-500 bg-blue-100' : ''}`}
                        onDrop={(e) => handleIntelDrop(e, 'A')}
                        onDragOver={(e) => handleIntelDragOver(e, 'A')}
                        onDragLeave={(e) => handleIntelDragLeave(e, 'A')}
                      >
                        <Textarea
                          placeholder="Paste Text A or drag & drop file..."
                          value={intelligenceTextA}
                          onChange={(e) => setIntelligenceTextA(e.target.value)}
                          className="min-h-[150px] font-serif text-sm"
                          data-testid="textarea-intel-a"
                        />
                        {isDraggingIntelA && (
                          <div className="absolute inset-0 bg-blue-200/80 rounded-lg flex items-center justify-center pointer-events-none">
                            <div className="text-blue-700 font-medium flex items-center gap-2">
                              <Upload className="w-4 h-4" />
                              Drop file
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-purple-800">Text B</h4>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => intelFileRefB.current?.click()}
                        className="h-6 text-xs gap-1 bg-white"
                      >
                        <Upload className="w-3 h-3" />
                        Upload
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Text *</Label>
                        <span className="text-xs text-muted-foreground">
                          {intelligenceTextB.split(/\s+/).filter(Boolean).length} words
                        </span>
                      </div>
                      <div
                        className={`relative rounded-lg transition-all ${isDraggingIntelB ? 'ring-2 ring-purple-500 bg-purple-100' : ''}`}
                        onDrop={(e) => handleIntelDrop(e, 'B')}
                        onDragOver={(e) => handleIntelDragOver(e, 'B')}
                        onDragLeave={(e) => handleIntelDragLeave(e, 'B')}
                      >
                        <Textarea
                          placeholder="Paste Text B or drag & drop file..."
                          value={intelligenceTextB}
                          onChange={(e) => setIntelligenceTextB(e.target.value)}
                          className="min-h-[150px] font-serif text-sm"
                          data-testid="textarea-intel-b"
                        />
                        {isDraggingIntelB && (
                          <div className="absolute inset-0 bg-purple-200/80 rounded-lg flex items-center justify-center pointer-events-none">
                            <div className="text-purple-700 font-medium flex items-center gap-2">
                              <Upload className="w-4 h-4" />
                              Drop file
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
                <input
                  type="file"
                  ref={intelFileRefB}
                  accept=".txt,.md,.text"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleIntelFileUpload(e.target.files[0], 'B')}
                />
                
                {intelligenceCompareResult && (
                  <div className="space-y-4 p-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg border border-amber-200">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-amber-800 mb-2">{intelligenceCompareResult.winner}</div>
                      <p className="text-sm text-muted-foreground italic">{intelligenceCompareResult.verdict}</p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-blue-100/50 rounded-lg border border-blue-200">
                        <h5 className="font-semibold text-blue-800 mb-2">Text A: {intelligenceCompareResult.textA.score}/100</h5>
                        <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                          <div>Words: {intelligenceCompareResult.textA.wordCount}</div>
                          <div>Density: {intelligenceCompareResult.textA.density}</div>
                        </div>
                        {(intelligenceCompareResult.textA.sharpQuotes || []).filter(q => q).length > 0 ? (
                          <ScrollArea className="h-[120px]">
                            <ol className="list-decimal list-inside space-y-1 text-xs">
                              {(intelligenceCompareResult.textA.sharpQuotes || []).filter(q => q).map((q, i) => (
                                <li key={i} className="italic">"{q}"</li>
                              ))}
                            </ol>
                          </ScrollArea>
                        ) : (
                          <p className="text-xs text-muted-foreground">No sharp quotes found</p>
                        )}
                      </div>
                      
                      <div className="p-4 bg-purple-100/50 rounded-lg border border-purple-200">
                        <h5 className="font-semibold text-purple-800 mb-2">Text B: {intelligenceCompareResult.textB.score}/100</h5>
                        <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                          <div>Words: {intelligenceCompareResult.textB.wordCount}</div>
                          <div>Density: {intelligenceCompareResult.textB.density}</div>
                        </div>
                        {(intelligenceCompareResult.textB.sharpQuotes || []).filter(q => q).length > 0 ? (
                          <ScrollArea className="h-[120px]">
                            <ol className="list-decimal list-inside space-y-1 text-xs">
                              {(intelligenceCompareResult.textB.sharpQuotes || []).filter(q => q).map((q, i) => (
                                <li key={i} className="italic">"{q}"</li>
                              ))}
                            </ol>
                          </ScrollArea>
                        ) : (
                          <p className="text-xs text-muted-foreground">No sharp quotes found</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
          
          <div className="flex justify-between items-center pt-4 border-t mt-4">
            <div className="text-sm text-muted-foreground">
              Using: <span className="font-semibold uppercase">{selectedLLM}</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIntelligenceResult(null);
                  setIntelligenceCompareResult(null);
                  setIntelligenceTextA("");
                  setIntelligenceTextB("");
                }}
              >
                Clear
              </Button>
              <Button
                onClick={handleMeasureIntelligence}
                disabled={isAnalyzingIntelligence}
                className="bg-gradient-to-r from-amber-600 to-orange-600 text-white"
                data-testid="button-measure-intelligence"
              >
                {isAnalyzingIntelligence ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                    Measuring...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    {intelligenceTab === "single" ? "Measure Intelligence" : "Compare Intelligence"}
                  </>
                )}
              </Button>
            </div>
          </div>
        </ResizableDialogContent>
      </ResizableDialog>
      
      {/* History Dialog */}
      <ResizableDialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
        <ResizableDialogContent defaultWidth={900} defaultHeight={600} minWidth={500} minHeight={400}>
          <ResizableDialogHeader>
            <ResizableDialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              Analysis History
            </ResizableDialogTitle>
            <ResizableDialogDescription>
              View your past analyses. All outputs are automatically saved when logged in.
            </ResizableDialogDescription>
          </ResizableDialogHeader>
          
          <div className="flex gap-2 items-center mb-4">
            <Label className="text-sm font-medium">Filter by type:</Label>
            <Select 
              value={historyTypeFilter} 
              onValueChange={(v) => {
                setHistoryTypeFilter(v);
                loadHistory(v);
              }}
            >
              <SelectTrigger className="w-[180px]" data-testid="select-history-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="quotes">Quotes</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex gap-4 h-[60vh]">
            <ScrollArea className="flex-1 border rounded-lg p-2">
              {isLoadingHistory ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Loading...
                </div>
              ) : historyItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <History className="w-12 h-12 mb-2 opacity-50" />
                  <p>No history yet</p>
                  <p className="text-sm">Your analyses will appear here</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {historyItems.map((item) => (
                    <Card 
                      key={item.id}
                      className={`p-3 cursor-pointer hover:bg-muted/50 transition-colors ${selectedHistoryItem?.id === item.id ? 'ring-2 ring-primary' : ''}`}
                      onClick={() => setSelectedHistoryItem(item)}
                      data-testid={`history-item-${item.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {formatAnalysisType(item.analysisType)}
                          </Badge>
                          <span className="text-xs text-muted-foreground uppercase">
                            {item.provider}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {new Date(item.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {item.inputPreview}
                      </p>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
            
            <div className="flex-1 border rounded-lg flex flex-col">
              {selectedHistoryItem ? (
                <>
                  <div className="p-3 border-b flex items-center justify-between bg-muted/30">
                    <div>
                      <h4 className="font-semibold">{formatAnalysisType(selectedHistoryItem.analysisType)}</h4>
                      <p className="text-xs text-muted-foreground">
                        {new Date(selectedHistoryItem.createdAt).toLocaleString()} • {selectedHistoryItem.provider?.toUpperCase()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const content = JSON.stringify(selectedHistoryItem.outputData, null, 2);
                          navigator.clipboard.writeText(content);
                          toast({ description: "Copied to clipboard" });
                        }}
                        data-testid="button-copy-history"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDeleteHistoryItem(selectedHistoryItem.id)}
                        data-testid="button-delete-history"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="flex-1 p-3">
                    <pre className="text-xs whitespace-pre-wrap font-mono">
                      {(() => {
                        const data = selectedHistoryItem.outputData;
                        if (!data) return "No output data";
                        
                        // Handle structured quote extraction
                        if (selectedHistoryItem.analysisType === "quotes" && data.quotes) {
                          const safeQuotes = (data.quotes || []).filter((q: any) => q);
                          return safeQuotes.length > 0 
                            ? safeQuotes.map((q: string, i: number) => `${i + 1}. "${q}"`).join('\n\n')
                            : "No quotes found";
                        }
                        // Handle annotated quotes
                        if (selectedHistoryItem.analysisType === "context" && data.annotatedQuotes) {
                          const safeAnnotated = (data.annotatedQuotes || []).filter((q: any) => q && q.quote);
                          return safeAnnotated.length > 0
                            ? safeAnnotated.map((q: any, i: number) => 
                                `${i + 1}. "${q.quote}"\n   → ${q.context || ''}`
                              ).join('\n\n')
                            : "No annotated quotes found";
                        }
                        // Handle compression/rewrite
                        if (selectedHistoryItem.analysisType === "rewrite" && data.summary) {
                          return data.summary;
                        }
                        // Handle database output
                        if (selectedHistoryItem.analysisType === "database" && data.database) {
                          return data.database;
                        }
                        // Handle analyzer output
                        if (selectedHistoryItem.analysisType === "analyzer" && data.analyzer) {
                          return data.analyzer;
                        }
                        
                        // Fallback for rawContent (from streaming when JSON parse fails)
                        if (data.rawContent) {
                          return data.rawContent;
                        }
                        
                        return JSON.stringify(data, null, 2);
                      })()}
                    </pre>
                  </ScrollArea>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Eye className="w-12 h-12 mb-2 opacity-50" />
                  <p>Select an item to view</p>
                </div>
              )}
            </div>
          </div>
        </ResizableDialogContent>
      </ResizableDialog>

      {/* Quote Finder Dialog */}
      <ResizableDialog open={showQuoteFinderDialog} onOpenChange={setShowQuoteFinderDialog}>
        <ResizableDialogContent defaultWidth={900} defaultHeight={700} minWidth={500} minHeight={400}>
          <ResizableDialogHeader>
            <ResizableDialogTitle className="flex items-center gap-2 text-xl">
              <Search className="w-6 h-6 text-rose-600" />
              Quote Finder (Positions → Quotes)
            </ResizableDialogTitle>
          </ResizableDialogHeader>
          
          <div className="flex-1 overflow-auto space-y-4 p-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="quote-finder-author">Author Name *</Label>
                <Input
                  id="quote-finder-author"
                  placeholder="e.g., Immanuel Kant"
                  value={quoteFinderAuthor}
                  onChange={(e) => setQuoteFinderAuthor(e.target.value)}
                  data-testid="input-quote-finder-author"
                />
              </div>
              <div className="space-y-2">
                <Label>Search Source</Label>
                <div className="flex items-center gap-2">
                  <Button
                    variant={quoteFinderSource === "llm" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setQuoteFinderSource("llm")}
                    className={quoteFinderSource === "llm" ? "bg-gradient-to-r from-purple-600 to-blue-600" : ""}
                    data-testid="button-source-llm"
                  >
                    LLM Knowledge
                  </Button>
                  <Button
                    variant={quoteFinderSource === "database" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setQuoteFinderSource("database")}
                    className={quoteFinderSource === "database" ? "bg-gradient-to-r from-green-600 to-teal-600" : ""}
                    data-testid="button-source-database"
                  >
                    Internal Database
                  </Button>
                </div>
              </div>
            </div>
            
            {quoteFinderSource === "llm" && (
              <div className="text-xs text-muted-foreground bg-purple-50 p-2 rounded">
                Using {selectedLLM.toUpperCase()} to find quotes from its training knowledge. Works best for famous authors.
              </div>
            )}
            {quoteFinderSource === "database" && (
              <div className="text-xs text-muted-foreground bg-green-50 p-2 rounded">
                Searching your internal corpus database. Upload author works first via Corpus Manager.
              </div>
            )}
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="quote-finder-positions">Positions (one per line) *</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => positionsFileRef.current?.click()}
                  className="h-7 text-xs"
                  data-testid="button-upload-positions"
                >
                  <Upload className="w-3 h-3 mr-1" />
                  Upload .txt
                </Button>
                <input
                  type="file"
                  ref={positionsFileRef}
                  accept=".txt"
                  className="hidden"
                  onChange={handlePositionsFileUpload}
                />
              </div>
              <Textarea
                id="quote-finder-positions"
                placeholder="Pure practical reason has primacy over speculative reason.
The moral law is a fact of reason.
Act only on maxims that can be universal laws.
Freedom is the ratio essendi of the moral law."
                value={quoteFinderPositions}
                onChange={(e) => setQuoteFinderPositions(e.target.value)}
                className="min-h-[120px] font-mono text-sm"
                data-testid="input-quote-finder-positions"
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="quote-finder-corpus">Author's Corpus Text (optional for famous authors)</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {quoteFinderCorpus ? `${quoteFinderCorpus.split(/\s+/).filter(Boolean).length} words` : 
                     text ? `Main input: ${text.split(/\s+/).filter(Boolean).length} words` : 
                     "LLM will use its knowledge"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => corpusFileRef.current?.click()}
                    className="h-7 text-xs"
                    data-testid="button-upload-corpus"
                  >
                    <Upload className="w-3 h-3 mr-1" />
                    Upload .txt
                  </Button>
                  <input
                    type="file"
                    ref={corpusFileRef}
                    accept=".txt"
                    className="hidden"
                    onChange={handleCorpusFileUpload}
                  />
                </div>
              </div>
              <Textarea
                id="quote-finder-corpus"
                placeholder="Leave empty for famous authors - LLM will use its knowledge. Or paste/upload the author's text here..."
                value={quoteFinderCorpus}
                onChange={(e) => setQuoteFinderCorpus(e.target.value)}
                className="min-h-[150px] font-mono text-sm"
                data-testid="input-quote-finder-corpus"
              />
              
              {quoteFinderError && (
                <div className="bg-gradient-to-r from-red-600 to-rose-600 text-white p-4 rounded-lg font-bold text-center animate-pulse">
                  {quoteFinderError}
                </div>
              )}
            </div>
            
            {quoteFinderResults.length > 0 && (
              <div className="space-y-3">
                <Label>Results ({quoteFinderResults.length} quotes found)</Label>
                <ScrollArea className="h-[300px] border rounded-lg p-3 bg-gray-50">
                  <div className="space-y-4">
                    {quoteFinderResults.filter(r => r).map((result, i) => (
                      <div key={i} className="bg-white rounded-lg p-4 border-2 border-rose-200 shadow-sm" data-testid={`quote-result-${i}`}>
                        <div className="flex items-start gap-3 mb-3">
                          <span className="flex-none w-7 h-7 rounded-full bg-gradient-to-br from-rose-500 to-red-600 text-white flex items-center justify-center text-sm font-bold">
                            {i + 1}
                          </span>
                          <div className="flex-1">
                            <p className="font-semibold text-rose-800 text-sm mb-1">POSITION:</p>
                            <p className="text-gray-700">{result.position}</p>
                          </div>
                        </div>
                        <div className="pl-10 space-y-2">
                          <div>
                            <p className="font-semibold text-green-700 text-sm mb-1">QUOTE:</p>
                            <blockquote className="font-serif italic text-gray-800 border-l-3 border-green-500 pl-3">
                              "{result.quote}"
                            </blockquote>
                          </div>
                          {result.source && (
                            <div>
                              <p className="font-semibold text-blue-700 text-sm mb-1">SOURCE:</p>
                              <p className="text-gray-600 text-sm">{result.source}</p>
                            </div>
                          )}
                          {result.error && (
                            <p className="text-red-500 text-sm">Error: {result.error}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
          
          <div className="flex justify-between items-center pt-4 border-t mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setQuoteFinderResults([]);
                setQuoteFinderAuthor("");
                setQuoteFinderPositions("");
                setQuoteFinderCorpus("");
              }}
              data-testid="button-quote-finder-clear"
            >
              Clear All
            </Button>
            <Button
              onClick={handleFindQuotes}
              disabled={isSearchingQuotes}
              className="bg-gradient-to-r from-rose-600 to-red-600 text-white"
              data-testid="button-generate-quotes"
            >
              {isSearchingQuotes ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4 mr-2" />
                  Generate Quotes
                </>
              )}
            </Button>
          </div>
        </ResizableDialogContent>
      </ResizableDialog>

      {/* Position Extractor Dialog */}
      <ResizableDialog open={showPositionExtractor} onOpenChange={setShowPositionExtractor}>
        <ResizableDialogContent defaultWidth={900} defaultHeight={700} minWidth={500} minHeight={400}>
          <ResizableDialogHeader>
            <ResizableDialogTitle className="flex items-center gap-2 text-xl">
              <FileText className="w-6 h-6 text-violet-600" />
              Position Extractor
              <span className="text-sm font-normal text-muted-foreground ml-2">
                (Holistic Analysis)
              </span>
            </ResizableDialogTitle>
          </ResizableDialogHeader>
          
          <div className="flex-1 overflow-auto space-y-4 p-4">
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-4">
              <p className="text-sm text-violet-800">
                <strong>How it works:</strong> With Outline Mode ON, this tool first generates a structured outline of the full text, 
                then slices by section and extracts positions with global context. This prevents blind chunking, avoids repetitions, 
                and ensures holistic comprehension.
              </p>
              <p className="text-sm text-violet-600 mt-2">
                <strong>Current text:</strong> {text.split(/\s+/).filter(Boolean).length.toLocaleString()} words
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="position-author" className="text-sm font-medium text-violet-800">Author Name</Label>
              <Input
                id="position-author"
                placeholder="Enter the author's name (e.g., Immanuel Kant)"
                value={positionExtractorAuthor}
                onChange={(e) => setPositionExtractorAuthor(e.target.value)}
                className="border-violet-200 focus:border-violet-400"
                data-testid="input-position-author"
              />
              <p className="text-xs text-muted-foreground">Required: Identify who wrote this text so quotes are properly attributed.</p>
            </div>

            <div className="flex items-center justify-between p-3 bg-violet-50 rounded-lg border border-violet-200">
              <div className="flex items-center gap-2">
                <Label htmlFor="outline-mode" className="text-sm font-medium text-violet-800">Use Outline Mode (for large texts)</Label>
                <span className="text-xs text-violet-600">(Full text comprehension, no blind chunking)</span>
              </div>
              <input
                type="checkbox"
                id="outline-mode"
                checked={useOutlineMode}
                onChange={(e) => setUseOutlineMode(e.target.checked)}
                className="h-4 w-4 accent-violet-600"
                data-testid="checkbox-outline-mode"
              />
            </div>

            <div className="space-y-3 p-3 bg-violet-50 rounded-lg border border-violet-200">
              <div className="flex items-center justify-between">
                <Label htmlFor="position-depth" className="text-sm font-medium text-violet-800">
                  Extraction Depth: {positionExtractionDepth}/10
                </Label>
                <span className="text-xs text-violet-600">
                  {positionExtractionDepth <= 3 ? "Quick scan" :
                   positionExtractionDepth <= 5 ? "Standard" :
                   positionExtractionDepth <= 7 ? "Thorough" :
                   positionExtractionDepth <= 9 ? "Deep extraction" :
                   "Exhaustive (max coverage)"}
                </span>
              </div>
              <input
                type="range"
                id="position-depth"
                min="1"
                max="10"
                value={positionExtractionDepth}
                onChange={(e) => setPositionExtractionDepth(parseInt(e.target.value))}
                className="w-full h-2 bg-violet-200 rounded-lg appearance-none cursor-pointer accent-violet-600"
                data-testid="slider-position-depth"
              />
              <p className="text-xs text-muted-foreground">
                Higher depth = more positions extracted. For 1300-page books, use depth 8-10 to get 500+ unique positions.
              </p>
            </div>

            {positionExtractorProgress && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  {positionExtractorProgress.stage !== "complete" && positionExtractorProgress.stage !== "error" && (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
                  )}
                  {positionExtractorProgress.stage === "complete" && (
                    <div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center">
                      <span className="text-white text-xs">✓</span>
                    </div>
                  )}
                  {positionExtractorProgress.stage === "error" && (
                    <div className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center">
                      <span className="text-white text-xs">✕</span>
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-blue-800">{positionExtractorProgress.message}</p>
                    {positionExtractorProgress.current && positionExtractorProgress.total && (
                      <div className="mt-2">
                        <div className="h-2 bg-blue-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-blue-600 transition-all duration-300"
                            style={{ width: `${(positionExtractorProgress.current / positionExtractorProgress.total) * 100}%` }}
                          />
                        </div>
                        <p className="text-xs text-blue-600 mt-1">
                          Section {positionExtractorProgress.current} of {positionExtractorProgress.total}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {positionExtractionSummary && (
              <div className="bg-gray-50 border rounded-lg p-4">
                <h4 className="font-semibold text-sm text-gray-700 mb-2">Document Summary</h4>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">{positionExtractionSummary}</p>
              </div>
            )}

            {extractedPositions.length > 0 && (() => {
              const totalWords = extractedPositions.reduce((sum, p) => sum + p.quote.split(/\s+/).filter(Boolean).length, 0);
              const shouldPaywall = !hasCredits && totalWords > PAYWALL_WORD_LIMIT;
              
              if (shouldPaywall) {
                const previewPositions = extractedPositions.slice(0, 3);
                return (
                  <div className="space-y-4">
                    <div className="border rounded-lg opacity-75">
                      <div className="p-3 bg-gray-50 border-b">
                        <h4 className="font-semibold text-violet-700">Extracted Positions (Preview)</h4>
                      </div>
                      <div className="p-3 space-y-3 max-h-[200px] overflow-hidden">
                        {previewPositions.map((pos, idx) => (
                          <div key={idx} className="p-3 bg-white border rounded-lg">
                            <p className="font-medium text-gray-900 truncate">"{pos.quote.substring(0, 100)}..."</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl p-6 shadow-lg">
                      <div className="flex flex-col items-center text-center space-y-4">
                        <div className="bg-amber-100 p-3 rounded-full">
                          <Lock className="w-8 h-8 text-amber-600" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-gray-900">Full Positions Paywalled</h3>
                          <p className="text-sm text-gray-600 mt-1">
                            {extractedPositions.length} positions with {totalWords.toLocaleString()} total words. Purchase credits to unlock.
                          </p>
                        </div>
                        <Button
                          onClick={handleBuyCredits}
                          className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold px-8 py-3 text-lg shadow-md"
                          data-testid="button-positions-paywall-buy-credits"
                        >
                          <CreditCard className="w-5 h-5 mr-2" />
                          Buy Credits to Unlock
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }
              
              return (
                <div className="border rounded-lg">
                  <div className="flex items-center justify-between p-3 bg-gray-50 border-b">
                    <div className="flex items-center gap-4">
                      <h4 className="font-semibold text-violet-700">
                        Extracted Positions ({showAllPositions ? extractedPositions.length : extractedPositions.filter(p => (p.importance ?? 5) >= 4).length} of {extractedPositions.length})
                      </h4>
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={showAllPositions}
                          onChange={(e) => setShowAllPositions(e.target.checked)}
                          className="h-3 w-3"
                          data-testid="checkbox-show-all-positions"
                        />
                        <span className="text-muted-foreground">Show All (even minor)</span>
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={copyPositionsToClipboard}
                        data-testid="button-copy-positions"
                      >
                        <Copy className="w-4 h-4 mr-1" />
                        Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={downloadPositions}
                        data-testid="button-download-positions"
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Download
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="h-[300px]">
                    <div className="p-3 space-y-3">
                      {extractedPositions.map((pos, originalIdx) => {
                        const isVisible = showAllPositions || (pos.importance ?? 5) >= 4;
                        if (!isVisible) return null;
                        return (
                          <div key={`pos-${originalIdx}-${pos.sectionIndex}`} className="p-3 bg-white border rounded-lg hover:shadow-sm transition-shadow">
                            <div className="flex items-start gap-3">
                              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center font-semibold text-sm">
                                {originalIdx + 1}
                              </span>
                              <div className="flex-1 space-y-1">
                                <p className="font-medium text-gray-900">"{pos.quote}"</p>
                                <div className="flex gap-4 text-xs text-muted-foreground">
                                  <span><strong>Author:</strong> {pos.author}</span>
                                  <span><strong>Section:</strong> {pos.source}</span>
                                  {pos.importance !== undefined && (
                                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                                      pos.importance >= 8 ? 'bg-red-100 text-red-700' :
                                      pos.importance >= 5 ? 'bg-yellow-100 text-yellow-700' :
                                      'bg-gray-100 text-gray-600'
                                    }`}>
                                      {pos.importance >= 8 ? 'Major' : pos.importance >= 5 ? 'Key' : 'Minor'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              );
            })()}

            {!isExtractingPositions && extractedPositions.length === 0 && !positionExtractorProgress && (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-3 text-violet-300" />
                <p>Click "Extract Positions" to analyze the loaded text.</p>
              </div>
            )}

            {/* Rewrite Extracted Positions option */}
            {extractedPositions.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-blue-800">Turn into Coherent Summary</h4>
                    <p className="text-xs text-blue-600 mt-1">
                      Use Full Document Rewrite to convert this position list into a flowing summary
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-blue-300 text-blue-700 hover:bg-blue-100"
                    onClick={() => {
                      const positionsList = extractedPositions
                        .map((p, i) => `${i + 1}. ${p.author} | "${p.quote}" | ${p.source}`)
                        .join('\n\n');
                      setRewriteInstructions(`Convert this list of extracted positions into a coherent, flowing summary. Organize by theme, maintain attribution, and create smooth transitions between points:\n\nPOSITIONS:\n${positionsList.substring(0, 5000)}`);
                      setShowRewriteDialog(true);
                    }}
                    data-testid="button-rewrite-positions"
                  >
                    <FileText className="w-4 h-4 mr-1" />
                    Rewrite as Summary
                  </Button>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex justify-between items-center pt-4 border-t mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setExtractedPositions([]);
                setPositionExtractorProgress(null);
                setPositionExtractionSummary("");
              }}
              data-testid="button-clear-positions"
            >
              Clear Results
            </Button>
            <Button
              onClick={handleExtractPositions}
              disabled={isExtractingPositions || !text.trim() || !positionExtractorAuthor.trim()}
              className="bg-gradient-to-r from-violet-600 to-purple-600 text-white"
              data-testid="button-extract-positions"
            >
              {isExtractingPositions ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Extracting...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 mr-2" />
                  Extract Positions
                </>
              )}
            </Button>
          </div>
        </ResizableDialogContent>
      </ResizableDialog>

      {/* Arguments Finder Dialog */}
      <ResizableDialog open={showArgumentsFinder} onOpenChange={setShowArgumentsFinder}>
        <ResizableDialogContent defaultWidth={900} defaultHeight={700} minWidth={500} minHeight={400}>
          <ResizableDialogHeader>
            <ResizableDialogTitle className="flex items-center gap-2 text-xl">
              <Layers className="w-6 h-6 text-teal-600" />
              Arguments Finder
              <span className="text-sm font-normal text-muted-foreground ml-2">
                (Holistic Analysis)
              </span>
            </ResizableDialogTitle>
          </ResizableDialogHeader>
          
          <div className="flex-1 overflow-auto space-y-4 p-4">
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
              <p className="text-sm text-teal-800">
                <strong>How it works:</strong> With Outline Mode ON, this tool first generates a structured outline of the full text, 
                then slices by section and extracts arguments with their premises, conclusions, and counterarguments. 
                This prevents blind chunking and ensures holistic comprehension.
              </p>
              <p className="text-sm text-teal-600 mt-2">
                <strong>Current text:</strong> {text.split(/\s+/).filter(Boolean).length.toLocaleString()} words
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="arguments-author" className="text-sm font-medium text-teal-800">Author Name *</Label>
              <Input
                id="arguments-author"
                placeholder="Enter the author's name (e.g., Immanuel Kant)"
                value={argumentsFinderAuthor}
                onChange={(e) => setArgumentsFinderAuthor(e.target.value)}
                className="border-teal-200 focus:border-teal-400"
                data-testid="input-arguments-author"
              />
              <p className="text-xs text-muted-foreground">Required: Identify who wrote this text so arguments are properly attributed.</p>
            </div>

            <div className="flex items-center justify-between p-3 bg-teal-50 rounded-lg border border-teal-200">
              <div className="flex items-center gap-2">
                <Label htmlFor="arguments-outline-mode" className="text-sm font-medium text-teal-800">Use Outline Mode (for large texts)</Label>
                <span className="text-xs text-teal-600">(Full text comprehension, no blind chunking)</span>
              </div>
              <input
                type="checkbox"
                id="arguments-outline-mode"
                checked={useArgumentsOutlineMode}
                onChange={(e) => setUseArgumentsOutlineMode(e.target.checked)}
                className="h-4 w-4 accent-teal-600"
                data-testid="checkbox-arguments-outline-mode"
              />
            </div>

            <div className="space-y-3 p-4 bg-gradient-to-r from-teal-50 to-cyan-50 rounded-lg border border-teal-200">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium text-teal-800">Extraction Depth</Label>
                  <p className="text-xs text-teal-600 mt-0.5">
                    {argumentsExtractionDepth >= 8 ? "Deep mode: exhaustive extraction, 100+ arguments on large texts" : 
                     argumentsExtractionDepth >= 5 ? "Standard mode: balanced extraction" : 
                     "Quick mode: key arguments only"}
                  </p>
                </div>
                <span className="text-lg font-bold text-teal-700 bg-white px-3 py-1 rounded-lg border border-teal-300">
                  {argumentsExtractionDepth}/10
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={argumentsExtractionDepth}
                onChange={(e) => setArgumentsExtractionDepth(Number(e.target.value))}
                className="w-full h-2 bg-teal-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                data-testid="slider-extraction-depth"
              />
              <div className="flex justify-between text-xs text-teal-600">
                <span>Quick (1)</span>
                <span>Standard (5)</span>
                <span>Deep (10)</span>
              </div>
            </div>

            {argumentsFinderProgress && (
              <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  {argumentsFinderProgress.stage !== "complete" && argumentsFinderProgress.stage !== "error" && (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-teal-600" />
                  )}
                  {argumentsFinderProgress.stage === "complete" && (
                    <div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center">
                      <span className="text-white text-xs">✓</span>
                    </div>
                  )}
                  {argumentsFinderProgress.stage === "error" && (
                    <div className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center">
                      <span className="text-white text-xs">✕</span>
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-teal-800">{argumentsFinderProgress.message}</p>
                    {argumentsFinderProgress.current && argumentsFinderProgress.total && (
                      <div className="mt-2">
                        <div className="h-2 bg-teal-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-teal-600 transition-all duration-300"
                            style={{ width: `${(argumentsFinderProgress.current / argumentsFinderProgress.total) * 100}%` }}
                          />
                        </div>
                        <p className="text-xs text-teal-600 mt-1">
                          Section {argumentsFinderProgress.current} of {argumentsFinderProgress.total}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {extractedArguments.length > 0 && (() => {
              const totalWords = extractedArguments.reduce((sum, a) => 
                sum + a.premises.join(' ').split(/\s+/).filter(Boolean).length + a.conclusion.split(/\s+/).filter(Boolean).length, 0);
              const shouldPaywall = !hasCredits && totalWords > PAYWALL_WORD_LIMIT;
              
              if (shouldPaywall) {
                const previewArgs = extractedArguments.slice(0, 2);
                return (
                  <div className="space-y-4">
                    <div className="border rounded-lg opacity-75">
                      <div className="p-3 bg-gray-50 border-b">
                        <h4 className="font-semibold text-teal-700">Extracted Arguments (Preview)</h4>
                      </div>
                      <div className="p-3 space-y-3 max-h-[200px] overflow-hidden">
                        {previewArgs.map((arg, idx) => (
                          <div key={idx} className="p-3 bg-white border rounded-lg">
                            <p className="font-medium text-gray-900 truncate">→ {arg.conclusion.substring(0, 80)}...</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl p-6 shadow-lg">
                      <div className="flex flex-col items-center text-center space-y-4">
                        <div className="bg-amber-100 p-3 rounded-full">
                          <Lock className="w-8 h-8 text-amber-600" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-gray-900">Full Arguments Paywalled</h3>
                          <p className="text-sm text-gray-600 mt-1">
                            {extractedArguments.length} arguments with {totalWords.toLocaleString()} total words. Purchase credits to unlock.
                          </p>
                        </div>
                        <Button
                          onClick={handleBuyCredits}
                          className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold px-8 py-3 text-lg shadow-md"
                          data-testid="button-arguments-paywall-buy-credits"
                        >
                          <CreditCard className="w-5 h-5 mr-2" />
                          Buy Credits to Unlock
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }
              
              return (
                <div className="border rounded-lg">
                  <div className="flex items-center justify-between p-3 bg-gray-50 border-b">
                    <h4 className="font-semibold text-teal-700">
                      Extracted Arguments ({extractedArguments.length})
                    </h4>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={copyArgumentsToClipboard}
                        data-testid="button-copy-arguments"
                      >
                        <Copy className="w-4 h-4 mr-1" />
                        Copy
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid="button-download-arguments"
                          >
                            <Download className="w-4 h-4 mr-1" />
                            Download
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => downloadArguments('md')}>
                            Download as .md (Markdown)
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => downloadArguments('txt')}>
                            Download as .txt (Plain Text)
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <ScrollArea className="h-[300px]">
                    <div className="p-3 space-y-4">
                      {extractedArguments.map((arg, idx) => (
                        <div key={`arg-${idx}`} className="p-4 bg-white border rounded-lg hover:shadow-sm transition-shadow">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="px-2 py-0.5 bg-teal-100 text-teal-800 rounded text-xs font-medium">
                              {arg.source}
                            </span>
                            {arg.argumentType && (
                              <span className="px-2 py-0.5 bg-cyan-100 text-cyan-800 rounded text-xs font-medium">
                                {arg.argumentType}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              Importance: {arg.importance || 5}/10
                            </span>
                          </div>
                          
                          <div className="space-y-2">
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase">Premises:</p>
                              <ul className="list-disc list-inside text-sm text-gray-700 pl-2">
                                {arg.premises.map((premise, pIdx) => (
                                  <li key={pIdx}>{premise}</li>
                                ))}
                              </ul>
                            </div>
                            
                            <div className="flex items-start gap-2 p-2 bg-teal-50 rounded border-l-4 border-teal-500">
                              <span className="text-teal-600 font-bold">→</span>
                              <p className="text-sm font-medium text-teal-800">{arg.conclusion}</p>
                            </div>
                            
                            {arg.counterarguments && arg.counterarguments.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase">Counterarguments addressed:</p>
                                <ul className="list-disc list-inside text-sm text-gray-600 pl-2 italic">
                                  {arg.counterarguments.map((counter, cIdx) => (
                                    <li key={cIdx}>{counter}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              );
            })()}

            {!isExtractingArguments && extractedArguments.length === 0 && !argumentsFinderProgress && (
              <div className="text-center py-8 text-muted-foreground">
                <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Enter author name and click "Extract Arguments" to begin.</p>
              </div>
            )}
          </div>
          
          <div className="flex justify-between items-center pt-4 border-t mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setExtractedArguments([]);
                setArgumentsFinderProgress(null);
                setArgumentsMarkdown("");
              }}
              data-testid="button-clear-arguments"
            >
              Clear Results
            </Button>
            <Button
              onClick={handleExtractArguments}
              disabled={isExtractingArguments || !text.trim() || !argumentsFinderAuthor.trim()}
              className="bg-gradient-to-r from-teal-600 to-cyan-600 text-white"
              data-testid="button-extract-arguments"
            >
              {isExtractingArguments ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Extracting...
                </>
              ) : (
                <>
                  <Layers className="w-4 h-4 mr-2" />
                  Extract Arguments
                </>
              )}
            </Button>
          </div>
        </ResizableDialogContent>
      </ResizableDialog>

      {/* Tractatus Rewrite Dialog */}
      <ResizableDialog open={showTractatusRewrite} onOpenChange={(open) => {
        setShowTractatusRewrite(open);
        if (!open) {
          setTractatusProgress(null);
        }
      }}>
        <ResizableDialogContent defaultWidth={900} defaultHeight={700} minWidth={500} minHeight={400}>
          <ResizableDialogHeader>
            <ResizableDialogTitle className="flex items-center gap-2 text-xl">
              <List className="w-6 h-6 text-amber-600" />
              Tractatus Rewrite
              <span className="text-sm font-normal text-muted-foreground ml-2">
                (Bullet-Point Statements)
              </span>
            </ResizableDialogTitle>
          </ResizableDialogHeader>
          
          <div className="flex-1 overflow-auto space-y-4 p-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm text-amber-800">
                <strong>How it works:</strong> Converts the entire text into a series of one-line bullet-point statements,
                similar to Wittgenstein's Tractatus style. Each statement captures a single clear idea.
              </p>
              <p className="text-sm text-amber-600 mt-2">
                <strong>Current text:</strong> {text.split(/\s+/).filter(Boolean).length.toLocaleString()} words
              </p>
            </div>

            <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-200">
              <div className="flex items-center gap-2">
                <Label htmlFor="tractatus-outline-mode" className="text-sm font-medium text-amber-800">Use Outline Mode (for large texts)</Label>
                <span className="text-xs text-amber-600">(Recommended for texts over 2000 words)</span>
              </div>
              <input
                type="checkbox"
                id="tractatus-outline-mode"
                checked={useTractatusOutlineMode}
                onChange={(e) => setUseTractatusOutlineMode(e.target.checked)}
                className="h-4 w-4 accent-amber-600"
                data-testid="checkbox-tractatus-outline-mode"
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-200">
              <div className="flex items-center gap-2">
                <Label htmlFor="include-bullet-markers" className="text-sm font-medium text-amber-800">Include Bullet Markers</Label>
                <span className="text-xs text-amber-600">(Add • before each statement)</span>
              </div>
              <input
                type="checkbox"
                id="include-bullet-markers"
                checked={includeBulletMarkers}
                onChange={(e) => setIncludeBulletMarkers(e.target.checked)}
                className="h-4 w-4 accent-amber-600"
                data-testid="checkbox-include-bullets"
              />
            </div>

            {tractatusProgress && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  {tractatusProgress.stage !== "complete" && tractatusProgress.stage !== "error" && (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-amber-600" />
                  )}
                  {tractatusProgress.stage === "complete" && (
                    <div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center">
                      <span className="text-white text-xs">✓</span>
                    </div>
                  )}
                  {tractatusProgress.stage === "error" && (
                    <div className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center">
                      <span className="text-white text-xs">✕</span>
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-amber-800">{tractatusProgress.message}</p>
                    {tractatusProgress.current && tractatusProgress.total && (
                      <div className="mt-2">
                        <div className="h-2 bg-amber-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-amber-600 transition-all duration-300"
                            style={{ width: `${(tractatusProgress.current / tractatusProgress.total) * 100}%` }}
                          />
                        </div>
                        <p className="text-xs text-amber-600 mt-1">
                          Section {tractatusProgress.current} of {tractatusProgress.total}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {tractatusOutput && (
              <div className="border rounded-lg">
                <div className="flex items-center justify-between p-3 bg-gray-50 border-b">
                  <h4 className="font-semibold text-amber-700">
                    Tractatus Output ({tractatusOutput.split('\n').filter(l => l.trim()).length} statements)
                  </h4>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyTractatusOutput}
                      data-testid="button-copy-tractatus"
                    >
                      <Copy className="w-4 h-4 mr-1" />
                      COPY NOW
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadTractatusOutput('txt')}
                      data-testid="button-download-tractatus"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      DOWNLOAD
                    </Button>
                  </div>
                </div>
                <ScrollArea className="h-[300px] p-4">
                  {hasCredits ? (
                    <pre className="text-sm whitespace-pre-wrap font-mono">{tractatusOutput}</pre>
                  ) : (
                    <PaywallOverlay content={tractatusOutput} onBuyCredits={handleBuyCredits} />
                  )}
                </ScrollArea>

                {/* Refinement Section */}
                <div className="p-3 bg-amber-50 border-t border-amber-200">
                  <Label className="text-sm font-medium text-amber-800">Refine this output</Label>
                  <Textarea
                    value={tractatusRefineInstructions}
                    onChange={(e) => setTractatusRefineInstructions(e.target.value)}
                    placeholder="E.g., Add more statements about X, make statements more concise, group by theme..."
                    className="mt-2 min-h-[60px] text-sm border-amber-200"
                    data-testid="textarea-tractatus-refine"
                  />
                  <Button
                    onClick={() => handleRefineOutput(
                      tractatusOutput,
                      tractatusRefineInstructions,
                      setTractatusOutput,
                      setTractatusProgress,
                      setIsRewritingTractatus,
                      "tractatus"
                    )}
                    disabled={isRewritingTractatus || !tractatusRefineInstructions.trim()}
                    className="mt-2 bg-amber-600 hover:bg-amber-700"
                    size="sm"
                    data-testid="button-refine-tractatus"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Refine Output
                  </Button>
                </div>
              </div>
            )}

            {!isRewritingTractatus && !tractatusOutput && !tractatusProgress && (
              <div className="text-center py-8 text-muted-foreground">
                <List className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Click "Rewrite as Tractatus" to convert your text into bullet-point statements.</p>
              </div>
            )}
          </div>
          
          <div className="flex justify-between items-center pt-4 border-t mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setTractatusOutput("");
                setTractatusProgress(null);
              }}
              data-testid="button-clear-tractatus"
            >
              Clear Results
            </Button>
            <Button
              onClick={handleTractatusRewrite}
              disabled={isRewritingTractatus || !text.trim()}
              className="bg-gradient-to-r from-amber-600 to-orange-600 text-white"
              data-testid="button-rewrite-tractatus"
            >
              {isRewritingTractatus ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Rewriting...
                </>
              ) : (
                <>
                  <List className="w-4 h-4 mr-2" />
                  Rewrite as Tractatus
                </>
              )}
            </Button>
          </div>
        </ResizableDialogContent>
      </ResizableDialog>

      {/* Tractatus Tree Dialog */}
      <ResizableDialog open={showTractatusTree} onOpenChange={(open) => {
        setShowTractatusTree(open);
        if (!open) {
          setTractatusTreeProgress(null);
        }
      }}>
        <ResizableDialogContent defaultWidth={1200} defaultHeight={800} minWidth={700} minHeight={500}>
          <ResizableDialogHeader>
            <ResizableDialogTitle className="flex items-center gap-2 text-xl">
              <GitBranch className="w-6 h-6 text-yellow-600" />
              Tractatus Tree
              <span className="text-sm font-normal text-muted-foreground ml-2">
                (Multi-Level Abstraction View)
              </span>
            </ResizableDialogTitle>
          </ResizableDialogHeader>
          
          <div className="flex-1 overflow-auto space-y-4 p-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">
                <strong>How it works:</strong> Generates a hierarchical Tractatus-style rewrite with numbered propositions (1.0, 1.1, 1.1.1, etc.), 
                then displays it across multiple columns. The leftmost column shows only top-level theses (1.0, 2.0, etc.). 
                Each column to the right adds more detail, progressively showing deeper levels until the rightmost column contains all statements at full depth.
              </p>
              <p className="text-sm text-yellow-600 mt-2">
                <strong>Current text:</strong> {text.split(/\s+/).filter(Boolean).length.toLocaleString()} words
              </p>
            </div>

            {tractatusTreeProgress && (
              <div className="bg-muted rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm font-medium">{tractatusTreeProgress.message}</span>
                </div>
                {tractatusTreeProgress.total > 0 && (
                  <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-yellow-500 h-2 rounded-full transition-all" 
                      style={{ width: `${(tractatusTreeProgress.current / tractatusTreeProgress.total) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {tractatusTreeColumns.length > 0 && (
              <div className="space-y-4">
                <div className="flex gap-2 items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    {tractatusTreeColumns.length} abstraction levels | Max depth: {tractatusTreeMaxDepth}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={downloadTractatusTree} data-testid="button-download-tractatus-txt">
                      <Download className="w-4 h-4 mr-1" />
                      Text
                    </Button>
                    <Button size="sm" variant="default" onClick={downloadTractatusTreeWord} className="bg-blue-600 hover:bg-blue-700" data-testid="button-download-tractatus-word">
                      <FileText className="w-4 h-4 mr-1" />
                      Word
                    </Button>
                  </div>
                </div>

                {(() => {
                  const totalWords = tractatusTreeColumns.flat().reduce((sum, stmt) => sum + stmt.text.split(/\s+/).filter(Boolean).length, 0);
                  const shouldPaywall = !hasCredits && totalWords > PAYWALL_WORD_LIMIT;
                  
                  if (shouldPaywall) {
                    // Column 0 = Level 1 (most abstract), show as preview
                    const level1Column = tractatusTreeColumns[0] || [];
                    const previewStmts = level1Column.slice(0, 5);
                    
                    return (
                      <div className="space-y-4">
                        <div className="border rounded-lg overflow-hidden opacity-75">
                          <div className="bg-gradient-to-r from-yellow-100 to-amber-100 px-3 py-2 border-b">
                            <span className="font-medium text-sm text-yellow-800">Level 1 (Preview)</span>
                          </div>
                          <div className="max-h-[200px] overflow-y-auto p-3 space-y-2 text-sm font-mono bg-white">
                            {previewStmts.map((stmt, stmtIdx) => (
                              <div key={stmtIdx} className="border-l-2 border-yellow-300 pl-2 py-1">
                                <span className="text-yellow-700 font-semibold">{stmt.number}</span>
                                <span className="ml-2 text-gray-700">{stmt.text}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl p-6 shadow-lg">
                          <div className="flex flex-col items-center text-center space-y-4">
                            <div className="bg-amber-100 p-3 rounded-full">
                              <Lock className="w-8 h-8 text-amber-600" />
                            </div>
                            <div>
                              <h3 className="text-lg font-bold text-gray-900">Full Tractatus Tree Paywalled</h3>
                              <p className="text-sm text-gray-600 mt-1">
                                {tractatusTreeColumns.length} abstraction levels with {totalWords.toLocaleString()} total words. Purchase credits to unlock.
                              </p>
                            </div>
                            <Button
                              onClick={handleBuyCredits}
                              className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold px-8 py-3 text-lg shadow-md"
                              data-testid="button-tractatus-tree-paywall-buy-credits"
                            >
                              <CreditCard className="w-5 h-5 mr-2" />
                              Buy Credits to Unlock
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  
                  return (
                    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(tractatusTreeColumns.length, 4)}, 1fr)` }}>
                      {tractatusTreeColumns.map((column, idx) => {
                        // Level 1, Level 2, Level 3, etc.
                        const levelName = `Level ${idx + 1}`;
                        return (
                          <div key={idx} className="border rounded-lg overflow-hidden">
                            <div className="bg-gradient-to-r from-yellow-100 to-amber-100 px-3 py-2 border-b flex items-center justify-between">
                              <span className="font-medium text-sm text-yellow-800">{levelName}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-yellow-600">{column.length} statements</span>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => copyTractatusTreeColumn(idx)}>
                                  <Copy className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                            <div className="max-h-[400px] overflow-y-auto p-3 space-y-2 text-sm font-mono bg-white">
                              {column.map((stmt, stmtIdx) => (
                                <div key={stmtIdx} className="border-l-2 border-yellow-300 pl-2 py-1">
                                  <span className="text-yellow-700 font-semibold">{stmt.number}</span>
                                  <span className="ml-2 text-gray-700">{stmt.text}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="tractatus-title" className="text-sm font-medium">Document Title</Label>
              <Input
                id="tractatus-title"
                value={tractatusTreeTitle}
                onChange={(e) => setTractatusTreeTitle(e.target.value)}
                placeholder="Enter title for the document..."
                className="w-full"
                data-testid="input-tractatus-title"
              />
            </div>

            <Button
              onClick={handleGenerateTractatusTree}
              disabled={isGeneratingTree || !text || text.split(/\s+/).filter(Boolean).length < 100}
              className="w-full bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-700 hover:to-amber-700"
              data-testid="button-generate-tractatus-tree"
            >
              {isGeneratingTree ? (
                <>
                  <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Generating Tree...
                </>
              ) : (
                <>
                  <GitBranch className="w-4 h-4 mr-2" />
                  Generate Tractatus Tree
                </>
              )}
            </Button>
          </div>
        </ResizableDialogContent>
      </ResizableDialog>

      {/* Summary Dialog */}
      <ResizableDialog open={showSummary} onOpenChange={(open) => {
        setShowSummary(open);
        if (!open) {
          setSummaryProgress(null);
        }
      }}>
        <ResizableDialogContent defaultWidth={900} defaultHeight={700} minWidth={600} minHeight={500}>
          <ResizableDialogHeader>
            <ResizableDialogTitle className="flex items-center gap-2 text-xl">
              <FileText className="w-6 h-6 text-teal-600" />
              Structured Summary
              <span className="text-sm font-normal text-muted-foreground ml-2">
                (Adjustable Resolution)
              </span>
            </ResizableDialogTitle>
          </ResizableDialogHeader>
          
          <div className="flex-1 overflow-auto space-y-4 p-4">
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
              <p className="text-sm text-teal-800">
                <strong>How it works:</strong> Generate structured summaries at different levels of detail. 
                At the lowest resolution, get a 1-2 paragraph overview of the entire work. 
                At the highest resolution, get individual summaries for each subsection.
              </p>
              <p className="text-sm text-teal-600 mt-2">
                <strong>Current text:</strong> {text.split(/\s+/).filter(Boolean).length.toLocaleString()} words
              </p>
            </div>

            {/* Resolution Slider */}
            <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Resolution Level</label>
                <span className="text-sm text-muted-foreground">{getResolutionLabel(summaryResolution)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="4"
                value={summaryResolution}
                onChange={(e) => setSummaryResolution(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                disabled={isGeneratingSummary}
                data-testid="slider-summary-resolution"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Lowest (Whole Work)</span>
                <span>Highest (Subsections)</span>
              </div>
            </div>

            {/* Content Recognition Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div className="space-y-1">
                <label className="text-sm font-medium">Recognize Content-Based Sections</label>
                <p className="text-xs text-muted-foreground">
                  When ON, identifies informal thematic divisions even without formal headings.
                  When OFF, only recognizes explicitly marked sections (Part, Chapter, Section, etc.).
                </p>
              </div>
              <button
                onClick={() => setSummaryRecognizeContent(!summaryRecognizeContent)}
                disabled={isGeneratingSummary}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  summaryRecognizeContent ? 'bg-teal-600' : 'bg-gray-300'
                }`}
                data-testid="toggle-summary-content-recognition"
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    summaryRecognizeContent ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {summaryProgress && (
              <div className="bg-muted rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm font-medium">{summaryProgress.message}</span>
                </div>
                {summaryProgress.total > 0 && (
                  <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-teal-500 h-2 rounded-full transition-all" 
                      style={{ width: `${(summaryProgress.current / summaryProgress.total) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {summaryResult && summaryResult.sections.length > 0 && (
              <div className="space-y-4">
                <div className="flex gap-2 items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    {summaryResult.totalSections} section(s) | Recognition: {summaryResult.recognitionMode}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const content = summaryResult.sections.map(s => 
                          `## ${s.title}\n\n${s.summary}`
                        ).join('\n\n---\n\n');
                        navigator.clipboard.writeText(content);
                        toast({ title: "Copied", description: "Summary copied to clipboard" });
                      }}
                      data-testid="button-summary-copy"
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const content = summaryResult.sections.map(s => 
                          `## ${s.title}\n\n${s.summary}`
                        ).join('\n\n---\n\n');
                        const blob = new Blob([content], { type: 'text/markdown' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'structured-summary.md';
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      data-testid="button-summary-download"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download
                    </Button>
                  </div>
                </div>

                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {(() => {
                    const allContent = summaryResult.sections.map(s => `${s.title}\n${s.summary}`).join('\n\n');
                    const totalWords = allContent.split(/\s+/).filter(Boolean).length;
                    const shouldPaywall = !hasCredits && totalWords > PAYWALL_WORD_LIMIT;
                    
                    if (shouldPaywall) {
                      let wordsSoFar = 0;
                      let cutoffIdx = 0;
                      for (let i = 0; i < summaryResult.sections.length; i++) {
                        const sectionWords = summaryResult.sections[i].summary.split(/\s+/).filter(Boolean).length;
                        if (wordsSoFar + sectionWords > PAYWALL_WORD_LIMIT) {
                          cutoffIdx = i;
                          break;
                        }
                        wordsSoFar += sectionWords;
                        cutoffIdx = i + 1;
                      }
                      
                      return (
                        <>
                          {summaryResult.sections.slice(0, Math.max(cutoffIdx, 1)).map((section, idx) => (
                            <div key={idx} className="bg-white border rounded-lg p-4" data-testid={`card-summary-section-${idx}`}>
                              <h4 className="font-semibold text-teal-800 mb-2 flex items-center gap-2">
                                <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-bold text-white bg-teal-600 rounded-full">
                                  {idx + 1}
                                </span>
                                {section.title}
                              </h4>
                              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                                {section.summary}
                              </p>
                            </div>
                          ))}
                          <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl p-6 shadow-lg">
                            <div className="flex flex-col items-center text-center space-y-4">
                              <div className="bg-amber-100 p-3 rounded-full">
                                <Lock className="w-8 h-8 text-amber-600" />
                              </div>
                              <div>
                                <h3 className="text-lg font-bold text-gray-900">Full Summary Paywalled</h3>
                                <p className="text-sm text-gray-600 mt-1">
                                  You're viewing {cutoffIdx} of {summaryResult.sections.length} sections ({totalWords.toLocaleString()} total words). 
                                  Purchase credits to unlock the complete summary.
                                </p>
                              </div>
                              <Button
                                onClick={handleBuyCredits}
                                className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold px-8 py-3 text-lg shadow-md"
                                data-testid="button-summary-paywall-buy-credits"
                              >
                                <CreditCard className="w-5 h-5 mr-2" />
                                Buy Credits to Unlock
                              </Button>
                            </div>
                          </div>
                        </>
                      );
                    }
                    
                    return summaryResult.sections.map((section, idx) => (
                      <div key={idx} className="bg-white border rounded-lg p-4" data-testid={`card-summary-section-${idx}`}>
                        <h4 className="font-semibold text-teal-800 mb-2 flex items-center gap-2">
                          <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-bold text-white bg-teal-600 rounded-full">
                            {idx + 1}
                          </span>
                          {section.title}
                        </h4>
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                          {section.summary}
                        </p>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}

            <Button
              onClick={handleGenerateSummary}
              disabled={isGeneratingSummary || !text || text.split(/\s+/).filter(Boolean).length < 50}
              className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700"
              data-testid="button-generate-summary"
            >
              {isGeneratingSummary ? (
                <>
                  <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Generating Summary...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 mr-2" />
                  Generate Structured Summary
                </>
              )}
            </Button>
          </div>
        </ResizableDialogContent>
      </ResizableDialog>

      {/* Custom Analyzer Dialog */}
      <ResizableDialog open={showCustomAnalyzer} onOpenChange={(open) => {
        setShowCustomAnalyzer(open);
        if (!open) {
          setCustomAnalyzerProgress(null);
          setCustomAnalyzerOutput("");
        }
      }}>
        <ResizableDialogContent defaultWidth={900} defaultHeight={700} minWidth={500} minHeight={400}>
          <ResizableDialogHeader>
            <ResizableDialogTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="w-6 h-6 text-rose-600" />
              Custom Analysis
              <span className="text-sm font-normal text-muted-foreground ml-2">
                (Holistic Analysis)
              </span>
            </ResizableDialogTitle>
          </ResizableDialogHeader>
          
          <div className="flex-1 overflow-auto space-y-4 p-4">
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
              <p className="text-sm text-rose-800">
                <strong>How it works:</strong> With Outline Mode ON, this tool first generates a structured outline, 
                then processes each section with your custom instructions while maintaining full document context.
                Perfect for: answering questions about the text, rewriting in different styles, comparative analysis, or any custom task.
              </p>
              <p className="text-sm text-rose-600 mt-2">
                <strong>Current text:</strong> {text.split(/\s+/).filter(Boolean).length.toLocaleString()} words
              </p>
            </div>

            {/* File Upload Drop Zone */}
            <div 
              className="relative border-2 border-dashed border-rose-300 rounded-lg p-6 text-center hover:border-rose-500 transition-colors cursor-pointer bg-rose-50/50"
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-rose-500', 'bg-rose-100'); }}
              onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-rose-500', 'bg-rose-100'); }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('border-rose-500', 'bg-rose-100');
                const file = e.dataTransfer.files[0];
                if (file) handleFileUpload(file);
              }}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.txt,.pdf,.doc,.docx,.md,.rtf';
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) handleFileUpload(file);
                };
                input.click();
              }}
              data-testid="custom-analysis-dropzone"
            >
              <Upload className="w-8 h-8 mx-auto text-rose-400 mb-2" />
              <p className="text-sm font-medium text-rose-700">Drop a file here or click to upload</p>
              <p className="text-xs text-rose-500 mt-1">Supports PDF, Word, and text files</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-instructions" className="text-sm font-medium text-rose-800">Your Instructions *</Label>
              <Textarea
                id="custom-instructions"
                placeholder="Enter your custom instructions, e.g.:
• Answer these questions based on the text: ...
• Rewrite the text in the style of Aristotle
• How would the author's views differ if he had known algebra?
• Extract all metaphors and explain their significance
• Summarize each section's main argument in one sentence"
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                className="border-rose-200 focus:border-rose-400 min-h-[120px] font-mono text-sm"
                data-testid="textarea-custom-instructions"
              />
              <p className="text-xs text-muted-foreground">Your instructions will be applied to each section with full document context.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-word-count" className="text-sm font-medium text-rose-800">Desired Output Word Count (optional)</Label>
              <div className="flex items-center gap-3">
                <input
                  id="custom-word-count"
                  type="number"
                  min="100"
                  max="100000"
                  placeholder="e.g., 2000"
                  value={customOutputWordCount}
                  onChange={(e) => setCustomOutputWordCount(e.target.value)}
                  className="w-40 px-3 py-2 border border-rose-200 rounded-md focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-400"
                  data-testid="input-custom-word-count"
                />
                <span className="text-sm text-muted-foreground">words</span>
                {customOutputWordCount && (
                  <span className="text-xs text-rose-600">
                    (The LLM will aim for approximately {parseInt(customOutputWordCount).toLocaleString()} words)
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Leave empty to let the LLM decide the appropriate length based on your instructions.</p>
            </div>

            <div className="flex items-center justify-between p-3 bg-rose-50 rounded-lg border border-rose-200">
              <div className="flex items-center gap-2">
                <Label htmlFor="custom-outline-mode" className="text-sm font-medium text-rose-800">Use Outline Mode (recommended)</Label>
                <span className="text-xs text-rose-600">(Full text comprehension, section-by-section processing)</span>
              </div>
              <input
                type="checkbox"
                id="custom-outline-mode"
                checked={useCustomOutlineMode}
                onChange={(e) => setUseCustomOutlineMode(e.target.checked)}
                className="h-4 w-4 accent-rose-600"
                data-testid="checkbox-custom-outline-mode"
              />
            </div>

            {customAnalyzerProgress && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  {customAnalyzerProgress.stage !== "complete" && customAnalyzerProgress.stage !== "error" && (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-rose-600" />
                  )}
                  {customAnalyzerProgress.stage === "complete" && (
                    <div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center">
                      <span className="text-white text-xs">✓</span>
                    </div>
                  )}
                  {customAnalyzerProgress.stage === "error" && (
                    <div className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center">
                      <span className="text-white text-xs">✕</span>
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-rose-800">{customAnalyzerProgress.message}</p>
                    {customAnalyzerProgress.current && customAnalyzerProgress.total && (
                      <div className="mt-2">
                        <div className="h-2 bg-rose-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-rose-600 transition-all duration-300"
                            style={{ width: `${(customAnalyzerProgress.current / customAnalyzerProgress.total) * 100}%` }}
                          />
                        </div>
                        <p className="text-xs text-rose-600 mt-1">
                          Section {customAnalyzerProgress.current} of {customAnalyzerProgress.total}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {customAnalyzerOutput && (
              <div className="border rounded-lg">
                <div className="flex items-center justify-between p-3 bg-gray-50 border-b">
                  <h4 className="font-semibold text-rose-700">
                    Analysis Output
                  </h4>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={copyCustomOutput}
                      data-testid="button-copy-custom"
                    >
                      <Copy className="w-4 h-4 mr-1" />
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={downloadCustomOutput}
                      data-testid="button-download-custom"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      Download
                    </Button>
                  </div>
                </div>
                <ScrollArea className="h-[300px]">
                  <div className="p-4 prose prose-sm max-w-none">
                    {hasCredits ? (
                      <pre className="whitespace-pre-wrap font-sans text-sm">{customAnalyzerOutput}</pre>
                    ) : (
                      <PaywallOverlay content={customAnalyzerOutput} onBuyCredits={handleBuyCredits} />
                    )}
                  </div>
                </ScrollArea>

                {/* Refinement Section */}
                <div className="p-3 bg-rose-50 border-t border-rose-200">
                  <Label className="text-sm font-medium text-rose-800">Refine this output</Label>
                  <Textarea
                    value={customRefineInstructions}
                    onChange={(e) => setCustomRefineInstructions(e.target.value)}
                    placeholder="E.g., Add more detail on X, include more quotes, focus on the counterarguments..."
                    className="mt-2 min-h-[60px] text-sm border-rose-200"
                    data-testid="textarea-custom-refine"
                  />
                  <Button
                    onClick={() => handleRefineOutput(
                      customAnalyzerOutput,
                      customRefineInstructions,
                      setCustomAnalyzerOutput,
                      setCustomAnalyzerProgress,
                      setIsRunningCustomAnalysis,
                      "custom_analysis"
                    )}
                    disabled={isRunningCustomAnalysis || !customRefineInstructions.trim()}
                    className="mt-2 bg-rose-600 hover:bg-rose-700"
                    size="sm"
                    data-testid="button-refine-custom"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Refine Output
                  </Button>
                </div>
              </div>
            )}

            {!isRunningCustomAnalysis && !customAnalyzerOutput && !customAnalyzerProgress && (
              <div className="text-center py-8 text-muted-foreground">
                <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Enter your instructions and click "Run Analysis" to begin.</p>
              </div>
            )}
          </div>
          
          <div className="flex justify-between items-center pt-4 border-t mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setCustomAnalyzerOutput("");
                setCustomAnalyzerProgress(null);
              }}
              data-testid="button-clear-custom"
            >
              Clear Results
            </Button>
            <Button
              onClick={handleRunCustomAnalysis}
              disabled={isRunningCustomAnalysis || !text.trim() || !customInstructions.trim()}
              className="bg-gradient-to-r from-rose-600 to-orange-500 text-white"
              data-testid="button-run-custom-analysis"
            >
              {isRunningCustomAnalysis ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Running...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Run Analysis
                </>
              )}
            </Button>
          </div>
        </ResizableDialogContent>
      </ResizableDialog>

      {/* Quote Extractor Dialog */}
      <ResizableDialog open={showQuoteExtractor} onOpenChange={setShowQuoteExtractor}>
        <ResizableDialogContent defaultWidth={900} defaultHeight={700} minWidth={500} minHeight={400}>
          <ResizableDialogHeader>
            <ResizableDialogTitle className="flex items-center gap-2 text-xl">
              <Quote className="w-6 h-6 text-primary" />
              Quote Extractor
              <span className="text-sm font-normal text-muted-foreground ml-2">
                (Holistic Analysis)
              </span>
            </ResizableDialogTitle>
          </ResizableDialogHeader>
          
          <div className="flex-1 overflow-auto space-y-4 p-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <strong>How it works:</strong> With Outline Mode ON, this tool first generates a structured outline of the full text, 
                then slices by section and extracts direct quotes with global context. This prevents blind chunking, avoids repetitions, 
                and ensures holistic comprehension.
              </p>
              <p className="text-sm text-blue-600 mt-2">
                <strong>Current text:</strong> {text.split(/\s+/).filter(Boolean).length.toLocaleString()} words
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quote-author" className="text-sm font-medium text-blue-800">Author Name *</Label>
              <Input
                id="quote-author"
                placeholder="Enter the author's name (e.g., Immanuel Kant)"
                value={quoteExtractorAuthor}
                onChange={(e) => setQuoteExtractorAuthor(e.target.value)}
                className="border-blue-200 focus:border-blue-400"
                data-testid="input-quote-author"
              />
              <p className="text-xs text-muted-foreground">Required: Identify who wrote this text so quotes are properly attributed.</p>
            </div>

            <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2">
                <Label htmlFor="quote-outline-mode" className="text-sm font-medium text-blue-800">Use Outline Mode (for large texts)</Label>
                <span className="text-xs text-blue-600">(Full text comprehension, no blind chunking)</span>
              </div>
              <input
                type="checkbox"
                id="quote-outline-mode"
                checked={useQuoteOutlineMode}
                onChange={(e) => setUseQuoteOutlineMode(e.target.checked)}
                className="h-4 w-4 accent-blue-600"
                data-testid="checkbox-quote-outline-mode"
              />
            </div>

            {quoteExtractorProgress && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  {quoteExtractorProgress.stage !== "complete" && quoteExtractorProgress.stage !== "error" && (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
                  )}
                  {quoteExtractorProgress.stage === "complete" && (
                    <div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center">
                      <span className="text-white text-xs">✓</span>
                    </div>
                  )}
                  {quoteExtractorProgress.stage === "error" && (
                    <div className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center">
                      <span className="text-white text-xs">✕</span>
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-blue-800">{quoteExtractorProgress.message}</p>
                    {quoteExtractorProgress.current && quoteExtractorProgress.total && (
                      <div className="mt-2">
                        <div className="h-2 bg-blue-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-blue-600 transition-all duration-300"
                            style={{ width: `${(quoteExtractorProgress.current / quoteExtractorProgress.total) * 100}%` }}
                          />
                        </div>
                        <p className="text-xs text-blue-600 mt-1">
                          Section {quoteExtractorProgress.current} of {quoteExtractorProgress.total}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {quoteExtractionSummary && (
              <div className="bg-gray-50 border rounded-lg p-4">
                <h4 className="font-semibold text-sm text-gray-700 mb-2">Document Summary</h4>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">{quoteExtractionSummary}</p>
              </div>
            )}

            {extractedQuotes.length > 0 && (() => {
              const totalWords = extractedQuotes.reduce((sum, q) => sum + q.quote.split(/\s+/).filter(Boolean).length, 0);
              const shouldPaywall = !hasCredits && totalWords > PAYWALL_WORD_LIMIT;
              
              if (shouldPaywall) {
                const previewQuotes = extractedQuotes.slice(0, 3);
                return (
                  <div className="space-y-4">
                    <div className="border rounded-lg opacity-75">
                      <div className="p-3 bg-gray-50 border-b">
                        <h4 className="font-semibold text-primary">Extracted Quotes (Preview)</h4>
                      </div>
                      <div className="p-3 space-y-3 max-h-[200px] overflow-hidden">
                        {previewQuotes.map((q, idx) => (
                          <div key={idx} className="p-3 bg-white border rounded-lg">
                            <p className="font-medium text-gray-900 truncate">{q.quote.substring(0, 100)}...</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl p-6 shadow-lg">
                      <div className="flex flex-col items-center text-center space-y-4">
                        <div className="bg-amber-100 p-3 rounded-full">
                          <Lock className="w-8 h-8 text-amber-600" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-gray-900">Full Quotes Paywalled</h3>
                          <p className="text-sm text-gray-600 mt-1">
                            {extractedQuotes.length} quotes with {totalWords.toLocaleString()} total words. Purchase credits to unlock.
                          </p>
                        </div>
                        <Button
                          onClick={handleBuyCredits}
                          className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold px-8 py-3 text-lg shadow-md"
                          data-testid="button-extracted-quotes-paywall-buy-credits"
                        >
                          <CreditCard className="w-5 h-5 mr-2" />
                          Buy Credits to Unlock
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }
              
              return (
                <div className="border rounded-lg">
                  <div className="flex items-center justify-between p-3 bg-gray-50 border-b">
                    <h4 className="font-semibold text-primary">
                      Extracted Quotes ({extractedQuotes.length})
                    </h4>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={copyQuotesToClipboard}
                        data-testid="button-copy-quotes"
                      >
                        <Copy className="w-4 h-4 mr-1" />
                        Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={downloadQuotes}
                        data-testid="button-download-quotes"
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Download
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="h-[300px]">
                    <div className="p-3 space-y-3">
                      {extractedQuotes.map((q, idx) => (
                        <div key={`quote-${idx}`} className="p-3 bg-white border rounded-lg hover:shadow-sm transition-shadow">
                          <div className="space-y-1">
                            <p className="font-medium text-gray-900">{q.quote}</p>
                            <div className="flex gap-4 text-xs text-muted-foreground">
                              <span><strong>Author:</strong> {q.author}</span>
                              <span><strong>Topic:</strong> {q.topic}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              );
            })()}

            {!isExtractingQuotes && extractedQuotes.length === 0 && !quoteExtractorProgress && (
              <div className="text-center py-8 text-muted-foreground">
                <Quote className="w-12 h-12 mx-auto mb-3 text-primary/30" />
                <p>Click "Extract Quotes" to analyze the loaded text.</p>
              </div>
            )}
          </div>
          
          <div className="flex justify-between items-center pt-4 border-t mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setExtractedQuotes([]);
                setQuoteExtractorProgress(null);
                setQuoteExtractionSummary("");
              }}
              data-testid="button-clear-quotes"
            >
              Clear Results
            </Button>
            <Button
              onClick={handleExtractQuotes}
              disabled={isExtractingQuotes || !text.trim() || !quoteExtractorAuthor.trim()}
              className="bg-gradient-to-r from-primary to-secondary text-white"
              data-testid="button-extract-quotes"
            >
              {isExtractingQuotes ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Extracting...
                </>
              ) : (
                <>
                  <Quote className="w-4 h-4 mr-2" />
                  Extract Quotes
                </>
              )}
            </Button>
          </div>
        </ResizableDialogContent>
      </ResizableDialog>

      {/* Full Document Rewrite Dialog */}
      <ResizableDialog open={showRewriteDialog} onOpenChange={setShowRewriteDialog}>
        <ResizableDialogContent defaultWidth={900} defaultHeight={700} minWidth={500} minHeight={400}>
          <ResizableDialogHeader>
            <ResizableDialogTitle className="flex items-center gap-2 text-xl">
              <FileText className="w-6 h-6 text-blue-600" />
              Full Document Rewrite
              <span className="text-sm font-normal text-muted-foreground ml-2">
                (Outline-Guided)
              </span>
            </ResizableDialogTitle>
          </ResizableDialogHeader>
          
          <div className="flex-1 overflow-auto space-y-4 p-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <strong>How it works:</strong> First generates a structured outline, then rewrites the entire document 
                section-by-section following that outline. This ensures coherence and prevents repetition.
              </p>
              <p className="text-sm text-blue-600 mt-2">
                <strong>Current text:</strong> {text.split(/\s+/).filter(Boolean).length.toLocaleString()} words
              </p>
            </div>

            <div className="space-y-3">
              <Label htmlFor="rewrite-instructions" className="text-sm font-medium">Rewrite Instructions</Label>
              <Textarea
                id="rewrite-instructions"
                value={rewriteInstructions}
                onChange={(e) => setRewriteInstructions(e.target.value)}
                className="min-h-[120px] text-sm"
                placeholder="Enter your rewrite instructions..."
                data-testid="textarea-rewrite-instructions"
              />
              <p className="text-xs text-muted-foreground">
                Customize the rewrite behavior. Include target word count, style preferences, or specific restructuring goals.
              </p>
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
              <div className="flex items-center gap-2">
                <Label htmlFor="show-outline-first" className="text-sm font-medium">Show Outline First</Label>
                <span className="text-xs text-muted-foreground">(Display structure before rewriting)</span>
              </div>
              <input
                type="checkbox"
                id="show-outline-first"
                checked={showRewriteOutlineFirst}
                onChange={(e) => setShowRewriteOutlineFirst(e.target.checked)}
                className="h-4 w-4"
                data-testid="checkbox-show-outline-first"
              />
            </div>

            {rewriteProgress && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <span className="font-medium text-blue-800">{rewriteProgress.message}</span>
                </div>
                <Progress value={(rewriteProgress.current / rewriteProgress.total) * 100} className="h-2" />
                <p className="text-xs text-blue-600 mt-2">
                  Section {rewriteProgress.current} of {rewriteProgress.total}
                </p>
              </div>
            )}

            {rewrittenDocument && (() => {
              const wordCount = rewrittenDocument.split(/\s+/).filter(Boolean).length;
              const shouldPaywall = !hasCredits && wordCount > PAYWALL_WORD_LIMIT;
              
              return (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Rewritten Document</Label>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyRewrittenDocument}
                      className="h-7 text-xs"
                      data-testid="button-copy-rewritten"
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      Copy
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={downloadRewrittenDocument}
                      className="h-7 text-xs"
                      data-testid="button-download-rewritten"
                    >
                      <Download className="w-3 h-3 mr-1" />
                      Download
                    </Button>
                  </div>
                </div>
                <ScrollArea className="h-[300px] border rounded-lg p-4 bg-white">
                  {shouldPaywall ? (
                    <PaywallOverlay content={rewrittenDocument} onBuyCredits={handleBuyCredits} />
                  ) : (
                    <div className="prose prose-sm max-w-none whitespace-pre-wrap">
                      {rewrittenDocument}
                    </div>
                  )}
                </ScrollArea>
                <p className="text-xs text-muted-foreground">
                  {wordCount.toLocaleString()} words
                </p>

                {/* Refinement Section */}
                {!shouldPaywall && (
                  <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <Label className="text-sm font-medium text-blue-800">Refine this output</Label>
                    <Textarea
                      value={rewriteRefineInstructions}
                      onChange={(e) => setRewriteRefineInstructions(e.target.value)}
                      placeholder="E.g., Add more quotes from the original, expand the section on X, make the conclusion stronger..."
                      className="mt-2 min-h-[60px] text-sm border-blue-200"
                      data-testid="textarea-rewrite-refine"
                    />
                    <Button
                      onClick={() => handleRefineOutput(
                        rewrittenDocument,
                        rewriteRefineInstructions,
                        setRewrittenDocument,
                        setRewriteProgress,
                        setIsRewriting,
                        "full_rewrite"
                      )}
                      disabled={isRewriting || !rewriteRefineInstructions.trim()}
                      className="mt-2 bg-blue-600 hover:bg-blue-700"
                      size="sm"
                      data-testid="button-refine-rewrite"
                    >
                      <RotateCcw className="w-3 h-3 mr-1" />
                      Refine Output
                    </Button>
                  </div>
                )}
              </div>
              );
            })()}

            <div className="flex gap-3 pt-4 border-t">
              <Button
                onClick={handleFullDocumentRewrite}
                disabled={isRewriting || !text.trim()}
                className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600"
                data-testid="button-start-rewrite"
              >
                {isRewriting ? (
                  <>
                    <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Rewriting...
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4 mr-2" />
                    Start Full Rewrite
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowRewriteDialog(false)}
                data-testid="button-close-rewrite-dialog"
              >
                Close
              </Button>
            </div>
          </div>
        </ResizableDialogContent>
      </ResizableDialog>

      {/* Write From Scratch Dialog */}
      <ResizableDialog open={showWriteFromScratchDialog} onOpenChange={setShowWriteFromScratchDialog}>
        <ResizableDialogContent defaultWidth={900} defaultHeight={700} minWidth={500} minHeight={400}>
          <ResizableDialogHeader>
            <ResizableDialogTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="w-6 h-6 text-emerald-600" />
              Write From Scratch
              <span className="text-sm font-normal text-muted-foreground ml-2">
                (AI Document Generation)
              </span>
            </ResizableDialogTitle>
          </ResizableDialogHeader>
          
          <div className="flex-1 overflow-auto space-y-4 p-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
              <p className="text-sm text-emerald-800">
                <strong>How it works:</strong> Enter a prompt describing what you want written. The AI will generate 
                a complete document with coherent sections, maintaining logical consistency throughout.
              </p>
            </div>

            <div className="space-y-3">
              <Label htmlFor="scratch-prompt" className="text-sm font-medium">Writing Prompt</Label>
              <Textarea
                id="scratch-prompt"
                value={writeFromScratchPrompt}
                onChange={(e) => setWriteFromScratchPrompt(e.target.value)}
                className="min-h-[120px] text-sm"
                placeholder="E.g., Write a 20,000 word monograph on the applications of econometrics to the global economy in 2025..."
                data-testid="textarea-scratch-prompt"
              />
            </div>

            <div className="space-y-3">
              <Label htmlFor="target-words" className="text-sm font-medium">Target Word Count</Label>
              <div className="flex items-center gap-4">
                <Input
                  id="target-words"
                  type="number"
                  value={writeFromScratchTargetWords}
                  onChange={(e) => setWriteFromScratchTargetWords(e.target.value)}
                  className="w-32"
                  min="1000"
                  max="50000"
                  step="1000"
                  data-testid="input-target-words"
                />
                <span className="text-sm text-muted-foreground">
                  words (1,000 - 50,000)
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Larger documents take longer to generate. A 20,000 word document may take 5-10 minutes.
              </p>
            </div>

            {writeFromScratchProgress && (
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-lg p-4 border border-emerald-200">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                  <span className="font-medium text-emerald-800">{writeFromScratchProgress.message}</span>
                </div>
                <Progress value={(writeFromScratchProgress.current / writeFromScratchProgress.total) * 100} className="h-2" />
                <p className="text-xs text-emerald-600 mt-2">
                  Section {writeFromScratchProgress.current} of {writeFromScratchProgress.total}
                </p>
              </div>
            )}

            {generatedDocument && (() => {
              const wordCount = generatedDocument.split(/\s+/).filter(Boolean).length;
              const shouldPaywall = !hasCredits && wordCount > PAYWALL_WORD_LIMIT;
              
              return (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Generated Document</Label>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyGeneratedDocument}
                      className="h-7 text-xs"
                      data-testid="button-copy-generated"
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      Copy
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={downloadGeneratedDocument}
                      className="h-7 text-xs"
                      data-testid="button-download-generated"
                    >
                      <Download className="w-3 h-3 mr-1" />
                      Download
                    </Button>
                  </div>
                </div>
                <ScrollArea className="h-[300px] border rounded-lg p-4 bg-white">
                  {shouldPaywall ? (
                    <PaywallOverlay content={generatedDocument} onBuyCredits={handleBuyCredits} />
                  ) : (
                    <div className="prose prose-sm max-w-none whitespace-pre-wrap">
                      {generatedDocument}
                    </div>
                  )}
                </ScrollArea>
                <p className="text-xs text-muted-foreground">
                  {wordCount.toLocaleString()} words generated
                </p>

                {/* Refinement Section */}
                {!shouldPaywall && (
                  <div className="mt-4 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                    <Label className="text-sm font-medium text-emerald-800">Refine this output</Label>
                    <Textarea
                      value={writeNewRefineInstructions}
                      onChange={(e) => setWriteNewRefineInstructions(e.target.value)}
                      placeholder="E.g., Add more examples, expand the section on X, make it more academic..."
                      className="mt-2 min-h-[60px] text-sm border-emerald-200"
                      data-testid="textarea-scratch-refine"
                    />
                    <Button
                      onClick={() => handleRefineOutput(
                        generatedDocument,
                        writeNewRefineInstructions,
                        setGeneratedDocument,
                        setWriteFromScratchProgress,
                        setIsWritingFromScratch,
                        "write_from_scratch"
                      )}
                      disabled={isWritingFromScratch || !writeNewRefineInstructions.trim()}
                      className="mt-2 bg-emerald-600 hover:bg-emerald-700"
                      size="sm"
                      data-testid="button-refine-scratch"
                    >
                      <RotateCcw className="w-3 h-3 mr-1" />
                      Refine Output
                    </Button>
                  </div>
                )}
              </div>
              );
            })()}

            <div className="flex gap-3 pt-4 border-t">
              <Button
                onClick={handleWriteFromScratch}
                disabled={isWritingFromScratch || !writeFromScratchPrompt.trim()}
                className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600"
                data-testid="button-start-scratch"
              >
                {isWritingFromScratch ? (
                  <>
                    <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Generating Document...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Document
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowWriteFromScratchDialog(false)}
                data-testid="button-close-scratch-dialog"
              >
                Close
              </Button>
            </div>
          </div>
        </ResizableDialogContent>
      </ResizableDialog>
    </div>
  );
}

function TabTrigger({ value, icon, label }: { value: string, icon: React.ReactNode, label: string }) {
  return (
    <TabsTrigger 
      value={value}
      className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-primary rounded-none h-full px-0 data-[state=active]:text-primary text-muted-foreground hover:text-foreground transition-all gap-2.5 text-base font-bold uppercase tracking-wide"
    >
      {icon}
      {label}
    </TabsTrigger>
  );
}

function Header({ title, subtitle }: { title: string, subtitle: string }) {
  return (
    <div className="pb-4 border-b mb-6">
      <h3 className="text-lg font-bold tracking-tight">{title}</h3>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
