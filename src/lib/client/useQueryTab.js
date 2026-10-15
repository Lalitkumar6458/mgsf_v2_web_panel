"use client";
// A page tab kept in the URL (?tab=late) so the sidebar's sub-menu can open it and highlight it,
// and a reload / shared link lands on the same tab. Pages using it must sit inside <Suspense>.
import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useQueryTab(defaultKey, keys) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromUrl = sp.get("tab");
  const tab = fromUrl && (!keys || keys.includes(fromUrl)) ? fromUrl : defaultKey;
  const setTab = useCallback((k) => {
    const q = new URLSearchParams(sp.toString());
    q.set("tab", k);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }, [sp, router, pathname]);
  return [tab, setTab];
}
