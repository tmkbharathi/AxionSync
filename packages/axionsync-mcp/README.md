# AxionSync MCP Server (`axionsync-mcp`)

Standalone [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for the **AxionSync** digital workspace platform.

Allows AI coding assistants (Antigravity IDE, Claude Desktop, Cursor, Windsurf) to interact with live synchronized sessions over WebSockets and cloud storage without needing to clone or build the full AxionSync codebase.

---

## ⚡ Quick Start with `npx` (Zero Install)

### 1. Antigravity IDE / Claude Desktop
Add to your `mcp_config.json`:

```json
{
  "mcpServers": {
    "axionsync": {
      "command": "npx",
      "args": ["-y", "axionsync-mcp"]
    }
  }
}
```

### 2. Custom Backend URL (Optional)
By default, the server connects to the live AxionSync cloud service (`https://syncosync.onrender.com`). To target a local development backend instead:

```json
{
  "mcpServers": {
    "axionsync": {
      "command": "npx",
      "args": ["-y", "axionsync-mcp"],
      "env": {
        "BACKEND_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

---

## 🛠️ Features
- **Real-time Clipboard**: `update_clipboard_text`, `append_clipboard_text`, `clear_clipboard_text`
- **File Management**: `upload_file`, `upload_text_file`, `list_session_files`, `get_file_download_url`, `delete_session_file`
- **Session & Auth**: `get_session`, `unlock_session`, `delete_session`
- **Guest Access**: `create_guest_passcode`, `list_guest_passcodes`, `revoke_guest_passcode`, `update_guest_passcode_permissions`
