package server

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/cassandra-ops/control/internal/types"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

const (
	writeWait      = 15 * time.Second
	pongWait       = 5 * time.Minute   // long idle so proxies/firewalls don't drop the connection
	pingPeriod     = 2 * time.Minute   // send ping every 2 min to keep connection alive
	maxMessageSize = 512 * 1024
)

// AgentHandler upgrades HTTP to WebSocket and registers the agent.
func AgentHandler(reg *Registry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Println("Upgrade error:", err)
			return
		}
		defer conn.Close()

		ip := strings.Split(r.RemoteAddr, ":")[0]
		conn.SetReadLimit(maxMessageSize)
		conn.SetReadDeadline(time.Now().Add(pongWait))
		conn.SetPongHandler(func(string) error {
			conn.SetReadDeadline(time.Now().Add(pongWait))
			reg.UpdateLastSeen(ip)
			return nil
		})

		// First message must be register with metadata
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Println("Read register error:", err)
			return
		}

		var meta types.AgentMetadata
		if err := json.Unmarshal(msg, &meta); err != nil || meta.IP == "" {
			meta.IP = ip
			meta.Hostname = ip
		}
		meta.IP = ip

		reg.Add(ip, conn, meta.Hostname, meta.Cluster, meta.DataCenter, meta.Rack, meta.Version)
		defer reg.Remove(ip)

		log.Printf("Agent connected: %s (%s) cluster=%s dc=%s", ip, meta.Hostname, meta.Cluster, meta.DataCenter)

		node, _ := reg.Get(ip)
		if node == nil {
			return
		}

		// Keepalive: send ping periodically so connection is not dropped by proxies/firewalls
		done := make(chan struct{})
		go func() {
			ticker := time.NewTicker(pingPeriod)
			defer ticker.Stop()
			for {
				select {
				case <-done:
					return
				case <-ticker.C:
					conn.SetWriteDeadline(time.Now().Add(writeWait))
					if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
						return
					}
				}
			}
		}()

		// Read loop: forward agent responses to channel so executor can receive them
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			reg.UpdateLastSeen(ip)
			select {
			case node.ResponseCh <- msg:
			default:
				// channel full or executor no longer waiting
			}
		}
		close(done)
		reg.Remove(ip)
	}
}
