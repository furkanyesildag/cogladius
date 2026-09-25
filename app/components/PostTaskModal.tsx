"use client";

import { useState, useEffect } from "react";
import ConnectWallet from "@/components/ConnectWallet";
import { TaskType, OutputFormat } from "@/lib/types";
import { ESCROW_CONTRACT_ID, IS_MAINNET } from "@/lib/constants";
import { postTaskOnChain, postTaskSponsored, relayerInfo } from "@/lib/sorobanEscrow";
import { fetchXlmBalance, EXPLORER_TX } from "@/lib/stellar";
import { useMessages, useLocale } from "@/lib/i18n";
import type { AppMessages } from "@/lib/i18n";
import { useStellar } from "@/lib/stellarContext";

const PT = {
  en: {
    kicker: "New task",
    successBody: "Open to all registered agents.",
    relayPaid: (fee: string) => `Network fee (${fee} XLM) paid by Cogladius.`,
    txHash: "Escrow transaction",
    escrowTitle: "Soroban escrow",
    walletReady: "Wallet ready · the XLM reward is locked in the escrow contract when you publish",
    switchNet: (net: string) => `Switch your wallet to ${net} to continue`,
    connectFirst: "Connect a wallet to lock an XLM reward",
    add: "Add",
    sumType: "Type", sumOutput: "Output", sumReward: "Reward", sumDuration: "Duration", sumNetwork: "Network",
    sponsor: "Let Cogladius pay the network fee (you sign only the authorization; only the reward leaves your wallet)",
    locking: (x: string) => `Locking ${x} XLM…`,
    lock: (x: string) => `Lock ${x} XLM & publish`,
    footnote: "The reward stays in the escrow until it is released to a submission whose judged average is at least 70: by you, or after the deadline by anyone who requests settlement.",
  },
  tr: {
    kicker: "Yeni görev",
    successBody: "Tüm kayıtlı ajanlara açık.",
    relayPaid: (fee: string) => `Ağ ücreti (${fee} XLM) Cogladius tarafından ödendi.`,
    txHash: "Escrow işlemi",
    escrowTitle: "Soroban escrow",
    walletReady: "Cüzdan hazır · XLM ödülü yayınladığında escrow kontratına kilitlenir",
    switchNet: (net: string) => `Devam etmek için cüzdanını ${net} ağına geçir`,
    connectFirst: "XLM ödülü kilitlemek için bir cüzdan bağla",
    add: "Ekle",
    sumType: "Tür", sumOutput: "Çıktı", sumReward: "Ödül", sumDuration: "Süre", sumNetwork: "Ağ",
    sponsor: "Ağ ücretini Cogladius ödesin (yalnızca yetkilendirmeyi imzalarsın, cüzdanından sadece ödül çıkar)",
    locking: (x: string) => `${x} XLM kilitleniyor…`,
    lock: (x: string) => `${x} XLM kilitle ve yayınla`,
    footnote: "Ödül, hakem ortalaması en az 70 olan bir teslime ödenene kadar escrow'da kalır: bunu sen yaparsın ya da son tarihten sonra ödeme talep eden herkes yapabilir.",
  },
};

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
  // Random 47-bit id: JSON-safe, and collisions with existing escrow tasks are negligible.
  const [taskId] = useState(() => Math.floor(Math.random() * 2 ** 47) + 1);
  const [sponsorAvailable, setSponsorAvailable] = useState(false);
  const [sponsored, setSponsored] = useState(false);
  const [relayFee, setRelayFee] = useState<string | null>(null);
  useEffect(() => {
    relayerInfo().then((r) => {
      setSponsorAvailable(!!r);
      setSponsored(!!r);
    });
  }, []);
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
      // Sponsored: the poster signs only the authorization entry and the relayer
      // pays the network fee. Otherwise the poster signs and pays as before.
      // Some wallets (xBull, Albedo, Lobstr, Rabet) can't sign auth entries;
      // for them fall back to the poster-paid path instead of failing.
      const postArgs = { posterAddress: conn.address, taskId, rewardUsdc, deadline };
      const { hash } = sponsored
        ? await postTaskSponsored(postArgs)
            .then((r) => {
              setRelayFee(r.feePaidByRelayer);
              return r;
            })
            .catch((err) => {
              if (/does not support/i.test(String(err?.message))) return postTaskOnChain(postArgs);
              throw err;
            })
        : await postTaskOnChain(postArgs);

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
  const t = PT[locale === "tr" ? "tr" : "en"];
  const netName = IS_MAINNET ? "Stellar Mainnet" : "Stellar Testnet";

  /* ── Success state ─────────────────────────────────────────────── */
  if (txHash) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-box db-modal" style={{ maxWidth: 480, ["--c" as string]: def.color }} onClick={(e) => e.stopPropagation()}>
          <div className="db-modal-success">
            <div className="db-success-ring"><span className="material-symbols-outlined">check_circle</span></div>
            <h2>{L.successTitle}</h2>
            <div className="db-modal-sub">{def.label} · #{taskId} · {rewardUsdc.toFixed(4)} XLM</div>
            <p>{t.successBody}</p>
            {relayFee && <p style={{ color: "var(--green)" }}>{t.relayPaid(relayFee)}</p>}
          </div>
          <div className="db-hashbox">
            <div className="ui-label">{t.txHash}</div>
            <a href={EXPLORER_TX(txHash)} target="_blank" rel="noopener noreferrer">{txHash}</a>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a href={EXPLORER_TX(txHash)} target="_blank" rel="noopener noreferrer" className="btn-ghost" style={{ flex: 1, textDecoration: "none" }}>Stellar Expert ↗</a>
            <button type="button" onClick={onClose} className="btn-primary" style={{ flex: 1 }}>{L.close}</button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Form ──────────────────────────────────────────────────────── */
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box db-modal" style={{ maxWidth: 700, maxHeight: "92vh", overflowY: "auto", ["--c" as string]: def.color }} onClick={(e) => e.stopPropagation()}>

        <div className="db-modal-head">
          <div>
            <span className="ui-kicker">{t.kicker}</span>
            <h2>{L.newTitle}</h2>
          </div>
          <button type="button" className="db-icon-btn" onClick={onClose} aria-label={L.close}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="db-form">

          {/* Escrow / network banner */}
          <div className={`db-banner${ready ? " is-ready" : ""}`}>
            <span className="db-banner-dot" />
            <div>
              <div className="db-banner-title">{t.escrowTitle}</div>
              <div className="db-banner-sub">
                {conn ? (ready ? t.walletReady : t.switchNet(IS_MAINNET ? "Mainnet" : "Testnet")) : t.connectFirst}
              </div>
            </div>
          </div>

          {/* Task type */}
          <div>
            <div className="db-field-label">{L.taskTypeSection}</div>
            <div className="db-type-grid">
              {taskDefs.map((d) => {
                const active = d.id === taskType;
                return (
                  <button key={d.id} type="button" onClick={() => setTaskType(d.id)} className={`db-type${active ? " is-active" : ""}`} style={{ ["--c" as string]: d.color }}>
                    <span className="material-symbols-outlined">{d.icon}</span>
                    <span className="db-type-name">{d.label}</span>
                    <span className="db-type-sub">{d.sub}</span>
                    <span className="db-type-range">{d.rewardRange[0]}–{d.rewardRange[1]} XLM</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Description */}
          <div>
            <div className="db-field-row">
              <label className="db-field-label" htmlFor="pt-desc">{L.fieldLabel}</label>
              <span className="db-field-hint" style={{ color: description.length > 900 ? "var(--yellow)" : undefined }}>{description.length}/1000</span>
            </div>
            <textarea id="pt-desc" className="ui-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={def.placeholder} style={{ height: 120, resize: "vertical", lineHeight: 1.6 }} maxLength={1000} required />
          </div>

          {/* Output format */}
          <div>
            <div className="db-field-label">{L.expectedOutput}</div>
            <div className="db-chips">
              {OUTPUT_IDS.map((oid) => (
                <button key={oid} type="button" onClick={() => setOutputFormat(oid)} className={`db-chip${oid === outputFormat ? " is-active" : ""}`}>
                  <span className="material-symbols-outlined">{OUTPUT_ICONS[oid]}</span>
                  {L.outputFormats[oid]}
                </button>
              ))}
            </div>
          </div>

          {/* Criteria */}
          <div>
            <div className="db-field-row">
              <span className="db-field-label">{L.criteriaSection}</span>
              <span className="db-field-hint">{criteriaChips.length}/8</span>
            </div>
            <div className="db-criteria">
              {criteriaChips.map((chip) => (
                <span key={chip} className="db-crit">
                  {chip}
                  <button type="button" onClick={() => removeChip(chip)} aria-label="remove">✕</button>
                </span>
              ))}
              {criteriaChips.length === 0 && <span className="db-field-hint">{L.criteriaEmptyHint}</span>}
            </div>
            <div className="db-crit-input">
              <input type="text" className="ui-input" value={chipInput} onChange={(e) => setChipInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addChip(chipInput); } }}
                placeholder={L.criteriaPlaceholder} />
              <button type="button" className="btn-ghost" onClick={() => addChip(chipInput)} disabled={!chipInput.trim()}>{t.add}</button>
            </div>
          </div>

          {/* Reward + deadline */}
          <div className="db-two">
            <div>
              <div className="db-field-row">
                <label className="db-field-label" htmlFor="pt-reward">{L.rewardLabel}</label>
                <span className="db-field-hint">{L.suggestPrefix} {def.rewardRange[0]}–{def.rewardRange[1]}</span>
              </div>
              <input id="pt-reward" type="text" inputMode="decimal" className="ui-input db-reward-input" value={rewardInput}
                onChange={(e) => { const v = e.target.value.replace(",", "."); if (/^\d*\.?\d*$/.test(v)) setRewardInput(v); }}
                placeholder="0" required />
              {usdcBalance !== null && (
                <div className="db-field-hint" style={{ marginTop: 6, color: balanceOk ? undefined : "var(--red)" }}>
                  {L.balancePrefix} {usdcBalance.toFixed(4)} XLM {!balanceOk && L.insufficientSuffix}
                </div>
              )}
            </div>
            <div>
              <div className="db-field-label">{L.durationLabel}</div>
              <div className="db-chips">
                {L.deadlines.map((p) => (
                  <button key={p.value} type="button" onClick={() => setDeadlineMin(p.value)} className={`db-chip${deadlineMin === p.value ? " is-active" : ""}`}>{p.label}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="db-summary">
            {[
              [t.sumType, def.label],
              [t.sumOutput, L.outputFormats[outputFormat]],
              [t.sumReward, `${rewardUsdc.toFixed(4)} XLM`],
              [t.sumDuration, L.deadlines.find((p) => p.value === deadlineMin)?.label ?? L.minutesShort(deadlineMin)],
              [t.sumNetwork, netName],
            ].map(([label, val]) => (
              <div key={label}>
                <div className="ui-label">{label}</div>
                <div className="db-summary-val">{val}</div>
              </div>
            ))}
          </div>

          {sponsorAvailable && (
            <label className="db-check">
              <input type="checkbox" checked={sponsored} onChange={(e) => setSponsored(e.target.checked)} />
              {t.sponsor}
            </label>
          )}

          {error && <div className="db-alert db-alert-red" role="alert">{error}</div>}

          {!networkConnected ? (
            <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <div className="db-field-hint" style={{ fontSize: 13 }}>{t.connectFirst}</div>
              <ConnectWallet />
            </div>
          ) : (
            <button type="submit" disabled={!canSubmit} className="btn-primary db-submit">
              {loading ? t.locking(rewardUsdc.toFixed(4)) : t.lock(rewardUsdc.toFixed(4))}
            </button>
          )}
          <p className="db-field-hint" style={{ margin: 0, lineHeight: 1.6 }}>{t.footnote}</p>
        </form>
      </div>
    </div>
  );
}
