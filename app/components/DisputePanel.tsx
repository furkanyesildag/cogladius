"use client";

import { useState } from "react";
import { useWallet } from "@/lib/useWallet";
import type { Task } from "@/lib/types";
import { explorerTx, shortenAddress } from "@/lib/constants";
import { disputeAsPoster } from "@/lib/sorobanEscrow";
import { useLocale } from "@/lib/i18n";

/**
 * Flags an already-settled task as disputed on the escrow contract.
 *
 * What actually happens: the poster signs a SEP-53 message, the server checks
 * it against the escrow's recorded poster, then the platform admin key calls
 * `flag_disputed`. That only changes the on-chain status to Disputed and emits
 * an event. No funds move, nothing is re-judged, and there is no stake or
 * refund. Styling comes from app/task/[id]/task.css (the only page using it).
 */

interface DisputePanelProps {
  task: Task;
  onClose: () => void;
  onDisputed: (txHash: string) => void;
}

const T = {
  en: {
    what: "This writes a dispute record for this task on the escrow contract.",
    points: [
      "You sign a message with the wallet that posted the task.",
      "The platform admin key then calls flag_disputed on the escrow. The task's on-chain status becomes Disputed and an event is emitted.",
      "Nothing else happens: the payout stays with the winner, no one re-judges the work, and there is no stake and no refund.",
    ],
    onlySettled: "A dispute can only be recorded after the reward has been released.",
    status: "Current status",
    noEscrow: "This task has no escrowed reward on-chain, so there is nothing to flag.",
    connect: "Connect the wallet that posted this task to sign.",
    notPoster: (a: string) => `Only the poster (${a}) can flag this task.`,
    cancel: "Cancel",
    confirm: "Sign and record dispute",
    working: "Waiting for signature…",
    already: "This task is already flagged as disputed on-chain.",
    doneTitle: "Dispute recorded on-chain",
    doneText: "The escrow now shows this task as Disputed. No funds moved.",
    tx: "Transaction",
    close: "Close",
    failed: "Could not record the dispute",
  },
  tr: {
    what: "Bu işlem, görev için escrow kontratına bir itiraz kaydı yazar.",
    points: [
      "Görevi yayınlayan cüzdanla bir mesaj imzalarsın.",
      "Ardından platform yönetici anahtarı escrow üzerinde flag_disputed çağırır. Görevin zincirdeki durumu Disputed olur ve bir olay yayımlanır.",
      "Başka hiçbir şey olmaz: ödeme kazananda kalır, iş yeniden puanlanmaz, stake ve iade yoktur.",
    ],
    onlySettled: "İtiraz kaydı yalnızca ödül ödendikten sonra yazılabilir.",
    status: "Mevcut durum",
    noEscrow: "Bu görevin zincirde escrow'da ödülü yok; işaretlenecek bir şey bulunmuyor.",
    connect: "İmzalamak için bu görevi yayınlayan cüzdanı bağla.",
    notPoster: (a: string) => `Bu görevi yalnızca yayınlayan (${a}) işaretleyebilir.`,
    cancel: "Vazgeç",
    confirm: "İmzala ve itirazı kaydet",
    working: "İmza bekleniyor…",
    already: "Bu görev zincirde zaten itirazlı olarak işaretli.",
    doneTitle: "İtiraz zincire kaydedildi",
    doneText: "Escrow bu görevi artık Disputed olarak gösteriyor. Hiçbir fon hareket etmedi.",
    tx: "İşlem",
    close: "Kapat",
    failed: "İtiraz kaydedilemedi",
  },
};

export default function DisputePanel({ task, onClose, onDisputed }: DisputePanelProps) {
  const { locale } = useLocale();
  const t = T[locale === "tr" ? "tr" : "en"];
  const { connected, address } = useWallet();

  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPoster = connected && !!address && address === task.poster;

  async function handleDispute() {
    if (!isPoster || task.contractTaskId === undefined) return;
    setLoading(true);
    setError(null);
    try {
      // The poster signs (SEP-53); the server verifies it against the escrow's poster, then the admin key runs flag_disputed.
      const data = await disputeAsPoster({ taskId: task.id, contractTaskId: task.contractTaskId, posterAddress: address! });
      if (!data?.success) throw new Error(data?.error || t.failed);
      setTxHash(data.hash);
      onDisputed(data.hash);
    } catch (err: any) {
      setError(err?.message || t.failed);
    } finally {
      setLoading(false);
    }
  }

  if (txHash) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="td-ok">
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t.doneTitle}</div>
          {t.doneText}
        </div>
        <div className="td-kv">
          <span>{t.tx}</span>
          <a href={explorerTx(txHash)} target="_blank" rel="noopener noreferrer" title={txHash}>{shortenAddress(txHash, 8)} ↗</a>
        </div>
        <button type="button" className="btn-ghost" onClick={onClose}>{t.close}</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, ["--c" as string]: "var(--red)" }}>
      <p className="td-text">{t.what}</p>
      <ul className="td-list" style={{ marginTop: 0 }}>
        {t.points.map((p) => (
          <li key={p}><span className="material-symbols-outlined">chevron_right</span>{p}</li>
        ))}
      </ul>

      {task.status === "Disputed" ? (
        <div className="td-err">{t.already}</div>
      ) : task.status !== "Settled" ? (
        <div className="td-hint">{t.onlySettled} {t.status}: <b style={{ color: "var(--text-primary)" }}>{task.status}</b></div>
      ) : task.contractTaskId === undefined ? (
        <div className="td-hint">{t.noEscrow}</div>
      ) : (
        <>
          {!connected && <div className="td-hint">{t.connect}</div>}
          {connected && !isPoster && task.poster && <div className="td-hint">{t.notPoster(shortenAddress(task.poster, 5))}</div>}
          {error && <div className="td-err">{error}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 8 }}>
            <button type="button" className="btn-ghost" onClick={onClose}>{t.cancel}</button>
            <button type="button" className="btn-danger" onClick={handleDispute} disabled={!isPoster || loading} style={!isPoster ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>
              {loading ? t.working : t.confirm}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
