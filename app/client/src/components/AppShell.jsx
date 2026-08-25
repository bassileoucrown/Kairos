import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { BRAND_FULL } from '../lib/brand.js';
import TimeUp from './TimeUp.jsx';
import PadDock from './PadDock.jsx';

// One navigation for the whole app.
//
// Kairos grew to roughly eighteen screens reachable through per-page topbar
// links that differed on every page, which is how a tool for busy people
// becomes work in itself. This is the single source of navigation: the same
// rail everywhere, one active state, and the principal switcher in a fixed
// place so "who am I doing this for" is never a guess.

// Five groups, not one list of eighteen.
//
// The rail grew an entry per feature until it was a filing cabinet — which is
// the thing this component's own comment says it exists to prevent. Two
// changes, and neither hides a screen: every URL that worked still works.
//
// THE GROUPS. An eighteen-item list is read by scanning all eighteen. Five
// labelled groups of three or four are read by picking the group first, which
// is how anybody thinks about where a thing lives — the day, the desk, the
// work, the house, the account.
//
// AND THE DESK IS ONE ENTRY. Approvals, People, Briefs and Scheduling were
// four rail entries pointing at four tabs of the same page. The tabs already
// do that job, and doing it twice meant the rail listed the inside of a screen
// instead of the screen. One entry, carrying the badge that mattered.
const GROUPS = [
  { id: 'day', label: 'The day' },
  { id: 'desk', label: 'The desk' },
  { id: 'work', label: 'Work' },
  { id: 'house', label: 'The house' },
  { id: 'account', label: 'Account' },
];

// `assistantOnly` / `principalOnly` keep each role's rail to what that role
// actually does. An assistant has no Team screen to manage (appointing people
// is the principal's), and a principal has no workspace of principals.
const NAV = [
  { group: 'day', to: '/today', label: 'Today', icon: '◉', principalScoped: true, badge: 'requests' },
  { group: 'day', to: '/itinerary', label: 'Itinerary', icon: '✈', principalScoped: true },
  // Deliberately NOT principalScoped, unlike everything around it. A note you
  // jotted is yours, and it should follow you between the principals you
  // support rather than hiding on whichever account you happened to be
  // looking at when the thought arrived.
  { group: 'day', to: '/pad', label: 'Pad', icon: '✎' },
  { group: 'day', to: '/trips', label: 'Trips', icon: '⛳', principalScoped: true },
  // Principal-scoped, like the three above it. It was the one entry in "The
  // day" that was not, so it went to /dashboard — the signed-in user's own
  // account. For a principal that is right by accident; for an assistant it
  // meant the rail's Calendar opened their own empty diary while the person
  // they support had a month full of things, reachable only from a tab on the
  // Desk. A calendar belongs to whoever you are acting for.
  { group: 'day', to: '/pa?tab=calendar', match: '/pa', label: 'Calendar', icon: '▤', principalScoped: true },
  // Marked in the rail rather than only on the page: somebody deciding whether
  // to rely on this should learn it is not open before they click, not after.
  { group: 'day', to: '/concierge', label: 'Concierge', icon: '☏', principalScoped: true, soon: true },

  { group: 'desk', to: '/workspace', label: 'Workspace', icon: '◈', assistantOnly: true },
  // One door to the whole desk. What used to be four rail entries is four tabs
  // behind this one, which is where they already were.
  { group: 'desk', to: '/pa?tab=approvals', match: '/pa', label: 'Desk', icon: '☰', principalScoped: true, badge: 'approvals' },

  { group: 'work', to: '/spaces', label: 'Spaces', icon: '❑', badge: 'messages' },
  { group: 'work', to: '/tasks', label: 'Tasks', icon: '✓', badge: 'tasks' },

  { group: 'house', to: '/household', label: 'Household', icon: '⌂', principalScoped: true, fullAccessOnly: true, notForStaff: true },
  { group: 'house', to: '/instructions', label: 'Instructions', icon: '➜', householdOnly: true },
  { group: 'house', to: '/connections', label: 'Connections', icon: '@' },

  { group: 'account', to: '/dashboard?tab=settings', match: '/dashboard', label: 'Settings', icon: '⚙' },
  { group: 'account', to: '/dashboard?tab=members', match: '/dashboard', label: 'Team', icon: '⚉', principalOnly: true },
  { group: 'account', to: '/notices', label: 'Notices', icon: '✦', badge: 'notices' },
  // Last, deliberately. It is a roadmap rather than a place to work, and
  // somebody being shown the product should be able to find it without it
  // competing with anything they actually use.
  { group: 'account', to: '/coming', label: 'Coming', icon: '◷' },
];

const ASSISTANT_CATEGORIES = new Set(['pa', 'ea', 'chief_of_staff']);

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

/**
 * Who a principal-scoped screen is acting for, resolved the same way
 * everywhere: an explicit switcher choice, else the first principal you
 * actually support, else yourself.
 *
 * Pages used to do `getActivePrincipal() || user.id`, which quietly defaulted
 * an assistant to their own account — so an assistant who had never touched
 * the switcher would draft a principal's flights onto their own itinerary and
 * wonder why nothing reached them. The switcher agrees with this, so the rail
 * and the page can no longer disagree about who is being worked on.
 */
export async function resolveActivePrincipal(user) {
  const stored = getActivePrincipal();
  try {
    const { principals } = await api.get('/pa/principals');
    if (stored && principals.some((p) => p.id === stored)) return stored;
    const supported = principals.find((p) => p.role !== 'owner');
    return supported?.id || principals[0]?.id || user?.id || null;
  } catch {
    return stored || user?.id || null;
  }
}

/**
 * Back, meaning the screen you were just on.
 *
 * The rail says where everything is; it does not say where you came from. A
 * PA who opens an approval from Today, deals with it and wants Today again has
 * to work out which of eighteen entries they started from — and gets it wrong,
 * because the answer depends on a route they took a minute ago and are no
 * longer looking at. The browser knows. This is the browser's own back, put
 * where a thumb can reach it, since on a phone there is no visible one.
 *
 * It appears only when there is somewhere inside Kairos to go back TO. React
 * Router stamps each history entry with an index; at index zero this is the
 * first screen of the session, and "back" would mean leaving the app entirely
 * — a button that signs you out of your own tab is worse than no button.
 */
function BackButton() {
  const navigate = useNavigate();
  // Read per render rather than once: useLocation is what re-renders this on
  // every navigation, and the index it should report is the current one.
  useLocation();
  const canGoBack = (window.history.state?.idx ?? 0) > 0;
  if (!canGoBack) return null;
  return (
    <button className="app-back" type="button" aria-label="Back" onClick={() => navigate(-1)}>
      <span aria-hidden="true">←</span>
      <span className="app-back-word">Back</span>
    </button>
  );
}

function initials(name) {
  return (name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

// Sign out used to sit at the bottom of the sidebar, which is the one place
// nobody looks — and on a phone the sidebar is behind a hamburger, so it was
// effectively hidden. It belongs top-right, under the account name, which is
// where every other product puts it and where it stays visible at any width.
function AccountMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="account" ref={ref}>
      <button
        type="button"
        className="account-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="account-avatar" aria-hidden="true">{initials(user?.name)}</span>
        <span className="account-name">{user?.name}</span>
        <span className="account-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="account-menu" role="menu">
          <div className="account-menu-head">
            <div className="account-menu-name">{user?.name}</div>
            <div className="account-menu-email">{user?.email}</div>
          </div>
          <Link className="account-menu-item" role="menuitem" to="/dashboard?tab=settings" onClick={() => setOpen(false)}>
            Settings
          </Link>
          <button className="account-menu-item is-signout" role="menuitem" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppShell({ children, title, actions, active }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [principals, setPrincipals] = useState([]);
  const [activeId, setActiveId] = useState(getActivePrincipal() || user?.id || null);
  // Everything waiting for you, in one shape. Zeroes rather than nulls so the
  // rail never renders a badge it is about to take away again.
  const [badges, setBadges] = useState({
    approvals: 0, notices: 0, messages: 0, tasks: 0, requests: 0,
  });
  const [waiting, setWaiting] = useState(0);
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

  // Refetched on every navigation, which is when it can have changed from the
  // reader's point of view: they have just done something, or come back after
  // being away. Deliberately not polled — a rail that quietly renumbers itself
  // while somebody is reading it is a rail that makes them look twice.
  useEffect(() => {
    if (!activeId) return;
    let live = true;
    api.get(`/attention?principalId=${activeId}`)
      .then((d) => {
        if (!live) return;
        setBadges(d.counts);
        setWaiting(d.total);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [activeId, location.pathname, location.search]);

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
  const viewerIsAssistant = ASSISTANT_CATEGORIES.has(user?.accountCategory);

  const visible = NAV.filter((item) => {
    if (item.needsScheduling && current?.canManageScheduling === false) return false;
    if (item.assistantOnly && !viewerIsAssistant) return false;
    // Only shown to somebody who actually has a household post — for everyone
    // else it is a screen about nothing.
    if (item.householdOnly && !user?.isHouseholdStaff) return false;
    // The household is not the diary, so a delegate's scheduling-only remit
    // does not reach it.
    if (item.fullAccessOnly && current && current.role === 'delegate') return false;
    // Somebody who is only household staff has no household of their own to
    // run, and offering them the screen for it is the app talking about
    // itself. If they ever support anyone, it returns.
    if (item.notForStaff && user?.isHouseholdStaff && principals.length <= 1) return false;
    // Team stays visible to anyone who is not purely someone's assistant — a
    // principal always needs it, and someone who is both still has their own
    // account to staff.
    if (item.principalOnly && viewerIsAssistant && principals.length > 1) return false;
    return true;
  });

  return (
    <div className="app">
      <aside className={'app-nav' + (navOpen ? ' is-open' : '')}>
        <div className="app-brand">
          <Link to={viewerIsAssistant ? '/workspace' : '/today'}>{BRAND_FULL}</Link>
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
          {/* Filtered once, then grouped: a group with nothing left in it for
              this reader shows no heading rather than an empty one. */}
          {GROUPS.map((group) => {
            const items = visible.filter((item) => item.group === group.id);
            if (items.length === 0) return null;
            return (
              <div className="nav-group" key={group.id}>
                <div className="nav-group-label">{group.label}</div>
                {items.map((item) => {
                  // Only pin a principal into the URL once the list has actually
                  // loaded. Before that, activeId is a guess (your own id), and a
                  // fast click would open your own account instead of the person
                  // you support. Linking to bare /pa lets PaHome resolve the right
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
                      {item.soon && <span className="nav-soon">Soon</span>}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="app-nav-foot">
          <div className="nav-user">Signed in as {user?.name}</div>
        </div>
      </aside>

      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}

      {/* Wherever they are in Kairos, not only on Today: the point of a chime
          is that it reaches somebody who is looking at something else. */}
      <TimeUp principalId={activeId} />

      <main className="app-main">
        <header className="app-header">
          <button
            className="nav-toggle"
            type="button"
            /* The rail is off screen on a phone, so the only way to learn
               there is something in it is to open it. The dot is what makes
               opening it worth doing — and what makes not opening it safe. */
            aria-label={waiting > 0 ? `Open menu — ${waiting} waiting` : 'Open menu'}
            onClick={() => setNavOpen(true)}
          >
            ☰
            {waiting > 0 && <span className="nav-toggle-dot" aria-hidden="true" />}
          </button>
          <BackButton />
          <div className="app-header-title">
            <h1>{title}</h1>
            {actingForSomeoneElse && (
              <p className="app-header-sub">for {current.name}</p>
            )}
          </div>
          <div className="app-header-actions">
            {actions}
            <AccountMenu user={user} onSignOut={handleLogout} />
          </div>
        </header>
        <div className="app-body">{children}</div>
      </main>

      {/* On every screen inside the app, and — because it lives here rather
          than in each page — on none of the ones outside it: signing in, a
          stranger's booking page, and the driver's card do not render an
          AppShell, so they cannot accidentally sprout a pad.
          Not on the pad's own screen, which already has a composer at the top;
          two on one page would be a choice nobody asked for. */}
      {location.pathname !== '/pad' && <PadDock ownerId={activeId} />}
    </div>
  );
}
