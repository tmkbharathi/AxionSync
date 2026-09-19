import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as services from "./services";

export function createAxionSyncMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "AxionSync MCP Server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
      },
    }
  );

  // Helper for structured success output
  const formatSuccess = (data: unknown) => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: true, data }, null, 2),
      },
    ],
  });

  // Helper for structured error output
  const formatError = (err: unknown) => {
    const formatted = services.formatServiceError(err);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: false,
              error: {
                code: formatted.code,
                message: formatted.message,
                status: formatted.status,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  };

  // ==========================================
  // MCP TOOLS
  // ==========================================

  // 1. get_session
  server.tool(
    "get_session",
    "Retrieve the current state of an AxionSync session, including active status, clipboard text, file metadata, and permission details.",
    {
      sessionId: z.string().min(1, "sessionId is required").describe("The unique session ID to query."),
      token: z.string().optional().describe("Authentication token (required for protected/admin sessions)."),
    },
    async ({ sessionId, token }) => {
      try {
        const details = await services.getSessionDetails(sessionId, token);
        return formatSuccess({
          sessionId: details.sessionId,
          text: details.text,
          fileCount: details.files.length,
          files: details.files.map((f) => ({
            id: f.id,
            name: f.name,
            size: f.size,
            mimeType: f.mimeType,
            uploadedAt: f.uploadedAt,
            hasPreview: !!f.previewUrl,
          })),
          permissions: details.permissions,
          guestRemainingSeconds: details.guestRemainingSeconds,
          guestExpiresAt: details.guestExpiresAt,
        });
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 2. update_clipboard_text
  server.tool(
    "update_clipboard_text",
    "Replace and synchronize the clipboard text in the AxionSync session. Live connected devices will receive this update instantly via real-time WebSocket.",
    {
      sessionId: z.string().min(1, "sessionId is required").describe("The unique session ID."),
      content: z.string().describe("The new text content to synchronize across devices."),
      token: z.string().optional().describe("Authentication token (required if the session is protected)."),
    },
    async ({ sessionId, content, token }) => {
      try {
        const result = await services.updateSessionText(sessionId, content, token);
        return formatSuccess({
          sessionId,
          updatedLength: result.text.length,
          message: "Clipboard text updated and broadcasted to connected devices.",
        });
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 3. append_clipboard_text
  server.tool(
    "append_clipboard_text",
    "Append text (such as notes, code snippets, or logs) to the existing AxionSync session clipboard and synchronize immediately.",
    {
      sessionId: z.string().min(1, "sessionId is required").describe("The unique session ID."),
      content: z.string().min(1, "content cannot be empty").describe("The text snippet to append."),
      token: z.string().optional().describe("Authentication token (required if session is protected)."),
      addNewline: z.boolean().default(true).describe("Whether to insert a newline before appending (default: true)."),
    },
    async ({ sessionId, content, token, addNewline }) => {
      try {
        const result = await services.appendSessionText(sessionId, content, token, addNewline);
        return formatSuccess({
          sessionId,
          totalLength: result.text.length,
          message: "Content appended to clipboard and broadcasted to connected devices.",
        });
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 4. clear_clipboard_text
  server.tool(
    "clear_clipboard_text",
    "Clear all clipboard text in the specified AxionSync session and broadcast the empty state to all connected devices.",
    {
      sessionId: z.string().min(1, "sessionId is required").describe("The unique session ID."),
      token: z.string().optional().describe("Authentication token (required if session is protected)."),
    },
    async ({ sessionId, token }) => {
      try {
        await services.clearSessionText(sessionId, token);
        return formatSuccess({
          sessionId,
          message: "Clipboard text cleared successfully.",
        });
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 5. list_session_files
  server.tool(
    "list_session_files",
    "List all uploaded files shared in an AxionSync session with safe metadata (name, size, MIME type, upload timestamp).",
    {
      sessionId: z.string().min(1, "sessionId is required").describe("The unique session ID."),
      token: z.string().optional().describe("Authentication token (required if session is protected)."),
    },
    async ({ sessionId, token }) => {
      try {
        const { files, count } = await services.listSessionFiles(sessionId, token);
        return formatSuccess({
          sessionId,
          count,
          files: files.map((f) => ({
            id: f.id,
            name: f.name,
            size: f.size,
            mimeType: f.mimeType,
            uploadedAt: f.uploadedAt,
            previewUrl: f.previewUrl,
          })),
        });
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 6. get_file_download_url
  server.tool(
    "get_file_download_url",
    "Generate a temporary, pre-signed download URL for a specific file verified to belong to the session.",
    {
      sessionId: z.string().min(1, "sessionId is required").describe("The unique session ID."),
      fileId: z.string().min(1, "fileId is required").describe("The unique ID of the file in the session."),
      token: z.string().optional().describe("Authentication token (required if session is protected)."),
    },
    async ({ sessionId, fileId, token }) => {
      try {
        const result = await services.getFileDownloadUrl(sessionId, fileId, token);
        return formatSuccess({
          sessionId,
          fileId,
          fileName: result.fileName,
          size: result.size,
          mimeType: result.mimeType,
          downloadUrl: result.downloadUrl,
          expiresInSeconds: 86400,
        });
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 7. upload_text_file
  server.tool(
    "upload_text_file",
    "Upload a text, markdown, JSON, or code file directly into the session's S3/R2 storage and notify connected devices in real time.",
    {
      sessionId: z.string().min(1, "sessionId is required").describe("The unique session ID."),
      fileName: z.string().min(1, "fileName is required").describe("The filename (e.g. 'notes.md', 'data.json', 'script.py')."),
      content: z.string().describe("The file text content to upload."),
      mimeType: z.string().default("text/plain").describe("The MIME type (e.g. 'text/plain', 'text/markdown', 'application/json')."),
      token: z.string().optional().describe("Authentication token (required if session is protected)."),
    },
    async ({ sessionId, fileName, content, mimeType, token }) => {
      try {
        const result = await services.uploadTextFile(sessionId, fileName, content, mimeType, token);
        return formatSuccess({
          sessionId,
          file: {
            id: result.file.id,
            name: result.file.name,
            size: result.file.size,
            mimeType: result.file.mimeType,
            uploadedAt: result.file.uploadedAt,
          },
          message: "File uploaded successfully and broadcasted to connected devices.",
        });
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 8. delete_session_file
  server.tool(
    "delete_session_file",
    "Delete a file from the session's S3/R2 storage and Redis index, broadcasting the removal to all connected devices.",
    {
      sessionId: z.string().min(1, "sessionId is required").describe("The unique session ID."),
      fileId: z.string().min(1, "fileId is required").describe("The unique file ID to delete."),
      token: z.string().optional().describe("Authentication token (required if session is protected)."),
    },
    async ({ sessionId, fileId, token }) => {
      try {
        const result = await services.deleteSessionFile(sessionId, fileId, token);
        return formatSuccess({
          sessionId,
          deletedFileId: result.fileId,
          message: "File deleted successfully.",
        });
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 9. unlock_session
  server.tool(
    "unlock_session",
    "Authenticate and unlock a protected or reserved admin session using a master password or guest passcode, returning a scoped token and granted permissions.",
    {
      sessionId: z.string().min(1, "sessionId is required").describe("The unique session ID."),
      password: z.string().min(1, "password/passcode is required").describe("The master admin password or guest passcode."),
    },
    async ({ sessionId, password }) => {
      try {
        const result = await services.unlockSession(sessionId, password);
        return formatSuccess({
          sessionId,
          token: result.token,
          isMasterAdmin: result.isMasterAdmin,
          permissions: result.permissions,
          expiresAt: result.expiresAt,
          remainingSeconds: result.remainingSeconds,
          message: "Session unlocked successfully.",
        });
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 10. create_guest_passcode (Master Admin only)
  server.tool(
    "create_guest_passcode",
    "(Master Admin only) Generate a secure, expiring guest passcode with custom duration, maximum uses, and granular permissions.",
    {
      sessionId: z.string().min(1, "sessionId is required").describe("The admin session ID."),
      token: z.string().min(1, "Master admin token is required").describe("The master admin token."),
      durationSeconds: z.number().int().min(60).max(604800).default(3600).describe("Passcode lifespan in seconds (default: 3600 = 1 hour, max 7 days)."),
      passcode: z.string().optional().describe("Optional custom passcode (6-digit numeric string generated if omitted)."),
      maxUses: z.number().int().positive().optional().describe("Optional maximum number of times this passcode can be used."),
      label: z.string().optional().describe("Optional descriptive label (e.g. 'Guest for Project Review')."),
      permissions: z
        .object({
          allowText: z.boolean().default(true).describe("Allow reading and editing clipboard text."),
          allowFiles: z.boolean().default(true).describe("Allow viewing and downloading files."),
          allowUploads: z.boolean().default(true).describe("Allow uploading new files."),
        })
        .default({ allowText: true, allowFiles: true, allowUploads: true })
        .describe("Granular permissions granted to this passcode."),
    },
    async ({ sessionId, token, durationSeconds, passcode, maxUses, label, permissions }) => {
      try {
        const result = await services.createGuestPasscode(
          sessionId,
          { durationSeconds, passcode, maxUses, label, permissions },
          token
        );
        return formatSuccess({
          sessionId,
          passcode: result.passcode,
          message: "Guest passcode created successfully.",
        });
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 11. list_guest_passcodes (Master Admin only)
  server.tool(
    "list_guest_passcodes",
    "(Master Admin only) List all currently active guest passcodes, their remaining TTL, usage counts, and permissions.",
    {
      sessionId: z.string().min(1, "sessionId is required").describe("The admin session ID."),
      token: z.string().min(1, "Master admin token is required").describe("The master admin token."),
    },
    async ({ sessionId, token }) => {
      try {
        const result = await services.listGuestPasscodes(sessionId, token);
        return formatSuccess({
          sessionId,
          count: result.passcodes.length,
          passcodes: result.passcodes,
        });
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 12. revoke_guest_passcode (Master Admin only)
  server.tool(
    "revoke_guest_passcode",
    "(Master Admin only) Immediately revoke an active guest passcode, invalidating any active sessions created with it.",
    {
      sessionId: z.string().min(1, "sessionId is required").describe("The admin session ID."),
      code: z.string().min(1, "code is required").describe("The guest passcode to revoke."),
      token: z.string().min(1, "Master admin token is required").describe("The master admin token."),
    },
    async ({ sessionId, code, token }) => {
      try {
        const result = await services.revokeGuestPasscode(sessionId, code, token);
        return formatSuccess({
          sessionId,
          revokedCode: result.code,
          message: "Guest passcode revoked successfully.",
        });
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 13. update_guest_passcode_permissions (Master Admin only)
  server.tool(
    "update_guest_passcode_permissions",
    "(Master Admin only) Dynamically update permissions for an active guest passcode and all active tokens created with it.",
    {
      sessionId: z.string().min(1, "sessionId is required").describe("The admin session ID."),
      code: z.string().min(1, "code is required").describe("The guest passcode to update."),
      permissions: z
        .object({
          allowText: z.boolean().optional().describe("Allow reading and editing clipboard text."),
          allowFiles: z.boolean().optional().describe("Allow viewing and downloading files."),
          allowUploads: z.boolean().optional().describe("Allow uploading new files."),
        })
        .describe("Updated permissions to apply."),
      token: z.string().min(1, "Master admin token is required").describe("The master admin token."),
    },
    async ({ sessionId, code, permissions, token }) => {
      try {
        const result = await services.updateGuestPasscodePermissions(sessionId, code, permissions, token);
        return formatSuccess({
          sessionId,
          code: result.code,
          permissions: result.permissions,
          message: "Passcode permissions updated successfully.",
        });
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 14. delete_session (Destructive)
  server.tool(
    "delete_session",
    "Permanently delete an AxionSync session, purging all S3/R2 files, Redis metadata, and disconnecting live participants. Master admin token is strictly required for reserved admin sessions.",
    {
      sessionId: z.string().min(1, "sessionId is required").describe("The session ID to permanently delete."),
      token: z.string().optional().describe("Authentication token (Master admin token required for admin sessions)."),
    },
    async ({ sessionId, token }) => {
      try {
        const result = await services.deleteSession(sessionId, token);
        return formatSuccess({
          deletedSessionId: result.sessionId,
          message: "Session and all associated storage files deleted permanently.",
        });
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // ==========================================
  // MCP RESOURCES
  // ==========================================

  // Resource 1: axionsync://sessions/{sessionId}
  server.resource(
    "session_overview",
    new ResourceTemplate("axionsync://sessions/{sessionId}", { list: undefined }),
    async (uri, { sessionId }) => {
      try {
        const id = Array.isArray(sessionId) ? sessionId[0] : sessionId;
        const details = await services.getSessionDetails(id);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  sessionId: details.sessionId,
                  textLength: details.text.length,
                  fileCount: details.files.length,
                  files: details.files.map((f) => ({ id: f.id, name: f.name, size: f.size })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const formatted = services.formatServiceError(err);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: formatted.message }),
            },
          ],
        };
      }
    }
  );

  // Resource 2: axionsync://sessions/{sessionId}/text
  server.resource(
    "session_clipboard_text",
    new ResourceTemplate("axionsync://sessions/{sessionId}/text", { list: undefined }),
    async (uri, { sessionId }) => {
      try {
        const id = Array.isArray(sessionId) ? sessionId[0] : sessionId;
        const details = await services.getSessionDetails(id);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: details.text,
            },
          ],
        };
      } catch (err) {
        const formatted = services.formatServiceError(err);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `Error: ${formatted.message}`,
            },
          ],
        };
      }
    }
  );

  // Resource 3: axionsync://sessions/{sessionId}/files
  server.resource(
    "session_files_list",
    new ResourceTemplate("axionsync://sessions/{sessionId}/files", { list: undefined }),
    async (uri, { sessionId }) => {
      try {
        const id = Array.isArray(sessionId) ? sessionId[0] : sessionId;
        const { files, count } = await services.listSessionFiles(id);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ count, files }, null, 2),
            },
          ],
        };
      } catch (err) {
        const formatted = services.formatServiceError(err);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: formatted.message }),
            },
          ],
        };
      }
    }
  );

  // ==========================================
  // MCP PROMPTS
  // ==========================================

  // Prompt 1: summarize_session
  server.prompt(
    "summarize_session",
    {
      sessionId: z.string().describe("The session ID whose contents should be summarized."),
      token: z.string().optional().describe("Authentication token if the session is protected."),
    },
    async ({ sessionId, token }) => {
      try {
        const details = await services.getSessionDetails(sessionId, token);
        const fileNames = details.files.map((f) => `- ${f.name} (${Math.round(f.size / 1024)} KB)`).join("\n");
        return {
          description: `Summary of AxionSync session: ${sessionId}`,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `You are an AI assistant analyzing an AxionSync digital workspace session.\n\nSession ID: ${sessionId}\n\nClipboard Text Content:\n"""\n${details.text || "(empty)"}\n"""\n\nShared Files (${details.files.length}):\n${fileNames || "No files uploaded"}\n\nPlease provide a clear, concise summary of the text content and files shared in this session.`,
              },
            },
          ],
        };
      } catch (err) {
        const formatted = services.formatServiceError(err);
        return {
          description: `Error loading session: ${sessionId}`,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Could not load session '${sessionId}' for summary: ${formatted.message}`,
              },
            },
          ],
        };
      }
    }
  );

  // Prompt 2: sync_code_snippet
  server.prompt(
    "sync_code_snippet",
    {
      language: z.string().describe("The programming language (e.g. typescript, python, rust)."),
      snippet: z.string().describe("The code snippet to format and prepare for clipboard sync."),
      notes: z.string().optional().describe("Optional explanations or notes to accompany the code."),
    },
    ({ language, snippet, notes }) => {
      const formattedSnippet = `\`\`\`${language}\n${snippet}\n\`\`\`${notes ? `\n\nNotes:\n${notes}` : ""}`;
      return {
        description: `Format and prepare a ${language} snippet for AxionSync clipboard synchronization`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Here is the formatted code ready for synchronization:\n\n${formattedSnippet}\n\nTo synchronize this to an AxionSync session, invoke the 'update_clipboard_text' or 'append_clipboard_text' tool with your target sessionId.`,
            },
          },
        ],
      };
    }
  );

  // Prompt 3: create_guest_invitation
  server.prompt(
    "create_guest_invitation",
    {
      sessionId: z.string().describe("The admin session ID."),
      passcode: z.string().describe("The guest passcode generated for the collaborator."),
      durationDescription: z.string().default("1 hour").describe("Human-readable duration (e.g. '1 hour', '24 hours')."),
      permissionsDescription: z.string().default("Full access (Text, Files, Uploads)").describe("Summary of granted permissions."),
    },
    ({ sessionId, passcode, durationDescription, permissionsDescription }) => {
      const sessionUrl = `https://axionsync.vercel.app/${sessionId}`;
      return {
        description: `Draft an invitation message for guest access to AxionSync session: ${sessionId}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Draft a professional and friendly invitation message for a collaborator with the following details:\n\nWorkspace Link: ${sessionUrl}\nPasscode: ${passcode}\nValid For: ${durationDescription}\nPermissions: ${permissionsDescription}\n\nInclude step-by-step instructions on clicking the link and entering the passcode to access the live synchronized workspace.`,
            },
          },
        ],
      };
    }
  );

  return server;
}
