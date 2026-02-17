# Cassandra Control Agent – Setup Guide (AxonOps-style)

Install the agent on each Cassandra node so it connects to your control server. No inbound ports are opened on the node.

**Prerequisites:** Control server already running and reachable on HTTPS (port 443). You need your server URL (e.g. `wss://control.example.com/agent`).

---

## Step 1: Install the agent from GitHub

Execute the following command to download and install the Cassandra Control agent. Replace **YOUR_SERVER** with your control server hostname or IP (e.g. `3.109.48.138` or `control.example.com`). The script uses repo **Suhel0328/cassandra-control** by default.

**Debian / Ubuntu:**

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates

curl -sSL https://raw.githubusercontent.com/Suhel0328/cassandra-control/main/scripts/install-agent.sh | sudo bash -s -- --server-url wss://YOUR_SERVER/agent
```

**RHEL / CentOS / Amazon Linux** (install curl if needed, then run the same curl line):

```bash
sudo yum install -y curl ca-certificates
# or: sudo dnf install -y curl ca-certificates

curl -sSL https://raw.githubusercontent.com/Suhel0328/cassandra-control/main/scripts/install-agent.sh | sudo bash -s -- --server-url wss://YOUR_SERVER/agent
```

**Example** (control server at `3.109.48.138`):

```bash
sudo apt-get update && sudo apt-get install -y curl ca-certificates
curl -sSL https://raw.githubusercontent.com/Suhel0328/cassandra-control/main/scripts/install-agent.sh | sudo bash -s -- --server-url wss://3.109.48.138/agent
```

The script will download the agent from GitHub Releases, create the config file, set permissions, and start the service. **If you prefer to set the config file manually**, continue to Step 2. Otherwise go to Step 4 to verify.

---

## Step 2: Configuration file (if not using script defaults)

Update the **highlighted** lines and copy the following YAML into `/etc/cassandra-control/agent.yml`:

```yaml
# Cassandra Control Agent configuration
# Replace YOUR_CONTROL_SERVER with your control server hostname or IP.

server_url: "wss://YOUR_CONTROL_SERVER/agent"
```

Set file permissions on `/etc/cassandra-control/agent.yml`:

```bash
sudo chmod 0640 /etc/cassandra-control/agent.yml
```

---

## Step 3: Add Cassandra Control user to Cassandra group

Add the Cassandra Control user to the Cassandra group and the Cassandra user to the Cassandra Control group (replace `<your_cassandra_group>` and `<your_cassandra_user>` with your Cassandra process group and user, usually `cassandra`):

```bash
sudo usermod -aG <your_cassandra_group> cassandra-control
sudo usermod -aG cassandra-control <your_cassandra_user>
```

**Example:**

```bash
sudo usermod -aG cassandra cassandra-control
sudo usermod -aG cassandra-control cassandra
```

*(The install script in Step 1 does this automatically; run the above only if you installed the binary manually.)*

---

## Step 4: Start the Cassandra Control agent

If you used the install script in Step 1, the agent is already started. Otherwise:

```bash
sudo systemctl start cassandra-control-agent
sudo systemctl status cassandra-control-agent
```

In the control server dashboard, click **Refresh nodes** to see this node.

---

## Summary (copy-paste checklist)

| Step | Command / action |
|------|------------------|
| 1 | `curl -sSL https://raw.githubusercontent.com/Suhel0328/cassandra-control/main/scripts/install-agent.sh \| sudo bash -s -- --server-url wss://YOUR_SERVER/agent` |
| 2 | (Optional) Edit `/etc/cassandra-control/agent.yml` with your `server_url`; then `sudo chmod 0640 /etc/cassandra-control/agent.yml` |
| 3 | `sudo usermod -aG cassandra cassandra-control` and `sudo usermod -aG cassandra-control cassandra` (if not done by script) |
| 4 | `sudo systemctl start cassandra-control-agent` (if not already running) |

---

## Install options

- **Use a specific release version:**  
  `curl -sSL ... | sudo bash -s -- --server-url wss://YOUR_SERVER/agent --version v0.1.0`

- **Use a different GitHub repo (e.g. your fork):**  
  `curl -sSL ... | sudo bash -s -- --server-url wss://YOUR_SERVER/agent --github-repo your-org/your-repo`

- **Install from a cloned repo** (no GitHub Releases): clone the repo, then run the script with the binary present:  
  `sudo ./scripts/install-agent.sh --server-url wss://YOUR_SERVER/agent`

---

## Troubleshooting

- **Download failed:** Ensure the repo has a release with assets named `cassandra-control-agent-linux-amd64` and `cassandra-control-agent-linux-arm64`. Create a release by pushing a tag (e.g. `v0.1.0`); see README.
- **Node not in dashboard:** Check `sudo systemctl status cassandra-control-agent` and `journalctl -u cassandra-control-agent -f`. Ensure `server_url` in `/etc/cassandra-control/agent.yml` is correct and the server is reachable on port 443.
- **Permission denied (nodetool/logs):** Ensure Step 3 (usermod) was run so `cassandra-control` is in the Cassandra group.
