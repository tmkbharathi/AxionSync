# AxionSync MCP Server Integration Guide

AxionSync includes a built-in [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server allowing AI agents (such as Antigravity IDE, Claude Desktop, Cursor, and Windsurf) to securely interact with your real-time synchronized workspaces.

---

## 🛠️ Features & Capabilities

The server exposes **14 MCP Tools**, **4 MCP Resources**, and **3 MCP Prompts**:

### Tools
| Tool Name | Description |
| :--- | :--- |
| `get_session` | Retrieve live session metadata, clipboard content, files, and permissions |
| `update_clipboard_text` | Synchronize text across all connected devices via real-time WebSockets |
| `append_clipboard_text` | Append notes, logs, or snippets to the live clipboard |
| `clear_clipboard_text` | Clear session clipboard |
| `list_session_files` | List files shared in the workspace |
| `get_file_download_url` | Obtain temporary presigned download URL for a file |
| `upload_text_file` | Upload text, markdown, or code directly to S3/R2 storage |
| `delete_session_file` | Remove a file from the session |
| `unlock_session` | Authenticate with a master passcode or guest passcode |
| `create_guest_passcode` | Generate granular, time-limited collaborator passcodes |
| `list_guest_passcodes` | Inspect active guest passcodes and usages |
| `revoke_guest_passcode` | Revoke a guest passcode immediately |
| `update_guest_passcode_permissions` | Update read/write/upload permissions for guest passcodes |
| `delete_session` | Purge all session data and files |

### Resources
- `axionsync://session/{sessionId}`: Full session snapshot
- `axionsync://session/{sessionId}/clipboard`: Live clipboard text
- `axionsync://session/{sessionId}/files`: File roster metadata
- `axionsync://session/{sessionId}/passcodes`: Guest passcode listing

### Prompts
- `summarize_session`: Summarizes current session text and shared assets.
- `sync_code_snippet`: Formats code and prepares it for clipboard push.
- `create_guest_invitation`: Generates a collaborator invitation message.

---

## 🚀 Running the MCP Server

### 1. Start the Backend API
The MCP server interacts with your Express backend:
```bash
cd backend
npm run dev
```
*(Runs by default on `http://localhost:3001`)*

### 2. Run via Stdio Transport
In the `frontend` folder:
```bash
npm run mcp
```

---

## 🔌 Connecting to AI Clients

### 1. Antigravity IDE
This project is already pre-configured as a workspace plugin under `.agents/plugins/axionsync/mcp_config.json`.

If you prefer to configure it globally in `~/.gemini/config/mcp_config.json`:
```json
{
  "mcpServers": {
    "axionsync": {
      "command": "node",
      "args": [
        "C:\\Users\\Manikanda Bharathi\\Desktop\\Project\\syncOsync\\frontend\\node_modules\\tsx\\dist\\cli.mjs",
        "C:\\Users\\Manikanda Bharathi\\Desktop\\Project\\syncOsync\\frontend\\src\\lib\\mcp\\cli.ts"
      ],
      "env": {
        "BACKEND_API_URL": "https://syncosync.onrender.com"
      }
    }
  }
}
```

### 2. Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "axionsync": {
      "command": "npx",
      "args": [
        "-y",
        "tsx",
        "C:\\Users\\Manikanda Bharathi\\Desktop\\Project\\syncOsync\\frontend\\src\\lib\\mcp\\cli.ts"
      ],
      "env": {
        "BACKEND_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

### 3. Cursor / Other Clients
Add an MCP server with type `command`:
- **Command**: `npx`
- **Args**: `tsx C:\Users\Manikanda Bharathi\Desktop\Project\syncOsync\frontend\src\lib\mcp\cli.ts`
- **Env**: `BACKEND_API_URL=http://localhost:3001`
