const STEPS = ['profile', 'availability', 'meeting_type'];

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
      <div className="onboarding-card">{children}</div>
    </div>
  );
}
