export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data as T;
}
