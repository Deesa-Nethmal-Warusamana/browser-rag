# Northwind Platform Handbook

## 1. Service ownership

Every production service must have exactly one owning team recorded in the
service registry. The owning team is responsible for on-call rotation, runbooks
and upgrade cadence. Services without a listed owner are automatically moved to
the platform team's backlog after fourteen days.

The registry is the source of truth. Editing a wiki page does not change
ownership; the change must land as a pull request against `registry/services.yaml`.

## 2. Deploy pipeline

Deployments run through the shared pipeline. A merge to `main` builds an
immutable image, tags it with the commit SHA, and deploys to staging. Promotion
to production requires a manual approval from the owning team and passes a
fifteen minute soak test in staging.

Rollbacks are performed by deploying the previous image tag. Database migrations
are never rolled back automatically; every migration must be backwards
compatible with the previous release for at least two deploy cycles.

## 3. Incident response

Severity 1 incidents page the on-call engineer immediately. The incident
commander is the first responder until explicitly handed over. A written
timeline is required within 48 hours of resolution, and a blameless review is
scheduled within five working days.

The error budget policy is strict: if a service exhausts 75 percent of its
monthly error budget, feature work is paused until reliability work restores the
remaining budget. This applies to all tier-1 services.

## 4. Secrets and key rotation

Application secrets live in the vault and are injected at runtime. Signing keys
must be rotated every ninety days. Rotation is a two-person operation: one
engineer generates the new key, a second engineer confirms the cutover in a
separate session.

Long-lived static credentials are prohibited. Service-to-service authentication
uses short-lived tokens with a maximum lifetime of one hour. Any credential found
in a repository triggers an immediate rotation and a post-incident review.

## 5. Data retention

Application logs are retained for thirty days in the hot tier and one year in
cold storage. Audit logs, including authentication events and administrative
actions, are retained for seven years and are immutable once written.

Customer data deletion requests must be completed within thirty days. The
deletion workflow removes primary records, derived analytics tables and search
indexes. Snapshots older than thirty days are excluded from the deletion scope
by design.

## 6. Capacity planning

Each tier-1 service publishes a capacity model with four numbers: current peak
requests per second, sustained headroom, scaling trigger threshold and maximum
scale. The scaling trigger must fire at 65 percent utilisation, which leaves
enough room for a single availability-zone failure.

Quarterly load tests are mandatory. A service that fails its load test loses its
automatic production promotion until the regression is fixed and re-tested.

## 7. On-call expectations

On-call shifts are seven days, Monday to Monday, with a hard handover meeting at
10:00. Alerts must be acknowledged within five minutes. Any alert that pages
more than three times in a week without an actionable fix is converted into a
tracked reliability ticket.

Engineers must have completed the incident response training before joining an
on-call rotation. Training is valid for twelve months.

## 8. Change management

Standard changes are pre-approved and require no additional review: dependency
patch upgrades, log level changes and feature flag toggles. Normal changes need
one reviewer from the owning team. High-risk changes, defined as anything
touching authentication, billing or the data deletion path, require two
reviewers, one of whom must be a senior engineer.

Freeze windows apply across the end of the quarter. During a freeze only
security fixes and incident remediation are deployed, and both require written
approval from the director of engineering.
