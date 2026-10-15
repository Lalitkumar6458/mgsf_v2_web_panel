import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Dropdown, Tooltip } from 'antd';
import {
  FiGrid, FiUsers, FiBarChart2, FiBookOpen, FiSettings, FiCreditCard, FiLayers, FiChevronDown,
} from 'react-icons/fi';
import { useAuth, useCan } from '@/lib/AuthProvider';
import { useSelector } from 'react-redux';
import { displayName as trustDisplayName, initials as trustInitials } from '@/lib/trust/profile';

// Menu grouped by the kind of work. A group opens to its sub-pages; pages with tabs
// (Reports, Master Data, Settings) list each tab as a sub-item (?tab=…, see useQueryTab).
// Colours come from the theme (Settings → Theme): every colour here is a CSS variable.

const OPEN_KEY = 'mgsf.sidebar.open';

function buildMenu(can) {
  const tab = (path, t) => `${path}?tab=${encodeURIComponent(t)}`;
  const groups = [
    { section: 'Main' },
    { key: 'dashboard', icon: FiGrid, label: 'Dashboard', link: '/', show: can('dashboard') },
    {
      key: 'members', icon: FiUsers, label: 'Members', hint: 'Sadasya',
      children: [
        { label: 'All members', link: '/members', show: can('members') },
        { label: 'Closed members', link: '/closedMembers', show: can('closings') },
      ],
    },
    {
      key: 'payments', icon: FiCreditCard, label: 'Payments', hint: 'Bhugtan',
      children: [
        { label: 'Closing payments', link: '/closingPayments', show: can('payments') },
        { label: 'Payment history', link: '/transactions', show: can('payments') },
      ],
    },
    {
      key: 'yojna', icon: FiBookOpen, label: 'Yojna & Agents', hint: 'Yojna',
      children: [
        { label: 'Yojna', link: '/yojna', show: can('yojna') },
        { label: 'Agents', link: '/agents', show: can('agents') },
      ],
    },
    {
      key: 'reports', icon: FiBarChart2, label: 'Reports', hint: 'Report',
      children: [
        { label: 'Late / baki payments', link: tab('/reports', 'late'), show: can('reports') },
        { label: 'Agent performance', link: tab('/reports', 'agents'), show: can('reports') },
        { label: 'Member history', link: tab('/reports', 'member'), show: can('reports') },
      ],
    },
    { section: 'System' },
    {
      key: 'master', icon: FiLayers, label: 'Master Data',
      children: [
        { label: 'Dropdown lists', link: tab('/master', 'state'), show: can('master'), match: ['state', 'district', 'relation', 'caste', 'gotra'] },
        { label: 'Users', link: tab('/master', 'users'), show: can('users') },
        { label: 'Roles', link: tab('/master', 'roles'), show: can('users') },
      ],
    },
    {
      key: 'settings', icon: FiSettings, label: 'Settings',
      children: [
        { label: 'Organization', link: tab('/setting', 'organization'), show: can('settings'), isDefault: true },
        { label: 'Theme', link: tab('/setting', 'theme'), show: can('settings') },
        { label: 'Certificate builder', link: tab('/setting', 'certificate'), show: can('settings') },
        { label: 'Rules & policies', link: tab('/setting', 'Rules & Policies'), show: true },
        { label: 'Security', link: tab('/setting', 'security'), show: true },
        { label: 'Contact support', link: tab('/setting', 'contact'), show: true },
      ],
    },
  ];
  // drop what the role cannot open; a group with nothing left disappears; an empty section too
  const kept = groups
    .map((g) => (g.children ? { ...g, children: g.children.filter((c) => c.show) } : g))
    .filter((g) => g.section || (g.children ? g.children.length : g.show));
  return kept.filter((g, i) => !g.section || (kept[i + 1] && !kept[i + 1].section));
}

export default function SideBar({ collapsed, onClose }) {
  const trust = useSelector((state) => state.data.trustData);
  const pathname = usePathname();
  const search = useSearchParams();
  const { user } = useAuth();
  const can = useCan();
  const menu = useMemo(() => buildMenu(can), [can]);

  // is this link the page we are on? (path, and the ?tab= when the link has one)
  const isOn = (child, siblings = []) => {
    const [path, query] = child.link.split('?');
    const here = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
    if (!here) return false;
    if (!query) return true;
    const want = new URLSearchParams(query).get('tab');
    const now = search.get('tab');
    if (!now) return siblings.findIndex((s) => s.link.startsWith(path)) === siblings.indexOf(child) || child.isDefault;
    return now === want || (child.match || []).includes(now);
  };
  const groupOn = (g) => (g.children ? g.children.some((c) => isOn(c, g.children)) : isOn(g));

  const [open, setOpen] = useState({});
  useEffect(() => {
    try { setOpen(JSON.parse(localStorage.getItem(OPEN_KEY) || '{}')); } catch { /* ignore */ }
  }, []);
  // the group of the page we are on is always open
  useEffect(() => {
    const g = menu.find((x) => x.children && groupOn(x));
    if (g && !open[g.key]) setOpen((o) => ({ ...o, [g.key]: true }));
  }, [pathname, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (key) => setOpen((o) => {
    const next = { ...o, [key]: !o[key] };
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  const staff = user?.access && !user.access.isSuper;
  const personName = staff ? user.displayName : (user?.username || 'User');
  const roleName = staff ? user.access.roleName : 'Super Admin';
  const initials = (personName || 'U').trim().charAt(0).toUpperCase();

  const renderEntry = (g) => {
    const Icon = g.icon;
    const on = groupOn(g);

    // single page (Dashboard)
    if (!g.children) {
      const a = (
        <Link href={g.link} onClick={onClose} className={`sb-item ${on ? 'is-active' : ''} ${collapsed ? 'is-collapsed' : ''}`}>
          <span className="sb-icon"><Icon size={17} /></span>
          {!collapsed && <span className="sb-label">{g.label}</span>}
        </Link>
      );
      return <li key={g.key}>{collapsed ? <Tooltip title={g.label} placement="right">{a}</Tooltip> : a}</li>;
    }

    // collapsed sidebar: the icon opens a fly-out with the sub-pages
    if (collapsed) {
      return (
        <li key={g.key}>
          <Dropdown
            placement="rightTop"
            trigger={['hover', 'click']}
            menu={{
              items: [
                { type: 'group', label: g.label, children: g.children.map((c) => ({ key: c.link, label: <Link href={c.link} onClick={onClose}>{c.label}</Link> })) },
              ],
              selectedKeys: g.children.filter((c) => isOn(c, g.children)).map((c) => c.link),
            }}
          >
            <button type="button" className={`sb-item is-collapsed ${on ? 'is-active' : ''}`} aria-label={g.label}>
              <span className="sb-icon"><Icon size={17} /></span>
            </button>
          </Dropdown>
        </li>
      );
    }

    const isOpen = !!open[g.key];
    return (
      <li key={g.key}>
        <button type="button" onClick={() => toggle(g.key)} className={`sb-item sb-group ${on ? 'is-current' : ''}`} aria-expanded={isOpen}>
          <span className="sb-icon"><Icon size={17} /></span>
          <span className="sb-label flex-1 text-left">{g.label}</span>
          <FiChevronDown size={15} className="sb-chevron" style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} />
        </button>
        <div className="sb-sub" style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}>
          <ul className="sb-sub-inner">
            {g.children.map((c) => {
              const active = isOn(c, g.children);
              return (
                <li key={c.link}>
                  <Link href={c.link} onClick={onClose} className={`sb-subitem ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                    <span className="sb-dot" />
                    <span className="truncate">{c.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </li>
    );
  };

  return (
    <>
      <style>{`
        .sb-root {
          font-family: 'Outfit', sans-serif;
          background: linear-gradient(180deg, var(--sb-bg1) 0%, var(--sb-bg2) 100%);
          border-right: 1px solid var(--sb-border);
          color: var(--sb-text);
        }
        .sb-head { border-bottom: 1px solid var(--sb-border); }
        .sb-logo {
          width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0; overflow: hidden;
          display: flex; align-items: center; justify-content: center;
          background: #fff; box-shadow: 0 0 0 2px var(--sb-border), 0 6px 16px rgba(0,0,0,0.18);
        }
        .sb-logo img { width: 100%; height: 100%; object-fit: contain; }
        .sb-logo-fallback {
          width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, var(--brand), var(--brand-hover)); color: #fff; font-weight: 700; font-size: 14px;
        }
        .sb-title { color: var(--sb-logo-text); font-weight: 700; font-size: 15px; line-height: 1.2; letter-spacing: -0.01em; }
        .sb-sub-title { color: var(--sb-dim); font-size: 11.5px; margin-top: 2px; }

        .sb-section { font-size: 10.5px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--sb-dim); padding: 0 12px; margin: 18px 0 8px; }
        .sb-section:first-child { margin-top: 0; }
        .sb-section-rule { border: 0; border-top: 1px solid var(--sb-border); margin: 14px 8px; }
        .sb-list { display: flex; flex-direction: column; gap: 2px; }

        .sb-item {
          position: relative; display: flex; align-items: center; gap: 12px; width: 100%;
          padding: 7px 10px; border-radius: 10px; color: var(--sb-muted); font: inherit;
          background: transparent; border: 0; cursor: pointer; transition: background .15s, color .15s;
        }
        .sb-item:hover { background: var(--sb-hover); color: var(--sb-text); }
        .sb-item:focus, .sb-subitem:focus { outline: none; }
        .sb-item:focus-visible, .sb-subitem:focus-visible { box-shadow: inset 0 0 0 2px var(--sb-accent); }
        .sb-item.is-collapsed { justify-content: center; padding: 7px 0; }
        .sb-icon {
          width: 34px; height: 34px; border-radius: 9px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: var(--sb-icon-bg); color: var(--sb-icon); transition: background .15s, color .15s, box-shadow .15s;
        }
        .sb-item:hover .sb-icon { color: var(--sb-text); }
        .sb-label { font-size: 14px; font-weight: 600; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sb-chevron { color: var(--sb-dim); transition: transform .2s; flex-shrink: 0; }

        /* the page we are on: a single item, or the collapsed group icon */
        .sb-item.is-active { background: var(--sb-active-bg); color: var(--sb-active-text); }
        .sb-item.is-active::before {
          content: ''; position: absolute; left: -12px; top: 9px; bottom: 9px; width: 4px;
          border-radius: 0 4px 4px 0; background: var(--sb-accent);
        }
        .sb-item.is-active .sb-icon,
        .sb-group.is-current .sb-icon { background: var(--sb-active-icon-bg); color: var(--sb-active-icon); box-shadow: 0 4px 12px var(--brand-shadow); }
        .sb-group.is-current { color: var(--sb-text); }

        /* sub-menu: animated open / close */
        .sb-sub { display: grid; transition: grid-template-rows .22s ease; }
        .sb-sub-inner { overflow: hidden; min-height: 0; margin: 0 0 0 26px; padding-left: 14px; border-left: 1px solid var(--sb-border); }
        .sb-sub-inner > li:first-child { margin-top: 4px; }
        .sb-sub-inner > li:last-child { margin-bottom: 6px; }
        .sb-subitem {
          position: relative; display: flex; align-items: center; gap: 10px;
          padding: 7px 10px; margin: 1px 0; border-radius: 8px;
          font-size: 13.5px; font-weight: 500; color: var(--sb-muted); transition: background .15s, color .15s;
        }
        .sb-subitem:hover { background: var(--sb-hover); color: var(--sb-text); }
        .sb-dot { width: 6px; height: 6px; border-radius: 99px; background: var(--sb-dim); flex-shrink: 0; opacity: .7; transition: all .15s; }
        .sb-subitem.is-active { background: var(--sb-active-bg); color: var(--sb-active-text); font-weight: 600; }
        .sb-subitem.is-active .sb-dot { background: var(--sb-accent); opacity: 1; box-shadow: 0 0 0 3px var(--sb-active-bg); }
        .sb-subitem.is-active::before {
          content: ''; position: absolute; left: -15px; top: 8px; bottom: 8px; width: 2px; border-radius: 2px; background: var(--sb-accent);
        }

        .sb-nav::-webkit-scrollbar { width: 4px; }
        .sb-nav::-webkit-scrollbar-thumb { background: var(--sb-border); border-radius: 99px; }

        .sb-user { background: var(--sb-card); border: 1px solid var(--sb-border); border-radius: 12px; }
        .sb-avatar {
          width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, var(--brand), var(--brand-hover)); color: #fff; font-weight: 700; font-size: 14px;
        }
        .sb-user-name { color: var(--sb-text); font-weight: 600; font-size: 13px; line-height: 1.2; }
        .sb-role {
          display: inline-block; margin-top: 3px; font-size: 10.5px; font-weight: 600; letter-spacing: .02em;
          padding: 1px 7px; border-radius: 99px; background: var(--sb-icon-bg); color: var(--sb-muted);
        }
        @media (max-height: 760px) {
          .sb-icon { width: 30px; height: 30px; }
          .sb-item { padding-top: 5px; padding-bottom: 5px; }
          .sb-subitem { padding-top: 5px; padding-bottom: 5px; }
        }
      `}</style>

      <aside className={`sb-root flex flex-col h-full transition-all duration-300 ease-in-out ${collapsed ? 'w-20' : 'w-72'}`}>
        {/* Trust */}
        <div className={`sb-head flex items-center h-16 px-4 flex-shrink-0 ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <div className="sb-logo">
            {trust?.logo ? <img src={trust.logo} alt="Logo" /> : <div className="sb-logo-fallback">{trustInitials(trust)}</div>}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="sb-title truncate max-w-[12rem]" title={trustDisplayName(trust)}>{trustDisplayName(trust)}</div>
              <div className="sb-sub-title">Admin Panel</div>
            </div>
          )}
        </div>

        {/* Menu */}
        <nav className="sb-nav flex-1 min-h-0 overflow-y-auto py-4 px-3">
          <ul className="sb-list">
            {menu.map((g, i) => (g.section
              ? <li key={`s-${g.section}`}>{collapsed ? (i ? <hr className="sb-section-rule" /> : null) : <p className="sb-section">{g.section}</p>}</li>
              : renderEntry(g)))}
          </ul>
        </nav>

        {/* Who is logged in */}
        <div className="px-3 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--sb-border)' }}>
          {collapsed ? (
            <Tooltip title={`${personName} · ${roleName}`} placement="right">
              <div className="sb-avatar mx-auto">{initials}</div>
            </Tooltip>
          ) : (
            <div className="sb-user flex items-center gap-3 p-2.5">
              <div className="sb-avatar">{initials}</div>
              <div className="min-w-0 flex-1">
                <div className="sb-user-name truncate">{personName}</div>
                <span className="sb-role">{roleName}</span>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
