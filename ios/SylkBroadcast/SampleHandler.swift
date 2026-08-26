//
//  SampleHandler.swift
//  Broadcast Extension
//

import ReplayKit
import OSLog

let broadcastLogger = OSLog(subsystem: "com.agprojects.sylk", category: "Broadcast")
private enum Constants {
    // the App Group ID value that the app and the broadcast extension targets are setup with. It differs for each app.
    static let appGroupIdentifier = "group.com.agprojects.sylk-ios"
    static let videoSocketName = "rtc_SSFD"
    static let audioSocketName = "rtc_SSFD_audio"
    static let audioConnectMaxAttempts = 300
    static let videoConnectMaxAttempts = 300   // ~30s at 100ms; app socket normally appears in <2s
}
class SampleHandler: RPBroadcastSampleHandler {

    private var videoClientConnection: SocketConnection?
    private var videoUploader: SampleUploader?

    private var audioClientConnection: SocketConnection?
    private var audioUploader: AudioUploader?

    private var frameCount: Int = 0

    private func socketFilePath(for name: String) -> String {
        let sharedContainer = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Constants.appGroupIdentifier)
        return sharedContainer?.appendingPathComponent(name).path ?? ""
    }

    var socketFilePath: String {
        socketFilePath(for: Constants.videoSocketName)
    }

    var audioSocketFilePath: String {
        socketFilePath(for: Constants.audioSocketName)
    }

    override init() {
      super.init()
        if let connection = SocketConnection(filePath: socketFilePath) {
          videoClientConnection = connection
          setupVideoConnection()

          videoUploader = SampleUploader(connection: connection)
        }

        if let connection = SocketConnection(filePath: audioSocketFilePath) {
          audioClientConnection = connection
          setupAudioConnection()

          audioUploader = AudioUploader(connection: connection)
        }
        NSLog("[SYLK_APP] [Broadcast] \(socketFilePath)")
    }

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        // User has requested to start the broadcast. Setup info from the UI extension can be supplied but optional.
        frameCount = 0
        NSLog("[SYLK_APP] [Broadcast] >> broadcast STARTED (user tapped Start Broadcast); socket=\(socketFilePath)")

        DarwinNotificationCenter.shared.postNotification(.broadcastStarted)
        openVideoConnection()
        openAudioConnection()
    }

    override func broadcastPaused() {
        // User has requested to pause the broadcast. Samples will stop being delivered.
        NSLog("[SYLK_APP] [Broadcast] broadcast PAUSED")
    }

    override func broadcastResumed() {
        // User has requested to resume the broadcast. Samples delivery will resume.
        NSLog("[SYLK_APP] [Broadcast] broadcast RESUMED")
    }

    override func broadcastFinished() {
        // User has requested to finish the broadcast.
        NSLog("[SYLK_APP] [Broadcast] << broadcast FINISHED (user stopped); total video frames=\(frameCount)")
        DarwinNotificationCenter.shared.postNotification(.broadcastStopped)
        videoClientConnection?.close()
        audioClientConnection?.close()
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        switch sampleBufferType {
        case RPSampleBufferType.video:
            frameCount += 1
            if frameCount == 1 {
                NSLog("[SYLK_APP] [Broadcast] first video frame captured — uploading to app")
            } else if frameCount % 120 == 0 {
                NSLog("[SYLK_APP] [Broadcast] video frames captured: \(frameCount)")
            }
            videoUploader?.send(sample: sampleBuffer)
        case RPSampleBufferType.audioApp:
            audioUploader?.send(sample: sampleBuffer)
        default:
            // .audioMic is handled by the app's audio device module; ignore it here.
            break
        }
    }
}

private extension SampleHandler {

    func setupVideoConnection() {
        videoClientConnection?.didClose = { [weak self] error in
            NSLog("[SYLK_APP] [Broadcast] client connection did close \(String(describing: error))")

            if let error = error {
                self?.finishBroadcastWithError(error)
            } else {
                // the displayed failure message is more user friendly when using NSError instead of Error
                let JMScreenSharingStopped = 10001
                let customError = NSError(domain: RPRecordingErrorDomain, code: JMScreenSharingStopped, userInfo: [NSLocalizedDescriptionKey: "Screen sharing stopped"])
                self?.finishBroadcastWithError(customError)
            }
        }
    }

    func setupAudioConnection() {
        // closed audio socket must not tear down the whole broadcast.
        audioClientConnection?.didClose = { error in
            NSLog("[SYLK_APP] [Broadcast] audio connection did close \(String(describing: error))")
        }
    }

    func openVideoConnection() {
        let queue = DispatchQueue(label: "broadcast.connectTimer")
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(100), leeway: .milliseconds(500))
        var attempts = 0
        timer.setEventHandler { [weak self] in
            attempts += 1
            if self?.videoClientConnection?.open() == true {
                NSLog("[SYLK_APP] [Broadcast] video socket connected to app — streaming frames")
                timer.cancel()
                return
            }
            // The app side creates the shared-App-Group socket as soon as it
            // starts the screen capture (getDisplayMedia), so it should appear
            // within a second or two. If it never does — e.g. the App Group is
            // not provisioned on the app, so it can't bind the socket — don't
            // spin forever capturing frames into a dead pipe. Give up after
            // ~30s and finish the broadcast with a clear error instead of
            // leaving it running (and the OS still "recording") indefinitely.
            if attempts >= Constants.videoConnectMaxAttempts {
                timer.cancel()
                NSLog("[SYLK_APP] [Broadcast] video socket never appeared after \(attempts) attempts — app not receiving (App Group / socket not created). Finishing broadcast.")
                let err = NSError(domain: RPRecordingErrorDomain, code: 10002,
                                  userInfo: [NSLocalizedDescriptionKey: "Screen sharing could not connect to Blink"])
                self?.finishBroadcastWithError(err)
            }
        }

        timer.resume()
    }

    func openAudioConnection() {
        let queue = DispatchQueue(label: "broadcast.audioConnectTimer")
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(100), leeway: .milliseconds(500))
        var attempts = 0
        timer.setEventHandler { [weak self] in
            attempts += 1
            if self?.audioClientConnection?.open() == true {
                timer.cancel()
                return
            }
            if attempts >= Constants.audioConnectMaxAttempts {
                timer.cancel()
            }
        }

        timer.resume()
    }
}
