package server

import (
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Node represents a connected Cassandra agent.
type Node struct {
	IP          string
	Hostname    string
	Cluster     string
	DataCenter  string
	Rack        string
	Conn        *websocket.Conn
	ConnectedAt time.Time
	LastSeen    time.Time
	Version     string
	ResponseCh  chan []byte // responses from agent for command execution
}

// Registry holds all connected nodes.
type Registry struct {
	mu    sync.RWMutex
	nodes map[string]*Node // key = IP
}

func NewRegistry() *Registry {
	return &Registry{nodes: make(map[string]*Node)}
}

func (r *Registry) Add(ip string, conn *websocket.Conn, hostname, cluster, dc, rack, version string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nodes[ip] = &Node{
		IP:          ip,
		Hostname:    hostname,
		Cluster:     cluster,
		DataCenter:  dc,
		Rack:        rack,
		Conn:        conn,
		ConnectedAt: time.Now(),
		LastSeen:    time.Now(),
		Version:     version,
		ResponseCh:  make(chan []byte, 8),
	}
}

func (r *Registry) Remove(ip string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.nodes, ip)
}

func (r *Registry) Get(ip string) (*Node, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	n, ok := r.nodes[ip]
	return n, ok
}

func (r *Registry) UpdateLastSeen(ip string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if n, ok := r.nodes[ip]; ok {
		n.LastSeen = time.Now()
	}
}

func (r *Registry) List() []Node {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Node, 0, len(r.nodes))
	for _, n := range r.nodes {
		out = append(out, *n)
	}
	return out
}

func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.nodes)
}
