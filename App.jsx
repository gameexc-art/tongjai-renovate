import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronDown, LogOut, ChevronLeft, Plus, Send, Check, Clock, FileSpreadsheet,
} from "lucide-react";

/* ============================================================================
   TONGJAI RENOVATE — "TONGJAI BLUEPRINT" design system
   React + Tailwind + lucide-react. Single default-export component.

   Tailwind setup note: this component uses arbitrary-value utilities
   (e.g. bg-[#F6F6F2]) so it works on a stock Tailwind install with no config.
   Drop it into a Vite + Tailwind project and render <App/>.
   The Thai font stack is applied inline via `fontFamily` style.
   ============================================================================ */

const FONT =
  '"LINE Seed Sans TH","IBM Plex Sans Thai","Noto Sans Thai","Anuphan",system-ui,-apple-system,"Segoe UI",sans-serif';
const FONT_NUM = '"IBM Plex Sans","Inter",ui-sans-serif,system-ui,sans-serif';

const num = { fontFamily: FONT_NUM, fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum" 1' };

/* ---------- Pinwheel mark (pure SVG, never recolored) ---------- */
function Pinwheel({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" role="img" aria-label="โลโก้ TONGJAI">
      <g transform="rotate(45 15 15)">
        <rect x="5.2" y="5.2" width="9" height="9" rx="2.4" fill="#E23B33" />
        <rect x="15.8" y="5.2" width="9" height="9" rx="2.4" fill="#2667D6" />
        <rect x="5.2" y="15.8" width="9" height="9" rx="2.4" fill="#2FA45A" />
        <rect x="15.8" y="15.8" width="9" height="9" rx="2.4" fill="#F08A24" />
      </g>
    </svg>
  );
}

/* ---------- Deterministic faux-QR with 3 finder eyes ---------- */
function FauxQR({ size = 44 }) {
  const N = 11;
  const rnd = (i) => { const x = Math.sin(i * 97.13 + 0.5) * 10000; return x - Math.floor(x) > 0.5; };
  const reserved = (r, c) => {
    const inEye = (r0, c0) => r >= r0 - 1 && r < r0 + 4 && c >= c0 - 1 && c < c0 + 4;
    return inEye(0, 0) || inEye(0, N - 3) || inEye(N - 3, 0);
  };
  const dots = [];
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      if (!reserved(r, c) && rnd(r * N + c))
        dots.push(<rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" fill="#15181E" />);
  const Eye = ({ x, y }) => (
    <>
      <rect x={x} y={y} width="3" height="3" fill="#15181E" />
      <rect x={x + 0.6} y={y + 0.6} width="1.8" height="1.8" fill="#fff" />
      <rect x={x + 1.1} y={y + 1.1} width="0.8" height="0.8" fill="#15181E" />
    </>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 11 11" shapeRendering="crispEdges"
         style={{ background: "#fff", padding: 2, borderRadius: 4 }} aria-hidden>
      <rect width="11" height="11" fill="#fff" />
      {dots}
      <Eye x={0} y={0} /><Eye x={N - 3} y={0} /><Eye x={0} y={N - 3} />
    </svg>
  );
}

/* ---------- Money formatting ---------- */
const fmt = (n, dec) =>
  Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });

function CountUp({ value, dec = 2, onSettle }) {
  const [disp, setDisp] = useState("0");
  const ref = useRef();
  // latest onSettle without retriggering the tween; fires exactly once per value
  const settleRef = useRef(onSettle);
  settleRef.current = onSettle;
  useEffect(() => {
    let settled = false;
    const settle = () => { if (!settled) { settled = true; settleRef.current && settleRef.current(); } };
    const reduce = window.matchMedia("(prefers-reduced-motion:reduce)").matches;
    if (reduce) { setDisp(fmt(value, dec)); settle(); return; }
    const dur = 420, start = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - p, 3);
      setDisp(fmt(value * e, dec));
      if (p < 1) ref.current = requestAnimationFrame(step);
      else settle();
    };
    ref.current = requestAnimationFrame(step);
    // safety net for throttled rAF (backgrounded tab): guarantee settle fires
    const settleGuard = setTimeout(settle, 700);
    return () => { cancelAnimationFrame(ref.current); clearTimeout(settleGuard); };
  }, [value, dec]);
  return <span style={num}>{disp}</span>;
}

/* ---------- small atoms ---------- */
// baht glyph stays neutral ink-3 even on money cards (accounting-grade ledger discipline)
const Baht = ({ children = "฿", neg }) => (
  <span style={{ fontSize: "0.78em", fontWeight: 700, color: "#646B75", opacity: neg ? 0.7 : 1, marginRight: 1 }}>
    {children}
  </span>
);

const BADGES = {
  mat: { label: "ค่าของ", t: "#475569", bg: "#EEF1F5", bd: "#DCE2EA" },
  lab: { label: "ค่าแรงช่าง", t: "#185FA5", bg: "#EAF1FC", bd: "#BFD6F4" },
  tra: { label: "ค่าขนส่ง", t: "#0F6E70", bg: "#E3F2F0", bd: "#C7E4E1" },
  adv: { label: "เบิกล่วงหน้า", t: "#5D4BBE", bg: "#EFEBFB", bd: "#DAD2F4" },
};
const TICK = { mat: "#475569", lab: "#185FA5", tra: "#0F6E70", adv: "#5D4BBE" };

function Badge({ kind }) {
  const b = BADGES[kind];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", height: 18, padding: "0 7px",
      borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.02em",
      color: b.t, background: b.bg, border: `1px solid ${b.bd}`, whiteSpace: "nowrap" }}>
      {b.label}
    </span>
  );
}

function StatusIcon({ kind }) {
  if (kind === "paid")
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "#18753F" }}>
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6" fill="#E7F4EC" /><path d="M4 6.6l1.8 1.8L9 4.8" stroke="#18753F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        จ่ายแล้ว
      </span>
    );
  if (kind === "wht")
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "#9C520B" }}>
        <Clock size={12} strokeWidth={1.6} />หัก ณ ที่จ่าย
      </span>
    );
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "#646B75" }}>
      <Clock size={12} strokeWidth={1.4} color="#646B75" />รอจ่าย
    </span>
  );
}

/* ---------- Summary / KPI cards ---------- */
function SummaryCard({ label, children, meta, bar, loss, corner }) {
  const barColor = { green: "#2FA45A", red: "#E23B33", orange: "#F08A24", blue: "#1E5FCC", graphite: "#DBD9D1" }[bar];
  return (
    <div style={{ position: "relative", overflow: "hidden", background: loss ? "rgba(251,234,233,.55)" : "#fff",
      border: "1px solid #DBD9D1", borderRadius: 14,
      boxShadow: "0 1px 2px rgba(21,24,30,.04),0 1px 1px rgba(21,24,30,.03)" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: barColor }} />
      {corner}
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#646B75", display: "flex", justifyContent: "space-between" }}>{label}</div>
        {children}
        <div style={{ fontSize: 12, fontWeight: 500, color: "#646B75", marginTop: 6 }}>{meta}</div>
      </div>
    </div>
  );
}

function KPICard({ label, bar, children, foot }) {
  const barColor = { green: "#2FA45A", red: "#E23B33", orange: "#F08A24", blue: "#1E5FCC", graphite: "#DBD9D1" }[bar];
  return (
    <div style={{ position: "relative", overflow: "hidden", background: "#fff", border: "1px solid #DBD9D1",
      borderRadius: 14, boxShadow: "0 1px 2px rgba(21,24,30,.04),0 1px 1px rgba(21,24,30,.03)", padding: "14px 14px 14px 16px" }}>
      <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 3, background: barColor }} />
      <div style={{ fontSize: 13, fontWeight: 500, color: "#646B75" }}>{label}</div>
      {children}
      {foot}
    </div>
  );
}

/* ---------- Transaction row ---------- */
function TxRow({ date, title, kind, amount, status, isLast }) {
  return (
    <div style={{ minHeight: 64, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 12px 0", borderBottom: isLast ? "none" : "1px solid #EAE7DF" }}>
      <span style={{ width: 4, alignSelf: "stretch", borderRadius: "0 3px 3px 0", flex: "0 0 4px", marginRight: 8, background: TICK[kind] }} />
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: "#646B75", ...num }}>{date}</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#15181E", lineHeight: 1.3, marginTop: 1, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {title} <Badge kind={kind} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 500, color: "#646B75" }}>· สฟ.คลองแงะ</div>
      </div>
      <div style={{ flex: "0 0 auto", textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3, color: "#C8322B", ...num }}>
          <span style={{ opacity: 0.75 }}>−฿</span>{amount}
        </div>
        <StatusIcon kind={status} />
      </div>
    </div>
  );
}

/* ===========================================================================
   SCREEN A — FINANCE
   =========================================================================== */
function ScreenA({ sendPrompt }) {
  const rows = [
    { date: "2026-06-11", title: "ซื้อของสำหรับใช้หน้างาน", kind: "mat", amount: "1,500.00", status: "paid" },
    { date: "2026-06-11", title: "ซื้อทรายสำหรับใช้หน้างาน", kind: "mat", amount: "1,000.00", status: "paid" },
    { date: "2026-06-11", title: "ค่าแรงเชื่อมเหล็ก", kind: "lab", amount: "5,000.00", status: "wht" },
    { date: "2026-06-11", title: "ค่าปูนซีเมนต์", kind: "mat", amount: "2,400.00", status: "paid" },
    { date: "2026-06-11", title: "ค่าขนส่งวัสดุ", kind: "tra", amount: "1,800.00", status: "paid" },
    { date: "2026-06-11", title: "เบิกล่วงหน้าค่าแรง", kind: "adv", amount: "8,000.00", status: "wht" },
    { date: "2026-06-11", title: "ค่าเช่านั่งร้าน", kind: "mat", amount: "3,200.00", status: "pending" },
  ];
  const filters = [
    { icon: "📋", label: "ทั้งหมด", key: "all" },
    { icon: "💚", label: "รายรับ", key: "income" },
    { icon: "🔴", label: "รายจ่าย", key: "expense" },
    { icon: "📊", label: "สรุปภาษี", key: "tax" },
  ];
  const [activeFilter, setActiveFilter] = useState(0);
  const [lossSettled, setLossSettled] = useState(false);
  // all/expense → every demo row (they are all expenses); tax → only
  // "หัก ณ ที่จ่าย" rows; income → none (the bot records expenses only)
  const fkey = filters[activeFilter].key;
  const visible = fkey === "all" || fkey === "expense" ? rows
    : fkey === "tax" ? rows.filter((r) => r.status === "wht")
    : [];
  return (
    <section aria-label="การเงินโครงการ">
      <h2 className="sr-only">สรุปการเงินโครงการ: รายจ่ายสุทธิ 141,520.60 บาท ขาดทุน</h2>
      {/* breadcrumb */}
      <div style={{ height: 32, display: "flex", alignItems: "center", gap: 6, padding: "0 16px",
        background: "#FBFAF7", borderBottom: "1px solid #EAE7DF", fontSize: 12, fontWeight: 500, color: "#646B75" }}>
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1 12L12 1M3.5 12V9.5M6 12V8M8.5 12V10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
        <span>รายการล่าสุด <span style={num}>2026-06-11</span></span><span style={{ opacity: 0.5 }}>·</span><span>แตะปุ่มกรองเพื่อเลือกดู</span>
      </div>

      <div style={{ padding: "0 16px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 20, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.35, letterSpacing: "-0.01em", color: "#15181E", display: "flex", alignItems: "center", gap: 7, margin: 0 }}>💰 การเงินโครงการ</h1>
          <div style={{ display: "flex", gap: 10 }}>
            <Pill color="green" onClick={() => sendPrompt("เพิ่มรายรับ")}>+ รายรับ</Pill>
            <Pill color="red" onClick={() => sendPrompt("เพิ่มรายจ่าย")}>+ รายจ่าย</Pill>
          </div>
        </div>

        {/* summary grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 20 }}>
          <SummaryCard label="รายรับสุทธิ" bar="green" meta="หลังหักภาษี">
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2, letterSpacing: "-0.02em", color: "#15181E", marginTop: 8, display: "flex", alignItems: "baseline" }}><Baht /><CountUp value={0} /></div>
          </SummaryCard>
          <SummaryCard label="รายจ่ายสุทธิ" bar="red" meta="หลังหัก ณ ที่จ่าย">
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2, letterSpacing: "-0.02em", color: "#C8322B", marginTop: 8, display: "flex", alignItems: "baseline" }}><Baht neg /><CountUp value={141520.6} /></div>
          </SummaryCard>
          <SummaryCard label="กำไร / ขาดทุน" bar="red" loss meta="รายรับ − รายจ่าย">
            {/* loss magnitude tweens, ▼ reveals only on settle = the "count down into red" felt moment */}
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2, letterSpacing: "-0.02em", color: "#C8322B", marginTop: 8, display: "flex", alignItems: "baseline", gap: 4 }}>
              <span aria-hidden="true" style={{ opacity: lossSettled ? 1 : 0, transition: "opacity .25s cubic-bezier(.22,.61,.36,1)" }}>▼</span>
              <Baht neg>−฿</Baht><CountUp value={141520.6} onSettle={() => setLossSettled(true)} />
            </div>
          </SummaryCard>
          <SummaryCard label="รายการทั้งหมด" bar="orange" meta="ทั้งรายรับและรายจ่าย"
            corner={<span aria-hidden="true" style={{ position: "absolute", top: 10, right: 12, color: "#9C520B", fontSize: 13, lineHeight: 1 }}>📊</span>}>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2, letterSpacing: "-0.02em", color: "#15181E", marginTop: 8, display: "flex", alignItems: "baseline" }}>
              <CountUp value={25} dec={0} /><span style={{ fontSize: 13, fontWeight: 500, color: "#646B75", marginLeft: 5, alignSelf: "flex-end", paddingBottom: 3 }}>รายการ</span>
            </div>
          </SummaryCard>
        </div>

        {/* filters — plain toggle buttons (aria-pressed), not ARIA tabs */}
        <div role="group" aria-label="ตัวกรองรายการ" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "2px 0 4px", marginTop: 4 }}>
          {filters.map((f, i) => (
            <button key={f.label} type="button" aria-pressed={activeFilter === i} onClick={() => setActiveFilter(i)}
              style={{ position: "relative", flex: "0 0 auto", height: 36, padding: "0 14px", border: "none", borderRadius: 999,
                background: activeFilter === i ? "#EAF1FC" : "#FBFAF7", color: activeFilter === i ? "#1E5FCC" : "#646B75",
                fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              <span aria-hidden="true">{f.icon}</span> {f.label}
              {activeFilter === i && <span style={{ position: "absolute", left: 14, right: 14, bottom: 4, height: 2, background: "#1E5FCC", borderRadius: 2 }} />}
            </button>
          ))}
        </div>

        {/* transactions */}
        {visible.length > 0 && (
          <div style={{ fontSize: 12, fontWeight: 700, color: "#646B75", padding: "14px 2px 8px", ...num }}>2026-06-11</div>
        )}
        <div style={{ background: "#fff", border: "1px solid #DBD9D1", borderRadius: 14, boxShadow: "0 1px 2px rgba(21,24,30,.04),0 1px 1px rgba(21,24,30,.03)", overflow: "hidden", marginTop: visible.length === 0 ? 14 : 0 }}>
          {visible.map((r, i) => (
            <TxRow key={r.title} {...r} isLast={i === visible.length - 1} />
          ))}
          {visible.length === 0 && (
            <div role="status" style={{ padding: "26px 16px", textAlign: "center", fontSize: 13, fontWeight: 500, color: "#646B75" }}>
              ไม่มีรายการรายรับในช่วงนี้ — บอทบันทึกรายจ่ายเท่านั้น
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Pill({ color, children, onClick }) {
  const bg = color === "green" ? "#178045" : "#E23B33";
  return (
    <button onClick={onClick}
      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(.97)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      style={{ height: 40, padding: "0 14px", border: "none", borderRadius: 10, background: bg,
        fontFamily: FONT, fontSize: 14, fontWeight: 700, color: "#fff", cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", transition: "transform .09s" }}>
      {children}
    </button>
  );
}

/* ===========================================================================
   SCREEN B — CHAT (dark)
   =========================================================================== */
function ChatBtn({ children, dim, onClick }) {
  return (
    <button onClick={onClick}
      style={{ flex: 1, minHeight: 44, border: "none", borderRadius: 10, background: "#1F9D57", color: "#fff",
        fontFamily: FONT, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", lineHeight: 1.25, padding: "6px 10px" }}>
      {children}
      {dim && <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.78 }}>{dim}</span>}
    </button>
  );
}

function ScreenB({ sendPrompt, goBack, showToast }) {
  // live demo messages appended after the scripted transcript
  const [extra, setExtra] = useState([]);
  const [draft, setDraft] = useState("");
  const timeNow = () => new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    sendPrompt(text);
    setExtra((xs) => [...xs, { side: "right", text, time: timeNow() }]);
    setDraft("");
    setTimeout(() => {
      // same reply the real LINE bot gives for a text message
      setExtra((xs) => [...xs, { side: "left", text: "ส่งรูปสลิป/ใบเสร็จมาได้เลยครับ แล้วผมจะอ่านยอด ผู้รับ วันที่ และเลขอ้างอิงให้อัตโนมัติ 📸", time: timeNow() }]);
    }, 600);
  };
  return (
    <section aria-label="แชทบอท NONEAICE">
      <h2 className="sr-only">แชทบอท NONEAICE สำหรับบันทึกใบเสร็จ</h2>
      <div style={{ background: "#0F1217", minHeight: "100%", display: "flex", flexDirection: "column" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#1A1F27",
          boxShadow: "0 2px 8px rgba(21,24,30,.06)", position: "sticky", top: 0, zIndex: 5 }}>
          <button onClick={goBack} aria-label="ย้อนกลับ" style={{ background: "none", border: "none", color: "#A7AEB8", cursor: "pointer", display: "flex", padding: 4, marginLeft: -4 }}>
            <ChevronLeft size={20} />
          </button>
          <span style={{ position: "relative", width: 28, height: 28, borderRadius: 8, background: "#1E5FCC", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 28px", boxShadow: "0 0 0 2px rgba(30,95,204,.30)" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="5" width="12" height="9" rx="2.5" fill="#fff" /><circle cx="5.5" cy="9.2" r="1.2" fill="#1E5FCC" /><circle cx="10.5" cy="9.2" r="1.2" fill="#1E5FCC" /><circle cx="8" cy="1.6" r="1" fill="#fff" /><path d="M8 2.6v2" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" /></svg>
            <span style={{ position: "absolute", right: -2, bottom: -2, width: 9, height: 9, borderRadius: "50%", background: "#2FA45A", border: "2px solid #1A1F27" }} />
          </span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "#ECEEF1" }}>NONEAICE</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: "#A7AEB8" }}>บอทบันทึกใบเสร็จ · ออนไลน์</span>
          </span>
        </div>

        {/* body */}
        <div style={{ flex: "1 1 auto", padding: "16px 14px 8px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ alignSelf: "center", background: "#232A34", color: "#A7AEB8", fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 999 }}>วันนี้</div>

          {/* user slip */}
          <div style={{ display: "flex", flexDirection: "column", maxWidth: "78%", gap: 4, alignSelf: "flex-end", alignItems: "flex-end" }}>
            <div style={{ background: "#fff", borderRadius: 10, boxShadow: "0 12px 32px rgba(21,24,30,.14)", width: 268, maxWidth: "100%", overflow: "hidden" }}>
              <div style={{ height: 8, background: "radial-gradient(circle at 6px 8px,transparent 0 4px,#fff 4px) 0 0/12px 8px repeat-x,#0F1217" }} />
              <div style={{ padding: "12px 14px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 26, height: 26, borderRadius: 6, background: "#E7F4EC", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 26px" }}>☕</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#15181E", flex: "1 1 auto" }}>Starbucks Coffee</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: "#18753F", background: "#E7F4EC", border: "1px solid #BFE3CC", padding: "1px 7px", borderRadius: 999 }}>✓ โอนเงินสำเร็จ</span>
                </div>
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "auto 1fr", gap: "5px 10px", fontSize: 11.5 }}>
                  <span style={{ color: "#646B75", fontWeight: 500 }}>บัญชี</span><span style={{ color: "#3C424C", fontWeight: 600, textAlign: "right", ...num, wordBreak: "break-all" }}>000002213438161</span>
                  <span style={{ color: "#646B75", fontWeight: 500 }}>อ้างอิง</span><span style={{ color: "#3C424C", fontWeight: 600, textAlign: "right", ...num, wordBreak: "break-all" }}>47845792ZUMQTD000000</span>
                  <span style={{ color: "#646B75", fontWeight: 500 }}>เลขที่รายการ</span><span style={{ color: "#3C424C", fontWeight: 600, textAlign: "right", ...num, wordBreak: "break-all" }}>016166110142CPM13108</span>
                </div>
                <hr style={{ border: "none", borderTop: "0.5px dashed #DBD9D1", margin: "12px 0 10px" }} />
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#646B75" }}>จำนวน</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "#15181E", ...num }}>300.00 บาท</span>
                </div>
                <div style={{ fontSize: 11.5, color: "#646B75", fontWeight: 500, marginTop: 4, display: "flex", justifyContent: "space-between" }}>
                  <span>ค่าธรรมเนียม</span><span style={num}>0.00 บาท</span>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}><FauxQR /></div>
              </div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 500, color: "#A7AEB8", ...num, display: "flex", alignItems: "center", gap: 3 }}>
              12:04 <svg width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 5.2l2.4 2.4L8 3M6 5.2l2.4 2.4L13 3" stroke="#1E5FCC" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
          </div>

          {/* bot parsed receipt */}
          <div style={{ display: "flex", flexDirection: "column", maxWidth: "78%", gap: 4, alignSelf: "flex-start" }}>
            <div style={{ position: "relative", background: "#1A1F27", border: "1px solid #2C333E", borderRadius: 18, borderTopLeftRadius: 6, padding: "12px 14px 12px 16px", color: "#ECEEF1", fontSize: 14 }}>
              <span style={{ position: "absolute", left: 0, top: 10, bottom: 10, width: 3, background: "#1E5FCC", borderRadius: 3 }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: "#A7AEB8", display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#2FA45A" }} />ใบเสร็จ <span style={{ color: "#2FA45A" }}>✓</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 7, padding: "3px 0", ...num }}>💰 <span><span style={{ color: "#2FA45A", fontWeight: 700 }}>฿</span>300.00</span></div>
              <div style={{ fontSize: 13, fontWeight: 500, padding: "3px 0" }}>📝 ชำระค่าบริการ</div>
              <div style={{ fontSize: 13, fontWeight: 500, padding: "3px 0" }}>🏢 Starbucks Coffee</div>
              <div style={{ fontSize: 13, fontWeight: 500, padding: "3px 0", ...num }}>📅 2026-06-15</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <ChatBtn onClick={() => sendPrompt("บุคคล")}>👤 บุคคล</ChatBtn>
                <ChatBtn onClick={() => sendPrompt("บริษัท")}>🏢 บริษัท</ChatBtn>
              </div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 500, color: "#A7AEB8", ...num }}>12:05</span>
          </div>

          {/* bot prompt */}
          <div style={{ display: "flex", flexDirection: "column", maxWidth: "78%", gap: 4, alignSelf: "flex-start" }}>
            <div style={{ background: "#1A1F27", border: "1px solid #2C333E", borderRadius: 18, borderTopLeftRadius: 6, padding: "12px 14px", color: "#ECEEF1" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>เลือกประเภทค่าจ่าย:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                <ChatBtn dim="(บันทึกเป็นรายจ่าย)" onClick={() => sendPrompt("ค่าของ")}>📦 ค่าของ</ChatBtn>
                <ChatBtn dim="(หัก ณ ที่จ่าย)" onClick={() => sendPrompt("ค่าแรง")}>💼 ค่าแรง</ChatBtn>
              </div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 500, color: "#A7AEB8", ...num }}>12:05</span>
          </div>

          {/* success */}
          <div style={{ display: "flex", flexDirection: "column", maxWidth: "78%", gap: 4, alignSelf: "flex-start" }}>
            <div style={{ background: "#143524", border: "1px solid #1F6E42", color: "#7FE3AA", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, borderRadius: 18, borderTopLeftRadius: 6, padding: "12px 14px" }}>
              <Check size={18} color="#7FE3AA" /> บันทึกเป็นใบรับรองแทนแล้วครับ
            </div>
            <span style={{ fontSize: 11, fontWeight: 500, color: "#A7AEB8", ...num }}>12:06</span>
          </div>

          {/* live demo messages */}
          {extra.map((m, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", maxWidth: "78%", gap: 4, alignSelf: m.side === "right" ? "flex-end" : "flex-start", alignItems: m.side === "right" ? "flex-end" : "flex-start" }}>
              <div style={{ background: m.side === "right" ? "#1F2630" : "#1A1F27", border: m.side === "right" ? "1px solid transparent" : "1px solid #2C333E", borderRadius: 18, borderTopLeftRadius: m.side === "left" ? 6 : 18, borderBottomRightRadius: m.side === "right" ? 6 : 18, padding: "12px 14px", color: "#ECEEF1", fontSize: 14 }}>{m.text}</div>
              <span style={{ fontSize: 11, fontWeight: 500, color: "#A7AEB8", ...num }}>{m.time}</span>
            </div>
          ))}
        </div>

        {/* input — functional demo mirroring the real bot's text handler */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", paddingBottom: "calc(10px + env(safe-area-inset-bottom))", background: "#1A1F27", borderTop: "1px solid #2C333E" }}>
          <button aria-label="แนบไฟล์" onClick={() => { sendPrompt("แนบสลิป"); showToast("เดโม — ส่งสลิปได้ที่บอท LINE NONEAICE ตัวจริง"); }} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: "#232A34", color: "#A7AEB8", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 36px", cursor: "pointer" }}><Plus size={18} /></button>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="พิมพ์ข้อความ หรือส่งสลิป…" aria-label="พิมพ์ข้อความ"
            style={{ flex: "1 1 auto", height: 38, borderRadius: 999, background: "#232A34", border: "1px solid #2C333E", padding: "0 14px", fontSize: 13, color: "#ECEEF1", fontFamily: FONT, outline: "none" }} />
          <button aria-label="ส่ง" onClick={send} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: "#1E5FCC", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 36px", cursor: "pointer" }}><Send size={16} /></button>
        </div>
      </div>
    </section>
  );
}

/* ===========================================================================
   SCREEN C — GANTT
   =========================================================================== */
/* month-switchable Gantt windows. `today` is null for a month the plumb line
   is not in (the future) — every bar there renders planned-blue. */
const GANTT = {
  6: {
    days: [14, 15, 16, 17, 18, 19, 20, 21, 22], today: 17,
    tasks: [
      { name: "Scania Building", range: "06-14 → 06-15", w: "5.00", crit: false, s: 14, e: 15 },
      { name: "Scania Building", range: "06-15 → 06-16", w: "3.00", crit: false, s: 15, e: 16 },
      { name: "Scania Roof Drain", range: "06-14 → 06-20", w: "12.00", crit: true, s: 14, e: 20 },
      { name: "Scania Building", range: "06-17 → 06-19", w: "8.00", crit: false, s: 17, e: 19 },
      { name: "Scania Roof Drain", range: "06-16 → 06-21", w: "6.00", crit: false, s: 16, e: 21 },
      { name: "Scania Electrical", range: "06-18 → 06-22", w: "4.00", crit: false, s: 18, e: 22 },
      { name: "Scania Building", range: "06-19 → 06-22", w: "7.00", crit: false, s: 19, e: 22 },
    ],
  },
  7: {
    days: [1, 2, 3, 4, 5, 6, 7, 8, 9], today: null,
    tasks: [
      { name: "Scania Roof Drain", range: "06-28 → 07-04", w: "6.00", crit: true, s: 1, e: 4 },
      { name: "Scania Electrical", range: "07-01 → 07-06", w: "5.00", crit: false, s: 1, e: 6 },
      { name: "Scania Painting", range: "07-03 → 07-09", w: "4.00", crit: false, s: 3, e: 9 },
      { name: "Scania Building", range: "07-05 → 07-09", w: "7.00", crit: false, s: 5, e: 9 },
    ],
  },
};
const DAYW = 26;
const FROZEN_W = 130 + 44 + 44;

function GanttRow({ tk, days, today }) {
  const px = (day) => (day - days[0]) * DAYW;
  const axisW = days.length * DAYW;
  const overdue = today !== null && tk.s < today ? { left: px(tk.s) + 2, width: (Math.min(tk.e, today - 1) - tk.s + 1) * DAYW - 4 } : null;
  const planned = today === null || tk.e >= today
    ? (() => { const ps = today === null ? tk.s : Math.max(tk.s, today); return { left: px(ps) + 2, width: (tk.e - ps + 1) * DAYW - 4, dot: today === null || tk.s >= today }; })()
    : null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "130px 44px 44px 1fr", alignItems: "stretch", borderBottom: "1px solid #EAE7DF", position: "relative", zIndex: 1 }}>
      <div style={{ position: "sticky", left: 0, background: "#fff", zIndex: 3, borderRight: "1px solid #EAE7DF", padding: 8, display: "flex", flexDirection: "column", justifyContent: "center", minHeight: 46 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#15181E", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tk.name}</div>
        <div style={{ fontSize: 11, fontWeight: 500, color: "#646B75", ...num, marginTop: 2 }}>{tk.range}</div>
      </div>
      <div style={{ position: "sticky", left: 130, background: "#fff", zIndex: 2, borderRight: "1px solid #EAE7DF", padding: 8, display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
        <span style={{ fontSize: 13, fontWeight: tk.crit ? 800 : 600, color: tk.crit ? "#15181E" : "#3C424C", ...num }}>{tk.w}</span>
      </div>
      <div style={{ position: "sticky", left: 174, background: "#fff", zIndex: 2, borderRight: "1px solid #DBD9D1", padding: 8, display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#C8322B", ...num }}>0.00</span>
      </div>
      <div style={{ padding: 0 }}>
        <div style={{ position: "relative", height: 46, display: "flex", width: axisW }}>
          {days.map((d) => (
            <span key={d} style={{ width: DAYW, flex: `0 0 ${DAYW}px`, borderLeft: "1px dotted #EAE7DF",
              background: today !== null && d === today ? "rgba(226,59,51,.06)" : today !== null && d < today ? "rgba(0,0,0,.012)" : "transparent" }} />
          ))}
          {overdue && (
            <div style={{ position: "absolute", top: 13, height: 20, borderRadius: 6, left: overdue.left, width: overdue.width, background: "transparent", border: "1.5px solid #E23B33", display: "flex", alignItems: "center" }}>
              <span style={{ width: 6, height: 6, borderRadius: 2, marginLeft: 3, background: "#E23B33" }} />
            </div>
          )}
          {planned && (
            <div style={{ position: "absolute", top: 13, height: 20, borderRadius: 6, left: planned.left, width: planned.width, background: "#EAF1FC", border: "1px solid #2E7DD1", display: "flex", alignItems: "center" }}>
              {planned.dot && <span style={{ width: 6, height: 6, borderRadius: 2, marginLeft: 3, background: "#2667D6" }} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScreenC({ showToast }) {
  const scrollRef = useRef();
  const [month, setMonth] = useState(6);
  const cfg = GANTT[month];
  const scrollToday = useCallback(() => {
    // "today" lives in the June window — switch there first if needed
    setMonth(6);
    const sc = scrollRef.current; if (!sc) return;
    const june = GANTT[6];
    // center of the today CELL, positioned mid of the VISIBLE axis area (the
    // sticky ledger columns permanently cover the left FROZEN_W px of the view)
    const lineX = (june.today - june.days[0]) * DAYW + DAYW / 2;
    const target = lineX - (sc.clientWidth - FROZEN_W) / 2;
    const reduce = window.matchMedia("(prefers-reduced-motion:reduce)").matches;
    sc.scrollTo({ left: Math.max(0, target), behavior: reduce ? "auto" : "smooth" });
  }, []);
  useEffect(() => { const t = setTimeout(scrollToday, 60); return () => clearTimeout(t); }, [scrollToday]);
  const tabs = [
    { icon: "📊", label: "แผนงาน" },
    { icon: "📈", label: "ความก้าวหน้า" },
    { icon: "🗺", label: "รายงาน" },
  ];
  const [activeTab, setActiveTab] = useState(0);
  const exportCsv = () => {
    const rows = [["รายการงาน", "ช่วงงาน", "น้ำหนัก", "%จริง", "สถานะ"]];
    cfg.tasks.forEach((tk) => {
      rows.push([tk.name, tk.range.replace(/→/g, "->"), tk.w, "0.00", cfg.today !== null && tk.s < cfg.today ? "ล่าช้า" : "ตามแผน"]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    // UTF-8 BOM so Excel opens Thai text correctly
    const blob = new Blob([String.fromCharCode(0xfeff) + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tongjai-plan-2026-0${month}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    showToast("ดาวน์โหลดแผนงานเป็น CSV แล้ว 📥");
  };
  // planned share of each task that should be done by "today" (June window)
  const planPct = (tk) => {
    const june = GANTT[6];
    const total = tk.e - tk.s + 1;
    return Math.round(Math.min(Math.max(june.today - tk.s, 0), total) / total * 100);
  };

  return (
    <section aria-label="แผนงาน Gantt">
      <h2 className="sr-only">แผนงานโครงการ Scania HDY: แผนสะสม 24.4% จริงสะสม 0% ล่าช้า</h2>
      <div style={{ padding: "0 16px 24px" }}>
        {/* project header */}
        <div style={{ position: "relative", overflow: "hidden", background: "#fff", border: "1px solid #DBD9D1", borderRadius: 14, boxShadow: "0 1px 2px rgba(21,24,30,.04)", marginTop: 20 }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#1E5FCC" }} />
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.35, color: "#15181E", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>Scania HDY — ปรับปรุงอาคารและระบบระบายน้ำหลังคา</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "#646B75", marginTop: 8, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
              <span>📍 Scania · หาดใหญ่</span><span style={{ opacity: 0.5 }}>·</span>
              <span style={num}>2026-06-01 → 2026-07-22</span><span style={{ opacity: 0.5 }}>·</span>
              <span style={{ fontWeight: 600, color: "#3C424C", ...num }}>45 วัน</span>
            </div>
          </div>
        </div>

        {/* tabs */}
        <div role="group" aria-label="มุมมองแผนงาน" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "4px 0", marginTop: 16, alignItems: "center" }}>
          {tabs.map((t, i) => (
            <button key={t.label} type="button" aria-pressed={activeTab === i} onClick={() => setActiveTab(i)}
              style={{ position: "relative", flex: "0 0 auto", height: 36, padding: "0 13px", border: "none", borderRadius: 999,
                background: activeTab === i ? "#EAF1FC" : "#FBFAF7", color: activeTab === i ? "#1E5FCC" : "#646B75",
                fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              <span aria-hidden="true">{t.icon}</span> {t.label}{activeTab === i && <span style={{ position: "absolute", left: 13, right: 13, bottom: 4, height: 2, background: "#1E5FCC", borderRadius: 2 }} />}
            </button>
          ))}
          <button type="button" onClick={exportCsv} style={{ flex: "0 0 auto", marginLeft: "auto", height: 36, padding: "0 13px", border: "none", borderRadius: 10, background: "#E7F4EC", color: "#18753F", fontFamily: FONT, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
            <FileSpreadsheet size={13} aria-hidden /> Excel
          </button>
        </div>

        {/* KPI grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
          <KPICard label="แผนสะสม" bar="blue" foot={<div style={{ height: 3, borderRadius: 3, background: "#BFD6F4", marginTop: 8, overflow: "hidden" }}><div style={{ height: "100%", width: "24.4%", background: "#1E5FCC", borderRadius: 3 }} /></div>}>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, letterSpacing: "-0.02em", marginTop: 6, color: "#1E5FCC", display: "flex", alignItems: "flex-end", gap: 4, ...num }}>24.4<span style={{ fontSize: 13, fontWeight: 500, color: "#646B75", fontFamily: FONT, paddingBottom: 2 }}>%</span></div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "#646B75", marginTop: 5 }}>ณ วันนี้</div>
          </KPICard>
          <KPICard label="จริงสะสม" bar="red" foot={<div style={{ display: "inline-flex", alignItems: "center", gap: 3, marginTop: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.02em", color: "#C8322B", background: "#FBEAE9", border: "1px solid #F0C9C7", padding: "2px 8px", borderRadius: 6 }}>▼ ล่าช้า</div>}>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, letterSpacing: "-0.02em", marginTop: 6, color: "#15181E", display: "flex", alignItems: "flex-end", gap: 4, ...num }}>0<span style={{ fontSize: 13, fontWeight: 500, color: "#646B75", fontFamily: FONT, paddingBottom: 2 }}>%</span></div>
          </KPICard>
          <KPICard label="จำนวนงาน" bar="orange" foot={<div style={{ fontSize: 12, fontWeight: 500, color: "#646B75", marginTop: 5 }}>🗂 ทั้งโครงการ</div>}>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, letterSpacing: "-0.02em", marginTop: 6, color: "#9C520B", display: "flex", alignItems: "flex-end", gap: 4, ...num }}>13<span style={{ fontSize: 13, fontWeight: 500, color: "#646B75", fontFamily: FONT, paddingBottom: 2 }}>รายการ</span></div>
          </KPICard>
          <KPICard label="ระยะเวลา" bar="graphite" foot={<div style={{ fontSize: 12, fontWeight: 500, color: "#646B75", marginTop: 5, ...num }}>ตั้งแต่ 2026-06-01</div>}>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, letterSpacing: "-0.02em", marginTop: 6, color: "#15181E", display: "flex", alignItems: "flex-end", gap: 4, ...num }}>45<span style={{ fontSize: 13, fontWeight: 500, color: "#646B75", fontFamily: FONT, paddingBottom: 2 }}>วัน</span></div>
          </KPICard>
        </div>

        {/* Gantt view */}
        {activeTab === 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ background: "#fff", border: "1px solid #DBD9D1", borderRadius: 14, boxShadow: "0 1px 2px rgba(21,24,30,.04)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "14px 14px 10px" }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#15181E", display: "flex", alignItems: "center", gap: 6 }}>📊 ตาราง Gantt แผนงาน</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div role="group" aria-label="เลือกเดือน" style={{ display: "inline-flex", background: "#FBFAF7", borderRadius: 10, padding: 3, gap: 2 }}>
                  {[{ key: 6, m: "6/26", aria: "มิถุนายน 2026" }, { key: 7, m: "7/26", aria: "กรกฎาคม 2026" }].map((mo) => (
                    <button key={mo.key} type="button" aria-pressed={month === mo.key} aria-label={mo.aria} onClick={() => setMonth(mo.key)} style={{ border: "none", background: month === mo.key ? "#15181E" : "transparent", color: month === mo.key ? "#fff" : "#646B75", fontFamily: FONT_NUM, fontSize: 12, fontWeight: 600, padding: "4px 8px", borderRadius: 7, cursor: "pointer" }}>{mo.m}</button>
                  ))}
                </div>
                <button type="button" onClick={scrollToday} style={{ border: "none", background: "none", color: "#1E5FCC", fontFamily: FONT, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3, padding: "5px 6px", borderRadius: 10 }}><span aria-hidden="true">📍</span> วันนี้</button>
              </div>
            </div>

            <div ref={scrollRef} style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", position: "relative" }}>
              <div style={{ display: "grid", minWidth: FROZEN_W + cfg.days.length * DAYW, position: "relative" }}>
                <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(#DBD9D1 .8px,transparent .8px)", backgroundSize: "24px 24px", opacity: 0.45, pointerEvents: "none" }} />
                {/* head */}
                <div style={{ display: "grid", gridTemplateColumns: "130px 44px 44px 1fr", borderBottom: "1px solid #DBD9D1", background: "#fff", position: "relative", zIndex: 1 }}>
                  <div style={{ position: "sticky", left: 0, background: "#fff", zIndex: 3, borderRight: "1px solid #EAE7DF", padding: 8, fontSize: 11, fontWeight: 600, color: "#646B75", display: "flex", alignItems: "center", minHeight: 46 }}>รายการงาน</div>
                  <div style={{ position: "sticky", left: 130, background: "#fff", zIndex: 2, borderRight: "1px solid #EAE7DF", padding: 8, fontSize: 11, fontWeight: 600, color: "#646B75", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>น้ำหนัก</div>
                  <div style={{ position: "sticky", left: 174, background: "#fff", zIndex: 2, borderRight: "1px solid #DBD9D1", padding: 8, fontSize: 11, fontWeight: 600, color: "#646B75", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>%จริง</div>
                  <div style={{ display: "flex" }}>
                    {cfg.days.map((d) => (
                      <span key={d} style={{ width: DAYW, flex: `0 0 ${DAYW}px`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: cfg.today !== null && d === cfg.today ? 800 : 600, color: cfg.today !== null && d === cfg.today ? "#C8322B" : "#646B75", ...num, borderLeft: "1px dotted #EAE7DF", opacity: cfg.today !== null && d < cfg.today ? 0.5 : 1 }}>{d}</span>
                    ))}
                  </div>
                </div>
                {cfg.tasks.map((tk, i) => <GanttRow key={`${month}-${i}`} tk={tk} days={cfg.days} today={cfg.today} />)}
                {/* today plumb line — aligned to the LEFT edge of the today cell (all blue planned
                    bars sit right of it, all hollow-red overdue bars left); zIndex 1 keeps it behind
                    the frozen ledger columns; single .today-line class owns the breathe animation.
                    Rendered only for the month "today" actually falls in. */}
                {cfg.today !== null && (
                  <div className="today-line" style={{ position: "absolute", top: 0, bottom: 0, left: FROZEN_W + (cfg.today - cfg.days[0]) * DAYW, width: 0, borderLeft: "2px dashed #E23B33", zIndex: 1 }}>
                    <span style={{ position: "absolute", top: -1, transform: "translateX(-50%)", background: "#E23B33", color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: "0 0 6px 6px", whiteSpace: "nowrap" }}>วันนี้</span>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "10px 14px 14px", borderTop: "1px solid #EAE7DF" }}>
              <Leg><span style={{ width: 14, height: 10, borderRadius: 3, background: "#EAF1FC", border: "1px solid #2E7DD1" }} />วางแผน</Leg>
              <Leg><span style={{ width: 14, height: 10, borderRadius: 3, background: "transparent", border: "1.5px solid #E23B33" }} />ล่าช้า / ยังไม่ทำ</Leg>
              {cfg.today !== null && <Leg><span style={{ width: 0, height: 14, borderLeft: "2px dashed #E23B33" }} />วันนี้ (17)</Leg>}
              <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "#C8322B", ...num }}>จริง 0% · ล่าช้า</span>
            </div>
          </div>
        </div>
        )}

        {/* Progress view — planned share vs actual per task (June window) */}
        {activeTab === 1 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ background: "#fff", border: "1px solid #DBD9D1", borderRadius: 14, boxShadow: "0 1px 2px rgba(21,24,30,.04)", overflow: "hidden" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#15181E", display: "flex", alignItems: "center", gap: 6, padding: "14px 14px 10px" }}>📈 ความก้าวหน้า (แผน vs จริง)</div>
            {GANTT[6].tasks.map((tk, i) => {
              const p = planPct(tk);
              return (
                <div key={i} style={{ padding: "12px 14px", borderTop: "1px solid #EAE7DF" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#15181E", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tk.name} <span style={{ fontSize: 11, fontWeight: 500, color: "#646B75", ...num }}>{tk.range}</span></span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#C8322B", whiteSpace: "nowrap", ...num }}>แผน {p}% · จริง 0%</span>
                  </div>
                  <div role="img" aria-label={`แผน ${p}% จริง 0%`} style={{ height: 6, borderRadius: 3, background: "#FBFAF7", border: "1px solid #EAE7DF", marginTop: 8, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${p}%`, background: "#1E5FCC", borderRadius: 3 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )}

        {/* Report view — project summary */}
        {activeTab === 2 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ background: "#fff", border: "1px solid #DBD9D1", borderRadius: 14, boxShadow: "0 1px 2px rgba(21,24,30,.04)", overflow: "hidden" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#15181E", display: "flex", alignItems: "center", gap: 6, padding: "14px 14px 10px" }}>🗺 รายงานสรุปโครงการ</div>
            {[
              ["โครงการ", "Scania HDY", false, true],
              ["ช่วงดำเนินการ", "2026-06-01 → 2026-07-22", false, false],
              ["งานทั้งโครงการ", "13 รายการ (45 วัน)", false, false],
              ["งานในช่วงที่แสดง", `${GANTT[6].tasks.length} รายการ · น้ำหนักรวม ${GANTT[6].tasks.reduce((a, t) => a + parseFloat(t.w), 0).toFixed(2)}`, false, false],
              ["แผนสะสม ณ วันนี้", "24.4%", false, false],
              ["ผลงานจริงสะสม", "0% · ▼ ล่าช้า", true, false],
            ].map(([k, v, late, thai]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 14px", borderTop: "1px solid #EAE7DF", fontSize: 13 }}>
                <span style={{ fontWeight: 500, color: "#646B75" }}>{k}</span>
                <span style={{ fontWeight: 700, color: late ? "#C8322B" : "#15181E", ...(thai ? {} : num) }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
        )}
      </div>
    </section>
  );
}

function Leg({ children }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: "#646B75" }}>{children}</span>;
}

/* ===========================================================================
   ROOT — phone frame + segmented switcher
   =========================================================================== */
export default function App() {
  const [tab, setTab] = useState(0);
  const prevTab = useRef(0);
  const dir = tab < prevTab.current ? "l" : ""; // slide direction (mirrors go() in the HTML builds)
  useEffect(() => { prevTab.current = tab; }, [tab]);
  const sendPrompt = (t) => { if (typeof window !== "undefined" && window.sendPrompt) window.sendPrompt(t); };
  const dark = tab === 1;
  // toast snackbar (demo affordances: logout, attach, CSV download)
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();
  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const TABS = ["การเงิน", "แชทบอท", "แผนงาน"];
  const tablistRef = useRef(null);
  const onTabKey = (e) => {
    const n = e.key === "ArrowRight" || e.key === "ArrowDown" ? (tab + 1) % 3
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (tab + 2) % 3
      : e.key === "Home" ? 0
      : e.key === "End" ? 2 : null;
    if (n === null) return;
    e.preventDefault();
    setTab(n);
    const btns = tablistRef.current?.querySelectorAll('[role="tab"]');
    btns && btns[n] && btns[n].focus();
  };

  return (
    <div style={{ minHeight: "100vh", background: "#E6E4DD", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 12px", fontFamily: FONT, color: "#15181E", WebkitFontSmoothing: "antialiased", lineHeight: 1.5 }}>
      <style>{`
        .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
        .tjr-scroll::-webkit-scrollbar{width:0;height:0}
        /* single source of truth for the signature breathing today marker */
        @keyframes tjrBreathe{0%,100%{opacity:.6}50%{opacity:1}}
        .today-line{animation:tjrBreathe 2s cubic-bezier(.4,0,.2,1) infinite}
        /* directional screen cross-fade + 8px slide (mirrors the HTML builds) */
        @keyframes tjrFade{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:translateX(0)}}
        @keyframes tjrFadeL{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
        .tjr-screen{animation:tjrFade .18s cubic-bezier(.22,.61,.36,1)}
        .tjr-screen.l{animation:tjrFadeL .18s cubic-bezier(.22,.61,.36,1)}
        .tjr-toast{opacity:0;transform:translateX(-50%) translateY(8px);transition:opacity .18s cubic-bezier(.22,.61,.36,1),transform .18s cubic-bezier(.22,.61,.36,1);pointer-events:none}
        .tjr-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
        /* visible keyboard focus ring (WCAG 2.4.7) */
        button:focus-visible,[tabindex]:focus-visible{outline:2px solid #1E5FCC;outline-offset:2px;box-shadow:0 0 0 4px rgba(30,95,204,.30)}
        /* progressive header collapse so the right cluster never clips the rounded frame */
        @media (max-width:400px){.tjr-admin-label{display:none}}
        @media (max-width:359px){.tjr-proj-chip{display:none}}
        /* collapse ALL motion to opacity-only under reduced-motion */
        @media (prefers-reduced-motion:reduce){
          *,*::before,*::after{animation-duration:.12s!important;animation-iteration-count:1!important;transition-duration:.12s!important}
          .tjr-screen{animation:none!important}
          .today-line{animation:none!important;opacity:.85}
          .tjr-toast{transition:opacity .12s!important;transform:translateX(-50%)!important}
        }
      `}</style>

      <div style={{ width: 390, maxWidth: "100%", background: "#F6F6F2", borderRadius: 34, boxShadow: "0 30px 70px rgba(21,24,30,.30),0 2px 6px rgba(21,24,30,.12)", overflow: "hidden", position: "relative", border: "1px solid rgba(0,0,0,.06)" }}>
        <div style={{ height: 780, maxHeight: "calc(100vh - 48px)", display: "flex", flexDirection: "column", position: "relative" }}>

          {/* status bar */}
          <div style={{ height: 44, flex: "0 0 44px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 22px", fontSize: 13, fontWeight: 600, color: dark ? "#A7AEB8" : "#646B75", background: dark ? "#0F1217" : "#fff" }}>
            <span style={{ fontFamily: FONT_NUM, letterSpacing: "-0.01em" }}>9:41</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }} aria-hidden>
              <svg width="18" height="11" viewBox="0 0 18 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="6" rx="1" /><rect x="10" y="2.5" width="3" height="8.5" rx="1" /><rect x="15" y="0" width="3" height="11" rx="1" /></svg>
              <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor"><path d="M8 11a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 8 11Zm0-5.2a4.6 4.6 0 0 1 3.3 1.4l1.4-1.5a6.7 6.7 0 0 0-9.4 0l1.4 1.5A4.6 4.6 0 0 1 8 5.8ZM8 .8a9.7 9.7 0 0 0-6.9 2.9L2.5 5A7.7 7.7 0 0 1 8 2.8 7.7 7.7 0 0 1 13.5 5l1.4-1.4A9.7 9.7 0 0 0 8 .8Z" /></svg>
              <svg width="25" height="12" viewBox="0 0 25 12" fill="none"><rect x=".5" y=".5" width="21" height="11" rx="3" stroke="currentColor" opacity=".5" /><rect x="2" y="2" width="16" height="8" rx="1.5" fill="currentColor" /><rect x="23" y="3.5" width="2" height="5" rx="1" fill="currentColor" opacity=".5" /></svg>
            </span>
          </div>

          {/* app header */}
          <header style={{ flex: "0 0 auto", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", background: "#fff", borderBottom: "1px solid #EAE7DF", boxShadow: "0 2px 8px rgba(21,24,30,.06)", position: "relative", zIndex: 30 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <Pinwheel size={30} />
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
                <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.04em", color: "#15181E" }}>TONGJAI</span>
                <span style={{ fontSize: 8, fontWeight: 500, letterSpacing: "0.32em", color: "#646B75", marginTop: 2 }}>RENOVATE</span>
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button className="tjr-proj-chip" aria-label="สลับโครงการ" onClick={() => sendPrompt("สลับโครงการ")} style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 30, padding: "0 11px", background: "#EAF1FC", color: "#1E5FCC", fontSize: 13, fontWeight: 600, borderRadius: 999, border: "none", cursor: "pointer", whiteSpace: "nowrap", fontFamily: FONT }}>โครงการ <ChevronDown size={12} aria-hidden /></button>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 32, height: 32, borderRadius: "50%", background: "#F08A24", color: "#fff", fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 32px" }}>ผ</span>
                <span className="tjr-admin-label" style={{ fontSize: 12, fontWeight: 500, color: "#646B75", whiteSpace: "nowrap" }}>ผู้ดูแลระบบ</span>
              </div>
              <button onClick={() => { sendPrompt("ออกจากระบบ"); showToast("โหมดเดโม — ยังไม่ได้เชื่อมระบบล็อกอิน"); }} style={{ height: 32, padding: "0 10px", background: "none", border: "1px solid #EAE7DF", borderRadius: 10, fontFamily: FONT, fontSize: 12, fontWeight: 600, color: "#646B75", cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}><LogOut size={12} aria-hidden /> ออกจากระบบ</button>
            </div>
          </header>

          {/* segmented switcher */}
          <div style={{ flex: "0 0 auto", background: dark ? "#0F1217" : "#fff", padding: "8px 16px 12px", borderBottom: `1px solid ${dark ? "#2C333E" : "#EAE7DF"}`, position: "relative", zIndex: 20 }}>
            <div ref={tablistRef} role="tablist" aria-label="หน้าจอ" onKeyDown={onTabKey} style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: dark ? "#1A1F27" : "#FBFAF7", borderRadius: 10, height: 44, padding: 4 }}>
              <span style={{ position: "absolute", top: 4, left: 4, height: 36, width: "calc((100% - 8px)/3)", background: dark ? "#232A34" : "#fff", borderRadius: 7, boxShadow: dark ? "0 2px 8px rgba(0,0,0,.4)" : "0 2px 8px rgba(21,24,30,.06)", transition: "transform .22s cubic-bezier(.4,0,.2,1)", transform: `translateX(${tab * 100}%)`, zIndex: 1 }} />
              {TABS.map((t, i) => (
                // aria-controls only on the selected tab: the inactive panels are
                // unmounted, and aria-controls must not point at a missing id
                <button key={t} role="tab" id={`tjr-tab-${i}`} aria-controls={tab === i ? `tjr-panel-${i}` : undefined} aria-selected={tab === i} tabIndex={tab === i ? 0 : -1} onClick={() => setTab(i)}
                  style={{ position: "relative", zIndex: 2, background: "none", border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 13, fontWeight: 600,
                    color: tab === i ? (dark ? "#ECEEF1" : "#1E5FCC") : (dark ? "#6B7480" : "#646B75"), display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* body */}
          <div className="tjr-scroll" style={{ flex: "1 1 auto", overflowY: "auto", overflowX: "hidden", position: "relative" }}>
            <div key={tab} id={`tjr-panel-${tab}`} role="tabpanel" aria-labelledby={`tjr-tab-${tab}`} tabIndex={0} className={`tjr-screen${dir ? " " + dir : ""}`}>
              {tab === 0 && <ScreenA sendPrompt={sendPrompt} />}
              {tab === 1 && <ScreenB sendPrompt={sendPrompt} goBack={() => setTab(0)} showToast={showToast} />}
              {tab === 2 && <ScreenC showToast={showToast} />}
            </div>
          </div>

          {/* toast snackbar */}
          <div role="status" aria-live="polite" className={`tjr-toast${toast ? " show" : ""}`}
            style={{ position: "absolute", left: "50%", bottom: 28, background: "#15181E", color: "#fff", fontSize: 13, fontWeight: 600, padding: "10px 16px", borderRadius: 999, boxShadow: "0 12px 32px rgba(21,24,30,.14)", zIndex: 60, whiteSpace: "nowrap", maxWidth: "88%", overflow: "hidden", textOverflow: "ellipsis" }}>
            {toast}
          </div>
        </div>
      </div>
    </div>
  );
}
