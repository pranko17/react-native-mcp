// ios-hid: Minimal CLI for injecting HID events into iOS Simulator.
// Uses Apple private frameworks (SimulatorKit, CoreSimulator) via dlopen/dlsym
// and ObjC runtime. Based on riwsky/iosef and DouweBos/Stagehand.
//
// Usage:
//   ios-hid tap <udid> <x> <y>                       (coords in PHYSICAL PIXELS)
//   ios-hid swipe <udid> <x1> <y1> <x2> <y2> <dur>   (coords in PHYSICAL PIXELS)
//   ios-hid type <udid> <text>
//   ios-hid button <udid> <name>                     (home, lock, siri)
//
// Exit code 0 on success, 1 on error (message to stderr).

import Foundation
import ObjectiveC
import Darwin

// MARK: - Framework loading

// Returns the SimulatorKit dlopen handle on success.
func loadFrameworks() -> UnsafeMutableRawPointer? {
    guard dlopen(
        "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",
        RTLD_LAZY
    ) != nil else {
        fputs("Error: Cannot load CoreSimulator.framework\n", stderr)
        return nil
    }

    let devDir = "/Applications/Xcode.app/Contents/Developer"
    let path = "\(devDir)/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"
    guard let handle = dlopen(path, RTLD_LAZY) else {
        fputs("Error: Cannot load SimulatorKit.framework\n", stderr)
        return nil
    }

    return handle
}

// MARK: - SimDevice lookup via ObjC runtime + KVC

func getSimDevice(udid: String) -> AnyObject? {
    guard let ctxClass = objc_lookUpClass("SimServiceContext") else {
        fputs("Error: SimServiceContext class not found\n", stderr)
        return nil
    }

    let sharedSel = NSSelectorFromString("sharedServiceContextForDeveloperDir:error:")
    guard let sharedMethod = class_getClassMethod(ctxClass, sharedSel) else {
        fputs("Error: sharedServiceContextForDeveloperDir:error: not found\n", stderr)
        return nil
    }

    typealias SharedFn = @convention(c) (AnyClass, Selector, NSString, UnsafeMutablePointer<NSError?>?) -> AnyObject?
    let sharedImp = unsafeBitCast(method_getImplementation(sharedMethod), to: SharedFn.self)

    var err: NSError?
    let devDir = "/Applications/Xcode.app/Contents/Developer" as NSString
    guard let ctx = sharedImp(ctxClass, sharedSel, devDir, &err) else {
        fputs("Error: Failed to get SimServiceContext: \(err?.localizedDescription ?? "unknown")\n", stderr)
        return nil
    }

    let dsSel = NSSelectorFromString("defaultDeviceSetWithError:")
    guard let dsMethod = class_getInstanceMethod(object_getClass(ctx), dsSel) else {
        fputs("Error: defaultDeviceSetWithError: not found\n", stderr)
        return nil
    }
    typealias DsFn = @convention(c) (AnyObject, Selector, UnsafeMutablePointer<NSError?>?) -> AnyObject?
    let dsImp = unsafeBitCast(method_getImplementation(dsMethod), to: DsFn.self)
    guard let deviceSet = dsImp(ctx, dsSel, &err) else {
        fputs("Error: Failed to get device set: \(err?.localizedDescription ?? "unknown")\n", stderr)
        return nil
    }

    // Use KVC to get devicesByUDID dictionary
    guard let devicesMap = (deviceSet as AnyObject).value(forKey: "devicesByUDID") as? NSDictionary else {
        fputs("Error: Cannot get devicesByUDID\n", stderr)
        return nil
    }

    let key = NSUUID(uuidString: udid.uppercased())
    if let device = devicesMap[key!] {
        return device as AnyObject
    }

    // Fallback: try string key
    for (k, v) in devicesMap {
        if "\(k)".uppercased() == udid.uppercased() {
            return v as AnyObject
        }
    }

    fputs("Error: Simulator '\(udid)' not found\n", stderr)
    return nil
}

// MARK: - Screen dimensions from SimDevice

// Returns screen size in PHYSICAL PIXELS — matches mainScreenSize on Xcode 15+
// and keeps the coordinate system consistent with Android (adb shell input tap)
// and RN MCP fiber_tree bounds, which are also in physical pixels.
func loadScreenInfo(device: AnyObject) -> CGSize? {
    guard let deviceType = (device as AnyObject).value(forKey: "deviceType") else {
        fputs("Error: device.deviceType not found\n", stderr)
        return nil
    }
    guard let size = (deviceType as AnyObject).value(forKey: "mainScreenSize") as? CGSize,
          size.width > 0, size.height > 0 else {
        fputs("Error: deviceType.mainScreenSize not found or invalid\n", stderr)
        return nil
    }
    return size
}

// MARK: - HID Client

func createHIDClient(device: AnyObject) -> AnyObject? {
    // Try both class name variants
    let clientClass: AnyClass? =
        objc_lookUpClass("SimulatorKit.SimDeviceLegacyHIDClient") ??
        objc_lookUpClass("_TtC12SimulatorKit24SimDeviceLegacyHIDClient") ??
        NSClassFromString("SimDeviceLegacyHIDClient")

    guard let cls = clientClass else {
        fputs("Error: SimDeviceLegacyHIDClient class not found\n", stderr)
        return nil
    }

    let initSel = NSSelectorFromString("initWithDevice:error:")
    guard let initMethod = class_getInstanceMethod(cls, initSel) else {
        fputs("Error: initWithDevice:error: not found\n", stderr)
        return nil
    }

    typealias InitFn = @convention(c) (AnyObject, Selector, AnyObject, UnsafeMutablePointer<NSError?>?) -> AnyObject?
    let initImp = unsafeBitCast(method_getImplementation(initMethod), to: InitFn.self)

    let allocSel = NSSelectorFromString("alloc")
    guard let allocMethod = class_getClassMethod(cls, allocSel) else {
        fputs("Error: alloc not found\n", stderr)
        return nil
    }
    typealias AllocFn = @convention(c) (AnyClass, Selector) -> AnyObject
    let allocImp = unsafeBitCast(method_getImplementation(allocMethod), to: AllocFn.self)

    let allocated = allocImp(cls, allocSel)

    var error: NSError?
    guard let client = initImp(allocated, initSel, device, &error) else {
        fputs("Error: HID client init failed: \(error?.localizedDescription ?? "unknown")\n", stderr)
        return nil
    }

    return client
}

func sendMessage(client: AnyObject, msg: UnsafeMutableRawPointer) -> Bool {
    let sendSel = NSSelectorFromString("sendWithMessage:freeWhenDone:completionQueue:completion:")
    guard let sendMethod = class_getInstanceMethod(object_getClass(client), sendSel) else {
        // Fallback: try simple send
        let simpleSel = NSSelectorFromString("send:message:")
        if let sm = class_getInstanceMethod(object_getClass(client), simpleSel) {
            typealias SimpleSendFn = @convention(c) (AnyObject, Selector, UnsafeMutableRawPointer) -> Void
            let imp = unsafeBitCast(method_getImplementation(sm), to: SimpleSendFn.self)
            imp(client, simpleSel, msg)
            return true
        }
        fputs("Error: No send method found\n", stderr)
        return false
    }

    typealias SendFn = @convention(c) (
        AnyObject, Selector,
        UnsafeMutableRawPointer, ObjCBool, DispatchQueue?,
        (@convention(block) (NSError?) -> Void)?
    ) -> Void
    let sendImp = unsafeBitCast(method_getImplementation(sendMethod), to: SendFn.self)

    // freeWhenDone=false so we can chain messages for drag sequences
    sendImp(client, sendSel, msg, ObjCBool(false), nil, nil)
    return true
}

// MARK: - IndigoHID message construction via dlsym

// IndigoHIDMessageForKeyboardArbitrary takes exactly 2 params: (keyCode, direction)
typealias KeyboardFn = @convention(c) (
    Int32, Int32
) -> UnsafeMutableRawPointer

typealias ButtonFn = @convention(c) (
    UInt32, Double, UInt64
) -> UnsafeMutableRawPointer

// 6-arg signature for Xcode 26+ IndigoHIDMessageForMouseNSEvent.
// Takes CGPoint + CGSize in the same unit (we use pixels on both ends); the
// function computes CGPoint/CGSize ratio internally.
typealias MouseEventFn = @convention(c) (
    UnsafeMutablePointer<CGPoint>,   // point in PIXELS
    UnsafeMutableRawPointer?,        // previousMessage (nil for down)
    Int32,                           // target: 0x32
    Int32,                           // eventType: 1=down, 2=up, 6=drag
    CGSize,                          // screenSize in PIXELS
    UInt32                           // edge: 0
) -> UnsafeMutableRawPointer

func loadMouseEventFn(simKitHandle: UnsafeMutableRawPointer) -> MouseEventFn? {
    guard let sym = dlsym(simKitHandle, "IndigoHIDMessageForMouseNSEvent") else {
        fputs("Error: IndigoHIDMessageForMouseNSEvent not found\n", stderr)
        return nil
    }
    return unsafeBitCast(sym, to: MouseEventFn.self)
}

// Pass physical pixels straight through — screenSize is also in pixels, so
// IndigoHIDMessageForMouseNSEvent computes the correct CGPoint/screenSize ratio.
// Matches Android adb semantics (raw pixel coords) + fiber_tree bounds units.
func createMouseEvent(
    mouseEventFn: MouseEventFn,
    screenSize: CGSize,
    xPixels: Double,
    yPixels: Double,
    eventType: Int32
) -> UnsafeMutableRawPointer {
    var pt = CGPoint(x: xPixels, y: yPixels)
    return mouseEventFn(&pt, nil, 0x32, eventType, screenSize, 0)
}

func loadKeyboardFn(simKitHandle: UnsafeMutableRawPointer) -> KeyboardFn? {
    guard let sym = dlsym(simKitHandle, "IndigoHIDMessageForKeyboardArbitrary") else {
        fputs("Error: IndigoHIDMessageForKeyboardArbitrary not found\n", stderr)
        return nil
    }
    return unsafeBitCast(sym, to: KeyboardFn.self)
}

func loadButtonFn(simKitHandle: UnsafeMutableRawPointer) -> ButtonFn? {
    guard let sym = dlsym(simKitHandle, "IndigoHIDMessageForButton") else {
        fputs("Error: IndigoHIDMessageForButton not found\n", stderr)
        return nil
    }
    return unsafeBitCast(sym, to: ButtonFn.self)
}

// MARK: - Actions
// All coordinates in PHYSICAL PIXELS.

func performTap(
    client: AnyObject,
    mouseEventFn: MouseEventFn,
    screenSize: CGSize,
    xPx: Double,
    yPx: Double
) -> Bool {
    let down = createMouseEvent(mouseEventFn: mouseEventFn, screenSize: screenSize, xPixels: xPx, yPixels: yPx, eventType: 1)
    guard sendMessage(client: client, msg: down) else { return false }
    usleep(30_000) // 30ms hold
    let up = createMouseEvent(mouseEventFn: mouseEventFn, screenSize: screenSize, xPixels: xPx, yPixels: yPx, eventType: 2)
    return sendMessage(client: client, msg: up)
}

func performSwipe(
    client: AnyObject,
    mouseEventFn: MouseEventFn,
    screenSize: CGSize,
    x1Px: Double,
    y1Px: Double,
    x2Px: Double,
    y2Px: Double,
    duration: Double
) -> Bool {
    // Down at start point
    let down = createMouseEvent(mouseEventFn: mouseEventFn, screenSize: screenSize, xPixels: x1Px, yPixels: y1Px, eventType: 1)
    guard sendMessage(client: client, msg: down) else { return false }

    // Intermediate drag steps using eventType=6 (drag).
    let steps = max(Int(duration * 60), 5)
    let dx = (x2Px - x1Px) / Double(steps)
    let dy = (y2Px - y1Px) / Double(steps)
    let stepDelay = UInt32(duration / Double(steps) * 1_000_000)

    for i in 1...steps {
        usleep(stepDelay)
        let move = createMouseEvent(
            mouseEventFn: mouseEventFn,
            screenSize: screenSize,
            xPixels: x1Px + dx * Double(i),
            yPixels: y1Px + dy * Double(i),
            eventType: 6
        )
        guard sendMessage(client: client, msg: move) else { break }
    }

    usleep(10_000) // 10ms before up
    // Up at end point
    let up = createMouseEvent(mouseEventFn: mouseEventFn, screenSize: screenSize, xPixels: x2Px, yPixels: y2Px, eventType: 2)
    return sendMessage(client: client, msg: up)
}

func performType(
    client: AnyObject,
    keyboardFn: KeyboardFn,
    text: String,
    udid: String
) -> Bool {
    // Split text into main content and trailing newline (Enter)
    let hasEnter = text.hasSuffix("\n")
    let content = hasEnter ? String(text.dropLast()) : text

    if !content.isEmpty {
        // Use clipboard paste — immune to keyboard layout.
        // 1. Copy to simulator pasteboard via simctl pbcopy
        let pbcopy = Process()
        pbcopy.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        pbcopy.arguments = ["simctl", "pbcopy", udid]
        let pipe = Pipe()
        pipe.fileHandleForWriting.write(content.data(using: .utf8) ?? Data())
        pipe.fileHandleForWriting.closeFile()
        pbcopy.standardInput = pipe
        do { try pbcopy.run() } catch {
            fputs("Error: Failed to run simctl pbcopy: \(error)\n", stderr)
            return false
        }
        pbcopy.waitUntilExit()
        if pbcopy.terminationStatus != 0 {
            fputs("Error: simctl pbcopy failed with exit \(pbcopy.terminationStatus)\n", stderr)
            return false
        }

        // 2. Cmd+A (select all) + Cmd+V (paste) via HID keyboard
        //    This replaces any existing text in the field.
        let cmdCode: Int32 = 0xE3 // Left GUI (Command)
        let aCode: Int32 = 0x04   // A key
        let vCode: Int32 = 0x19   // V key

        // Cmd+A select all
        guard sendMessage(client: client, msg: keyboardFn(cmdCode, 1)) else { return false }
        guard sendMessage(client: client, msg: keyboardFn(aCode, 1)) else { return false }
        guard sendMessage(client: client, msg: keyboardFn(aCode, 2)) else { return false }
        guard sendMessage(client: client, msg: keyboardFn(cmdCode, 2)) else { return false }
        usleep(30_000)

        // Cmd+V paste
        guard sendMessage(client: client, msg: keyboardFn(cmdCode, 1)) else { return false }
        guard sendMessage(client: client, msg: keyboardFn(vCode, 1)) else { return false }
        guard sendMessage(client: client, msg: keyboardFn(vCode, 2)) else { return false }
        guard sendMessage(client: client, msg: keyboardFn(cmdCode, 2)) else { return false }
        usleep(50_000)
    }

    // 3. Enter if needed — use a deliberate hold so the key press registers as
    // a real return press, not a spurious HID glitch that gets filtered out.
    if hasEnter {
        // When we just pasted, the TextInput is still processing the new value
        // asynchronously. Sending Return too early (50ms) races the paste pipeline
        // and the native onSubmit handler never fires. 500ms is empirically enough.
        if !content.isEmpty {
            usleep(450_000)
        }
        let enterCode: Int32 = 0x28
        guard sendMessage(client: client, msg: keyboardFn(enterCode, 1)) else { return false }
        usleep(30_000)
        guard sendMessage(client: client, msg: keyboardFn(enterCode, 2)) else { return false }
    }

    return true
}

func performButton(
    client: AnyObject,
    buttonFn: ButtonFn,
    name: String
) -> Bool {
    let codes: [String: UInt32] = ["home": 1, "lock": 2, "siri": 3]
    guard let code = codes[name.lowercased()] else {
        fputs("Error: Unknown button '\(name)'. Supported: home, lock, siri\n", stderr)
        return false
    }
    let press = buttonFn(code, 1.0, mach_absolute_time())
    guard sendMessage(client: client, msg: press) else { return false }
    usleep(100_000)
    let release = buttonFn(code, 0.0, mach_absolute_time())
    return sendMessage(client: client, msg: release)
}

// MARK: - Main

let args = CommandLine.arguments
guard args.count >= 4 else {
    fputs("Usage: ios-hid <tap|swipe|type|button> <udid> <args...>\n", stderr)
    exit(1)
}

let command = args[1]
let udid = args[2]

guard let simKitHandle = loadFrameworks() else { exit(1) }
guard let device = getSimDevice(udid: udid) else { exit(1) }
guard let screenSize = loadScreenInfo(device: device) else { exit(1) }
guard let client = createHIDClient(device: device) else { exit(1) }

var ok = false

switch command {
case "tap":
    guard args.count >= 5, let x = Double(args[3]), let y = Double(args[4]) else {
        fputs("Error: tap requires <x> <y>\n", stderr); exit(1)
    }
    guard let mouseEventFn = loadMouseEventFn(simKitHandle: simKitHandle) else { exit(1) }
    ok = performTap(client: client, mouseEventFn: mouseEventFn, screenSize: screenSize, xPx: x, yPx: y)

case "swipe":
    guard args.count >= 8,
          let x1 = Double(args[3]), let y1 = Double(args[4]),
          let x2 = Double(args[5]), let y2 = Double(args[6]),
          let dur = Double(args[7]) else {
        fputs("Error: swipe requires <x1> <y1> <x2> <y2> <duration>\n", stderr); exit(1)
    }
    guard let mouseEventFn = loadMouseEventFn(simKitHandle: simKitHandle) else { exit(1) }
    ok = performSwipe(
        client: client,
        mouseEventFn: mouseEventFn,
        screenSize: screenSize,
        x1Px: x1, y1Px: y1,
        x2Px: x2, y2Px: y2,
        duration: dur
    )

case "type":
    guard let keyboardFn = loadKeyboardFn(simKitHandle: simKitHandle) else { exit(1) }
    ok = performType(client: client, keyboardFn: keyboardFn, text: args[3], udid: udid)

case "button":
    guard let buttonFn = loadButtonFn(simKitHandle: simKitHandle) else { exit(1) }
    ok = performButton(client: client, buttonFn: buttonFn, name: args[3])

default:
    fputs("Unknown command: \(command)\n", stderr); exit(1)
}

exit(ok ? 0 : 1)
