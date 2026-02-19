package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/cassandra-ops/control/internal/types"
	"gopkg.in/yaml.v3"
)

const (
	defaultServerURL           = "wss://3.109.48.138/agent"
	defaultAgentConfigPath      = "/etc/cassandra-control/agent.yml"
	otelMetricsJSON             = "/tmp/otel_cassandra_metrics.json"
	systemLogPath               = "/var/log/cassandra/system.log"
	commitLogDir                = "/var/lib/cassandra/commitlog"
	commitLogBackupDir          = "/opt/cassandra_commitlog_backups"
	maxSystemLogLines           = 200
	reconnectMinDelay            = 2 * time.Second
	reconnectMaxDelay            = 5 * time.Minute
	commandTimeout              = 4 * time.Minute
)

// AgentConfig is loaded from agent.yml (AxonOps-style).
type AgentConfig struct {
	ServerURL string `yaml:"server_url"`
	Org       string `yaml:"org,omitempty"`
	Key       string `yaml:"key,omitempty"`
}

func runCommand(cmd string, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
	defer cancel()
	c := exec.CommandContext(ctx, cmd, args...)
	out, err := c.CombinedOutput()
	if err != nil {
		return fmt.Sprintf("error: %v\n%s", err, string(out))
	}
	return string(out)
}

func getHostname() string {
	h, _ := os.Hostname()
	if h != "" {
		return h
	}
	return "unknown"
}

func getLocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return "0.0.0.0"
	}
	for _, a := range addrs {
		if ipnet, ok := a.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			return ipnet.IP.String()
		}
	}
	return "0.0.0.0"
}

func getClusterInfo() (cluster, dc, rack string) {
	out := runCommand("nodetool", "describecluster")
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Name:") {
			cluster = strings.TrimSpace(strings.TrimPrefix(line, "Name:"))
		}
		if strings.HasPrefix(line, "Datacenter:") {
			dc = strings.TrimSpace(strings.TrimPrefix(line, "Datacenter:"))
		}
		if strings.HasPrefix(line, "Rack:") {
			rack = strings.TrimSpace(strings.TrimPrefix(line, "Rack:"))
		}
	}
	return cluster, dc, rack
}

func sendResponse(conn *websocket.Conn, ok bool, output, errMsg string) {
	resp := types.Response{OK: ok, Output: output, Error: errMsg}
	body, _ := json.Marshal(resp)
	_ = conn.WriteMessage(websocket.TextMessage, body)
}

func handleCommand(conn *websocket.Conn, cmd types.Command) {
	var output string
	var errMsg string

	switch cmd.Action {
	case "start":
		output = runCommand("sudo", "systemctl", "start", "cassandra")
	case "stop":
		output = runCommand("sudo", "systemctl", "stop", "cassandra")
	case "restart":
		output = runCommand("sudo", "systemctl", "restart", "cassandra")
	case "status":
		output = runCommand("sudo", "systemctl", "is-active", "cassandra")
	case "metrics":
		data, err := os.ReadFile(otelMetricsJSON)
		if err != nil {
			// Fallback: read via sudo when file is root-owned (e.g. OTEL collector)
			dataStr := runCommand("sudo", "cat", otelMetricsJSON)
			dataStr = strings.TrimSpace(dataStr)
			if strings.HasPrefix(dataStr, "error:") || strings.Contains(dataStr, "Permission denied") || strings.Contains(dataStr, "a password is required") {
				output = ""
				errMsg = fmt.Sprintf("error reading OTEL metrics: %v. Add sudoers: echo 'cassandra-control ALL=(ALL) NOPASSWD: /bin/cat %s' | sudo tee /etc/sudoers.d/cassandra-control-metrics", err, otelMetricsJSON)
			} else {
				output = dataStr
			}
		} else {
			output = string(data)
		}
	case "backup":
		tag := fmt.Sprintf("snapshot_cassandra_ops_%s", time.Now().Format("20060102_150405"))
		output = runCommand("nodetool", "snapshot", "-t", tag)
		output = fmt.Sprintf("Backup tag: %s\n%s", tag, output)
	case "restore":
		parts := strings.SplitN(cmd.Params, ",", 3)
		if len(parts) != 3 {
			sendResponse(conn, false, "", "restore params: keyspace,table,/path/to/dir")
			return
		}
		output = runCommand("nodetool", "import",
			strings.TrimSpace(parts[0]),
			strings.TrimSpace(parts[1]),
			strings.TrimSpace(parts[2]))
	case "logs":
		out, err := exec.Command("tail", "-n", fmt.Sprintf("%d", maxSystemLogLines), systemLogPath).CombinedOutput()
		if err != nil {
			output = ""
			errMsg = fmt.Sprintf("error reading system.log: %v", err)
		} else {
			output = fmt.Sprintf("Last %d lines:\n%s", maxSystemLogLines, string(out))
		}
	case "commitlogs":
		output = listCommitLogs()
	case "archive_commitlog":
		output, errMsg = archiveCommitLog(cmd.Params)
	default:
		errMsg = "unknown command: " + cmd.Action
	}

	if errMsg != "" {
		sendResponse(conn, false, output, errMsg)
	} else {
		sendResponse(conn, true, output, "")
	}
}

func listCommitLogs() string {
	entries, err := os.ReadDir(commitLogDir)
	if err != nil {
		return fmt.Sprintf("Error reading commitlog dir: %v", err)
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf("CommitLog files in %s:\n", commitLogDir))
	b.WriteString(strings.Repeat("-", 60) + "\n")
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, _ := e.Info()
		size := float64(0)
		if info != nil {
			size = float64(info.Size()) / 1024 / 1024
		}
		mod := ""
		if info != nil && !info.ModTime().IsZero() {
			mod = info.ModTime().Format("2006-01-02 15:04:05")
		}
		b.WriteString(fmt.Sprintf("%-40s  %10.2f MB  %s\n", e.Name(), size, mod))
	}
	return b.String()
}

func archiveCommitLog(params string) (output string, errMsg string) {
	if err := os.MkdirAll(commitLogBackupDir, 0755); err != nil {
		return "", fmt.Sprintf("creating backup dir: %v", err)
	}
	params = strings.TrimSpace(params)
	if params == "all" {
		entries, _ := os.ReadDir(commitLogDir)
		for _, e := range entries {
			if !e.IsDir() {
				src := filepath.Join(commitLogDir, e.Name())
				dst := filepath.Join(commitLogBackupDir, e.Name()+".bak")
				if copyFile(src, dst) != nil {
					return "", fmt.Sprintf("copy %s failed", e.Name())
				}
			}
		}
		return fmt.Sprintf("All commit logs archived to %s", commitLogBackupDir), ""
	}
	src := filepath.Join(commitLogDir, params)
	dst := filepath.Join(commitLogBackupDir, params+".bak")
	if copyFile(src, dst) != nil {
		return "", fmt.Sprintf("archiving %s failed", params)
	}
	return fmt.Sprintf("Commit log %s archived to %s", params, commitLogBackupDir), ""
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func getConfigPath() string {
	if p := os.Getenv("CASSANDRA_CONTROL_AGENT_CONFIG"); p != "" {
		return p
	}
	return defaultAgentConfigPath
}

func loadConfig() AgentConfig {
	var cfg AgentConfig
	path := getConfigPath()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			cfg.ServerURL = defaultServerURL
			return cfg
		}
		log.Printf("Warning: reading config %s: %v; using defaults", path, err)
		cfg.ServerURL = defaultServerURL
		return cfg
	}
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		log.Printf("Warning: invalid YAML in %s: %v; using defaults", path, err)
		cfg.ServerURL = defaultServerURL
		return cfg
	}
	return cfg
}

func getServerURL() string {
	if u := os.Getenv("CASSANDRA_CONTROL_SERVER_URL"); u != "" {
		return u
	}
	cfg := loadConfig()
	if cfg.ServerURL != "" {
		return cfg.ServerURL
	}
	return defaultServerURL
}

func run(ctx context.Context) error {
	serverURL := getServerURL()
	dialer := websocket.Dialer{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		HandshakeTimeout: 10 * time.Second,
	}
	conn, _, err := dialer.Dial(serverURL, nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	cluster, dc, rack := getClusterInfo()
	meta := types.AgentMetadata{
		Hostname:   getHostname(),
		IP:         getLocalIP(),
		Cluster:    cluster,
		DataCenter: dc,
		Rack:       rack,
		Version:    "1.0",
	}
	metaBody, _ := json.Marshal(meta)
	if err := conn.WriteMessage(websocket.TextMessage, metaBody); err != nil {
		return err
	}

	log.Println("Connected to control server")
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		var cmd types.Command
		if err := json.Unmarshal(msg, &cmd); err != nil {
			sendResponse(conn, false, "", "invalid command JSON")
			continue
		}
		handleCommand(conn, cmd)
	}
}

func main() {
	delay := reconnectMinDelay
	for {
		ctx := context.Background()
		err := run(ctx)
		log.Printf("Connection lost: %v; reconnecting in %v", err, delay)
		time.Sleep(delay)
		if delay < reconnectMaxDelay {
			delay *= 2
			if delay > reconnectMaxDelay {
				delay = reconnectMaxDelay
			}
		}
	}
}
