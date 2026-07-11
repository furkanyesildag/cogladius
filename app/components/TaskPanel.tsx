"use client";

import { useState, useEffect } from "react";
import { Task } from "@/lib/types";
import { shortenAddress } from "@/lib/constants";

interface TaskPanelProps {
  tasks: Task[];
  onPostTask: () => void;
  onSelectTask: (task: Task) => void;
  onDeleteTask?: (taskId: number) => void;
  onEditTask?: (task: Task) => void;
}

const STATUS_TR: Record<string, string> = {
  Open:             "AÇIK",
  UnderReview:      "İNCELEMEDE",
  AwaitingDecision: "KARAR BEKLENİYOR",
  Settled:          "TAMAMLANDI",
  Disputed:         "İTİRAZDA",
  Resolved:         "ÇÖZÜLDÜ",
  Stopped:          "DURDURULDU",
};

function getStatusColor(status: Task["status"]): string {
  if (status === "UnderReview")      return "var(--yellow)";
  if (status === "AwaitingDecision") return "var(--green)";
  if (status === "Disputed")         return "var(--red)";
  if (status === "Settled")          return "var(--green)";
  if (status === "Resolved")         return "var(--blue)";
  if (status === "Stopped")          return "var(--text-ghost)";
  return "var(--text-muted)";
}

function getStatusBg(status: Task["status"]): string {
  if (status === "UnderReview")      return "var(--yellow-dim)";
  if (status === "AwaitingDecision") return "var(--green-dim)";
  if (status === "Disputed")         return "var(--red-dim)";
  if (status === "Settled")          return "var(--green-dim)";
  if (status === "Resolved")         return "var(--blue-dim)";
  return "transparent";
}

function getBorderColor(status: Task["status"]): string {
  if (status === "Open")             return "var(--text-muted)";
  if (status === "UnderReview")      return "var(--yellow)";
  if (status === "AwaitingDecision") return "var(--green)";
  if (status === "Disputed")         return "var(--red)";
  if (status === "Settled")          return "rgba(64,225,131,0.4)";
  if (status === "Resolved")         return "var(--blue)";
  return "rgba(255,255,255,0.05)";
}

function Countdown({ deadline }: { deadline: number }) {
  const [remaining, setRemaining] = useState("");
  const [urgent, setUrgent] = useState(false);

  useEffect(() => {
    function update() {
      const diff = deadline - Math.floor(Date.now() / 1000);
      if (diff <= 0) { setRemaining("SÜRESI DOLDU"); setUrgent(false); return; }
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setRemaining(`${m}:${s.toString().padStart(2, "0")}`);
      setUrgent(diff < 120);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  return (
    <span style={{ fontFamily: "var(--font)", fontSize: 10, color: urgent ? "var(--yellow)" : "var(--text-ghost)", display: "flex", alignItems: "center", gap: 4 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 11 }}>schedule</span>
      {remaining}
    </span>
  );
}

function EditModal({ task, onSave, onClose }: { task: Task; onSave: (t: Task) => void; onClose: () => void }) {
  const [desc, setDesc]         = useState(task.description);
  const [criteria, setCriteria] = useState(task.criteria);
  const [reward, setReward]     = useState((task.rewardUsdc ?? task.reward / 1_000_000).toString());

  function save() {
    const r = parseFloat(reward) || task.rewardUsdc || 0;
    onSave({ ...task, description: desc.trim(), criteria: criteria.trim(), rewardUsdc: r, reward: Math.floor(r * 1_000_000) });
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--accent)" }}>edit</span>
            <span style={{ fontFamily: "var(--font-head)", fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
              Görev #{task.id} Düzenle
            </span>
          </div>
          <button onClick={onClose}
            style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid var(--bg-border-bright)", borderRadius: 4, cursor: "pointer", color: "var(--text-muted)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>Görev Açıklaması</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} style={{ resize: "vertical" }} />
          </div>
          <div>
            <label style={{ display: "block", fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>Değerlendirme Kriterleri</label>
            <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} rows={2} style={{ resize: "vertical" }} />
          </div>
          <div>
            <label style={{ display: "block", fontFamily: "var(--font)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>Ödül (XLM)</label>
            <input type="number" value={reward} onChange={(e) => setReward(e.target.value)} step="0.0001" min="0.0001" style={{ width: 160 }} />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 4 }}>
            <button onClick={onClose} className="btn-ghost" style={{ fontSize: 11 }}>İptal</button>
            <button onClick={save} disabled={!desc.trim()} className="btn-primary"
              style={{ fontSize: 11, opacity: !desc.trim() ? 0.4 : 1 }}>
              Kaydet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TaskPanel({ tasks, onPostTask, onSelectTask, onDeleteTask, onEditTask }: TaskPanelProps) {
  const [hoveredId, setHoveredId]         = useState<number | null>(null);
  const [editTask, setEditTask]           = useState<Task | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* Header */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--bg-border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, background: "var(--bg-surface-low)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--accent)" }}>assignment</span>
          <span style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.15em", textTransform: "uppercase" }}>
            Görev Kaydı
          </span>
        </div>
        <button className="btn-primary" style={{ padding: "5px 14px", fontSize: 9, gap: 5 }} onClick={onPostTask}>
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>add</span>
          YAYINLA
        </button>
      </div>

      {/* Task list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {tasks.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 36, color: "var(--text-ghost)", display: "block", marginBottom: 12 }}>inbox</span>
            <div style={{ fontFamily: "var(--font)", fontSize: 11, color: "var(--text-ghost)", marginBottom: 16 }}>Henüz görev yok.</div>
            <button onClick={onPostTask} className="btn-accent-ghost" style={{ fontSize: 10 }}>İlk Görevi Yayınla</button>
          </div>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              onClick={() => onSelectTask(task)}
              onMouseEnter={() => setHoveredId(task.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                padding: "12px 14px",
                borderBottom: "1px solid var(--bg-border)",
                cursor: "pointer",
                transition: "background 0.12s",
                background: hoveredId === task.id ? "var(--bg-surface-low)" : "transparent",
                borderLeft: `2px solid ${getBorderColor(task.status)}`,
                position: "relative",
              }}>

              {/* Row 1: id · status badge · reward */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-ghost)", letterSpacing: "0.06em" }}>#{task.id}</span>

                <span style={{
                  fontFamily: "var(--font)", fontSize: 9, letterSpacing: "0.07em",
                  color: getStatusColor(task.status),
                  background: getStatusBg(task.status),
                  padding: "1px 7px", borderRadius: 3,
                  textTransform: "uppercase",
                  display: "inline-block",
                }}>
                  {STATUS_TR[task.status] || task.status}
                </span>

                <span style={{ marginLeft: "auto", fontFamily: "var(--font)", fontSize: 12, color: "var(--accent)", fontWeight: 700 }}>
                  {(task.rewardUsdc ?? task.reward / 1_000_000).toFixed(4)}
                  <span style={{ fontSize: 9, fontWeight: 400, color: "var(--text-muted)", marginLeft: 3 }}>XLM</span>
                </span>

                {/* Hover actions */}
                {hoveredId === task.id && (
                  <div style={{ display: "flex", gap: 4, marginLeft: 6 }} onClick={(e) => e.stopPropagation()}>
                    {(task.status === "Open" || task.status === "Stopped") && onEditTask && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditTask(task); }}
                        title="Düzenle"
                        style={{ width: 24, height: 24, background: "transparent", border: "1px solid var(--bg-border-bright)", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 3, transition: "color 0.15s, border-color 0.15s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.borderColor = "var(--bg-surface-top)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--bg-border-bright)"; }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>edit</span>
                      </button>
                    )}
                    {onDeleteTask && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDelete(task.id); }}
                        title="Sil"
                        style={{ width: 24, height: 24, background: "transparent", border: "1px solid rgba(255,180,171,0.2)", color: "var(--red)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 3, transition: "background 0.15s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--red-dim)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>delete</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Row 2: description */}
              <p style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-primary)", lineHeight: 1.6, marginBottom: 8, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                {task.description}
              </p>

              {/* Row 3: countdown · submissions */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Countdown deadline={task.deadline} />
                <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-ghost)", display: "flex", alignItems: "center", gap: 3 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 11 }}>group</span>
                  {task.submissions.length}
                </span>
                {task.winner && (
                  <span style={{ marginLeft: "auto", fontFamily: "var(--font)", fontSize: 9, color: "var(--green)", display: "flex", alignItems: "center", gap: 3 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 11 }}>emoji_events</span>
                    {shortenAddress(task.winner, 4)}
                  </span>
                )}
                {task.dispute && !task.winner && (
                  <span style={{ marginLeft: "auto", fontFamily: "var(--font)", fontSize: 9, color: "var(--red)" }}>İtiraz</span>
                )}
              </div>

              {/* Row 4: judge scores preview */}
              {task.verdicts.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, paddingTop: 7, borderTop: "1px solid var(--bg-border)" }}>
                  <span style={{ fontFamily: "var(--font)", fontSize: 9, color: "var(--text-ghost)" }}>PUANLAR</span>
                  {[1, 2, 3].map((jid) => {
                    const v = task.verdicts.find((vv) => vv.judgeId === jid);
                    return v
                      ? <span key={jid} style={{ fontFamily: "var(--font)", fontSize: 10, fontWeight: 700, color: v.score >= 70 ? "var(--green)" : "var(--yellow)" }}>{v.score}</span>
                      : <span key={jid} style={{ fontFamily: "var(--font)", fontSize: 10, color: "var(--text-ghost)" }}>—</span>;
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Delete confirm */}
      {confirmDelete !== null && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal-box" style={{ maxWidth: 340 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--red)" }}>warning</span>
              <span style={{ fontFamily: "var(--font-head)", fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Görevi Sil?</span>
            </div>
            <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 24 }}>
              Görev #{confirmDelete} kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmDelete(null)} className="btn-ghost" style={{ fontSize: 11 }}>İptal</button>
              <button onClick={() => { onDeleteTask?.(confirmDelete); setConfirmDelete(null); }} className="btn-danger" style={{ fontSize: 11 }}>Sil</button>
            </div>
          </div>
        </div>
      )}

      {editTask && (
        <EditModal
          task={editTask}
          onSave={(updated) => { onEditTask?.(updated); setEditTask(null); }}
          onClose={() => setEditTask(null)}
        />
      )}
    </div>
  );
}
