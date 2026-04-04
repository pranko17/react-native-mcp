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
  canGoBack: () => boolean;
  dispatch: (action: NavigationAction) => void;
  getCurrentRoute: () => unknown;
  getRootState: () => unknown;
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  resetRoot: (state?: Partial<NavigationState> | NavigationState) => void;
}
