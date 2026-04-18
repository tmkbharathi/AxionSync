import { useEffect, useRef, useCallback } from "react";

/**
 * Hook to trap focus within a container.
 * Useful for modals, dropdowns, etc.
 */
export const useFocusTrap = (isActive: boolean) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isActive || !containerRef.current || e.key !== "Tab") return;

    const focusableElements = containerRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  }, [isActive]);

  useEffect(() => {
    if (isActive) {
      // Store the element that had focus before the trap was activated
      previousFocus.current = document.activeElement as HTMLElement;

      // Move focus to the first focusable element inside the container
      if (containerRef.current) {
        const focusableElements = containerRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length > 0) {
          (focusableElements[0] as HTMLElement).focus();
        }
      }

      window.addEventListener("keydown", handleKeyDown);
    } else {
      // Return focus to the previous element when the trap is deactivated
      if (previousFocus.current) {
        previousFocus.current.focus();
      }
      window.removeEventListener("keydown", handleKeyDown);
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isActive, handleKeyDown]);

  return containerRef;
};
