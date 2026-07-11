"use client";

import { useState, useEffect } from "react";
import ConnectWallet from "@/components/ConnectWallet";
import { TaskType, OutputFormat } from "@/lib/types";
import { ESCROW_CONTRACT_ID, IS_MAINNET } from "@/lib/constants";
import { postTaskOnChain } from "@/lib/sorobanEscrow";
import { fetchXlmBalance, EXPLORER_TX } from "@/lib/stellar";
import { useMessages, useLocale } from "@/lib/i18n";
import type { AppMessages } from "@/lib/i18n";
import { useStellar } from "@/lib/stellarContext";

export interface PostTaskMeta {
  contractTaskId?: number;
  escrowContractId?: string;
}

const TASK_IDS = ["question", "research", "code", "data", "web", "custom"] as const satisfies readonly TaskType[];

const TASK_STATIC: Record<
  TaskType,
  { icon: string; color: string; rewardRange: [number, number]; outputFormat: OutputFormat }
> = {
  question: { icon: "help_outline", color: "#7C9EFF", rewardRange: [0.1, 1], outputFormat: "text" },
  research: { icon: "lab_research", color: "#B97DFF", rewardRange: [1, 10], outputFormat: "report" },
  code: { icon: "code", color: "#40E183", rewardRange: [5, 50], outputFormat: "code" },
  data: { icon: "analytics", color: "#FFD166", rewardRange: [1, 20], outputFormat: "json" },
  web: { icon: "public", color: "#FF8C42", rewardRange: [10, 100], outputFormat: "url" },
  custom: { icon: "tune", color: "#FF5625", rewardRange: [0.1, 100], outputFormat: "text" },
};

const OUTPUT_IDS = ["text", "code", "json", "url", "report"] as const satisfies readonly OutputFormat[];

const OUTPUT_ICONS: Record<OutputFormat, string> = {
  text: "notes",
  code: "code",
  json: "data_object",
  url: "link",
  report: "article",
};

interface PostTaskModalProps {
  onClose: () => void;
  onTaskPosted: (
    txHash: string,
    taskId: number,
    description: string,
    criteria: string,
    rewardUsdc: number,
    deadlineMinutes: number,
    taskType?: TaskType,
    outputFormat?: OutputFormat,
    meta?: PostTaskMeta,
  ) => void;
}

function buildTaskDefs(pm: AppMessages["ui"]["postModal"]) {
  return TASK_IDS.map((id) => ({
    id,
    ...TASK_STATIC[id],
    ...pm.types[id],
  }));
}

/* ── Component ─────────────────────────────────────────────────────── */
export default function PostTaskModal({ onClose, onTaskPosted }: PostTaskModalProps) {
  const L = useMessages().ui.postModal;
  const { locale } = useLocale();
  const stellar = useStellar();
  const conn = stellar.state.connection;

  const [taskType, setTaskType] = useState<TaskType>("research");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("report");
  const [description, setDescription] = useState("");
  const [criteriaChips, setCriteriaChips] = useState<string[]>([]);
  const [chipInput, setChipInput] = useState("");
  const [rewardInput, setRewardInput] = useState("1");
  const rewardUsdc = parseFloat(rewardInput) || 0;
  const [deadlineMin, setDeadlineMin] = useState(30);
  const [loading, setLoading] = useState(false);
  const [trustLoading, setTrustLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskId] = useState(() => Math.floor(Date.now() / 1000) % 100000);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [hasTrustline, setHasTrustline] = useState<boolean>(true);

  const taskDefs = buildTaskDefs(L);
  const def = taskDefs.find((d) => d.id === taskType)!;

  useEffect(() => {
    const d = buildTaskDefs(L).find((x) => x.id === taskType)!;
    setCriteriaChips([...d.criteria]);
    setOutputFormat(d.outputFormat);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskType, locale]);

  // XLM is native — no trustline needed. We just track the poster's XLM balance.
  const refreshUsdc = (addr: string) =>
    fetchXlmBalance(addr)
      .then(({ xlm }) => {
        setUsdcBalance(parseFloat(xlm));
        setHasTrustline(true);
      })
      .catch(() => {});

  useEffect(() => {
    if (!conn?.address) return;
    refreshUsdc(conn.address);
    const id = setInterval(() => refreshUsdc(conn.address), 8000);
    return () => clearInterval(id);
  }, [conn?.address]);

  function addChip(val: string) {
    const v = val.trim();
    if (!v || criteriaChips.includes(v) || criteriaChips.length >= 8) return;
    setCriteriaChips((p) => [...p, v]);
    setChipInput("");
  }
  function removeChip(v: string) { setCriteriaChips((p) => p.filter((c) => c !== v)); }

  const ready = !!conn && conn.isTestnet;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!conn) { setError("Connect your Freighter wallet first."); return; }
    if (!conn.isTestnet) { setError(`Switch Freighter to ${IS_MAINNET ? "Mainnet" : "Testnet"} to lock the reward.`); return; }
    if (!ESCROW_CONTRACT_ID) { setError("Escrow contract is not configured yet."); return; }
    setLoading(true);
    setError(null);
    try {
      const deadline = Math.floor(Date.now() / 1000) + deadlineMin * 60;
      // 1) Lock the XLM reward in the Soroban escrow contract (real on-chain).
      const { hash } = await postTaskOnChain({
        posterAddress: conn.address,
        taskId,
        rewardUsdc,
        deadline,
      });

      // 2) Persist the task server-side so agents/judges/UI can see it.
      let serverId = taskId;
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            poster: conn.address,
            description,
            criteria: criteriaChips.join(", "),
            rewardUsdc,
            deadlineMinutes: deadlineMin,
            taskType,
            outputFormat,
            contractTaskId: taskId,
            escrowContractId: ESCROW_CONTRACT_ID,
            postTxHash: hash,
          }),
        });
        const data = await res.json();
        if (data?.success && data.task?.id) serverId = data.task.id;
      } catch { /* persisted best-effort */ }

      setTxHash(hash);
      onTaskPosted(hash, serverId, description, criteriaChips.join(", "), rewardUsdc, deadlineMin, taskType, outputFormat, {
        contractTaskId: taskId,
        escrowContractId: ESCROW_CONTRACT_ID,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to lock the reward on Stellar.");
    } finally {
      setLoading(false);
    }
  }

  const networkConnected = !!conn;
  const balanceOk = usdcBalance === null || usdcBalance >= rewardUsdc;
  const canSubmit = networkConnected && ready && hasTrustline && description.trim().length >= 10 && !loading;

  /* ── Success state ─────────────────────────────────────────────── */
  if (txHash) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-box" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
          <div style={{ textAlign: "center", padding: "28px 0 20px" }}>
            <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--green-dim)", border: "1px solid rgba(64,225,131,0.3)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 28, color: "var(--green)" }}>check_circle</span>
            </div>
            <div style={{ fontFamily: "var(--font-head)", fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>{L.successTitle}</div>
            <div style={{ fontFamily: "var(--font)", fontSize: 10, color: def.color, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
              {def.label.toUpperCase()} · #{taskId} · {rewardUsdc.toFixed(4)} XLM
            </div>
          </div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.7, marginBottom: 20 }}>
            {L.successBody}
          </div>
          <div style={{ background: "var(--bg-base)", border: "1px solid var(--bg-border-bright)", borderRadius: 6, padding: "12px 14px", marginBottom: 20 }}>
            <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-ghost)", letterSpacing: "0.1em", marginBottom: 8 }}>{L.txHashLabel}</div>
            <a href={EXPLORER_TX(txHash)} target="_blank" rel="noopener noreferrer"
              style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--accent)", textDecoration: "none", wordBreak: "break-all", lineHeight: 1.6 }}>
              {txHash}
            </a>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <a href={EXPLORER_TX(txHash)} target="_blank" rel="noopener noreferrer"
              className="btn-accent-ghost" style={{ flex: 1, textAlign: "center", textDecoration: "none", justifyContent: "center" }}>
              Stellar Expert ↗
            </a>
            <button onClick={onClose} className="btn-green" style={{ flex: 1, justifyContent: "center" }}>{L.close}</button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Form ──────────────────────────────────────────────────────── */
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 680, maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: def.color, transition: "color 0.2s" }}>add_task</span>
            <span style={{ fontFamily: "var(--font-head)", fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>{L.newTitle}</span>
          </div>
          <button onClick={onClose}
            style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid var(--bg-border-bright)", borderRadius: 4, cursor: "pointer", color: "var(--text-muted)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface-high)"; e.currentTarget.style.color = "var(--text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 22 }}>

          {/* ── Escrow / network banner ────────────────────────── */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-surface)", border: "1px solid var(--bg-border)", borderRadius: 8, padding: "12px 14px" }}>
            <span style={{ fontSize: 18, color: "var(--accent)" }}>✦</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>Stellar · Soroban Escrow</div>
              <div style={{ fontFamily: "var(--font)", fontSize: 9, color: ready ? "var(--green)" : "var(--yellow)" }}>
                {conn
                  ? (ready ? "Wallet ready · XLM reward locked in the escrow contract on publish" : `Switch Freighter to ${IS_MAINNET ? "Mainnet" : "Testnet"} to continue`)
                  : "Connect Freighter below to lock a XLM reward"}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "var(--bg-border)" }} />

          {/* ── Task Type Grid ─────────────────────────────────── */}
          <div>
            <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>
              {L.taskTypeSection}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {taskDefs.map((d) => {
                const active = d.id === taskType;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setTaskType(d.id)}
                    style={{
                      background: active ? `${d.color}12` : "var(--bg-surface)",
                      border: `1px solid ${active ? d.color : "var(--bg-border)"}`,
                      borderRadius: 8,
                      padding: "12px 14px",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.15s",
                      position: "relative",
                      overflow: "hidden",
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = `${d.color}88`; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = "var(--bg-border)"; }}
                  >
                    {active && (
                      <span style={{ position: "absolute", top: 8, right: 8, width: 6, height: 6, borderRadius: "50%", background: d.color, display: "block" }} />
                    )}
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: active ? d.color : "var(--text-muted)", display: "block", marginBottom: 6, transition: "color 0.15s" }}>
                      {d.icon}
                    </span>
                    <div style={{ fontFamily: "var(--font)", fontSize: 12, fontWeight: 700, color: active ? d.color : "var(--text-primary)", marginBottom: 2, transition: "color 0.15s" }}>
                      {d.label}
                    </div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--text-muted)", lineHeight: 1.4 }}>
                      {d.sub}
                    </div>
                    <div style={{ fontFamily: "var(--font)", fontSize: 9, color: active ? d.color : "rgba(var(--text-rgb),0.2)", marginTop: 8, letterSpacing: "0.04em" }}>
                      {d.rewardRange[0]}–{d.rewardRange[1]} XLM
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "var(--bg-border)" }} />

          {/* ── Description ──────────────────────────────────── */}
          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
              <label style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                {L.fieldLabel}
              </label>
              <span style={{ fontFamily: "var(--font)", fontSize: 9, color: description.length > 450 ? "var(--yellow)" : "rgba(var(--text-rgb),0.2)" }}>
                {description.length}/1000
              </span>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={def.placeholder}
              style={{ height: 110, resize: "none", fontFamily: "var(--font-body)", fontSize: 12, lineHeight: 1.7 }}
              maxLength={1000}
              required
            />
          </div>

          {/* ── Output Format ─────────────────────────────── */}
          <div>
            <div style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>
              {L.expectedOutput}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {OUTPUT_IDS.map((oid) => {
                const active = oid === outputFormat;
                return (
                  <button
                    key={oid}
                    type="button"
                    onClick={() => setOutputFormat(oid)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "6px 12px",
                      background: active ? `${def.color}18` : "transparent",
                      border: `1px solid ${active ? def.color : "var(--bg-border)"}`,
                      borderRadius: 4,
                      cursor: "pointer",
                      fontFamily: "var(--font)",
                      fontSize: 10,
                      color: active ? def.color : "var(--text-muted)",
                      transition: "all 0.15s",
                      fontWeight: active ? 700 : 400,
                    }}
                    onMouseEnter={(e) => { if (!active) { e.currentTarget.style.borderColor = "var(--bg-border-bright)"; e.currentTarget.style.color = "var(--text-secondary)"; } }}
                    onMouseLeave={(e) => { if (!active) { e.currentTarget.style.borderColor = "var(--bg-border)"; e.currentTarget.style.color = "var(--text-muted)"; } }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{OUTPUT_ICONS[oid]}</span>
                    {L.outputFormats[oid]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Criteria chips ─────────────────────────────── */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <label style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                {L.criteriaSection}
              </label>
              <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(var(--text-rgb),0.2)" }}>{criteriaChips.length}/8</span>
            </div>
            <div style={{ minHeight: 42, background: "var(--bg-base)", border: "1px solid var(--bg-border-bright)", borderRadius: 4, padding: "7px 8px", display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
              {criteriaChips.map((chip) => (
                <span key={chip} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: `${def.color}18`, border: `1px solid ${def.color}55`, color: def.color, fontFamily: "var(--font)", fontSize: 9, fontWeight: 700, padding: "3px 8px 3px 10px", borderRadius: 2, letterSpacing: "0.04em", transition: "background 0.2s" }}>
                  {chip}
                  <button type="button" onClick={() => removeChip(chip)}
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: def.color, lineHeight: 1, padding: 0, display: "flex", alignItems: "center", opacity: 0.5 }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}>
                    <span className="material-symbols-outlined" style={{ fontSize: 11 }}>close</span>
                  </button>
                </span>
              ))}
              {criteriaChips.length === 0 && <span style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(var(--text-rgb),0.2)" }}>{L.criteriaEmptyHint}</span>}
            </div>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input type="text" value={chipInput}
                onChange={(e) => setChipInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "," || e.key === "Tab") { e.preventDefault(); addChip(chipInput); } }}
                placeholder={L.criteriaPlaceholder}
                style={{ fontFamily: "var(--font-body)", fontSize: 11, paddingRight: 64 }} />
              <button type="button" onClick={() => addChip(chipInput)}
                style={{ position: "absolute", right: 8, fontFamily: "var(--font)", fontSize: 8, color: chipInput.trim() ? def.color : "rgba(var(--text-rgb),0.2)", background: "transparent", border: "none", cursor: chipInput.trim() ? "pointer" : "default", letterSpacing: "0.06em", fontWeight: 700 }}>
                {L.addChip}
              </button>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "var(--bg-border)" }} />

          {/* ── Reward + Deadline ─────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                <label style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                  {L.rewardLabel}
                </label>
                <span style={{ fontFamily: "var(--font)", fontSize: 8, color: "rgba(var(--text-rgb),0.3)" }}>
                  {L.suggestPrefix} {def.rewardRange[0]}–{def.rewardRange[1]}
                </span>
              </div>
              <input type="text" inputMode="decimal" value={rewardInput}
                onChange={(e) => { const v = e.target.value.replace(",", "."); if (/^\d*\.?\d*$/.test(v)) setRewardInput(v); }}
                placeholder="0" required
                style={{ fontFamily: "var(--font)", fontSize: 14, fontWeight: 700, color: def.color }} />
              {usdcBalance !== null && (
                <div style={{ fontFamily: "var(--font)", fontSize: 9, color: balanceOk ? "rgba(var(--text-rgb),0.3)" : "var(--red)", marginTop: 4 }}>
                  {L.balancePrefix} {usdcBalance.toFixed(4)} XLM {!balanceOk && L.insufficientSuffix}
                </div>
              )}
            </div>

            {/* Deadline presets */}
            <div>
              <label style={{ display: "block", fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>
                {L.durationLabel}
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {L.deadlines.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setDeadlineMin(p.value)}
                    style={{
                      padding: "6px 10px",
                      background: deadlineMin === p.value ? `${def.color}18` : "transparent",
                      border: `1px solid ${deadlineMin === p.value ? def.color : "var(--bg-border)"}`,
                      borderRadius: 3,
                      fontFamily: "var(--font)",
                      fontSize: 9,
                      color: deadlineMin === p.value ? def.color : "var(--text-muted)",
                      cursor: "pointer",
                      fontWeight: deadlineMin === p.value ? 700 : 400,
                      transition: "all 0.12s",
                    }}
                    onMouseEnter={(e) => { if (deadlineMin !== p.value) e.currentTarget.style.borderColor = "var(--bg-border-bright)"; }}
                    onMouseLeave={(e) => { if (deadlineMin !== p.value) e.currentTarget.style.borderColor = "var(--bg-border)"; }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Summary strip ──────────────────────────────── */}
          <div style={{ background: "var(--bg-base)", border: "1px solid var(--bg-border-bright)", borderRadius: 6, padding: "12px 16px", display: "flex", gap: 0 }}>
            {[
              [L.summaryLabels.taskType, def.label, def.color],
              [L.summaryLabels.output, L.outputFormats[outputFormat], "var(--text-primary)"],
              [L.summaryLabels.reward, `${rewardUsdc.toFixed(4)} XLM`, "var(--accent)"],
              [L.summaryLabels.duration, L.deadlines.find((p) => p.value === deadlineMin)?.label ?? L.minutesShort(deadlineMin), "var(--text-primary)"],
              [L.summaryLabels.network, "Stellar Mainnet", "var(--green)"],
            ].map(([label, val, color], i) => (
              <div key={label} style={{ flex: 1, paddingLeft: i > 0 ? 14 : 0, borderLeft: i > 0 ? "1px solid var(--bg-border)" : "none", marginLeft: i > 0 ? 14 : 0 }}>
                <div style={{ fontFamily: "var(--font)", fontSize: 8, color: "var(--text-ghost)", letterSpacing: "0.1em", marginBottom: 4 }}>{label}</div>
                <div style={{ fontFamily: "var(--font)", fontSize: 10, color, fontWeight: 700 }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div style={{ background: "var(--red-dim)", border: "1px solid rgba(255,180,171,0.3)", borderRadius: 4, padding: "10px 14px", fontFamily: "var(--font)", fontSize: 11, color: "var(--red)", display: "flex", alignItems: "center", gap: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>warning</span>
              {error}
            </div>
          )}

          {/* Submit */}
          {!networkConnected ? (
            <div style={{ textAlign: "center", paddingTop: 4 }}>
              <div style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
                Connect Freighter to lock a XLM reward
              </div>
              <ConnectWallet />
            </div>
          ) : (
            <button
              type="submit"
              disabled={!canSubmit}
              className="btn-primary"
              style={{
                opacity: canSubmit ? 1 : 0.4,
                justifyContent: "center",
                padding: "14px 20px",
                fontSize: 12,
                background: canSubmit ? `linear-gradient(135deg, ${def.color}22, transparent)` : undefined,
                borderColor: canSubmit ? def.color : undefined,
                color: canSubmit ? def.color : undefined,
                transition: "all 0.2s",
              }}
            >
              {loading ? (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: 15, animation: "spin 1s linear infinite" }}>sync</span>
                  {`Locking ${rewardUsdc.toFixed(4)} XLM…`}
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>rocket_launch</span>
                  {`Lock ${rewardUsdc.toFixed(4)} XLM & Publish`}
                </>
              )}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
