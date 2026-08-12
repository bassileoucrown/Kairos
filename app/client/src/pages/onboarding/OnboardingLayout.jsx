import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { peekPostOnboardingRedirect } from '../../lib/postAuthRedirect.js';
import { BRAND_SHORT } from '../../lib/brand.js';

const STEPS = ['profile', 'meeting_type'];

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
      You're setting up your own {BRAND_SHORT} account — this gives you your own calendar and booking
      page too, not just access to {invite.ownerName}'s. Once you finish, you'll come back here to
      accept {invite.ownerName}'s invite to be their {invite.roleLabel}.
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
