import UIKit
import Social
import MobileCoreServices
import UserNotifications

class ShareViewController: SLComposeServiceViewController {
    
    let hostAppBundleIdentifier = "com.agprojects.sylk-ios"
    let shareProtocol = "com.agprojects.sylk"
    let sharedKey = "ShareKey"
    let appGroupId = "group.com.agprojects.sylk-ios"
    
    override func isContentValid() -> Bool { true }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        NSLog("[sylk_share] viewDidLoad called")
        NSLog("[sylk_share] Extension context: \(String(describing: self.extensionContext))")
        NSLog("[sylk_share] Input items count: \(self.extensionContext?.inputItems.count ?? 0)")
    }
    
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        NSLog("[sylk_share] viewDidAppear called")
        handleSharedContent()
    }
    
    override func didSelectPost() { /* no-op */ }
    override func configurationItems() -> [Any]! { return [] }
    
    private func handleSharedContent() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem], !items.isEmpty else {
            NSLog("[sylk_share] No input items found")
            return
        }
        
        for item in items {
            guard let attachments = item.attachments else { continue }
            
            for provider in attachments {
                for typeIdentifier in provider.registeredTypeIdentifiers {
                    
                    provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { [weak self] data, error in
                        guard let self = self else { return }
                        
                        if let error = error {
                            NSLog("[sylk_share] Error loading item: \(error.localizedDescription)")
                            return
                        }
                        
                        var fileData: Data?
                        var fileName: String
                        
                        if let url = data as? URL {
                            let ext = (url.pathExtension.isEmpty ? "bin" : url.pathExtension).lowercased()
                            fileName = "share-\(url.deletingPathExtension().lastPathComponent).\(ext)"
                            fileData = try? Data(contentsOf: url)
                            
                        } else if let text = data as? String {
                            fileName = "share-\(UUID().uuidString).txt"
                            fileData = text.data(using: .utf8)
                            
                        } else if let rawData = data as? Data {
                            let ext = ((typeIdentifier as NSString).pathExtension.isEmpty ? "bin" : (typeIdentifier as NSString).pathExtension).lowercased()
                            fileName = "share-\(UUID().uuidString).\(ext)"
                            fileData = rawData
                            
                        } else {
                            fileName = "share-\(UUID().uuidString).bin"
                        }
                        
                        // Special case: URLs saved as .weblink files
                        if typeIdentifier == "public.url", let url = data as? URL {
                            fileName = "share-\(UUID().uuidString).weblink"
                            fileData = url.absoluteString.data(using: .utf8)
                        }
                        
                        if let fileData = fileData {
                            self.saveSharedFile(fileData, fileName: fileName)
                        }
                    }
                }
            }
        }
    }
    
    private func saveSharedFile(_ data: Data, fileName: String) {
        guard let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            NSLog("[sylk_share] Could not get App Group container")
            return
        }
        
        let fileURL = containerURL.appendingPathComponent(fileName)
        
        do {
            try data.write(to: fileURL)
            NSLog("[sylk_share] Saved shared file to: \(fileURL.path)")
            postWakeUpNotification()
        } catch {
            NSLog("[sylk_share] Failed to save shared file: \(error)")
        }
    }
    
    private func postWakeUpNotification() {
        let content = UNMutableNotificationContent()
        content.title = "Shared content ready"
        content.body = "Open Sylk to view your shared content."
        content.sound = .default
        content.userInfo = ["key": sharedKey]
        
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        let request = UNNotificationRequest(identifier: "sylk-share-wakeup-\(UUID().uuidString)", content: content, trigger: trigger)
        
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                NSLog("[sylk_share] Failed to post wake-up notification: \(error)")
            } else {
                NSLog("[sylk_share] Wake-up notification posted")
            }
            
            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }
}
