import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { peekPostOnboardingRedirect } from '../../lib/postAuthRedirect.js';

const STEPS = ['profile', 'availability', 'meeting_type'];
const ROLE_LABELS = { pa: 'PA', delegate: 'delegate' };

function InviteContextBanner() {
  const [invite, setInvite] = useState(null);

  useEffect(() => {
    const stashed = peekPostOnboardingRedirect();
    const match = stashed && /^\/accept-invite\/([^/?]+)/.exec(stashed);
    if (!match) return;
    api.get(`/invites/${match[1]}`).then((data) => setInvite(data.invite)).catch(() => {});
  }, []);

  if (!invite) return null;

  return (
    <div className="alert alert-success" style={{ maxWidth: 520, width: '100%', marginBottom: 20 }}>
      You're setting up your own Kairos account — this gives you your own calendar and booking
      page too, not just access to {invite.ownerName}'s. Once you finish, you'll come back here to
      accept {invite.ownerName}'s invite to be their {ROLE_LABELS[invite.role]}.
    </div>
  );
}

export default function OnboardingLayout({ step, children }) {
  const activeIndex = STEPS.indexOf(step);
  return (
    <div className="onboarding-shell">
      <div className="onboarding-steps">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={
              'onboarding-step-dot' +
              (i === activeIndex ? ' is-active' : i < activeIndex ? ' is-done' : '')
            }
          />
        ))}
      </div>
      {step === 'profile' && <InviteContextBanner />}
      <div className="onboarding-card">{children}</div>
    </div>
  );
}
