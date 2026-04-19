import { type McpModule } from '@/client/models/types';

import { type NavigationHistoryEntry, type NavigationRef, type NavigationState } from './types';

const MAX_HISTORY = 100;

const findFocusedRoute = (state: NavigationState): unknown => {
  const route = state.routes[state.index];
  if (!route) return null;
  if (route.state) {
    return {
      ...route,
      focusedChild: findFocusedRoute(route.state),
    };
  }
  return route;
};

const getCurrentRouteFromState = (
  state: NavigationState
): { key: string; name: string; params?: unknown } | null => {
  const route = state.routes[state.index];
  if (!route) return null;
  if (route.state) {
    return getCurrentRouteFromState(route.state);
  }
  return { key: route.key, name: route.name, params: route.params };
};

export const navigationModule = (navigation: NavigationRef): McpModule => {
  console.log('Navigation module initialized');
  const history: NavigationHistoryEntry[] = [];

  const recordEntry = (rootState: NavigationState) => {
    const route = getCurrentRouteFromState(rootState);
    if (!route) return;

    const last = history[history.length - 1];
    if (last && last.route.key === route.key) return;

    history.push({
      route,
      state: rootState,
      timestamp: new Date().toISOString(),
    });

    if (history.length > MAX_HISTORY) {
      history.shift();
    }
  };

  const setup = () => {
    const rootState = navigation.getRootState() as NavigationState | undefined;
    if (rootState) recordEntry(rootState);

    navigation.addListener('state', () => {
      const state = navigation.getRootState() as NavigationState | undefined;
      if (state) recordEntry(state);
    });
  };

  const waitForReady = () => {
    if (navigation.isReady?.() ?? true) {
      setup();
      return;
    }
    setTimeout(waitForReady, 100);
  };

  waitForReady();

  return {
    description:
      'React Navigation control: get current route/state/history, navigate, push, pop, replace, reset, go_back.',
    name: 'navigation',
    tools: {
      get_current_route: {
        description: 'Get the currently focused route name and params',
        handler: () => {
          return navigation.getCurrentRoute();
        },
      },
      get_current_route_state: {
        description:
          'Get the full state of the currently focused route including params, key, and nested navigator state',
        handler: () => {
          const rootState = navigation.getRootState() as NavigationState | undefined;
          if (!rootState) return { error: 'No navigation state available' };
          return findFocusedRoute(rootState);
        },
      },
      get_history: {
        description:
          'Get navigation history — a log of all screen transitions with timestamps. Use "full: true" to include full navigation state for each entry.',
        handler: (args) => {
          const offset = (args.offset as number) ?? 0;
          const limit = (args.limit as number) ?? 50;
          const full = (args.full as boolean) ?? false;

          const slice = history.slice(offset, offset + limit);

          if (full) {
            return { entries: slice, offset, total: history.length };
          }

          return {
            entries: slice.map((entry) => {
              return {
                key: entry.route.key,
                name: entry.route.name,
                params: entry.route.params,
                timestamp: entry.timestamp,
              };
            }),
            offset,
            total: history.length,
          };
        },
        inputSchema: {
          full: {
            description: 'Include full navigation state for each entry (default: false)',
            type: 'boolean',
          },
          limit: {
            description: 'Max entries to return (default: 50)',
            type: 'number',
          },
          offset: {
            description: 'Start index (default: 0)',
            type: 'number',
          },
        },
      },
      get_state: {
        description: 'Get the full navigation state tree',
        handler: () => {
          return navigation.getRootState();
        },
      },
      go_back: {
        description: 'Go back to the previous screen',
        handler: () => {
          if (navigation.canGoBack()) {
            navigation.goBack();
            return { success: true };
          }
          return { reason: 'Cannot go back', success: false };
        },
      },
      navigate: {
        description: 'Navigate to a screen. Reuses existing screen if it exists in the stack.',
        handler: (args) => {
          navigation.navigate(args.screen as string, args.params as Record<string, unknown>);
          return { currentRoute: navigation.getCurrentRoute(), success: true };
        },
        inputSchema: {
          params: { description: 'Optional route params', type: 'object' },
          screen: { description: 'Screen name to navigate to', type: 'string' },
        },
      },
      pop: {
        description: 'Pop one or more screens from the stack',
        handler: (args) => {
          const count = (args.count as number) || 1;
          navigation.dispatch({ payload: { count }, type: 'POP' });
          return { currentRoute: navigation.getCurrentRoute(), success: true };
        },
        inputSchema: {
          count: { description: 'Number of screens to pop (default: 1)', type: 'number' },
        },
      },
      pop_to: {
        description: 'Pop back to a specific screen in the stack',
        handler: (args) => {
          navigation.dispatch({
            payload: { name: args.screen as string, params: args.params },
            type: 'POP_TO',
          });
          return { currentRoute: navigation.getCurrentRoute(), success: true };
        },
        inputSchema: {
          params: { description: 'Optional route params', type: 'object' },
          screen: { description: 'Screen name to pop back to', type: 'string' },
        },
      },
      pop_to_top: {
        description: 'Pop to the first screen in the stack',
        handler: () => {
          navigation.dispatch({ type: 'POP_TO_TOP' });
          return { currentRoute: navigation.getCurrentRoute(), success: true };
        },
      },
      push: {
        description:
          'Push a new screen onto the stack. Always adds a new entry even if the screen already exists.',
        handler: (args) => {
          navigation.dispatch({
            payload: { name: args.screen as string, params: args.params },
            type: 'PUSH',
          });
          return { currentRoute: navigation.getCurrentRoute(), success: true };
        },
        inputSchema: {
          params: { description: 'Optional route params', type: 'object' },
          screen: { description: 'Screen name to push', type: 'string' },
        },
      },
      replace: {
        description: 'Replace the current screen with a new one',
        handler: (args) => {
          navigation.dispatch({
            payload: { name: args.screen as string, params: args.params },
            type: 'REPLACE',
          });
          return { currentRoute: navigation.getCurrentRoute(), success: true };
        },
        inputSchema: {
          params: { description: 'Optional route params', type: 'object' },
          screen: { description: 'Screen name to replace with', type: 'string' },
        },
      },
      reset: {
        description: 'Reset the current navigator state to specified routes',
        handler: (args) => {
          const routes = args.routes as Array<{ name: string; params?: Record<string, unknown> }>;
          const index = (args.index as number) ?? routes.length - 1;
          navigation.dispatch({
            payload: {
              index,
              routes: routes.map((r) => {
                return { name: r.name, params: r.params };
              }),
            },
            type: 'RESET',
          });
          return { currentRoute: navigation.getCurrentRoute(), success: true };
        },
        inputSchema: {
          index: { description: 'Index of the active route (default: last)', type: 'number' },
          routes: { description: 'Array of routes [{name, params?}]', type: 'array' },
        },
      },
    },
  };
};
