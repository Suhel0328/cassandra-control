package server

import (
	"net/http"
	"os"
	"path/filepath"
)

// ServeAgentBinary serves the agent binary for download (e.g. by install script with --download-binary).
func ServeAgentBinary(path string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		f, err := os.Open(path)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil || info.IsDir() {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", "attachment; filename=agent")
		http.ServeContent(w, r, "agent", info.ModTime(), f)
	}
}

// ServeInstallScript serves the install script from the dashboard dir (e.g. install-agent.sh).
func ServeInstallScript(dashboardDir string) http.HandlerFunc {
	scriptPath := filepath.Join(dashboardDir, "install-agent.sh")
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		http.ServeFile(w, r, scriptPath)
	}
}
