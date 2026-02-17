package types

// AgentMetadata is sent by the agent when it connects.
type AgentMetadata struct {
	Hostname   string `json:"hostname"`
	IP         string `json:"ip"`
	Cluster    string `json:"cluster,omitempty"`
	DataCenter string `json:"data_center,omitempty"`
	Rack       string `json:"rack,omitempty"`
	Version    string `json:"version,omitempty"`
}

// Command from server to agent.
type Command struct {
	Action string `json:"action"`
	Params string `json:"params,omitempty"`
}

// Response from agent to server (structured).
type Response struct {
	OK      bool   `json:"ok"`
	Output  string `json:"output,omitempty"`
	Error   string `json:"error,omitempty"`
	Command string `json:"command,omitempty"`
}

// Server -> Agent message types.
const (
	MsgTypeCommand  = "command"
	MsgTypePing     = "ping"
)

// Agent -> Server message types.
const (
	MsgTypeRegister = "register"
	MsgTypeResult   = "result"
	MsgTypePong    = "pong"
)
