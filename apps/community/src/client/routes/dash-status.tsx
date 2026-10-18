import { m } from "@/paraglide/messages.js";
import { DashError, DashFacts, DashSection } from "../components/dash-ui";
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
    <p className="text-sm text-muted-foreground">{m.dash_status_hint({ at: dashDate(state.capturedAt) })}</p>
    <div className="grid gap-4 lg:grid-cols-2">
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
      <DashSection title={m.following_status_title()}><DashFacts rows={[
        {label:m.following_status_ready(),value:state.following?.ready?m.dash_ok():m.dash_unavailable()},
        {label:m.following_status_pending(),value:state.following?.pendingEvents??m.dash_unknown()},
        {label:m.following_status_delay(),value:state.following?.oldestPendingSeconds===null||!state.following?"—":`${state.following.oldestPendingSeconds.toFixed(1)}s`},
        {label:m.following_status_controls(),value:state.following?.pendingControls??m.dash_unknown()},
        {label:m.following_status_failures(),value:state.following?.failures??m.dash_unknown()},
        {label:m.following_status_success(),value:dashDate(state.following?.lastSuccessAt??null)},
        {label:m.following_status_failure(),value:dashDate(state.following?.lastFailureAt??null)},
      ]}/></DashSection>
      <DashSection title={m.dash_journal()}><DashFacts rows={[
        { label: m.dash_exported_sequence(), value: state.journal.exportedSequence }, { label: m.dash_journal_pending(), value: state.journal.pending },
        { label: m.dash_exported_at(), value: dashDate(state.journal.exportedAt) },
      ]} /></DashSection>
    </div>
    <DashSection title={m.dash_backup()}><div className="space-y-4"><p className="text-sm text-muted-foreground">{m.dash_backup_hint()}</p><DashFacts rows={[
      { label: m.dash_backup_state(), value: backupLabel }, { label: m.dash_backup_started(), value: dashDate(backup.startedAt) },
      { label: m.dash_backup_finished(), value: dashDate(backup.finishedAt) }, { label: m.dash_backup_last_success(), value: dashDate(backup.lastSuccessAt) },
      { label: m.dash_backup_original_count(), value: backup.originalCount ?? m.dash_unknown() }, { label: m.dash_backup_bytes(), value: dashBytes(backup.bytes) },
      { label: m.dash_backup_manifest(), value: backup.manifestSha256 ? <code className="break-all text-xs">{backup.manifestSha256}</code> : m.dash_unknown() },
    ]} /></div></DashSection>
  </section>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <DashError error={error} />; }
