(function () {
  const form = document.getElementById('waitlist-form');
  const message = document.getElementById('form-message');
  const countEl = document.getElementById('waitlist-count');
  const yearEl = document.getElementById('year');

  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  function setMessage(text, kind) {
    message.textContent = text;
    message.classList.remove('is-success', 'is-error');
    if (kind) message.classList.add(kind);
  }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  async function loadCount() {
    try {
      const res = await fetch('/api/waitlist/count');
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.count === 'number' && data.count > 0) {
        countEl.textContent = `${data.count}+`;
      }
    } catch {
      // Silently ignore — social proof line just falls back to static copy.
    }
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]');
      const emailInput = document.getElementById('email');
      const nameInput = document.getElementById('name');
      const roleInput = document.getElementById('role');
      const companyInput = document.getElementById('company');

      const email = emailInput.value.trim();
      if (!email || !emailInput.checkValidity()) {
        setMessage('Please enter a valid email address.', 'is-error');
        emailInput.focus();
        return;
      }
      if (!roleInput.value) {
        setMessage('Please let us know which best describes you.', 'is-error');
        roleInput.focus();
        return;
      }

      submitBtn.disabled = true;
      setMessage('Joining…', null);

      try {
        const res = await fetch('/api/waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            name: nameInput.value.trim(),
            role: roleInput.value,
            company: companyInput.value,
            source: document.referrer || 'direct',
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setMessage(data.error || 'Something went wrong. Please try again.', 'is-error');
          submitBtn.disabled = false;
          return;
        }

        if (data.created) {
          setMessage(`You're in — ${ordinal(data.position)} on the waitlist. We'll be in touch.`, 'is-success');
        } else {
          setMessage("You're already on the waitlist — we'll be in touch.", 'is-success');
        }

        form.reset();
        submitBtn.disabled = false;
        loadCount();
      } catch {
        setMessage('Network error. Please try again in a moment.', 'is-error');
        submitBtn.disabled = false;
      }
    });
  }

  loadCount();
})();
