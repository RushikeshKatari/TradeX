import AppKit

@main
final class TradeXApp: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var backend: Process?
    private var stateTimer: Timer?
    private var scrapingSwitch: NSSwitch!
    private var statusLabel: NSTextField!
    // Keep the dashboard on its original browser origin so localStorage-backed
    // Portfolio PnL positions survive app upgrades and relaunches.
    private let port = 8766
    private var sendingToggle = false

    static func main() {
        let app = NSApplication.shared
        let delegate = TradeXApp()
        app.delegate = delegate
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildWindow()
        scrapingSwitch.state = .off
        statusLabel.stringValue = "Backend is OFF"
        stateTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in self?.refreshState() }
    }

    private func buildWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 380, height: 180),
                          styleMask: [.titled, .closable, .miniaturizable],
                          backing: .buffered, defer: false)
        window.title = "TradeX Scraper"
        window.center()

        let title = NSTextField(labelWithString: "Backend scraping")
        title.font = .systemFont(ofSize: 19, weight: .semibold)
        title.frame = NSRect(x: 28, y: 108, width: 230, height: 28)

        scrapingSwitch = NSSwitch(frame: NSRect(x: 284, y: 102, width: 50, height: 32))
        scrapingSwitch.target = self
        scrapingSwitch.action = #selector(toggleScraping(_:))

        statusLabel = NSTextField(labelWithString: "Connecting to scraper…")
        statusLabel.font = .systemFont(ofSize: 12)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.frame = NSRect(x: 28, y: 64, width: 320, height: 22)

        window.contentView?.addSubview(title)
        window.contentView?.addSubview(scrapingSwitch)
        window.contentView?.addSubview(statusLabel)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func startBackend() throws {
        if let backend = backend, backend.isRunning { return }
        guard let resources = Bundle.main.resourceURL else { throw NSError(domain: "TradeX", code: 1, userInfo: [NSLocalizedDescriptionKey: "App resources are missing."]) }
        let backendDir = resources.appendingPathComponent("backend", isDirectory: true)
        let python = resources.appendingPathComponent("runtime/bin/python")
        let dataDir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/TradeX/data", isDirectory: true)
        try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
        let seed = backendDir.appendingPathComponent("tradex_config.json")
        let config = dataDir.appendingPathComponent("tradex_config.json")
        if !FileManager.default.fileExists(atPath: config.path) { try FileManager.default.copyItem(at: seed, to: config) }

        let process = Process()
        process.executableURL = python
        process.arguments = [backendDir.appendingPathComponent("app.py").path]
        process.currentDirectoryURL = backendDir
        var env = ProcessInfo.processInfo.environment
        env["PORT"] = String(port)
        env["TRADEX_DATA_DIR"] = dataDir.path
        env["PLAYWRIGHT_BROWSERS_PATH"] = resources.appendingPathComponent("ms-playwright").path
        env["PYTHONUNBUFFERED"] = "1"
        process.environment = env

        let backendLog = dataDir.appendingPathComponent("backend.log")
        if !FileManager.default.fileExists(atPath: backendLog.path) { FileManager.default.createFile(atPath: backendLog.path, contents: nil) }
        let logHandle = try FileHandle(forWritingTo: backendLog)
        try logHandle.seekToEnd()
        process.standardOutput = logHandle
        process.standardError = logHandle
        process.terminationHandler = { [weak self] terminated in
            try? "\nBackend exited with status \(terminated.terminationStatus)\n".write(to: backendLog, atomically: true, encoding: .utf8)
            DispatchQueue.main.async {
                guard let self = self else { return }
                if self.backend === terminated { self.backend = nil }
                if !self.sendingToggle {
                    self.scrapingSwitch?.state = .off
                    self.statusLabel?.stringValue = "Backend is OFF"
                }
            }
        }
        try process.run()
        backend = process
    }

    @objc private func toggleScraping(_ sender: NSSwitch) {
        guard !sendingToggle else { return }
        sendingToggle = true
        sender.isEnabled = false
        let enabled = sender.state == .on
        if enabled {
            statusLabel.stringValue = "Starting backend…"
            do {
                try startBackend()
                postJSON(path: "/api/scraping", body: ["enabled": true], retries: 40) { [weak self] data, response, error in
                    guard let self = self else { return }
                    let result = try? JSONSerialization.jsonObject(with: data ?? Data()) as? [String: Any]
                    let actualEnabled = result?["enabled"] as? Bool ?? false
                    let ok = error == nil && (response as? HTTPURLResponse)?.statusCode == 200 && actualEnabled
                    DispatchQueue.main.async {
                        self.sendingToggle = false
                        sender.isEnabled = true
                        guard ok else {
                            sender.state = .off
                            self.backend?.terminate()
                            self.statusLabel.stringValue = "Could not start the backend"
                            return
                        }
                        sender.state = .on
                        self.statusLabel.stringValue = "Scraping is ON · opening dashboard in Chrome…"
                        self.openDashboardInChrome()
                    }
                }
            } catch {
                sendingToggle = false
                sender.isEnabled = true
                sender.state = .off
                statusLabel.stringValue = "Could not start the backend"
                showError(error.localizedDescription)
            }
        } else {
            statusLabel.stringValue = "Stopping backend…"
            postJSON(path: "/api/shutdown", body: [:], retries: 0) { [weak self] _, _, _ in
                guard let self = self else { return }
                DispatchQueue.main.async {
                    self.waitForBackendExit(attempt: 0) {
                        self.sendingToggle = false
                        sender.isEnabled = true
                        sender.state = .off
                        self.statusLabel.stringValue = self.backend?.isRunning == true
                            ? "Backend did not stop · force stopping…"
                            : "Scraping is OFF · backend stopped"
                    }
                }
            }
        }
    }

    private func postJSON(path: String, body: [String: Any], retries: Int,
                          completion: @escaping (Data?, URLResponse?, Error?) -> Void) {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)\(path)")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            let successful = error == nil && (response as? HTTPURLResponse)?.statusCode == 200
            if !successful && retries > 0 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    self?.postJSON(path: path, body: body, retries: retries - 1, completion: completion)
                }
            } else {
                completion(data, response, error)
            }
        }.resume()
    }

    private func waitForBackendExit(attempt: Int, completion: @escaping () -> Void) {
        guard let process = backend, process.isRunning else {
            backend = nil
            completion()
            return
        }
        guard attempt < 40 else {
            process.terminate()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { completion() }
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            self?.waitForBackendExit(attempt: attempt + 1, completion: completion)
        }
    }

    private func openDashboardInChrome() {
        let dashboardURL = URL(string: "http://localhost:\(port)/")!
        guard let chromeURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.google.Chrome") else {
            statusLabel.stringValue = "Scraping is ON · Google Chrome is not installed"
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        NSWorkspace.shared.open([dashboardURL], withApplicationAt: chromeURL, configuration: configuration) { [weak self] _, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.statusLabel.stringValue = error == nil
                    ? "Scraping is ON · dashboard opened in Chrome"
                    : "Scraping is ON · could not open Chrome"
            }
        }
    }

    private func refreshState() {
        guard backend?.isRunning == true else { return }
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/state") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            guard let self = self, error == nil, (response as? HTTPURLResponse)?.statusCode == 200,
                  let data = data,
                  let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let enabled = result["enabled"] as? Bool else { return }
            DispatchQueue.main.async {
                guard !self.sendingToggle else { return }
                self.scrapingSwitch?.state = enabled ? .on : .off
                self.statusLabel?.stringValue = enabled ? "Scraping is ON · backend is live" : "Scraping is OFF · backend is ready"
            }
        }.resume()
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "TradeX could not start its backend"
        alert.informativeText = message
        alert.alertStyle = .critical
        alert.runModal()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        stateTimer?.invalidate()
        if let process = backend, process.isRunning { process.terminate() }
        return .terminateNow
    }
}
