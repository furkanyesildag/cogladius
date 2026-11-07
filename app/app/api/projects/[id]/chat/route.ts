import { NextRequest, NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/projectStore";
import { getAllAgents } from "@/lib/agentRegistry";
import { SPECIALTY_META } from "@/lib/specialtyMeta";
import type { AgentSpecialty } from "@/lib/types";
import type { RegisteredAgent } from "@/lib/agentRegistry";
import { getOpenAiChatModel, openaiChatCompletion, llmAvailable } from "@/lib/openaiAgents";
import { guardPublicAi } from "@/lib/publicAiGuard";

export const dynamic = "force-dynamic";
// Chain reads must be live: stellar-sdk 16 posts JSON-RPC over fetch with
// identical bodies, which Next 14 would otherwise cache.
export const fetchCache = "force-no-store";

// Keep last 24 messages max to avoid token overflow while preserving full context
const MAX_HISTORY = 24;

function agentActivityLabel(agent: RegisteredAgent): string {
  const hoursSince = (Date.now() - new Date(agent.lastSeen).getTime()) / 3_600_000;
  if (hoursSince < 1)  return "🟢 Active";
  if (hoursSince < 24) return `🟡 ${Math.round(hoursSince)}h ago`;
  return "⚫ Offline";
}

function buildSystemPrompt(
  project: Awaited<ReturnType<typeof getProject>>,
  agents: Awaited<ReturnType<typeof getAllAgents>>
): string {
  const deadline = project
    ? new Date(project.deadline * 1000).toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
      })
    : "Not specified";

  const budget = project?.totalBudgetUsdc ?? 0;

  // Budget assessment thresholds (rough XLM benchmarks)
  const budgetNote =
    budget === 0
      ? "⚠️ No budget entered. Ask the user to clarify it."
      : budget < 0.5
        ? "⚠️ Very low budget. It may be insufficient for most tasks; say so."
        : budget < 2
          ? "💡 Small budget. Keep the scope tight and tell the user."
          : budget <= 10
            ? "✅ Moderate budget. Enough for a standard project."
            : budget <= 30
              ? "✅ Good budget. Comfortable for a substantial project."
              : "💰 Large budget. Maximise scope and quality, and optimise the surplus.";

  const agentList =
    agents.length === 0
      ? "No agents are registered yet."
      : agents
          .map((a) => {
            const specs = (a.specialties ?? [])
              .map((s: AgentSpecialty) => SPECIALTY_META[s]?.label ?? s)
              .join(", ");
            const activity = agentActivityLabel(a);
            const tier = a.tier.toUpperCase();
            return (
              `• **${a.name}** (${tier}) | ${activity} | ` +
              `Avg score: ${a.stats.avgScore}/100 | Success: ${a.stats.successRate}% | ` +
              `Tasks: ${a.stats.tasksCompleted} | Specialties: ${specs || "unspecified"} | ` +
              `ID: ${a.pubkey.slice(0, 8)}...`
            );
          })
          .join("\n");

  const specialtyList = Object.entries(SPECIALTY_META)
    .map(([key, meta]) => `• **${meta.label}** (\`${key}\`): ${meta.defaultCriteria.join(" · ")}`)
    .join("\n");

  return `You are **NEXUS**, the orchestrator agent of the Cogladius platform. You are called NEXUS because you connect everything: the project, the agents, the budget, the technology and the outcome. You analyse large software projects, split them into specialties, optimise the budget and assemble the best agent squad. You work with the client directly, never losing context, in a professional and warm tone. **In your first message, briefly introduce yourself as NEXUS.**

═══════════════════════════════════════
PROJECT DETAILS
═══════════════════════════════════════
Title       : ${project?.title ?? "Not specified"}
Description : ${project?.description ?? "None"}
Total budget: ${budget} XLM  ${budgetNote}
Deadline    : ${deadline}
Project ID  : #${project?.id}

═══════════════════════════════════════
AGENTS AVAILABLE ON THE PLATFORM (${agents.length} registered)
═══════════════════════════════════════
${agentList}

═══════════════════════════════════════
AVAILABLE SPECIALTIES
═══════════════════════════════════════
${specialtyList}

═══════════════════════════════════════
BUDGET GUIDE (rough XLM benchmarks)
═══════════════════════════════════════
• Frontend / Backend small: 0.5-2 XLM | medium: 2-5 XLM | large: 5-15 XLM
• Blockchain (smart contract): 3 XLM minimum recommended; security review +2 XLM
• Design (full brand): 1-4 XLM | logo only: 0.5 XLM
• AI/ML (simple integration): 1-3 XLM | model training: 5-20 XLM
• DevOps / infrastructure: 1-3 XLM | large k8s or cloud: 3-8 XLM
• Research / content: 0.3-1.5 XLM
• Security audit: 2-8 XLM depending on scope

═══════════════════════════════════════
YOUR JOB AND BEHAVIOUR
═══════════════════════════════════════

1. FIRST ANALYSIS (in your first message):
   - Analyse the project in depth and propose a technical architecture
   - Which specialties are needed and why? Justify, and name the technologies
   - Present the estimated workload split as percentages
   - Give an estimated duration range (for example "2-4 weeks")
   - Assess the budget: is it sufficient, optimal, or excessive?
     * If insufficient, state the minimum needed and explain why
     * If optimal, briefly explain why
     * If excessive, propose how to optimise it or where to widen the scope
   - Identify risks: likely difficulties, dependencies, and what to watch for

2. SQUAD PROPOSAL:
   - Pick the best agent for each specialty and justify the choice
     (use tier, success rate, average score, specialties, activity)
   - Prefer 🟢 Active agents and flag ⚫ Offline ones
   - State the technology stack you would use (React, Next.js, Soroban, and so on)
   - Show the budget split as both percentages and XLM

3. INTERACTIVE NEGOTIATION:
   - Answer every question the user asks, fully
   - Apply requested changes immediately (percentages, swapping an agent, technology choices)
   - Never lose context; take all previous messages into account
   - Explain technical detail clearly and cut the jargon
   - Answer budget objections with concrete numbers and reasoning
   - Recalculate the whole split whenever the user changes something (always totals 100%)

4. APPROVAL FLOW:
   - When the plan is ready, ask plainly: "Would you like to approve this plan?"
   - Add the PLAN block when the user approves ("approve", "yes", "ok", "go ahead", or the equivalent in their language)
   - Never add the PLAN block before approval
   - After approval, summarise the plan in one sentence and state the next step

5. STYLE:
   - Reply in the same language the user writes to you in. If they write in English, reply in English.
   - Professional, warm and reassuring tone
   - Use headings, bullet points and emoji to stay readable
   - Always state budget figures in XLM
   - Write agent names in bold
   - In long analyses, separate sections with ─── or ═══

═══════════════════════════════════════
PLAN BLOCK FORMAT
(add ONLY when the user has explicitly approved)
═══════════════════════════════════════
<PLAN>
{"breakdown":[{"specialty":"frontend","workloadPct":35,"budgetUsdc":3.5,"reasoning":"short reasoning, in the user's language","agentPubkeys":["pubkey"],"technologies":["React","Next.js","Tailwind CSS"]}]}
</PLAN>

Rules:
- specialty must be one of: ${Object.keys(SPECIALTY_META).join(", ")}
- all workloadPct values must total exactly 100
- agentPubkeys: choose from the pubkeys of the agents listed above, where available
- technologies: list realistic technologies that fit the project`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const blocked = await guardPublicAi(req);
  if (blocked) return blocked;
  if (!llmAvailable()) {
    return NextResponse.json(
      {
        success: false,
        error: "The AI engine is not configured.",
      },
      { status: 500 }
    );
  }

  const id = Number(params.id);
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ success: false, error: "Proje bulunamadı" }, { status: 404 });
  }

  const body = await req.json();
  const { messages = [], userMessage = "" } = body as {
    messages: Array<{ role: string; content: string }>;
    userMessage?: string;
  };

  const allAgents = await getAllAgents();
  const systemPrompt = buildSystemPrompt(project, allAgents);

  // Trim history to avoid token overflow while keeping full recent context
  const trimmedHistory = messages.length > MAX_HISTORY ? messages.slice(-MAX_HISTORY) : messages;

  const openaiMessages = [
    { role: "system", content: systemPrompt },
    ...trimmedHistory,
    ...(userMessage ? [{ role: "user", content: userMessage }] : []),
  ];

  const res = await openaiChatCompletion({
    model: getOpenAiChatModel("nexus"),
    messages: openaiMessages,
    max_tokens: 2800,
    temperature: 0.55,
  });

  if (!res.ok) {
    return NextResponse.json({ success: false, error: res.error }, { status: 400 });
  }

  try {
    const fullReply = res.text;

    // Parse and strip <PLAN> block
    const planMatch = fullReply.match(/<PLAN>([\s\S]*?)<\/PLAN>/);
    const reply = fullReply.replace(/<PLAN>[\s\S]*?<\/PLAN>/g, "").trim();

    let breakdown = null;
    if (planMatch) {
      try {
        const planText = planMatch[1].trim();
        const parsed = JSON.parse(planText);
        if (Array.isArray(parsed.breakdown) && parsed.breakdown.length > 0) {
          breakdown = parsed.breakdown;
          await updateProject(id, {
            status: "squadFormed",
            orchestratorReasoning: JSON.stringify(breakdown),
          });
        }
      } catch {
        /* malformed PLAN block — ignore, still return the reply */
      }
    }

    return NextResponse.json({ success: true, reply, breakdown });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
