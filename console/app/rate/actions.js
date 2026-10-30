"use server";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function submitRating(_prev, formData) {
  const ticketId = Number(formData.get("ticketId")) || 0;
  const rating = String(formData.get("rating") || "");
  const signature = String(formData.get("s") || "");
  const body = { s: signature, rating };
  if (formData.has("comment")) body.comment = String(formData.get("comment") || "").slice(0, 1000);
  const response = await fetch(`${apiUrl}/v1/public/csat/${ticketId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { error: result.error || "Your rating was not saved. Try again.", rating: null, commented: false };
  return { error: "", rating, commented: formData.has("comment") };
}
