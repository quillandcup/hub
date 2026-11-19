/** Popular device models for the editor's preview size picker. Widths are each model's CSS viewport width in portrait (approximate for the Android ones). */
export type DeviceModel = { name: string; width: number };

export const TABLET_MODELS: DeviceModel[] = [
  { name: "iPad", width: 768 },
  { name: 'iPad Pro 12.9"', width: 1024 },
  { name: "iPad Air", width: 820 },
  { name: "iPad Mini", width: 744 },
  { name: "Surface Pro", width: 912 },
  { name: "Galaxy Tab S7+", width: 876 },
];

export const PHONE_MODELS: DeviceModel[] = [
  { name: "iPhone 14", width: 390 },
  { name: "iPhone 14 Pro Max", width: 430 },
  { name: "iPhone 14 Pro", width: 393 },
  { name: "iPhone 12 mini", width: 375 },
  { name: "iPhone SE", width: 375 },
  { name: "Samsung Galaxy S23", width: 360 },
  { name: "Google Pixel 7", width: 412 },
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
