export type Utility = 'electricity' | 'water';
export type District = { id: string; name: string; center: [number, number] | null };
export type Locality = { id: string; name: string; district: string; lat?: number; lng?: number };

export type Outage = {
  id: number;
  utility: Utility;
  kind: 'planned' | 'interruption' | 'schedule' | 'advisory' | 'news' | 'community';
  source: 'ceb' | 'cwa' | 'community' | 'admin';
  status: 'upcoming' | 'ongoing' | 'ended' | 'cancelled';
  title: string;
  details: string | null;
  areaLabel: string | null;
  district: string | null;
  scope: 'locality' | 'district' | 'national';
  localities: string[];
  startsAt: string;
  endsAt: string | null;
  url: string | null;
  attachmentUrl: string | null;
  imageUrl: string | null;
  confirmations: number;
};

export type Report = {
  id: number;
  utility: Utility;
  locality: string;
  description: string;
  status: string;
  created_at: number;
  similar: number;
};

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Error ${res.status}`);
  return data as T;
}

const qs = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : '';
};

export const api = {
  localities: () => request<{ districts: District[]; localities: Locality[] }>('GET', '/localities'),
  outages: (p: { utility?: Utility; district?: string; locality?: string; window?: 'current' | 'past' }) =>
    request<{ outages: Outage[] }>('GET', `/outages${qs(p)}`),
  communiques: (offset: number) => request<{ items: Outage[]; total: number }>('GET', `/communiques?offset=${offset}`),
  outage: (id: number) => request<{ outage: Outage }>('GET', `/outages/${id}`),
  confirm: (id: number) => request<{ confirmations: number }>('POST', `/outages/${id}/confirm`),
  report: (body: { utility: Utility; locality: string; description: string }) =>
    request<{ id: number }>('POST', '/reports', body),

  pushKey: () => request<{ publicKey: string }>('GET', '/push/public-key'),
  subscribePush: (body: object) => request<{ unsubscribeToken: string }>('POST', '/subscriptions/webpush', body),
  subscribePhone: (body: object) => request<{ phone: string }>('POST', '/subscriptions/phone', body),
  verifyPhone: (body: object) => request<{ unsubscribeToken: string }>('POST', '/subscriptions/phone/verify', body),
  unsubscribe: (token: string) => request('POST', '/unsubscribe', { token }),

  admin: {
    reports: (token: string, status = 'pending') => request<{ reports: Report[] }>('GET', `/admin/reports?status=${status}`, undefined, token),
    moderate: (token: string, id: number, action: 'approve' | 'reject', notify: boolean) =>
      request('POST', `/admin/reports/${id}/${action}`, { notify }, token),
    addOutage: (token: string, body: object) => request<{ outage: Outage }>('POST', '/admin/outages', body, token),
    ingest: (token: string) => request<{ results: Array<{ source: string; found: number; created: number; error?: string }> }>('POST', '/admin/ingest', {}, token),
  },
};
