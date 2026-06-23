// TypeScript mirror of the Soroban escrow contract + marketplace data model

export type TaskType =
  | "question"   // Soru / net yanıt
  | "research"   // Araştırma / derin analiz
  | "code"       // Kod / script
  | "data"       // Veri analizi
  | "web"        // Deploy / canlı URL
  | "custom";    // Özel / serbest

export type OutputFormat =
  | "text"       // Düz metin
  | "code"       // Kod bloğu
  | "json"       // JSON / yapısal veri
  | "url"        // Canlı URL
  | "report";    // Detaylı rapor

export type TaskStatus =
  | "Open"
  | "UnderReview"
  | "AwaitingDecision"
  | "Settled"
  | "Disputed"
  | "Resolved"
  | "Stopped";

export interface Submission {
  agent: string;          // Stellar address (G...) of the agent
  resultHash: string;     // SHA256 of result
  resultUrl: string;      // data: URL or IPFS
  submittedAt: number;    // Unix timestamp (seconds)
  timeTakenSeconds: number;
}

export interface Verdict {
  judgeId: number;        // 1, 2, or 3
  judgeName?: string;     // TechnicalJudge | UsabilityJudge | CompletenessJudge
  agent: string;          // Stellar address of the evaluated agent
  score: number;          // 0-100
  reasoning: string;
}

export interface Dispute {
  disputer: string;       // Stellar address
  stakeAmount: number;    // USDC stroops (1e-7)
  openedAt: number;       // Unix timestamp
  appealVerdicts: Verdict[];
  resolved: boolean;
  disputerWon: boolean;
}

export interface Task {
  id: number;
  poster: string;         // Stellar address (G...) of the poster
  description: string;
  criteria: string;
  reward: number;         // USDC base units (stroops, 1e-7)
  rewardUsdc?: number;    // convenience: human-readable USDC amount
  deadline: number;       // Unix timestamp (seconds)
  status: TaskStatus;
  submissions: Submission[];
  verdicts: Verdict[];
  dispute?: Dispute;
  winner?: string;        // Stellar address of the winning agent
  taskType?: TaskType;
  outputFormat?: OutputFormat;

  // ── Stellar / Soroban on-chain references ──
  contractTaskId?: number;     // task_id inside the Soroban escrow contract
  escrowContractId?: string;   // Soroban contract that holds the reward
  postTxHash?: string;         // tx that locked the USDC reward on-chain
  settleTxHash?: string;       // tx that released the reward to the winner
  winnerStellarAddress?: string;
}

export interface AgentReputation {
  agent: string;          // Stellar address
  tasksCompleted: number;
  tasksAttempted: number;
  totalScore: number;
  disputesWon: number;
  disputesLost: number;
  avgScore?: number;      // computed: totalScore / tasksCompleted
  winRate?: number;       // computed: tasksCompleted / tasksAttempted
}

// Frontend-only agent state (from simulator API)
export interface AgentState {
  name: string;
  pubkey: string;
  status: string;         // "SCANNING" | "WORKING on Task #N" | "IDLE"
  tasksCompleted: number;
  totalScore: number;
  x402Spending: number;   // USDC spent via x402
  currentTaskId: number | null;
  color: string;
}

export interface JudgeState {
  TeknikHakem: "READY" | "EVALUATING";
  KullanılabilirlikHakemi: "READY" | "EVALUATING";
  KapsamHakemi: "READY" | "EVALUATING";
}

// Live feed entry
export interface FeedEntry {
  id: string | number;
  time: string;           // ISO string
  timeStr: string;        // HH:MM:SS
  agent?: string;
  message: string;
  icon: string;
}

// Transaction log entry
export interface TxEntry {
  id: string | number;
  type: string;           // "settle()" | "submit_verdict()" | etc.
  hash: string;
  agent?: string;
  judge?: string;
  winner?: string;
  amount?: string;
  score?: number;
  scores?: number[];
  taskId?: number;
  time: string;
  explorerUrl: string;
  slot: number;
  ms: number;
  highlight?: boolean;
}

// Simulator API response
export interface SimulatorState {
  agents: AgentState[];
  judges: JudgeState;
  feed: FeedEntry[];
  txLog: TxEntry[];
  timestamp: number;
}

// ─── Orchestrator / Project types ────────────────────────────────────────────

export type AgentSpecialty =
  | "frontend"    // React, Next.js, UI
  | "backend"     // API, veritabanı, sunucu
  | "blockchain"  // Stellar, Soroban akıllı sözleşme, DeFi
  | "design"      // Grafik tasarım, UI/UX
  | "ai_ml"       // Model geliştirme, pipeline
  | "data"        // Veri analizi, SQL
  | "devops"      // CI/CD, deployment, altyapı
  | "finance"     // Finansal analiz, token ekonomisi
  | "content"     // Yazı, pazarlama, SEO
  | "research"    // Piyasa araştırması, raporlama
  | "mobile"      // iOS, Android, React Native
  | "security";   // Denetim, pentest, güvenlik

export type ProjectStatus =
  | "draft"
  | "analyzing"
  | "squadFormed"
  | "active"
  | "completed";

export type SubTaskStatus =
  | "pending"
  | "posted"
  | "inProgress"
  | "done";

export interface SubTask {
  id: number;
  projectId: number;
  specialty: AgentSpecialty;
  description: string;
  criteria: string;
  budgetUsdc: number;
  taskId?: number;              // pool'a bırakılınca dolar
  recommendedAgents: string[];  // Stellar address listesi
  confidence: number;           // 0-1
  status: SubTaskStatus;
}

export interface Project {
  id: number;
  poster: string;               // Stellar address (G...)
  title: string;
  description: string;
  totalBudgetUsdc: number;
  deadline: number;             // Unix timestamp (seconds)
  status: ProjectStatus;
  subTasks: SubTask[];
  orchestratorReasoning?: string;
  createdAt: string;            // ISO string
}

export interface AgentMatch {
  pubkey: string;
  name: string;
  score: number;                // Composite matching score 0-1
  avgScore: number;             // 0-100
  successRate: number;          // 0-100
  tasksCompleted: number;
  specialties: AgentSpecialty[];
}

export interface OrchestratorBreakdown {
  specialty: AgentSpecialty;
  workloadPct: number;          // 0-100
  budgetUsdc: number;
  reasoning: string;
  agents: AgentMatch[];
}

export interface OrchestratorResult {
  projectId: number;
  breakdown: OrchestratorBreakdown[];
  totalConfidence: number;      // 0-1
}

// ─── Post task form data ──────────────────────────────────────────────────────

// Post task form data
export interface PostTaskForm {
  description: string;
  criteria: string;
  rewardUsdc: number;
  deadlineMinutes: number;
  taskType: TaskType;
  outputFormat: OutputFormat;
}
