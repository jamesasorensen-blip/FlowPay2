# Dependency security scanning baseline

This repository configures Dependabot version updates for npm and GitHub Actions, and a GitHub Actions npm audit on relevant pull requests, pushes to main, every Monday, and manual dispatch.

The audit job generates a temporary lockfile because the repository currently has no committed npm lockfile. It does not run dependency lifecycle scripts. A nonzero exit code for high/critical advisories makes the check fail. Review all severities, not only the failing threshold.

## Operational follow-up required

- Enable GitHub dependency graph, Dependabot alerts, and Dependabot security updates in repository Settings > Security & analysis (subject to account/repository availability).
- Review scan results and update dependencies; do not claim vulnerability management is complete until scans execute and findings are remediated.
- Define and approve a vulnerability patching SLA, assign an owner, record exceptions and remediation dates.
- Maintain an inventory of runtimes, libraries, hosted services, and end-of-life dates; review it at least quarterly.
- Confirm that the Node backend in package.json is deployed and in scope. Separately scan the Cloudflare Worker, frontend scripts, Supabase configuration, and any other production components.
- Review GitHub Actions workflow permissions and branch protection; do not treat this baseline as a complete security program.

These files provide automated dependency checks only. They do not establish compliance with every Plaid attestation.
