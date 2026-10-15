"use client";
// Master data in the browser: loaded once after login (Layout), kept in redux `state.data.masterData`
// and in a module cache that the label helpers in lib/staticData.js read (PDFs, lists).
import { api } from "./api";
import { setMasterCache } from "../masterCache";

export const MASTER_CHANGED = "mgsf:master-changed";

export async function loadMasterData() {
  const { lists } = await api.get("/master-data");
  setMasterCache(lists);
  return lists;
}

/** Tell other open tabs (and this one) that lists changed */
export function notifyMasterChanged() {
  try { new BroadcastChannel("mgsf-master").postMessage("changed"); } catch { /* old browser */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MASTER_CHANGED));
}

export function onMasterChanged(cb) {
  let ch;
  try { ch = new BroadcastChannel("mgsf-master"); ch.onmessage = cb; } catch { /* old browser */ }
  window.addEventListener(MASTER_CHANGED, cb);
  return () => { ch?.close(); window.removeEventListener(MASTER_CHANGED, cb); };
}

/** Select options */
export const toOptions = (list = []) => list.map((x) => ({ value: x.value, label: x.label }));
export const districtsOf = (lists, state) => (lists?.district || []).filter((d) => d.parentValue === state);

/**
 * Lists for forms. Until Master Data has loaded the built-in lists are used, so forms never show empty.
 * → { states, districtsByState: { rajasthan: [...] }, relations, castes, gotras }
 */
export function buildMasterLists(master, fallback) {
  if (!master?.loaded) {
    return { states: fallback.states, districtsByState: fallback.districtsByState, relations: fallback.relations, castes: [], gotras: [] };
  }
  const districtsByState = {};
  for (const d of master.district || []) (districtsByState[d.parentValue] ||= []).push({ value: d.value, label: d.label, label_en: d.labelEn });
  return {
    states: (master.state || []).map((s) => ({ value: s.value, label: s.label })),
    districtsByState,
    // free-text lists: members store the text itself, so the (renamed) label is what gets saved
    relations: (master.relation || []).map((x) => ({ value: x.label, label: x.label })),
    castes: (master.caste || []).map((x) => ({ value: x.label, label: x.label })),
    gotras: (master.gotra || []).map((x) => ({ value: x.label, label: x.label })),
  };
}
