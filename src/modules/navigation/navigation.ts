import { type McpModule } from '@/client/models/types';

import { type NavigationRef, type NavigationState } from './types';

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

export const navigationModule = (navigation: NavigationRef): McpModule => {
  return {
    description:
      'React Navigation control: get current route/state, navigate, push, pop, replace, reset, go_back.',
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
