import { MODULE_SEPARATOR } from '@/shared/protocol';

export const BASE_INSTRUCTIONS = `react-native-mcp-kit drives React Native dev apps on simulators, emulators, and devices. Each connected app has a short ID — "ios-1", "android-1", "client-1".

## Catalog: two layers

- **Host tools** (\`host${MODULE_SEPARATOR}*\`, \`metro${MODULE_SEPARATOR}*\`, \`wait_until\`, \`assert\`) — always available, no app required. They drive the device and Metro from the dev machine.
- **App tools** (\`fiber_tree${MODULE_SEPARATOR}*\`, \`redux${MODULE_SEPARATOR}*\`, dynamic \`useMcpTool\` tools, …) — present only while their app is connected.

A shrinking catalog means an app went away, never that this server died. Recover instead of retrying dead tools: \`host${MODULE_SEPARATOR}connection_status\` (a closed client sits under \`disconnected\` for ~1h) → \`host${MODULE_SEPARATOR}launch_app\` → \`wait_until\` \`clientCount\` ≥ 1.

If a client shows \`background\` / \`inactive\`, its JS may be suspended and in-app calls can hang — relaunch rather than retry. Host tools need no live socket and resolve a \`disconnected\` client by \`clientId\` for the whole grace window.

## \`clientId\` — routing and broadcast

Omit \`clientId\` and it auto-picks — as long as exactly one client is connected; with several, omitting returns an error listing the available IDs. A plain string targets one client and keeps the single-client response shape. A \`/regex/flags\` literal or an array switches to broadcast: every match runs in parallel, results come back as \`{ okCount, failedCount, results: [...] }\` (image results get per-client \`## <clientId>\` headers). The pattern matches against client IDs — \`"/./"\` is everyone, \`"/^ios/"\` is iOS only. A pattern matching zero clients errors up front; an unconnected literal fails inside the envelope.

**In \`wait_until\` / \`assert\`, \`clientId\` is an outer field** — inside \`args\` it is a hard error:

  Wrong:  \`wait_until({ tool: "fiber_tree${MODULE_SEPARATOR}query", args: { clientId: "ios-1", steps: [...] }, predicate: ... })\`
  Right:  \`wait_until({ clientId: "ios-1", tool: "fiber_tree${MODULE_SEPARATOR}query", args: { steps: [...] }, predicate: ... })\`

Host tools resolve a device in this order: explicit \`udid\` / \`serial\` (from \`host${MODULE_SEPARATOR}list_devices\`) wins outright; else \`clientId\` resolves via that client's platform/label/deviceId (\`platform\` is then ignored); else the single connected client, falling back to the single booted sim / online device. \`launch_app\` / \`terminate_app\` / \`restart_app\` reuse the client's registered \`bundleId\` unless you pass \`appId\`.

## Silence LogBox before driving the UI

The LogBox overlay sits on top of the app: it swallows taps meant for the screen underneath and shows up in every screenshot. A single warning mid-run can make an otherwise correct tap sequence fail in a way that looks like a product bug.

Open any automation run with \`log_box${MODULE_SEPARATOR}set_installed({ enabled: false })\` — the overlay stops appearing entirely. Lighter options: \`log_box${MODULE_SEPARATOR}ignore_all({ value: true })\` mutes new rows, \`log_box${MODULE_SEPARATOR}clear()\` removes what is already on screen, \`log_box${MODULE_SEPARATOR}ignore({ patterns })\` hides known-noisy warnings (substring, or \`/regex/flags\`).

This costs you no visibility: warnings and errors stay readable through \`log_box${MODULE_SEPARATOR}get_logs\`, \`console${MODULE_SEPARATOR}get_logs\`, and \`errors${MODULE_SEPARATOR}get_errors\` — you just stop fighting the overlay. Re-enable with \`set_installed({ enabled: true })\` when you want to see it render.

## Driving the UI

1. **\`host${MODULE_SEPARATOR}tap_fiber\` with \`steps: [...]\`** — the canonical user tap. Locates the fiber and taps its center through the real OS gesture pipeline, so Pressable feedback, gesture responders, and hit-testing all run. Ambiguous matches return candidates — narrow \`steps\` or add \`index\`.
2. **\`fiber_tree${MODULE_SEPARATOR}query\` + \`host${MODULE_SEPARATOR}tap\`** when you want to inspect the match set (bounds, candidates) before committing.
3. **\`fiber_tree${MODULE_SEPARATOR}call\`** for what a tap can't reach: \`{ prop: 'onPress' }\` invokes a callback prop, \`{ method: 'focus' }\` an imperative ref method. Use it when the target is off-screen or virtualized, when a scroll handler swallows taps, or for focus / blur / scrollTo.
4. **\`host${MODULE_SEPARATOR}screenshot\` + coordinates + \`host${MODULE_SEPARATOR}tap\`** ONLY for surfaces with no fiber: system permission dialogs, native alerts, the keyboard, WebView content, splash screens. Pass \`region\` to crop — vision tokens are the expensive part.

Text entry goes through \`host${MODULE_SEPARATOR}type_text\` (tap the field first) — or \`host${MODULE_SEPARATOR}type_text_batch\` to fill a whole form in one call. \`host${MODULE_SEPARATOR}swipe\` / \`long_press\` / \`drag\` / \`press_key\` cover the remaining gestures; scroll a target into view with a swipe when you need the real layout, or reach it directly with \`fiber_tree${MODULE_SEPARATOR}call\` when you only need the callback to fire.

Verify the effect, don't assume it: a navigation call can be accepted and still leave focus where it was, so check \`focusChanged\` / the resulting route rather than the call's own \`ok\`.

## Waiting and checking

- \`wait_until\` polls any tool until a predicate holds — use it for state ("network idle", "state key X is Y") instead of screenshot-in-a-loop. Predicates compose: \`{ all: [...] }\`, \`{ any: [...] }\`, \`{ not: ... }\`.
- \`fiber_tree${MODULE_SEPARATOR}query\` with \`waitFor: { until: "appear" | "disappear", stable?: <ms> }\` is the UI-level wait. \`stable\` demands continuous presence/absence, which rides out screen transitions.
- \`assert\` is the single-shot checkpoint after an action. The natural loop is act → wait → assert.

## Network mocks

\`network${MODULE_SEPARATOR}set_mock\` intercepts at the XHR layer, so both \`fetch\` and XMLHttpRequest are covered. Modes:

- \`replace\` — synthesize status/headers/body; the request never leaves the app.
- \`modify\` — the real request runs, then you patch it. \`bodyMergePatch\` is RFC 7396 (deep merge, \`null\` deletes a key); \`bodyJsonPatch\` is RFC 6902 for array surgery, applied after the merge patch.
- \`error\` / \`timeout\` — simulate failure. \`delayMs\` applies to replace/error/timeout.

Matching is **first-match-wins in insertion order**. \`url\` is a substring or \`/regex/\`; \`method\`, \`times\` (consumed per hit), \`bodyContains\` (substring or \`/regex/\` over the raw body) and \`bodyMatch\` narrow further. \`bodyMatch\` takes dot-paths into the parsed JSON body and **ANDs every entry** — the way to separate requests that share a URL and differ only in payload:

  \`bodyMatch: { "data.type": "courier", "data.items.length": 3 }\`

Mocks are volatile — a JS reload drops them. Every affected buffer entry carries \`mock: { id, mode, originalStatus? }\`, so captured traffic never lies about being fake. Mocked JSON survives in React Query caches after \`clear_mocks\` — invalidate through the \`query\` module when a screen must stop showing it.

## One verb per concept

Modules expose a verb plus arguments, never a tool per variant — reach for the listing tool with a filter, not a tool named after the filter. \`console${MODULE_SEPARATOR}get_logs({ level })\`, \`network${MODULE_SEPARATOR}get_requests({ status, method, url })\`, \`navigation${MODULE_SEPARATOR}navigate({ mode })\` and \`pop({ to })\`, \`query${MODULE_SEPARATOR}mutate({ action })\`, \`device${MODULE_SEPARATOR}info({ select })\`. If a tool you expect is missing, it is an argument on a broader one.

\`errors${MODULE_SEPARATOR}get_errors\` and \`log_box${MODULE_SEPARATOR}get_logs\` return parsed \`stackFrames\` that go straight into \`metro${MODULE_SEPARATOR}symbolicate\` to map bundled frames back to source.

Sensitive values are redacted at capture time — auth headers, and body/hook keys like password, token, secret, apiKey. A redacted field is not a missing one.

## Path-based drill into heavy responses

Every listing tool takes \`path\` / \`depth\` / \`maxBytes\` / \`arrayCap\` / \`objectCap\` / \`previewCap\`. Heavy nested values collapse into \`\${...}\` markers while primitives stay raw; drill with \`path\` on the same tool rather than looking for a by-id fetcher.

  \`network${MODULE_SEPARATOR}get_requests({ path: '[-1:][0].response.body' })\`   — last request's body
  \`console${MODULE_SEPARATOR}get_logs({ path: '[-3:][0].args[1]' })\`             — second arg of the third-from-last log
  \`storage${MODULE_SEPARATOR}get_item({ key: 'session', path: 'value.user.email' })\`

Path syntax (JS-style):
  \`.key\` or \`["key.with.dots"]\` — object key access
  \`[N]\` — index: array element, Nth char of a string, Nth key of an object
  \`[start:end]\` / \`[start:]\` / \`[:end]\` — slice, negative indices count from the end. Works on arrays, strings and objects. After an array slice, a chained \`.key\` maps over elements; \`[N]\` picks one.

Knobs: \`depth\` (max 8) is how many container levels expand before collapsing; \`maxBytes\` (50KB) caps the whole response; \`arrayCap\` (50) and \`objectCap\` (30) trim containers that are too *wide*, inserting a \`\${truncated}\` marker with the original \`total\`; \`previewCap\` (250) is the per-string preview length. Ending a path with a slice on a string (\`stack[0:500]\`) returns raw text and bypasses \`previewCap\`.

For \`fiber_tree${MODULE_SEPARATOR}query\`, heavy fields take these knobs per-field through \`select\`, so the rest of the response stays raw:
  \`select: [{ props: { path: "style", depth: 2 } }]\`
  \`select: [{ hooks: { kinds: ["State"], names: ["isLoading"], withValues: true } }]\`  — \`names\` accepts \`/regex/flags\`; \`format: "tree"\` nests custom-hook children instead of flat \`via\` chains
  \`select: [{ children: 5 }]\`  — light-only tree walker; pair with \`scope: "root"\` on the first step to dump the whole tree. props/hooks are rejected inside it; sub-children past the depth surface as \`\${arr}: N\`.

Markers: \`\${obj}\` / \`\${arr}\` / \`\${map}\` / \`\${set}\` carry a size, \`\${str}\` carries \`{ len, preview }\`, \`\${fun}\` a name, \`\${ref}\` \`{ mcpId, name }\` for a fiber or native ref, \`\${cls}\` a class instance, \`\${cyc}\` a cycle, \`\${truncated}\` \`{ total, slice }\` for a width-capped container, plus \`\${Date}\` / \`\${Err}\` / \`\${RegExp}\`.
`;
