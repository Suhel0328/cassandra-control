# Cassandra Control (AxonOps-style)

Central control server and agents for Apache Cassandra: run start/stop/restart, status, metrics, backup, restore, logs, and commitlog operations from one place. No inbound ports on Cassandra nodes; agents connect outbound over HTTPS (443).

## Publish to GitHub and let anyone install

1. **Push this repo to your GitHub:**  
   `https://github.com/Suhel0328/cassandra-control`

2. **Create a release** so the agent (and server) binaries are available for the install script:
   - Push a version tag: `git tag v0.1.0 && git push origin v0.1.0`
   - The [GitHub Actions workflow](.github/workflows/release.yml) will build the agent and server for Linux (amd64 and arm64) and attach them to the release.

3. **Anyone with a control server** can then install the agent on each Cassandra node with one command (replace `YOUR_SERVER` with your control server hostname or IP):

   ```bash
   sudo apt-get update && sudo apt-get install -y curl ca-certificates
   curl -sSL https://raw.githubusercontent.com/Suhel0328/cassandra-control/main/scripts/install-agent.sh | sudo bash -s -- --server-url wss://YOUR_SERVER/agent
   ```
   (The script defaults to repo `Suhel0328/cassandra-control`; omit `--github-repo` unless using a fork.)

   Then they add the config file (if needed), set permissions, and start the agent — same flow as AxonOps. Full steps: **[SETUP.md](SETUP.md)**.

## What’s included

- **Control server** (`cmd/server`): HTTPS + WebSocket on port 443, REST API for the dashboard, node registry with metadata.
- **Cassandra agent** (`cmd/agent`): Runs on each node, connects outbound to the server, sends hostname/cluster/DC/rack, reconnects with backoff, runs commands and returns structured JSON.
- **Web dashboard** (`web/dashboard`): List connected nodes, run commands (single node or all), view results.

## Build

```bash
go build -o bin/server ./cmd/server
go build -o bin/agent ./cmd/agent
```

## Run the server

1. Put TLS certs in the project root: `server.crt`, `server.key`.
2. From the **project root** (so `web/dashboard` is found):

   ```bash
   ./bin/server
   ```

3. Open the dashboard: **https://YOUR_SERVER_IP/** (same host as the server).

## Run the agent

On each Cassandra node:

1. Copy `bin/agent`.
2. Optionally set the control server URL: `export CASSANDRA_CONTROL_SERVER_URL=wss://YOUR_SERVER_IP/agent` (default is built-in).
3. Run: `./agent` (e.g. via systemd so it restarts).

The agent will register with the server (hostname, cluster, DC, rack), then wait for commands.

## API (for dashboard / automation)

- **GET /api/nodes** – List connected nodes (IP, hostname, cluster, data_center, rack, connected_at, last_seen).
- **POST /api/execute** – Run a command.

  Body:

  ```json
  { "target": "10.0.0.1", "action": "status", "params": "" }
  ```

  Or `"target": "all"` to run on all nodes.  
  Supported `action`: `start`, `stop`, `restart`, `status`, `metrics`, `logs`, `commitlogs`, `backup`, `restore`, `archive_commitlog`.  
  `params` required for `restore` (keyspace,table,/path) and `archive_commitlog` (filename or `all`).

## Production notes

- **Server**: Runs TLS on 443, graceful shutdown on SIGINT/SIGTERM. Run from project root so the dashboard is served from `web/dashboard`.
- **Agent**: Exponential backoff reconnect (2s up to 5m). Sends metadata on connect. Command timeout 4 minutes. Uses `nodetool` where applicable; ensure Cassandra paths (e.g. `/var/log/cassandra`, `/var/lib/cassandra/commitlog`) match your install.
- **Dashboard**: Refreshes node list on button click; run command form supports “All nodes” or a single node. Results shown in a single text area.

## Agent setup (AxonOps-style)

To install the agent from **GitHub with one command** (like AxonOps), see **[SETUP.md](SETUP.md)**. It includes:

- One command to install from your GitHub repo (script downloads the agent from Releases).
- Config file `/etc/cassandra-control/agent.yml` with `server_url`.
- `chmod` and user/group setup (`cassandra-control` + Cassandra group).
- Systemd service and start. After that, the node appears in the dashboard.

## Deployment and client handoff

For **deploying on AWS EC2** (server + agents on Cassandra nodes) and **sharing with a client** (what to give them and how they set it up), see **[DEPLOYMENT.md](DEPLOYMENT.md)**. It includes:

- Step-by-step server and agent deployment (including EC2 security groups).
- How to access the dashboard.
- Systemd units and an install script (`deploy/`).
- Client handoff: what to package, one-page quick start, and environment variables.

## Project layout

```
.
├── .github/workflows/
│   └── release.yml   # Build and publish release on tag v*
├── cmd/
│   ├── server/       # Control server main
│   └── agent/        # Node agent main
├── internal/
│   ├── types/        # Shared types (Command, Response, AgentMetadata)
│   └── server/       # Registry, agent handler, executor, API
├── scripts/
│   └── install-agent.sh   # One-command install from GitHub
├── web/
│   └── dashboard/    # index.html, styles.css, app.js
├── deploy/           # Systemd units, agent.yml.example, legacy install script
├── go.mod
├── SETUP.md          # AxonOps-style agent setup
└── README.md
```
