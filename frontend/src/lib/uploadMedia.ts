import { api } from "./api";

export async function uploadMedia(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(api("/api/storage/upload"), {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  const payload = (await response.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };

  if (!response.ok || typeof payload.url !== "string") {
    const message =
      typeof payload.error === "string" && payload.error.trim().length > 0
        ? payload.error
        : "Upload failed";
    throw new Error(message);
  }

  return payload.url;
}
