"use client";
// Advanced dashboard: member status (active / inactive / blocked / closed / pending),
// money (collected, outstanding, collection rate), 12-month trends, agent-wise table,
// recent closings and payments. Data: GET /api/programs/:id/analytics (one call).
import { useEffect, useMemo, useState, useCallback } from "react";
import { useSelector } from "react-redux";
import { useRouter } from "next/navigation";
import { App, Select, Button, Table, Input, Tooltip, Empty } from "antd";
import {
  FiUsers, FiUserCheck, FiUserMinus, FiSlash, FiHeart, FiClock, FiRefreshCw, FiDownload,
  FiTrendingUp, FiCalendar, FiAlertCircle, FiPercent, FiCreditCard, FiSearch, FiArrowRight,
} from "react-icons/fi";
import { api } from "@/lib/client/api";
import dayjs from "dayjs";
import { amountsHidden, useAmountsHidden, AmountsEye, MASK } from "@/lib/client/privacy";

// ── colours by role (status palette for member state; categorical for series) ──
const C = {
  active: "#0ca30c",     // good
  inactive: "#fab219",   // warning
  blocked: "#d03b3b",    // critical
  closed: "#6250d6",     // violet (an event, not good/bad)
  pending: "#2a78d6",    // blue
  series1: "#2a78d6",    // collection / joined
  series2: "#eb6834",    // closed
  cash: "#2a78d6",
  online: "#1baf7a",
  ink: "#0b0b0b", ink2: "#52514e", muted: "#898781", grid: "#e1e0d9", track: "#efeee9",
};
const STATES = [
  { key: "active", label: "Active", color: C.active, icon: FiUserCheck },
  { key: "inactive", label: "Inactive", color: C.inactive, icon: FiUserMinus },
  { key: "blocked", label: "Blocked", color: C.blocked, icon: FiSlash },
  { key: "closed", label: "Closed", color: C.closed, icon: FiHeart },
];

// amounts and counts stay hidden until the eye is clicked (lib/client/privacy.js)
const inr = (n) => (amountsHidden() ? MASK : "₹" + Number(n || 0).toLocaleString("en-IN"));
const inrShort = (n) => {
  if (amountsHidden()) return "₹ ••";
  n = Number(n || 0);
  const f = (v) => v.toFixed(v >= 100 ? 0 : 1).replace(/\.0$/, "");
  if (n >= 1e7) return "₹" + f(n / 1e7) + "Cr";
  if (n >= 1e5) return "₹" + f(n / 1e5) + "L";
  if (n >= 1e3) return "₹" + f(n / 1e3) + "k";
  return "₹" + n;
};
const num = (n) => (amountsHidden() ? "••" : Number(n || 0).toLocaleString("en-IN"));
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const monthLabel = (m) => dayjs(m + "-01").format("MMM");
const monthFull = (m) => dayjs(m + "-01").format("MMMM YYYY");

// ───────────────────────────── small pieces ─────────────────────────────
const Card = ({ title, extra, children, className = "", bodyClass = "p-5" }) => (
  <section className={`dash-card ${className}`}>
    {(title || extra) && (
      <header className="flex items-center justify-between gap-3 px-5 pt-4">
        <h3 className="dash-h3">{title}</h3>
        {extra}
      </header>
    )}
    <div className={bodyClass}>{children}</div>
  </section>
);

const Kpi = ({ icon: Icon, label, value, sub, color, onClick, emphasis }) => (
  <button type="button" onClick={onClick} className={`kpi ${onClick ? "kpi-click" : ""} ${emphasis ? "kpi-em" : ""}`}>
    <div className="flex items-center gap-2">
      <span className="kpi-icon" style={{ color, background: color + "1a" }}><Icon size={15} /></span>
      <span className="kpi-label">{label}</span>
    </div>
    <div className="kpi-value">{value}</div>
    {sub ? <div className="kpi-sub">{sub}</div> : null}
  </button>
);

/** horizontal meter on a same-hue track */
const Meter = ({ value, color = C.series1, height = 8 }) => (
  <div className="w-full rounded-full overflow-hidden" style={{ height, background: C.track }}>
    <div style={{ width: `${Math.max(0, Math.min(100, value || 0))}%`, height: "100%", background: color, borderRadius: 999 }} />
  </div>
);

/** 100% stacked bar with a 2px surface gap between segments */
const StackBar = ({ parts, height = 14, showTip = true }) => {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <div className="w-full rounded-full" style={{ height, background: C.track }} />;
  return (
    <div className="flex w-full overflow-hidden rounded-full" style={{ height, gap: 2, background: "#fff" }}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <Tooltip key={p.key} title={showTip ? `${p.label}: ${num(p.value)} (${pct(p.value, total)}%)` : null}>
          <div style={{ flexGrow: p.value, flexBasis: 0, background: p.color, minWidth: 3 }} />
        </Tooltip>
      ))}
    </div>
  );
};

const Legend = ({ items }) => (
  <div className="flex flex-wrap gap-x-4 gap-y-1">
    {items.map((i) => (
      <span key={i.label} className="inline-flex items-center gap-1.5 text-xs" style={{ color: C.ink2 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: i.color, display: "inline-block" }} />
        {i.label}{i.value !== undefined ? <b className="ml-0.5" style={{ color: C.ink }}>{i.value}</b> : null}
      </span>
    ))}
  </div>
);

// ───────────────────────────── bar chart (SVG) ─────────────────────────────
/**
 * series: [{ key, label, color }]; data: [{ month, [key]: number }]
 * One series → single bars; two → grouped bars. One y-axis, hover tooltip per month.
 */
function BarChart({ data, series, format = num, height = 230 }) {
  const [hover, setHover] = useState(null);
  // draw at the real pixel width so text stays 11px on every screen
  const [W, setW] = useState(600);
  const ref = useCallback((el) => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
  }, []);
  const H = height, padL = 52, padR = 6, padT = 12, padB = 26;
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0)));
  // round step (1/2/2.5/5 × 10^n) so every tick is a clean number
  const rawStep = max / 4;
  const p10 = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p10).find((v) => v >= rawStep) || 10 * p10;
  const nice = step * 4;
  const ticks = [0, step, step * 2, step * 3, nice];
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const band = plotW / data.length;
  const groupW = Math.min(band * 0.68, series.length * 26);
  const barW = (groupW - (series.length - 1) * 2) / series.length;
  const y = (v) => padT + plotH - (v / nice) * plotH;

  return (
    <div className="relative w-full" ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img"
        aria-label={series.map((s) => s.label).join(" and ") + " by month"}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#c3c2b7" : C.grid} strokeWidth="1" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={C.muted} style={{ fontVariantNumeric: "tabular-nums" }}>
              {format === num ? num(t) : inrShort(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = padL + i * band + (band - groupW) / 2;
          return (
            <g key={d.month} onMouseEnter={() => setHover(i)}>
              {/* hit target: the whole month band */}
              <rect x={padL + i * band} y={padT} width={band} height={plotH} fill={hover === i ? "rgba(0,0,0,0.035)" : "transparent"} />
              {series.map((s, si) => {
                const v = d[s.key] || 0;
                const h = Math.max(v > 0 ? 2 : 0, (v / nice) * plotH);
                const x = x0 + si * (barW + 2);
                const r = Math.min(4, barW / 2, h);
                return (
                  <path key={s.key} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.55}
                    d={h <= 0 ? "" : `M${x},${y(0)} V${y(0) - h + r} Q${x},${y(0) - h} ${x + r},${y(0) - h} H${x + barW - r} Q${x + barW},${y(0) - h} ${x + barW},${y(0) - h + r} V${y(0)} Z`} />
                );
              })}
              <text x={padL + i * band + band / 2} y={H - 8} textAnchor="middle" fontSize="11" fill={hover === i ? C.ink : C.muted}>
                {monthLabel(d.month)}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="dash-tip" style={{ left: `${((padL + hover * band + band / 2) / W) * 100}%` }}>
          <div className="font-semibold mb-1" style={{ color: C.ink }}>{monthFull(data[hover].month)}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5"><span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block" }} />{s.label}</span>
              <b style={{ fontVariantNumeric: "tabular-nums" }}>{format(data[hover][s.key] || 0)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── skeleton ─────────────────────────────
const Skel = ({ h = 96, className = "" }) => <div className={`skel rounded-2xl ${className}`} style={{ height: h }} />;

function toCsv(rows) {
  const head = ["Agent", "Phone", "City", "Total", "Active", "Inactive", "Blocked", "Closed", "Pending", "Joined this month", "Collected", "This month", "Outstanding", "Collection %"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.name, r.phone, r.city, r.total, r.active, r.inactive, r.blocked, r.closed, r.pending, r.joinedThisMonth, r.collected, r.thisMonth, r.outstanding, r.collectionRate ?? ""].map(esc).join(","));
  return "﻿" + [head.map(esc).join(","), ...lines].join("\n");
}

// ───────────────────────────── main ─────────────────────────────
export default function AdvancedDashboard({ refreshKey = 0 }) {
  const { message } = App.useApp();
  useAmountsHidden(); // re-render when amounts are shown / hidden
  const router = useRouter();
  const program = useSelector((s) => s.data.selectedProgram);
  const agentsList = useSelector((s) => s.data.agentsList);
  const [agentId, setAgentId] = useState(undefined);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    if (!program?.id) return;
    setLoading(true);
    try {
      setData(await api.get(`/programs/${program.id}/analytics`, agentId ? { agentId } : undefined));
    } catch (e) {
      message.error(e.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [program?.id, agentId]);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { setAgentId(undefined); }, [program?.id]);

  const m = data?.members, money = data?.money;
  const agentRows = useMemo(() => {
    const rows = data?.agents || [];
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.name} ${r.phone} ${r.city}`.toLowerCase().includes(s)) : rows;
  }, [data, q]);

  const exportCsv = () => {
    const blob = new Blob([toCsv(agentRows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `agent-wise-${program?.name || "program"}-${dayjs().format("YYYY-MM-DD")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!program) {
    return <div className="dash-card p-10"><Empty description="Select a program to see the dashboard" /></div>;
  }

  const statesParts = m ? STATES.map((s) => ({ ...s, value: m[s.key] })) : [];
  const trendHasData = data?.trend?.some((t) => t.collected || t.joined || t.closed);

  const agentColumns = [
    {
      title: "Agent", dataIndex: "name", fixed: "left", width: 190,
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (v, r) => (
        <div className="min-w-0">
          <div className="font-semibold truncate" style={{ color: C.ink }}>
            {v}
            {r.agentActive === false && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 align-middle">inactive</span>}
          </div>
          <div className="text-xs truncate" style={{ color: C.muted }}>{[r.phone, r.city].filter(Boolean).join(" · ") || "—"}</div>
        </div>
      ),
    },
    {
      title: "Members", dataIndex: "total", width: 210, defaultSortOrder: "descend",
      sorter: (a, b) => a.total - b.total,
      render: (v, r) => (
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <b style={{ color: C.ink, fontVariantNumeric: "tabular-nums" }}>{num(v)}</b>
            {r.joinedThisMonth > 0 && <span className="text-[11px]" style={{ color: "#006300" }}>+{r.joinedThisMonth} this month</span>}
          </div>
          <StackBar height={8} parts={STATES.map((s) => ({ ...s, value: r[s.key] }))} />
        </div>
      ),
    },
    ...STATES.map((s) => ({
      title: s.label, dataIndex: s.key, width: 96, align: "right",
      sorter: (a, b) => a[s.key] - b[s.key],
      render: (v) => <span style={{ color: v ? C.ink : C.muted, fontVariantNumeric: "tabular-nums" }}>{num(v)}</span>,
    })),
    {
      title: <Tooltip title="Requests waiting for approval">Pending</Tooltip>, dataIndex: "pending", width: 96, align: "right",
      sorter: (a, b) => a.pending - b.pending,
      render: (v) => <span style={{ color: v ? C.pending : C.muted, fontWeight: v ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>{num(v)}</span>,
    },
    {
      title: "Collected", dataIndex: "collected", width: 150, align: "right",
      sorter: (a, b) => a.collected - b.collected,
      render: (v, r) => (
        <div style={{ fontVariantNumeric: "tabular-nums" }}>
          <div style={{ color: C.ink, fontWeight: 600 }}>{inr(v)}</div>
          {r.thisMonth > 0 && <div className="text-[11px] whitespace-nowrap" style={{ color: C.muted }}>{inr(r.thisMonth)} this month</div>}
        </div>
      ),
    },
    {
      title: "Outstanding", dataIndex: "outstanding", width: 124, align: "right",
      sorter: (a, b) => a.outstanding - b.outstanding,
      render: (v) => <span style={{ color: v ? C.blocked : C.muted, fontWeight: v ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>{inr(v)}</span>,
    },
    {
      title: "Collection", dataIndex: "collectionRate", width: 130,
      sorter: (a, b) => (a.collectionRate ?? -1) - (b.collectionRate ?? -1),
      render: (v) => v === null || v === undefined
        ? <span style={{ color: C.muted }}>—</span>
        : (
          <div className="flex items-center gap-2">
            <Meter value={v} height={6} color={C.series1} />
            <span className="text-xs w-11 text-right" style={{ color: C.ink2, fontVariantNumeric: "tabular-nums" }}>{v}%</span>
          </div>
        ),
    },
  ];

  return (
    <div className="dash">
      <style>{CSS}</style>

      {/* ── header ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="dash-title inline-flex items-center gap-2">Dashboard <AmountsEye label /></h1>
          <p className="dash-sub">
            <span className="dash-dot" /> {program.name}
            {data?.generatedAt && <span className="ml-2">· updated {dayjs(data.generatedAt).format("hh:mm A")}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            allowClear showSearch optionFilterProp="label" placeholder="All agents" value={agentId} onChange={setAgentId}
            style={{ minWidth: 220 }}
            options={(agentsList || []).map((a) => ({ value: a.id, label: a.displayName || a.name || a.id }))}
          />
          <Button icon={<FiRefreshCw className={loading ? "animate-spin" : ""} />} onClick={load}>Refresh</Button>
        </div>
      </div>

      {/* ── member KPIs ── */}
      {!m ? (
        <div className="kpi-grid">{[0, 1, 2, 3, 4, 5].map((i) => <Skel key={i} h={104} />)}</div>
      ) : (
        <div className="kpi-grid">
          <Kpi emphasis icon={FiUsers} label="Total Members" value={num(m.onBooks)} color={C.ink2}
            sub={`${num(m.joinedThisMonth)} joined this month`} onClick={() => router.push("/members")} />
          {STATES.map((s) => (
            <Kpi key={s.key} icon={s.icon} label={s.label} value={num(m[s.key])} color={s.color}
              sub={`${pct(m[s.key], m.onBooks)}% of members${s.key === "closed" && m.closedThisMonth ? ` · ${m.closedThisMonth} this month` : ""}`}
              onClick={() => router.push("/members")} />
          ))}
          <Kpi icon={FiClock} label="Pending Requests" value={num(m.pending)} color={C.pending}
            sub={m.rejected ? `${num(m.rejected)} rejected` : "Waiting for approval"} onClick={() => router.push("/members")} />
        </div>
      )}

      {/* ── composition + money ── */}
      <div className="grid gap-4 xl:grid-cols-5">
        <Card title="Member status" className="xl:col-span-2">
          {!m ? <Skel h={170} /> : (
            <div className="space-y-5">
              <div>
                <StackBar parts={statesParts} height={16} />
                <div className="mt-3"><Legend items={statesParts.map((p) => ({ label: p.label, color: p.color, value: num(p.value) }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-1">
                <div>
                  <div className="dash-mini-label">Active by gender</div>
                  <StackBar height={8} parts={[
                    { key: "m", label: "Male", value: m.activeMale, color: C.series1 },
                    { key: "f", label: "Female", value: m.activeFemale, color: "#e87ba4" },
                    { key: "o", label: "Not set", value: m.activeOtherGender, color: "#c3c2b7" },
                  ]} />
                  <div className="text-xs mt-1.5" style={{ color: C.ink2 }}>
                    {num(m.activeMale)} male · {num(m.activeFemale)} female{m.activeOtherGender ? ` · ${num(m.activeOtherGender)} not set` : ""}
                  </div>
                </div>
                <div>
                  <div className="dash-mini-label">Join fees paid</div>
                  {money && (money.joinFeesDoneMembers + money.joinFeesPendingMembers) > 0 ? (
                    <>
                      <Meter value={pct(money.joinFeesDoneMembers, money.joinFeesDoneMembers + money.joinFeesPendingMembers)} color={C.active} />
                      <div className="text-xs mt-1.5" style={{ color: C.ink2 }}>
                        {num(money.joinFeesDoneMembers)} paid · <span style={{ color: money.joinFeesPendingMembers ? C.blocked : C.ink2 }}>{num(money.joinFeesPendingMembers)} pending</span>
                      </div>
                    </>
                  ) : <div className="text-xs" style={{ color: C.muted }}>No join fees set</div>}
                </div>
              </div>
              {m.deleted > 0 && <div className="text-xs" style={{ color: C.muted }}>{num(m.deleted)} deleted members are not counted.</div>}
            </div>
          )}
        </Card>

        <Card title="Collections" className="xl:col-span-3">
          {!money ? <Skel h={170} /> : (
            <div className="space-y-5">
              <div className="dash-money-grid">
                <div>
                  <div className="dash-mini-label flex items-center gap-1"><FiTrendingUp size={12} /> Total collected</div>
                  <div className="dash-hero">{inr(money.collected)}</div>
                  <div className="text-xs" style={{ color: C.muted }}>{num(money.transactions)} payments</div>
                </div>
                <div>
                  <div className="dash-mini-label flex items-center gap-1"><FiCalendar size={12} /> This month</div>
                  <div className="dash-big">{inr(money.thisMonth)}</div>
                  <div className="text-xs" style={{ color: C.muted }}>Today {inr(money.today)}</div>
                </div>
                <div>
                  <div className="dash-mini-label flex items-center gap-1"><FiAlertCircle size={12} /> Outstanding</div>
                  <div className="dash-big" style={{ color: money.outstanding ? C.blocked : C.ink }}>{inr(money.outstanding)}</div>
                  <div className="text-xs" style={{ color: C.muted }}>{num(money.openDues)} dues · {num(money.membersWithDues)} members</div>
                </div>
                <div>
                  <div className="dash-mini-label flex items-center gap-1"><FiCreditCard size={12} /> Join fees</div>
                  <div className="dash-big">{inr(money.joinFeesCollected)}</div>
                  <div className="text-xs" style={{ color: money.joinFeesDue ? C.blocked : C.muted }}>{money.joinFeesDue ? `${inr(money.joinFeesDue)} due` : "Nothing due"}</div>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <div className="flex justify-between dash-mini-label"><span className="flex items-center gap-1"><FiPercent size={12} /> Collection rate</span><b style={{ color: C.ink }}>{money.collectionRate ?? 0}%</b></div>
                  <Meter value={money.collectionRate ?? 0} color={C.series1} height={10} />
                  <div className="text-xs mt-1.5" style={{ color: C.muted }}>{inr(money.billed - money.outstanding)} of {inr(money.billed)} billed on closings</div>
                </div>
                <div>
                  <div className="flex justify-between dash-mini-label"><span>Cash vs online</span><span style={{ color: C.ink2 }}>{pct(money.online, money.cash + money.online)}% online</span></div>
                  <StackBar height={10} parts={[
                    { key: "cash", label: "Cash", value: money.cash, color: C.cash },
                    { key: "online", label: "Online", value: money.online, color: C.online },
                  ]} />
                  <div className="mt-1.5"><Legend items={[{ label: "Cash", color: C.cash, value: inr(money.cash) }, { label: "Online", color: C.online, value: inr(money.online) }]} /></div>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── trends ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Collection — last 12 months">
          {!data ? <Skel h={220} /> : trendHasData
            ? <BarChart data={data.trend} series={[{ key: "collected", label: "Collected", color: C.series1 }]} format={inr} />
            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No payments in the last 12 months" />}
        </Card>
        <Card title="Members joined vs closed — last 12 months"
          extra={<Legend items={[{ label: "Joined", color: C.series1 }, { label: "Closed", color: C.series2 }]} />}>
          {!data ? <Skel h={220} /> : trendHasData
            ? <BarChart data={data.trend} series={[{ key: "joined", label: "Joined", color: C.series1 }, { key: "closed", label: "Closed", color: C.series2 }]} />
            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No joins or closings in the last 12 months" />}
        </Card>
      </div>

      {/* ── agent-wise ── */}
      <Card
        title={<span>Agent-wise members & collection {data && <span className="dash-count">{agentRows.filter((a) => a.agentId).length} agents</span>}</span>}
        extra={
          <div className="flex items-center gap-2">
            <Input allowClear size="middle" prefix={<FiSearch className="text-gray-400" />} placeholder="Search agent, phone, city"
              value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
            <Button icon={<FiDownload />} onClick={exportCsv} disabled={!agentRows.length}>CSV</Button>
          </div>
        }
        bodyClass="p-3 pt-2"
      >
        <Table
          size="middle" rowKey={(r) => r.agentId || "none"} loading={!data && loading}
          columns={agentColumns} dataSource={agentRows} scroll={{ x: 1240 }}
          pagination={agentRows.length > 15 ? { pageSize: 15, showSizeChanger: false } : false}
          onRow={(r) => ({ onClick: () => r.agentId && setAgentId(r.agentId), style: { cursor: r.agentId ? "pointer" : "default" } })}
          summary={(rows) => {
            if (rows.length < 2) return null;
            const t = rows.reduce((s, r) => { for (const k of ["total", "active", "inactive", "blocked", "closed", "pending", "collected", "outstanding"]) s[k] = (s[k] || 0) + r[k]; return s; }, {});
            return (
              <Table.Summary fixed>
                <Table.Summary.Row className="dash-sum">
                  <Table.Summary.Cell index={0}><b>Total</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={1}><b>{num(t.total)}</b></Table.Summary.Cell>
                  {STATES.map((s, i) => <Table.Summary.Cell key={s.key} index={2 + i} align="right"><b>{num(t[s.key])}</b></Table.Summary.Cell>)}
                  <Table.Summary.Cell index={6} align="right"><b>{num(t.pending)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={7} align="right"><b>{inr(t.collected)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={8} align="right"><b>{inr(t.outstanding)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={9} />
                </Table.Summary.Row>
              </Table.Summary>
            );
          }}
        />
        <div className="text-xs px-2 pt-2" style={{ color: C.muted }}>Click an agent to see the whole dashboard for that agent.</div>
      </Card>

      {/* ── recent ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Recent closings" extra={<button className="dash-link" onClick={() => router.push("/closedMembers")}>All closed members <FiArrowRight /></button>} bodyClass="px-5 pb-4 pt-2">
          {!data ? <Skel h={200} /> : data.recentClosings.length === 0
            ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No closings yet" />
            : (
              <ul className="divide-y" style={{ borderColor: C.grid }}>
                {data.recentClosings.map((r) => {
                  const total = r.collected + r.due;
                  return (
                    <li key={r.id} className="py-3 flex items-center gap-3">
                      <span className="kpi-icon shrink-0" style={{ color: C.closed, background: C.closed + "1a" }}><FiHeart size={14} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate" style={{ color: C.ink }}>{r.name} <span className="font-normal text-xs" style={{ color: C.muted }}>{r.registrationNumber}</span></div>
                        <div className="text-xs truncate" style={{ color: C.muted }}>{dayjs(r.closingDate).format("DD MMM YYYY")}{r.agentName ? ` · ${r.agentName}` : ""} · {r.payers} payers</div>
                      </div>
                      <div className="w-32 shrink-0">
                        <div className="flex justify-between text-xs mb-1"><span style={{ color: C.ink, fontWeight: 600 }}>{inr(r.collected)}</span><span style={{ color: C.muted }}>{pct(r.collected, total)}%</span></div>
                        <Meter value={pct(r.collected, total)} height={6} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
        </Card>
        <Card title="Recent payments" extra={<button className="dash-link" onClick={() => router.push("/transactions")}>All payments <FiArrowRight /></button>} bodyClass="px-5 pb-4 pt-2">
          {!data ? <Skel h={200} /> : data.recentPayments.length === 0
            ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No payments yet" />
            : (
              <ul className="divide-y" style={{ borderColor: C.grid }}>
                {data.recentPayments.map((r) => (
                  <li key={r.id} className="py-2.5 flex items-center gap-3">
                    <span className="kpi-icon shrink-0" style={{ color: r.method === "cash" ? C.cash : C.online, background: (r.method === "cash" ? C.cash : C.online) + "1a" }}><FiCreditCard size={14} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate" style={{ color: C.ink }}>{r.payer} <span className="font-normal text-xs" style={{ color: C.muted }}>{r.registrationNumber}</span></div>
                      <div className="text-xs truncate" style={{ color: C.muted }}>{dayjs(r.date).format("DD MMM YYYY")}{r.closingName ? ` · for ${r.closingName}` : ""} · {r.method}</div>
                    </div>
                    <b style={{ color: C.ink, fontVariantNumeric: "tabular-nums" }}>{inr(r.amount)}</b>
                  </li>
                ))}
              </ul>
            )}
        </Card>
      </div>
    </div>
  );
}

const CSS = `
.dash { display: flex; flex-direction: column; gap: 16px; }
.dash-title { font-size: 22px; font-weight: 800; color: #0b0b0b; letter-spacing: -0.02em; line-height: 1.2; }
.dash-sub { font-size: 13px; color: #52514e; margin-top: 4px; display: flex; align-items: center; }
.dash-dot { width: 7px; height: 7px; border-radius: 50%; background: #0ca30c; display: inline-block; margin-right: 7px; }
.dash-card { background: #fff; border: 1px solid rgba(11,11,11,0.08); border-radius: 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); min-width: 0; }
.dash-h3 { font-size: 14px; font-weight: 700; color: #0b0b0b; margin: 0; }
.dash-count { margin-left: 8px; font-size: 11px; font-weight: 600; color: #52514e; background: #f3f2ee; border-radius: 999px; padding: 2px 8px; }
.dash-mini-label { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #898781; margin-bottom: 6px; }
.dash-money-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.dash-money-grid > div { min-width: 0; }
.dash-hero { font-size: clamp(20px, 2.1vw, 28px); font-weight: 800; color: #0b0b0b; letter-spacing: -0.02em; line-height: 1.15; }
.dash-big { font-size: clamp(17px, 1.5vw, 20px); font-weight: 750; color: #0b0b0b; letter-spacing: -0.01em; line-height: 1.25; }
.dash-link { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: #2a78d6; }
.dash-link:hover { text-decoration: underline; }
.dash-tip { position: absolute; top: 4px; transform: translateX(-50%); background: #fff; border: 1px solid rgba(11,11,11,0.1); border-radius: 10px; box-shadow: 0 6px 20px rgba(0,0,0,0.10); padding: 8px 10px; font-size: 12px; color: #52514e; pointer-events: none; min-width: 150px; z-index: 5; }
.dash-sum td { background: #fafaf8 !important; }
.dash .ant-table-thead th { white-space: nowrap; }
.kpi-grid { display: grid; gap: 12px; grid-template-columns: repeat(6, minmax(0, 1fr)); }
@media (max-width: 1280px) { .kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 640px) { .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.kpi { text-align: left; background: #fff; border: 1px solid rgba(11,11,11,0.08); border-radius: 16px; padding: 14px 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); transition: box-shadow .15s, transform .15s, border-color .15s; min-width: 0; }
.kpi-click { cursor: pointer; }
.kpi-click:hover { box-shadow: 0 6px 18px rgba(0,0,0,0.07); transform: translateY(-1px); border-color: rgba(11,11,11,0.14); }
.kpi-em { background: linear-gradient(180deg, #ffffff, #f7f9fd); border-color: rgba(42,120,214,0.25); }
.kpi-icon { width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; }
.kpi-label { font-size: 12px; font-weight: 600; color: #52514e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kpi-value { font-size: clamp(22px, 2.2vw, 28px); font-weight: 800; color: #0b0b0b; letter-spacing: -0.02em; line-height: 1.1; margin-top: 10px; }
.kpi-sub { font-size: 11.5px; color: #898781; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.skel { background: linear-gradient(90deg, #f3f2ee 25%, #e9e8e2 50%, #f3f2ee 75%); background-size: 200% 100%; animation: dash-shimmer 1.4s infinite; }
@keyframes dash-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
`;
