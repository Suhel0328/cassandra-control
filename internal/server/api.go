package server

import (
	"encoding/json"
	"net/http"
)

// NodeDTO is the JSON representation of a node for the API.
type NodeDTO struct {
	IP          string `json:"ip"`
	Hostname    string `json:"hostname"`
	Cluster     string `json:"cluster"`
	DataCenter  string `json:"data_center"`
	Rack        string `json:"rack"`
	ConnectedAt string `json:"connected_at"`
	LastSeen    string `json:"last_seen"`
	Version     string `json:"version"`
}

// APIListNodes returns all connected nodes.
func APIListNodes(reg *Registry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		nodes := reg.List()
		dtos := make([]NodeDTO, 0, len(nodes))
		for _, n := range nodes {
			dtos = append(dtos, NodeDTO{
				IP:          n.IP,
				Hostname:    n.Hostname,
				Cluster:     n.Cluster,
				DataCenter:  n.DataCenter,
				Rack:        n.Rack,
				ConnectedAt: n.ConnectedAt.Format("2006-01-02T15:04:05Z07:00"),
				LastSeen:    n.LastSeen.Format("2006-01-02T15:04:05Z07:00"),
				Version:     n.Version,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"nodes": dtos,
			"total": len(dtos),
		})
	}
}

// ExecuteRequest is the JSON body for execute command.
type ExecuteRequest struct {
	Target string `json:"target"` // IP or "all"
	Action string `json:"action"`
	Params string `json:"params"`
}

// ExecuteResponse is the JSON response.
type ExecuteResponse struct {
	Results map[string]CommandResultDTO `json:"results"`
}

type CommandResultDTO struct {
	Output string `json:"output"`
	Error  string `json:"error,omitempty"`
}

// APIExecute runs a command on one or all nodes.
func APIExecute(reg *Registry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req ExecuteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		if req.Action == "" {
			http.Error(w, "action required", http.StatusBadRequest)
			return
		}

		var results map[string]CommandResult
		if req.Target == "all" {
			results = ExecuteCommandAll(reg, req.Action, req.Params)
		} else {
			out, err := ExecuteCommand(reg, req.Target, req.Action, req.Params)
			results = map[string]CommandResult{req.Target: {Output: out, Error: err}}
		}

		dtos := make(map[string]CommandResultDTO)
		for ip, r := range results {
			e := ""
			if r.Error != nil {
				e = r.Error.Error()
			}
			dtos[ip] = CommandResultDTO{Output: r.Output, Error: e}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ExecuteResponse{Results: dtos})
	}
}
