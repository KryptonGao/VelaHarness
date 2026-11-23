import type { NavCategory } from "./components/NavRail";
import { trafficLightPosition } from "../traffic-light-position";

type ControlsOverlay = EventTarget & { getTitlebarAreaRect(): DOMRect };

/** React ref for the macOS borderless stage. The native exclusion area is already in CSS pixels at the current zoom. */
export function observeTrafficLightMaterial(stage: HTMLDivElement | null, category: NavCategory = "home") {
  const overlay = (navigator as Navigator & { windowControlsOverlay?: ControlsOverlay }).windowControlsOverlay;
  const shell = stage?.parentElement;
  if (!stage || !shell || !overlay) return;

  // Outgoing and retained pages can still be mounted. Measure only the current detail surface.
  const paper = (category !== "home" && stage.querySelector(":scope > .page-stage:not(.is-overlay) .page-content")) || stage;
  const update = () => {
    // Electron leaves the same native inset before the red and after the green button.
    const zoom = window.vela?.getZoomFactor?.() ?? 1;
    const inset = trafficLightPosition.x / zoom;
    const controlsEnd = overlay.getTitlebarAreaRect().left - inset;
    const bounds = paper.getBoundingClientRect();
    const paperStart = bounds.top <= trafficLightPosition.y / zoom ? bounds.left : Infinity;
    const listStart = shell.querySelector(":scope > .sidebar-left")?.getBoundingClientRect().left ?? 0;
    // The paper is opaque; the list adds a tint over the rail's base glass.
    const crosses = (edge: number) => edge > inset && edge < controlsEnd;
    const material = crosses(paperStart) ? "paper" : crosses(listStart) ? "list" : undefined;
    if (shell.dataset.trafficLightMaterial === material) return;
    if (material) shell.dataset.trafficLightMaterial = material;
    else delete shell.dataset.trafficLightMaterial;
  };
  update();
  // The stage flexes as the classic sidebar resizes or the rail's paper slides.
  const observer = new ResizeObserver(update);
  observer.observe(stage);
  if (paper !== stage) observer.observe(paper);
  overlay.addEventListener("geometrychange", update);
  return () => {
    observer.disconnect();
    overlay.removeEventListener("geometrychange", update);
    delete shell.dataset.trafficLightMaterial;
  };
}
