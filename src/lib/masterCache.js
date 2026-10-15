// Tiny shared cache of the trust's master lists (filled in the browser after login).
// lib/staticData.js label helpers look here first and fall back to the built-in lists.
let cache = null;
export const setMasterCache = (lists) => { cache = lists || null; };
export const getMasterCache = () => cache;
