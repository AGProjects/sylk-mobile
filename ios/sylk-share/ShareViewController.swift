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
        NSLog("[sylk_app] viewDidLoad called")
        NSLog("[sylk_app] Extension context: \(String(describing: self.extensionContext))")
        NSLog("[sylk_app] Input items count: \(self.extensionContext?.inputItems.count ?? 0)")
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        NSLog("[sylk_app] viewDidAppear called")
        handleSharedContent()
    }

    override func didSelectPost() { /* no-op */ }
    override func configurationItems() -> [Any]! { return [] }

    // MARK: - Handle shared content
    private func handleSharedContent() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem], !items.isEmpty else {
            NSLog("[sylk_app] No input items found")
            return
        }

        // Count total attachments for notification logic
        remainingFilesToProcess = items.compactMap { $0.attachments }.flatMap { $0 }.count
        didPostNotification = false
        NSLog("[sylk_app] Total attachments to process: \(remainingFilesToProcess)")

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
                    NSLog("[sylk_app] Skipping unsupported type(s): \(provider.registeredTypeIdentifiers)")
                    fileProcessingCompleted()
                    continue
                }

                NSLog("[sylk_app] Selected type: \(typeIdentifier)")

                provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { [weak self] data, error in
                    guard let self = self else { return }

                    if let error = error {
                        NSLog("[sylk_app] Error loading item: \(error.localizedDescription)")
                        self.fileProcessingCompleted()
                        return
                    }

                    NSLog("[sylk_app] Loaded item of type: \(typeIdentifier)")
                    self.processLoadedItem(data: data, typeIdentifier: typeIdentifier)
                }
            }
        }
    }

    // MARK: - Process loaded item
    private func processLoadedItem(data: NSSecureCoding?, typeIdentifier: String) {
        var fileData: Data?
        var fileName: String

        if let url = data as? URL {

            let ext = url.pathExtension.lowercased()

            if ext == "heic" || ext == "heif" {
                NSLog("[sylk_app] Skipping HEIC/HEIF file: \(url)")
                fileProcessingCompleted()
                return
            }

            fileName = "share-\(UUID().uuidString).\(ext)"

            do {
                NSLog("[sylk_app] Streaming copy for file: \(fileName)")
                try streamCopyItem(from: url, fileName: fileName)
            } catch {
                NSLog("[sylk_app] Streaming copy failed: \(error)")
            }
            fileProcessingCompleted()
            return
        }

        else if let text = data as? String {
            fileName = "share-\(UUID().uuidString).txt"
            fileData = text.data(using: .utf8)
            NSLog("[sylk_app] Saving text file: \(fileName)")
        }

        else if let raw = data as? Data {
            let ext = ((typeIdentifier as NSString).pathExtension.isEmpty ? "bin" : (typeIdentifier as NSString).pathExtension)
            fileName = "share-\(UUID().uuidString).\(ext)"
            fileData = raw
            NSLog("[sylk_app] Saving raw data file: \(fileName)")
        }

        else {
            fileName = "share-\(UUID().uuidString).bin"
            NSLog("[sylk_app] Unknown type, saving as: \(fileName)")
        }

        if typeIdentifier == "public.url", let url = data as? URL {
            fileName = "share-\(UUID().uuidString).weblink"
            fileData = url.absoluteString.data(using: .utf8)
            NSLog("[sylk_app] Saving URL as weblink: \(fileName)")
        }

        guard let fileData = fileData else {
            NSLog("[sylk_app] No data to save for file: \(fileName)")
            fileProcessingCompleted()
            return
        }

        saveSharedFile(fileData, fileName: fileName)
        fileProcessingCompleted()
    }

    // MARK: - File saving
    private func saveSharedFile(_ data: Data, fileName: String) {
        guard let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            NSLog("[sylk_app] Could not get App Group container")
            return
        }

        let fileURL = containerURL.appendingPathComponent(fileName)

        do {
            try data.write(to: fileURL)
            NSLog("[sylk_app] Saved shared file to: \(fileURL.path)")
        } catch {
            NSLog("[sylk_app] Failed to save shared file: \(error)")
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

        NSLog("[sylk_app] Streamed copy saved to: \(destinationURL.path)")
    }

    // MARK: - Notification handling
    private func fileProcessingCompleted() {
        remainingFilesToProcess -= 1
        NSLog("[sylk_app] Remaining files: \(remainingFilesToProcess)")

        if remainingFilesToProcess <= 0 && !didPostNotification {
            didPostNotification = true
            postWakeUpNotification()
        }
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
                NSLog("[sylk_app] Failed to post wake-up notification: \(error)")
            } else {
                NSLog("[sylk_app] Wake-up notification posted")
            }

            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }
}

