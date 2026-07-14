// @ts-check

/** @type {import("@ttsc/strip").ITtscStripConfig} */
const config = {
  calls: ["console.log", "console.debug", "devAssert.*"],
  statements: ["debugger"],
};

export default config;
