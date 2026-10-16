"use client";
import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from "@/lib/AuthProvider";
import { can as canDo, pageModule } from "@/lib/permissions";
import TopBar from './TopBar';
import SideBar from './SideBar';
import { api } from '@/lib/client/api';
import { fetchAgents, fetchPrograms, fetchClosingGroups as loadClosingGroups } from '@/lib/services/firebaseService';
import { setAgentList, setClosingGroups, setgetAgentDataChange, setPrograms, setSelectedProgram, setTrustData, setMasterData } from '@/redux/slices/commonSlice';
import { loadMasterData, onMasterChanged } from '@/lib/client/masterData';
import { useDispatch, useSelector } from 'react-redux';
import { FiLayers } from 'react-icons/fi';
import { loadTrustProfile, onTrustChanged } from '@/lib/client/trust';
import { normalizeTrust, displayName } from '@/lib/trust/profile';
import GlobalPdfWidget from './Globalpdfwidget';

// ─── Skeleton loader ────────────────────────────────────────────────────────
const SkeletonRow = ({ w = 'w-full', h = 'h-4', className = '' }) => (
  <div className={`skeleton-pulse rounded-lg ${w} ${h} ${className}`} />
);

const LoadingScreen = () => (
  <>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap');
      .loading-root {
        min-height: 100vh;
        background: var(--page-bg);
        display: flex;
        font-family: 'Outfit', sans-serif;
      }
      /* Fake sidebar */
      .loading-sidebar {
        width: 72px;
        background: linear-gradient(180deg, var(--sb-bg1) 0%, var(--sb-bg2) 100%);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 20px 0;
        gap: 16px;
        flex-shrink: 0;
      }
      @media (max-width: 1023px) { .loading-sidebar { display: none; } }
      .loading-sidebar-icon {
        width: 40px; height: 40px;
        border-radius: 10px;
        background: linear-gradient(135deg, #1e3a5f, #172d4d);
      }
      .loading-sidebar-dot {
        width: 36px; height: 36px;
        border-radius: 10px;
        background: rgba(255,255,255,0.06);
      }
      /* Fake topbar */
      .loading-topbar {
        height: 64px;
        background: #fff;
        border-bottom: 1px solid #f1f5f9;
        display: flex; align-items: center;
        padding: 0 24px; gap: 12px;
      }
      /* Main content area */
      .loading-content { flex: 1; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
      .loading-card {
        background: #fff;
        border-radius: 16px;
        border: 1px solid #f1f5f9;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
        padding: 20px;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      .skeleton-pulse {
        background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
      }
      @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
      .spinner-ring {
        width: 20px; height: 20px;
        border: 2px solid rgba(59,130,246,0.2);
        border-top-color: var(--brand);
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        flex-shrink: 0;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    `}</style>

    <div className="loading-root">
      {/* Fake sidebar */}
      <div className="loading-sidebar">
        <div className="loading-sidebar-icon" style={{ background: 'linear-gradient(135deg, var(--brand), var(--brand-hover))' }} />
        {[...Array(6)].map((_, i) => (
          <div key={i} className="loading-sidebar-dot" style={{ opacity: 1 - i * 0.12 }} />
        ))}
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Fake topbar */}
        <div className="loading-topbar">
          <SkeletonRow w="w-8" h="h-8" className="rounded-lg flex-shrink-0" />
          <SkeletonRow w="w-32" h="h-4" />
          <div style={{ flex: 1 }} />
          <SkeletonRow w="w-36" h="h-8" className="rounded-lg" />
          <SkeletonRow w="w-8" h="h-8" className="rounded-full" />
        </div>

        {/* Content */}
        <div className="loading-content">
          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} className="loading-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SkeletonRow w="w-10" h="h-10" className="rounded-xl" />
                <SkeletonRow w="w-24" h="h-3" />
                <SkeletonRow w="w-16" h="h-6" />
              </div>
            ))}
          </div>

          {/* Table-like card */}
          <div className="loading-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <SkeletonRow w="w-40" h="h-5" />
              <div style={{ flex: 1 }} />
              <SkeletonRow w="w-24" h="h-8" className="rounded-lg" />
            </div>
            {[...Array(5)].map((_, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <SkeletonRow w="w-8" h="h-8" className="rounded-full" />
                <SkeletonRow w="w-32" h="h-4" />
                <SkeletonRow w="w-20" h="h-4" />
                <div style={{ flex: 1 }} />
                <SkeletonRow w="w-16" h="h-6" className="rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </>
);

// Plan about to end (developer's /feature-control page) — shown on every screen, can be hidden for the day
function PlanBanner({ plan }) {
  const key = `mgsf.planBanner.${plan.expiresAt}.${new Date().toDateString()}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  if (hidden) return null;
  const d = plan.daysLeft;
  const when = d === 0 ? "aaj" : d === 1 ? "kal" : `${d} din mein`;
  const date = new Date(plan.expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <div className="mb-3 flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <span className="font-bold">!</span>
      <span className="flex-1">Panel ka plan <b>{when}</b> ({date}) khatam ho raha hai. Uske baad panel band ho jayega — samay rehte support se renew karwa lein.</span>
      <button type="button" className="text-amber-700 hover:text-amber-900 font-semibold" onClick={() => { try { localStorage.setItem(key, "1"); } catch {} setHidden(true); }}>Theek hai</button>
    </div>
  );
}

// ─── Main Layout ─────────────────────────────────────────────────────────────
function NoAccess({ roleName, goTo, switchedOff }) {
  const router = useRouter();
  useEffect(() => { if (goTo) router.replace(goTo); }, [goTo, router]);
  if (goTo) return null;
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 px-6">
      <div className="w-14 h-14 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center text-2xl font-bold mb-4">!</div>
      <h2 className="text-xl font-semibold text-gray-900">{switchedOff ? "Ye screen chalu nahi hai" : "Is screen ki permission nahi hai"}</h2>
      <p className="text-gray-500 mt-1 max-w-md">{switchedOff
        ? "Ye feature aapke panel mein abhi band hai. Chalu karwane ke liye support se sampark karein."
        : <>Aapke role{roleName ? ` (${roleName})` : ""} mein ye screen allowed nahi hai. Super Admin se Master Data → Roles mein permission maangiye.</>}</p>
    </div>
  );
}

export default function CustomDashboardLayout({ children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
 const [fetching, setFetching] = useState(true);
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const dispatch = useDispatch();
  const agentStatusChanged = useSelector((state) => state.data.getAgentDataChange);
  const memberStatusChanged = useSelector((state) => state.data.getMemberDataChange);

  const withoutLayout = ["/auth/login", "/feature-control"];
  // public pages (no login, no panel around them): QR verify for receipts / certificates
  const bare = withoutLayout.includes(pathname) || pathname.startsWith("/verify/");

  const selectedProgramNow = useSelector((state) => state.data.selectedProgram);

  const getAgentData = async (programId) => {
    try {
      dispatch(setAgentList(await fetchAgents(programId)));
      dispatch(setgetAgentDataChange(false));
    } catch (e) { console.error(e); }
  };

  const getProgramData = async () => {
    try {
      const programs = await fetchPrograms();
      dispatch(setPrograms(programs));
      // keep the program the user picked; otherwise the "selected" one, otherwise the first
      const keep = programs.find(p => p.id === selectedProgramNow?.id)
        || programs.find(p => p.isSelected) || programs[0] || null;
      dispatch(setSelectedProgram(keep));
      fetchClosingGroups(keep?.id);
      getAgentData(keep?.id);
    } catch (error) {
      console.error("Error fetching programs data:", error);
    }
  };

  // dropdown lists (state, district, relation, caste, gotra) from Master Data
  const fetchMasterData = async () => {
    try { dispatch(setMasterData({ ...(await loadMasterData()), loaded: true })); } catch (e) { console.error('master data', e); }
  };
  useEffect(() => {
    if (!user) return;
    return onMasterChanged(() => fetchMasterData());
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchTrustData = async () => {
    try {
      const { profile } = await loadTrustProfile();
      dispatch(setTrustData(profile));
      document.title = `${displayName(profile)} | Admin Panel`;
    } catch (err) {
      console.error(err);
      dispatch(setTrustData(normalizeTrust({})));
    } finally {
      setFetching(false);
    }
  };

  // Settings → Organization saved (here or in another tab) → reload branding everywhere
  useEffect(() => {
    if (!user) return;
    return onTrustChanged(() => fetchTrustData());
  }, [user]);

  const fetchClosingGroups = async (programId) => {
    if (!user?.uid || !programId) return;
    try {
      dispatch(setClosingGroups(await loadClosingGroups(programId)));
    } catch (error) {
      console.error('Error fetching closing groups:', error);
    }
  };

  useEffect(() => {
    if (!loading && !user && !bare) {
      router.replace("/auth/login");
    }
    if (user) {
      fetchTrustData();
      getProgramData();
      fetchMasterData();
    }
  }, [user, loading, agentStatusChanged]);

  // member added / accepted / closed → refresh the live counts shown on the dashboard
  useEffect(() => {
    if (user && memberStatusChanged) getProgramData();
  }, [memberStatusChanged]);

  // program changed from the top bar → reload its agents (member counts) and closing groups
  useEffect(() => {
    if (user && selectedProgramNow?.id) {
      getAgentData(selectedProgramNow.id);
      fetchClosingGroups(selectedProgramNow.id);
    }
  }, [selectedProgramNow?.id]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest('.user-menu-trigger') && !e.target.closest('.user-menu-content')) {
        setShowUserMenu(false);
      }
      if (!e.target.closest('.notification-trigger') && !e.target.closest('.notification-content')) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Small laptops (1024–1279px): icon-only sidebar by default; wide screens: full sidebar.
  // Follows the window when it crosses 1280px; the toggle button still works in between.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)');
    const apply = () => setSidebarCollapsed(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Close mobile sidebar on route change
  useEffect(() => { setMobileSidebarOpen(false); }, [pathname]);

  if (bare) return children;
  if (loading) return <LoadingScreen />;
  if (!user) return null;

  // role-wise screen access (super admin: everything)
  const pageMod = pageModule(pathname);
  const pageAllowed = pathname === "/master"
    ? canDo(user.access, "master") || canDo(user.access, "users")
    : !pageMod || canDo(user.access, pageMod);
  const firstAllowed = !pageAllowed && pathname === "/"
    ? ["/members", "/agents", "/closedMembers", "/transactions", "/closingPayments", "/yojna", "/master"].find((p) => p === "/master" ? canDo(user.access, "master") || canDo(user.access, "users") : canDo(user.access, pageModule(p)))
    : null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        .layout-root {
          display: flex;
          height: 100vh;
          overflow: hidden;
          background: var(--page-bg);
          font-family: 'Outfit', sans-serif;
        }

        /* Desktop sidebar */
        .desktop-sidebar {
          flex-shrink: 0;
          height: 100%;
          display: flex;
        }
        @media (max-width: 1023px) {
          .desktop-sidebar { display: none; }
        }

        /* Mobile overlay */
        .mobile-overlay {
          display: none;
        }
        @media (max-width: 1023px) {
          .mobile-overlay {
            display: block;
            position: fixed;
            inset: 0;
            z-index: 200;
            pointer-events: none;
          }
          .mobile-overlay.open {
            pointer-events: all;
          }
          .mobile-backdrop {
            position: absolute;
            inset: 0;
            background: rgba(0,0,0,0.5);
            backdrop-filter: blur(2px);
            opacity: 0;
            transition: opacity 0.25s;
          }
          .mobile-overlay.open .mobile-backdrop { opacity: 1; }
          .mobile-drawer {
            position: absolute;
            top: 0; left: 0; bottom: 0;
            width: 280px;
            transform: translateX(-100%);
            transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
          }
          .mobile-overlay.open .mobile-drawer { transform: translateX(0); }
          .mobile-close-btn {
            position: absolute;
            top: 16px; right: -44px;
            width: 36px; height: 36px;
            border-radius: 50%;
            background: rgba(255,255,255,0.15);
            border: 1px solid rgba(255,255,255,0.2);
            display: flex; align-items: center; justify-content: center;
            color: #fff;
            cursor: pointer;
            transition: background 0.15s;
          }
          .mobile-close-btn:hover { background: rgba(255,255,255,0.25); }
        }

        /* Mobile toggle button in TopBar */
        .mobile-menu-btn {
          display: none;
        }
        @media (max-width: 1023px) {
          .mobile-menu-btn { display: flex; }
        }

        /* Main area */
        .main-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-width: 0;
        }
        .page-content {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        }
        @media (max-width: 1279px) {
          .page-content { padding: 14px; }
          .page-card { padding: 18px; }
        }
        @media (max-width: 640px) {
          .page-content { padding: 12px; }
        }
        .page-card {
          background: #fff;
          border-radius: 16px;
          border: 1px solid var(--tb-border);
          box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.04);
          padding: 24px;
          min-height: calc(100vh - 140px);
        }
        @media (max-width: 640px) {
          .page-card { padding: 16px; border-radius: 12px; }
        }

        /* Page enter animation */
        @keyframes pageEnter {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .page-card { animation: pageEnter 0.25s ease; }
      `}</style>

      <div className="layout-root">
        {/* Desktop Sidebar */}
        <div className="desktop-sidebar">
          <Suspense fallback={null}><SideBar collapsed={sidebarCollapsed} /></Suspense>
        </div>

        {/* Mobile Sidebar Drawer */}
        <div className={`mobile-overlay ${mobileSidebarOpen ? 'open' : ''}`}>
          <div className="mobile-backdrop" onClick={() => setMobileSidebarOpen(false)} />
          <div className="mobile-drawer">
            <Suspense fallback={null}><SideBar collapsed={false} onClose={() => setMobileSidebarOpen(false)} /></Suspense>
            <button
              className="mobile-close-btn"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="Close menu"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Main */}
        <div className="main-area">
          <TopBar
            sidebarCollapsed={sidebarCollapsed}
            toggleSidebar={() => {
              if (window.innerWidth < 1024) {
                setMobileSidebarOpen(prev => !prev);
              } else {
                setSidebarCollapsed(prev => !prev);
              }
            }}
            showNotifications={showNotifications}
            toggleNotifications={() => {
              setShowNotifications(p => !p);
              setShowUserMenu(false);
            }}
            showUserMenu={showUserMenu}
            toggleUserMenu={() => {
              setShowUserMenu(p => !p);
              setShowNotifications(false);
            }}
          />
          <main className="page-content">
            {user.access?.plan && <PlanBanner plan={user.access.plan} />}
            <div className="page-card">
              {pageAllowed ? children : <NoAccess roleName={user.access?.roleName} goTo={firstAllowed} switchedOff={!!pageMod && !!user.access?.off?.includes(pageMod)} />}
            </div>
          </main>
        </div>
        <GlobalPdfWidget />
      </div>
    </>
  );
}