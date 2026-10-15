"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

/**
 * The Certificate Builder design a yojna's member certificates print with.
 * { template: null } = no design saved → the built-in certificate is used.
 */
export function useCertificateTemplate(programId, enabled = true) {
  const [state, setState] = useState({ loading: true, template: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setState({ loading: true, template: null });
    api.get("/certificate-templates/active", { programId })
      .then((r) => live && setState({ loading: false, template: r.template || null }))
      .catch(() => live && setState({ loading: false, template: null })); // no access / error → built-in
    return () => { live = false; };
  }, [programId, enabled]);
  return state;
}
