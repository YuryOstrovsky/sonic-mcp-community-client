/**
 * Global toast helpers.
 *
 * Thin wrapper over `sonner` so callers can `notify.ok("saved")` without
 * knowing the underlying library. If we swap the toast library later,
 * this is the only file that changes.
 *
 * The <Toaster /> component must be mounted once in App.tsx.
 */

import {toast} from "sonner";

export const notify = {
  ok:   (msg: string, description?: string) => toast.success(msg, description ? {description} : undefined),
  err:  (msg: string, description?: string) => toast.error(msg, description ? {description} : undefined),
  warn: (msg: string, description?: string) => toast.warning(msg, description ? {description} : undefined),
  info: (msg: string, description?: string) => toast(msg, description ? {description} : undefined),
  /**
   * Convenience for mutation results — picks success vs error based on
   * the server envelope, and includes the mutation_id in the description
   * so the user can jump to it in the Activity view.
   */
  mutationResult: (tool: string, payload: any, ok: boolean) => {
    if (ok) {
      const summary = payload?.summary ?? {};
      const changed = summary.changed;
      const note = summary.note ?? "";
      const desc = changed === false ? "no-op (state already matched)" : note;
      toast.success(`${tool} succeeded`, {
        description: desc || undefined,
      });
    } else {
      const err = payload?.error ?? payload?.detail ?? "see result for details";
      toast.error(`${tool} failed`, {
        description: typeof err === "string" ? err.slice(0, 200) : "unknown error",
      });
    }
  },
};
