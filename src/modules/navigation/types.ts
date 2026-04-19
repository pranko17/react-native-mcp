export interface NavigationRoute {
  key: string;
  name: string;
  params?: unknown;
  state?: NavigationState;
}

export interface NavigationState {
  index: number;
  routes: NavigationRoute[];
}

export interface NavigationAction {
  type: string;
  payload?: Record<string, unknown>;
}

export interface NavigationRef {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addListener: (event: string, callback: (...args: any[]) => void) => () => void;
  canGoBack: () => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch: (action: any) => void;
  getCurrentRoute: () => unknown;
  getRootState: () => unknown;
  goBack: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  navigate: (...args: any[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resetRoot: (...args: any[]) => void;
  isReady?: () => boolean;
}

export interface NavigationHistoryEntry {
  route: {
    key: string;
    name: string;
    params?: unknown;
  };
  timestamp: string;
  state?: NavigationState;
}
