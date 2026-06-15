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

/**
 * Centralized session-expiry handling. The middleware only re-checks auth on
 * navigation, so if a user is sitting on a page when their access_token
 * expires (1h TTL), API calls start returning 401 and the UI would otherwise
 * render a misleading state (e.g. "No active provider") with the sidebar still
 * visible. On a 401 from any non-auth endpoint we force a full redirect to
 * /login, which clears all client cache and hides the app shell.
 */
function handleUnauthorized(status: number, path: string): void {
  if (status !== 401) return;
  if (typeof window === "undefined") return;
  // Auth endpoints legitimately return 401 (wrong password, logged-out /me
  // probe) — don't redirect-loop on those or while already on /login.
  if (path.startsWith("/api/auth/")) return;
  const here = window.location.pathname;
  if (here === "/login" || here === "/onboarding") return;
  window.location.href = "/login";
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

  handleUnauthorized(res.status, path);
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

  handleUnauthorized(res.status, path);
  const data = await safeJson<T>(res);
  return { ok: res.ok, status: res.status, data };
}

export async function apiGet<T = Record<string, unknown>>(
  path: string,
): Promise<ApiResponse<T>> {
  const res = await fetch(path, { credentials: "include" });
  handleUnauthorized(res.status, path);
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

  handleUnauthorized(res.status, path);
  const data = await safeJson<T>(res);
  return { ok: res.ok, status: res.status, data };
}

export type UploadProgressUpdate = {
  percent: number;
  phase: "uploading" | "indexing" | "complete";
};

export function apiUploadWithProgress<T = Record<string, unknown>>(
  path: string,
  file: File,
  extraFields: Record<string, string> | undefined,
  onProgress?: (update: UploadProgressUpdate) => void,
): Promise<ApiResponse<T>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);
    if (extraFields) {
      for (const [k, v] of Object.entries(extraFields)) {
        formData.append(k, v);
      }
    }

    xhr.upload.addEventListener("progress", (e) => {
      if (!onProgress || !e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 85);
      onProgress({ percent: pct, phase: "uploading" });
    });

    xhr.upload.addEventListener("load", () => {
      onProgress?.({ percent: 90, phase: "indexing" });
    });

    xhr.addEventListener("load", () => {
      handleUnauthorized(xhr.status, path);
      let data: T;
      try {
        data = JSON.parse(xhr.responseText) as T;
      } catch {
        data = {
          error: { message: xhr.responseText || `HTTP ${xhr.status}` },
        } as T;
      }
      const ok = xhr.status >= 200 && xhr.status < 300;
      if (ok) {
        onProgress?.({ percent: 100, phase: "complete" });
      }
      resolve({ ok, status: xhr.status, data });
    });

    xhr.addEventListener("error", () => {
      resolve({
        ok: false,
        status: 0,
        data: { error: { message: "Network error" } } as T,
      });
    });

    xhr.open("POST", path);
    xhr.withCredentials = true;
    onProgress?.({ percent: 0, phase: "uploading" });
    xhr.send(formData);
  });
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

  handleUnauthorized(res.status, path);
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

  handleUnauthorized(res.status, path);
  const data = await safeJson<T>(res);
  return { ok: res.ok, status: res.status, data };
}

export async function apiDownload(path: string, filename: string): Promise<void> {
  const res = await fetch(path, { credentials: "include" });
  handleUnauthorized(res.status, path);
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
