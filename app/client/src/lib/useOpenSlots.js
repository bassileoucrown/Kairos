import { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

export function useOpenSlots({ ownerSlug, meetingSlug, excludeBookingId }) {
  const [slots, setSlots] = useState(null);
  const [ownerTimezone, setOwnerTimezone] = useState('UTC');
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    if (!ownerSlug || !meetingSlug) return;
    const qs = excludeBookingId ? `?excludeBookingId=${encodeURIComponent(excludeBookingId)}` : '';
    api.get(`/public/${ownerSlug}/${meetingSlug}/slots${qs}`)
      .then((data) => {
        setSlots(data.slots);
        setOwnerTimezone(data.ownerTimezone);
      })
      .catch((err) => setError(err.message));
  }, [ownerSlug, meetingSlug, excludeBookingId]);

  useEffect(reload, [reload]);

  return { slots, ownerTimezone, error, reload };
}
