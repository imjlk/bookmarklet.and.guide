import { readFileSync } from "node:fs";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MAX_CHROME_VERSION_COMPONENT = 65_535n;

let cachedPackageVersion: string | undefined;

export function getCorePackageVersion(): string {
  if (cachedPackageVersion) {
    return cachedPackageVersion;
  }

  const packageJsonUrl = new URL("../package.json", import.meta.url);
  const packageJson: unknown = JSON.parse(readFileSync(packageJsonUrl, "utf8"));
  if (!isRecord(packageJson) || typeof packageJson.version !== "string") {
    throw new Error(`Missing version in ${packageJsonUrl.pathname}`);
  }
  assertSemver(packageJson.version, "@bmkl/core package version");
  cachedPackageVersion = packageJson.version;
  return cachedPackageVersion;
}

export function toChromeManifestVersion(version: string): {
  version: string;
  version_name?: string;
} {
  const match = assertSemver(version);
  const components = match.slice(1, 4).map(toChromeVersionComponent);
  const allComponentsAreZero = components.every(
    (component) => component === "0",
  );
  const chromeVersion = (
    allComponentsAreZero ? [...components, "1"] : components
  ).join(".");
  return {
    version: chromeVersion,
    ...(chromeVersion === version ? {} : { version_name: version }),
  };
}

export function toBmklManifestVersion(version: string): string {
  assertSemver(version);
  return version.split("+", 1)[0];
}

export function toBmklRuntimeCompatibility(version: string): string {
  const match = assertSemver(version);
  return `bmkl@${match[1]}.${match[2]}`;
}

function assertSemver(version: string, context = "version"): RegExpMatchArray {
  const match = version.match(SEMVER_PATTERN);
  if (!match || hasInvalidNumericPrerelease(match[4])) {
    throw new Error(`Invalid ${context}: ${version}`);
  }
  return match;
}

function hasInvalidNumericPrerelease(prerelease: string | undefined): boolean {
  return Boolean(
    prerelease
      ?.split(".")
      .some(
        (identifier) =>
          /^\d+$/.test(identifier) &&
          identifier.length > 1 &&
          identifier.startsWith("0"),
      ),
  );
}

function toChromeVersionComponent(component: string): string {
  const value = BigInt(component);
  return (value > MAX_CHROME_VERSION_COMPONENT
    ? MAX_CHROME_VERSION_COMPONENT
    : value
  ).toString();
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
