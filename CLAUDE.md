# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
yarn build          # Compile TypeScript (output to dist/, then tsc-alias resolves @/ paths)
yarn dev            # Watch mode compilation
yarn lint           # ESLint check (src/**/*.{ts,tsx})
yarn lint:fix       # Auto-fix ESLint violations
yarn lint:ts        # TypeScript type check (tsc --noEmit)
```

No test suite is configured.

## Architecture

`rnmcp` is a bidirectional MCP bridge connecting React Native apps to AI agents. The server is a proxy — all business logic (state collection, command execution) runs inside the RN app.

```
AI Agent  --stdio/MCP-->  MCP Server (Node.js)  --WebSocket-->  RN App (device)
```

### MCP Server Tools

The server exposes 5 static tools via `registerTool` (always available, no dynamic registration needed):

- **`call`** — Universal proxy to call any tool registered by the RN app. Format: `call(tool: "module__method", args: '{"key": "value"}')`. Args is a JSON string. For dynamic tools from `useMcpTool` hooks, use `_dynamic_` prefix: `call(tool: "_dynamic_logout")`.
- **`list_tools`** — Lists all available tools from all registered modules, grouped by module. Includes module descriptions and dynamic tools (from `useMcpTool` hooks) with `(dynamic)` label.
- **`connection_status`** — Check if the RN app is connected and which modules are registered.
- **`state_get`** / **`state_list`** — Read state exposed by `useMcpState` hooks.

Server instructions and tool annotations (readOnlyHint, openWorldHint) are configured for AI agent context.

### Package Structure

The package has four entry points:

- **Root** (`src/index.ts`) — re-exports client + modules (RN-safe, no server code)
- **Server** (`src/server/`) — Node.js MCP server + WebSocket bridge (not bundled into RN)
- **Modules** (`src/modules/`) — built-in RN modules
- **Babel** (`src/babel/`) — Babel plugins (testIdPlugin, stripPlugin)

```
src/
  babel/
    testIdPlugin.ts         — Auto-adds data-mcp-id to JSX components (dev only)
    stripPlugin.ts          — Removes all MCP code in production builds
  client/
    core/                   — McpClient singleton (connection, module registration, debug logging)
    contexts/McpContext/    — McpContext, McpProvider (context for hooks only)
    hooks/                  — useMcpState, useMcpTool, useMcpModule
    models/                 — McpModule, ToolHandler interfaces
    utils/                  — McpConnection (WS client), ModuleRunner
  server/
    bridge.ts               — WebSocket server, request/response dispatch
    mcpServer.ts            — 5 static MCP tools via registerTool + server instructions + image content support
    cli.ts                  — CLI entry point (npx rnmcp)
  modules/
    alert/                  — Show alerts with custom buttons and styles
    fiberTree/              — React fiber tree inspection, invoke callbacks, call ref methods
    console/                — Console log capture (log/warn/error/info/debug)
    device/                 — Device info, app state, keyboard, linking, reload, vibrate
    errors/                 — Unhandled errors and promise rejections
    i18next/                — i18next translation inspection and language management
    navigation/             — Navigation state, history, navigate, push, pop, replace, reset
    network/                — HTTP request interception (fetch + XMLHttpRequest)
    reactQuery/             — React Query cache inspection and management
    screenshot/             — Screenshot capture via @shopify/react-native-skia
    storage/                — Key-value storage inspection (MMKV, AsyncStorage, custom)
  shared/
    protocol.ts             — WebSocket message types (RegistrationMessage, ToolRequest, etc.)
```

### File & Folder Conventions

- **Contexts**: `contexts/ContextName/` folder with `ContextName.ts`, types, provider, and `index.ts` barrel export.
- **Hooks**: camelCase files in `hooks/` (e.g. `useMcpState.ts`).
- **Models**: types in `models/types.ts`.
- **Modules**: each module gets its own folder in `modules/` (e.g. `modules/navigation/`) with `navigation.ts`, `types.ts`, and `index.ts`. This allows splitting complex modules across multiple files.

### Initialization & Module Registration

`McpClient` is a singleton that manages the WebSocket connection and module registry.

```typescript
// 1. Initialize (creates connection, must be called first)
McpClient.initialize({ debug: true, host: 'localhost', port: 8347 });

// 2. Register modules (global, can be called from anywhere after init)
McpClient.getInstance().registerModules([
  alertModule(),
  fiberTreeModule({ rootRef }),
  consoleModule(),
  deviceModule(),
  errorsModule(),
  i18nextModule(i18n),
  navigationModule(ref),
  networkModule(),
  reactQueryModule(queryClient),
  screenshotModule({ rootRef }),
  storageModule({ adapter: storageAdapter, name: 'app' }),
]);

// 3. McpProvider only provides context for hooks (useMcpState, useMcpTool)
<McpProvider>{children}</McpProvider>
```

Calling `McpClient.getInstance()` before `initialize()` throws an error with a console message.

Three ways to register modules:
- **Global**: `McpClient.getInstance().registerModule(module)` — from anywhere after init
- **Hook**: `useMcpModule(() => module, deps)` — tied to component lifecycle
- **Init time**: Register right after `McpClient.initialize()`

### Dynamic Tools (useMcpTool)

Tools registered via `useMcpTool` in React components are accessible through the `call` tool with `_dynamic_` prefix. They appear in `list_tools` under `(dynamic)` section.

```typescript
// In a React component:
useMcpTool('logout', () => ({
  description: 'Log out the current user',
  handler: () => { logout(); return { success: true }; },
}), [logout]);

// Call from AI agent:
call(tool: "_dynamic_logout")
```

### Data Flow

1. `McpClient.initialize()` opens WebSocket to bridge (port 8347)
2. On connect + module registration, sends `RegistrationMessage` with module descriptors (including descriptions)
3. AI agent calls `call` tool → server sends `ToolRequest` over WS → RN app executes handler → returns `ToolResponse`
4. `useMcpState` sends `state_update` messages → server stores in memory → AI reads via `state_get` (no WS roundtrip)
5. `useMcpTool` sends `tool_register`/`tool_unregister` → server tracks dynamic tools → AI calls via `_dynamic_` prefix
6. Image results (screenshots) are detected by `formatResult` and returned as MCP image content blocks

### Dev vs Production

Hooks (`useMcpState`, `useMcpTool`, `useMcpModule`) work in all environments. Two strategies for production safety:

1. **Strip plugin** (Babel): Removes all MCP imports, `McpClient` calls, `<McpProvider>` JSX, and `data-mcp-id` attributes from production builds. Zero MCP code in prod bundle.
2. **Without strip plugin**: MCP code stays in bundle but WebSocket connection to non-existent server is harmless.

With strip plugin, `if (__DEV__)` wrappers are not needed — the plugin handles removal.

### Babel Plugins

- **testIdPlugin** (dev only): Auto-adds `data-mcp-id` attribute to all JSX components. Format: `ComponentName:filePath:line`. Stable across re-renders. Configurable: `attr`, `separator`, `include`, `exclude`. Import path: `rnmcp/babel/test-id-plugin`.
- **stripPlugin** (prod only): Removes all MCP code — imports, requires, McpClient calls, McpProvider JSX, data-mcp-id attributes, useMcpState/useMcpTool calls. Import path: `rnmcp/babel/strip-plugin`.

### Module Interface

Modules are plain objects with named tools. Each tool has a handler that runs in the RN runtime:

```typescript
interface McpModule {
  description?: string;
  name: string;
  tools: Record<string, ToolHandler>;
}

interface ToolHandler {
  description: string;
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
  inputSchema?: Record<string, unknown>;
  timeout?: number; // per-tool timeout in ms (default: 10s)
}
```

Module `description` is shown in `list_tools` output and helps AI agents understand module capabilities. Use markdown with examples for complex modules (see fiberTree).

### Built-in Modules (11)

- **alert** — `alertModule()`: show alerts with custom buttons and styles (default/cancel/destructive). Returns pressed button. 60s timeout. Tools: show

- **fiberTree** — `fiberTreeModule({ rootRef })`: React fiber tree inspection. Tools:
  - `get_tree` / `get_component` / `get_children` / `get_props` / `find_all` — inspect component tree
  - `invoke` — call any callback prop (onPress, onChangeText, etc.) with custom args
  - `call_ref` / `get_ref_methods` — call methods on native instance (focus, blur, measure, etc.)
  - Search supports: `name`, `testID`, `mcpId` (data-mcp-id), `text`, `index` (N-th match), `within` (parent path with "/" separator and ":N" index, e.g. `"Checkbox/Pressable"`, `"Button:1/View"`)

- **console** — `consoleModule(options?)`: intercepts console.log/warn/error/info/debug, ring buffer (default 100), stack traces for error/warn. Serializes functions, class instances, circular refs, Errors, Dates, RegExp, Symbols. Tools: get_logs, get_errors, get_warnings, get_info, get_debug, clear_logs

- **device** — `deviceModule()`: get_device_info, get_platform, get_dimensions, get_pixel_ratio, get_appearance, get_app_state, get_accessibility_info, get_keyboard_state, dismiss_keyboard, open_url, can_open_url, get_initial_url, open_settings, reload, vibrate

- **errors** — `errorsModule()`: captures unhandled JS errors (ErrorUtils) and promise rejections (console.error interception). Tools: get_errors, get_fatal, get_stats, clear_errors

- **i18next** — `i18nextModule(i18n)`: accepts i18next instance. Tools: get_info, get_resource, get_keys, translate (with interpolation), search (keys and values), change_language

- **navigation** — `navigationModule(navigationRef)`: get_state, get_current_route, get_current_route_state, get_history (ring buffer of all transitions with timestamps, supports offset/limit/full), navigate, push, pop, pop_to, pop_to_top, replace, reset, go_back

- **network** — `networkModule(options?)`: intercepts fetch and XMLHttpRequest, captures request/response bodies, headers, status, duration. Auto-ignores WebSocket, Metro, symbolicate. Tools: get_requests, get_request, get_errors, get_pending, get_stats, clear_requests

- **reactQuery** — `reactQueryModule(queryClient)`: accepts QueryClient instance. Cache inspection and management. Tools: get_queries, get_data, get_stats, invalidate, refetch, remove, reset

- **screenshot** — `screenshotModule({ rootRef })`: captures screenshots via `@shopify/react-native-skia` `makeImageFromView`. Returns JPEG by default (resized to 600px width via `Skia.Surface.Make` + `drawImageRectOptions`). Supports PNG format and custom quality/maxWidth. Skia is an optional peer dependency. Tools: capture

- **storage** — `storageModule(...storages)`: accepts multiple named storage adapters (MMKV, AsyncStorage, or custom). All adapter methods optional except `get`. Async-compatible. Tools: get_item, set_item, delete_item, list_keys, get_all, list_storages

### Debug Logging

`McpClient.initialize({ debug: true })` enables colored console output showing all tool requests/responses. Uses original `console.log` (captured before console module intercepts it) so debug logs don't appear in the console module buffer.

Colors: bold purple `[rnmcp]` tag, colored module names (12 bold ANSI colors assigned by registration order), bold method names. Cyan `→` for incoming requests, green `←` for responses, red `✕` for errors.

## Code Style

- **Path aliases**: `@/*` maps to `./src/*`. Relative `../` imports are lint-restricted — use `@/` for cross-directory, `./` for same-directory.
- **Type imports**: Always inline — `import { type Foo }` not `import type { Foo }`. Same for re-exports: `export { type Foo }`.
- **Import order**: Enforced by `eslint-plugin-import` — builtin → external → internal → parent → sibling, with blank lines between groups, alphabetized.
- **Object/interface keys**: Sorted alphabetically (enforced by `sort-keys-fix` and `typescript-sort-keys`).
- **Formatting**: Prettier with 100-char printWidth, single quotes, 2-space indent, es5 trailing commas.
- **Arrow functions**: Always use block body `() => { return ...; }`, never concise body.

## Key Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol implementation (server-side only). Uses `registerTool` API. Imports require `.js` extension.
- `@babel/core` — Babel plugin development (dev dependency).
- `ws` — WebSocket server (server-side only, RN uses built-in WebSocket).
- `zod` — Schema validation for MCP tool input schemas.
- `tsc-alias` — Resolves `@/` path aliases in compiled output (Metro doesn't understand them).
- `react` — Peer dependency (>=19), optional (server can run without it).
- `@shopify/react-native-skia` — Optional peer dependency (>=1.0), used by screenshot module.
