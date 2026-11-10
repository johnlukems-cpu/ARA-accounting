/** Development phases shown on the status page. Keep in sync with PROJECT_STATUS.md. */
export type PhaseState = "done" | "active" | "planned";

export const PHASES: ReadonlyArray<{ number: number; state: PhaseState }> = Array.from({ length: 13 }, (_, n) => ({
  number: n,
  state: n === 0 ? "done" : n === 1 ? "active" : "planned",
}));
