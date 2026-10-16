"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useQueryTab } from '@/lib/client/useQueryTab';
import Contact from '@/components/screen/settings/Contact';
import Organization from '@/components/screen/settings/organization';
import UsersRoles from '@/components/screen/master/UsersRoles';
import { useCan, useFeature } from '@/lib/AuthProvider';
import Sessions from '@/components/screen/settings/Sessions';
import PasswordChange from '@/components/screen/settings/PasswordChange';
import RulePolicy from '@/components/screen/settings/rulePolicy';
import dynamic from 'next/dynamic';
const ThemeSettings = dynamic(() => import('@/components/screen/settings/ThemeSettings'), { ssr: false });
const CertificateBuilder = dynamic(() => import('@/components/screen/settings/certificate/CertificateBuilder'), { ssr: false });
const ReceiptSettings = dynamic(() => import('@/components/screen/settings/ReceiptSettings'), { ssr: false });
const ActivityLog = dynamic(() => import('@/components/screen/settings/ActivityLog'), { ssr: false });
import {
  BsBank2,
  BsShieldLock,
  BsHeadset,
  BsPeople,
  BsGear,
  BsChevronRight,
  BsChevronLeft,
  BsGearFill,
  BsX,
  BsList,
  BsAward,
  BsPalette,
  BsClockHistory,
  BsReceipt,
} from 'react-icons/bs';
import { useAuth } from '@/lib/AuthProvider';

const menuItems = [
  {
    key: 'organization',
    icon: <BsBank2 size={18} />,
    label: 'Organization',
    description: 'Manage trust details and profile',
    module: 'settings',
  },
  {
    key: 'theme',
    icon: <BsPalette size={18} />,
    label: 'Theme',
    description: 'Colours of the whole panel',
    module: 'settings',
    feature: 'theme',
  },
  {
    key: 'certificate',
    icon: <BsAward size={18} />,
    label: 'Certificate Builder',
    description: 'Design the member certificate on your own frame',
    module: 'settings',
    feature: 'certificateBuilder',
  },
  {
    key: 'receipt',
    icon: <BsReceipt size={18} />,
    label: 'Rasid design',
    description: 'Rasid ka size, rang, UPI QR, sign',
    module: 'settings',
    feature: ['receipts', 'rasidDesign'],
  },
  {
    key: 'activity',
    icon: <BsClockHistory size={18} />,
    label: 'Activity log',
    description: 'Kisne kab kya badla',
    module: 'settings',
    feature: 'auditLog',
  },
  {
    key: 'teams',
    icon: <BsPeople size={18} />,
    label: 'Users & Roles',
    description: 'Staff logins and what they can access',
    module: 'users',
  },
  {
    key: 'security',
    icon: <BsShieldLock size={18} />,
    label: 'Security',
    description: 'Secure your account and data',
    subItems: [
      { key: 'security-password', label: 'Password' },
      { key: 'security-sessions', label: 'Active Sessions' },
    ],
  },
  {
    key: 'contact',
    icon: <BsHeadset size={18} />,
    label: 'Contact Support',
    description: 'Get help from our team',
  },
  {
    key: 'Rules & Policies',
    icon: <BsGearFill size={18} />,
    label: 'Rules & Policies',
    description: "View and manage your organization's rules and policies",
  },
];

const SettingsPage = () => {
  const can = useCan();
  const feature = useFeature();
  const visibleItems = menuItems.filter((i) => (!i.module || can(i.module)) && [].concat(i.feature || []).every((f) => feature(f)));
  // the tab lives in the URL (/setting?tab=theme) so the main sidebar's sub-menu can open it
  const [activeTab, setActiveTab] = useQueryTab('organization', menuItems.map((i) => i.key));
  useEffect(() => {
    if (!visibleItems.find((i) => i.key === activeTab) && visibleItems[0]) setActiveTab(visibleItems[0].key);
  }, [visibleItems.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [activeSubTab, setActiveSubTab] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { user } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Close mobile sidebar on tab change
  const handleTabClick = (key) => {
    setActiveTab(key);
    setActiveSubTab(null);
    setMobileSidebarOpen(false);
  };

  const handleSubTabClick = (key) => {
    setActiveSubTab(key);
    setMobileSidebarOpen(false);
  };

  const getActiveMenuItem = () => visibleItems.find((item) => item.key === activeTab);

  const getTabTitle = () => {
    const activeMenuItem = getActiveMenuItem();
    if (activeSubTab && activeMenuItem?.subItems) {
      const sub = activeMenuItem.subItems.find((i) => i.key === activeSubTab);
      return sub ? sub.label : activeMenuItem.label;
    }
    return activeMenuItem ? activeMenuItem.label : '';
  };

  const renderContent = () => {
    if (!visibleItems.some((i) => i.key === activeTab)) return null; // switched off / no permission
    switch (activeTab) {
      case 'organization':
        return <Organization />;
      case 'contact':
        return <Contact />;
      case 'certificate':
        return <CertificateBuilder />;
      case 'theme':
        return <ThemeSettings />;
      case 'activity':
        return <ActivityLog />;
      case 'receipt':
        return <ReceiptSettings />;
      case 'Rules & Policies':
        return <RulePolicy />;
      case 'teams':
        return (
          <div className="space-y-8">
            <UsersRoles show="users" />
            <UsersRoles show="roles" />
          </div>
        );
      case 'security':
        return (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-1">Security Settings</h3>
            <p className="text-sm text-gray-500 mb-6">
              Configure your account security options and privacy settings.
            </p>

            {activeSubTab === 'security-password' && <PasswordChange />}
            {activeSubTab === 'security-sessions' && (
              <Sessions activeTab={activeTab} activeSubTab={activeSubTab} />
            )}

            {!activeSubTab && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                {getActiveMenuItem()?.subItems?.map((subItem) => (
                  <button
                    key={subItem.key}
                    className="flex items-center gap-4 p-4 border border-gray-200 rounded-xl hover:bg-blue-50 hover:border-blue-200 transition-all text-left group"
                    onClick={() => handleSubTabClick(subItem.key)}
                  >
                    <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center text-blue-500 group-hover:bg-blue-100 transition-colors flex-shrink-0">
                      <BsShieldLock size={17} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800">{subItem.label}</p>
                    </div>
                    <BsChevronRight size={13} className="text-gray-400 group-hover:text-blue-500 transition-colors" />
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      default:
        return (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-10 flex flex-col items-center justify-center min-h-64">
            <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center text-blue-500 mb-4">
              {getActiveMenuItem()?.icon}
            </div>
            <h3 className="text-base font-medium text-gray-700 mb-2">{getTabTitle()}</h3>
            <p className="text-sm text-gray-400 text-center max-w-xs">
              This section is under development. Please check back soon.
            </p>
          </div>
        );
    }
  };

  const SidebarContent = () => (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2">
            <BsGear className="text-blue-500" size={18} />
            <span className="text-base font-semibold text-gray-800">Settings</span>
          </div>
        )}
        {sidebarCollapsed && (
          <div className="flex justify-center w-full">
            <BsGear className="text-blue-500" size={18} />
          </div>
        )}
        {/* Collapse toggle — hidden on mobile */}
        <button
          className="hidden 2xl:flex p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <BsChevronRight size={14} /> : <BsChevronLeft size={14} />}
        </button>
        {/* Close button — mobile only */}
        <button
          className="2xl:hidden p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
          onClick={() => setMobileSidebarOpen(false)}
          aria-label="Close menu"
        >
          <BsX size={20} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {visibleItems.map((item) => {
          const isActive = activeTab === item.key;
          const hasSubItems = !!item.subItems;
          const isExpanded = isActive && hasSubItems;

          return (
            <div key={item.key}>
              <button
                onClick={() => handleTabClick(item.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span
                  className={`flex-shrink-0 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}
                >
                  {item.icon}
                </span>

                {!sidebarCollapsed && (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.label}</p>
                      <p className="text-xs text-gray-400 truncate mt-0.5">{item.description}</p>
                    </div>
                    {hasSubItems && (
                      <BsChevronRight
                        size={12}
                        className={`flex-shrink-0 text-gray-400 transition-transform duration-200 ${
                          isExpanded ? 'rotate-90' : ''
                        }`}
                      />
                    )}
                  </>
                )}
              </button>

              {/* Sub-items */}
              {isExpanded && !sidebarCollapsed && (
                <div className="ml-9 pl-3 border-l border-gray-200 mt-1 mb-1 space-y-0.5">
                  {item.subItems.map((sub) => (
                    <button
                      key={sub.key}
                      onClick={() => handleSubTabClick(sub.key)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                        activeSubTab === sub.key
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </>
  );

  return (
    <div className="flex h-full bg-gray-50 relative">

      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-20 2xl:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar — desktop */}
      <aside
        className={`hidden 2xl:flex flex-col bg-white border-r border-gray-200 h-[calc(100vh-64px)] sticky top-0 transition-all duration-200 ${
          sidebarCollapsed ? 'w-[60px]' : 'w-[260px]'
        }`}
      >
        <SidebarContent />
      </aside>

      {/* Sidebar — mobile drawer */}
      <aside
        className={`fixed top-0 left-0 h-full z-30 flex flex-col bg-white border-r border-gray-200 w-72 transition-transform duration-200 2xl:hidden ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidebarContent />
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <div className="bg-white border-b border-gray-200 px-4 md:px-6 py-3 flex items-center gap-3 sticky top-0 z-10">
          {/* Mobile menu toggle */}
          <button
            className="2xl:hidden p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Open menu"
          >
            <BsList size={20} />
          </button>

          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-sm text-gray-400 min-w-0">
            <span className="hidden sm:inline">Settings</span>
            <BsChevronRight size={11} className="hidden sm:inline flex-shrink-0" />
            <span className="text-gray-700 font-medium truncate">{getActiveMenuItem()?.label}</span>
            {activeSubTab && (
              <>
                <BsChevronRight size={11} className="flex-shrink-0" />
                <span className="text-gray-700 font-medium truncate">
                  {getActiveMenuItem()?.subItems?.find((s) => s.key === activeSubTab)?.label}
                </span>
              </>
            )}
          </nav>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className={`${['certificate', 'theme', 'activity', 'receipt'].includes(activeTab) ? 'max-w-6xl' : 'max-w-3xl'} w-full mx-auto`}>
            {renderContent()}
          </div>
        </div>
      </main>
    </div>
  );
};

export default function SettingsRoute() {
  return <Suspense fallback={null}><SettingsPage /></Suspense>;
}