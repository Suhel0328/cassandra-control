package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/cassandra-ops/control/internal/server"
)

func getEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

func main() {
	reg := server.NewRegistry()

	certFile := getEnv("CASSANDRA_CONTROL_CERT_FILE", "server.crt")
	keyFile := getEnv("CASSANDRA_CONTROL_KEY_FILE", "server.key")
	dashboardDir := getEnv("CASSANDRA_CONTROL_DASHBOARD_DIR", "web/dashboard")
	agentBinaryPath := getEnv("CASSANDRA_CONTROL_AGENT_BINARY", "")

	mux := http.NewServeMux()
	mux.HandleFunc("/agent", server.AgentHandler(reg))
	mux.HandleFunc("/api/nodes", server.APIListNodes(reg))
	mux.HandleFunc("/api/execute", server.APIExecute(reg))
	if agentBinaryPath != "" {
		mux.HandleFunc("/agent-binary", server.ServeAgentBinary(agentBinaryPath))
		mux.HandleFunc("/install-agent.sh", server.ServeInstallScript(dashboardDir))
	}

	fs := http.FileServer(http.Dir(dashboardDir))
	mux.Handle("/", fs)

	srv := &http.Server{
		Addr:         ":443",
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Println("Cassandra Control Server listening on :443 (HTTPS)")
		if err := srv.ListenAndServeTLS(certFile, keyFile); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server shutdown error:", err)
	}
	log.Println("Server stopped")
}
