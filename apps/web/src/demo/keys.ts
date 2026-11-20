/** Where the browser demo keeps its sandbox, and a tiny copy of who is signed in (read without booting the demo). */
export const STORAGE_KEY = "medvault-demo-v6";
export const SESSION_KEY = `${STORAGE_KEY}-session`;

/** True if a demo user may be signed in on this device. Cheap: does not load or start the demo. */
export function demoSessionHint(): boolean {
  try {
    return Boolean(localStorage.getItem(SESSION_KEY));
  } catch {
    return false;
  }
}
