import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';

// One navigation for the whole app.
//
// Kairos grew to roughly eighteen screens reachable through per-page topbar
// links that differed on every page, which is how a tool for busy people
// becomes work in itself. This is the single source of navigation: the same
// rail everywhere, one active state, and the principal switcher in a fixed
// place so "who am I doing this for" is never a guess.

const NAV = [
  { to: '/today', label: 'Today', icon: '◉', principalScoped: true },
  { to: '/itinerary', label: 'Itinerary', icon: '✈', principalScoped: true },
  { to: '/dashboard?tab=calendar', match: '/dashboard', label: 'Calendar', icon: '▤' },
  { to: '/tasks', label: 'Tasks', icon: '✓' },
  { to: '/spaces', label: 'Spaces', icon: '❑' },
  { to: '/pa?tab=contacts', match: '/pa', label: 'People', icon: '☺', principalScoped: true },
  { to: '/pa?tab=approvals', match: '/pa', label: 'Approvals', icon: '!', principalScoped: true, badge: 'approvals' },
  { to: '/pa?tab=briefs', match: '/pa', label: 'Briefs', icon: '❋', principalScoped: true },
  { to: '/pa?tab=availability', match: '/pa', label: 'Scheduling', icon: '◷', principalScoped: true, needsScheduling: true },
  { to: '/dashboard?tab=settings', match: '/dashboard', label: 'Settings', icon: '⚙' },
];

// Which principal the PA-scoped screens are acting for.
//
// Only an *explicit* choice from the switcher is stored. Persisting a computed
// default looked equivalent and wasn't: an assistant who opened the app before
// accepting an invite had their own id written down, and because that id stays
// a valid member of the list forever, they were still pointed at their own
// account after accepting — with nothing on screen suggesting they should
// switch. Recomputing the default every load keeps it honest.
const ACTIVE_KEY = 'kairos_active_principal';
export function getActivePrincipal() {
  try { return localStorage.getItem(ACTIVE_KEY) || null; } catch { return null; }
}
export function setActivePrincipal(id) {
  try { id ? localStorage.setItem(ACTIVE_KEY, id) : localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
}

export default function AppShell({ children, title, actions, active }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [principals, setPrincipals] = useState([]);
  const [activeId, setActiveId] = useState(getActivePrincipal() || user?.id || null);
  const [badges, setBadges] = useState({ approvals: 0 });
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    api.get('/pa/principals').then((d) => {
      setPrincipals(d.principals);
      const stored = getActivePrincipal();
      const chosen = stored && d.principals.some((p) => p.id === stored) ? stored : null;
      // Default to whoever you actually support; your own account is the
      // fallback, not the assumption.
      const preferred = d.principals.find((p) => p.role !== 'owner') || d.principals[0];
      setActiveId(chosen || preferred?.id || null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeId) return;
    api.get(`/pa/${activeId}/approvals`)
      .then((d) => setBadges((b) => ({ ...b, approvals: d.bookings.length })))
      .catch(() => {});
  }, [activeId]);

  function switchPrincipal(id) {
    setActivePrincipal(id);
    setActiveId(id);
    // Reload rather than patch state everywhere: every principal-scoped screen
    // must refetch, and a half-switched view is worse than a beat of delay.
    window.location.reload();
  }

  async function handleLogout() {
    setActivePrincipal(null);
    await logout();
    navigate('/login');
  }

  const current = principals.find((p) => p.id === activeId);
  const actingForSomeoneElse = current && current.role !== 'owner';

  return (
    <div className="app">
      <aside className={'app-nav' + (navOpen ? ' is-open' : '')}>
        <div className="app-brand">
          <Link to="/today">Kairos</Link>
          <button
            className="nav-close"
            type="button"
            aria-label="Close menu"
            onClick={() => setNavOpen(false)}
          >
            ✕
          </button>
        </div>

        {principals.length > 1 && (
          <div className="principal-switcher">
            <label htmlFor="principal-select">Working on</label>
            <select
              id="principal-select"
              value={activeId || ''}
              onChange={(e) => switchPrincipal(e.target.value)}
            >
              {principals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.role === 'owner' ? `${p.name} (you)` : p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav>
          {NAV.filter((item) => !item.needsScheduling || current?.canManageScheduling !== false).map((item) => {
            // Only pin a principal into the URL once the list has actually
            // loaded. Before that, activeId is a guess (your own id), and a
            // fast click would open your own account instead of the person you
            // support. Linking to bare /pa lets PaHome resolve the right
            // principal itself, preserving the tab.
            const to = item.principalScoped && item.to.startsWith('/pa')
              ? (principals.length > 0 && activeId
                ? `/pa/${activeId}?tab=${item.to.split('tab=')[1]}`
                : item.to)
              : item.to;
            const count = item.badge ? badges[item.badge] : 0;
            return (
              <NavLink
                key={item.label}
                to={to}
                className={() => 'nav-item' + (active === item.label.toLowerCase() ? ' is-active' : '')}
                onClick={() => setNavOpen(false)}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
                {count > 0 && <span className="nav-badge">{count}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="app-nav-foot">
          <div className="nav-user">{user?.name}</div>
          <button className="btn btn-secondary btn-sm" type="button" onClick={handleLogout}>Log out</button>
        </div>
      </aside>

      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}

      <main className="app-main">
        <header className="app-header">
          <button
            className="nav-toggle"
            type="button"
            aria-label="Open menu"
            onClick={() => setNavOpen(true)}
          >
            ☰
          </button>
          <div className="app-header-title">
            <h1>{title}</h1>
            {actingForSomeoneElse && (
              <p className="app-header-sub">for {current.name}</p>
            )}
          </div>
          <div className="app-header-actions">{actions}</div>
        </header>
        <div className="app-body">{children}</div>
      </main>
    </div>
  );
}
