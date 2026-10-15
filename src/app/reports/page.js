"use client";
// Reports: late / overdue payments, agent performance ranking, one member's payment history.
import { Suspense, useEffect, useState } from "react";
import { useQueryTab } from "@/lib/client/useQueryTab";
import { useSelector } from "react-redux";
import { Tabs, Empty } from "antd";
import { FiClock, FiAward, FiUser } from "react-icons/fi";
import LatePayments from "@/components/screen/reports/LatePayments";
import AgentPerformance from "@/components/screen/reports/AgentPerformance";
import MemberHistory from "@/components/screen/reports/MemberHistory";

export default function ReportsPage() {
  return <Suspense fallback={null}><Reports /></Suspense>;
}

function Reports() {
  const program = useSelector((s) => s.data.selectedProgram);
  const [tab, setTab] = useQueryTab("late", ["late", "agents", "member"]);
  const [lateAgent, setLateAgent] = useState(null);
  const [memberId, setMemberId] = useState(null);

  // /reports?member=<id> opens that member's history (?tab=… comes from the URL, see useQueryTab)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("member")) { setMemberId(q.get("member")); setTab("member"); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!program) return <div className="p-6"><Empty description="Upar se yojna chunein" /></div>;

  const openMember = (id) => { setMemberId(id); setTab("member"); };
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-gray-500 text-sm">{program.name} · payment kab bhara, kitne din late, kaun baki hai, kaun agent best hai.</p>
      </div>
      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: "late", label: <span className="inline-flex items-center gap-1.5"><FiClock /> Late / baki payments</span>,
          children: <LatePayments key={`late-${lateAgent || ""}`} program={program} initialAgentId={lateAgent} onOpenMember={openMember} /> },
        { key: "agents", label: <span className="inline-flex items-center gap-1.5"><FiAward /> Agent performance</span>,
          children: <AgentPerformance program={program} onOpenAgentLate={(id) => { setLateAgent(id); setTab("late"); }} /> },
        { key: "member", label: <span className="inline-flex items-center gap-1.5"><FiUser /> Member history</span>,
          children: <MemberHistory program={program} memberId={memberId} onMemberChange={setMemberId} /> },
      ]} />
    </div>
  );
}
