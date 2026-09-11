# Fleet metrics

The dashboard reads `GET /metrics/fleet`, which combines the existing shared Azure
Log Analytics workspace with Azure's current replica inventory. It never falls
back to a randomly selected replica. The older `/metrics/performance` and
`/metrics/resources` endpoints remain available for API compatibility only.

## Collection and meaning

Every replica emits numeric JSON events to stdout: document completions, pipeline
stages, and a resource heartbeat every 30 seconds. Container Apps sends them to the
existing Log Analytics workspace. Events include a unique event ID, process ID,
replica, revision, and app resource ID; they contain no document bodies, record IDs,
credentials, or user information. Event IDs are deduplicated before aggregation.

- Processing counts, means, and approximate percentiles are computed over individual
  events from all replicas in the last 60 minutes. Stopped replicas remain included
  in these historical timings. Percentiles are never averaged across replicas.
- Resource totals use the latest heartbeat for each currently active replica across
  all active revisions. CPU is weighted by allocated cores; memory uses summed
  usage/capacity; cache hit rate uses summed hits/misses from the active processes.
- Resource totals are unavailable if inventory cannot be read or any active replica
  has missing/stale telemetry. Partial per-replica readings remain visible with
  timestamps and status. Process-only CPU/memory readings are not treated as full
  container readings in the fleet percentages.
- Freshness means a heartbeat no older than five minutes. Azure Monitor ingestion
  can take several minutes. This is a recent operational dashboard, not a live
  second-by-second monitor. Startup, rollout, and scale-out can temporarily show
  incomplete coverage. Received timing totals can change as delayed events arrive.
- Query failures (including HTTP 200 `PartialError`) return 503. Missing telemetry is
  unavailable, not zero. A successful snapshot is cached for 15 seconds per API
  process, and concurrent readers share the same query.
- Log shipping provides operational telemetry, not transactional accounting: events
  may be delayed or lost before ingestion. Salesforce remains the source for
  document counts/outcomes; those counts need not equal the 60-minute backend
  completion counts.

## Configuration

The Container App must have its existing system-assigned managed identity and its
environment must send console logs to Log Analytics.

| Environment variable | Value |
| --- | --- |
| `FLEET_METRICS_ENABLED` | `true` |
| `FLEET_METRICS_WORKSPACE_ID` | Workspace customer GUID, not its ARM resource ID |
| `FLEET_METRICS_APP_RESOURCE_ID` | This Container App's full ARM resource ID |

The identity needs **Log Analytics Reader** scoped to the existing workspace and
**Reader** scoped to this Container App for active revision/replica inventory.
`infra/modules/fleet-metrics-access.bicep` defines those scoped assignments.
`infra/main.bicep` wires them and the environment variables for infrastructure
releases. No new workspace, database, cache, or storage account is required.

For an existing app whose image is updated by `.github/workflows/deploy-uat.yml`,
image deployment alone does not configure the identity or these variables. Apply
the access module and environment settings once as an explicitly approved Azure
configuration change; do not redeploy the entire main infrastructure template just
to turn on metrics.

### UAT values verified read-only

- Subscription: `e17586a0-be7a-491e-b35e-20cc104a103a`
- Resource group: `docgen-uat-rg`
- App: `docgen-uat`
- Environment: `docgen-uat-env` (log destination: `log-analytics`)
- Workspace name: `docgen-uat-logs`
- Workspace customer ID: `f7f7cbf0-dd54-4201-8049-612c954a46ff`
- App resource ID: `/subscriptions/e17586a0-be7a-491e-b35e-20cc104a103a/resourceGroups/docgen-uat-rg/providers/Microsoft.App/containerapps/docgen-uat`
- Managed identity: `b66077b8-4b74-4d8d-86a6-944fc111e101`

The identity currently has AcrPull and Key Vault Secrets User. The two monitoring
read roles still need to be assigned. These values are deployment inputs, not
evidence that the new feature is deployed.

## Release acceptance

Deploy the backend image and configure collection/read access, then install the
Salesforce package containing `getFleetMetrics` and the updated LWC. Installing a
Salesforce package alone cannot enable backend collection.

1. Query Azure inventory independently. `/metrics/fleet.coverage.activeReplicas`
   must match and the response must list every active replica.
2. Allow initial heartbeats to arrive. Each active replica should report; missing
   or stale telemetry must be visible and must withhold resource totals.
3. Run known document requests and confirm that received completions from more
   than one replica contribute to combined counts and timing percentiles.
4. Compare CPU, memory, conversion slots, and cache totals with the replica cards.
   CPU/memory percentages must be weighted by capacity.
5. After a restart/scale event, historical completions remain in the 60-minute
   window and retired replicas no longer contribute to current resource totals.
6. Verify Performance, Diagnostics, refresh, and the paginated Documents table in
   Salesforce. Query/permission failures must not erase Salesforce volume data.

No Azure changes, UAT install, or live document generation are performed by local
unit tests or by the read-only synthetic KQL validation.

References: [Container Apps shared logs](https://learn.microsoft.com/en-us/azure/container-apps/log-monitoring),
[Logs query API](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/request-format),
[partial query responses](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/response-format),
[replica inventory](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/container-apps-revision-replicas/list-replicas?view=rest-resource-manager-containerapps-2025-01-01).
