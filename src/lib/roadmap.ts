/** Development phases shown on the status page. Keep in sync with PROJECT_STATUS.md. */
export type PhaseState = "done" | "active" | "planned";

const DONE = 11; // highest completed phase

export const PHASES: ReadonlyArray<{ number: number; state: PhaseState }> = Array.from({ length: 13 }, (_, n) => ({
  number: n,
  state: n <= DONE ? "done" : n === DONE + 1 ? "active" : "planned",
}));
