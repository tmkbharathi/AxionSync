const express = require("express");
const controller = require("../controllers/sessionController");

function getSessionRouter(io) {
  const router = express.Router();

  // Normalize standard session IDs to uppercase
  router.param("sessionId", (req, res, next, sessionId) => {
    if (sessionId && sessionId !== process.env.ADMIN_SESSION_ID) {
      req.params.sessionId = sessionId.toUpperCase();
    }
    next();
  });

  // Unlock passcode
  router.post("/session/:sessionId/unlock", controller.unlockSession);

  // Session routes
  router.route("/session/:sessionId")
    .get(controller.getSession)
    .delete((req, res) => controller.deleteSession(req, res, io));

  // Upload routes
  router.post("/session/:sessionId/upload/presign", controller.presignUpload);
  router.post("/session/:sessionId/upload/confirm", (req, res) => controller.confirmUpload(req, res, io));

  // Download route
  router.get("/download", controller.downloadFile);

  // Init route
  router.post("/session/:sessionId/init", controller.initSession);

  // Text route
  router.put("/session/:sessionId/text", (req, res) => controller.updateSessionText(req, res, io));

  // Direct file delete route
  router.delete("/session/:sessionId/files/:fileId", (req, res) => controller.deleteSessionFile(req, res, io));

  // Direct upload route
  router.post("/session/:sessionId/upload/raw", (req, res) => controller.uploadRawFile(req, res, io));

  // Share Expiring Passcode routes
  router.post("/session/:sessionId/share/create-passcode", controller.createSharePasscode);
  router.get("/session/:sessionId/share/passcodes", controller.listSharePasscodes);
  router.delete("/session/:sessionId/share/passcodes/:code", (req, res) => controller.revokeSharePasscode(req, res, io));
  router.patch("/session/:sessionId/share/passcodes/:code/permissions", (req, res) => controller.updateSharePasscodePermissions(req, res, io));

  return router;
}

module.exports = getSessionRouter;
