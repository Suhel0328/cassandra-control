package server

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/cassandra-ops/control/internal/types"
)

const commandTimeout = 5 * time.Minute

// ExecuteCommand sends a command to a single node and returns the response.
func ExecuteCommand(reg *Registry, ip, action, params string) (string, error) {
	node, ok := reg.Get(ip)
	if !ok {
		return "", fmt.Errorf("node not found: %s", ip)
	}
	cmd := types.Command{Action: action, Params: params}
	body, _ := json.Marshal(cmd)

	node.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	if err := node.Conn.WriteMessage(websocket.TextMessage, body); err != nil {
		reg.Remove(ip)
		return "", err
	}

	var msg []byte
	select {
	case m, ok := <-node.ResponseCh:
		if !ok {
			return "", fmt.Errorf("connection closed")
		}
		msg = m
		reg.UpdateLastSeen(ip)
	case <-time.After(commandTimeout):
		reg.Remove(ip)
		return "", fmt.Errorf("command timeout")
	}

	var resp types.Response
	if err := json.Unmarshal(msg, &resp); err == nil {
		if resp.Error != "" {
			return resp.Output, fmt.Errorf("%s", resp.Error)
		}
		return resp.Output, nil
	}
	return string(msg), nil
}

// ExecuteCommandAll runs the command on all nodes and returns results per IP.
func ExecuteCommandAll(reg *Registry, action, params string) map[string]CommandResult {
	nodes := reg.List()
	result := make(map[string]CommandResult, len(nodes))
	var wg sync.WaitGroup
	var mu sync.Mutex
	for i := range nodes {
		ip := nodes[i].IP
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, err := ExecuteCommand(reg, ip, action, params)
			mu.Lock()
			result[ip] = CommandResult{Output: out, Error: err}
			mu.Unlock()
		}()
	}
	wg.Wait()
	return result
}

type CommandResult struct {
	Output string
	Error  error
}
