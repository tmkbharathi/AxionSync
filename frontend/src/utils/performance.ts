export interface WebGLCapabilities {
  supported: boolean;
  hardwareAccelerated: boolean;
  renderer: string;
}

export function getWebGLCapabilities(): WebGLCapabilities {
  if (typeof window === "undefined") {
    return { supported: false, hardwareAccelerated: false, renderer: "" };
  }

  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;

    if (!gl) {
      return { supported: false, hardwareAccelerated: false, renderer: "" };
    }

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (debugInfo) {
      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "";
      
      // If the renderer is a software rasterizer (CPU-bound)
      const isSoftware = 
        renderer.includes("SwiftShader") || 
        renderer.includes("Software") || 
        renderer.includes("Mesa") || 
        renderer.includes("Basic Render Driver") ||
        renderer.includes("Google SwiftShader");

      return { 
        supported: true, 
        hardwareAccelerated: !isSoftware, 
        renderer 
      };
    }

    return { supported: true, hardwareAccelerated: true, renderer: "Unknown" };
  } catch (e) {
    return { supported: false, hardwareAccelerated: false, renderer: "" };
  }
}
