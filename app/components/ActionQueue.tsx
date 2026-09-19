"use client";

// Cola de acciones: lo que el sistema está haciendo ahora y los mandos con los
// que un operador lo corrige (aprobar, reintentar, cancelar, reasignar recurso).

import { useState } from "react";
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Mail,
  MessageSquare,
  PhoneCall,
  Plus,
  RefreshCw,
  Ticket,
  Truck,
  Webhook,
  X,
} from "lucide-react";
import type { Action, Contact, CreateActionPayload, CrisisZone, Resource } from "@/lib/types";
import { Button } from "./ui/button";
import { Badge, type BadgeProps } from "./ui/badge";
import NewActionForm from "./NewActionForm";
import ResourcePicker from "./ResourcePicker";
import {
  actionStatusLabels,
  agoLabel,
  channelLabels,
  contactName,
  executionLabel,
  isOpenAction,
  troubledActionStatuses,
} from "./shared";

interface Props {
  actions: Action[];
  zones: CrisisZone[];
  contacts: Contact[];
  resources: Resource[];
  busy: string | null;
  nowMs: number;
  freshIds: Set<string>;
  formOpen: boolean;
  prefillZoneId: string | null;
  onToggleForm: (open: boolean) => void;
  onApprove: (actionId: string) => void;
  onRetry: (actionId: string) => void;
  onCancel: (actionId: string) => void;
  onReassign: (actionId: string, resourceId: string) => void;
  onCreate: (payload: CreateActionPayload) => void;
}

type Filter = "open" | "trouble" | "all";

const filterLabels: Record<Filter, string> = {
  open: "Abiertas",
  trouble: "Necesitan a alguien",
  all: "Todas",
};

const actionStatusBadge: Record<Action["status"], BadgeProps["variant"]> = {
  pending: "default",
  approved: "default",
  running: "warning",
  stalled: "warning",
  succeeded: "success",
  failed: "critical",
  blocked: "critical",
  cancelled: "default",
};

function channelIcon(action: Action) {
  if (action.status === "running") return <Loader2 className="spin" size={16} aria-hidden="true" />;
  if (troubledActionStatuses.includes(action.status))
    return <CircleAlert size={16} aria-hidden="true" />;
  if (action.status === "succeeded") return <CheckCircle2 size={16} aria-hidden="true" />;
  if (action.channel === "call") return <PhoneCall size={16} aria-hidden="true" />;
  if (action.channel === "email") return <Mail size={16} aria-hidden="true" />;
  if (action.channel === "ticket") return <Ticket size={16} aria-hidden="true" />;
  if (action.channel === "webhook") return <Webhook size={16} aria-hidden="true" />;
  return <MessageSquare size={16} aria-hidden="true" />;
}

export default function ActionQueue({
  actions,
  zones,
  contacts,
  resources,
  busy,
  nowMs,
  freshIds,
  formOpen,
  prefillZoneId,
  onToggleForm,
  onApprove,
  onRetry,
  onCancel,
  onReassign,
  onCreate,
}: Props) {
  const [filter, setFilter] = useState<Filter>("open");
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const visible = actions.filter((action) => {
    if (filter === "all") return true;
    if (filter === "trouble") return troubledActionStatuses.includes(action.status);
    return isOpenAction(action);
  });

  return (
    <div className="queue">
      <div className="queue-head">
        <div className="filter-row" role="group" aria-label="Filtrar la cola de acciones">
          {(Object.keys(filterLabels) as Filter[]).map((option) => (
            <button
              key={option}
              className={filter === option ? "chip active" : "chip"}
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
            >
              {filterLabels[option]}
              <em>
                {option === "all"
                  ? actions.length
                  : option === "trouble"
                    ? actions.filter((action) => troubledActionStatuses.includes(action.status))
                        .length
                    : actions.filter(isOpenAction).length}
              </em>
            </button>
          ))}
        </div>
        <Button
          variant="pill"
          size="sm"
          onClick={() => onToggleForm(!formOpen)}
          aria-expanded={formOpen}
        >
          <Plus size={14} aria-hidden="true" /> Nueva acción
        </Button>
      </div>

      {formOpen ? (
        <NewActionForm
          key={prefillZoneId ?? "manual-action"}
          zones={zones}
          contacts={contacts}
          resources={resources}
          prefillZoneId={prefillZoneId}
          busy={busy !== null}
          onSubmit={onCreate}
          onClose={() => onToggleForm(false)}
        />
      ) : null}

      <div className="action-list" role="list">
        {visible.length === 0 ? (
          <p className="muted-note">No hay acciones con este filtro.</p>
        ) : null}
        {visible.map((action) => {
          const zone = zones.find((candidate) => candidate.id === action.zoneId);
          const contact = contactName(contacts, action.contactId);
          const assignedResource =
            resources.find((resource) => resource.id === action.resourceId) ?? null;
          const fresh = freshIds.has(action.id);
          return (
            <article
              key={action.id}
              className={`action-row ${action.status} ${fresh ? "just-changed" : ""}`}
              role="listitem"
            >
              <div className="action-main">
                <span className={`action-icon ${action.status}`}>{channelIcon(action)}</span>
                <div>
                  <h3>
                    {action.objective}
                    {fresh ? <em className="flash-tag">Nueva</em> : null}
                  </h3>
                  <p>{action.reason}</p>
                  <p className="action-trace">
                    {channelLabels[action.channel]} a {action.target}
                    {contact ? ` · contacto ${contact}` : ""} · {zone?.name ?? action.zoneId} ·{" "}
                    {assignedResource?.name ?? "sin recurso"} · intento {action.attempt} ·{" "}
                    {agoLabel(action.updatedAt, nowMs)}
                  </p>
                  {action.result ? <p className="inline-result">{action.result}</p> : null}
                  {action.error ? <p className="inline-error">{action.error}</p> : null}
                  {assignedResource?.status === "unavailable" && isOpenAction(action) ? (
                    <p className="inline-error">
                      {assignedResource.name} está fuera de servicio: aprobar ahora dejaría la
                      acción bloqueada. Reasigna el recurso antes.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="action-meta flex flex-wrap gap-1.5 items-center">
                <Badge variant={actionStatusBadge[action.status]}>
                  {actionStatusLabels[action.status]}
                </Badge>
                <Badge variant={action.executionMode === "happyrobot" ? "info" : "outline"}>
                  {executionLabel(action.executionMode)}
                </Badge>
                {action.approvedBy ? (
                  <Badge variant="secondary">Aprobada por {action.approvedBy}</Badge>
                ) : null}
              </div>

              <div className="row-actions flex flex-wrap gap-1.5 items-center mt-2">
                <Button
                  size="sm"
                  variant="pill"
                  aria-label={`Aprobar y ejecutar: ${action.objective}`}
                  onClick={() => onApprove(action.id)}
                  disabled={
                    busy !== null ||
                    !["pending", "failed", "blocked", "stalled"].includes(action.status)
                  }
                >
                  <Check size={14} aria-hidden="true" /> Aprobar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Reintentar: ${action.objective}`}
                  onClick={() => onRetry(action.id)}
                  disabled={
                    busy !== null ||
                    !["failed", "blocked", "cancelled", "stalled"].includes(action.status)
                  }
                >
                  <RefreshCw size={14} aria-hidden="true" /> Reintentar
                </Button>
                <Button
                  size="sm"
                  variant="pillDestructive"
                  aria-label={`Cancelar: ${action.objective}`}
                  onClick={() => onCancel(action.id)}
                  disabled={busy !== null || ["succeeded", "cancelled"].includes(action.status)}
                >
                  <X size={14} aria-hidden="true" /> Cancelar
                </Button>
                <Button
                  size="sm"
                  variant={pickerFor === action.id ? "secondary" : "outline"}
                  aria-expanded={pickerFor === action.id}
                  aria-label={`Reasignar el recurso de: ${action.objective}`}
                  onClick={() => setPickerFor(pickerFor === action.id ? null : action.id)}
                  disabled={busy !== null || ["succeeded", "cancelled"].includes(action.status)}
                >
                  <Truck size={14} aria-hidden="true" /> Reasignar
                </Button>
              </div>

              {pickerFor === action.id ? (
                <ResourcePicker
                  action={action}
                  resources={resources}
                  zones={zones}
                  busy={busy !== null}
                  onAssign={(resourceId) => {
                    onReassign(action.id, resourceId);
                    setPickerFor(null);
                  }}
                />
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
