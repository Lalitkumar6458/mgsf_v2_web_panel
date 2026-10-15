"use client";
import { useMemo } from "react";
import { useSelector } from "react-redux";
import { buildMasterLists } from "./masterData";
import { states, districtsByState, guardianRelations } from "../staticData";

/** Dropdown lists for member forms, from Master Data (falls back to the built-in lists while loading). */
export function useMasterLists() {
  const master = useSelector((s) => s.data.masterData);
  return useMemo(() => buildMasterLists(master, { states, districtsByState, relations: guardianRelations }), [master]);
}
