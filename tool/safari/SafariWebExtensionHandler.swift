// Kemlock's Safari extension handler. tool/safari/convert.sh puts this file over the one `safari-web-extension-converter` writes
// (which only echoes a message back), in the extension target of the Xcode project.
//
// A web extension can't do two things in Safari, and the app can:
//
//   - write the system clipboard without a click (a background timer has none, and Safari lets a page write the clipboard only
//     after one), and clear it later only if nothing has changed it since. The clipboard is never read: a write answers the
//     pasteboard's change count, and a clear takes that count and clears only if it is still the pasteboard's. The copy is
//     marked as concealed, so clipboard managers leave it out; on iOS it stays on the device, and expires with the extension's
//     own clear time.
//   - say whether the screen is locked: Safari has no `idle` API, and Chrome's and Firefox's lock-on-screen-lock rests on it.
//
// The extension's side is src/background/native.ts; the two change together (`protocolVersion`). A request is
// `{ kemlock: 1, cmd: "write" | "clear" | "screenLocked", value?, seconds?, count? }`, and the answer
// `{ kemlock: 1, ok: true, count?, locked? }` or `{ kemlock: 1, ok: false }`. Safari sends a message only from this app's own
// extension to this app's own handler.
//
// Needs macOS 11 or iOS 15 (SFExtensionMessageKey), which convert.sh's deployment targets are above.
import SafariServices
#if os(macOS)
import AppKit
import CoreGraphics
#else
import UIKit
#endif

private let protocolVersion = 1

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey]

        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: SafariWebExtensionHandler.answer(to: message)]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    // A computed property, not a stored one: a static [String: Any] is not Sendable, which Swift 6 refuses
    private static var failure: [String: Any] {
        return ["kemlock": protocolVersion, "ok": false]
    }

    private static func success(_ extra: [String: Any] = [:]) -> [String: Any] {
        var reply: [String: Any] = ["kemlock": protocolVersion, "ok": true]
        for (key, value) in extra { reply[key] = value }
        return reply
    }

    /// The answer to one request; anything that is not ours, or not understood, is a plain "no".
    private static func answer(to message: Any?) -> [String: Any] {
        guard let body = message as? [String: Any],
              (body["kemlock"] as? Int) == protocolVersion,
              let command = body["cmd"] as? String
        else { return failure }

        switch command {
        case "write":
            guard let value = body["value"] as? String else { return failure }
            // How long the copy will stay, for a system that expires it: none when it is not a positive number
            let seconds = (body["seconds"] as? NSNumber)?.doubleValue
            guard let count = write(value, seconds: seconds) else { return failure }
            return success(["count": count])
        case "clear":
            guard let count = (body["count"] as? NSNumber)?.intValue else { return failure }
            clear(ifUnchangedSince: count)
            return success()
        case "screenLocked":
            return success(["locked": screenIsLocked()])
        default:
            return failure
        }
    }

    #if os(macOS)
    /// Puts the text on the clipboard as concealed (an empty text clears it), and gives the pasteboard's change count after
    /// that, or nil when the pasteboard refused the text.
    private static func write(_ value: String, seconds: Double?) -> Int? {
        let board = NSPasteboard.general
        board.clearContents()
        if !value.isEmpty {
            guard board.setString(value, forType: .string) else { return nil }
            // The convention clipboard managers follow to leave a secret out of their history. Best effort: the copy stands
            // without it
            _ = board.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"))
        }
        return board.changeCount
    }

    /// Clears the pasteboard if its change count is still [count]: nothing has been copied since.
    private static func clear(ifUnchangedSince count: Int) {
        let board = NSPasteboard.general
        if board.changeCount == count { board.clearContents() }
    }

    /// The session's own word that the screen is locked.
    private static func screenIsLocked() -> Bool {
        guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
        return (session["CGSSessionScreenIsLocked"] as? Bool) ?? false
    }
    #else
    private static func write(_ value: String, seconds: Double?) -> Int? {
        let board = UIPasteboard.general
        if value.isEmpty {
            board.items = []
            return board.changeCount
        }
        var options: [UIPasteboard.OptionsKey: Any] = [.localOnly: true]
        // The system drops the copy at the extension's own clear time; no expiry when the person keeps it ("never")
        if let seconds = seconds, seconds > 0 {
            options[.expirationDate] = Date().addingTimeInterval(seconds)
        }
        board.setItems([["public.utf8-plain-text": value]], options: options)
        return board.changeCount
    }

    /// Reading the change count asks nothing of the person, unlike reading what is on the pasteboard.
    private static func clear(ifUnchangedSince count: Int) {
        let board = UIPasteboard.general
        if board.changeCount == count { board.items = [] }
    }

    /// A Safari extension does not run while an iPhone is locked, so there is nothing to say.
    private static func screenIsLocked() -> Bool {
        return false
    }
    #endif
}
