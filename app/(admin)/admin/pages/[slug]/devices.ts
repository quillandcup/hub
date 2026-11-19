/** Popular device models for the editor's preview size picker. */
export type DeviceModel = { name: string; width: number };

/**
 * Widths are the portrait CSS viewport (physical pixels over the device's pixel ratio), checked against two reference
 * sites and the panel's native resolution. The first model of a class that has a width is the one shown for it.
 * Left out for want of a reliable figure: the Galaxy Tab line.
 */
export const TABLET_MODELS: DeviceModel[] = [
  { name: "iPad", width: 820 },
  { name: "iPad Air 11-inch", width: 820 },
  { name: "iPad Pro 11-inch", width: 834 },
  { name: "iPad mini", width: 744 },
  { name: "Surface Pro", width: 912 },
  { name: "iPad Air 13-inch", width: 1024 },
  { name: "iPad Pro 13-inch", width: 1032 },
];

export const PHONE_MODELS: DeviceModel[] = [
  { name: "iPhone 17", width: 402 },
  { name: "iPhone 17 Pro Max", width: 440 },
  { name: "iPhone Air", width: 420 },
  { name: "iPhone 16", width: 393 },
  { name: "iPhone 14", width: 390 },
  { name: "iPhone 16e", width: 390 },
  { name: "iPhone SE", width: 375 },
  { name: "Samsung Galaxy S25", width: 360 },
  { name: "Samsung Galaxy S25 Ultra", width: 412 },
  { name: "Google Pixel 9", width: 412 },
];

export type DeviceClass = "tablet" | "phone";

export const MODELS_BY_CLASS: Record<DeviceClass, DeviceModel[]> = { tablet: TABLET_MODELS, phone: PHONE_MODELS };

/** The class (tablet or phone) whose models include this width, if any. */
export function deviceClassForWidth(width: number | string): DeviceClass | null {
  if (PHONE_MODELS.some((m) => m.width === width)) return "phone";
  if (TABLET_MODELS.some((m) => m.width === width)) return "tablet";
  return null;
}

/** Every distinct model width, for Puck's `viewports` option list. */
export const MODEL_WIDTHS = [...new Set([...TABLET_MODELS, ...PHONE_MODELS].map((m) => m.width))];
