// electron-builder's custom signer (win.signtoolOptions.sign in package.json). It is
// called once for each Windows file it builds: the app exe, the uninstaller, the
// installer and the portable exe.
//
// Release builds (NOTEFORGE_AZURE_SIGN=1, set by .github/workflows/build.yml) sign in
// Azure Artifact Signing, with the account and certificate Slate uses (the certificate
// names the publisher, James Cupps, not an app). They authenticate with the Azure CLI
// login that azure/login made from GitHub's OIDC token, so no password exists anywhere.
// The ArtifactSigning PowerShell module is installed by the workflow at the version
// pinned below.
//
// Every other build (local, the CI package check) is left unsigned and needs no Azure
// access. The release workflow checks the signatures before it publishes, so a release
// can't go out unsigned by mistake.
const { execFileSync } = require("child_process");

const ENDPOINT = "https://eus.codesigning.azure.net/";
const ACCOUNT = "SlateAccount";
const PROFILE = "Slate";
const MODULE_VERSION = "0.1.8"; // same as azure/artifact-signing-action v2.0.0 (Slate)

module.exports = async function sign(configuration) {
  const file = configuration.path;
  if (process.env.NOTEFORGE_AZURE_SIGN !== "1") {
    console.log(`  • not signed (local build; release builds sign in Azure): ${file}`);
    return;
  }
  // The values reach PowerShell as environment variables, so no quoting of the path
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Import-Module ArtifactSigning -RequiredVersion ${MODULE_VERSION}`,
    "Invoke-ArtifactSigning -Endpoint $env:NF_SIGN_ENDPOINT -CodeSigningAccountName $env:NF_SIGN_ACCOUNT " +
      "-CertificateProfileName $env:NF_SIGN_PROFILE -Files $env:NF_SIGN_FILE -FileDigest SHA256 " +
      "-TimestampRfc3161 http://timestamp.acs.microsoft.com -TimestampDigest SHA256",
  ].join("; ");
  console.log(`  • signing in Azure Artifact Signing: ${file}`);
  execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: "inherit",
    env: { ...process.env, NF_SIGN_ENDPOINT: ENDPOINT, NF_SIGN_ACCOUNT: ACCOUNT, NF_SIGN_PROFILE: PROFILE, NF_SIGN_FILE: file },
  });
};
