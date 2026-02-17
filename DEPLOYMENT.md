# Cassandra Control – Deployment Guide

This guide covers:
1. **Your setup**: Running the server (local or EC2) and deploying the agent on Cassandra nodes on AWS EC2.
2. **Dashboard access**: How to open and use the UI.
3. **Client handoff**: How to share this with a client and help them set it up.

---

## Part 1: Your Current Setup (Local + Cassandra on AWS EC2)

### Architecture

- **Control server**: Can run on your **local machine** or on an **EC2 instance**. It listens on **port 443 (HTTPS)** and serves the dashboard + API + agent WebSocket.
- **Agents**: Run on **each Cassandra EC2 node**. They open an **outbound** connection to the server (no inbound ports on Cassandra nodes).
- **Dashboard**: You open it in a browser at `https://<server-address>/`.

Important: **Agents must be able to reach the server on 443.**  
If the server is on your **local machine**, your Cassandra EC2 nodes cannot reach it unless you expose your home IP (e.g. port forward or VPN). So for a real deployment you typically run the **server on an EC2 instance** (or another VM) that the Cassandra nodes can reach.

---

### Step 1: Prepare the server (choose one place to run it)

#### Option A: Run server on an EC2 instance (recommended for AWS Cassandra)

1. **Launch an EC2 instance** (e.g. Amazon Linux 2 or Ubuntu) in the **same VPC** as your Cassandra cluster (or with network route to it). A small instance (e.g. t3.micro) is enough.

2. **Security group** for this server:
   - **Inbound**: allow **TCP 443** from:
     - Your IP (for dashboard and SSH), and/or
     - The Cassandra nodes’ security group (so agents can connect), and/or
     - `0.0.0.0/0` if you want to access the dashboard from anywhere (use with TLS and strong practices).
   - Outbound: allow all (or at least HTTPS to wherever you need).

3. **Build the server binary on your local machine** (or on the EC2 instance if you have Go there):
   ```bash
   cd /path/to/cassandra_operator_server_agent
   go build -o bin/server ./cmd/server
   ```

4. **Prepare TLS certificates** for HTTPS (required for port 443):
   - **Option (a) – Self-signed (quick test):**
     ```bash
     openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt -days 365 -nodes -subj "/CN=your-server-ip-or-dns"
     ```
   - **Option (b) – Proper cert:** Use Let’s Encrypt or your client’s CA and get `server.crt` and `server.key`.

5. **Copy to the EC2 server** (replace with your paths and host):
   ```bash
   scp -i your-key.pem bin/server server.crt server.key ec2-user@<SERVER_PUBLIC_IP>:~/
   scp -i your-key.pem -r web ec2-user@<SERVER_PUBLIC_IP>:~/
   ```
   So on the server you have: `~/server`, `~/server.crt`, `~/server.key`, `~/web/dashboard/`.

6. **SSH into the server** and run (dashboard is served from `web/dashboard`):
   ```bash
   ssh -i your-key.pem ec2-user@<SERVER_PUBLIC_IP>
   chmod +x server
   ./server
   ```
   Or use the systemd unit (see “Part 3: Systemd (production)” below).

7. **Note the server address** you will use:
   - From your laptop: `https://<SERVER_PUBLIC_IP>/` (dashboard).
   - From Cassandra nodes: `wss://<SERVER_PRIVATE_IP>/agent` or `wss://<SERVER_PUBLIC_IP>/agent` depending on how agents reach it (same VPC → private IP is fine).

#### Option B: Run server on your local machine (only if agents can reach it)

- Open **port 443** on your router/firewall and point it to your machine (or use a tunnel like ngrok for 443).
- Build and run from project root:
  ```bash
  go build -o bin/server ./cmd/server
  ./bin/server
  ```
- Use your **public IP** or the tunnel URL as the server address for agents and dashboard.

---

### Step 2: Deploy the agent on each Cassandra EC2 node

Do this on **every** Cassandra node in the cluster.

1. **Build the agent** (once, on your local or a build machine):
   ```bash
   cd /path/to/cassandra_operator_server_agent
   go build -o bin/agent ./cmd/agent
   ```

2. **Copy the binary** to each node (example for one node; repeat for all):
   ```bash
   scp -i your-key.pem bin/agent ec2-user@<CASSANDRA_NODE_IP>:~/
   ```

3. **SSH into the Cassandra node**:
   ```bash
   ssh -i your-key.pem ec2-user@<CASSANDRA_NODE_IP>
   ```

4. **Set the control server URL** (use the address the node can reach):
   - If server is on EC2 in same VPC:
     ```bash
     export CASSANDRA_CONTROL_SERVER_URL=wss://<SERVER_PRIVATE_OR_PUBLIC_IP>/agent
     ```
   - Replace with your server’s IP or hostname. Must be `wss://` (TLS).

5. **Run the agent** (foreground test):
   ```bash
   chmod +x agent
   ./agent
   ```
   You should see something like: `Connected to control server`.

6. **Run in background (e.g. systemd)** so it survives reboots (see Part 3).

7. **Repeat** for every other Cassandra node (different IP each time; same `CASSANDRA_CONTROL_SERVER_URL`).

---

### Step 3: Access the dashboard

1. On your **laptop**, open a browser.
2. Go to: **`https://<SERVER_IP_OR_DNS>/`**
   - Example: `https://3.109.48.138/` (use your server’s real IP or hostname).
3. If you use a **self-signed certificate**, the browser will warn: accept the exception (e.g. “Advanced” → “Proceed to …”) for your environment.
4. You should see:
   - **Connected nodes** (after you’ve started agents and clicked “Refresh nodes”).
   - **Run command**: choose target (single node or “All nodes”), action (status, start, stop, etc.), then “Run” and see results below.

---

### Step 4: Quick checklist (your setup)

| Item | Done |
|------|------|
| Server binary + `server.crt` + `server.key` + `web/dashboard` on server host | ☐ |
| Server security group allows TCP 443 from your IP and from Cassandra nodes | ☐ |
| Server running (e.g. `./server` or systemd) | ☐ |
| Agent binary on each Cassandra node | ☐ |
| `CASSANDRA_CONTROL_SERVER_URL=wss://<server>/agent` set where agent runs | ☐ |
| Agent running on each node (foreground or systemd) | ☐ |
| Dashboard opened at `https://<server>/` and nodes visible after “Refresh nodes” | ☐ |

---

## Part 2: Client Handoff – Sharing and Helping the Client Set Up

When you pitch this to a client using Cassandra, you can hand them the project and this process.

### What to give the client

1. **Artifacts** (choose one):
   - **Option A:** Source code repo (this project) + this `DEPLOYMENT.md` and `README.md`.
   - **Option B:** Pre-built binaries: `server`, `agent`, plus `web/dashboard` folder and this deployment doc.

2. **Client handoff package (zip)** – when you don’t give source, create a zip with:
   - `server` (binary)
   - `agent` (binary)
   - `web/dashboard/` (folder with `index.html`, `styles.css`, `app.js`)
   - `server.crt` and `server.key` (or ask client to provide their own)
   - `deploy/systemd/*.service`
   - `deploy/scripts/install-agent.sh`
   - `deploy/agent.yml.example`
   - `SETUP.md`, `DEPLOYMENT.md`, and `README.md`

   Example:
   ```bash
   mkdir -p client-package
   cp bin/server bin/agent client-package/
   cp -r web client-package/
   cp server.crt server.key client-package/
   cp -r deploy client-package/
   cp DEPLOYMENT.md README.md client-package/
   zip -r cassandra-control-client.zip client-package/
   ```

2. **Documentation:**
   - `README.md` – what the system does, build, run, API.
   - `SETUP.md` – AxonOps-style agent setup (copy-paste commands, agent.yml, systemd, user/group).
   - `DEPLOYMENT.md` – this file (deployment steps and client setup).
   - Optional: one-page “Quick start” (included below) with only the steps they need.

3. **Optional extras** (included in this repo):
   - `deploy/systemd/` – systemd unit files for server and agent.
   - `deploy/scripts/install-agent.sh` – example script to install the agent on a node.

### Client setup process (you can do this for them or guide them)

1. **Decide where the control server runs**
   - Their data center / cloud (e.g. EC2, on-prem VM). Same network path as Cassandra nodes so agents can reach it on 443.

2. **TLS certificates**
   - They provide `server.crt` and `server.key` (or you generate self-signed and hand over). Place them where the server will run (e.g. `/opt/cassandra-control/`).

3. **Install and run the server**
   - Copy `server` binary, `server.crt`, `server.key`, and `web/dashboard` to the server host.
   - Set env vars if needed (see “Environment variables” below).
   - Run `./server` or install the systemd unit and start the service.
   - Confirm: open `https://<server>/` and see the dashboard (may be empty until agents connect).

4. **Install the agent on every Cassandra node**
   - Copy `agent` to each node.
   - Set `CASSANDRA_CONTROL_SERVER_URL=wss://<their-server>/agent` (via env file or systemd unit).
   - Run agent (interactive or systemd).
   - In the dashboard, click “Refresh nodes” and confirm all nodes appear.

5. **Access and security**
   - Who should access the dashboard? Restrict by firewall (security group / ACL) to their IPs or VPN.
   - Optional next steps: add authentication (e.g. reverse proxy with basic auth or SSO) – not included in this doc but you can add it later.

### Environment variables (for client reference)

**Server:**

| Variable | Meaning | Example |
|----------|---------|--------|
| `CASSANDRA_CONTROL_CERT_FILE` | Path to TLS certificate | `/opt/cassandra-control/server.crt` |
| `CASSANDRA_CONTROL_KEY_FILE` | Path to TLS private key | `/opt/cassandra-control/server.key` |
| `CASSANDRA_CONTROL_DASHBOARD_DIR` | Directory with dashboard files (index.html, etc.) | `/opt/cassandra-control/web/dashboard` |

**Agent:**

| Variable | Meaning | Example |
|----------|---------|--------|
| `CASSANDRA_CONTROL_SERVER_URL` | Control server WebSocket URL | `wss://control.example.com/agent` |

### One-page “Quick start” you can send to the client

You can copy this into a short PDF or Confluence page:

---

**Cassandra Control – Quick start**

1. **Server (one machine)**  
   - Put `server`, `server.crt`, `server.key`, and the `web/dashboard` folder on the machine.  
   - Run: `./server` (or use the provided systemd service).  
   - Ensure port 443 is open for agents and for your browser.

2. **Agent (each Cassandra node)**  
   - Put `agent` on the node.  
   - Set: `export CASSANDRA_CONTROL_SERVER_URL=wss://<server-ip-or-hostname>/agent`  
   - Run: `./agent` (or use the provided systemd service).  
   - Repeat for every Cassandra node.

3. **Dashboard**  
   - In a browser, open: `https://<server-ip-or-hostname>/`  
   - Click “Refresh nodes” to see connected nodes.  
   - Select a node (or “All nodes”), choose an action, click “Run”, and check the results.

For full details and client setup, see `DEPLOYMENT.md`.

---

## Part 3: Systemd (production)

Running as a service keeps the server and agents up across reboots.

### Server

1. Copy the unit file to the server:
   ```bash
   sudo cp deploy/systemd/cassandra-control-server.service /etc/systemd/system/
   ```
2. Edit if needed:
   ```bash
   sudo nano /etc/systemd/system/cassandra-control-server.service
   ```
   Set `WorkingDirectory` and paths so the server finds `server.crt`, `server.key`, and `web/dashboard` (or set the env vars for cert and dashboard dir).

3. **Install files** under that working directory (e.g. `/opt/cassandra-control`): put `server` binary, `server.crt`, `server.key`, and the `web/dashboard/` folder there.

4. **Port 443:** The process must bind to 443. Either run the service as **root**, or set the capability so the binary can bind to privileged ports:
   ```bash
   sudo setcap 'cap_net_bind_service=+ep' /opt/cassandra-control/server
   ```
   Then you can add `User=...` in the unit file and uncomment the `CapabilityBoundingSet` / `AmbientCapabilities` lines in the unit.

5. Reload and start:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable cassandra-control-server
   sudo systemctl start cassandra-control-server
   sudo systemctl status cassandra-control-server
   ```

### Agent (each Cassandra node)

1. Copy the unit file:
   ```bash
   sudo cp deploy/systemd/cassandra-control-agent.service /etc/systemd/system/
   ```
2. Create override for the server URL:
   ```bash
   sudo mkdir -p /etc/systemd/system/cassandra-control-agent.service.d
   echo '[Service]' | sudo tee /etc/systemd/system/cassandra-control-agent.service.d/override.conf
   echo 'Environment="CASSANDRA_CONTROL_SERVER_URL=wss://YOUR_SERVER_IP_OR_HOST/agent"' | sudo tee -a /etc/systemd/system/cassandra-control-agent.service.d/override.conf
   ```
   Replace `YOUR_SERVER_IP_OR_HOST` with the real server address.

3. Reload and start:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable cassandra-control-agent
   sudo systemctl start cassandra-control-agent
   sudo systemctl status cassandra-control-agent
   ```

---

## Part 3b: Serving install script and agent binary (AxonOps-style)

To let clients install the agent with a one-liner (curl script + optional binary download):

1. **Copy the install script** into the dashboard directory so the server can serve it:
   ```bash
   cp deploy/scripts/install-agent.sh web/dashboard/install-agent.sh
   ```
   Then the script is available at `https://YOUR_SERVER/install-agent.sh`.

2. **Optional – serve the agent binary** so the install script can use `--download-binary`:
   - Copy the built agent binary to a path, e.g. `web/dashboard/agent-binary` or `/opt/cassandra-control/agent-binary`.
   - Set the environment variable when starting the server:
     ```bash
     export CASSANDRA_CONTROL_AGENT_BINARY=/path/to/agent-binary
     ./server
     ```
   - Then clients can run:
     ```bash
     curl -sSLk https://YOUR_SERVER/install-agent.sh | sudo bash -s -- --server-url wss://YOUR_SERVER/agent --download-binary
     ```

---

## Part 4: Troubleshooting

- **Dashboard not loading**  
  - Check server is running and listening on 443.  
  - Check `CASSANDRA_CONTROL_DASHBOARD_DIR` points to the directory containing `index.html`.

- **No nodes in dashboard**  
  - Agents must be running and `CASSANDRA_CONTROL_SERVER_URL` must be correct.  
  - From a Cassandra node: `curl -k https://<server>/api/nodes` should return JSON (possibly with an empty list).  
  - Check security groups / firewall: outbound 443 from Cassandra nodes to the server, and that the server accepts those connections.

- **Agent “connection refused” or timeout**  
  - Server must be listening on 443.  
  - Network path: from the node, ensure you can reach the server (e.g. `telnet <server> 443` or `openssl s_client -connect <server>:443`).  
  - URL must be `wss://...` (not `ws://`).

- **Certificate errors in browser**  
  - Use a proper certificate (e.g. Let’s Encrypt) or accept the self-signed exception for internal use.

---

## Summary

| Goal | Action |
|------|--------|
| Run server | Put binary + certs + `web/dashboard` on one host, run `./server` or systemd. |
| Run agents | Put `agent` on each Cassandra node, set `CASSANDRA_CONTROL_SERVER_URL`, run `./agent` or systemd. |
| Open dashboard | Browser → `https://<server>/` |
| Hand off to client | Give binaries + `web/dashboard` + README + DEPLOYMENT.md; walk them through server install → agent on each node → dashboard access. |
