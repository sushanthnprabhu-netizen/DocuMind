const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000";

const TOKEN_KEY = "documind_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request(path, options = {}) {
  const token = getToken();

  const headers = {
    ...(options.body && !(options.body instanceof FormData)
      ? { "Content-Type": "application/json" }
      : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let detail = `Request failed: ${response.status}`;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch {
      // ignore parse errors
    }
    throw new Error(detail);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response;
}

export function getHealth() {
  return request("/health");
}

export function getBackendInfo() {
  return request("/");
}

// --- Auth ---

export function register(email, password, name) {
  return request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  });
}

export function login(email, password) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function logout() {
  return request("/auth/logout", { method: "POST" });
}

export function getMe() {
  return request("/auth/me");
}

// --- Documents ---

export function listDocuments() {
  return request("/documents");
}

export function uploadDocument(file) {
  const formData = new FormData();
  formData.append("file", file);

  return request("/documents/upload", {
    method: "POST",
    body: formData,
  });
}

export async function downloadDocument(id, filename) {
  const response = await request(`/documents/${id}/download`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function deleteDocument(id) {
  return request(`/documents/${id}`, { method: "DELETE" });
}

// --- Assistant ---

export function echo(data) {
  return request("/echo", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function askAssistant(question) {
  return request("/assistant/ask", {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

export { API_URL };
