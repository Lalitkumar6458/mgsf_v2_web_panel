"use client";
import { useAuth } from "@/lib/AuthProvider";
import { useSelector } from "react-redux";
import ClosingCom from "@/components/screen/home/ClosingCom";
import AdvancedDashboard from "@/components/screen/home/dashboard/AdvancedDashboard";
import { useState, useEffect } from "react";
import { api } from "@/lib/client/api";

// ─── Home: advanced dashboard + closed cases ─────────────────────────────────
export default function Home() {
  const { user } = useAuth();
  const selectedProgram = useSelector((state) => state.data.selectedProgram);

  const [closingCount, setClosingCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const getClosingCount = async () => {
    if (!user || !selectedProgram) return;
    setIsLoading(true);
    try {
      const data = await api.get(`/programs/${selectedProgram.id}/dashboard`);
      setClosingCount(data?.members?.closed || 0);
    } catch {
      /* the dashboard shows its own error */
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedProgram) getClosingCount();
  }, [selectedProgram]);

  return (
    <div className="flex flex-col gap-4">
      <AdvancedDashboard refreshKey={refreshKey} />

      {/* Closed cases (edit / revert / PDFs) */}
      <div id="closed-cases" className="bg-white rounded-2xl border border-black/[0.08] shadow-sm overflow-hidden scroll-mt-20">
        <ClosingCom
          selectedProgram={selectedProgram}
          user={user}
          closingCount={closingCount}
          isLoading={isLoading}
          onRefresh={() => { getClosingCount(); setRefreshKey((k) => k + 1); }}
          key={refreshKey}
        />
      </div>
    </div>
  );
}
