//
//  BentoPDF Share Extension
//
//  Makes BentoPDF a real target in the iOS share sheet rather than something
//  buried under "Copy to". It has no UI of its own: it takes the shared file,
//  puts it somewhere the main app can read, hands over, and gets out of the
//  way - which is what sharing a document to an editor should feel like.
//
//  The two halves cannot see each other's storage, so the file goes through an
//  App Group container both targets are entitled to, and the path travels in a
//  `bentopdf://open?path=...` URL.
//

import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  /// Must match the group in both targets' entitlements.
  private let appGroupId = "group.com.bentopdf.personal"
  private let urlScheme = "bentopdf"
  private let inboxName = "ShareInbox"

  private var hasStarted = false

  override func viewDidLoad() {
    super.viewDidLoad()
    // No interface - the extension is a relay, not a compose screen.
    view.backgroundColor = .clear
  }

  /// Deliberately not viewDidLoad. Handing over to the app means finding
  /// `openURL:` by walking up the responder chain, and there is no chain to
  /// walk until the view is in a window - and an alert cannot be presented
  /// that early either.
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !hasStarted else { return }
    hasStarted = true
    handleShare()
  }

  // MARK: - Receiving

  private func handleShare() {
    guard
      let item = extensionContext?.inputItems.first as? NSExtensionItem,
      let provider = item.attachments?.first
    else {
      finish(withError: "Nothing was shared.")
      return
    }

    // A file URL carries the real filename, which the user will recognise, so
    // it is worth asking for that first.
    let fileUrlType = UTType.fileURL.identifier
    if provider.hasItemConformingToTypeIdentifier(fileUrlType) {
      provider.loadItem(forTypeIdentifier: fileUrlType, options: nil) {
        [weak self] value, _ in
        if let url = value as? URL {
          self?.deliver(from: url, preferredName: url.lastPathComponent)
        } else {
          self?.loadAsFile(from: provider)
        }
      }
      return
    }

    loadAsFile(from: provider)
  }

  /// Fallback for providers that vend data rather than a file URL.
  private func loadAsFile(from provider: NSItemProvider) {
    let type =
      provider.registeredTypeIdentifiers.first ?? UTType.data.identifier
    let suggested = provider.suggestedName

    provider.loadFileRepresentation(forTypeIdentifier: type) {
      [weak self] url, error in
      guard let url else {
        self?.finish(
          withError: error?.localizedDescription ?? "Could not read that file."
        )
        return
      }
      // The URL is only valid inside this closure, so the copy happens now.
      let name = suggested.map { name -> String in
        url.pathExtension.isEmpty || name.hasSuffix(url.pathExtension)
          ? name : "\(name).\(url.pathExtension)"
      }
      self?.deliver(from: url, preferredName: name ?? url.lastPathComponent)
    }
  }

  // MARK: - Handing over

  private func deliver(from source: URL, preferredName: String) {
    guard
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupId)
    else {
      finish(
        withError:
          "BentoPDF's shared storage is unavailable. Check that the App Group is enabled for both targets."
      )
      return
    }

    let inbox = container.appendingPathComponent(inboxName, isDirectory: true)
    let name = sanitised(preferredName)
    let destination = inbox.appendingPathComponent(name)

    // Some providers hand back a security-scoped URL; asking is harmless when
    // it is not, and skipping it fails on documents opened from other apps.
    let scoped = source.startAccessingSecurityScopedResource()
    defer { if scoped { source.stopAccessingSecurityScopedResource() } }

    do {
      try emptyInbox(inbox)
      try FileManager.default.createDirectory(
        at: inbox, withIntermediateDirectories: true)
      try FileManager.default.copyItem(at: source, to: destination)
    } catch {
      finish(withError: "Could not copy the file: \(error.localizedDescription)")
      return
    }

    var components = URLComponents()
    components.scheme = urlScheme
    components.host = "open"
    components.queryItems = [
      URLQueryItem(name: "path", value: destination.path),
      URLQueryItem(name: "name", value: name),
    ]

    guard let url = components.url else {
      finish(withError: "Could not open BentoPDF.")
      return
    }

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if self.openHostApp(url) {
        self.finish(withError: nil)
      } else {
        // The file is already in the shared inbox, so opening BentoPDF by hand
        // is a real recovery rather than a dead end.
        self.finish(
          withError: "Open BentoPDF to finish opening \(name).")
      }
    }
  }

  /// One shared document at a time - the inbox is a handover, not a library.
  private func emptyInbox(_ inbox: URL) throws {
    let manager = FileManager.default
    guard manager.fileExists(atPath: inbox.path) else { return }
    for file in try manager.contentsOfDirectory(
      at: inbox, includingPropertiesForKeys: nil)
    {
      try? manager.removeItem(at: file)
    }
  }

  private func sanitised(_ name: String) -> String {
    let cleaned =
      name
      .replacingOccurrences(of: "/", with: "-")
      .replacingOccurrences(of: "..", with: "-")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return cleaned.isEmpty ? "shared-document" : cleaned
  }

  /// An app extension has no `UIApplication`, so the opener is found by walking
  /// up the responder chain. This is the long-standing way to hand off to the
  /// containing app from a share extension.
  @discardableResult
  private func openHostApp(_ url: URL) -> Bool {
    var responder: UIResponder? = self
    let selector = sel_registerName("openURL:")

    while let current = responder {
      if current.responds(to: selector), current !== self {
        _ = current.perform(selector, with: url)
        return true
      }
      responder = current.next
    }
    return false
  }

  // MARK: - Finishing

  private func finish(withError message: String?) {
    guard let message else {
      // Completion callbacks land on arbitrary threads; UIKit does not.
      DispatchQueue.main.async { [weak self] in
        self?.extensionContext?.completeRequest(returningItems: nil)
      }
      return
    }

    DispatchQueue.main.async { [weak self] in
      let alert = UIAlertController(
        title: "BentoPDF", message: message, preferredStyle: .alert)
      alert.addAction(
        UIAlertAction(title: "OK", style: .default) { _ in
          self?.extensionContext?.completeRequest(returningItems: nil)
        })
      self?.present(alert, animated: true)
    }
  }
}
