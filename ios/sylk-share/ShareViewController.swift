import UIKit
import Social
import MobileCoreServices
import UserNotifications

class ShareViewController: SLComposeServiceViewController {

    let hostAppBundleIdentifier = "com.agprojects.sylk-ios"
    let shareProtocol = "com.agprojects.sylk"
    let sharedKey = "ShareKey"
    let appGroupId = "group.com.agprojects.sylk-ios"

    // MARK: - Notification control
    private var remainingFilesToProcess = 0
    private var didPostNotification = false

    override func isContentValid() -> Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        NSLog("[SYLK_APP] [ShareExt] viewDidLoad called")
        NSLog("[SYLK_APP] [ShareExt] Extension context: \(String(describing: self.extensionContext))")
        NSLog("[SYLK_APP] [ShareExt] Input items count: \(self.extensionContext?.inputItems.count ?? 0)")
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        NSLog("[SYLK_APP] [ShareExt] viewDidAppear called")
        handleSharedContent()
    }

    override func didSelectPost() { /* no-op */ }
    override func configurationItems() -> [Any]! { return [] }

    // MARK: - Handle shared content
    private func handleSharedContent() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem], !items.isEmpty else {
            NSLog("[SYLK_APP] [ShareExt] No input items found")
            return
        }

        // Count total attachments for notification logic
        remainingFilesToProcess = items.compactMap { $0.attachments }.flatMap { $0 }.count
        didPostNotification = false
        NSLog("[SYLK_APP] [ShareExt] Total attachments to process: \(remainingFilesToProcess)")

        // Accepted types (skip HEIC)
        let preferredTypes = [
            kUTTypeJPEG as String,
            kUTTypePNG as String,
            kUTTypeMPEG4 as String,
            "com.apple.quicktime-movie",
            kUTTypeMovie as String,
            kUTTypeFileURL as String,
            kUTTypeText as String,
            "public.url"
        ]

        for item in items {
            guard let attachments = item.attachments else { continue }

            for provider in attachments {

                guard let typeIdentifier = provider.registeredTypeIdentifiers.first(where: { preferredTypes.contains($0) }) else {
                    NSLog("[SYLK_APP] [ShareExt] Skipping unsupported type(s): \(provider.registeredTypeIdentifiers)")
                    fileProcessingCompleted()
                    continue
                }

                NSLog("[SYLK_APP] [ShareExt] Selected type: \(typeIdentifier)")

                provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { [weak self] data, error in
                    guard let self = self else { return }

                    if let error = error {
                        NSLog("[SYLK_APP] [ShareExt] Error loading item: \(error.localizedDescription)")
                        self.fileProcessingCompleted()
                        return
                    }

                    NSLog("[SYLK_APP] [ShareExt] Loaded item of type: \(typeIdentifier)")
                    self.processLoadedItem(data: data, typeIdentifier: typeIdentifier)
                }
            }
        }
    }

    // MARK: - Process loaded item
    private func processLoadedItem(data: NSSecureCoding?, typeIdentifier: String) {

        // 1️⃣ Web links FIRST
        if typeIdentifier == "public.url", let url = data as? URL {
            let fileName = "share-\(UUID().uuidString).weblink"
            let fileData = url.absoluteString.data(using: .utf8)

            if let fileData = fileData {
                saveSharedFile(fileData, fileName: fileName)
                NSLog("[SYLK_APP] [ShareExt] Saved web link: \(url.absoluteString)")
            }

            fileProcessingCompleted()
            return
        }

        // 2️⃣ File URLs (photos, videos, etc.)
        if let url = data as? URL, url.isFileURL {

            let ext = url.pathExtension.lowercased()

            if ext == "heic" || ext == "heif" {
                NSLog("[SYLK_APP] [ShareExt] Skipping HEIC/HEIF file: \(url)")
                fileProcessingCompleted()
                return
            }

            let fileName = "share-\(UUID().uuidString).\(ext)"

            do {
                try streamCopyItem(from: url, fileName: fileName)
            } catch {
                NSLog("[SYLK_APP] [ShareExt] Streaming copy failed: \(error)")
            }

            fileProcessingCompleted()
            return
        }

        // 3️⃣ Text
        if let text = data as? String {
            let fileName = "share-\(UUID().uuidString).txt"
            if let fileData = text.data(using: .utf8) {
                saveSharedFile(fileData, fileName: fileName)
            }
            fileProcessingCompleted()
            return
        }

        // 4️⃣ Raw data
        if let raw = data as? Data {
            let ext = (typeIdentifier as NSString).pathExtension.isEmpty ? "bin" : (typeIdentifier as NSString).pathExtension
            let fileName = "share-\(UUID().uuidString).\(ext)"
            saveSharedFile(raw, fileName: fileName)
            fileProcessingCompleted()
            return
        }

        fileProcessingCompleted()
    }

    // MARK: - File saving
    private func saveSharedFile(_ data: Data, fileName: String) {
        guard let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            NSLog("[SYLK_APP] [ShareExt] Could not get App Group container")
            return
        }

        let fileURL = containerURL.appendingPathComponent(fileName)

        do {
            try data.write(to: fileURL)
            NSLog("[SYLK_APP] [ShareExt] Saved shared file to: \(fileURL.path)")
        } catch {
            NSLog("[SYLK_APP] [ShareExt] Failed to save shared file: \(error)")
        }
    }

    // MARK: - Streaming copy for large files
    private func streamCopyItem(from sourceURL: URL, fileName: String) throws {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId
        ) else {
            throw NSError(domain: "ShareExtension", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "App Group container not found"
            ])
        }

        let destinationURL = containerURL.appendingPathComponent(fileName)

        guard let inputStream = InputStream(url: sourceURL) else {
            throw NSError(domain: "ShareExtension", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Cannot open input stream"
            ])
        }

        guard let outputStream = OutputStream(url: destinationURL, append: false) else {
            throw NSError(domain: "ShareExtension", code: 3, userInfo: [
                NSLocalizedDescriptionKey: "Cannot open output stream"
            ])
        }

        inputStream.open()
        outputStream.open()

        let bufferSize = 1024 * 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)

        defer {
            buffer.deallocate()
            inputStream.close()
            outputStream.close()
        }

        while inputStream.hasBytesAvailable {
            let readBytes = inputStream.read(buffer, maxLength: bufferSize)
            if readBytes < 0 {
                throw inputStream.streamError ?? NSError(domain: "ShareExtension", code: 4)
            }
            if readBytes == 0 { break }

            let written = outputStream.write(buffer, maxLength: readBytes)
            if written < 0 {
                throw outputStream.streamError ?? NSError(domain: "ShareExtension", code: 5)
            }
        }

        NSLog("[SYLK_APP] [ShareExt] Streamed copy saved to: \(destinationURL.path)")
    }

    // MARK: - Notification handling
    private func fileProcessingCompleted() {
        remainingFilesToProcess -= 1
        NSLog("[SYLK_APP] [ShareExt] Remaining files: \(remainingFilesToProcess)")

        if remainingFilesToProcess <= 0 && !didPostNotification {
            didPostNotification = true

            DispatchQueue.main.async {
                self.openHostApp()
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            }
        }
        /*
        if remainingFilesToProcess <= 0 && !didPostNotification {
            didPostNotification = true
            postWakeUpNotification()
        }
         */
    }

    private func postWakeUpNotification() {
        let content = UNMutableNotificationContent()
        content.title = "Content ready"
        content.body = "Open Sylk to share it"
        content.sound = .default
        content.userInfo = ["key": sharedKey]

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        let request = UNNotificationRequest(identifier: "sylk-share-wakeup-\(UUID().uuidString)", content: content, trigger: trigger)

        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                NSLog("[SYLK_APP] [ShareExt] Failed to post wake-up notification: \(error)")
            } else {
                NSLog("[SYLK_APP] [ShareExt] Wake-up notification posted")
            }

            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }
    
    @objc private func openURL(_ url: URL) -> Bool {
        var responder: UIResponder? = self
        while responder != nil {
            if let application = responder as? UIApplication {
                application.open(url)
                return true
            }
            responder = responder?.next
        }
        return false
    }

    private func openHostApp() {
        let urlString = "sylk://share?source=extension"
        guard let url = URL(string: urlString) else {
            NSLog("[SYLK_APP] [ShareExt] Invalid URL: \(urlString)")
            return
        }

        _ = openURL(url)
    }
    
}

