async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message = data?.error || `Request failed (${res.status})`;
    // The body travels with the error. A refusal often carries the thing the
    // caller needs in order to recover — login answering "needsCode" is the
    // case that matters, and reading it out of the message text would be
    // guesswork.
    throw new ApiError(message, res.status, data);
  }
  return data;
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data || null;
  }
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body ?? {}),
  put: (path, body) => request('PUT', path, body ?? {}),
  // DELETE with a body, for the one place that needs it: confirming account
  // deletion with a password rather than a checkbox.
  del: (path, body) => request('DELETE', path, body),
};
