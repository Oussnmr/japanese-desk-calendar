// Smart plugs report their on/off DP under different names depending on
// model (switch_1, switch, ...). Instead of guessing one, read it from the
// device's own reported status and prefer the common Tuya socket codes.
const PREFERRED_SWITCH_CODES = Object.freeze(["switch_1", "switch"]);

export function findPlugSwitchCode(values) {
  const booleanCodes = Object.keys(values).filter((code) => typeof values[code] === "boolean");
  for (const code of PREFERRED_SWITCH_CODES) if (booleanCodes.includes(code)) return code;
  return booleanCodes.find((code) => /^switch(_\d+)?$/i.test(code)) || null;
}

export function normalizePlugStatus(values) {
  const switchCode = findPlugSwitchCode(values);
  return {
    on: switchCode ? Boolean(values[switchCode]) : false,
    supported: Boolean(switchCode),
  };
}
