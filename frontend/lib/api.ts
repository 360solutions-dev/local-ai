interface ApiResponse<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T;
}

async function safeJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    // Return a generic error structure if response isn't JSON
    return { error: { message: text || `HTTP ${res.status}` } } as T;
  }
}

export async function apiPost<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ApiResponse<T>> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  });

  const data = await safeJson<T>(res);
  return { ok: res.ok, status: res.status, data };
}

export async function apiPatch<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

  const data = await safeJson<T>(res);
  return { ok: res.ok, status: res.status, data };
}

export async function apiGet<T = Record<string, unknown>>(
  path: string,
): Promise<ApiResponse<T>> {
  const res = await fetch(path, { credentials: "include" });
  const data = await safeJson<T>(res);
  return { ok: res.ok, status: res.status, data };
}

export async function apiDelete<T = Record<string, unknown>>(
  path: string,
): Promise<ApiResponse<T>> {
  const res = await fetch(path, {
    method: "DELETE",
    credentials: "include",
  });

  const data = await safeJson<T>(res);
  return { ok: res.ok, status: res.status, data };
}

export async function apiUpload<T = Record<string, unknown>>(
  path: string,
  file: File,
  extraFields?: Record<string, string>,
): Promise<ApiResponse<T>> {
  const formData = new FormData();
  formData.append("file", file);
  if (extraFields) {
    for (const [k, v] of Object.entries(extraFields)) formData.append(k, v);
  }

  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  const data = await safeJson<T>(res);
  return { ok: res.ok, status: res.status, data };
}

export async function apiUploadBlob<T = Record<string, unknown>>(
  path: string,
  blob: Blob,
  fieldName = "file",
  filename = "upload",
  extraFields?: Record<string, string>,
): Promise<ApiResponse<T>> {
  const formData = new FormData();
  formData.append(fieldName, blob, filename);
  if (extraFields) {
    for (const [k, v] of Object.entries(extraFields)) formData.append(k, v);
  }

  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  const data = await safeJson<T>(res);
  return { ok: res.ok, status: res.status, data };
}

export async function apiDownload(path: string, filename: string): Promise<void> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
