const NUMERIC_FIELDS = {
  x: { min: -160, max: 160, fallback: 0 },
  y: { min: -160, max: 160, fallback: 0 },
  scale: { min: 70, max: 140, fallback: 100 },
  width: { min: 60, max: 140, fallback: 100 },
  opacity: { min: 10, max: 100, fallback: 100 },
  rotation: { min: -180, max: 180, fallback: 0 },
};

export const PROFILE_LIMITS = {
  nameLength: 28,
  profileCount: 40,
  targetCount: 80,
  textLength: 160,
  bytes: 64 * 1024,
};

export function normalizeProfileName(value) {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase().replace(/[^A-Z0-9 ._-]/g, "").slice(0, PROFILE_LIMITS.nameLength).trim();
}

function hexColor(value) {
  return typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : "";
}

function clampNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) return field.fallback;
  return Math.min(field.max, Math.max(field.min, Math.round(number)));
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sanitizeOverrides(value) {
  const overrides = {};
  for (const [target, raw] of Object.entries(plainObject(value)).slice(0, PROFILE_LIMITS.targetCount)) {
    const source = plainObject(raw);
    const entry = { color: hexColor(source.color) };
    for (const [field, bounds] of Object.entries(NUMERIC_FIELDS)) entry[field] = clampNumber(source[field], bounds);
    overrides[target] = entry;
  }
  return overrides;
}

function sanitizeText(value) {
  const text = {};
  for (const [target, raw] of Object.entries(plainObject(value)).slice(0, PROFILE_LIMITS.targetCount)) {
    if (typeof raw === "string") text[target] = raw.slice(0, PROFILE_LIMITS.textLength);
  }
  return text;
}

function sanitizeColors(value) {
  const source = plainObject(value);
  const colors = {};
  for (const key of ["ink", "paper"]) {
    const color = hexColor(source[key]);
    if (color) colors[key] = color;
  }
  return colors;
}

// Images stay in each browser's local storage, so `assets` is intentionally dropped here.
export function sanitizeProfile(value) {
  const source = plainObject(value);
  return {
    overrides: sanitizeOverrides(source.overrides),
    text: sanitizeText(source.text),
    colors: sanitizeColors(source.colors),
  };
}

export function sanitizeProfileMap(value) {
  const profiles = {};
  for (const [rawName, profile] of Object.entries(plainObject(value))) {
    const name = normalizeProfileName(rawName);
    if (!name || Object.keys(profiles).length >= PROFILE_LIMITS.profileCount) continue;
    profiles[name] = sanitizeProfile(profile);
  }
  return profiles;
}

export function profileTooLarge(profile) {
  return JSON.stringify(profile).length > PROFILE_LIMITS.bytes;
}
