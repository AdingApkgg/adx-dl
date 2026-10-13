import { create } from "zustand";

/**
 * The single mascot instance (mounted by MascotWidget in the root layout) and
 * the mascot page talk through this store: she publishes how loading went and
 * what she can do; the page renders its own labelled controls and status for
 * her, so touch users get real buttons instead of the corner's hover toolbar.
 */
export type MascotStatus = "idle" | "loading" | "ready" | "failed";

export type MascotActions = {
  hitokoto: () => void;
  switchModel: () => void;
  switchTexture: () => void;
  photo: () => void;
  asteroids: () => void;
};

type MascotStore = {
  status: MascotStatus;
  actions: MascotActions | null;
  /** The mascot page's stage slot while it is mounted. */
  stage: HTMLElement | null;
};

export const useMascotStore = create<MascotStore>(() => ({
  status: "idle",
  actions: null,
  stage: null,
}));

export function setMascotStatus(status: MascotStatus): void {
  useMascotStore.setState({ status });
}

export function setMascotActions(actions: MascotActions | null): void {
  useMascotStore.setState({ actions });
}

export function setMascotStage(stage: HTMLElement | null): void {
  useMascotStore.setState({ stage });
}
