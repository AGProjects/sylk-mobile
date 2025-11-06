//
//   SharedDataManager.swift
//  sylk
//
//  Created by Adrian Georgescu on 11/5/25.
//  Copyright © 2025 Facebook. All rights reserved.
//

import Foundation

@objc class SharedDataManager: NSObject {
    @objc static func getSharedData() -> String? {
        let sharedDefaults = UserDefaults(suiteName: "group.com.agprojects.sylk-ios")
        let data = sharedDefaults?.string(forKey: "sharedData")
        if let data = data {
            print("[sylk_main] Received shared data: \(data)")
            // Remove it so it’s not read again next launch
            sharedDefaults?.removeObject(forKey: "sharedData")
        } else {
            print("[sylk_main] No shared data found")
        }
        return data
    }
}

