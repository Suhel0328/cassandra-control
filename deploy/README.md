# Deploy artifacts

- **systemd/** – systemd unit files for running the server and agent as services.
- **scripts/install-agent.sh** – installs the agent on a node (copies binary, sets URL, optionally enables systemd).

See the main **DEPLOYMENT.md** in the project root for full steps.

## Quick reference

**Server (once):** Copy `server`, `server.crt`, `server.key`, and `web/dashboard` to `/opt/cassandra-control`, then:

```bash
sudo cp systemd/cassandra-control-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cassandra-control-server
```

**Agent (each Cassandra node):** Copy `agent` to the node, then either:

- Run with env: `CASSANDRA_CONTROL_SERVER_URL=wss://YOUR_SERVER/agent ./agent`
- Or use the install script: `CASSANDRA_CONTROL_SERVER_URL=wss://YOUR_SERVER/agent ./scripts/install-agent.sh`
