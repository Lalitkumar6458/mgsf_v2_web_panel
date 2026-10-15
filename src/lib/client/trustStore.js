"use client";
// Small lists that belonged to the trust in Firestore (users/{uid}/contact, users/{uid}/policies)
// are now JSON maps on the trust row: { [id]: {...} }. These helpers keep the old add/update/delete feel.
import { api } from "./api";
import { ts } from "./legacy";

async function load(kind) {
  const { trust } = await api.get("/trust");
  return trust?.[kind] || {};
}

/** [{ id, ...data }] newest first; createdAt/updatedAt behave like Firestore Timestamps */
export async function listItems(kind) {
  const map = await load(kind);
  return Object.entries(map)
    .map(([id, d]) => ({ id, ...d, createdAt: ts(d.createdAt), updatedAt: ts(d.updatedAt) }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

export async function addItem(kind, data) {
  const map = await load(kind);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await api.patch("/trust", { [kind]: { ...map, [id]: { ...data, createdAt: now, updatedAt: now } } });
  return id;
}

export async function updateItem(kind, id, data) {
  const map = await load(kind);
  await api.patch("/trust", { [kind]: { ...map, [id]: { ...(map[id] || {}), ...data, updatedAt: new Date().toISOString() } } });
}

export async function deleteItem(kind, id) {
  const map = await load(kind);
  delete map[id];
  await api.patch("/trust", { [kind]: map });
}
