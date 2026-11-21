/** Popular device models for the editor's preview size picker. Width and height are the portrait CSS viewport, in px. */
export type DeviceModel = { name: string; width: number; height: number };

/**
 * Sizes are the portrait CSS screen (physical pixels over the device's pixel ratio), checked against two reference
 * sites and the panel's native resolution (for example Pixel 9: 1080x2424 at 2.625 is 411x923; iPad Pro 13-inch:
 * 2064x2752 at 2 is 1032x1376). The height is the FULL CSS screen height, not the area left under a browser's toolbars:
 * a phone browser's address bar and tab bar take roughly 100 to 150px more, so the real first screen in a browser is a
 * little shorter than the fold drawn here. The first model of a class is the one its preview button shows.
 * Left out for want of a reliable figure: the Galaxy Tab line.
 */
export const TABLET_MODELS: DeviceModel[] = [
  { name: "iPad", width: 820, height: 1180 },
  { name: "iPad Air 11-inch", width: 820, height: 1180 },
  { name: "iPad Pro 11-inch", width: 834, height: 1210 },
  { name: "iPad mini", width: 744, height: 1133 },
  { name: "Surface Pro", width: 912, height: 1368 },
  { name: "iPad Air 13-inch", width: 1024, height: 1366 },
  { name: "iPad Pro 13-inch", width: 1032, height: 1376 },
];

export const PHONE_MODELS: DeviceModel[] = [
  { name: "iPhone 17", width: 402, height: 874 },
  { name: "iPhone 17 Pro Max", width: 440, height: 956 },
  { name: "iPhone Air", width: 420, height: 912 },
  { name: "iPhone 16", width: 393, height: 852 },
  { name: "iPhone 14", width: 390, height: 844 },
  { name: "iPhone 16e", width: 390, height: 844 },
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "Samsung Galaxy S25", width: 360, height: 780 },
  { name: "Samsung Galaxy S25 Ultra", width: 412, height: 891 },
  { name: "Google Pixel 9", width: 412, height: 923 },
];

export type DeviceClass = "tablet" | "phone";

export const MODELS_BY_CLASS: Record<DeviceClass, DeviceModel[]> = { tablet: TABLET_MODELS, phone: PHONE_MODELS };

/** The canvas size of a model: portrait, or landscape with width and height swapped. */
export function modelSize(model: DeviceModel, landscape = false): { width: number; height: number } {
  return landscape ? { width: model.height, height: model.width } : { width: model.width, height: model.height };
}

/** True when the canvas is wider than it is tall (a device turned on its side). */
export function isLandscape(width: number | string, height: number | string): boolean {
  return typeof width === "number" && typeof height === "number" && width > height;
}

function fits(model: DeviceModel, width: number | string, height: number | string): boolean {
  const size = modelSize(model, isLandscape(width, height));
  return size.width === width && (height === "auto" || size.height === height);
}

/**
 * The class (tablet or phone) whose models include this canvas size, in either orientation, if any. A height of
 * "auto" (no fixed height) matches on the portrait width alone.
 */
export function deviceClassForSize(width: number | string, height: number | string): DeviceClass | null {
  if (PHONE_MODELS.some((m) => fits(m, width, height))) return "phone";
  if (TABLET_MODELS.some((m) => fits(m, width, height))) return "tablet";
  return null;
}

/** The first model of the class that has exactly this canvas size (portrait or landscape). */
export function modelForSize(deviceClass: DeviceClass, width: number | string, height: number | string): DeviceModel | undefined {
  return MODELS_BY_CLASS[deviceClass].find((m) => fits(m, width, height));
}

/** Every distinct portrait model size, for Puck's `viewports` option list. */
export const MODEL_SIZES: { width: number; height: number }[] = [...TABLET_MODELS, ...PHONE_MODELS]
  .map((m) => modelSize(m))
  .filter((s, i, all) => all.findIndex((o) => o.width === s.width && o.height === s.height) === i);
