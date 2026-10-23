import { m } from "@/paraglide/messages.js";
import { DashError, DashFacts, DashSection, DashViewHeading } from "../components/dash-ui";
import { dashBytes, dashDate, loadDash } from "../lib/dash";
import type { Route } from "./+types/dash-status";
export { headers, shouldRevalidate } from "../lib/dash";
export async function loader({ context, url }: Route.LoaderArgs) { return loadDash(context, url, api => api.status()); }
export default function DashStatus({ loaderData: state }: Route.ComponentProps) {
  const backup = state.backup;
  const qq = state.qq;
  const qqStates = { online: m.dash_qq_online, offline: m.dash_qq_offline, unreachable: m.dash_qq_unreachable, unknown: m.dash_unknown, disabled: m.dash_qq_disabled };
  const qqFailures = { qq_offline: m.dash_qq_offline, timeout: m.dash_qq_timeout, provider_error: m.dash_qq_provider_error, connection_error: m.dash_qq_connection_error };
  const backupLabel = backup.status === "succeeded" ? m.dash_backup_succeeded() : backup.status === "failed" ? m.dash_backup_failed() : backup.status === "running" ? m.dash_backup_running() : m.dash_unknown();
  const checks: Record<string, () => string> = { db: m.dash_check_db, redis: m.dash_check_redis, storage: m.dash_check_storage, media: m.dash_check_media, runtime: m.dash_check_runtime, jobs: m.dash_check_jobs };
  const roles: Record<string, () => string> = { web: m.dash_role_web, media: m.dash_role_media, control: m.dash_role_control };
  return <section className="space-y-4" aria-label={m.dash_status()}>
    <DashViewHeading title={m.dash_status()} description={m.dash_status_hint({ at: dashDate(state.capturedAt) })} />
    <nav className="community-content-nav" aria-label={m.ui_content_navigation()}><a href="#status-services">{m.ui_admin_services()}</a><a href="#status-content">{m.ui_admin_content_services()}</a><a href="#status-backup">{m.dash_backup()}</a></nav>
    <div id="status-services" className="grid gap-4 xl:grid-cols-2">
      <DashSection title={m.dash_qq()}><DashFacts rows={[
        { label: m.dash_qq_state(), value: qq ? qqStates[qq.state]() : m.dash_unknown() },
        { label: m.dash_qq_checked(), value: dashDate(qq?.checkedAt ?? null) },
        { label: m.dash_qq_changed(), value: dashDate(qq?.changedAt ?? null) },
        { label: m.dash_qq_failure(), value: qq?.failure ? qqFailures[qq.failure]() : "—" },
      ]} /></DashSection>
      <DashSection title={m.dash_dependencies()}><DashFacts rows={state.checks.map(check => ({ label: checks[check.name]?.() ?? check.name, value: check.status === "ok" ? m.dash_ok() : m.dash_unavailable() }))} /></DashSection>
      <DashSection title={m.dash_roles()}><DashFacts rows={state.roles.map(role => ({ label: roles[role.role]?.() ?? role.role, value: `${role.ready ? m.dash_ok() : m.dash_unavailable()} · ${(role.heartbeatAgeSeconds < 0 ? m.dash_unknown() : `${role.heartbeatAgeSeconds.toFixed(1)}s`)}` }))} /></DashSection>
      <DashSection title={m.dash_queues()}><DashFacts rows={[
        { label: m.dash_storage_dead(), value: state.queues.storageDead ?? m.dash_unknown() }, { label: m.dash_purge_dead(), value: state.queues.mediaPurgeDead ?? m.dash_unknown() },
        { label: m.dash_purge_incomplete(), value: state.queues.purgeIncomplete }, { label: m.dash_revoking(), value: state.queues.revoking },
        { label: m.dash_maintenance(), value: state.maintenance.active ? m.dash_maintenance_active() : m.dash_maintenance_idle() },
      ]} /></DashSection>
    </div><div id="status-content" className="grid gap-4 xl:grid-cols-2">
      <DashSection title={m.discovery_status()}><p>{state.discovery?.ready?m.discovery_status_ready():m.discovery_status_unavailable()}</p><p className="text-sm">{state.discovery?.performance.status==="passed"&&state.discovery.performance.checkedAt&&state.discovery.performance.p95Ms!==null?m.discovery_perf_receipt({date:dashDate(state.discovery.performance.checkedAt),ms:String(state.discovery.performance.p95Ms)}):m.discovery_perf_not_run()}</p></DashSection>
      <DashSection title={m.library_dash_title()}><p>{m.library_status_counts({lists:String(state.library?.lists??0),publications:String(state.library?.publications??0),pending:String(state.library?.pendingControls??0)})} · {state.library?.ready?m.dash_ok():m.dash_unavailable()}</p></DashSection>
      <DashSection title={m.following_status_title()}><DashFacts rows={[
        {label:m.following_status_ready(),value:state.following?.ready?m.dash_ok():m.dash_unavailable()},
        {label:m.following_status_pending(),value:state.following?.pendingEvents??m.dash_unknown()},
        {label:m.following_status_delay(),value:state.following?.oldestPendingSeconds===null||!state.following?"—":`${state.following.oldestPendingSeconds.toFixed(1)}s`},
        {label:m.following_status_controls(),value:state.following?.pendingControls??m.dash_unknown()},
        {label:m.following_status_failures(),value:state.following?.failures??m.dash_unknown()},
        {label:m.following_status_success(),value:dashDate(state.following?.lastSuccessAt??null)},
        {label:m.following_status_failure(),value:dashDate(state.following?.lastFailureAt??null)},
      ]}/></DashSection>
    </div><div id="status-backup" className="space-y-4">
      <DashSection title={m.dash_journal()}><DashFacts rows={[
        { label: m.dash_exported_sequence(), value: state.journal.exportedSequence }, { label: m.dash_journal_pending(), value: state.journal.pending },
        { label: m.dash_exported_at(), value: dashDate(state.journal.exportedAt) },
      ]} /></DashSection>
    <DashSection title={m.dash_backup()}><div className="space-y-4"><p className="text-sm text-muted-foreground">{m.dash_backup_hint()}</p><DashFacts rows={[
      { label: m.dash_backup_state(), value: <span className={`community-status ${backup.status === "succeeded" ? "is-accent" : backup.status === "failed" ? "is-warning" : ""}`}>{backupLabel}</span> }, { label: m.dash_backup_started(), value: dashDate(backup.startedAt) },
      { label: m.dash_backup_finished(), value: dashDate(backup.finishedAt) }, { label: m.dash_backup_last_success(), value: dashDate(backup.lastSuccessAt) },
      { label: m.dash_backup_original_count(), value: backup.originalCount ?? m.dash_unknown() }, { label: m.dash_backup_bytes(), value: dashBytes(backup.bytes) },
      { label: m.dash_backup_manifest(), value: backup.manifestSha256 ? <code className="break-all text-xs">{backup.manifestSha256}</code> : m.dash_unknown() },
    ]} /></div></DashSection></div>
  </section>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <DashError error={error} />; }
